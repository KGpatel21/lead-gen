/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Microsoft 365 / Outlook OAuth 2.0 provider.
 *
 * Sends via the Microsoft Graph `/me/sendMail` endpoint.
 * Refresh tokens are AES-256-CBC encrypted at rest and rotated automatically.
 */

import { config } from "../../config";
import { emailAccountRepository, EmailAccount } from "../../db/repositories/emailAccount.repository";
import { SecurityService } from "../../services/security.service";
import { EmailPayload, EmailProvider, EmailProviderError, EmailProviderNotConfiguredError, HealthTestResult, SendResult } from "./provider";

const AUTH_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_ME = "https://graph.microsoft.com/v1.0/me";
const GRAPH_SEND = "https://graph.microsoft.com/v1.0/me/sendMail";

export const OUTLOOK_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/User.Read",
];

function requireOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!config.microsoftClientId || !config.microsoftClientSecret) {
    throw new EmailProviderNotConfiguredError("outlook_oauth", "MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET");
  }
  return {
    clientId: config.microsoftClientId,
    clientSecret: config.microsoftClientSecret,
    redirectUri: `${config.publicBaseUrl.replace(/\/$/, "")}/api/oauth/microsoft/callback`,
  };
}

export const outlookOAuth = {
  buildAuthUrl(state: string): string {
    const { clientId, redirectUri } = requireOAuthConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: OUTLOOK_SCOPES.join(" "),
      state,
      prompt: "consent",
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
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: OUTLOOK_SCOPES.join(" "),
      }).toString(),
    });
    const tokens = (await resp.json()) as any;
    if (!resp.ok || !tokens.access_token) {
      throw new EmailProviderError("outlook_oauth", tokens.error_description || tokens.error || "Token exchange failed", { httpStatus: 400 });
    }
    const infoResp = await fetch(GRAPH_ME, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const info = (await infoResp.json()) as any;
    const email = info.mail || info.userPrincipalName;
    if (!infoResp.ok || !email) {
      throw new EmailProviderError("outlook_oauth", "graph /me call failed", { httpStatus: 400 });
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: Number(tokens.expires_in || 3600),
      scope: tokens.scope,
      email,
      userId: info.id,
      name: info.displayName,
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }> {
    const { clientId, clientSecret } = requireOAuthConfig();
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: OUTLOOK_SCOPES.join(" "),
      }).toString(),
    });
    const tokens = (await resp.json()) as any;
    if (!resp.ok || !tokens.access_token) {
      throw new EmailProviderError("outlook_oauth", tokens.error_description || tokens.error || "Refresh failed", { httpStatus: 401 });
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token, // Microsoft rotates refresh tokens on each refresh
      expiresIn: Number(tokens.expires_in || 3600),
    };
  },
};

export async function getFreshOutlookAccessToken(account: EmailAccount): Promise<string> {
  const expiryMs = account.oauthAccessTokenExpiresAt ? new Date(account.oauthAccessTokenExpiresAt).getTime() : 0;
  const now = Date.now();
  if (account.oauthAccessTokenEncrypted && expiryMs - now > 60_000) {
    return SecurityService.decryptSecret(account.oauthAccessTokenEncrypted);
  }
  if (!account.oauthRefreshTokenEncrypted) {
    throw new EmailProviderError("outlook_oauth", "Access token expired and no refresh token on file. Reconnect the account.", { httpStatus: 401 });
  }
  const refreshToken = SecurityService.decryptSecret(account.oauthRefreshTokenEncrypted);
  const refreshed = await outlookOAuth.refreshAccessToken(refreshToken);
  const expiresAt = new Date(now + refreshed.expiresIn * 1000);
  const patch: any = {
    oauthAccessTokenEncrypted: SecurityService.encryptSecret(refreshed.accessToken),
    oauthAccessTokenExpiresAt: expiresAt,
  };
  if (refreshed.refreshToken) {
    patch.oauthRefreshTokenEncrypted = SecurityService.encryptSecret(refreshed.refreshToken);
  }
  await emailAccountRepository.update(account.id, patch);
  return refreshed.accessToken;
}

export class OutlookOAuthProvider implements EmailProvider {
  public readonly kind = "outlook_oauth";
  constructor(public readonly account: EmailAccount) {}

  public async send(payload: EmailPayload): Promise<SendResult> {
    const accessToken = await getFreshOutlookAccessToken(this.account);

    const internetMessageHeaders: Array<{ name: string; value: string }> = [];
    if (payload.trackingId) internetMessageHeaders.push({ name: "x-email-id", value: payload.trackingId });
    if (payload.campaignId) internetMessageHeaders.push({ name: "x-campaign-id", value: payload.campaignId });
    for (const [n, v] of Object.entries(payload.headers || {})) internetMessageHeaders.push({ name: n.toLowerCase(), value: v });

    const body = {
      message: {
        subject: payload.subject,
        body: {
          contentType: payload.html ? "HTML" : "Text",
          content: payload.html || payload.text,
        },
        toRecipients: [{ emailAddress: { address: payload.to } }],
        ...(payload.replyTo ? { replyTo: [{ emailAddress: { address: payload.replyTo } }] } : {}),
        ...(internetMessageHeaders.length ? { internetMessageHeaders } : {}),
      },
      saveToSentItems: true,
    };

    const start = Date.now();
    const resp = await fetch(GRAPH_SEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const status = resp.status;
      const retriable = status === 429 || status >= 500;
      throw new EmailProviderError("outlook_oauth", (err as any)?.error?.message || `Graph sendMail HTTP ${status}`, {
        upstreamStatus: status,
        retriable,
        httpStatus: status === 429 ? 429 : 502,
      });
    }
    // Graph sendMail is 202 Accepted with empty body — no messageId returned inline.
    return {
      messageId: undefined,
      provider: this.kind,
      accountId: this.account.id,
      latencyMs: Date.now() - start,
    };
  }

  public async test(): Promise<HealthTestResult> {
    const start = Date.now();
    try {
      const accessToken = await getFreshOutlookAccessToken(this.account);
      const resp = await fetch(GRAPH_ME, { headers: { Authorization: `Bearer ${accessToken}` } });
      const latencyMs = Date.now() - start;
      if (!resp.ok) return { ok: false, message: `Graph /me HTTP ${resp.status}`, latencyMs };
      const info = (await resp.json()) as any;
      return { ok: true, message: `Outlook OK (${info.mail || info.userPrincipalName})`, latencyMs };
    } catch (err: any) {
      return { ok: false, message: err?.message || "Outlook test failed", latencyMs: Date.now() - start };
    }
  }
}
