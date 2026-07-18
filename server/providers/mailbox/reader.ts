/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Universal mailbox reader contract — the read/inbox counterpart to
 * `EmailProvider.send`. Every reader normalizes messages into the same
 * `IncomingMessage` shape so downstream reply-classification and thread
 * reconstruction are provider-agnostic.
 *
 * SES has no reader (no inbox to poll); its factory entry returns null.
 */

import type { EmailAccount } from "../../db/repositories/emailAccount.repository";

export interface IncomingMessage {
  /** Provider-specific ID (Gmail message.id, IMAP UID+folder, Graph message.id). */
  providerMessageId: string;
  /** RFC 5322 Message-ID header. Used to link replies to sent emails. */
  internetMessageId?: string;
  /** In-Reply-To header (parent message's Message-ID). */
  inReplyTo?: string;
  /** References header — full chain. */
  references?: string;
  /** Provider-native thread identifier (Gmail threadId, Graph conversationId, IMAP inferred). */
  threadId?: string;
  folder: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  receivedAt: Date;
  raw?: Record<string, unknown>;
}

export interface SyncCursor {
  /** IMAP: highest UID seen. Gmail: historyId. Graph: deltaLink. */
  lastUid?: number;
  lastHistoryId?: string;
  lastDeltaLink?: string;
  lastSyncAt?: Date;
}

export interface SyncResult {
  messages: IncomingMessage[];
  cursor: SyncCursor;
  provider: string;
  accountId: string;
  syncedAt: Date;
}

export interface MailboxReader {
  readonly provider: string;
  readonly account: EmailAccount;
  /**
   * Fetch every new message since `cursor` and return them in chronological
   * order plus the cursor to persist for the next sync.
   * Implementations MUST be idempotent — calling with the same cursor twice
   * should return the same set (readers do not delete anything).
   */
  fetchNewMessages(cursor: SyncCursor, maxMessages?: number): Promise<SyncResult>;
  /**
   * Quick handshake to prove the connection + credentials are healthy.
   * Called by `/api/email-accounts/:id/test`.
   */
  test(): Promise<{ ok: boolean; message: string; latencyMs: number }>;
}

export class MailboxReaderError extends Error {
  public readonly httpStatus: number;
  public readonly retriable: boolean;
  public readonly provider: string;
  constructor(provider: string, message: string, opts: { httpStatus?: number; retriable?: boolean } = {}) {
    super(message);
    this.name = "MailboxReaderError";
    this.provider = provider;
    this.httpStatus = opts.httpStatus ?? 502;
    this.retriable = opts.retriable ?? true;
  }
}
