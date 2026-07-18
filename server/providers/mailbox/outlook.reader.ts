/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Outlook / Microsoft 365 mailbox reader via Microsoft Graph.
 * Uses delta queries for incremental sync — a `deltaLink` is stored in the
 * account's sync state and reused on the next poll.
 */

import type { EmailAccount } from "../../db/repositories/emailAccount.repository";
import { getFreshOutlookAccessToken } from "../email/outlook.provider";
import { log } from "../../observability/logger";
import { IncomingMessage, MailboxReader, MailboxReaderError, SyncCursor, SyncResult } from "./reader";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const DELTA_ENDPOINT = `${GRAPH_BASE}/me/mailFolders/Inbox/messages/delta`;
const SELECT = "$select=id,internetMessageId,internetMessageHeaders,from,toRecipients,ccRecipients,subject,body,bodyPreview,receivedDateTime,conversationId,parentFolderId";
const MAX_PAGES = 5;

async function fetchJson(url: string, accessToken: string): Promise<any> {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"',
    },
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new MailboxReaderError("outlook", (json as any).error?.message || `Graph HTTP ${resp.status}`, {
      httpStatus: resp.status,
      retriable: resp.status >= 500 || resp.status === 429,
    });
  }
  return json;
}

function graphHeaderValue(headers: Array<{ name: string; value: string }> | undefined, key: string): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === key.toLowerCase())?.value;
}

function toIncoming(msg: any, receivedAt: Date): IncomingMessage {
  const headers = msg.internetMessageHeaders || [];
  const bodyContentType = (msg.body?.contentType || "text").toLowerCase();
  const bodyContent: string = msg.body?.content || "";
  const bodyText = bodyContentType === "html" ? stripHtml(bodyContent) : bodyContent;
  const bodyHtml = bodyContentType === "html" ? bodyContent : undefined;

  return {
    providerMessageId: msg.id,
    internetMessageId: msg.internetMessageId || graphHeaderValue(headers, "Message-ID"),
    inReplyTo: graphHeaderValue(headers, "In-Reply-To"),
    references: graphHeaderValue(headers, "References"),
    threadId: msg.conversationId,
    folder: "INBOX",
    from: msg.from?.emailAddress?.address || "",
    fromName: msg.from?.emailAddress?.name || undefined,
    to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean),
    cc: (msg.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean),
    subject: msg.subject || "",
    bodyText,
    bodyHtml,
    receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : receivedAt,
    raw: { bodyPreview: msg.bodyPreview, parentFolderId: msg.parentFolderId },
  };
}
function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "")
             .replace(/<script[\s\S]*?<\/script>/gi, "")
             .replace(/<[^>]+>/g, " ")
             .replace(/&nbsp;/g, " ")
             .replace(/\s+/g, " ")
             .trim();
}

export class OutlookReader implements MailboxReader {
  public readonly provider = "outlook";
  constructor(public readonly account: EmailAccount) {}

  public async fetchNewMessages(cursor: SyncCursor, maxMessages = 100): Promise<SyncResult> {
    const accessToken = await getFreshOutlookAccessToken(this.account);
    const syncedAt = new Date();

    let url = cursor.lastDeltaLink || `${DELTA_ENDPOINT}?${SELECT}`;
    let deltaLink: string | undefined;
    const messages: IncomingMessage[] = [];
    let pages = 0;

    while (url && pages < MAX_PAGES && messages.length < maxMessages) {
      const page = await fetchJson(url, accessToken);
      pages++;
      for (const msg of page.value || []) {
        if (msg["@removed"]) continue;
        try {
          messages.push(toIncoming(msg, syncedAt));
        } catch (err) {
          log.warn({ err: (err as Error).message, id: msg.id }, "outlook message parse failed");
        }
        if (messages.length >= maxMessages) break;
      }
      if (page["@odata.deltaLink"]) { deltaLink = page["@odata.deltaLink"]; break; }
      url = page["@odata.nextLink"];
    }

    return {
      messages,
      cursor: { lastDeltaLink: deltaLink || cursor.lastDeltaLink, lastSyncAt: syncedAt },
      provider: this.provider,
      accountId: this.account.id,
      syncedAt,
    };
  }

  public async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const accessToken = await getFreshOutlookAccessToken(this.account);
      const info = await fetchJson(`${GRAPH_BASE}/me`, accessToken);
      return {
        ok: true,
        message: `Outlook OK (${info.mail || info.userPrincipalName})`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return { ok: false, message: err?.message || "Outlook test failed", latencyMs: Date.now() - start };
    }
  }
}
