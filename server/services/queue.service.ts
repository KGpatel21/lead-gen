/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { queueRepository, auditRepository } from "../db/repositories";
import { QueueItem } from "./db.service.types";

class QueueService {
  public async enqueueEmail(
    campaignId: string,
    leadId: string,
    to: string,
    subject: string,
    body: string,
    scheduledAt: Date,
    priority = 2
  ): Promise<QueueItem> {
    return queueRepository.create({ campaignId, leadId, to, subject, body, scheduledAt, priority });
  }

  public async retryQueueItem(id: string): Promise<boolean> {
    const ok = await queueRepository.retry(id);
    if (ok) {
      await auditRepository.log({
        action: `Manual retry triggered for queue item ${id}`,
        category: "QUEUE",
        details: "Re-scheduled for immediate dispatch.",
      });
    }
    return ok;
  }

  public async retryCampaignQueue(campaignId: string): Promise<number> {
    const n = await queueRepository.retryCampaignFailed(campaignId);
    if (n > 0) {
      await auditRepository.log({
        action: `Bulk retry triggered for campaign ${campaignId} queue`,
        category: "QUEUE",
        details: `Re-scheduled ${n} failed dispatches.`,
      });
    }
    return n;
  }

  public async deleteQueueItem(id: string): Promise<boolean> {
    const ok = await queueRepository.remove(id);
    if (ok) await auditRepository.log({ action: `Deleted queue item ${id}`, category: "QUEUE" });
    return ok;
  }

  public async clearFailedItems(): Promise<number> {
    const n = await queueRepository.clearFailed();
    if (n > 0) {
      await auditRepository.log({
        action: "Cleared all failed queue items",
        category: "QUEUE",
        details: `Pruned ${n} dead-letter records.`,
      });
    }
    return n;
  }

  public getQueueStats() {
    return queueRepository.stats();
  }
}

export const queueService = new QueueService();
