/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistent background email dispatcher.
 *
 * NOTE: This is still a setInterval scheduler that reads from the `queue`
 * Postgres table. BullMQ+Redis is Phase 2 — it will replace this loop with
 * proper distributed queue semantics (per-tenant, retry-with-backoff,
 * dead-letter, priority tiers). This version already does:
 *   - persistent queue in Postgres (crash-safe)
 *   - per-SMTP account daily-limit + Redis-backed rate limiting
 *   - retry with linear backoff up to 3 attempts
 */

import { aiService, GeminiNotConfiguredError } from "../services/ai.service";
import { smtpService } from "../services/smtp.service";
import { redisService } from "../services/redis.service";
import {
  campaignRepository,
  leadRepository,
  smtpRepository,
  queueRepository,
  agentRepository,
} from "../db/repositories";
import { CampaignStatus, LeadStatus, SmtpAccount } from "../../src/types";

const SWEEP_INTERVAL_MS = 10_000;
const PER_LEAD_SPACING_SECONDS = 30;
const MIN_INTER_SEND_MS = 20_000;
const RATE_LIMIT_WINDOW_SEC = 3600;
const MAX_ATTEMPTS = 3;

export class QueueWorker {
  public static lastSweepTime: string = new Date().toISOString();

  public static async runWorkerStep(): Promise<void> {
    QueueWorker.lastSweepTime = new Date().toISOString();

    // Step A: enqueue outbound sends for RUNNING campaigns
    const running = await campaignRepository.listRunning();
    for (const campaign of running) {
      const pending = await leadRepository.listPendingByCampaign(campaign.id);
      if (pending.length === 0) {
        // Mark campaign completed if there are no pending leads AND no active queue items
        const anyQueue = await queueRepository.listPage(
          { campaignId: campaign.id, status: "QUEUED" },
          1,
          1
        );
        if (anyQueue.total === 0) {
          await campaignRepository.setStatus(campaign.id, CampaignStatus.COMPLETED);
        }
        continue;
      }

      let idx = 0;
      const baseTime = Date.now();
      for (const lead of pending) {
        const existing = await queueRepository.findByLead(lead.id);
        if (existing) continue;

        let subject = "";
        let body = "";
        try {
          const composed = await aiService.composeInitialEmail(lead.id, campaign.id);
          subject = composed.subject;
          body = composed.body;
        } catch (err) {
          if (err instanceof GeminiNotConfiguredError) {
            // No AI — fall back to raw template substitution (composeInitialEmail
            // itself already does this without calling the model).
            subject = campaign.subjectTemplate;
            body = campaign.bodyTemplate;
          } else {
            console.warn("[worker] compose failed for lead", lead.id, (err as Error).message);
            continue;
          }
        }

        const scheduledAt = new Date(baseTime + (idx + 1) * PER_LEAD_SPACING_SECONDS * 1000);
        await queueRepository.create({
          campaignId: campaign.id,
          leadId: lead.id,
          to: lead.email,
          subject,
          body,
          scheduledAt,
        });
        idx++;
      }
    }

    // Step B: dispatch eligible items
    const eligible = await queueRepository.pickEligibleForDispatch(50);
    if (eligible.length === 0) return;

    // Pull all healthy SMTP accounts once per sweep
    const healthy = await smtpRepository.listHealthy();
    if (healthy.length === 0) {
      console.warn("[worker] no healthy SMTP accounts available; sweep aborted");
      return;
    }

    for (const item of eligible) {
      const smtp = await this.pickAvailableSmtp(healthy);
      if (!smtp) {
        // Nothing under quota; retry next sweep.
        break;
      }

      const lead = await leadRepository.findById(item.leadId);
      const campaign = await campaignRepository.findById(item.campaignId);
      if (!lead || !campaign) {
        await queueRepository.markFailedOrRetry(item.id, "Lead or campaign missing", new Date(Date.now() + 60_000));
        continue;
      }

      await queueRepository.markPending(item.id, smtp.id);

      try {
        if (smtp.smtpPassword) {
          await smtpService.sendRealSmtpEmail(smtp, item.to, item.subject, item.body);
        } else {
          throw new Error("SMTP account has no password on file");
        }

        await queueRepository.markSent(item.id);
        await leadRepository.setStatus(lead.id, LeadStatus.SENT, { crmStage: "Contacted" });
        await smtpRepository.recordSend(smtp.id, smtp.warmupEnabled);
        await campaignRepository.incrementCounters(campaign.id, { sentCount: 1 });
        await this.recordRateLimit(smtp.id);
        await agentRepository.logRun({
          agentId: "agent-deliverability",
          input: `Dispatch ${item.id} → ${item.to}`,
          output: `Sent via ${smtp.email}. Reputation ${smtp.reputationScore}.`,
          status: "SUCCESS",
        });
      } catch (err: any) {
        const nextRetry = new Date(Date.now() + 5 * 60 * 1000);
        await queueRepository.markFailedOrRetry(item.id, err?.message || "SMTP error", nextRetry);
        const attempts = item.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await leadRepository.setStatus(lead.id, LeadStatus.FAILED, { errorMessage: err?.message });
          await smtpRepository.adjustReputation(smtp.id, -5, err?.message);
        }
        await agentRepository.logRun({
          agentId: "agent-deliverability",
          input: `Dispatch ${item.id} → ${item.to}`,
          output: `Failure attempt ${attempts}/${MAX_ATTEMPTS}: ${err?.message}`,
          status: "FAILED",
        });
      }
    }
  }

  private static async pickAvailableSmtp(healthy: SmtpAccount[]): Promise<SmtpAccount | null> {
    const now = Date.now();
    for (const smtp of healthy) {
      const dailyLimit = smtp.warmupEnabled ? smtp.warmupDailyLimit : smtp.dailyLimit;
      const sentCount = smtp.warmupEnabled ? smtp.warmupSentToday : smtp.sentToday;
      if (sentCount >= dailyLimit) continue;

      // Hourly limit via Redis counter
      const key = `smtp:hourly:${smtp.id}`;
      const hourly = (await redisService.get<number>(key)) ?? 0;
      const hourlyLimit = Math.max(1, Math.ceil(dailyLimit / 5));
      if (hourly >= hourlyLimit) continue;

      // Minimum inter-send cooldown via Redis
      const lastKey = `smtp:lastsend:${smtp.id}`;
      const last = (await redisService.get<number>(lastKey)) ?? 0;
      if (now - last < MIN_INTER_SEND_MS) continue;

      await redisService.set(lastKey, now, RATE_LIMIT_WINDOW_SEC);
      return smtp;
    }
    return null;
  }

  private static async recordRateLimit(smtpId: string): Promise<void> {
    const key = `smtp:hourly:${smtpId}`;
    const n = await redisService.incr(key, 1);
    if (n === 1) await redisService.expire(key, RATE_LIMIT_WINDOW_SEC);
  }

  public static startWorkerInterval(): void {
    setInterval(() => {
      this.runWorkerStep().catch((err) => {
        console.error("[worker] sweep crashed:", err?.message || err);
      });
    }, SWEEP_INTERVAL_MS);
    console.log(`[worker] persistent queue worker started (sweep every ${SWEEP_INTERVAL_MS} ms)`);
  }
}

export const queueWorker = QueueWorker;
