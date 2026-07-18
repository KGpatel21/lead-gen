/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generic IMAP reader (imapflow) — for accounts registered as SMTP.
 * Works with Titan, Zoho, GoDaddy, cPanel, Hostinger, Namecheap, Fastmail,
 * Yahoo, Proton Bridge, and any RFC 3501-compliant IMAP server.
 *
 * Reads the INBOX (folder configurable in the future). Uses each account's
 * stored IMAP host/port/username and REUSES the encrypted SMTP password
 * unless a separate imap password is configured. IMAP fields on the account
 * row override the SMTP fields when set.
 */

import { ImapFlow, ImapFlowOptions } from "imapflow";
import { simpleParser } from "mailparser";
import type { EmailAccount } from "../../db/repositories/emailAccount.repository";
import { SecurityService } from "../../services/security.service";
import { log } from "../../observability/logger";
import { IncomingMessage, MailboxReader, MailboxReaderError, SyncCursor, SyncResult } from "./reader";

const CONNECT_TIMEOUT_MS = 15_000;

function buildClient(account: EmailAccount): ImapFlow {
  const host = account.imapHost || account.smtpHost;
  const port = account.imapPort || (account.imapSecure ? 993 : 143);
  const secure = account.imapSecure ?? true;
  const user = account.imapUsername || account.smtpUsername || account.email;
  const password = account.smtpPasswordEncrypted ? SecurityService.decryptSecret(account.smtpPasswordEncrypted) : "";

  if (!host || !user || !password) {
    throw new MailboxReaderError("smtp", "IMAP not configured (missing host/username/password on account).", { httpStatus: 503, retriable: false });
  }

  const opts: ImapFlowOptions = {
    host,
    port,
    secure,
    auth: { user, pass: password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: 60_000,
  };
  return new ImapFlow(opts);
}

export class ImapReader implements MailboxReader {
  public readonly provider = "imap";
  constructor(public readonly account: EmailAccount) {}

  public async fetchNewMessages(cursor: SyncCursor, maxMessages = 200): Promise<SyncResult> {
    const client = buildClient(this.account);
    const syncedAt = new Date();
    const messages: IncomingMessage[] = [];
    let highestUid = cursor.lastUid || 0;

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        // Only messages with UID > cursor.
        const startUid = (cursor.lastUid || 0) + 1;
        const range = `${startUid}:*`;
        let fetched = 0;

        for await (const msg of client.fetch(range, { envelope: true, uid: true, source: true, flags: true, threadId: true })) {
          if (!msg.uid || fetched >= maxMessages) break;
          if (msg.uid <= (cursor.lastUid || 0)) continue; // range can return the anchor
          fetched++;
          if (msg.uid > highestUid) highestUid = msg.uid;
          const raw = msg.source;
          const parsed = raw ? await simpleParser(raw as Buffer) : null;

          const from = parsed?.from?.value?.[0]?.address || msg.envelope?.from?.[0]?.address || "";
          const fromName = parsed?.from?.value?.[0]?.name || msg.envelope?.from?.[0]?.name || undefined;
          const to = parsed?.to
            ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
                .flatMap((a) => a.value || [])
                .map((a) => a.address || "")
                .filter(Boolean)
            : (msg.envelope?.to || []).map((t) => t.address || "").filter(Boolean);

          messages.push({
            providerMessageId: `imap-${msg.uid}`,
            internetMessageId: parsed?.messageId || msg.envelope?.messageId || undefined,
            inReplyTo: (parsed?.headers?.get("in-reply-to") as string) || undefined,
            references: Array.isArray(parsed?.references)
              ? parsed.references.join(" ")
              : (parsed?.references as string) || undefined,
            threadId: (msg as any).threadId ? String((msg as any).threadId) : undefined,
            folder: "INBOX",
            from: from || "",
            fromName,
            to,
            subject: parsed?.subject || msg.envelope?.subject || "",
            bodyText: parsed?.text || "",
            bodyHtml: (parsed?.html && typeof parsed.html === "string") ? parsed.html : undefined,
            receivedAt: parsed?.date || msg.envelope?.date || syncedAt,
            raw: parsed?.headers ? { headers: Object.fromEntries(parsed.headers as any) } : undefined,
          });
        }
      } finally {
        lock.release();
      }
    } catch (err: any) {
      log.warn({ account: this.account.email, err: err.message }, "imap fetch failed");
      throw new MailboxReaderError("imap", err?.message || "IMAP fetch failed", {
        retriable: true,
        httpStatus: 502,
      });
    } finally {
      try { await client.logout(); } catch { /* ignore */ }
    }

    return {
      messages,
      cursor: { lastUid: highestUid, lastSyncAt: syncedAt },
      provider: this.provider,
      accountId: this.account.id,
      syncedAt,
    };
  }

  public async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const client = buildClient(this.account);
    const start = Date.now();
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      lock.release();
      return { ok: true, message: "IMAP handshake succeeded", latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, message: err?.message || "IMAP handshake failed", latencyMs: Date.now() - start };
    } finally {
      try { await client.logout(); } catch { /* ignore */ }
    }
  }
}
