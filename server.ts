/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Application entrypoint.
 *
 * Boot order:
 *   1. config          — validate env, refuse to start on missing critical vars
 *   2. requestContext   — install req-id + async-local logging context
 *   3. initDatabase()   — run migrations, seed default AI agents
 *   4. redis ping       — verify Redis is reachable
 *   5. Vite / static    — mount client
 *   6. WebSocket        — mount /ws
 *   7. BullMQ workers   — email-send + follow-up + legacy queue sweep
 *   8. app.listen()
 *
 * Shutdown (Phase 3.5):
 *   SIGTERM / SIGINT → stop accepting new HTTP → close BullMQ workers
 *   (drains in-flight jobs) → close Redis → close pg pool → exit(0).
 *   Hard-kill after 30s so orphan connections cannot linger.
 */

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import http from "http";
import { createServer as createViteServer } from "vite";
import pinoHttp from "pino-http";

import { config } from "./server/config";
import { rootLogger, log } from "./server/observability/logger";
import { requestContextMiddleware } from "./server/middleware/requestContext.middleware";
import { initDatabase, pool } from "./server/services/db.service";
import { redisService } from "./server/services/redis.service";
import apiRouter from "./server/routes/api.routes";
import { queueWorker } from "./server/workers/queue.worker";
import { webSocketService } from "./server/services/websocket.service";
import { queueRepository, campaignRepository, replyRepository, smtpRepository, auditRepository } from "./server/db/repositories";
import { SesEventsController } from "./server/controllers/sesEvents.controller";
import { TrackingController } from "./server/controllers/tracking.controller";
import { emailQueue, queueStats as bullmqQueueStats } from "./server/queues/emailQueue";
import { followUpQueue } from "./server/queues/followUpQueue";
import {
  sequenceTickQueue,
  sequenceAdvanceQueue,
  scheduleSequenceTick,
} from "./server/queues/sequenceTickQueue";

const app = express();
const server = http.createServer(app);

// ---------- Request context + structured HTTP logging (Phase 3.5) ----------

app.use(requestContextMiddleware);
app.use(
  pinoHttp({
    logger: rootLogger,
    autoLogging: {
      ignore: (req) =>
        req.url === "/health" ||
        !!(req.url && req.url.startsWith("/t/o/")) || // opens are noisy
        !!(req.url && req.url.startsWith("/@vite/")),
    },
    serializers: {
      req(req: any) {
        return { method: req.method, url: req.url, requestId: req.headers["x-request-id"] };
      },
    },
  })
);

// ---------- Special bodies (Stripe + SNS) BEFORE express.json ----------

app.use("/api/billing/webhook", express.raw({ type: "application/json" }), (req, _res, next) => {
  (req as any).rawBody = req.body;
  next();
});
app.post(
  "/api/ses/events",
  express.text({ type: "*/*", limit: "1mb" }),
  SesEventsController.handle.bind(SesEventsController)
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ---------- Public tracking + unsubscribe (email clients hit these) ----------
app.get("/t/o/:token", TrackingController.open.bind(TrackingController));
app.get("/t/c/:token", TrackingController.click.bind(TrackingController));
app.get("/unsubscribe/:token", TrackingController.unsubscribe.bind(TrackingController));
app.post("/unsubscribe/:token", TrackingController.unsubscribe.bind(TrackingController));

// ---------- API ----------
app.use("/api", apiRouter);
app.use("/api/v1", apiRouter);

// ---------- Observability ----------

let httpRequestsTotal = 0;
app.use((_req, _res, next) => { httpRequestsTotal++; next(); });

app.get("/metrics", async (_req: Request, res: Response) => {
  try {
    const stats = await queueRepository.stats();
    const bullmq = await bullmqQueueStats().catch(() => ({ waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 } as any));
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

# HELP platform_queue_pending Legacy queue: number of QUEUED items.
# TYPE platform_queue_pending gauge
platform_queue_pending ${stats.queued}

# HELP platform_queue_failed Legacy queue: number of FAILED items.
# TYPE platform_queue_failed gauge
platform_queue_failed ${stats.failed}

# HELP bullmq_email_send_waiting BullMQ email-send queue: waiting job count.
# TYPE bullmq_email_send_waiting gauge
bullmq_email_send_waiting ${bullmq.waiting ?? 0}

# HELP bullmq_email_send_active BullMQ email-send queue: active job count.
# TYPE bullmq_email_send_active gauge
bullmq_email_send_active ${bullmq.active ?? 0}

# HELP bullmq_email_send_delayed BullMQ email-send queue: scheduled/delayed count.
# TYPE bullmq_email_send_delayed gauge
bullmq_email_send_delayed ${bullmq.delayed ?? 0}

# HELP bullmq_email_send_failed BullMQ email-send queue: failed count.
# TYPE bullmq_email_send_failed gauge
bullmq_email_send_failed ${bullmq.failed ?? 0}

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
  services.stripe = config.stripeSecretKey ? "CONFIGURED" : "NOT_CONFIGURED";
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

/**
 * Worker-specific health: reports both BullMQ workers' state, queue depths,
 * and the last sweep time of the legacy interval worker. Useful for K8s
 * liveness / readiness probes.
 */
app.get("/health/workers", async (_req: Request, res: Response) => {
  const bullmqEmail = await emailQueue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "prioritized")
    .catch((e) => ({ error: e.message }));
  const bullmqFollowUp = await followUpQueue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "prioritized")
    .catch((e) => ({ error: e.message }));
  const bullmqTick = await sequenceTickQueue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "prioritized")
    .catch((e) => ({ error: e.message }));
  const bullmqAdvance = await sequenceAdvanceQueue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "prioritized")
    .catch((e) => ({ error: e.message }));
  const emailQueueReady = (bullmqEmail as any).error ? false : true;
  const followUpQueueReady = (bullmqFollowUp as any).error ? false : true;
  const tickQueueReady = (bullmqTick as any).error ? false : true;
  const advanceQueueReady = (bullmqAdvance as any).error ? false : true;
  const legacySweepAgeMs = Date.now() - new Date(queueWorker.lastSweepTime).getTime();

  const healthy = emailQueueReady && followUpQueueReady && tickQueueReady && advanceQueueReady && legacySweepAgeMs < 60_000;

  res.status(healthy ? 200 : 503).json({
    healthy,
    workers: {
      email_send: emailQueueReady ? "UP" : "DOWN",
      follow_up: followUpQueueReady ? "UP" : "DOWN",
      sequence_tick: tickQueueReady ? "UP" : "DOWN",
      sequence_advance: advanceQueueReady ? "UP" : "DOWN",
      legacy_sweep: legacySweepAgeMs < 60_000 ? "UP" : `STALE (${Math.round(legacySweepAgeMs/1000)}s)`,
    },
    email_queue: bullmqEmail,
    follow_up_queue: bullmqFollowUp,
    sequence_tick_queue: bullmqTick,
    sequence_advance_queue: bullmqAdvance,
  });
});

// Global error handler (last).
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  log.error({ err: err?.message || String(err), method: req.method, path: req.path }, "unhandled api error");
  auditRepository.log({
    action: `Unhandled error ${req.method} ${req.path}`,
    category: "ERROR",
    ipAddress: req.ip,
    details: err?.message || String(err),
  }).catch(() => {});
  if (res.headersSent) return;
  res.status(500).json({ success: false, error: "Internal server error." });
});

// ---------- Boot ----------

async function startFullStackServer(): Promise<void> {
  log.info({ nodeEnv: config.nodeEnv }, "boot start");
  await initDatabase();

  try {
    const p = await redisService.ping();
    log.info({ redis: p }, "boot: redis ok");
  } catch (err: any) {
    log.error({ err: err.message }, "boot: redis unreachable");
    throw err;
  }

  if (config.nodeEnv !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
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

  await import("./server/queues/emailSend.worker");
  await import("./server/queues/followUp.worker");
  await import("./server/queues/mailboxSync.worker");
  // Phase 5: sequence engine workers (tick + advance).
  await import("./server/queues/sequenceTickQueue");
  await scheduleSequenceTick();
  log.info("BullMQ workers registered (email-send, follow-up, mailbox-sync, sequence-tick, sequence-advance)");

  // Schedule a repeatable poll for every non-SES account so replies get
  // synced without a user having to hit /sync-now.
  try {
    const { emailAccountRepository } = await import("./server/db/repositories");
    const { scheduleAccountPoll } = await import("./server/queues/mailboxSyncQueue");
    const accounts = await emailAccountRepository.list();
    let scheduled = 0;
    for (const a of accounts) {
      if (a.provider === "ses" || !a.isActive || a.deletedAt) continue;
      await scheduleAccountPoll(a.id, a.workspaceId).catch((e) =>
        log.warn({ accountId: a.id, err: e?.message }, "scheduleAccountPoll failed")
      );
      scheduled++;
    }
    log.info({ scheduled }, "mailbox polls scheduled");
  } catch (err: any) {
    log.warn({ err: err.message }, "mailbox poll scheduling skipped");
  }

  server.listen(config.port, "0.0.0.0", () => {
    log.info({ port: config.port, url: `http://localhost:${config.port}` }, "server listening");
  });
}

// ---------- Graceful shutdown (C3) ----------

let shuttingDown = false;
async function gracefulShutdown(signal: string, timeoutMs = 30_000): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "graceful shutdown starting");

  const hardKill = setTimeout(() => {
    log.error({ timeoutMs }, "graceful shutdown timed out — force exiting");
    process.exit(1);
  }, timeoutMs).unref();

  try {
    // 1. Stop accepting new HTTP.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // In case there are no active sockets close resolves immediately;
      // otherwise Node keeps the callback pending till they drain.
    });
    log.info("http server closed");

    // 2. Drain BullMQ workers (Worker.close(true) waits for active jobs).
    try {
      const { emailSendWorker } = await import("./server/queues/emailSend.worker");
      await emailSendWorker.close();
      log.info("bullmq email-send worker drained");
    } catch (err: any) {
      log.warn({ err: err?.message }, "bullmq email-send worker close error");
    }
    try {
      const { followUpWorker } = await import("./server/queues/followUp.worker");
      await followUpWorker.close();
      log.info("bullmq follow-up worker drained");
    } catch (err: any) {
      log.warn({ err: err?.message }, "bullmq follow-up worker close error");
    }
    try {
      const { mailboxSyncWorker } = await import("./server/queues/mailboxSync.worker");
      await mailboxSyncWorker.close();
      log.info("bullmq mailbox-sync worker drained");
    } catch (err: any) {
      log.warn({ err: err?.message }, "bullmq mailbox-sync worker close error");
    }
    try {
      const { sequenceTickWorker, sequenceAdvanceWorker } = await import("./server/queues/sequenceTickQueue");
      await sequenceTickWorker.close();
      await sequenceAdvanceWorker.close();
      log.info("bullmq sequence-tick + sequence-advance workers drained");
    } catch (err: any) {
      log.warn({ err: err?.message }, "bullmq sequence workers close error");
    }

    // 3. Close BullMQ queues + shared redis + pg pool.
    try { await emailQueue.close(); } catch { /* ignore */ }
    try { await followUpQueue.close(); } catch { /* ignore */ }
    try { await sequenceTickQueue.close(); } catch { /* ignore */ }
    try { await sequenceAdvanceQueue.close(); } catch { /* ignore */ }
    try { await (redisService.getClient() as any).quit(); } catch { /* ignore */ }
    try { await pool.end(); } catch { /* ignore */ }

    clearTimeout(hardKill);
    log.info("graceful shutdown complete");
    process.exit(0);
  } catch (err: any) {
    log.error({ err: err.message }, "graceful shutdown error");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => void gracefulShutdown("SIGINT"));

// Keep the server alive if an async route handler rejects without next(err).
process.on("unhandledRejection", (reason: any) => {
  log.error({ err: reason?.message || String(reason) }, "unhandledRejection");
});
process.on("uncaughtException", (err: Error) => {
  log.error({ err: err.message, stack: err.stack }, "uncaughtException");
});

startFullStackServer().catch((err) => {
  log.fatal({ err: err?.message || err }, "boot fatal");
  process.exit(1);
});
