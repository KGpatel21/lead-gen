/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { dbService, QueueItem } from "../services/db.service";
import { aiService } from "../services/ai.service";
import { smtpService } from "../services/smtp.service";
import {
  CampaignStatus,
  LeadStatus,
  Reply,
  ReplySentiment,
  AgentTaskLog,
  Lead,
  Campaign
} from "../../src/types";

// Static timestamp registries for rolling limit tracking
const smtpSentTimestamps: Record<string, number[]> = {};
const smtpLastSendTime: Record<string, number> = {};

export class QueueWorker {
  public static lastSweepTime: string = new Date().toISOString();

  /**
   * Evaluates campaign schedules and calculates the next valid send window.
   */
  private static getNextValidScheduledTime(campaign: Campaign): Date {
    const now = new Date();
    // Default to offset 20 seconds from now in production
    const target = new Date(now.getTime() + 20000);
    return target;
  }

  /**
   * Executes a single processing sweep of the campaign queues and dispatch schedules.
   */
  public static async runWorkerStep() {
    QueueWorker.lastSweepTime = new Date().toISOString();
    const now = new Date();
    const dbState = dbService.getState();

    // --- STEP A: GENERATE QUEUE ITEMS FOR ACTIVE RUNNING CAMPAIGNS ---
    const runningCampaigns = dbState.campaigns.filter(
      c => c.status === CampaignStatus.RUNNING && !c.deletedAt
    );

    for (const campaign of runningCampaigns) {
      const pendingLeads = dbState.leads.filter(
        l => l.campaignId === campaign.id && l.status === LeadStatus.PENDING && !l.deletedAt
      );

      if (pendingLeads.length === 0) {
        campaign.status = CampaignStatus.COMPLETED;
        campaign.updatedAt = new Date().toISOString();
        dbService.saveDb();
        continue;
      }

      const campaignFutureItems = dbState.queue.filter(
        q => q.campaignId === campaign.id && q.status === "QUEUED"
      );
      let latestScheduledTime = this.getNextValidScheduledTime(campaign).getTime();

      if (campaignFutureItems.length > 0) {
        const maxScheduled = Math.max(...campaignFutureItems.map(q => new Date(q.scheduledAt).getTime()));
        if (maxScheduled > latestScheduledTime) {
          latestScheduledTime = maxScheduled;
        }
      }

      let itemIndex = 0;
      for (const lead of pendingLeads) {
        const existingQueueItem = dbState.queue.find(q => q.leadId === lead.id);
        if (existingQueueItem) continue;

        // Perform lead enrichment & research & generation
        const { subject, body } = await aiService.researchLeadAndGenerateEmail(lead.id, campaign.id);

        const spacingSeconds = 30; // 30 seconds deterministic spacing in production to avoid rate limits
        const scheduledTime = new Date(latestScheduledTime + (itemIndex + 1) * spacingSeconds * 1000);

        const newQueueItem: QueueItem = {
          id: `queue-${Date.now()}-${crypto.randomUUID().split("-")[0]}`,
          campaignId: campaign.id,
          leadId: lead.id,
          to: lead.email,
          subject,
          body,
          scheduledAt: scheduledTime.toISOString(),
          status: "QUEUED",
          attempts: 0,
          priority: 2
        };

        dbState.queue.push(newQueueItem);
        dbService.saveDb();
        itemIndex++;
      }
    }

    // --- STEP B: DISPATCH QUEUED EMAILS THAT ARE READY TO SEND ---
    const eligibleQueueItems = dbState.queue.filter(q => {
      const isReadyState = (q.status === "QUEUED" || q.status === "FAILED") && q.attempts < 3;
      if (!isReadyState) return false;

      const scheduledDate = new Date(q.scheduledAt);
      if (scheduledDate > now) return false;

      const campaign = dbState.campaigns.find(c => c.id === q.campaignId && !c.deletedAt);
      return campaign && campaign.status === CampaignStatus.RUNNING;
    });

    if (eligibleQueueItems.length === 0) return;

    // Sort by priority ascending, then scheduledAt ascending
    eligibleQueueItems.sort((a, b) => {
      const priorityA = a.priority ?? 2;
      const priorityB = b.priority ?? 2;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    for (const item of eligibleQueueItems) {
      const lead = dbState.leads.find(l => l.id === item.leadId);
      const campaign = dbState.campaigns.find(c => c.id === item.campaignId);
      if (!lead || !campaign) {
        item.status = "FAILED";
        item.errorMessage = "Associated lead or campaign missing";
        dbService.saveDb();
        continue;
      }

      const rotatingSmtps = dbState.smtpAccounts.filter(s => {
        if (s.deletedAt) return false;
        const dailyLimit = s.warmupEnabled ? s.warmupDailyLimit : s.dailyLimit;
        const sentCount = s.warmupEnabled ? s.warmupSentToday : s.sentToday;

        const nowMs = Date.now();
        const sentTimestamps = smtpSentTimestamps[s.id] || [];
        const oneHourAgo = nowMs - 3600000;
        const cleanTimestamps = sentTimestamps.filter(t => t > oneHourAgo);
        smtpSentTimestamps[s.id] = cleanTimestamps;

        const hourlyLimit = Math.ceil(dailyLimit / 5) || 10;
        const sentThisHour = cleanTimestamps.length;

        return sentCount < dailyLimit && sentThisHour < hourlyLimit && s.reputationScore > 50;
      });

      if (rotatingSmtps.length === 0) {
        console.warn("[QUEUE] Throttled: No healthy SMTP accounts available with daily/hourly quota left.");
        break;
      }

      let senderSmtp = rotatingSmtps[0];
      const nowMs = Date.now();
      const availableSmtp = rotatingSmtps.find(s => {
        const lastSend = smtpLastSendTime[s.id] || 0;
        return nowMs - lastSend >= 20000; // 20 seconds gap minimum
      });

      if (!availableSmtp) {
        console.log("[QUEUE] All active SMTP accounts in cooldown. Waiting for next rate limit slot...");
        break;
      }

      senderSmtp = availableSmtp;
      smtpLastSendTime[senderSmtp.id] = nowMs;

      item.status = "PENDING";
      item.lastAttempt = new Date().toISOString();
      dbService.saveDb();

      try {
        const isRealSend = !!senderSmtp.smtpPassword;
        if (isRealSend) {
          await smtpService.sendRealSmtpEmail(senderSmtp, item.to, item.subject, item.body);
        }

        item.status = "SENT";
        lead.status = LeadStatus.SENT;
        lead.crmStage = "Contacted";
        lead.updatedAt = new Date().toISOString();

        if (senderSmtp.warmupEnabled) {
          senderSmtp.warmupSentToday += 1;
        } else {
          senderSmtp.sentToday += 1;
        }
        campaign.sentCount += 1;

        if (!smtpSentTimestamps[senderSmtp.id]) {
          smtpSentTimestamps[senderSmtp.id] = [];
        }
        smtpSentTimestamps[senderSmtp.id].push(Date.now());

        const successLog: AgentTaskLog = {
          id: `log-queue-success-${Date.now()}`,
          agentId: "agent-deliverability",
          timestamp: new Date().toISOString(),
          input: `Process persistent queue item ${item.id} for lead ${item.to}`,
          output: `Successfully dispatched email. Method: ${isRealSend ? "Real SMTP" : "Sandbox Simulation"}. Inbox sender score: ${senderSmtp.reputationScore}% | Daily quota used: ${senderSmtp.warmupEnabled ? senderSmtp.warmupSentToday : senderSmtp.sentToday}`,
          status: "SUCCESS"
        };
        dbState.agentLogs.unshift(successLog);
        dbService.saveDb();
      } catch (err: any) {
        console.error("[QUEUE] Dispatch failed:", err);
        item.attempts += 1;
        item.errorMessage = err.message || "Unknown SMTP Error";
        item.status = item.attempts >= 3 ? "FAILED" : "QUEUED";

        if (item.status === "FAILED") {
          lead.status = LeadStatus.FAILED;
          lead.errorMessage = err.message || "All send attempts failed";
          lead.updatedAt = new Date().toISOString();
          senderSmtp.errorMessage = err.message || "SMTP Connection Failed";
        }

        const nextRetry = new Date();
        nextRetry.setMinutes(nextRetry.getMinutes() + 5);
        item.scheduledAt = nextRetry.toISOString();

        const errorLog: AgentTaskLog = {
          id: `log-queue-error-${Date.now()}`,
          agentId: "agent-deliverability",
          timestamp: new Date().toISOString(),
          input: `Process persistent queue item ${item.id} for lead ${item.to}`,
          output: `Dispatch failure: ${err.message}. Current attempts: ${item.attempts}/3. Scheduled next retry at ${nextRetry.toISOString()}`,
          status: "FAILED"
        };
        dbState.agentLogs.unshift(errorLog);
        dbService.saveDb();
      }
    }
  }

  /**
   * Initiates the background loop intervals.
   */
  public static startWorkerInterval() {
    setInterval(() => {
      this.runWorkerStep().catch(err => {
        console.error("CRITICAL: background queue worker crashed:", err);
      });
    }, 10000);
  }
}

export const queueWorker = QueueWorker;
