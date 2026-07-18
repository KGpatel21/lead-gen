#!/bin/bash
# Phase 3 smoke test — end-to-end verification of every new API surface.
set -e
TMP="C:/Users/kruta/AppData/Local/Temp/p3_test.json"
BASE="http://localhost:3000"

TOKEN=$(curl -sS -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"krutarth@example.com","password":"TestPass123!"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

hdr() { echo ""; echo "════ $1 ════"; }

hdr "1. Sender identities"
curl -sS -o "$TMP" -w "  create: HTTP %{http_code}\n" -X POST "$BASE/api/sender-identities" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"campaigns@outbound-example.dev","displayName":"Campaigns","dailySendLimit":250}'
SID=$(node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log(j.senderIdentity?.id||'')")
echo "  → id: $SID"
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log('  verification:',j.senderIdentity?.sesVerificationStatus,'daily:',j.senderIdentity?.dailySendLimit)"
curl -sS -o "$TMP" -w "  list: HTTP %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$BASE/api/sender-identities"
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log('  identities in DB:',j.data.length)"

hdr "2. Suppression list"
curl -sS -o "$TMP" -w "  add: HTTP %{http_code}\n" -X POST "$BASE/api/suppressions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"nocheck@bounced.test","reason":"manual"}'
curl -sS -o "$TMP" -w "  list: HTTP %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$BASE/api/suppressions"
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log('  suppressions total:',j.data.length)"
curl -sS -o "$TMP" -w "  remove: HTTP %{http_code}\n" -X DELETE "$BASE/api/suppressions/nocheck@bounced.test" \
  -H "Authorization: Bearer $TOKEN"

hdr "3. Follow-up rules"
CAMPID=$(curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/campaigns" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j.data[0].id)})")
echo "  campaign: $CAMPID"
curl -sS -o "$TMP" -w "  ensure-defaults: HTTP %{http_code}\n" -X POST "$BASE/api/campaign/$CAMPID/follow-ups/ensure-defaults" \
  -H "Authorization: Bearer $TOKEN"
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));(j.data||[]).forEach(r=>console.log('  step',r.step,'delay',r.delayDays,'d'))"

hdr "4. Templates v2 + variables + history"
curl -sS -o "$TMP" -w "  create: HTTP %{http_code}\n" -X POST "$BASE/api/templates/v2" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Discovery Reach","subject":"Quick idea for {{company}}","body":"Hi {{firstName}}, {{painPoint}}. Free {{slot}} to talk?","category":"Outbound"}'
TPLID=$(node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log(j.template?.id||'')")
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log('  → id:',j.template?.id,'vars:',JSON.stringify(j.template?.variables))"

curl -sS -o "$TMP" -w "  preview: HTTP %{http_code}\n" -X POST "$BASE/api/templates/v2/$TPLID/preview" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"variables":{"firstName":"Ada","company":"Analytical Engine","painPoint":"slow builds","slot":"Wed 2pm"}}'
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log('  subject:',j.preview?.subject);console.log('  body:',(j.preview?.body||'').slice(0,80))"

curl -sS -o "$TMP" -w "  update: HTTP %{http_code}\n" -X PUT "$BASE/api/templates/v2/$TPLID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"subject":"Quick idea for {{company}} - v2"}'
curl -sS -o "$TMP" -w "  history: HTTP %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$BASE/api/templates/v2/$TPLID/history"
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log('  versions:',j.data.length);(j.data||[]).forEach(v=>console.log('   · v'+v.version,':',v.subject))"
curl -sS -o "$TMP" -w "  duplicate: HTTP %{http_code}\n" -X POST "$BASE/api/templates/v2/$TPLID/duplicate" \
  -H "Authorization: Bearer $TOKEN"

hdr "5. BullMQ queue stats"
curl -sS -o "$TMP" -w "  stats: HTTP %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$BASE/api/queue/email/stats"
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log('  jobcounts:',JSON.stringify(j.stats))"

hdr "6. SNS signature guard"
curl -sS -o "$TMP" -w "  invalid: HTTP %{http_code}\n" -X POST "$BASE/api/ses/events" \
  -H "Content-Type: application/json" \
  -d '{"Type":"Notification","Message":"{}","MessageId":"fake","Signature":"invalid"}'
cat "$TMP"; echo ""

hdr "7. Tracking endpoints — invalid tokens"
curl -sS -o /dev/null -w "  /t/o/<bad>: HTTP %{http_code} content=%{content_type}\n" "$BASE/t/o/invalid.token"
curl -sS -o /dev/null -w "  /t/c/<bad>: HTTP %{http_code}\n" "$BASE/t/c/invalid.token"
curl -sS -o "$TMP" -w "  /unsubscribe/<bad>: HTTP %{http_code} content=%{content_type}\n" "$BASE/unsubscribe/invalid.token"

hdr "8. Tracking round-trip — valid HMAC token"
TOK=$(node --env-file=.env -e "
const crypto=require('crypto');
const secret=process.env.JWT_SECRET;
const payload={e:'em-fake-'+Date.now(),k:'o',t:Math.floor(Date.now()/1000)};
const b64=(s)=>Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+\$/,'');
const p=b64(JSON.stringify(payload));
const sig=crypto.createHmac('sha256',secret).update(p).digest();
const sigB=Buffer.from(sig).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+\$/,'');
console.log(p+'.'+sigB);
")
echo "  minted token: ${TOK:0:60}..."
curl -sS -o /dev/null -w "  /t/o/<valid>: HTTP %{http_code} content=%{content_type} size=%{size_download}\n" "$BASE/t/o/$TOK"

echo ""
echo "════════════ SMOKE TEST COMPLETE ════════════"
