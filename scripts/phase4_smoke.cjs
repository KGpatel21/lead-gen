// Phase 4 smoke test — universal email provider abstraction.
const { Client } = require("pg");
const BASE = "http://localhost:3000";

async function api(method, path, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: resp.status, json, text };
}
function pg() {
  return new Client({ host: "localhost", port: 5432, user: "postgres", password: "root", database: "outbound_ai" });
}
function log(label, obj) { console.log("  " + label + ":", typeof obj === "string" ? obj : JSON.stringify(obj)); }
function hdr(s) { console.log("\n══ " + s + " ══"); }

async function main() {
  const login = await api("POST", "/api/auth/login", null, { email: "krutarth@example.com", password: "TestPass123!" });
  const token = login.json?.token;
  console.log("login:", login.status);

  const c = pg();
  await c.connect();

  // ---- 1. Email accounts CRUD (SMTP path — provider abstraction verified end-to-end)
  hdr("1. Email accounts — SMTP + SES + presets");
  const presets = await api("GET", "/api/email-accounts/presets", token);
  log("presets: providers", presets.json?.providers);
  log("presets: smtp templates", Object.keys(presets.json?.smtpPresets || {}));

  const smtpCreate = await api("POST", "/api/email-accounts", token, {
    provider: "smtp",
    email: "phase4-smtp@example.dev",
    displayName: "Phase 4 SMTP",
    smtpHost: "smtp.example.dev",
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: "phase4-smtp@example.dev",
    smtpPassword: "hunter2",
    dailySendLimit: 100,
  });
  log("create smtp: HTTP " + smtpCreate.status, smtpCreate.json?.account?.email);
  log("  password is encrypted-at-rest, not returned", smtpCreate.json?.account?.hasSmtpPassword);
  const smtpAcctId = smtpCreate.json?.account?.id;

  const sesCreate = await api("POST", "/api/email-accounts", token, {
    provider: "ses",
    email: "phase4-ses@outbound-example.dev",
    displayName: "Phase 4 SES",
    dailySendLimit: 200,
  });
  log("create ses: HTTP " + sesCreate.status, sesCreate.json?.account?.email);

  const list = await api("GET", "/api/email-accounts", token);
  log("list count", list.json?.data?.length);
  log("list providers", list.json?.data?.map((a) => a.provider));

  // ---- 2. Test each provider (SMTP handshake will fail with DNS lookup; SES verifies via GetEmailIdentity)
  hdr("2. Provider test() — real network calls");
  const smtpTest = await api("POST", `/api/email-accounts/${smtpAcctId}/test`, token);
  log("smtp test HTTP " + smtpTest.status, smtpTest.json);
  const sesTest = await api("POST", `/api/email-accounts/${sesCreate.json.account.id}/test`, token);
  log("ses test HTTP " + sesTest.status, sesTest.json);

  // ---- 3. OAuth start endpoints (Google + Microsoft) — should either return a URL or 503
  hdr("3. OAuth start endpoints");
  const gStart = await api("GET", "/api/oauth/google/start", token);
  log("google start HTTP " + gStart.status, gStart.json?.url ? gStart.json.url.slice(0, 80) + "..." : gStart.json?.error);
  const mStart = await api("GET", "/api/oauth/microsoft/start", token);
  log("microsoft start HTTP " + mStart.status, mStart.json?.url ? mStart.json.url.slice(0, 80) + "..." : mStart.json?.error);

  // ---- 4. Sender pools — CRUD, membership, strategies, campaign binding
  hdr("4. Sender pools — CRUD + strategies");
  const poolCreate = await api("POST", "/api/sender-pools", token, { name: "Phase 4 Pool", strategy: "weighted" });
  log("create pool: HTTP " + poolCreate.status, poolCreate.json?.pool?.name + " · " + poolCreate.json?.pool?.strategy);
  const poolId = poolCreate.json?.pool?.id;

  const addMember1 = await api("POST", `/api/sender-pools/${poolId}/members`, token, { accountId: smtpAcctId, weight: 3 });
  const addMember2 = await api("POST", `/api/sender-pools/${poolId}/members`, token, { accountId: sesCreate.json.account.id, weight: 1 });
  log("member 1: HTTP " + addMember1.status, addMember1.json?.member?.weight);
  log("member 2: HTTP " + addMember2.status, addMember2.json?.member?.weight);

  const poolGet = await api("GET", `/api/sender-pools/${poolId}`, token);
  log("get pool", `strategy=${poolGet.json?.pool?.strategy} members=${poolGet.json?.members?.length}`);

  const strategies = ["round_robin", "least_used", "random", "weighted", "health"];
  for (const s of strategies) {
    const upd = await api("PUT", `/api/sender-pools/${poolId}`, token, { strategy: s });
    log(`  set strategy=${s}: HTTP ${upd.status}`);
  }

  const campaigns = await api("GET", "/api/campaigns", token);
  const campId = campaigns.json?.data?.[0]?.id;
  const bind = await api("POST", "/api/sender-pools/bind-campaign", token, { campaignId: campId, poolId });
  log(`bind pool to campaign ${campId}: HTTP ${bind.status}`, bind.json);

  // ---- 5. Failover pipeline: mark both accounts VERIFIED + ACTIVE, enqueue send
  hdr("5. Failover — dispatch picks from pool + fails over on error");
  await c.query("UPDATE email_accounts SET ses_verification_status = 'VERIFIED'");
  // Emit an unrelated smtp health status so it doesn't get auto-picked; keep SES as the healthy candidate
  await c.query("UPDATE email_accounts SET is_healthy = FALSE WHERE provider = 'smtp'");

  const gen = await api("POST", "/api/email/generate", token, {
    businessId: "biz-test-victrola",
    campaignId: campId,
    toEmail: "internal-testing@outbound.dev",
    senderName: "Phase4",
    senderCompany: "Outbound.AI",
    targetService: "loyalty program",
    tone: "Warm",
  });
  const emId = gen.json?.email?.id;
  log("generate: HTTP " + gen.status + " id=" + emId);
  await c.query("UPDATE emails SET status='READY' WHERE id=$1", [emId]);

  const send = await api("POST", `/api/campaign/${campId}/send`, token);
  log("enqueue: HTTP " + send.status, send.json);

  // Wait for worker
  const start = Date.now();
  let row = null;
  while (Date.now() - start < 15000) {
    const r = await c.query("SELECT status, sender_identity_id, error_message, provider FROM emails WHERE id=$1", [emId]);
    row = r.rows[0];
    if (row?.status && row.status !== "READY" && row.status !== "SENDING") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  log("post-worker row status", row?.status);
  log("  provider used", row?.provider);
  log("  sender_identity_id (email_accounts.id)", row?.sender_identity_id);
  log("  error (if any)", (row?.error_message || "").slice(0, 160));

  const events = await c.query(
    "SELECT event_type, raw_payload->>'provider' AS provider, raw_payload->>'accountId' AS account, raw_payload->>'latencyMs' AS latency FROM email_events WHERE email_id=$1 ORDER BY occurred_at DESC LIMIT 3",
    [emId]
  );
  events.rows.forEach((e) => log("  event", `${e.event_type} · via=${e.provider} · account=${e.account} · latency=${e.latency}`));

  // ---- 6. Backward-compat: /api/sender-identities alias still works
  hdr("6. Backward-compat alias");
  const alias = await api("GET", "/api/sender-identities", token);
  log("sender-identities alias returns HTTP " + alias.status + " count " + alias.json?.data?.length);

  await c.end();
  console.log("\n═══ Phase 4 smoke complete ═══");
}
main().catch((e) => { console.error(e); process.exit(1); });
