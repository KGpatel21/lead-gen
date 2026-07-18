/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gmail OAuth 2.0 provider. Sends via `users.messages.send` with a raw
 * base64url-encoded RFC 5322 message. Refresh tokens are AES-256-CBC
 * encrypted at rest; access tokens are refreshed automatically on 401.
 */

import { config } from "../../config";
import { emailAccountRepository, EmailAccount } from "../../db/repositories/emailAccount.repository";
import { SecurityService } from "../../services/security.service";
import { EmailPayload, EmailProvider, EmailProviderError, EmailProviderNotConfiguredError, HealthTestResult, SendResult } from "./provider";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function requireOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new EmailProviderNotConfiguredError("gmail_oauth", "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  }
  return {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: `${config.publicBaseUrl.replace(/\/$/, "")}/api/oauth/google/callback`,
  };
}

// ---------- OAuth flow helpers (exported for the OAuth controller) ----------

export const gmailOAuth = {
  buildAuthUrl(state: string): string {
    const { clientId, redirectUri } = requireOAuthConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scope?: string;
    email: string;
    userId: string;
    name?: string;
  }> {
    const { clientId, clientSecret, redirectUri } = requireOAuthConfig();
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    const tokens = (await resp.json()) as any;
    if (!resp.ok || !tokens.access_token) {
      throw new EmailProviderError("gmail_oauth", tokens.error_description || tokens.error || "Token exchange failed", { httpStatus: 400 });
    }
    // Fetch userinfo to get the email + user id.
    const infoResp = await fetch(USERINFO, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = (await infoResp.json()) as any;
    if (!infoResp.ok || !info.email) {
      throw new EmailProviderError("gmail_oauth", "userinfo call failed", { httpStatus: 400 });
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: Number(tokens.expires_in || 3600),
      scope: tokens.scope,
      email: info.email,
      userId: info.id,
      name: info.name,
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const { clientId, clientSecret } = requireOAuthConfig();
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    const tokens = (await resp.json()) as any;
    if (!resp.ok || !tokens.access_token) {
      throw new EmailProviderError("gmail_oauth", tokens.error_description || tokens.error || "Refresh failed", {
        httpStatus: 401,
      });
    }
    return { accessToken: tokens.access_token, expiresIn: Number(tokens.expires_in || 3600) };
  },
};

// ---------- Provider implementation ----------

async function getFreshAccessToken(account: EmailAccount): Promise<string> {
  const expiryMs = account.oauthAccessTokenExpiresAt ? new Date(account.oauthAccessTokenExpiresAt).getTime() : 0;
  const now = Date.now();
  const stillValid = account.oauthAccessTokenEncrypted && expiryMs - now > 60_000;
  if (stillValid) return SecurityService.decryptSecret(account.oauthAccessTokenEncrypted!);
  if (!account.oauthRefreshTokenEncrypted) {
    throw new EmailProviderError("gmail_oauth", "Access token expired and no refresh token on file. Reconnect the account.", { httpStatus: 401 });
  }
  const refreshToken = SecurityService.decryptSecret(account.oauthRefreshTokenEncrypted);
  const refreshed = await gmailOAuth.refreshAccessToken(refreshToken);
  const expiresAt = new Date(now + refreshed.expiresIn * 1000);
  await emailAccountRepository.update(account.id, {
    oauthAccessTokenEncrypted: SecurityService.encryptSecret(refreshed.accessToken),
    oauthAccessTokenExpiresAt: expiresAt,
  });
  return refreshed.accessToken;
}

function toRfc5322(payload: EmailPayload, fromAddress: string): string {
  const headers: Record<string, string> = {
    From: fromAddress,
    To: payload.to,
    Subject: payload.subject,
    "MIME-Version": "1.0",
  };
  if (payload.replyTo) headers["Reply-To"] = payload.replyTo;
  if (payload.trackingId) headers["X-Email-Id"] = payload.trackingId;
  if (payload.campaignId) headers["X-Campaign-Id"] = payload.campaignId;
  for (const [n, v] of Object.entries(payload.headers || {})) headers[n] = v;

  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}`;
  headers["Content-Type"] = `multipart/alternative; boundary="${boundary}"`;

  const headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
  const textPart = `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${payload.text}\r\n`;
  const htmlPart = payload.html
    ? `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${payload.html}\r\n`
    : "";
  const end = `--${boundary}--\r\n`;
  return `${headerLines}\r\n\r\n${textPart}${htmlPart}${end}`;
}

function base64Url(str: string): string {
  return Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class GmailOAuthProvider implements EmailProvider {
  public readonly kind = "gmail_oauth";
  constructor(public readonly account: EmailAccount) {}

  public async send(payload: EmailPayload): Promise<SendResult> {
    const accessToken = await getFreshAccessToken(this.account);
    const fromAddress = this.account.displayName
      ? `"${this.account.displayName}" <${this.account.email}>`
      : this.account.email;
    const raw = base64Url(toRfc5322({ ...payload, from: fromAddress }, fromAddress));
    const start = Date.now();
    const resp = await fetch(GMAIL_SEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const json = (await resp.json().catch(() => ({}))) as any;
    if (!resp.ok) {
      const status = resp.status;
      const retriable = status === 429 || status >= 500;
      throw new EmailProviderError("gmail_oauth", json?.error?.message || `Gmail send failed HTTP ${status}`, {
        upstreamStatus: status,
        retriable,
        httpStatus: status === 429 ? 429 : 502,
      });
    }
    return {
      messageId: json.id || undefined,
      provider: this.kind,
      accountId: this.account.id,
      latencyMs: Date.now() - start,
    };
  }

  public async test(): Promise<HealthTestResult> {
    const start = Date.now();
    try {
      const accessToken = await getFreshAccessToken(this.account);
      const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const latencyMs = Date.now() - start;
      if (!resp.ok) return { ok: false, message: `Gmail profile check HTTP ${resp.status}`, latencyMs };
      const info = (await resp.json()) as any;
      return { ok: true, message: `Gmail OK (${info.emailAddress})`, latencyMs };
    } catch (err: any) {
      return { ok: false, message: err?.message || "Gmail test failed", latencyMs: Date.now() - start };
    }
  }
}
