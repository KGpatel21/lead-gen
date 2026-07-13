/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single shared Postgres connection pool.
 * All repositories acquire clients from this pool.
 */

import pg from "pg";
import { config } from "../config";

const isLocal =
  config.databaseUrl.includes("localhost") ||
  config.databaseUrl.includes("127.0.0.1");

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
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
