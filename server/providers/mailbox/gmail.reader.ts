/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gmail mailbox reader — uses the Gmail REST API rather than IMAP so we
 * inherit the same OAuth-refresh path as `GmailOAuthProvider.send`.
 *
 * Incremental sync uses Gmail's history API:
 *   - First sync (no historyId): list INBOX with a threshold like "newer_than:1d"
 *     and take the profile.historyId as the baseline.
 *   - Subsequent syncs: users.history.list(startHistoryId=cursor).
 */

import type { EmailAccount } from "../../db/repositories/emailAccount.repository";
import { getFreshGmailAccessToken } from "../email/gmail.provider";
import { log } from "../../observability/logger";
import { IncomingMessage, MailboxReader, MailboxReaderError, SyncCursor, SyncResult } from "./reader";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_LOOKBACK = "newer_than:1d";
const MAX_MESSAGES_PER_SYNC = 100;

function headerValue(headers: Array<{ name: string; value: string }> | undefined, key: string): string | undefined {
  const h = headers?.find((h) => h.name.toLowerCase() === key.toLowerCase());
  return h?.value;
}
function b64uToText(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
function extractBodies(payload: any): { text: string; html?: string } {
  let text = "", html: string | undefined;
  if (!payload) return { text: "", html: undefined };
  const walk = (p: any) => {
    if (!p) return;
    const mime = (p.mimeType || "").toLowerCase();
    const data = p.body?.data;
    if (data) {
      if (mime === "text/plain" && !text) text = b64uToText(data);
      else if (mime === "text/html" && !html) html = b64uToText(data);
    }
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return { text, html };
}

async function fetchJson(url: string, accessToken: string): Promise<any> {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new MailboxReaderError("gmail", (json as any).error?.message || `Gmail HTTP ${resp.status}`, {
      httpStatus: resp.status,
      retriable: resp.status >= 500 || resp.status === 429,
    });
  }
  return json;
}

async function getMessageIds(accessToken: string, cursor: SyncCursor): Promise<{ ids: string[]; newHistoryId?: string }> {
  if (cursor.lastHistoryId) {
    // Incremental via history API.
    const url = `${GMAIL_BASE}/history?startHistoryId=${encodeURIComponent(cursor.lastHistoryId)}&historyTypes=messageAdded&labelId=INBOX`;
    const data = await fetchJson(url, accessToken);
    const ids: string[] = [];
    for (const h of data.history || []) {
      for (const ma of h.messagesAdded || []) if (ma?.message?.id) ids.push(ma.message.id);
    }
    return { ids, newHistoryId: data.historyId };
  }
  // Baseline: recent inbox messages + fetch profile.historyId.
  const [list, profile] = await Promise.all([
    fetchJson(`${GMAIL_BASE}/messages?q=${encodeURIComponent(`in:inbox ${DEFAULT_LOOKBACK}`)}&maxResults=${MAX_MESSAGES_PER_SYNC}`, accessToken),
    fetchJson(`${GMAIL_BASE}/profile`, accessToken),
  ]);
  const ids = (list.messages || []).map((m: any) => m.id);
  return { ids, newHistoryId: String(profile.historyId) };
}

export class GmailReader implements MailboxReader {
  public readonly provider = "gmail";
  constructor(public readonly account: EmailAccount) {}

  public async fetchNewMessages(cursor: SyncCursor, maxMessages = MAX_MESSAGES_PER_SYNC): Promise<SyncResult> {
    const accessToken = await getFreshGmailAccessToken(this.account);
    const syncedAt = new Date();

    const { ids, newHistoryId } = await getMessageIds(accessToken, cursor);
    const messages: IncomingMessage[] = [];
    const capped = ids.slice(0, maxMessages);

    for (const id of capped) {
      try {
        const msg = await fetchJson(`${GMAIL_BASE}/messages/${id}?format=full`, accessToken);
        const headers = msg.payload?.headers || [];
        const bodies = extractBodies(msg.payload);
        messages.push({
          providerMessageId: msg.id,
          internetMessageId: headerValue(headers, "Message-ID"),
          inReplyTo: headerValue(headers, "In-Reply-To"),
          references: headerValue(headers, "References"),
          threadId: msg.threadId,
          folder: "INBOX",
          from: (headerValue(headers, "From") || "").replace(/^.*<([^>]+)>.*$/, "$1"),
          fromName: (headerValue(headers, "From") || "").replace(/\s*<[^>]+>\s*$/, "").trim() || undefined,
          to: (headerValue(headers, "To") || "").split(",").map((s) => s.trim()).filter(Boolean),
          subject: headerValue(headers, "Subject") || "",
          bodyText: bodies.text || msg.snippet || "",
          bodyHtml: bodies.html,
          receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : syncedAt,
          raw: { snippet: msg.snippet, labelIds: msg.labelIds },
        });
      } catch (err) {
        log.warn({ err: (err as Error).message, id }, "gmail message fetch failed, skipping");
      }
    }

    return {
      messages,
      cursor: { lastHistoryId: newHistoryId, lastSyncAt: syncedAt },
      provider: this.provider,
      accountId: this.account.id,
      syncedAt,
    };
  }

  public async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const accessToken = await getFreshGmailAccessToken(this.account);
      const info = await fetchJson(`${GMAIL_BASE}/profile`, accessToken);
      return {
        ok: true,
        message: `Gmail OK (${info.emailAddress}, ${info.messagesTotal || 0} messages)`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return { ok: false, message: err?.message || "Gmail test failed", latencyMs: Date.now() - start };
    }
  }
}
