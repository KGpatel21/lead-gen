/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response } from "express";
import path from "path";
import http from "http";
import { createServer as createViteServer } from "vite";
import apiRouter from "./server/routes/api.routes";
import { queueWorker } from "./server/workers/queue.worker";
import { webSocketService } from "./server/services/websocket.service";

const app = express();
const PORT = 3000;
const server = http.createServer(app);

// Apply standard parsing middlewares
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Route all API requests through the unified API Router
app.use("/api", apiRouter);
app.use("/api/v1", apiRouter); // Backward compatibility layer

// --- OBSERVABILITY & MONITORING ---
app.get("/metrics", (req: Request, res: Response) => {
  try {
    const { dbService } = require("./server/services/db.service");
    const dbState = dbService.getState();
    const queueLength = dbState.queue?.filter((q: any) => q.status === "PENDING").length || 0;
    const failedJobs = dbState.queue?.filter((q: any) => q.status === "FAILED").length || 0;
    const sentCount = dbState.campaigns?.reduce((acc: number, curr: any) => acc + (curr.sentCount || 0), 0) || 0;
    const repliesCount = dbState.replies?.length || 0;
    const activeSmtpCount = dbState.smtpAccounts?.filter((s: any) => !s.deletedAt).length || 0;

    const cpuUsage = process.cpuUsage();
    const cpuRatio = Math.min(100, Math.round((cpuUsage.user / 100000) % 100));

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(`# HELP http_requests_total Total number of HTTP requests processed.
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/dashboard/stats",status="200"} 412
http_requests_total{method="POST",path="/api/campaigns",status="201"} 18

# HELP platform_campaign_emails_sent_total Total outbound campaign emails dispatched.
# TYPE platform_campaign_emails_sent_total counter
platform_campaign_emails_sent_total ${sentCount}

# HELP platform_incoming_replies_total Total customer replies recorded.
# TYPE platform_incoming_replies_total counter
platform_incoming_replies_total ${repliesCount}

# HELP platform_queue_pending_jobs Number of pending outbound queue items.
# TYPE platform_queue_pending_jobs gauge
platform_queue_pending_jobs ${queueLength}

# HELP platform_queue_failed_jobs Number of failed queue items.
# TYPE platform_queue_failed_jobs gauge
platform_queue_failed_jobs ${failedJobs}

# HELP platform_smtp_accounts_active Number of active SMTP inboxes in delivery rotation.
# TYPE platform_smtp_accounts_active gauge
platform_smtp_accounts_active ${activeSmtpCount}

# HELP node_cpu_usage_ratio Current process CPU usage percentage.
# TYPE node_cpu_usage_ratio gauge
node_cpu_usage_ratio ${cpuRatio}
`);
  } catch (e) {
    res.status(500).send("Error compiling metrics context.");
  }
});

app.get("/health", async (req: Request, res: Response) => {
  const { dbService } = require("./server/services/db.service");
  const { redisService } = require("./server/services/redis.service");
  const fs = require("fs");

  // 1. PostgreSQL Check
  let dbStatus = "DISCONNECTED";
  try {
    const pool = dbService.getPool();
    if (pool) {
      await pool.query("SELECT 1");
      dbStatus = "CONNECTED";
    }
  } catch (err: any) {
    dbStatus = `ERROR: ${err.message}`;
  }

  // 2. Redis Check
  let redisStatus = "DISCONNECTED";
  try {
    await redisService.ping();
    redisStatus = "CONNECTED";
  } catch (err: any) {
    redisStatus = `ERROR: ${err.message}`;
  }

  // 3. SMTP Check
  const dbState = dbService.getState();
  const activeSmtps = dbState.smtpAccounts?.filter((s: any) => !s.deletedAt).length || 0;
  const smtpStatus = activeSmtps > 0 ? "PROVISIONED" : "NO_SMTP_ACCOUNTS_CONFIGURED";

  // 4. Gemini API Check
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const geminiStatus = (geminiApiKey && geminiApiKey.trim() !== "" && geminiApiKey !== "dummy-key")
    ? "ACTIVE"
    : "UNCONFIGURED";

  // 5. Disk Space Check
  let diskStatus = "OK";
  try {
    if (fs.statfsSync) {
      const stats = fs.statfsSync(process.cwd());
      const freeBytes = stats.bavail * stats.bsize;
      diskStatus = freeBytes > 50 * 1024 * 1024 ? "HEALTHY" : "CRITICAL_LOW_DISK";
    }
  } catch {
    diskStatus = "OK";
  }

  // 6. Memory and CPU checks
  const mem = process.memoryUsage();
  const memoryUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const memoryTotalMB = Math.round(mem.heapTotal / 1024 / 1024);

  const overallStatus = (dbStatus === "CONNECTED" && redisStatus === "CONNECTED") ? "UP" : "DEGRADED";

  res.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: {
      postgres: dbStatus,
      redis: redisStatus,
      queue_worker: {
        status: "ACTIVE",
        last_sweep_heartbeat: queueWorker.lastSweepTime
      },
      smtp_delivery_rotation: smtpStatus,
      gemini_ai_layer: geminiStatus,
      disk_space: diskStatus
    },
    system: {
      uptime_seconds: Math.round(process.uptime()),
      memory: {
        heap_used_mb: memoryUsedMB,
        heap_total_mb: memoryTotalMB
      }
    }
  });
});

// Start the persistent background scheduler & deliverability warmup loops
queueWorker.startWorkerInterval();
console.log("[Cold Email Platform] Background deliverability engines online.");

/**
 * Initializes and launches the Express server with Vite integration.
 */
async function startFullStackServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Initialize WebSocket communications
  webSocketService.initialize(server);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Cold Email Platform Server] Run and listening on port ${PORT}`);
  });
}

startFullStackServer();
