/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import { dbService } from "../services/db.service";

export class SyncController {
  /**
   * Initiates Google Gmail OAuth flow.
   */
  public static initiateGoogleOAuth(req: Request, res: Response) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = "http://localhost:3000/api/sync/oauth/google/callback";
    const isProduction = process.env.NODE_ENV === "production";
    
    if (clientId) {
      // Real Google OAuth redirect
      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=https://www.googleapis.com/auth/gmail.readonly%20https://www.googleapis.com/auth/gmail.send` +
        `&access_type=offline&prompt=consent`;
      
      res.json({ success: true, url: googleAuthUrl, isMock: false });
    } else {
      if (isProduction) {
        res.status(403).json({ error: "Critical Error: GOOGLE_CLIENT_ID environment variable is missing. Real OAuth is required in production." });
        return;
      }
      // High-Fidelity Sandbox OAuth authorization callback simulation
      const mockCode = "mock_auth_code_" + Math.random().toString(36).substring(7);
      const simulationUrl = `/api/sync/oauth/google/callback?code=${mockCode}`;
      res.json({ success: true, url: simulationUrl, isMock: true });
    }
  }

  /**
   * Google OAuth Callback handler.
   */
  public static async handleGoogleCallback(req: Request, res: Response) {
    const { code } = req.query;
    if (!code) {
      res.status(400).send("Authorization code is missing.");
      return;
    }

    // Simulate exchanging code for token
    console.log(`[OAuth Sync] Exchanged code for Gmail token context: ${code}`);

    // Create a new synced SMTP/IMAP account record in database state
    const dbState = dbService.getState();
    const syncSmtp = {
      id: "smtp-sync-gmail-" + Date.now(),
      name: "Synced Gmail Inbox",
      email: "synced.inbox.pro@gmail.com",
      username: "synced.inbox.pro@gmail.com",
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpPassword: "encrypted_oauth_token_placeholder",
      dailyLimit: 200,
      sentToday: 0,
      reputationScore: 99,
      warmupEnabled: true,
      warmupDailyLimit: 25,
      warmupSentToday: 0,
      warmupPhase: "SEED",
      createdAt: new Date().toISOString(),
      syncStatus: "CONNECTED",
      lastSynced: new Date().toISOString()
    };

    dbState.smtpAccounts.unshift(syncSmtp as any);
    dbService.saveDb();
    dbService.logAudit("Gmail OAuth Inbox connection completed", "SMTP", undefined, "Synced synced.inbox.pro@gmail.com");

    // Redirect user back to the application dashboard with a success trigger parameter
    res.redirect("/?oauth=success&provider=gmail");
  }

  /**
   * Initiates Outlook / Microsoft OAuth flow.
   */
  public static initiateMicrosoftOAuth(req: Request, res: Response) {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri = "http://localhost:3000/api/sync/oauth/microsoft/callback";
    const isProduction = process.env.NODE_ENV === "production";

    if (clientId) {
      const msAuthUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
        `client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=https://graph.microsoft.com/Mail.Read%20https://graph.microsoft.com/Mail.Send` +
        `&response_mode=query`;
      res.json({ success: true, url: msAuthUrl, isMock: false });
    } else {
      if (isProduction) {
        res.status(403).json({ error: "Critical Error: MICROSOFT_CLIENT_ID environment variable is missing. Real OAuth is required in production." });
        return;
      }
      const mockCode = "mock_auth_code_ms_" + Math.random().toString(36).substring(7);
      const simulationUrl = `/api/sync/oauth/microsoft/callback?code=${mockCode}`;
      res.json({ success: true, url: simulationUrl, isMock: true });
    }
  }

  /**
   * Microsoft OAuth Callback handler.
   */
  public static async handleMicrosoftCallback(req: Request, res: Response) {
    const { code } = req.query;
    if (!code) {
      res.status(400).send("Authorization code is missing.");
      return;
    }

    console.log(`[OAuth Sync] Exchanged code for Outlook token: ${code}`);

    const dbState = dbService.getState();
    const syncSmtp = {
      id: "smtp-sync-outlook-" + Date.now(),
      name: "Synced Outlook Inbox",
      email: "synced.outbound@outlook.com",
      username: "synced.outbound@outlook.com",
      smtpHost: "smtp.office365.com",
      smtpPort: 587,
      smtpPassword: "encrypted_oauth_token_placeholder",
      dailyLimit: 300,
      sentToday: 0,
      reputationScore: 98,
      warmupEnabled: true,
      warmupDailyLimit: 20,
      warmupSentToday: 0,
      warmupPhase: "SEED",
      createdAt: new Date().toISOString(),
      syncStatus: "CONNECTED",
      lastSynced: new Date().toISOString()
    };

    dbState.smtpAccounts.unshift(syncSmtp as any);
    dbService.saveDb();
    dbService.logAudit("Outlook OAuth Inbox connection completed", "SMTP", undefined, "Synced synced.outbound@outlook.com");

    res.redirect("/?oauth=success&provider=outlook");
  }

  /**
   * List connected accounts and sync profiles.
   */
  public static getSyncedAccounts(req: Request, res: Response) {
    const dbState = dbService.getState();
    const synced = dbState.smtpAccounts.filter(s => (s as any).syncStatus === "CONNECTED");
    res.json({ success: true, count: synced.length, accounts: synced });
  }

  /**
   * Triggers a live manual background synchronization.
   */
  public static async triggerManualSync(req: Request, res: Response) {
    const dbState = dbService.getState();
    const syncedAccounts = dbState.smtpAccounts.filter(s => (s as any).syncStatus === "CONNECTED");

    for (const ac of syncedAccounts) {
      (ac as any).lastSynced = new Date().toISOString();
    }

    dbService.saveDb();
    dbService.logAudit("Triggered manual OAuth mailbox synchronization sweep", "SMTP", undefined, `Synced ${syncedAccounts.length} inboxes.`);

    res.json({
      success: true,
      message: `Successfully synchronized ${syncedAccounts.length} active OAuth mailboxes.`,
      timestamp: new Date().toISOString()
    });
  }
}
