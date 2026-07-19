/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single shared Postgres connection pool.
 * All repositories acquire clients from this pool.
 *
 * SSL:
 *   The pool's `ssl` option is resolved dynamically by `sslMode.ts` from
 *   the URL + env. Never hardcode SSL here — a laptop, a Docker Compose
 *   sidecar, and RDS all need different behaviour and the resolver picks
 *   the right one automatically.
 *
 * Docker rewrite guard:
 *   If we detect this process is running inside Docker AND the resolved
 *   DATABASE_URL points at localhost / 127.0.0.1, we rewrite the host to
 *   the compose service name (`postgres`) — since a container's
 *   `localhost` is itself, never the host machine. This is a defence-in-
 *   depth safety net: docker-compose.yml already substitutes a
 *   container-scoped URL, but if someone bind-mounts a stale `.env` into
 *   the container we still recover.
 */

import fs from "fs";
import pg from "pg";
import { config } from "../config";
import { resolveSslConfig } from "./sslMode";

// --- Docker detection --------------------------------------------------------
// The kernel drops a `/.dockerenv` marker in every Docker container.
// Kubernetes / containerd also set /.dockerenv or /run/.containerenv.
function detectContainerRuntime(): boolean {
  if (process.env.RUNNING_IN_DOCKER === "true" || process.env.RUNNING_IN_DOCKER === "1") return true;
  try {
    if (fs.existsSync("/.dockerenv")) return true;
    if (fs.existsSync("/run/.containerenv")) return true;
    if (process.platform === "linux") {
      const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
      if (/docker|containerd|kubepods|podman/.test(cgroup)) return true;
    }
  } catch {
    /* not linux / permission denied — assume not in a container */
  }
  return false;
}

const IS_CONTAINER = detectContainerRuntime();
const COMPOSE_PG_HOSTNAME = process.env.COMPOSE_PG_HOSTNAME || "postgres";

function rewriteLocalhostForDocker(rawUrl: string): { url: string; rewritten: boolean } {
  if (!IS_CONTAINER) return { url: rawUrl, rewritten: false };
  try {
    const u = new URL(rawUrl);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1") {
      u.hostname = COMPOSE_PG_HOSTNAME;
      return { url: u.toString(), rewritten: true };
    }
  } catch {
    // Malformed URL — hand off to pg which will surface its own error.
  }
  return { url: rawUrl, rewritten: false };
}

const { url: effectiveDatabaseUrl, rewritten } = rewriteLocalhostForDocker(config.databaseUrl);
const sslResolution = resolveSslConfig(effectiveDatabaseUrl);

if (rewritten) {
  const safe = effectiveDatabaseUrl.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@");
  console.warn(
    `[db.pool] container runtime detected — rewrote DATABASE_URL localhost → ${COMPOSE_PG_HOSTNAME}: ${safe}`
  );
}

console.log(
  `[db.pool] ssl=${sslResolution.ssl === false ? "disabled" : "enabled"} (${sslResolution.reason})`
);

export const pool = new pg.Pool({
  connectionString: effectiveDatabaseUrl,
  ssl: sslResolution.ssl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("[db.pool] idle client error:", err.message);
});

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDatabase(): Promise<boolean> {
  const r = await pool.query("SELECT 1 AS ok");
  return r.rows[0]?.ok === 1;
}
