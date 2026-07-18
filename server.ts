/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Application entrypoint.
 *
 * Boot order:
 *   1. config           — validate env, refuse to start on missing critical vars
 *   2. initDatabase()   — run migrations, seed default AI agents
 *   3. redis ping       — verify Redis is reachable
 *   4. Vite / static    — mount client
 *   5. WebSocket        — mount /ws
 *   6. queue worker     — start background sweep loop
 *   7. app.listen()
 */

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import http from "http";
import { createServer as createViteServer } from "vite";

import { config } from "./server/config";
import { initDatabase, pool } from "./server/services/db.service";
import { redisService } from "./server/services/redis.service";
import apiRouter from "./server/routes/api.routes";
import { queueWorker } from "./server/workers/queue.worker";
import { webSocketService } from "./server/services/websocket.service";
import { queueRepository, campaignRepository, replyRepository, smtpRepository, auditRepository } from "./server/db/repositories";

const app = express();
const server = http.createServer(app);

// Raw body capture for Stripe webhook signature verification
app.use("/api/billing/webhook", express.raw({ type: "application/json" }), (req, _res, next) => {
  (req as any).rawBody = req.body;
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", apiRouter);
app.use("/api/v1", apiRouter);

// ---------- Observability ----------

let httpRequestsTotal = 0;
app.use((_req, _res, next) => {
  httpRequestsTotal++;
  next();
});

app.get("/metrics", async (_req: Request, res: Response) => {
  try {
    const stats = await queueRepository.stats();
    const campaigns = await campaignRepository.list();
    const sentCount = campaigns.reduce((s, c) => s + c.sentCount, 0);
    const replies = (await replyRepository.list()).length;
    const activeSmtps = (await smtpRepository.list()).length;
    const mem = process.memoryUsage();

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(
`# HELP http_requests_total Total HTTP requests handled since process start.
# TYPE http_requests_total counter
http_requests_total ${httpRequestsTotal}

# HELP platform_campaign_emails_sent_total Total campaign emails sent (all-time).
# TYPE platform_campaign_emails_sent_total counter
platform_campaign_emails_sent_total ${sentCount}

# HELP platform_incoming_replies_total Total inbound replies recorded.
# TYPE platform_incoming_replies_total counter
platform_incoming_replies_total ${replies}

# HELP platform_queue_pending Number of QUEUED items in the dispatch queue.
# TYPE platform_queue_pending gauge
platform_queue_pending ${stats.queued}

# HELP platform_queue_pending_active Number of items currently PENDING dispatch.
# TYPE platform_queue_pending_active gauge
platform_queue_pending_active ${stats.pending}

# HELP platform_queue_failed Number of FAILED items in the dispatch queue.
# TYPE platform_queue_failed gauge
platform_queue_failed ${stats.failed}

# HELP platform_smtp_accounts_active Number of active SMTP accounts.
# TYPE platform_smtp_accounts_active gauge
platform_smtp_accounts_active ${activeSmtps}

# HELP node_memory_heap_used_bytes Node.js heap used in bytes.
# TYPE node_memory_heap_used_bytes gauge
node_memory_heap_used_bytes ${mem.heapUsed}

# HELP node_process_uptime_seconds Uptime of the Node.js process in seconds.
# TYPE node_process_uptime_seconds gauge
node_process_uptime_seconds ${process.uptime()}
`
    );
  } catch (err: any) {
    res.status(500).send(`# metrics error: ${err.message}`);
  }
});

app.get("/health", async (_req: Request, res: Response) => {
  const services: Record<string, string> = {};

  try {
    const r = await pool.query("SELECT 1 AS ok");
    services.postgres = r.rows[0]?.ok === 1 ? "CONNECTED" : "DEGRADED";
  } catch (err: any) {
    services.postgres = `ERROR: ${err.message}`;
  }

  try {
    const p = await redisService.ping();
    services.redis = p === "PONG" ? "CONNECTED" : "DEGRADED";
  } catch (err: any) {
    services.redis = `ERROR: ${err.message}`;
  }

  const smtps = await smtpRepository.list().catch(() => []);
  services.smtp = smtps.length > 0 ? `PROVISIONED (${smtps.length})` : "NO_SMTP_ACCOUNTS";

  {
    const { getAIProvider } = await import("./server/ai/factory");
    const p = getAIProvider();
    services.ai_provider = `${p.name}:${p.model} (${p.isConfigured() ? "CONFIGURED" : "NOT_CONFIGURED"})`;
  }
  services.stripe   = config.stripeSecretKey ? "CONFIGURED" : "NOT_CONFIGURED";

  services.queue_worker = `ACTIVE (last sweep: ${queueWorker.lastSweepTime})`;

  const mem = process.memoryUsage();
  const overall =
    services.postgres === "CONNECTED" && services.redis === "CONNECTED" ? "UP" : "DEGRADED";

  res.status(overall === "UP" ? 200 : 503).json({
    status: overall,
    timestamp: new Date().toISOString(),
    services,
    system: {
      uptime_seconds: Math.round(process.uptime()),
      memory_mb: {
        heap_used: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total: Math.round(mem.heapTotal / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
      },
      node_env: config.nodeEnv,
    },
  });
});

// Global error handler (last).
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[api-error] ${req.method} ${req.path}`, err?.message || err);
  auditRepository.log({
    action: `Unhandled error ${req.method} ${req.path}`,
    category: "ERROR",
    ipAddress: req.ip,
    details: err?.message || String(err),
  }).catch(() => {});
  if (res.headersSent) return;
  res.status(500).json({ success: false, error: "Internal server error." });
});

async function startFullStackServer(): Promise<void> {
  console.log(`[boot] NODE_ENV=${config.nodeEnv}`);
  await initDatabase();

  // Prove Redis is reachable during boot; the app is unusable without it.
  try {
    const p = await redisService.ping();
    console.log(`[boot] redis ping: ${p}`);
  } catch (err: any) {
    console.error(`[boot] Redis unreachable: ${err.message}`);
    throw err;
  }

  if (config.nodeEnv !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  webSocketService.initialize(server);
  queueWorker.startWorkerInterval();

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`[boot] server listening on http://localhost:${config.port}`);
    console.log(`[boot] health: http://localhost:${config.port}/health`);
  });
}

// Keep the server alive if an async route handler rejects without next(err).
// Express 4 doesn't auto-forward async rejections; without this the whole
// process would die on a single flaky DB call. Log and keep serving.
process.on("unhandledRejection", (reason: any) => {
  console.error("[unhandledRejection]", reason?.message || reason);
});
process.on("uncaughtException", (err: Error) => {
  console.error("[uncaughtException]", err.message);
});

startFullStackServer().catch((err) => {
  console.error("[boot] fatal:", err?.message || err);
  process.exit(1);
});
