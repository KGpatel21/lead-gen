/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Idempotent schema migrations.
 *
 * Runs on boot. Safe to re-run.
 * When schema needs a real migration tool (versioning, down-migrations,
 * per-tenant rollout), swap to node-pg-migrate or Drizzle without changing
 * repository call sites — they don't depend on this file.
 */

import { withTransaction } from "./pool";

const STATEMENTS: string[] = [
  // ---- users ----
  `CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR PRIMARY KEY,
    name          VARCHAR NOT NULL,
    email         VARCHAR NOT NULL,
    role          VARCHAR NOT NULL,
    password_hash VARCHAR NOT NULL,
    password_salt VARCHAR NOT NULL,
    subscription_plan   VARCHAR,
    subscription_status VARCHAR,
    stripe_customer_id     VARCHAR,
    stripe_subscription_id VARCHAR,
    subscription_period_end BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_active
     ON users (LOWER(email)) WHERE deleted_at IS NULL`,

  // ---- team_members ----
  `CREATE TABLE IF NOT EXISTS team_members (
    id         VARCHAR PRIMARY KEY,
    name       VARCHAR NOT NULL,
    email      VARCHAR NOT NULL,
    role       VARCHAR NOT NULL,
    status     VARCHAR NOT NULL,
    invite_token VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_email_active
     ON team_members (LOWER(email)) WHERE deleted_at IS NULL`,

  // ---- campaigns ----
  `CREATE TABLE IF NOT EXISTS campaigns (
    id                   VARCHAR PRIMARY KEY,
    name                 VARCHAR NOT NULL,
    status               VARCHAR NOT NULL,
    sent_count           INTEGER NOT NULL DEFAULT 0,
    open_count           INTEGER NOT NULL DEFAULT 0,
    reply_count          INTEGER NOT NULL DEFAULT 0,
    bounce_count         INTEGER NOT NULL DEFAULT 0,
    unsub_count          INTEGER NOT NULL DEFAULT 0,
    schedule_days        JSONB NOT NULL DEFAULT '[]'::jsonb,
    schedule_time_start  VARCHAR NOT NULL DEFAULT '09:00',
    schedule_time_end    VARCHAR NOT NULL DEFAULT '17:00',
    timezone             VARCHAR NOT NULL DEFAULT 'America/New_York',
    subject_template     TEXT NOT NULL DEFAULT '',
    body_template        TEXT NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at           TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_name_active
     ON campaigns (LOWER(name)) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status)`,

  // ---- leads ----
  `CREATE TABLE IF NOT EXISTS leads (
    id                   VARCHAR PRIMARY KEY,
    campaign_id          VARCHAR REFERENCES campaigns(id) ON DELETE SET NULL,
    email                VARCHAR NOT NULL,
    first_name           VARCHAR,
    last_name            VARCHAR,
    company              VARCHAR,
    personalized_line    TEXT,
    status               VARCHAR NOT NULL,
    crm_stage            VARCHAR,
    phone                VARCHAR,
    platform             VARCHAR,
    profile_url          VARCHAR,
    description_meta     TEXT,
    proposed_service     TEXT,
    error_message        TEXT,
    website              VARCHAR,
    business_description TEXT,
    google_reviews       JSONB,
    services             JSONB,
    social_links         JSONB,
    business_hours       VARCHAR,
    booking_links        VARCHAR,
    latest_posts         JSONB,
    technologies         JSONB,
    industry             VARCHAR,
    employees            VARCHAR,
    company_summary      TEXT,
    ai_research          JSONB,
    ai_emails            JSONB,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at           TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads (campaign_id) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads (status)      WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_email_per_campaign
     ON leads (campaign_id, LOWER(email)) WHERE deleted_at IS NULL`,

  // ---- smtp_accounts ----
  `CREATE TABLE IF NOT EXISTS smtp_accounts (
    id                  VARCHAR PRIMARY KEY,
    email               VARCHAR NOT NULL,
    username            VARCHAR NOT NULL,
    smtp_host           VARCHAR NOT NULL,
    smtp_port           INTEGER NOT NULL,
    smtp_password       TEXT NOT NULL DEFAULT '',
    daily_limit         INTEGER NOT NULL DEFAULT 50,
    sent_today          INTEGER NOT NULL DEFAULT 0,
    warmup_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    warmup_daily_limit  INTEGER NOT NULL DEFAULT 15,
    warmup_sent_today   INTEGER NOT NULL DEFAULT 0,
    warmup_phase        VARCHAR,
    reputation_score    INTEGER NOT NULL DEFAULT 100,
    spam_risk           VARCHAR NOT NULL DEFAULT 'LOW',
    error_message       TEXT,
    provider            VARCHAR,
    provider_account_id VARCHAR,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_smtp_email_active
     ON smtp_accounts (LOWER(email)) WHERE deleted_at IS NULL`,

  // ---- domains ----
  `CREATE TABLE IF NOT EXISTS domains (
    id                VARCHAR PRIMARY KEY,
    name              VARCHAR NOT NULL,
    spf_status        VARCHAR NOT NULL DEFAULT 'PENDING',
    dkim_status       VARCHAR NOT NULL DEFAULT 'PENDING',
    dmarc_status      VARCHAR NOT NULL DEFAULT 'PENDING',
    health_score      INTEGER NOT NULL DEFAULT 0,
    blacklist_status  VARCHAR NOT NULL DEFAULT 'CLEAN',
    last_verified_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_domains_name_active
     ON domains (LOWER(name)) WHERE deleted_at IS NULL`,

  // ---- templates ----
  `CREATE TABLE IF NOT EXISTS templates (
    id         VARCHAR PRIMARY KEY,
    name       VARCHAR NOT NULL,
    subject    TEXT NOT NULL,
    body       TEXT NOT NULL,
    category   VARCHAR NOT NULL DEFAULT 'General',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
  )`,

  // ---- replies ----
  `CREATE TABLE IF NOT EXISTS replies (
    id             VARCHAR PRIMARY KEY,
    campaign_id    VARCHAR REFERENCES campaigns(id) ON DELETE SET NULL,
    lead_id        VARCHAR REFERENCES leads(id)     ON DELETE SET NULL,
    from_email     VARCHAR NOT NULL,
    subject        TEXT NOT NULL,
    body_text      TEXT NOT NULL,
    sentiment      VARCHAR NOT NULL,
    is_read        BOOLEAN NOT NULL DEFAULT FALSE,
    ai_suggested_reply TEXT,
    received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_replies_campaign ON replies (campaign_id) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_replies_received ON replies (received_at DESC) WHERE deleted_at IS NULL`,

  // ---- queue (mail dispatch queue) ----
  `CREATE TABLE IF NOT EXISTS queue (
    id             VARCHAR PRIMARY KEY,
    campaign_id    VARCHAR REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id        VARCHAR REFERENCES leads(id)     ON DELETE CASCADE,
    to_email       VARCHAR NOT NULL,
    subject        TEXT NOT NULL,
    body           TEXT NOT NULL,
    scheduled_at   TIMESTAMPTZ NOT NULL,
    status         VARCHAR NOT NULL,
    attempts       INTEGER NOT NULL DEFAULT 0,
    priority       INTEGER NOT NULL DEFAULT 2,
    error_message  TEXT,
    last_attempt   TIMESTAMPTZ,
    smtp_account_id VARCHAR,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_queue_campaign  ON queue (campaign_id)`,
  `CREATE INDEX IF NOT EXISTS idx_queue_status    ON queue (status)`,
  `CREATE INDEX IF NOT EXISTS idx_queue_scheduled ON queue (scheduled_at)
     WHERE status IN ('QUEUED','FAILED')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_lead_active
     ON queue (lead_id) WHERE status IN ('QUEUED','PENDING','SENT')`,

  // ---- audit_logs ----
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id         VARCHAR PRIMARY KEY,
    timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id    VARCHAR,
    user_email VARCHAR,
    action     VARCHAR NOT NULL,
    category   VARCHAR NOT NULL,
    ip_address VARCHAR,
    details    TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs (timestamp DESC)`,

  // ---- agents (metadata + counters) ----
  `CREATE TABLE IF NOT EXISTS agents (
    id             VARCHAR PRIMARY KEY,
    name           VARCHAR NOT NULL,
    role           VARCHAR NOT NULL,
    description    TEXT NOT NULL,
    system_prompt  TEXT NOT NULL,
    model          VARCHAR NOT NULL DEFAULT 'gemini-2.5-flash-lite',
    status         VARCHAR NOT NULL DEFAULT 'IDLE',
    task_count     INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ---- agent_logs ----
  `CREATE TABLE IF NOT EXISTS agent_logs (
    id         VARCHAR PRIMARY KEY,
    agent_id   VARCHAR NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    input      TEXT NOT NULL,
    output     TEXT NOT NULL,
    status     VARCHAR NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_ts
     ON agent_logs (agent_id, timestamp DESC)`,

  // ---- entity_history (soft audit trail for admin diffs) ----
  `CREATE TABLE IF NOT EXISTS entity_history (
    id              VARCHAR PRIMARY KEY,
    entity_id       VARCHAR NOT NULL,
    entity_type     VARCHAR NOT NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by      VARCHAR NOT NULL,
    previous_state  JSONB NOT NULL,
    new_state       JSONB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_history_entity ON entity_history (entity_id, changed_at DESC)`,
];

export async function runMigrations(): Promise<void> {
  await withTransaction(async (client) => {
    for (const stmt of STATEMENTS) {
      await client.query(stmt);
    }
  });
  console.log(`[db.migrations] applied ${STATEMENTS.length} DDL statements`);
}
