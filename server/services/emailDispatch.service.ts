/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider-neutral email dispatch orchestrator.
 *
 * Responsibilities:
 *   - Enforce suppression list (before any provider call)
 *   - Pick an account (via sender pool strategy if the campaign has one,
 *     else round-robin over all healthy active accounts)
 *   - Inject unsubscribe footer, tracking pixel, and click rewrite
 *   - Send via `getProviderFor(account)` — never a specific vendor SDK
 *   - Persist SEND / SUPPRESSED / FAILED with sender + provider info
 *   - FAILOVER: on a retriable failure, mark the account unhealthy and
 *     try the next eligible account (up to 3 accounts per send)
 */

import {
  emailRepository,
  emailEventRepository,
  suppressionRepository,
  emailAccountRepository,
  senderPoolRepository,
  campaignRepository,
  Email,
  EmailAccount,
} from "../db/repositories";
import { trackingService } from "./tracking.service";
import { getProviderFor, EmailPayload, EmailProviderError } from "../providers/email";

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

async function pickAccountForCampaign(email: Email): Promise<EmailAccount | null> {
  // If the email already had a sender pinned (e.g. retry), respect it.
  if (email.senderIdentityId) {
    const acct = await emailAccountRepository.findById(email.senderIdentityId);
    if (acct && acct.isActive && acct.isHealthy) return acct;
  }
  // If the campaign has a sender pool, use its strategy.
  if (email.campaignId) {
    const campaign = await campaignRepository.findById(email.campaignId);
    const poolId = (campaign as any)?.senderPoolId as string | undefined;
    if (poolId) {
      const picked = await senderPoolRepository.pickFromPool(poolId);
      if (picked) return picked;
    }
  }
  // Fallback: round-robin over all healthy accounts.
  return emailAccountRepository.pickRoundRobin();
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
    if (await suppressionRepository.isSuppressed(email.toEmail)) {
      const s = await suppressionRepository.findByEmail(email.toEmail);
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

    // Failover: try up to MAX_FAILOVER_ATTEMPTS distinct accounts.
    const triedAccountIds = new Set<string>();
    let lastError: unknown = null;
    let account: EmailAccount | null = null;

    for (let attempt = 1; attempt <= MAX_FAILOVER_ATTEMPTS; attempt++) {
      account = await pickAccountForCampaign(email);
      if (!account || triedAccountIds.has(account.id)) {
        // If we already tried this account (pinned re-pick), pick fresh RR.
        account = await emailAccountRepository.pickRoundRobin();
      }
      if (!account) break;
      if (triedAccountIds.has(account.id)) continue;
      triedAccountIds.add(account.id);

      // Mark SENDING and link the tentative sender BEFORE the network call.
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
        console.log(
          `[dispatch] send OK email=${email.id} to=${email.toEmail} via=${account.provider} account=${account.email} ` +
          `latency=${result.latencyMs}ms attempt=${attempt}/${MAX_FAILOVER_ATTEMPTS}`
        );
        return updated ?? email;
      } catch (err) {
        lastError = err;
        const providerError = err instanceof EmailProviderError ? err : null;
        const message = (err as Error)?.message || "send failed";
        await emailAccountRepository.recordFailure(account.id, message);
        console.warn(
          `[dispatch] FAIL email=${email.id} attempt=${attempt}/${MAX_FAILOVER_ATTEMPTS} ` +
          `account=${account.email} provider=${account.provider} err="${message.slice(0, 160)}"`
        );

        const retriable = !providerError || providerError.retriable;
        const isLast = attempt >= MAX_FAILOVER_ATTEMPTS;
        if (!retriable || isLast) break;
        // Failover: try a different sender next iteration.
        continue;
      }
    }

    if (!account) {
      throw new NoSenderAvailableError();
    }
    const finalMessage = (lastError as Error)?.message || "send failed";
    await emailRepository.setStatus(email.id, "FAILED", {
      provider: account.provider,
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
