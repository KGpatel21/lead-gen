/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified email account CRUD across every provider (SES, SMTP, Gmail
 * OAuth, Outlook OAuth). OAuth accounts are created via the OAuth
 * callback flow — this endpoint handles SES and SMTP registration only.
 */

import { Request, Response } from "express";
import {
  emailAccountRepository,
  ProviderKind,
} from "../db/repositories";
import { SecurityService } from "../services/security.service";
import { getProviderFor, SMTP_PRESETS } from "../providers/email";
import { logAudit } from "../services/db.service";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PROVIDERS: ProviderKind[] = ["ses", "smtp", "gmail_oauth", "outlook_oauth"];

function sanitize(account: any) {
  const { smtpPasswordEncrypted, oauthAccessTokenEncrypted, oauthRefreshTokenEncrypted, ...rest } = account;
  return {
    ...rest,
    hasSmtpPassword: !!smtpPasswordEncrypted,
    hasOauthAccessToken: !!oauthAccessTokenEncrypted,
    hasOauthRefreshToken: !!oauthRefreshTokenEncrypted,
  };
}

export class EmailAccountController {
  public static async list(_req: Request, res: Response): Promise<void> {
    const data = await emailAccountRepository.list();
    res.json({ success: true, data: data.map(sanitize) });
  }

  public static presets(_req: Request, res: Response): void {
    res.json({ success: true, providers: VALID_PROVIDERS, smtpPresets: SMTP_PRESETS });
  }

  /**
   * Create an SES or SMTP account. OAuth (Gmail / Outlook) accounts land
   * through the OAuth controllers instead — they need the browser round-trip.
   */
  public static async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const {
      provider,
      email,
      displayName,
      dailySendLimit,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUsername,
      smtpPassword,
      imapHost,
      imapPort,
      imapSecure,
      imapUsername,
    } = req.body || {};

    if (!VALID_PROVIDERS.includes(provider)) {
      res.status(400).json({ success: false, error: `provider must be one of ${VALID_PROVIDERS.join(", ")}` });
      return;
    }
    if (provider === "gmail_oauth" || provider === "outlook_oauth") {
      res.status(400).json({
        success: false,
        error: `Use POST /api/oauth/${provider === "gmail_oauth" ? "google" : "microsoft"}/start to connect an OAuth mailbox.`,
      });
      return;
    }
    if (!EMAIL_REGEX.test(email || "")) {
      res.status(400).json({ success: false, error: "valid email required" });
      return;
    }
    const dupe = await emailAccountRepository.findByEmail(email);
    if (dupe) { res.status(409).json({ success: false, error: "account exists" }); return; }

    if (provider === "smtp") {
      if (!smtpHost || !smtpPort || !smtpUsername || !smtpPassword) {
        res.status(400).json({
          success: false,
          error: "SMTP requires smtpHost, smtpPort, smtpUsername, smtpPassword.",
        });
        return;
      }
    }

    const account = await emailAccountRepository.create({
      provider,
      providerKind: provider === "ses" ? "transactional" : "user_mailbox",
      email,
      displayName,
      dailySendLimit: typeof dailySendLimit === "number" ? dailySendLimit : 200,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUsername,
      smtpPasswordEncrypted: smtpPassword ? SecurityService.encryptSecret(smtpPassword) : undefined,
      imapHost,
      imapPort,
      imapSecure,
      imapUsername,
    });

    await logAudit(`Email account added: ${account.email} (${account.provider})`, "SMTP", {
      userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip,
    });

    res.status(201).json({ success: true, account: sanitize(account) });
  }

  public static async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const account = await emailAccountRepository.findById(id);
    if (!account) { res.status(404).json({ success: false, error: "not found" }); return; }
    const patch: any = {};
    const b = req.body || {};
    for (const k of [
      "displayName", "smtpHost", "smtpPort", "smtpSecure", "smtpUsername",
      "imapHost", "imapPort", "imapSecure", "imapUsername",
      "dailySendLimit", "isActive", "warmupEnabled",
    ]) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    if (typeof b.smtpPassword === "string" && b.smtpPassword.length > 0) {
      patch.smtpPasswordEncrypted = SecurityService.encryptSecret(b.smtpPassword);
    }
    const updated = await emailAccountRepository.update(id, patch);
    res.json({ success: true, account: sanitize(updated) });
  }

  public static async test(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const account = await emailAccountRepository.findById(id);
    if (!account) { res.status(404).json({ success: false, error: "not found" }); return; }
    try {
      const provider = getProviderFor(account);
      const result = await provider.test();
      await emailAccountRepository.recordProviderLatency(id, result.latencyMs);
      await emailAccountRepository.update(id, { isHealthy: result.ok });
      res.json({ success: true, test: result });
    } catch (err: any) {
      const message = err?.message || "test failed";
      await emailAccountRepository.recordFailure(id, message);
      res.status(err?.httpStatus || 500).json({ success: false, error: message });
    }
  }

  public static async setActive(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { active } = req.body || {};
    if (typeof active !== "boolean") {
      res.status(400).json({ success: false, error: "active (boolean) required." });
      return;
    }
    const updated = await emailAccountRepository.update(id, { isActive: active });
    if (!updated) { res.status(404).json({ success: false, error: "not found" }); return; }
    res.json({ success: true, account: sanitize(updated) });
  }

  public static async reconnect(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const account = await emailAccountRepository.findById(id);
    if (!account) { res.status(404).json({ success: false, error: "not found" }); return; }
    if (account.provider === "gmail_oauth" || account.provider === "outlook_oauth") {
      const scheme = account.provider === "gmail_oauth" ? "google" : "microsoft";
      res.json({
        success: true,
        reconnectUrl: `/api/oauth/${scheme}/start?reconnectAccountId=${account.id}`,
      });
      return;
    }
    // For SES / SMTP: reconnect = re-run the health test.
    try {
      const provider = getProviderFor(account);
      const result = await provider.test();
      await emailAccountRepository.update(id, { isHealthy: result.ok, isActive: result.ok });
      res.json({ success: true, test: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || "reconnect failed" });
    }
  }

  public static async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const account = await emailAccountRepository.findById(id);
    if (!account) { res.status(404).json({ success: false, error: "not found" }); return; }
    await emailAccountRepository.softDelete(id);
    res.json({ success: true });
  }
}
