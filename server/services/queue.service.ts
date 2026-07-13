/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { QueueItem, dbService } from "./db.service";

class QueueService {
  /**
   * Enqueue a new email task into the persistent transactional queue.
   */
  public enqueueEmail(
    campaignId: string,
    leadId: string,
    to: string,
    subject: string,
    body: string,
    scheduledAt: string,
    priority: number = 2
  ): QueueItem {
    const dbState = dbService.getState();
    const newItem: QueueItem = {
      id: `queue-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      campaignId,
      leadId,
      to,
      subject,
      body,
      scheduledAt,
      status: 'QUEUED',
      attempts: 0,
      priority
    };

    dbState.queue.push(newItem);
    dbService.saveDb();
    return newItem;
  }

  /**
   * Resets a failed queue item and schedules it for immediate retry.
   */
  public retryQueueItem(id: string): boolean {
    const dbState = dbService.getState();
    const item = dbState.queue.find(q => q.id === id);
    if (!item) return false;

    item.status = 'QUEUED';
    item.attempts = 0;
    item.scheduledAt = new Date().toISOString();
    item.errorMessage = undefined;

    dbService.saveDb();
    dbService.logAudit(`Manual retry triggered for queue item ${id}`, "QUEUE", undefined, `Re-scheduled for immediate dispatch.`);
    return true;
  }

  /**
   * Resets all failed queue items associated with a specific campaign.
   */
  public retryCampaignQueue(campaignId: string): number {
    const dbState = dbService.getState();
    const itemsToRetry = dbState.queue.filter(q => q.campaignId === campaignId && q.status === 'FAILED');
    if (itemsToRetry.length === 0) return 0;

    const nowIso = new Date().toISOString();
    for (const item of itemsToRetry) {
      item.status = 'QUEUED';
      item.attempts = 0;
      item.scheduledAt = nowIso;
      item.errorMessage = undefined;
    }

    dbService.saveDb();
    dbService.logAudit(`Bulk retry triggered for campaign ${campaignId} queue`, "QUEUE", undefined, `Re-scheduled ${itemsToRetry.length} failed dispatches.`);
    return itemsToRetry.length;
  }

  /**
   * Cancels/deletes an active enqueued email job.
   */
  public deleteQueueItem(id: string): boolean {
    const dbState = dbService.getState();
    const initialLength = dbState.queue.length;
    dbState.queue = dbState.queue.filter(q => q.id !== id);

    if (dbState.queue.length === initialLength) return false;

    dbService.saveDb();
    dbService.logAudit(`Deleted queue item ${id}`, "QUEUE");
    return true;
  }

  /**
   * Cleans up all failed/Dead Letter queue jobs.
   */
  public clearFailedItems(): number {
    const dbState = dbService.getState();
    const initialLength = dbState.queue.length;
    dbState.queue = dbState.queue.filter(q => q.status !== 'FAILED');

    const clearedCount = initialLength - dbState.queue.length;
    if (clearedCount > 0) {
      dbService.saveDb();
      dbService.logAudit(`Cleared all failed queue items`, "QUEUE", undefined, `Pruned ${clearedCount} Dead Letter Queue records.`);
    }
    return clearedCount;
  }

  /**
   * Aggregates real-time metrics for queue dashboarding.
   */
  public getQueueStats() {
    const dbState = dbService.getState();
    let queued = 0;
    let pending = 0;
    let sent = 0;
    let failed = 0;

    for (const item of dbState.queue) {
      if (item.status === 'QUEUED') queued++;
      else if (item.status === 'PENDING') pending++;
      else if (item.status === 'SENT') sent++;
      else if (item.status === 'FAILED') failed++;
    }

    return { queued, pending, sent, failed, total: dbState.queue.length };
  }
}

export const queueService = new QueueService();
