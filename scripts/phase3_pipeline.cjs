// End-to-end BullMQ pipeline test — no bash quoting nonsense.
// Run: node --env-file=.env scripts/phase3_pipeline.js

const { Client } = require("pg");

const BASE = "http://localhost:3000";
async function api(method, path, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no-op */ }
  return { status: resp.status, json, text };
}
function pg() {
  return new Client({
    host: "localhost", port: 5432,
    user: "postgres", password: "root", database: "outbound_ai",
  });
}
async function main() {
  console.log("═══ Phase 3 pipeline test ═══");

  const login = await api("POST", "/api/auth/login", null, {
    email: "krutarth@example.com", password: "TestPass123!",
  });
  const token = login.json?.token;
  console.log("  login:", login.status, "token=" + (token || "").slice(0, 20) + "...");

  const c = pg();
  await c.connect();

  // ---- 1. Force sender to VERIFIED
  const senders = await c.query(
    "UPDATE sender_identities SET ses_verification_status='VERIFIED' RETURNING id, email"
  );
  console.log(`  · verified ${senders.rowCount} sender identity/identities`);

  // ---- 2. Pick a campaign to use
  const campaigns = await api("GET", "/api/campaigns", token);
  const campaignId = campaigns.json?.data?.[0]?.id;
  console.log("  · using campaignId:", campaignId);

  // ---- 3. Generate an email attached to that campaign via Groq
  const gen = await api("POST", "/api/email/generate", token, {
    businessId: "biz-test-victrola",
    campaignId,
    toEmail: "internal-testing@outbound.dev",
    senderName: "Krutarth",
    senderCompany: "Outbound.AI",
    targetService: "loyalty program",
    tone: "Warm",
  });
  const emailId = gen.json?.email?.id;
  console.log("  · generate email:", gen.status, "id=" + emailId);

  // Sanity: ensure the row is READY and campaignId is set (upsert if not).
  await c.query(
    "UPDATE emails SET status='READY', campaign_id=$1 WHERE id=$2",
    [campaignId, emailId]
  );

  // ---- 4. Enqueue via BullMQ
  const send = await api("POST", `/api/campaign/${campaignId}/send`, token);
  console.log("  · enqueue:", send.status, JSON.stringify(send.json));

  // ---- 5. Wait for the worker, then read row + events
  const start = Date.now();
  let finalStatus = null;
  while (Date.now() - start < 15000) {
    const r = await c.query(
      "SELECT status, sender_identity_id, error_message FROM emails WHERE id=$1",
      [emailId]
    );
    finalStatus = r.rows[0];
    if (finalStatus?.status && finalStatus.status !== "READY" && finalStatus.status !== "SENDING") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("  · post-worker row:", JSON.stringify(finalStatus));
  const events = await c.query(
    "SELECT event_type, occurred_at FROM email_events WHERE email_id=$1 ORDER BY occurred_at DESC LIMIT 5",
    [emailId]
  );
  console.log(`  · events (${events.rowCount}):`);
  events.rows.forEach((e) => console.log("       -", e.event_type, e.occurred_at.toISOString()));

  // ---- 6. Suppression path — enqueue an email whose recipient is on the suppression list
  await c.query(
    `INSERT INTO email_suppressions (id, email, reason, source)
     VALUES ('supp-${Date.now()}', LOWER('blocked@spam.test'), 'manual', 'smoke')
     ON CONFLICT ((LOWER(email))) DO NOTHING`
  );
  const suppEmailId = `em-supp-${Date.now()}`;
  await c.query(
    `INSERT INTO emails (id, campaign_id, to_email, subject, body_text, status)
     VALUES ($1, $2, 'blocked@spam.test', 'noop', 'noop', 'READY')`,
    [suppEmailId, campaignId]
  );
  await api("POST", `/api/campaign/${campaignId}/send`, token);
  const start2 = Date.now();
  let suppResult = null;
  while (Date.now() - start2 < 8000) {
    const r = await c.query(
      "SELECT status, error_message FROM emails WHERE id=$1",
      [suppEmailId]
    );
    suppResult = r.rows[0];
    if (suppResult?.status && suppResult.status !== "READY" && suppResult.status !== "SENDING") break;
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("  · suppressed row:", JSON.stringify(suppResult));

  // ---- 7. Follow-up scheduling — check delayed jobs
  const followUpBull = await c.query(
    "SELECT COUNT(*)::int AS n FROM emails WHERE follow_up_of IS NOT NULL"
  );
  console.log("  · follow-up rows persisted:", followUpBull.rows[0]?.n);

  await c.end();
  console.log("═══ done ═══");
}
main().catch((e) => { console.error(e); process.exit(1); });
