/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared BullMQ ioredis connection. BullMQ v5 requires
 * `maxRetriesPerRequest: null` on the underlying client for blocking commands.
 */

import { Redis } from "ioredis";
import { config } from "../config";

export const bullConnection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

bullConnection.on("error", (err) => {
  console.error("[bullmq.redis] error:", err.message);
});
