/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-shot mailbox sync for a single email_account:
 *   1. Get reader from factory (null → skip; SES has no inbox).
 *   2. Load cursor from mailbox_sync_state.
 *   3. Reader fetches new messages since cursor.
 *   4. Each new message → upsert into `replies` (idempotent on
 *      (workspace_id, provider_message_id)).
 *   5. Correlate reply → sent email via In-Reply-To or thread-id.
 *      If matched, mark `emails.reply_received_at`.
 *   6. Classify NEW replies via Groq (9 categories).
 *   7. Persist new cursor + last_sync_at.
 *
 * All I/O is workspace-scoped via account.workspaceId.
 */

import { emailAccountRepository, mailboxSyncStateRepository, replyRepository } from "../db/repositories";
import { pool } from "../db/pool";
import { getReaderFor, IncomingMessage } from "../providers/mailbox";
import { replyClassifierService } from "./replyClassifier.service";
import { log } from "../observability/logger";

export interface MailboxSyncSummary {
  accountId: string;
  provider: string;
  fetched: number;
  newReplies: number;
  classified: number;
  errors: number;
  latencyMs: number;
}

async function correlateSentEmail(
  workspaceId: string,
  msg: IncomingMessage
): Promise<{ id: string; campaignId?: string; toEmail: string } | null> {
  if (msg.inReplyTo) {
    // in_reply_to is the RFC 5322 Message-ID of a sent message. If our SES
    // path stored that as `emails.message_id`, we can match on it.
    const r = await pool.query(
      `SELECT id, campaign_id, to_email FROM emails
       WHERE workspace_id = $1 AND message_id = $2 LIMIT 1`,
      [workspaceId, msg.inReplyTo]
    );
    if (r.rows[0]) return { id: r.rows[0].id, campaignId: r.rows[0].campaign_id || undefined, toEmail: r.rows[0].to_email };
  }
  // Fallback: find a recent sent email TO the reply's From address, in this
  // workspace. Not perfect but works for the common "cold reach → reply"
  // pattern where the same address responds.
  if (msg.from) {
    const r = await pool.query(
      `SELECT id, campaign_id, to_email FROM emails
       WHERE workspace_id = $1 AND LOWER(to_email) = LOWER($2)
             AND status IN ('SENT','BOUNCED','COMPLAINED')
       ORDER BY sent_at DESC NULLS LAST LIMIT 1`,
      [workspaceId, msg.from]
    );
    if (r.rows[0]) return { id: r.rows[0].id, campaignId: r.rows[0].campaign_id || undefined, toEmail: r.rows[0].to_email };
  }
  return null;
}

export const mailboxSyncService = {
  async syncAccount(accountId: string): Promise<MailboxSyncSummary> {
    const start = Date.now();
    const summary: MailboxSyncSummary = {
      accountId,
      provider: "unknown",
      fetched: 0,
      newReplies: 0,
      classified: 0,
      errors: 0,
      latencyMs: 0,
    };

    const account = await emailAccountRepository.findById(accountId);
    if (!account) {
      summary.errors++;
      log.warn({ accountId }, "mailboxSync: account not found");
      summary.latencyMs = Date.now() - start;
      return summary;
    }
    summary.provider = account.provider;

    const reader = getReaderFor(account);
    if (!reader) {
      log.info({ accountId, provider: account.provider }, "mailboxSync: no reader for provider (e.g. SES) — skipping");
      summary.latencyMs = Date.now() - start;
      return summary;
    }

    const state = await mailboxSyncStateRepository.ensureFor(accountId, account.workspaceId);
    const cursor = mailboxSyncStateRepository.toCursor(state);

    let result;
    try {
      result = await reader.fetchNewMessages(cursor);
    } catch (err: any) {
      await mailboxSyncStateRepository.recordFailure(accountId, err?.message || "unknown");
      summary.errors++;
      summary.latencyMs = Date.now() - start;
      log.warn({ accountId, err: err?.message }, "mailboxSync: reader failed");
      return summary;
    }
    summary.fetched = result.messages.length;

    for (const msg of result.messages) {
      try {
        const linked = await correlateSentEmail(account.workspaceId, msg);
        const up = await replyRepository.upsertFromProvider({
          workspaceId: account.workspaceId,
          accountId: account.id,
          campaignId: linked?.campaignId,
          providerMessageId: msg.providerMessageId,
          internetMessageId: msg.internetMessageId,
          inReplyTo: msg.inReplyTo,
          references: msg.references,
          threadId: msg.threadId,
          folder: msg.folder,
          providerKind: reader.provider,
          fromEmail: msg.from,
          fromName: msg.fromName,
          subject: msg.subject,
          bodyText: msg.bodyText,
          bodyHtml: msg.bodyHtml,
          receivedAt: msg.receivedAt,
          rawHeaders: msg.raw,
        });
        if (!up.isNew) continue;
        summary.newReplies++;

        // Mark the parent sent email so follow-ups suppress themselves.
        if (linked) {
          await pool.query(
            "UPDATE emails SET reply_received_at = COALESCE(reply_received_at, NOW()), updated_at = NOW() WHERE id = $1",
            [linked.id]
          );
        }

        // Classify — non-fatal on failure.
        try {
          const cls = await replyClassifierService.classify(msg.bodyText || msg.subject, msg.subject);
          await replyRepository.applyClassification(up.id, {
            category: cls.category,
            sentiment: cls.sentiment,
            summary: cls.summary,
            confidence: cls.confidence,
          });
          summary.classified++;
        } catch (err: any) {
          log.warn({ replyId: up.id, err: err?.message }, "mailboxSync: classification failed");
        }
      } catch (err: any) {
        summary.errors++;
        log.warn({ err: err?.message, providerMessageId: msg.providerMessageId }, "mailboxSync: reply upsert failed");
      }
    }

    await mailboxSyncStateRepository.recordSuccess(accountId, result.cursor);
    await emailAccountRepository.update(accountId, { lastProviderLatencyMs: Date.now() - start });

    summary.latencyMs = Date.now() - start;
    log.info(summary, "mailboxSync: complete");
    return summary;
  },
};
