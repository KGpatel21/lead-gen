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
 * The rules encoded here (highest-precedence first):
 *
 *   1. Explicit env var wins.
 *        DATABASE_SSL=true|1|require  → force SSL (rejectUnauthorized=false).
 *        DATABASE_SSL=false|0|disable → force plain TCP.
 *        (Also honors the standard `PGSSLMODE`.)
 *
 *   2. `sslmode=` query param on the URL wins next.
 *        sslmode=disable                                 → plain TCP.
 *        sslmode=require|verify-ca|verify-full|prefer    → SSL.
 *
 *   3. Hostname pattern.
 *        Private / in-cluster hostnames  (localhost, 127.0.0.1, RFC1918
 *        blocks, Docker/K8s service names, `.local`, `.internal`,
 *        `.svc.cluster.local`)                            → plain TCP.
 *        Known managed-Postgres suffixes (AWS RDS, Neon, Railway,
 *        Supabase, Render, Azure, Aiven, Digital Ocean, Timescale,
 *        Crunchy Bridge, CockroachDB Cloud, Heroku, …)   → SSL.
 *
 *   4. Fallback for anything we can't classify: plain TCP. The safe
 *      choice for an unknown host inside a private network — cloud
 *      providers already match rule 3, and an operator behind a
 *      corporate proxy can always set DATABASE_SSL=true.
 *
 * `rejectUnauthorized: false` is deliberate for cloud PG: RDS/Neon/etc.
 * present certs signed by internal CAs the pg client doesn't ship a
 * trust bundle for. Anyone needing full validation can set
 * `DATABASE_SSL_CA=/path/to/ca.pem` — the resolver switches to
 * `rejectUnauthorized: true` and loads the CA.
 */

import fs from "fs";

export type SslConfig = false | { rejectUnauthorized: boolean; ca?: string };

export interface SslResolution {
  ssl: SslConfig;
  reason: string;
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
  // Neon (all serverless projects; also the pooler subdomain)
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
  // Azure Database for PostgreSQL (single server + flexible server)
  /\.postgres\.database\.azure\.com$/i,
  /\.database\.azure\.com$/i,
  // Google Cloud SQL public endpoint
  /\.cloudsql\.goog$/i,
  // Digital Ocean managed
  /\.ondigitalocean\.com$/i,
  /\.db\.ondigitalocean\.com$/i,
  // Aiven
  /\.aivencloud\.com$/i,
  // CockroachDB Cloud (Postgres-compatible)
  /\.cockroachlabs\.cloud$/i,
  // TimescaleDB Cloud
  /\.timescale\.com$/i,
  /\.tsdb\.cloud\.timescale\.com$/i,
  // Crunchy Bridge
  /\.crunchybridge\.com$/i,
  // ElephantSQL (legacy — RIP but still around)
  /\.elephantsql\.com$/i,
  // Heroku Postgres
  /\.compute-1\.amazonaws\.com$/i,     // Heroku PG hostnames
  /\.compute\.amazonaws\.com$/i,
  // Fly.io
  /\.fly\.dev$/i,
  // Scaleway Managed
  /\.scw\.cloud$/i,
];

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

function envSslOverride(): SslResolution | null {
  const raw = (process.env.DATABASE_SSL ?? process.env.PGSSLMODE ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["false", "0", "disable", "off", "no"].includes(raw)) {
    return { ssl: false, reason: `DATABASE_SSL/PGSSLMODE="${raw}"` };
  }
  if (["true", "1", "require", "verify-ca", "verify-full", "prefer", "allow", "on", "yes"].includes(raw)) {
    return { ssl: buildSslConfig(), reason: `DATABASE_SSL/PGSSLMODE="${raw}"` };
  }
  return null;
}

function urlSslMode(url: string): SslResolution | null {
  try {
    const u = new URL(url);
    const raw = (u.searchParams.get("sslmode") ?? "").trim().toLowerCase();
    if (!raw) return null;
    if (raw === "disable") return { ssl: false, reason: `sslmode=disable in URL` };
    if (["require", "verify-ca", "verify-full", "prefer", "allow"].includes(raw)) {
      return { ssl: buildSslConfig(), reason: `sslmode=${raw} in URL` };
    }
    return null;
  } catch {
    return null;
  }
}

function buildSslConfig(): { rejectUnauthorized: boolean; ca?: string } {
  const caPath = process.env.DATABASE_SSL_CA;
  if (caPath && fs.existsSync(caPath)) {
    try {
      const ca = fs.readFileSync(caPath, "utf8");
      return { rejectUnauthorized: true, ca };
    } catch {
      // fall through to permissive TLS
    }
  }
  return { rejectUnauthorized: false };
}

/**
 * Resolve the SSL config for a given DATABASE_URL.
 * Pure function: no I/O other than reading the optional DATABASE_SSL_CA
 * file. Safe to call at boot.
 */
export function resolveSslConfig(databaseUrl: string): SslResolution {
  // 1. env var override wins.
  const envOverride = envSslOverride();
  if (envOverride) return envOverride;

  // 2. URL sslmode= param wins next.
  const urlOverride = urlSslMode(databaseUrl);
  if (urlOverride) return urlOverride;

  // 3. Hostname classification.
  const host = parseHostFromUrl(databaseUrl);
  if (!host) {
    return { ssl: false, reason: "could not parse hostname from DATABASE_URL — defaulting to plain TCP" };
  }
  if (isPrivateHost(host)) {
    return { ssl: false, reason: `private / in-cluster host "${host}"` };
  }
  if (isCloudHost(host)) {
    return { ssl: buildSslConfig(), reason: `managed-Postgres host "${host}"` };
  }

  // 4. Unknown public host → err on the side of no TLS. Operator can flip
  //    via DATABASE_SSL=true. This is the correct default for private
  //    networks / VPC-peered clusters where the DB is reachable by
  //    hostname but does not offer TLS.
  return { ssl: false, reason: `unknown host "${host}" — defaulting to plain TCP (set DATABASE_SSL=true to force SSL)` };
}
