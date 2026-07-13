# Outbound.AI — Cold Email & Lead Generation Platform

A full-stack TypeScript SaaS for AI-driven outbound sales sequences.
React + Vite frontend, Express backend, PostgreSQL persistence, Redis
rate-limiting, Nodemailer SMTP dispatch, Google Gemini for lead enrichment
and reply triage, and Stripe for billing.

> **Status:** Phase 1 — core is production-shaped (real auth, real DB,
> real rate limits, no fake data). Phase 2 (BullMQ, IMAP reply
> ingestion, warmup engine, open/click tracking) and Phase 3 (real Gmail
> and Outlook OAuth token exchange, Docker, tests) are still ahead.
> See **Known Issues** and **Roadmap** below for exactly what's done and
> what isn't.

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

1. **Prospect leads** — manually, via CSV upload, or with Gemini-backed
   autopilot search (Google Search grounding).
2. **Personalize outreach** — deep AI research on each lead: business
   summary, pain points, and a 4-step email sequence.
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
| AI               | Google Gemini via `@google/genai` SDK              |
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
| `GEMINI_API_KEY`             | AI features         | Enables enrichment, autopilot, reply triage         |
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
POST   /api/autopilot/dispatch                    Gemini + Google Search grounding

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
