# Outbound.AI — Cold Email & Lead Generation Platform

Production-grade AI outbound platform. Google Places for real lead discovery,
Firecrawl for real website analysis, Gemini for reasoning-only email drafting,
Amazon SES for delivery — plus a React + Vite dashboard, Express + Postgres
backend, Redis for rate limits, JWT auth, and a persistent queue.

> **Status:** Phase 1.7 — production Lead Discovery pipeline shipped
> (Places → Firecrawl → Gemini reasoning → SES). Nodemailer + Gmail SMTP
> path preserved as an alternate delivery route. BullMQ, IMAP reply
> ingestion, and SNS bounce/complaint webhooks are Phase 2. See **Known
> Issues** and **Roadmap** at the bottom.

## Lead Discovery pipeline (primary)

```
User query ("dental clinics in Austin")
  │
  ▼
Google Places API (New) — v1 Text Search
  │  fields: name, address, website, phone, rating, review count, category
  │  paginated up to 60 results
  │  cached by (query, city, page-token) hash for 24h
  ▼
Postgres — businesses  ◄─── upserted by place_id (deduplicated)
  │
  ▼  (user picks businesses to analyze)
Firecrawl v2 scrape
  │  markdown extraction, retry with exponential backoff,
  │  45s timeout, Redis 60/min rate limit,
  │  cached by URL hash for 24h
  ▼
Postgres — business_profiles
  │  description, services, products, tech stack, emails, phones,
  │  social links — all extracted from the real scraped page
  │
  ▼  (user provides target service + sender identity)
Google Gemini — reasoning ONLY
  │  Zero grounding. Zero web-search.
  │  Prompt contains only VERIFIED facts from Places + Firecrawl.
  │  Model: gemini-flash-lite-latest
  ▼
Postgres — emails
  │  subject, opening line, body (plain + HTML), pain points, benefits,
  │  CTA, confidence score, tone — status = READY
  │
  ▼  (user clicks "Send via SES")
Amazon SES v2
  │  X-Campaign-Id + X-Email-Id tracking headers
  │  Config-set opt-in for downstream event publishing (SNS/CloudWatch)
  │  Exponential-backoff retry for transient errors
  ▼
Postgres — email_events + emails.status = SENT
```

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Folder Structure](#folder-structure)
- [Technology Stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Redis Setup](#redis-setup)
- [SMTP Setup](#smtp-setup)
- [Gemini Setup](#gemini-setup)
- [Running Locally](#running-locally)
- [Production Deployment](#production-deployment)
- [API Overview](#api-overview)
- [Authentication](#authentication)
- [Health & Metrics](#health--metrics)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known Issues](#known-issues)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

Outbound.AI helps sales teams:

1. **Prospect leads** — Google Places API (New) v1 Text Search backed by
   Postgres-cached queries.
2. **Analyze websites** — Firecrawl v2 with retry, timeout, rate limiting,
   and Postgres URL cache.
3. **Dispatch email** — SMTP send from user-owned inboxes with per-account
   daily limits and Redis-backed hourly rate limiting.
4. **Track deliverability** — SPF / DKIM / DMARC / MX DNS verification per
   domain; per-inbox reputation scoring.
5. **Triage replies** — Gemini classifies reply sentiment (Interested /
   Meeting / Not Interested / Spam) and drafts a follow-up.

Everything is authenticated with JWTs, backed by PostgreSQL, and
observed via Prometheus-format `/metrics`.

---

## Architecture

```
┌────────────────┐   HTTPS/WS   ┌──────────────────────────────────────┐
│  React (Vite)  │──────────────▶  Express API + Vite middleware        │
│  /src/*        │              │  /server.ts, /server/routes/*         │
└────────────────┘              │                                       │
                                │  ┌───────────────┐  ┌──────────────┐  │
                                │  │  Controllers  │  │  Middleware  │  │
                                │  │  auth, camp,  │  │  jwt, csrf,  │  │
                                │  │  lead, smtp,  │  │  ratelimit,  │  │
                                │  │  system, ...  │  │  validation  │  │
                                │  └──────┬────────┘  └──────────────┘  │
                                │         │                             │
                                │  ┌──────▼────────┐  ┌──────────────┐  │
                                │  │  Services     │  │  Repositories│  │
                                │  │  ai (Gemini), │  │  parameter-  │  │
                                │  │  smtp, redis, │  │  ised SQL    │  │
                                │  │  security     │  │  per entity  │  │
                                │  └──────┬────────┘  └──────┬───────┘  │
                                │         │                  │          │
                                │  ┌──────▼──────────────────▼──────┐   │
                                │  │  Queue Worker (setInterval 10s)│   │
                                │  │  reads queue table, sends via  │   │
                                │  │  Nodemailer, records outcomes  │   │
                                │  └────────────────────────────────┘   │
                                └──────────────────────────────────────┘
                                        │              │
                                        ▼              ▼
                                ┌───────────────┐  ┌───────────────┐
                                │  PostgreSQL   │  │     Redis     │
                                │  authoritative│  │  rate limits, │
                                │  for all data │  │  session cache│
                                └───────────────┘  └───────────────┘
```

**Key architecture decisions**

- **PostgreSQL is the sole source of truth.** No JSON-file persistence,
  no in-memory state that periodically flushes to the DB.
- **Repository pattern.** Every entity has a repository under
  `server/db/repositories/` that owns its parameterized SQL. Controllers
  never touch SQL directly.
- **Migrations on boot.** `server/db/migrations.ts` is idempotent and
  runs at every start. Swap to `node-pg-migrate` when you need version
  history without changing controllers.
- **Fail-fast config.** `server/config.ts` refuses to boot on missing
  `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, or `ENCRYPTION_KEY`.
- **AI is opt-in.** If `GEMINI_API_KEY` is unset, every AI endpoint
  returns HTTP 503 with a clear error. There is no simulated fallback.

---

## Folder Structure

```
├── server.ts                           # boot: config → migrate → redis ping → listen
├── server/
│   ├── config.ts                       # env-var validation & typed config
│   ├── db/
│   │   ├── pool.ts                     # single pg.Pool
│   │   ├── migrations.ts               # idempotent DDL
│   │   ├── rowMappers.ts               # snake_case row → camelCase domain
│   │   └── repositories/               # one file per entity
│   ├── services/
│   │   ├── db.service.ts               # boot facade + audit helper
│   │   ├── redis.service.ts            # ioredis wrapper
│   │   ├── security.service.ts         # AES-256-CBC, PBKDF2, JWT
│   │   ├── smtp.service.ts             # Nodemailer send + DNS verify
│   │   ├── ai.service.ts               # Gemini SDK (throws when unset)
│   │   ├── queue.service.ts            # thin queue API for controllers
│   │   └── websocket.service.ts        # /ws real-time channel
│   ├── controllers/                    # auth, campaign, lead, smtp, system, billing, sync
│   ├── middleware/                     # jwt, csrf, rate-limiter, validation
│   ├── routes/api.routes.ts            # Express router (/api and /api/v1 aliases)
│   └── workers/queue.worker.ts         # persistent background dispatcher
├── src/                                # React + Vite frontend
│   ├── App.tsx
│   ├── main.tsx
│   └── components/                     # 14 view components
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## Technology Stack

| Layer            | Choice                                             |
|------------------|----------------------------------------------------|
| Runtime          | Node.js ≥ 20                                       |
| Language         | TypeScript 5                                       |
| Web framework    | Express 4                                          |
| Frontend         | React 19, Vite 6, TailwindCSS 4                    |
| Database         | PostgreSQL 15+ (native `pg` driver, `pg.Pool`)     |
| Cache & queue    | Redis (ioredis)                                    |
| Email dispatch   | Nodemailer                                         |
| AI provider      | Pluggable via `AIProvider` interface. Default: Groq `llama-3.3-70b-versatile`. Fallback: Gemini. Add new providers under `server/ai/providers/`. |
| Billing          | Stripe                                             |
| Realtime         | `ws` WebSocket server (path `/ws`)                 |
| Auth             | HMAC-SHA256 signed JWT (`SecurityService`)         |
| Encryption       | AES-256-CBC (SMTP passwords at rest)               |
| Password hashing | PBKDF2-SHA512, 120k iterations                     |

---

## Prerequisites

- **Node.js 20+** — install from nodejs.org.
- **PostgreSQL 15+** — running and accessible on `localhost:5432`.
- **Redis** — running and accessible on `localhost:6379`.
- Optional: **Gemini API key** — from Google AI Studio.
- Optional: **Stripe test-mode keys** for billing flows.
- Optional: **Google / Microsoft OAuth client IDs** for mailbox sync
  (Phase 2 — callback isn't implemented yet).

---

## Installation

```bash
git clone <repo-url>
cd outbound-ai-lead-generation
npm install
cp .env.example .env    # then edit .env
```

---

## Environment Variables

Every variable required to boot is documented in `.env.example`. The
server refuses to start if a required variable is missing.

| Variable                     | Required            | Purpose                                             |
|------------------------------|---------------------|-----------------------------------------------------|
| `NODE_ENV`                   | no (default `development`) | `development` \| `test` \| `production`   |
| `PORT`                       | no (default `3000`) | HTTP listen port                                    |
| `APP_URL`                    | no                  | Public URL used in Stripe redirects & OAuth callbacks |
| `DATABASE_URL`               | **yes**             | Postgres connection string                          |
| `REDIS_URL`                  | **yes**             | Redis connection string                             |
| `JWT_SECRET`                 | **yes** (≥ 24 chars) | HMAC key for JWT                                    |
| `ENCRYPTION_KEY`             | **yes** (≥ 24 chars) | Seed for AES-256 SMTP-password encryption           |
| `AI_PROVIDER`                | AI provider select  | `groq` (default) or `gemini`                        |
| `GROQ_API_KEY`               | AI features (Groq)  | Primary provider; model fixed to `llama-3.3-70b-versatile` |
| `GEMINI_API_KEY`             | AI features (Gemini) | Alternate provider, deprecated but functional      |
| `GOOGLE_PLACES_API_KEY`      | Lead Discovery      | Real business search via Places API (New)           |
| `FIRECRAWL_API_KEY`          | Lead Discovery      | Website scraping / structured extraction            |
| `AWS_ACCESS_KEY_ID`          | SES delivery        | Amazon SES v2 credentials                           |
| `AWS_SECRET_ACCESS_KEY`      | SES delivery        | Amazon SES v2 credentials                           |
| `AWS_REGION`                 | SES delivery        | Default `us-east-1`                                 |
| `SES_FROM_EMAIL`             | SES delivery        | Verified sender identity                            |
| `SES_CONFIGURATION_SET`      | SES optional        | Config set for event publishing (SNS/CloudWatch)    |
| `PUBLIC_BASE_URL`            | Tracking (Phase 3)  | Base URL email pixels + unsubscribe links point at  |
| `EMAIL_WORKER_CONCURRENCY`   | BullMQ (Phase 3)    | Send-worker parallelism (default 3)                 |
| `STRIPE_SECRET_KEY`          | billing             | Enables checkout / portal / webhook                 |
| `STRIPE_WEBHOOK_SECRET`      | billing             | Verifies Stripe webhook signatures                  |
| `STRIPE_PRICE_FREE_ID`       | billing             | Price ID for the Free tier subscription             |
| `STRIPE_PRICE_GROWTH_ID`     | billing             | Price ID for the Growth tier                        |
| `STRIPE_PRICE_ENTERPRISE_ID` | billing             | Price ID for the Enterprise tier                    |
| `GOOGLE_CLIENT_ID`           | Gmail sync (Phase 2) | Renders the auth URL; callback = 501                |
| `MICROSOFT_CLIENT_ID`        | Outlook sync (Phase 2) | Renders the auth URL; callback = 501             |

Local dev defaults (matching the shipped `.env.example`):

```
DATABASE_URL=postgresql://postgres:root@localhost:5432/outbound_ai
REDIS_URL=redis://localhost:6379
```

---

## Database Setup

```bash
# 1. Confirm Postgres is running
psql -U postgres -c "SELECT version();"

# 2. Create the database (if it doesn't exist)
psql -U postgres -c "CREATE DATABASE outbound_ai;"

# 3. First `npm run dev` auto-runs all migrations idempotently
```

The migration statements live in `server/db/migrations.ts`. They're safe
to re-run — every `CREATE TABLE` / `CREATE INDEX` uses `IF NOT EXISTS`.

To wipe and re-migrate:

```bash
npm run db:reset       # drops and recreates schema `public`, then boot re-runs migrations
```

Default AI-agent metadata (4 rows) is auto-seeded on every boot via
`agentRepository.ensureDefaults`. **No other seed data is inserted** —
starting fresh you'll see zero campaigns, zero leads, zero SMTP accounts.

---

## Redis Setup

Any recent Redis (5+) works.

```bash
redis-cli ping   # should print PONG
```

Redis is used for:

- Per-SMTP hourly rate limits (`smtp:hourly:<id>`)
- Per-SMTP inter-send cooldown (`smtp:lastsend:<id>`)
- General cache (`redisService.get / set / del`)

**There is no in-memory fallback.** If Redis is down, `npm run dev`
fails the boot ping.

---

## SMTP Setup

You configure SMTP accounts via the UI or `POST /api/smtp`. Passwords
are AES-256-CBC encrypted at rest using `ENCRYPTION_KEY`. Gmail-style
app passwords work; regular passwords also work if your host allows
LOGIN auth.

Domain verification (SPF / DKIM / DMARC / MX) is a real DNS query —
there is no "mock pass" behavior for test domains.

---

## Gemini Setup

Get a key from [Google AI Studio](https://aistudio.google.com/) and set:

```
GEMINI_API_KEY=your_key_here
```

Without it: **every AI endpoint returns HTTP 503**. There is no
simulated fallback anywhere in the codebase.

---

## Running Locally

```bash
npm run dev        # starts Vite dev server + Express + queue worker
```

Expected output:

```
[boot] NODE_ENV=development
[redis] connected
[db.migrations] applied 31 DDL statements
[db.service] bootstrap complete; PostgreSQL is the sole source of truth.
[boot] redis ping: PONG
[WebSocket Server] Real-time communication system mounted.
[worker] persistent queue worker started (sweep every 10000 ms)
[boot] server listening on http://localhost:3000
```

Then open:

- **Frontend / Backend:** http://localhost:3000
- **Health:** http://localhost:3000/health
- **Metrics:** http://localhost:3000/metrics
- **API root:** http://localhost:3000/api

---

## Production Deployment

```bash
npm run build      # bundles React → dist/, esbuild server → dist/server.cjs
npm run start      # NODE_ENV=production node dist/server.cjs
```

Requirements in production:

- `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` — all set,
  all high-entropy.
- Reverse proxy (nginx / Cloud Run / ALB) terminating TLS.
- Postgres backups configured.
- (Recommended) rotate `ENCRYPTION_KEY` **only** with a re-encryption
  migration for `smtp_accounts.smtp_password`; otherwise stored SMTP
  passwords become unreadable.

**Docker / Compose files ship in Phase 3.**

---

## API Overview

All routes are mounted at `/api` (also aliased at `/api/v1` for
backward compatibility). Almost all require an `Authorization: Bearer
<jwt>` header. Full route list in `server/routes/api.routes.ts`.

Highlights:

```
POST   /api/auth/register        create account (first user = ADMIN)
POST   /api/auth/login           returns { token, user }
GET    /api/auth/me              current session
GET    /api/team                 list team members
POST   /api/team/invite          ADMIN only — returns inviteToken

GET    /api/campaigns
POST   /api/campaigns
PUT    /api/campaigns/:id
DELETE /api/campaigns/:id
GET    /api/campaigns/:id/leads
POST   /api/campaigns/:id/leads
POST   /api/campaigns/:id/leads/bulk
POST   /api/campaigns/:id/leads/upload            CSV
POST   /api/campaigns/:id/ai-bulk-personalize     Gemini (503 if not configured)
POST   /api/campaigns/:id/ai-bulk-enrich-research Gemini

GET    /api/leads
PUT    /api/leads/:id
PUT    /api/leads/:id/crm
DELETE /api/leads/:id
POST   /api/leads/:id/send-now
POST   /api/leads/:id/enrich-research

GET    /api/smtp                                  redacts smtpPassword to "***"
POST   /api/smtp
PUT    /api/smtp/:id
DELETE /api/smtp/:id
POST   /api/smtp/:id/test                         nodemailer.verify()

GET    /api/domains
POST   /api/domains
POST   /api/domains/:id/verify                    real DNS lookups
DELETE /api/domains/:id

GET    /api/templates
POST   /api/templates

GET    /api/dashboard/stats                       real counts from Postgres
POST   /api/autopilot/dispatch                    (legacy) Gemini reasoning-only

# Lead Discovery pipeline (primary)
POST   /api/leads/search                          Google Places search (real businesses)
POST   /api/business/analyze                      Firecrawl per business (real scrape)
POST   /api/email/generate                        Groq reasoning-only per business
POST   /api/campaign/create                       New campaign wrapping N businesses
POST   /api/campaign/:id/send                     Enqueue via BullMQ (Phase 3)
POST   /api/campaign/:id/pause                    Pause queued sends
POST   /api/campaign/:id/resume                   Resume queued sends
POST   /api/campaign/:id/cancel                   Cancel remaining sends
GET    /api/campaign/:id                          Campaign + all emails
GET    /api/campaign/:id/stats                    Delivery counters
GET    /api/queue/email/stats                     BullMQ job counts

# Phase 3 email-infrastructure surface
GET    /api/sender-identities                     List rotating senders
POST   /api/sender-identities                     Create a verified identity
POST   /api/sender-identities/:id/refresh         Re-query SES verification status
POST   /api/sender-identities/:id/active          Enable/disable in the rotation
DELETE /api/sender-identities/:id                 Soft-delete a sender

GET    /api/suppressions                          List suppression entries
POST   /api/suppressions                          Manually suppress an address
DELETE /api/suppressions/:email                   Remove from suppression list

GET    /api/campaign/:id/follow-ups               List Day-3 / Day-7 / Day-14 rules
POST   /api/campaign/:id/follow-ups/ensure-defaults
POST   /api/campaign/:id/follow-ups               Upsert a rule

GET    /api/templates/v2                          Templates with variables + version history
POST   /api/templates/v2
PUT    /api/templates/v2/:id                      (auto-records history)
POST   /api/templates/v2/:id/preview              Render with variable values
GET    /api/templates/v2/:id/history              All prior versions
POST   /api/templates/v2/:id/duplicate            Clone as new template
DELETE /api/templates/v2/:id                      Soft delete

# Public endpoints hit by email clients (unauthenticated)
POST   /api/ses/events                            SNS webhook (signature-verified)
GET    /t/o/:token                                Open tracking pixel
GET    /t/c/:token                                Click redirect
GET    /unsubscribe/:token                        HTML confirmation
POST   /unsubscribe/:token                        RFC 8058 one-click list-unsubscribe

GET    /api/queue
POST   /api/queue/:id/retry
POST   /api/queue/campaign/:id/retry
DELETE /api/queue/:id
DELETE /api/queue/failed/all

POST   /api/billing/checkout                      503 if Stripe not configured
POST   /api/billing/portal                        503 if Stripe not configured
POST   /api/billing/webhook                       verifies signature

GET    /api/sync/oauth/google                     501 if GOOGLE_CLIENT_ID unset
GET    /api/sync/oauth/microsoft                  501 if MICROSOFT_CLIENT_ID unset
```

---

## Authentication

- JWT signed with HMAC-SHA256, 7-day expiry.
- Middleware in `server/middleware/auth.middleware.ts` requires a valid
  bearer token on every protected route. **No fallback-to-admin.**
- Roles: `ADMIN`, `USER`, `TEAM_MEMBER`. Use `requireRole([...])` after
  `authenticateJwt`.
- Passwords hashed with PBKDF2-SHA512 (120,000 iterations, 64-byte digest).

---

## Health & Metrics

- `GET /health` — 200 when Postgres + Redis are both `CONNECTED`, otherwise
  503. Reports gemini/stripe config status, queue worker last sweep,
  process memory.
- `GET /metrics` — Prometheus format. Real counters: HTTP requests
  handled, campaign emails sent, queue depth (queued / pending / failed),
  active SMTP accounts, process heap.

---

## Testing

**Automated tests ship in Phase 3.** Until then, the reference flow is:

```bash
# 1. Boot
npm run dev

# 2. Health
curl http://localhost:3000/health

# 3. Register (first user = ADMIN)
TOKEN=$(curl -sS -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Admin","email":"admin@example.com","password":"TestPass123!"}' \
  | jq -r .token)

# 4. Create a campaign
curl -sS -X POST http://localhost:3000/api/campaigns \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Q1 Outbound"}'

# 5. Dashboard
curl -sS http://localhost:3000/api/dashboard/stats -H "Authorization: Bearer $TOKEN"

# 6. Verify data actually lives in Postgres
psql -U postgres -d outbound_ai -c "SELECT id,name,status FROM campaigns;"
```

---

## Troubleshooting

| Symptom                                            | Fix                                                              |
|----------------------------------------------------|------------------------------------------------------------------|
| Boot fails with `Required environment variable "X"` | Populate `.env`                                                  |
| Boot fails with `[boot] Redis unreachable`         | Start Redis; confirm `REDIS_URL`                                  |
| All requests return 401                            | Include `Authorization: Bearer <jwt>` header                     |
| AI endpoint returns 503                            | Set `GEMINI_API_KEY` in `.env`                                   |
| Stripe endpoints return 503                        | Set `STRIPE_SECRET_KEY` and per-plan `STRIPE_PRICE_*_ID`         |
| SMTP test fails                                    | Confirm the app password / auth type your provider requires      |
| Domain verify shows `DKIM: PENDING`                | Common DKIM selectors are probed; if yours isn't standard, add it |
| Queue never dispatches                             | No `smtp_accounts` rows OR none with a saved password             |
| `npm run db:reset` says "in use"                   | Stop `npm run dev` first (holds pool connections)                 |

---

## External services — setup required for full pipeline

Everything below has to be provisioned by the account owner outside this repo.

**Google Cloud project (Places API):**
1. Open https://console.developers.google.com/apis/api/places.googleapis.com/overview
2. Enable the **Places API (New)**. Wait ~2 minutes for propagation.
3. `POST /api/leads/search` returns Google's guidance URL if this step is skipped.

**Gemini AI Studio (billing):**
1. Free-tier keys can hit `RESOURCE_EXHAUSTED` when `prepayment credits are depleted`.
2. Enable billing on the project at https://ai.studio/projects.
3. Alternatively, wait ~24h for the daily bucket to reset (limited paths).

**AWS SES (identity + IAM):**
1. Verify a sender email or domain in the SES console for `AWS_REGION`.
2. Set `SES_FROM_EMAIL` in `.env` to the verified address.
3. Ensure the IAM user carrying `AWS_ACCESS_KEY_ID` has `ses:SendEmail` for
   that identity (and, optionally, `ses:SendRawEmail`).
4. If your account is still in the SES sandbox, only verified destinations
   will accept mail — request production access to send to arbitrary addresses.

**Firecrawl:** no external setup — the API key alone is enough.

## Known Issues

Items intentionally deferred beyond Phase 1:

- **BullMQ.** The dispatcher still uses `setInterval(10s)`. Redis is
  wired for rate limits but not for queue storage. Phase 2.
- **IMAP inbound processing.** Replies + bounces don't reach the app.
  Phase 2.
- **Warmup engine.** The `warmup_*` fields are honored by rate limits
  but no mail-to-mail warmup traffic is generated. Phase 2.
- **Open / click tracking.** No pixel or link rewriter. Phase 2.
- **Mailbox OAuth callbacks.** Auth URL renders correctly, but the
  callback returns 501 (no token exchange yet). Phase 3.
- **Frontend has no api-client layer.** Every component uses raw
  `fetch` and does not send `Authorization` headers — the frontend
  won't function against this backend until Phase 1.5 (or 2) adds a
  central client that reads the JWT from `localStorage` and injects
  the header. This is the top item in the frontend backlog.
- **Rate limiter is process-local.** Redis-backed rate limits gate
  SMTP dispatch, but the API rate limiter in
  `server/middleware/rateLimiter.middleware.ts` is still an in-memory
  Map. Fine for one instance; broken behind a load balancer.
- **CSRF is origin-header comparison, not a real token.** Adequate
  for same-origin dev; upgrade before shipping to a real domain.
- **No test suite yet.** Phase 3.

---

## Roadmap

- **Phase 1 (done)** — real auth, real Postgres CRUD via repositories,
  no fake data, real metrics, real DNS verification, config fail-fast,
  end-to-end boot verification.
- **Phase 1.5 / Frontend cleanup** — central `src/api/client.ts` with
  JWT header injection, remove `Math.random()` metrics from
  `AutopilotConsole` and `EnterpriseConsole`, remove hardcoded
  "Krutarth Patel" from Sidebar, add loading/error/empty states.
- **Phase 2** — BullMQ queue, per-tenant workers, IMAP inbound,
  warmup engine, open/click tracking, real inter-instance rate limits.
- **Phase 3** — Real Google + Microsoft OAuth callbacks, Docker +
  docker-compose, integration tests (Vitest + Playwright), CI, hosted
  deploy guide (Fly.io / Railway / Cloud Run).

---

## License

Apache-2.0
