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

  // ---- Lead-discovery pipeline tables ----

  // Businesses discovered from Google Places (unique by place_id)
  `CREATE TABLE IF NOT EXISTS businesses (
    id                    VARCHAR PRIMARY KEY,
    place_id              VARCHAR UNIQUE NOT NULL,
    name                  VARCHAR NOT NULL,
    address               VARCHAR,
    latitude              DOUBLE PRECISION,
    longitude             DOUBLE PRECISION,
    phone                 VARCHAR,
    website               VARCHAR,
    google_maps_url       VARCHAR,
    google_rating         REAL,
    google_reviews_count  INTEGER,
    business_category     VARCHAR,
    business_types        JSONB,
    business_status       VARCHAR,
    source_query          TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_businesses_source_query ON businesses (source_query)`,
  `CREATE INDEX IF NOT EXISTS idx_businesses_has_website ON businesses ((website IS NOT NULL))`,

  // Enriched profile per business (Firecrawl + light AI structuring)
  `CREATE TABLE IF NOT EXISTS business_profiles (
    id                        VARCHAR PRIMARY KEY,
    business_id               VARCHAR NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
    raw_scraped_markdown      TEXT,
    extracted_description     TEXT,
    extracted_services        JSONB,
    extracted_products        JSONB,
    extracted_industry        VARCHAR,
    extracted_about_us        TEXT,
    extracted_technologies    JSONB,
    extracted_company_size    VARCHAR,
    extracted_social_links    JSONB,
    extracted_emails          JSONB,
    extracted_phones          JSONB,
    firecrawl_status          VARCHAR NOT NULL DEFAULT 'PENDING',
    firecrawl_error           TEXT,
    scraped_at                TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // Places API query cache (dedup by hash of normalized query+city+page_token)
  `CREATE TABLE IF NOT EXISTS google_places_cache (
    id            VARCHAR PRIMARY KEY,
    query_hash    VARCHAR UNIQUE NOT NULL,
    query         TEXT NOT NULL,
    city          VARCHAR,
    page_token    VARCHAR,
    response_json JSONB NOT NULL,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // Firecrawl scrape cache (dedup by URL hash)
  `CREATE TABLE IF NOT EXISTS firecrawl_cache (
    id            VARCHAR PRIMARY KEY,
    url_hash      VARCHAR UNIQUE NOT NULL,
    url           VARCHAR NOT NULL,
    response_json JSONB NOT NULL,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // Generated emails ready to send (or already sent)
  `CREATE TABLE IF NOT EXISTS emails (
    id                VARCHAR PRIMARY KEY,
    campaign_id       VARCHAR REFERENCES campaigns(id) ON DELETE CASCADE,
    business_id       VARCHAR REFERENCES businesses(id) ON DELETE SET NULL,
    lead_id           VARCHAR REFERENCES leads(id) ON DELETE SET NULL,
    to_email          VARCHAR NOT NULL,
    from_email        VARCHAR,
    subject           TEXT NOT NULL,
    body_text         TEXT NOT NULL,
    body_html         TEXT,
    opening_line      TEXT,
    pain_points       JSONB,
    benefits          JSONB,
    cta               TEXT,
    confidence_score  REAL,
    email_tone        VARCHAR,
    status            VARCHAR NOT NULL DEFAULT 'READY',
    provider          VARCHAR,
    message_id        VARCHAR,
    error_message     TEXT,
    attempts          INTEGER NOT NULL DEFAULT 0,
    scheduled_at      TIMESTAMPTZ,
    sent_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_emails_campaign ON emails (campaign_id)`,
  `CREATE INDEX IF NOT EXISTS idx_emails_status ON emails (status)`,
  `CREATE INDEX IF NOT EXISTS idx_emails_business ON emails (business_id)`,

  // Delivery events (SES bounce/complaint webhooks land here in Phase 2)
  `CREATE TABLE IF NOT EXISTS email_events (
    id           VARCHAR PRIMARY KEY,
    email_id     VARCHAR REFERENCES emails(id) ON DELETE CASCADE,
    event_type   VARCHAR NOT NULL,
    raw_payload  JSONB,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_email_events_email ON email_events (email_id, occurred_at DESC)`,

  // ---- Phase 3: production email infrastructure ----

  // Verified SES sender identities (rotation pool)
  `CREATE TABLE IF NOT EXISTS sender_identities (
    id                       VARCHAR PRIMARY KEY,
    email                    VARCHAR NOT NULL,
    display_name             VARCHAR,
    from_domain              VARCHAR,
    ses_identity_type        VARCHAR NOT NULL DEFAULT 'EMAIL',
    ses_verification_status  VARCHAR NOT NULL DEFAULT 'PENDING',
    daily_send_limit         INTEGER NOT NULL DEFAULT 200,
    sent_today               INTEGER NOT NULL DEFAULT 0,
    sent_today_reset_on      DATE,
    reputation_score         REAL NOT NULL DEFAULT 100,
    bounce_count             INTEGER NOT NULL DEFAULT 0,
    complaint_count          INTEGER NOT NULL DEFAULT 0,
    delivery_count           INTEGER NOT NULL DEFAULT 0,
    last_used_at             TIMESTAMPTZ,
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    is_healthy               BOOLEAN NOT NULL DEFAULT TRUE,
    last_error               TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at               TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_sender_identities_email_active
     ON sender_identities (LOWER(email)) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_sender_identities_rotation
     ON sender_identities (is_active, is_healthy, last_used_at NULLS FIRST)
     WHERE deleted_at IS NULL`,

  // Permanent suppression list (bounce / complaint / unsubscribe / manual)
  `CREATE TABLE IF NOT EXISTS email_suppressions (
    id             VARCHAR PRIMARY KEY,
    email          VARCHAR NOT NULL,
    reason         VARCHAR NOT NULL,
    bounce_type    VARCHAR,
    bounce_subtype VARCHAR,
    source         VARCHAR,
    notes          TEXT,
    campaign_id    VARCHAR REFERENCES campaigns(id) ON DELETE SET NULL,
    suppressed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppressions_email
     ON email_suppressions (LOWER(email))`,

  // Extend `emails` table with tracking + follow-up columns.
  // ADD COLUMN IF NOT EXISTS is a Postgres 9.6+ feature and idempotent.
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS sender_identity_id VARCHAR REFERENCES sender_identities(id)`,
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS follow_up_of VARCHAR REFERENCES emails(id) ON DELETE SET NULL`,
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS follow_up_step INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ`,
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ`,
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`,
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ`,
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ`,
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS reply_received_at TIMESTAMPTZ`,
  `ALTER TABLE emails ADD COLUMN IF NOT EXISTS unsubscribe_token VARCHAR`,
  `CREATE INDEX IF NOT EXISTS idx_emails_unsubscribe_token
     ON emails (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL`,

  // Follow-up rules per campaign (Day 3 / 7 / 14 by default)
  `CREATE TABLE IF NOT EXISTS follow_up_rules (
    id            VARCHAR PRIMARY KEY,
    campaign_id   VARCHAR NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    step          INTEGER NOT NULL,
    delay_days    INTEGER NOT NULL,
    subject_prefix VARCHAR,
    body_instruction TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_up_rules_step
     ON follow_up_rules (campaign_id, step)`,

  // Email template versions (append-only history of template edits)
  `CREATE TABLE IF NOT EXISTS template_versions (
    id            VARCHAR PRIMARY KEY,
    template_id   VARCHAR NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version       INTEGER NOT NULL,
    name          VARCHAR NOT NULL,
    subject       TEXT NOT NULL,
    body          TEXT NOT NULL,
    variables     JSONB NOT NULL DEFAULT '[]'::jsonb,
    changed_by    VARCHAR,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_template_versions
     ON template_versions (template_id, version)`,

  // Extend templates table with variables and updated timestamp
  `ALTER TABLE templates ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE templates ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
];

export async function runMigrations(): Promise<void> {
  await withTransaction(async (client) => {
    for (const stmt of STATEMENTS) {
      await client.query(stmt);
    }
  });
  console.log(`[db.migrations] applied ${STATEMENTS.length} DDL statements`);
}
