// Phase 5 smoke — multi-step sequences, working calendar, rotation,
// stop conditions, retry, campaign dashboard, and REST verbs.
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

  hdr("1. New schema present");
  const cols = await c.query(
    "SELECT table_name, column_name FROM information_schema.columns " +
    "WHERE (table_name = 'sequence_steps' AND column_name IN ('step_index','ab_group','delay_hours','mode','ai_instruction')) " +
    "   OR (table_name = 'campaign_prospects' AND column_name IN ('current_step','status','stop_reason','next_send_at','ab_group')) " +
    "   OR (table_name = 'campaign_holidays' AND column_name IN ('date','scope')) " +
    "   OR (table_name = 'rotation_state' AND column_name IN ('cursor_index','total_picks','last_account_id')) " +
    "   OR (table_name = 'campaigns' AND column_name IN ('max_per_hour','max_per_day','goal','max_retries','default_tone','archived_at'))"
  );
  const seen = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
  const required = [
    "sequence_steps.step_index", "sequence_steps.ab_group", "sequence_steps.delay_hours", "sequence_steps.mode",
    "campaign_prospects.current_step", "campaign_prospects.status", "campaign_prospects.stop_reason", "campaign_prospects.next_send_at",
    "campaign_holidays.date", "rotation_state.cursor_index",
    "campaigns.max_per_hour", "campaigns.default_tone", "campaigns.goal", "campaigns.max_retries",
  ];
  const missing = required.filter((r) => !seen.has(r));
  if (missing.length > 0) {
    console.log("  ❌ MISSING columns:", missing);
    process.exit(2);
  }
  console.log("  ✓ all", required.length, "required columns present");

  hdr("2. Workers healthy (email-send + follow-up + mailbox-sync + sequence-tick + sequence-advance)");
  const health = await api("GET", "/health/workers", token);
  log("HTTP " + health.status + " healthy", health.json?.healthy);
  log("workers", health.json?.workers);

  // Safety net: add the test recipient to the workspace suppression list
  // BEFORE any campaign is enrolled so the emailDispatchService short-
  // circuits to FAILED instead of dispatching a real message. Prevents
  // the smoke test from ever generating a real bounce through SES / SMTP.
  const smokeRecipient = `smoke.${Date.now()}@example.com`;
  await api("POST", "/api/suppressions", token, {
    email: smokeRecipient,
    reason: "manual",
    notes: "phase5_smoke.cjs — dry-run guard so no real send leaves the box",
  });
  log("suppressed", smokeRecipient);

  hdr("3. Create/find campaign + build sequence");
  const campName = `Phase5-Smoke-${Date.now()}`;
  const created = await api("POST", "/api/campaigns", token, { name: campName });
  const campaign = created.json?.campaign;
  if (!campaign?.id) { console.log("  ❌ campaign create failed:", created.status, created.text); process.exit(3); }
  log("campaign id", campaign.id);
  await api("PUT", `/api/campaigns/${campaign.id}`, token, {
    scheduleDays: ["Monday","Tuesday","Wednesday","Thursday","Friday"],
    scheduleTimeStart: "09:00", scheduleTimeEnd: "17:00", timezone: "America/New_York",
    maxPerHour: 30, maxPerDay: 200, minGapSeconds: 30, maxGapSeconds: 120,
    goal: "Book a 15-min discovery call about our AI outbound platform.",
    defaultTone: "Consultative", maxRetries: 4,
  });

  const seqPayload = {
    steps: [
      { stepIndex: 0, mode: "manual", delayHours: 0, subject: "Quick thought for {{company}}", bodyText: "Hi {{firstName}},\n\n{{personalizedLine}}\n\nOpen to a 10-min chat?" },
      { stepIndex: 1, mode: "ai", delayHours: 72, aiInstruction: "Short bump. Reference the first email. Add one new angle." },
      { stepIndex: 2, mode: "ai", delayHours: 168, aiInstruction: "Case-study angle. Keep it tight; single CTA." },
      { stepIndex: 3, mode: "ai", delayHours: 288, aiInstruction: "Polite break-up email. Ask if it is the wrong time or wrong contact." },
    ],
  };
  const saved = await api("PUT", `/api/campaigns/${campaign.id}/sequence`, token, seqPayload);
  log("save sequence HTTP " + saved.status + " count", saved.json?.steps?.length);
  if (saved.status !== 200) { console.log("  raw:", saved.text.slice(0, 300)); process.exit(4); }

  hdr("4. Add a lead and enroll into campaign");
  const lead = await api("POST", `/api/campaigns/${campaign.id}/leads`, token, {
    email: smokeRecipient,
    firstName: "Test", lastName: "Prospect", company: "Acme LLC", personalizedLine: "loved the recent expansion",
  });
  const leadId = lead.json?.lead?.id;
  log("lead id", leadId);
  const enroll = await api("POST", `/api/campaigns/${campaign.id}/prospects/enroll`, token, {});
  log("enroll HTTP " + enroll.status, enroll.json);
  const prospects = await api("GET", `/api/campaigns/${campaign.id}/prospects`, token);
  log("prospects", prospects.json?.prospects?.length);
  const prospectId = prospects.json?.prospects?.[0]?.id;

  hdr("5. Preview + force-next-step");
  const preview = await api("GET", `/api/campaigns/prospects/${prospectId}/preview-next`, token);
  log("preview HTTP " + preview.status, preview.json?.preview?.subject);
  const force = await api("POST", `/api/campaigns/prospects/${prospectId}/force-next`, token);
  log("force HTTP " + force.status + " jobId", force.json?.jobId);

  hdr("6. Working-calendar next-send helper (unit-ish check via SQL)");
  const nowRows = await c.query(
    `SELECT current_step, next_send_at, ab_group, status FROM campaign_prospects WHERE id = $1`,
    [prospectId]
  );
  log("prospect row", nowRows.rows[0]);

  hdr("7. Skip lead + lifecycle (pause/resume/clone/archive)");
  const skip = await api("POST", `/api/campaigns/prospects/${prospectId}/skip`, token);
  log("skip HTTP " + skip.status, skip.json?.prospect?.currentStep);
  const pause = await api("POST", `/api/campaigns/${campaign.id}/pause`, token);
  log("pause HTTP " + pause.status, pause.json);
  const resume = await api("POST", `/api/campaigns/${campaign.id}/resume`, token);
  log("resume HTTP " + resume.status, resume.json);
  const clone = await api("POST", `/api/campaigns/${campaign.id}/clone`, token, { name: `${campName}-clone` });
  log("clone HTTP " + clone.status + " newId", clone.json?.campaign?.id + " steps=" + clone.json?.stepsCopied);
  const arch = await api("POST", `/api/campaigns/${campaign.id}/archive`, token);
  log("archive HTTP " + arch.status, arch.json);
  await api("POST", `/api/campaigns/${campaign.id}/unarchive`, token);

  hdr("8. Holiday add/list/remove");
  const holAdd = await api("POST", `/api/campaigns/${campaign.id}/holidays`, token, { date: "2026-12-25", name: "Christmas" });
  log("holiday add HTTP " + holAdd.status, holAdd.json?.holiday?.date);
  const holList = await api("GET", `/api/campaigns/${campaign.id}/holidays`, token);
  log("holiday list count", holList.json?.holidays?.length);
  const holidayId = holAdd.json?.holiday?.id;
  if (holidayId) {
    const holDel = await api("DELETE", `/api/campaigns/holidays/${holidayId}`, token);
    log("holiday del HTTP " + holDel.status, holDel.json);
  }

  hdr("9. Campaign dashboard (single + workspace)");
  const dash1 = await api("GET", `/api/campaigns/${campaign.id}/dashboard`, token);
  log("HTTP " + dash1.status + " buckets", dash1.json?.dashboard?.buckets);
  log("rates", dash1.json?.dashboard?.rates);
  const dashAll = await api("GET", `/api/campaigns/dashboard`, token);
  log("workspace campaigns", dashAll.json?.campaigns?.length);
  log("queues", Object.keys(dashAll.json?.queues || {}));

  hdr("10. Cancel a queued email (E2E through cancel endpoint)");
  const emailRows = await c.query(
    `SELECT id FROM emails WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [campaign.id]
  );
  const emailId = emailRows.rows[0]?.id;
  if (emailId) {
    const cancel = await api("POST", `/api/emails/${emailId}/cancel`, token);
    log("cancel HTTP " + cancel.status, cancel.json);
  } else {
    console.log("     (no email to cancel)");
  }

  hdr("11. Regression: existing endpoints still respond");
  const health1 = await api("GET", "/health");
  log("/health", health1.json?.status);
  const monitor = await api("GET", "/api/monitoring/providers", token);
  log("/api/monitoring/providers HTTP " + monitor.status + " totals", monitor.json?.totals);
  const classify = await api("POST", "/api/replies/classify-preview", token, { text: "Sounds good, schedule Thursday 2pm PT.", subject: "Re: intro" });
  log("classify HTTP " + classify.status + " category", classify.json?.result?.category);
  const oldCampaigns = await api("GET", "/api/campaigns", token);
  log("legacy /api/campaigns count", Array.isArray(oldCampaigns.json) ? oldCampaigns.json.length : oldCampaigns.json?.data?.length || 0);

  await c.end();
  console.log("\n═══ Phase 5 smoke complete ═══");
}
main().catch((e) => { console.error(e); process.exit(1); });
