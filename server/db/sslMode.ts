/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Environment-aware Postgres SSL resolver.
 *
 * The pg driver's `ssl` option is the source of TLS behaviour for every
 * connection. Historically we hardcoded `ssl: isLocal ? false : {…}`
 * which broke as soon as the connection string used a non-localhost
 * hostname pointing at an in-cluster / Docker-Compose service — pg
 * would open TLS, the container Postgres would reply "the server does
 * not support SSL connections", and boot would fail.
 *
 * Precedence rules (highest wins). This ORDER matters — it deliberately
 * puts hostname classification ABOVE environment overrides so a
 * PGSSLMODE=require inherited from the shell, an EC2 user-data script,
 * or a systemd unit CANNOT force TLS against a `postgres:5432` service
 * that fundamentally can't negotiate it:
 *
 *   1. Explicit *disable* wins unconditionally.
 *        DATABASE_SSL=false|disable|off|0|no          → plain TCP.
 *        sslmode=disable in the URL                    → plain TCP.
 *
 *   2. Private / in-cluster hostname → plain TCP.
 *        localhost, 127.0.0.1, ::1, RFC1918 blocks,
 *        Docker service aliases (postgres, postgresql, pg, db,
 *          database, postgres-<anything>),
 *        `.local`, `.internal`, `.lan`,
 *        `.svc(.cluster.local)` (Kubernetes DNS).
 *      EXCEPTION: if the URL itself explicitly says
 *        sslmode=require|verify-ca|verify-full, we honor it so operators
 *        running a private TLS-terminated Postgres can opt in.
 *
 *   3. Known managed-Postgres hostname → SSL enabled.
 *        AWS RDS, Neon, Railway, Supabase, Render, Azure PG,
 *        Cloud SQL, Digital Ocean, Aiven, CockroachDB Cloud,
 *        Timescale, Crunchy Bridge, Fly.io, Scaleway, ElephantSQL.
 *
 *   4. URL `sslmode=…` (anything other than disable) → SSL enabled.
 *
 *   5. DATABASE_SSL / PGSSLMODE env explicitly on → SSL enabled.
 *
 *   6. Fallback: plain TCP. The correct default for unknown hosts on
 *      a private network. Cloud providers already match rule 3;
 *      corporate proxies can flip via DATABASE_SSL=true.
 *
 * `rejectUnauthorized: false` is the default when SSL is enabled — RDS,
 * Neon, and friends present certs signed by internal CAs that Node's
 * bundled trust store doesn't cover. Anyone who wants full validation
 * sets DATABASE_SSL_CA=/path/to/ca.pem and the resolver switches to
 * `rejectUnauthorized: true` with the CA loaded.
 */

import fs from "fs";

export type SslConfig = false | { rejectUnauthorized: boolean; ca?: string };

export interface SslResolution {
  ssl: SslConfig;
  reason: string;
  host: string | null;
}

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^::1$/,
  /^0\.0\.0\.0$/,
  // Docker Compose default service names for this project + common aliases.
  /^postgres$/i,
  /^postgresql$/i,
  /^pg$/i,
  /^db$/i,
  /^database$/i,
  /^postgres-\w+$/i,
  // RFC1918 private ranges.
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  // Link-local + resolver-local suffixes.
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  // Kubernetes in-cluster service DNS.
  /\.svc(\.cluster\.local)?$/i,
  /\.cluster\.local$/i,
];

const CLOUD_HOST_PATTERNS: RegExp[] = [
  // AWS RDS + Aurora
  /\.rds\.amazonaws\.com$/i,
  /\.cluster-.*\.rds\.amazonaws\.com$/i,
  // Neon
  /\.neon\.tech$/i,
  /\.neon\.build$/i,
  /-pooler\..*\.neon\.tech$/i,
  // Railway
  /\.railway\.app$/i,
  /\.up\.railway\.app$/i,
  // Supabase
  /\.supabase\.co$/i,
  /\.supabase\.com$/i,
  /\.pooler\.supabase\.com$/i,
  // Render
  /\.render\.com$/i,
  /-postgres\.render\.com$/i,
  // Azure Database for PostgreSQL
  /\.postgres\.database\.azure\.com$/i,
  /\.database\.azure\.com$/i,
  // Google Cloud SQL public endpoint
  /\.cloudsql\.goog$/i,
  // Digital Ocean managed
  /\.ondigitalocean\.com$/i,
  /\.db\.ondigitalocean\.com$/i,
  // Aiven
  /\.aivencloud\.com$/i,
  // CockroachDB Cloud (Postgres wire-compatible)
  /\.cockroachlabs\.cloud$/i,
  // TimescaleDB Cloud
  /\.timescale\.com$/i,
  /\.tsdb\.cloud\.timescale\.com$/i,
  // Crunchy Bridge
  /\.crunchybridge\.com$/i,
  // ElephantSQL
  /\.elephantsql\.com$/i,
  // Heroku Postgres
  /\.compute-1\.amazonaws\.com$/i,
  /\.compute\.amazonaws\.com$/i,
  // Fly.io
  /\.fly\.dev$/i,
  // Scaleway Managed
  /\.scw\.cloud$/i,
];

const EXPLICIT_OFF = new Set(["false", "0", "disable", "off", "no"]);
const EXPLICIT_ON  = new Set(["true", "1", "require", "verify-ca", "verify-full", "prefer", "allow", "on", "yes"]);

export function parseHostFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname || null;
  } catch {
    return null;
  }
}

export function isPrivateHost(host: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

export function isCloudHost(host: string): boolean {
  return CLOUD_HOST_PATTERNS.some((re) => re.test(host));
}

function buildSslConfig(): { rejectUnauthorized: boolean; ca?: string } {
  const caPath = process.env.DATABASE_SSL_CA;
  if (caPath && fs.existsSync(caPath)) {
    try {
      const ca = fs.readFileSync(caPath, "utf8");
      return { rejectUnauthorized: true, ca };
    } catch {
      // fall through
    }
  }
  return { rejectUnauthorized: false };
}

interface UrlHints {
  sslModeLower: string | null;
}
function urlHints(url: string): UrlHints {
  try {
    const u = new URL(url);
    const raw = (u.searchParams.get("sslmode") ?? "").trim().toLowerCase();
    return { sslModeLower: raw || null };
  } catch {
    return { sslModeLower: null };
  }
}

function envHint(): { setting: "on" | "off" | null; source: string } {
  const rawDatabaseSsl = (process.env.DATABASE_SSL ?? "").trim().toLowerCase();
  if (rawDatabaseSsl) {
    if (EXPLICIT_OFF.has(rawDatabaseSsl)) return { setting: "off", source: `DATABASE_SSL="${rawDatabaseSsl}"` };
    if (EXPLICIT_ON.has(rawDatabaseSsl))  return { setting: "on",  source: `DATABASE_SSL="${rawDatabaseSsl}"` };
  }
  const rawPgssl = (process.env.PGSSLMODE ?? "").trim().toLowerCase();
  if (rawPgssl) {
    if (EXPLICIT_OFF.has(rawPgssl)) return { setting: "off", source: `PGSSLMODE="${rawPgssl}"` };
    if (EXPLICIT_ON.has(rawPgssl))  return { setting: "on",  source: `PGSSLMODE="${rawPgssl}"` };
  }
  return { setting: null, source: "" };
}

/**
 * Resolve the SSL config for a given DATABASE_URL.
 * Pure function: no I/O other than reading the optional DATABASE_SSL_CA
 * file. Safe to call at boot.
 */
export function resolveSslConfig(databaseUrl: string): SslResolution {
  const host = parseHostFromUrl(databaseUrl);
  const url = urlHints(databaseUrl);
  const env = envHint();

  // ---- 1. Explicit disable wins unconditionally --------------------------
  if (url.sslModeLower === "disable") {
    return { ssl: false, reason: `sslmode=disable in DATABASE_URL`, host };
  }
  if (env.setting === "off") {
    return { ssl: false, reason: env.source, host };
  }

  // ---- 2. Private / in-cluster hostname authoritative --------------------
  //  This is the FIX for the EC2 symptom: any container-Postgres URL wins
  //  over inherited PGSSLMODE=require. The only way to opt back into SSL
  //  for a private host is to put ?sslmode=require directly on the URL.
  if (host && isPrivateHost(host)) {
    if (url.sslModeLower && url.sslModeLower !== "disable") {
      return { ssl: buildSslConfig(), reason: `private host "${host}" but sslmode=${url.sslModeLower} in URL forces SSL`, host };
    }
    return { ssl: false, reason: `private / in-cluster host "${host}" — SSL never negotiated`, host };
  }

  // ---- 3. Known managed-Postgres hostname → SSL --------------------------
  if (host && isCloudHost(host)) {
    return { ssl: buildSslConfig(), reason: `managed-Postgres host "${host}"`, host };
  }

  // ---- 4. URL sslmode= (anything other than disable) → SSL ---------------
  if (url.sslModeLower && url.sslModeLower !== "disable") {
    return { ssl: buildSslConfig(), reason: `sslmode=${url.sslModeLower} in DATABASE_URL`, host };
  }

  // ---- 5. Explicit "on" env → SSL ---------------------------------------
  if (env.setting === "on") {
    return { ssl: buildSslConfig(), reason: env.source, host };
  }

  // ---- 6. Fallback: plain TCP -------------------------------------------
  if (!host) {
    return { ssl: false, reason: "could not parse hostname from DATABASE_URL — defaulting to plain TCP", host: null };
  }
  return { ssl: false, reason: `unknown host "${host}" — defaulting to plain TCP (set DATABASE_SSL=true to force SSL)`, host };
}
