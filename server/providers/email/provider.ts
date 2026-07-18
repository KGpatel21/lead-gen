/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Universal email provider contract. Anything sending mail — SES, SMTP,
 * Gmail OAuth, Outlook OAuth — implements this. Business logic never
 * imports a specific vendor package.
 */

import type { EmailAccount } from "../../db/repositories/emailAccount.repository";

export interface EmailPayload {
  from?: string;                       // display "Name" <email>; provider fills default if omitted
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Application-set message tracking id (populates X-Email-Id). */
  trackingId?: string;
  campaignId?: string;
  /** Optional Configuration Set name (SES) or other provider-specific hints. */
  providerHints?: Record<string, unknown>;
}

export interface SendResult {
  messageId?: string;
  provider: string;
  accountId: string;
  latencyMs: number;
}

export interface HealthTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

export interface EmailProvider {
  /** Provider identifier: "ses" | "smtp" | "gmail_oauth" | "outlook_oauth". */
  readonly kind: string;
  readonly account: EmailAccount;
  send(payload: EmailPayload): Promise<SendResult>;
  test(): Promise<HealthTestResult>;
}

export class EmailProviderError extends Error {
  public readonly httpStatus: number;
  public readonly retriable: boolean;
  public readonly provider: string;
  public readonly upstreamStatus?: number;
  constructor(provider: string, message: string, opts: { httpStatus?: number; retriable?: boolean; upstreamStatus?: number } = {}) {
    super(message);
    this.name = "EmailProviderError";
    this.provider = provider;
    this.httpStatus = opts.httpStatus ?? 502;
    this.retriable = opts.retriable ?? false;
    this.upstreamStatus = opts.upstreamStatus;
  }
}

export class EmailProviderNotConfiguredError extends EmailProviderError {
  constructor(provider: string, missing: string) {
    super(provider, `${provider} provider is not configured (missing ${missing}).`, { httpStatus: 503, retriable: false });
    this.name = "EmailProviderNotConfiguredError";
  }
}
