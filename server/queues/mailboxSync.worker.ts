/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BullMQ worker for the `mailbox-sync` queue. Runs one sync per job.
 */

import { Worker } from "bullmq";
import { bullConnection } from "./connection";
import { MAILBOX_SYNC_QUEUE_NAME, MailboxSyncJobData } from "./mailboxSyncQueue";
import { mailboxSyncService } from "../services/mailboxSync.service";
import { log } from "../observability/logger";

const CONCURRENCY = parseInt(process.env.MAILBOX_SYNC_CONCURRENCY || "2", 10);

export const mailboxSyncWorker = new Worker<MailboxSyncJobData>(
  MAILBOX_SYNC_QUEUE_NAME,
  async (job) => {
    const { accountId } = job.data;
    return mailboxSyncService.syncAccount(accountId);
  },
  {
    connection: bullConnection,
    concurrency: CONCURRENCY,
    lockDuration: 120_000,
  }
);

mailboxSyncWorker.on("failed", (job, err) => {
  log.warn({ jobId: job?.id, err: err?.message }, "mailbox-sync worker job failed");
});
