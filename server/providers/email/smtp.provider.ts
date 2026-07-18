/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generic SMTP provider (nodemailer). Works with:
 *   - Zoho Mail (smtp.zoho.com:587 STARTTLS)
 *   - Titan Email (smtp.titan.email:587)
 *   - GoDaddy Workspace (smtpout.secureserver.net:587 or 465)
 *   - Fastmail (smtp.fastmail.com:465 SSL)
 *   - Hostinger, Namecheap, cPanel, Gmail SMTP, Outlook SMTP, Yahoo SMTP,
 *     Proton Bridge, and every other RFC-compliant SMTP server.
 *
 * Password credential is stored AES-256-CBC encrypted at rest.
 */

import nodemailer from "nodemailer";
import type { EmailAccount } from "../../db/repositories/emailAccount.repository";
import { SecurityService } from "../../services/security.service";
import { EmailPayload, EmailProvider, EmailProviderError, EmailProviderNotConfiguredError, HealthTestResult, SendResult } from "./provider";

const CONNECT_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 60_000;

function buildTransport(account: EmailAccount): nodemailer.Transporter {
  if (!account.smtpHost || !account.smtpPort) {
    throw new EmailProviderNotConfiguredError("smtp", "smtp_host / smtp_port on the account");
  }
  if (!account.smtpUsername || !account.smtpPasswordEncrypted) {
    throw new EmailProviderNotConfiguredError("smtp", "smtp_username / smtp_password on the account");
  }
  const password = SecurityService.decryptSecret(account.smtpPasswordEncrypted);
  const secure = account.smtpSecure ?? (account.smtpPort === 465);
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure,
    auth: { user: account.smtpUsername, pass: password },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    // Explicitly disable STARTTLS if the port already uses TLS on connect.
    requireTLS: !secure,
  });
}

const RETRIABLE_SMTP_ERRORS = /(ETIMEDOUT|ECONNRESET|ESOCKET|EAI_AGAIN|EDNS|ENETUNREACH|EHOSTUNREACH)|421|450|451|452/;

export class SmtpProvider implements EmailProvider {
  public readonly kind = "smtp";
  constructor(public readonly account: EmailAccount) {}

  public async send(payload: EmailPayload): Promise<SendResult> {
    const transport = buildTransport(this.account);
    const from = this.account.displayName
      ? `"${this.account.displayName}" <${this.account.email}>`
      : this.account.email;

    const headers: Record<string, string> = { ...(payload.headers || {}) };
    if (payload.trackingId) headers["X-Email-Id"] = payload.trackingId;
    if (payload.campaignId) headers["X-Campaign-Id"] = payload.campaignId;

    const start = Date.now();
    try {
      const info = await transport.sendMail({
        from: payload.from || from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        replyTo: payload.replyTo,
        headers,
      });
      return {
        messageId: info.messageId,
        provider: this.kind,
        accountId: this.account.id,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      const raw = String(err?.message || err?.code || "SMTP error");
      const retriable = RETRIABLE_SMTP_ERRORS.test(raw) || RETRIABLE_SMTP_ERRORS.test(String(err?.code || ""));
      throw new EmailProviderError("smtp", raw, {
        retriable,
        httpStatus: retriable ? 502 : 400,
      });
    } finally {
      transport.close();
    }
  }

  public async test(): Promise<HealthTestResult> {
    const transport = buildTransport(this.account);
    const start = Date.now();
    try {
      await transport.verify();
      return { ok: true, message: "SMTP handshake succeeded", latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, message: err?.message || "SMTP handshake failed", latencyMs: Date.now() - start };
    } finally {
      transport.close();
    }
  }
}

/**
 * Common SMTP presets so the UI can offer one-click connection templates.
 * Users still supply their own email + password.
 */
export const SMTP_PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  gmail:      { host: "smtp.gmail.com",           port: 465, secure: true },
  outlook:    { host: "smtp.office365.com",       port: 587, secure: false },
  yahoo:      { host: "smtp.mail.yahoo.com",      port: 465, secure: true },
  zoho:       { host: "smtp.zoho.com",            port: 587, secure: false },
  titan:      { host: "smtp.titan.email",         port: 587, secure: false },
  godaddy:    { host: "smtpout.secureserver.net", port: 465, secure: true },
  fastmail:   { host: "smtp.fastmail.com",        port: 465, secure: true },
  hostinger:  { host: "smtp.hostinger.com",       port: 465, secure: true },
  namecheap:  { host: "mail.privateemail.com",    port: 465, secure: true },
  cpanel:     { host: "mail.your-domain.tld",     port: 465, secure: true }, // user replaces host
  proton:     { host: "127.0.0.1",                port: 1025, secure: false }, // via Proton Bridge
};
