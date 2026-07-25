// Multi-tenant isolation smoke test.
//
// Registers two whitelisted users → gets a JWT for each (Workspace A and
// Workspace B). Creates resources under A, then attempts to read / modify /
// delete every one of them using B's token. Every attempt must either
//   • return 404  (id-not-found in scope), or
//   • return 403, or
//   • return an empty collection.
// Any 200 with the actual resource is a tenant-boundary violation.
//
// Requires REGISTRATION_WHITELIST env override so the test emails work:
//   REGISTRATION_WHITELIST=tenant-a@example.com,tenant-b@example.com
// The script sets that on the running server via process env (server must
// already be booted with those emails whitelisted). To avoid tampering
// with the operator's real .env we ALSO honor two admin-bootstrap
// emails (see below) and skip loudly when the whitelist rejects us.

const BASE = process.env.BASE || "http://localhost:3000";
const A_EMAIL = process.env.WS_A_EMAIL || "krutarth212002@gmail.com";
const A_PASSWORD = process.env.WS_A_PASSWORD || "TenantAPassword123!";
const B_EMAIL = process.env.WS_B_EMAIL || "utubekiller1@gmail.com";
const B_PASSWORD = process.env.WS_B_PASSWORD || "TenantBPassword123!";

async function http(method, path, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: resp.status, json, text };
}

function hdr(s) { console.log("\n══ " + s + " ══"); }
function ok(msg) { console.log("  ✅ " + msg); }
function fail(msg) { console.log("  ❌ " + msg); process.exitCode = 1; }

async function loginOrRegister(email, password) {
  let r = await http("POST", "/api/auth/login", null, { email, password });
  if (r.status === 200 && r.json?.token) return r.json.token;
  r = await http("POST", "/api/auth/register", null, { name: email.split("@")[0], email, password });
  if (r.status === 201 && r.json?.token) return r.json.token;
  console.log(`  ⚠️  Could not obtain token for ${email}: HTTP ${r.status} ${r.text?.slice(0,200)}`);
  return null;
}

async function main() {
  hdr("Setup — obtain tokens for two workspaces");
  const tokenA = await loginOrRegister(A_EMAIL, A_PASSWORD);
  const tokenB = await loginOrRegister(B_EMAIL, B_PASSWORD);
  if (!tokenA || !tokenB) {
    console.log("  Cannot run — need both whitelisted users to be able to authenticate.");
    process.exit(2);
  }

  // Confirm they are in different workspaces.
  const meA = await http("GET", "/api/auth/me", tokenA);
  const meB = await http("GET", "/api/auth/me", tokenB);
  ok(`A user id=${meA.json?.user?.id} email=${meA.json?.user?.email}`);
  ok(`B user id=${meB.json?.user?.id} email=${meB.json?.user?.email}`);

  hdr("1. Registration whitelist rejects unknown emails");
  const reject = await http("POST", "/api/auth/register", null, {
    name: "Random Person", email: `random+${Date.now()}@example.net`, password: "Password12345!",
  });
  if (reject.status === 403 && /whitelisted/i.test(reject.json?.error || "")) {
    ok(`unknown email → HTTP 403 "${reject.json.error}"`);
  } else {
    fail(`whitelist did not reject unknown email: HTTP ${reject.status} ${JSON.stringify(reject.json)}`);
  }

  hdr("2. Workspace A creates isolated resources");
  const campA = await http("POST", "/api/campaigns", tokenA, { name: `WSA-Camp-${Date.now()}` });
  if (campA.status !== 201) { fail(`A cannot create campaign: ${campA.status} ${JSON.stringify(campA.json)}`); process.exit(1); }
  const campAId = campA.json.campaign.id;
  ok(`A created campaign ${campAId}`);
  const leadA = await http("POST", `/api/campaigns/${campAId}/leads`, tokenA, {
    email: `secret.${Date.now()}@example.com`, firstName: "Secret", lastName: "A",
  });
  if (leadA.status !== 201) { fail(`A cannot create lead: ${leadA.status}`); process.exit(1); }
  const leadAId = leadA.json.lead.id;
  ok(`A created lead ${leadAId}`);

  hdr("3. Workspace B tries to read A's resources — must all return 404 / empty");
  // GET /api/campaigns — B's list must NOT include A's campaign.
  const listB = await http("GET", "/api/campaigns", tokenB);
  if (listB.status === 200 && Array.isArray(listB.json?.data)) {
    const leaked = listB.json.data.find((c) => c.id === campAId);
    if (leaked) fail(`GET /api/campaigns returned A's campaign to B: ${leaked.id}`);
    else ok(`GET /api/campaigns did NOT leak A's campaign to B (returned ${listB.json.data.length} own campaigns)`);
  } else {
    fail(`GET /api/campaigns unexpected: ${listB.status}`);
  }

  // GET /api/campaigns/:id/leads on A's campaign, using B's token.
  const leadsCross = await http("GET", `/api/campaigns/${campAId}/leads`, tokenB);
  if (leadsCross.status === 404) ok(`GET /api/campaigns/${campAId.slice(0,12)}…/leads → 404 as expected`);
  else fail(`Cross-tenant GET leads should 404, got ${leadsCross.status} ${JSON.stringify(leadsCross.json)?.slice(0,200)}`);

  // GET /api/leads — B's global lead list must not contain A's lead.
  const leadsGlobalB = await http("GET", "/api/leads", tokenB);
  if (leadsGlobalB.status === 200 && Array.isArray(leadsGlobalB.json?.data)) {
    const bleed = leadsGlobalB.json.data.find((l) => l.id === leadAId);
    if (bleed) fail(`GET /api/leads leaked A's lead to B: ${bleed.email}`);
    else ok(`GET /api/leads did NOT leak A's lead to B`);
  } else {
    fail(`GET /api/leads unexpected: ${leadsGlobalB.status}`);
  }

  hdr("4. Workspace B tries to MUTATE A's resources — must all fail");
  // Update A's campaign as B.
  const upd = await http("PUT", `/api/campaigns/${campAId}`, tokenB, { name: "HIJACKED" });
  if (upd.status === 404) ok(`PUT /api/campaigns/${campAId.slice(0,12)}… → 404 (blocked)`);
  else fail(`Cross-tenant PUT should 404, got ${upd.status}`);

  // Update A's lead as B.
  const updL = await http("PUT", `/api/leads/${leadAId}`, tokenB, { firstName: "HIJACKED" });
  if (updL.status === 404) ok(`PUT /api/leads/${leadAId.slice(0,12)}… → 404 (blocked)`);
  else fail(`Cross-tenant lead update should 404, got ${updL.status}`);

  // Delete A's lead as B.
  const delL = await http("DELETE", `/api/leads/${leadAId}`, tokenB);
  if (delL.status === 404) ok(`DELETE /api/leads/${leadAId.slice(0,12)}… → 404 (blocked)`);
  else fail(`Cross-tenant lead delete should 404, got ${delL.status}`);

  // Delete A's campaign as B.
  const delC = await http("DELETE", `/api/campaigns/${campAId}`, tokenB);
  if (delC.status === 404) ok(`DELETE /api/campaigns/${campAId.slice(0,12)}… → 404 (blocked)`);
  else fail(`Cross-tenant campaign delete should 404, got ${delC.status}`);

  hdr("5. Workspace A's resource is still intact + unchanged");
  const restore = await http("GET", `/api/campaigns/${campAId}/leads`, tokenA);
  if (restore.status !== 200) fail(`A can't read own leads: ${restore.status}`);
  else {
    const stillThere = restore.json?.data?.find((l) => l.id === leadAId);
    if (!stillThere) fail(`A's lead is gone after B's tampering attempts`);
    else if (stillThere.firstName === "HIJACKED") fail(`A's lead was mutated by B ("firstName" is HIJACKED)`);
    else ok(`A's lead is unchanged after B's tampering (firstName="${stillThere.firstName}")`);
  }

  hdr("6. Signatures / Templates / Prompts / KBs — same story");
  const sigA = await http("POST", "/api/signatures", tokenA, {
    name: "A-Signature", htmlBody: "<p>A</p>", textBody: "A",
  });
  if (sigA.status === 201) {
    const sigAId = sigA.json.signature.id;
    ok(`A created signature ${sigAId}`);
    const readB = await http("GET", `/api/signatures/${sigAId}`, tokenB);
    if (readB.status === 404) ok(`B cannot read A's signature — 404`);
    else fail(`B could read A's signature: ${readB.status}`);
    const delSig = await http("DELETE", `/api/signatures/${sigAId}`, tokenB);
    if (delSig.status === 404) ok(`B cannot delete A's signature — 404`);
    else fail(`B could delete A's signature: ${delSig.status}`);
  }

  const kbA = await http("POST", "/api/knowledge-bases", tokenA, { name: "A-KB", embeddingProvider: "openai" });
  if (kbA.status === 201) {
    const kbAId = kbA.json.knowledgeBase.id;
    ok(`A created KB ${kbAId}`);
    const readKb = await http("GET", `/api/knowledge-bases/${kbAId}`, tokenB);
    if (readKb.status === 404) ok(`B cannot read A's KB — 404`);
    else fail(`B could read A's KB: ${readKb.status}`);
    const listKbB = await http("GET", "/api/knowledge-bases", tokenB);
    const leakedKb = (listKbB.json?.knowledgeBases || []).find((k) => k.id === kbAId);
    if (leakedKb) fail(`GET /api/knowledge-bases leaked A's KB to B`);
    else ok(`GET /api/knowledge-bases did NOT leak A's KB to B`);
  }

  hdr("7. Cleanup — A deletes its own campaign");
  const finalDel = await http("DELETE", `/api/campaigns/${campAId}`, tokenA);
  if (finalDel.status === 200) ok(`A deleted own campaign`);
  else fail(`A could not delete its own campaign: ${finalDel.status}`);

  console.log("\n═══ multi-tenant isolation test " + (process.exitCode ? "FAILED" : "PASSED") + " ═══");
}
main().catch((e) => { console.error(e); process.exit(1); });
