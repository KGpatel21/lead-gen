/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OAuth 2.0 controllers for Google (Gmail) and Microsoft (Outlook).
 *
 * Flow:
 *   1. GET /api/oauth/{google|microsoft}/start
 *      Returns the vendor authorization URL. Encodes a HMAC-signed state
 *      token holding: userId + optional reconnectAccountId.
 *   2. User completes consent in the browser and is redirected to
 *      /api/oauth/{google|microsoft}/callback?code=...&state=...
 *   3. Callback exchanges the code, encrypts + persists the refresh token,
 *      stamps the access token expiry, upserts an email_accounts row, and
 *      redirects the browser to a friendly HTML page.
 */

import crypto from "crypto";
import { Request, Response } from "express";
import { config } from "../config";
import { emailAccountRepository } from "../db/repositories";
import { SecurityService } from "../services/security.service";
import { gmailOAuth, outlookOAuth } from "../providers/email";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { logAudit } from "../services/db.service";

// ---- signed state ----

function signState(payload: object): string {
  const b64 = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() }), "utf8")
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(b64).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64}.${sig}`;
}

function verifyState(state: string): any | null {
  if (!state || !state.includes(".")) return null;
  const [b64, sig] = state.split(".", 2);
  const expected = crypto.createHmac("sha256", config.jwtSecret).update(b64).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (
    Buffer.from(sig).length !== Buffer.from(expected).length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) return null;
  try {
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
    const payload = JSON.parse(json);
    // 10-minute state validity
    if (Date.now() - Number(payload.iat || 0) > 10 * 60 * 1000) return null;
    return payload;
  } catch { return null; }
}

// ---- html responses ----

function htmlPage(title: string, message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#0f172a}h1{font-size:22px}p{color:#475569;line-height:1.5}</style></head>
<body><h1>${title}</h1><p>${message}</p></body></html>`;
}

async function upsertOAuthAccount(
  provider: "gmail_oauth" | "outlook_oauth",
  info: {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scope?: string;
    email: string;
    userId: string;
    name?: string;
  },
  reconnectAccountId?: string
): Promise<string> {
  const expiresAt = new Date(Date.now() + info.expiresIn * 1000);
  const encryptedAccess = SecurityService.encryptSecret(info.accessToken);
  const encryptedRefresh = info.refreshToken ? SecurityService.encryptSecret(info.refreshToken) : null;

  if (reconnectAccountId) {
    const existing = await emailAccountRepository.findById(reconnectAccountId);
    if (existing) {
      await emailAccountRepository.update(reconnectAccountId, {
        oauthProviderUserId: info.userId,
        oauthScopes: info.scope,
        oauthAccessTokenEncrypted: encryptedAccess,
        oauthAccessTokenExpiresAt: expiresAt,
        ...(encryptedRefresh ? { oauthRefreshTokenEncrypted: encryptedRefresh } : {}),
        isHealthy: true,
      });
      return reconnectAccountId;
    }
  }

  const existing = await emailAccountRepository.findByEmail(info.email);
  if (existing && existing.provider === provider) {
    await emailAccountRepository.update(existing.id, {
      oauthProviderUserId: info.userId,
      oauthScopes: info.scope,
      oauthAccessTokenEncrypted: encryptedAccess,
      oauthAccessTokenExpiresAt: expiresAt,
      ...(encryptedRefresh ? { oauthRefreshTokenEncrypted: encryptedRefresh } : {}),
      isHealthy: true,
    });
    return existing.id;
  }

  // Fresh row
  const account = await emailAccountRepository.create({
    provider,
    providerKind: "user_mailbox",
    email: info.email,
    displayName: info.name,
    dailySendLimit: provider === "gmail_oauth" ? 500 : 300,
  });
  await emailAccountRepository.update(account.id, {
    oauthProviderUserId: info.userId,
    oauthScopes: info.scope,
    oauthAccessTokenEncrypted: encryptedAccess,
    oauthAccessTokenExpiresAt: expiresAt,
    ...(encryptedRefresh ? { oauthRefreshTokenEncrypted: encryptedRefresh } : {}),
  });
  return account.id;
}

export class OAuthController {
  // ---- Google ----
  public static async googleStart(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!config.googleClientId || !config.googleClientSecret) {
      res.status(503).json({ success: false, error: "Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)." });
      return;
    }
    const state = signState({
      userId: req.user?.id,
      reconnectAccountId: typeof req.query.reconnectAccountId === "string" ? req.query.reconnectAccountId : undefined,
    });
    const url = gmailOAuth.buildAuthUrl(state);
    res.json({ success: true, url });
  }

  public static async googleCallback(req: Request, res: Response): Promise<void> {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const decoded = verifyState(state);
    if (!code || !decoded) {
      res.status(400).type("html").send(htmlPage("Sign-in failed", "The state or code was invalid or expired. Please retry."));
      return;
    }
    try {
      const info = await gmailOAuth.exchangeCode(code);
      const accountId = await upsertOAuthAccount("gmail_oauth", info, decoded.reconnectAccountId);
      await logAudit(`Gmail OAuth connected: ${info.email}`, "SMTP", {
        userId: decoded.userId, userEmail: info.email, details: `accountId=${accountId}`, ipAddress: req.ip,
      });
      res.type("html").send(htmlPage("Gmail connected", `Your Gmail account <strong>${escapeHtml(info.email)}</strong> is connected. You can close this tab.`));
    } catch (err: any) {
      res.status(500).type("html").send(htmlPage("Sign-in failed", escapeHtml(err?.message || "Token exchange failed.")));
    }
  }

  // ---- Microsoft ----
  public static async microsoftStart(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!config.microsoftClientId || !config.microsoftClientSecret) {
      res.status(503).json({ success: false, error: "Microsoft OAuth not configured (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET)." });
      return;
    }
    const state = signState({
      userId: req.user?.id,
      reconnectAccountId: typeof req.query.reconnectAccountId === "string" ? req.query.reconnectAccountId : undefined,
    });
    const url = outlookOAuth.buildAuthUrl(state);
    res.json({ success: true, url });
  }

  public static async microsoftCallback(req: Request, res: Response): Promise<void> {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const decoded = verifyState(state);
    if (!code || !decoded) {
      res.status(400).type("html").send(htmlPage("Sign-in failed", "The state or code was invalid or expired. Please retry."));
      return;
    }
    try {
      const info = await outlookOAuth.exchangeCode(code);
      const accountId = await upsertOAuthAccount("outlook_oauth", info, decoded.reconnectAccountId);
      await logAudit(`Outlook OAuth connected: ${info.email}`, "SMTP", {
        userId: decoded.userId, userEmail: info.email, details: `accountId=${accountId}`, ipAddress: req.ip,
      });
      res.type("html").send(htmlPage("Outlook connected", `Your Outlook account <strong>${escapeHtml(info.email)}</strong> is connected. You can close this tab.`));
    } catch (err: any) {
      res.status(500).type("html").send(htmlPage("Sign-in failed", escapeHtml(err?.message || "Token exchange failed.")));
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
