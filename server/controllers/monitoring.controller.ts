/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider health dashboard: per-account health, quota, latency, auth
 * status, last sync, reply counts. Workspace-scoped.
 */

import { Response } from "express";
import {
  emailAccountRepository,
  mailboxSyncStateRepository,
  workspaceRepository,
} from "../db/repositories";
import { pool } from "../db/pool";
import { WorkspaceScopedRequest } from "../middleware/workspaceContext.middleware";

function providerLabel(provider: string): string {
  switch (provider) {
    case "ses":            return "Amazon SES";
    case "smtp":           return "Generic SMTP";
    case "gmail_oauth":    return "Gmail OAuth";
    case "outlook_oauth":  return "Microsoft Graph";
    default:               return provider;
  }
}

export class MonitoringController {
  public static async dashboard(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const workspaceId = req.workspaceId!;
    const [accounts, syncStates, workspace] = await Promise.all([
      emailAccountRepository.list(workspaceId),
      mailboxSyncStateRepository.list(workspaceId),
      workspaceRepository.findById(workspaceId),
    ]);

    const syncByAccount = new Map(syncStates.map((s) => [s.accountId, s]));

    // Reply counts per account, this workspace.
    const replyAgg = await pool.query(
      `SELECT email_account_id, COUNT(*)::int AS n
         FROM replies
        WHERE workspace_id = $1 AND deleted_at IS NULL AND email_account_id IS NOT NULL
        GROUP BY email_account_id`,
      [workspaceId]
    );
    const replyCounts = new Map<string, number>(replyAgg.rows.map((r) => [r.email_account_id, r.n]));

    // Recent sent per account (last 24h).
    const sentAgg = await pool.query(
      `SELECT sender_identity_id AS account_id, COUNT(*)::int AS n
         FROM emails
        WHERE workspace_id = $1 AND status = 'SENT'
              AND sent_at > NOW() - INTERVAL '24 hours'
        GROUP BY sender_identity_id`,
      [workspaceId]
    );
    const sent24h = new Map<string, number>(sentAgg.rows.map((r) => [r.account_id, r.n]));

    const rows = accounts.map((a) => {
      const s = syncByAccount.get(a.id);
      let authStatus = "OK";
      if (a.provider === "gmail_oauth" || a.provider === "outlook_oauth") {
        if (!a.oauthRefreshTokenEncrypted) authStatus = "MISSING_REFRESH_TOKEN";
        else if (a.oauthAccessTokenExpiresAt && new Date(a.oauthAccessTokenExpiresAt).getTime() < Date.now())
          authStatus = "ACCESS_EXPIRED_WILL_REFRESH";
      }
      if (a.provider === "ses" && a.sesVerificationStatus !== "VERIFIED") authStatus = "SES_" + a.sesVerificationStatus;
      if (a.provider === "smtp" && !a.smtpPasswordEncrypted) authStatus = "MISSING_SMTP_PASSWORD";
      const quotaUsedPct = a.dailySendLimit > 0 ? Math.round((a.sentToday / a.dailySendLimit) * 100) : 0;

      return {
        id: a.id,
        email: a.email,
        displayName: a.displayName,
        provider: a.provider,
        providerLabel: providerLabel(a.provider),
        isActive: a.isActive,
        isHealthy: a.isHealthy,
        authStatus,
        health: {
          reputationScore: a.reputationScore,
          bounceCount: a.bounceCount,
          complaintCount: a.complaintCount,
          deliveryCount: a.deliveryCount,
        },
        quota: {
          dailyLimit: a.dailySendLimit,
          sentToday: a.sentToday,
          usedPct: quotaUsedPct,
        },
        latency: {
          lastProviderLatencyMs: a.lastProviderLatencyMs,
        },
        activity: {
          sentLast24h: sent24h.get(a.id) || 0,
          totalReplies: replyCounts.get(a.id) || 0,
          lastUsedAt: a.lastUsedAt,
        },
        sync: s
          ? {
              lastSyncAt: s.lastSyncAt,
              consecutiveErrors: s.consecutiveErrors,
              lastError: s.lastError,
            }
          : { lastSyncAt: null, consecutiveErrors: 0, lastError: null },
      };
    });

    res.json({
      success: true,
      workspace: { id: workspace?.id, name: workspace?.name },
      totals: {
        accounts: accounts.length,
        active: accounts.filter((a) => a.isActive && !a.deletedAt).length,
        healthy: accounts.filter((a) => a.isHealthy).length,
        withReplyCapability: accounts.filter((a) => a.provider !== "ses").length,
      },
      accounts: rows,
    });
  }
}
