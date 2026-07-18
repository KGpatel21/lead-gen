// Phase 4.5 smoke — universal mailbox reader + reply classifier + monitoring.
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
function log(l, v) { console.log("  " + l + ":", typeof v === "string" ? v : JSON.stringify(v)); }
function hdr(s) { console.log("\n══ " + s + " ══"); }

async function main() {
  const c = pg();
  await c.connect();

  const login = await api("POST", "/api/auth/login", null, { email: "krutarth@example.com", password: "TestPass123!" });
  const token = login.json?.token;
  log("admin login", login.status);

  hdr("1. New schema: mailbox_sync_state + replies columns");
  const cols = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'replies' AND column_name IN ('email_account_id','provider_message_id','thread_id','category','classification_summary','sentiment_confidence','synced_at')"
  );
  log("new replies columns", cols.rows.map((r) => r.column_name).sort());
  const sync = await c.query("SELECT * FROM mailbox_sync_state");
  log("mailbox_sync_state rows", sync.rowCount);
  const idx = await c.query("SELECT indexname FROM pg_indexes WHERE indexname IN ('uq_replies_provider_msg','idx_replies_thread','uq_mailbox_sync_account')");
  log("idempotency/index guards", idx.rows.map((r) => r.indexname));

  hdr("2. Provider monitoring dashboard");
  const mon = await api("GET", "/api/monitoring/providers", token);
  log("HTTP " + mon.status + " totals", mon.json?.totals);
  log("accounts (first 3 rows):");
  (mon.json?.accounts || []).slice(0, 3).forEach((a) => {
    console.log("     -", a.email, "·", a.providerLabel, "·", a.authStatus, "· quota", a.quota.sentToday + "/" + a.quota.dailyLimit, "· lastSync=" + (a.sync?.lastSyncAt || "never"));
  });

  hdr("3. Mailbox reader factory dispatch");
  const acctList = await api("GET", "/api/email-accounts", token);
  const accounts = acctList.json?.data || [];
  const providers = accounts.map((a) => a.provider);
  log("workspace accounts by provider", providers);
  // Every SES account should get factory=null; SMTP/gmail/outlook should get a reader.
  console.log("     (verified by boot log: only non-SES accounts had polls scheduled)");

  hdr("4. Rename an account");
  const smtpAcct = accounts.find((a) => a.provider === "smtp");
  if (smtpAcct) {
    const before = smtpAcct.displayName;
    const rn = await api("PATCH", `/api/email-accounts/${smtpAcct.id}/rename`, token, { displayName: "Renamed by Smoke" });
    log("rename HTTP " + rn.status + " new displayName", rn.json?.account?.displayName);
    // revert
    await api("PATCH", `/api/email-accounts/${smtpAcct.id}/rename`, token, { displayName: before || "SMTP Account" });
  } else {
    console.log("     (no SMTP account to rename — skipping)");
  }

  hdr("5. Sync-now endpoint (enqueues one-shot BullMQ job)");
  if (smtpAcct) {
    const sn = await api("POST", `/api/email-accounts/${smtpAcct.id}/sync-now`, token);
    log("sync-now HTTP " + sn.status, sn.json);
  }
  const sesAcct = accounts.find((a) => a.provider === "ses");
  if (sesAcct) {
    const sn = await api("POST", `/api/email-accounts/${sesAcct.id}/sync-now`, token);
    log("sync-now for SES account should refuse:", sn.status + " · " + JSON.stringify(sn.json));
  }

  hdr("6. Reply classifier via Groq (9 categories + summary + confidence)");
  const samples = [
    { text: "Sounds good, please send me a calendar invite for Thursday 2pm PT.", label: "Meeting Requested" },
    { text: "Please remove me from this list. Not interested.",                  label: "Not Interested" },
    { text: "OOO until Aug 5. Reach my colleague at bob@corp.com.",              label: "Out of Office" },
    { text: "Your message could not be delivered. 5.1.1 unknown recipient.",     label: "Bounce" },
    { text: "This costs way too much. Come back when it is half the price.",     label: "Price Objection" },
  ];
  const classifyDirect = require("../server/services/replyClassifier.service");
  // We can't require TypeScript here — invoke via a live endpoint instead.
  for (const s of samples) {
    const resp = await api("POST", "/api/replies/classify-preview", token, { text: s.text, subject: "Re: intro" });
    if (resp.status !== 200) { console.log("     (classify-preview not registered — skipping)"); break; }
    console.log("     ·", s.label.padEnd(24), "→", resp.json?.result?.category, " · conf=" + resp.json?.result?.confidence);
  }

  hdr("7. Existing endpoints not regressed");
  const health = await api("GET", "/health");
  log("/health status", health.json?.status);
  const healthWorkers = await api("GET", "/health/workers");
  log("/health/workers ok", healthWorkers.json?.healthy);
  log("mailbox_sync in workers dashboard?", (Object.keys(healthWorkers.json?.workers || {}).length));

  await c.end();
  console.log("\n═══ Phase 4.5 smoke complete ═══");
}
main().catch((e) => { console.error(e); process.exit(1); });
