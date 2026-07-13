/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Google Gmail / Microsoft Outlook OAuth stubs.
 *
 * Both providers require a real token exchange and IMAP/SMTP relay setup that
 * ships in Phase 2 (needs GOOGLE_CLIENT_SECRET / MICROSOFT_CLIENT_SECRET plus
 * an IMAP polling worker). Until then, unconfigured providers return HTTP 501,
 * and configured providers get the auth URL only — the callback returns 501
 * because the token-exchange plumbing is not present.
 */

import { Request, Response } from "express";
import { config } from "../config";
import { smtpRepository } from "../db/repositories";

export class SyncController {
  public static initiateGoogleOAuth(req: Request, res: Response): void {
    if (!config.googleClientId) {
      res.status(501).json({
        success: false,
        error: "Google mailbox sync is not configured (missing GOOGLE_CLIENT_ID).",
      });
      return;
    }
    const redirectUri = `${config.appUrl}/api/sync/oauth/google/callback`;
    const url =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(config.googleClientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent("https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly")}` +
      `&access_type=offline&prompt=consent`;
    res.json({ success: true, url });
  }

  public static handleGoogleCallback(_req: Request, res: Response): void {
    res.status(501).send(
      "Gmail OAuth callback is not implemented in this build. Token exchange ships in Phase 2."
    );
  }

  public static initiateMicrosoftOAuth(req: Request, res: Response): void {
    if (!config.microsoftClientId) {
      res.status(501).json({
        success: false,
        error: "Microsoft mailbox sync is not configured (missing MICROSOFT_CLIENT_ID).",
      });
      return;
    }
    const redirectUri = `${config.appUrl}/api/sync/oauth/microsoft/callback`;
    const url =
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(config.microsoftClientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent("https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read")}` +
      `&response_mode=query`;
    res.json({ success: true, url });
  }

  public static handleMicrosoftCallback(_req: Request, res: Response): void {
    res.status(501).send(
      "Outlook OAuth callback is not implemented in this build. Token exchange ships in Phase 2."
    );
  }

  public static async getSyncedAccounts(_req: Request, res: Response): Promise<void> {
    // For now we surface any SMTP account tagged as provider-linked.
    const all = await smtpRepository.list();
    const synced = all.filter((a) => (a as any).provider != null);
    res.json({ success: true, count: synced.length, accounts: synced });
  }

  public static async triggerManualSync(_req: Request, res: Response): Promise<void> {
    res.status(501).json({
      success: false,
      error:
        "Manual mailbox sync ships in Phase 2 alongside the IMAP polling worker.",
    });
  }
}
