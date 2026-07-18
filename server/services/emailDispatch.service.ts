/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider-neutral email dispatcher.
 *
 * Phase 3.5 hardening:
 *   - Enforces workspace_id from the email row on every account pick.
 *   - Suppression check uses Redis SISMEMBER cache (~0.5ms) instead of DB.
 *   - Fixes H14: increments `campaigns.sent_count` after a successful send.
 *   - Fails over up to 3 accounts on retriable provider errors.
 *   - Provider latency recorded on the account row.
 */

import {
  emailRepository,
  emailEventRepository,
  emailAccountRepository,
  senderPoolRepository,
  campaignRepository,
  Email,
  EmailAccount,
} from "../db/repositories";
import { suppressionRepository } from "../db/repositories/suppression.repository";
import { suppressionCacheService } from "./suppressionCache.service";
import { trackingService } from "./tracking.service";
import { getProviderFor, EmailPayload, EmailProviderError } from "../providers/email";
import { log } from "../observability/logger";

const MAX_FAILOVER_ATTEMPTS = 3;

export class RecipientSuppressedError extends Error {
  public readonly httpStatus = 409;
  constructor(email: string, reason: string) {
    super(`Recipient ${email} is on the suppression list (${reason}).`);
    this.name = "RecipientSuppressedError";
  }
}

export class NoSenderAvailableError extends Error {
  public readonly httpStatus = 503;
  constructor() {
    super("No verified sender account is available under quota.");
    this.name = "NoSenderAvailableError";
  }
}

async function pickAccountForEmail(email: Email, exclude: Set<string>): Promise<EmailAccount | null> {
  const workspaceId = email.workspaceId;
  if (!workspaceId) return null;

  // If the email already had a sender pinned and it's still healthy, respect it.
  if (email.senderIdentityId && !exclude.has(email.senderIdentityId)) {
    const acct = await emailAccountRepository.findById(email.senderIdentityId, workspaceId);
    if (acct && acct.isActive && acct.isHealthy) return acct;
  }

  // If the campaign has a sender pool, use its strategy.
  if (email.campaignId) {
    const campaign = await campaignRepository.findById(email.campaignId);
    const poolId = (campaign as any)?.senderPoolId as string | undefined;
    if (poolId) {
      const picked = await senderPoolRepository.pickFromPool(poolId);
      if (picked && !exclude.has(picked.id)) return picked;
    }
  }

  // Fallback: workspace-scoped round-robin.
  const rr = await emailAccountRepository.pickRoundRobin(workspaceId);
  if (rr && !exclude.has(rr.id)) return rr;
  return null;
}

interface DispatchOptions {
  orgName?: string;
}

export const emailDispatchService = {
  async sendEmailRow(email: Email, opts: DispatchOptions = {}): Promise<Email> {
    if (!email.toEmail) {
      await emailRepository.setStatus(email.id, "FAILED", { errorMessage: "No destination email." });
      throw new Error("No destination email on row.");
    }
    if (!email.workspaceId) {
      await emailRepository.setStatus(email.id, "FAILED", { errorMessage: "Email row has no workspace_id (should never happen after migration)." });
      throw new Error("Email row has no workspace_id.");
    }

    // Suppression: Redis cache first, DB as fallback (inside the cache service).
    if (await suppressionCacheService.isSuppressed(email.toEmail, email.workspaceId)) {
      const s = await suppressionRepository.findByEmail(email.toEmail, email.workspaceId);
      await emailRepository.setStatus(email.id, "FAILED", {
        errorMessage: `Suppressed (${s?.reason || "unknown"})`,
      });
      await emailEventRepository.log({
        emailId: email.id,
        eventType: "suppressed",
        rawPayload: { reason: s?.reason, source: s?.source },
      });
      throw new RecipientSuppressedError(email.toEmail, s?.reason || "unknown");
    }

    const orgName = opts.orgName || "Outbound.AI";
    const withFooters = trackingService.injectFooters(email.bodyText, email.bodyHtml, email.id, orgName);
    const html = trackingService.injectHtmlTracking(withFooters.bodyHtml, email.id);

    const payload: EmailPayload = {
      to: email.toEmail,
      subject: email.subject,
      text: withFooters.bodyText,
      html,
      trackingId: email.id,
      campaignId: email.campaignId,
      headers: {
        "List-Unsubscribe": `<${trackingService.unsubscribeUrl(email.id)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };

    const triedAccountIds = new Set<string>();
    let lastError: unknown = null;
    let lastAccount: EmailAccount | null = null;

    for (let attempt = 1; attempt <= MAX_FAILOVER_ATTEMPTS; attempt++) {
      const account = await pickAccountForEmail(email, triedAccountIds);
      if (!account) break;
      triedAccountIds.add(account.id);
      lastAccount = account;

      await emailRepository.setStatus(email.id, "SENDING", { provider: account.provider });
      await emailRepository.linkSender(email.id, account.id);

      try {
        const provider = getProviderFor(account);
        const result = await provider.send(payload);
        await emailAccountRepository.recordProviderLatency(account.id, result.latencyMs);
        const updated = await emailRepository.setStatus(email.id, "SENT", {
          provider: account.provider,
          messageId: result.messageId,
          sentAt: new Date(),
        });
        await emailEventRepository.log({
          emailId: email.id,
          eventType: "send",
          rawPayload: {
            provider: account.provider,
            accountId: account.id,
            messageId: result.messageId,
            latencyMs: result.latencyMs,
            attempt,
          },
        });
        // H14 fix: keep campaigns.sent_count in sync with real sends.
        if (email.campaignId) {
          await campaignRepository.incrementCounters(email.campaignId, { sentCount: 1 });
        }
        log.info(
          {
            emailId: email.id, to: email.toEmail, campaignId: email.campaignId,
            workspaceId: email.workspaceId, provider: account.provider,
            accountEmail: account.email, latencyMs: result.latencyMs, attempt,
          },
          "email sent"
        );
        return updated ?? email;
      } catch (err) {
        lastError = err;
        const providerError = err instanceof EmailProviderError ? err : null;
        const message = (err as Error)?.message || "send failed";
        await emailAccountRepository.recordFailure(account.id, message);
        log.warn(
          {
            emailId: email.id, attempt, maxAttempts: MAX_FAILOVER_ATTEMPTS,
            accountEmail: account.email, provider: account.provider,
            errMessage: message.slice(0, 300),
          },
          "email send failed, may failover"
        );

        const retriable = !providerError || providerError.retriable;
        if (!retriable || attempt >= MAX_FAILOVER_ATTEMPTS) break;
      }
    }

    if (!lastAccount) throw new NoSenderAvailableError();

    const finalMessage = (lastError as Error)?.message || "send failed";
    await emailRepository.setStatus(email.id, "FAILED", {
      provider: lastAccount.provider,
      errorMessage: finalMessage,
    });
    await emailEventRepository.log({
      emailId: email.id,
      eventType: "reject",
      rawPayload: { error: finalMessage, providerAttempts: Array.from(triedAccountIds) },
    });
    throw lastError;
  },
};
