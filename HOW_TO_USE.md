# Outbound.AI — How to Use

Complete step-by-step guide for using the portal. Written for founders, sales, and marketing — no coding required.

> If you're deploying the app, open `README.md` instead. If you want a compact feature reference, open `USER_GUIDE.md`.

---

## Table of Contents

1. [What this portal does](#1-what-this-portal-does)
2. [The 4 ways you can use Outbound.AI](#2-the-4-ways-you-can-use-outboundai)
3. [Your first 5 minutes — send your first email](#3-your-first-5-minutes--send-your-first-email)
4. [Full step-by-step — from zero to running campaign](#4-full-step-by-step--from-zero-to-running-campaign)
5. [Using Knowledge Bases (RAG) — the killer feature](#5-using-knowledge-bases-rag--the-killer-feature)
6. [How the email you send looks (the new design)](#6-how-the-email-you-send-looks-the-new-design)
7. [Reading + replying to incoming mail](#7-reading--replying-to-incoming-mail)
8. [Analytics + tracking what worked](#8-analytics--tracking-what-worked)
9. [Team, roles, and access](#9-team-roles-and-access)
10. [Troubleshooting](#10-troubleshooting)
11. [Glossary — plain English](#11-glossary--plain-english)

---

## 1. What this portal does

You have a product or service. You want to reach cold prospects and book meetings. Outbound.AI is the whole system:

- **Find** — Google Maps businesses, LinkedIn-style AI prospecting, or your own CSV.
- **Understand** — Uploads your case studies, pricing, services, portfolio into Knowledge Bases so the AI *knows* what you sell before writing anything.
- **Write** — AI drafts a personalized first email for every prospect using **facts** from your Knowledge Base + facts scraped from the prospect's own website.
- **Send** — From your own Gmail, Outlook, Amazon SES, or any SMTP inbox.
- **Follow up** — Automatic multi-step sequences. Stops the moment someone replies.
- **Track** — Opens, clicks, replies (auto-categorized into 9 buckets), bounces, meetings.
- **Reply** — Everything lands in one inbox; AI drafts your response.

All isolated per workspace. Your data never mixes with anyone else's.

---

## 2. The 4 ways you can use Outbound.AI

| # | You want to… | Use this flow | Time to first email |
|---|---|---|---|
| A | **Try it in 5 minutes** — send one real email to yourself or a friend | Add Gmail → Lead Discovery → Add to campaign → Sequence Builder → Enroll → Play | ~5 min |
| B | **Run a proper campaign** — 50-500 leads, tight targeting, follow-ups | Add Gmail + verify domain → Upload leads or use Lead Discovery → Create campaign → Assign Knowledge Bases + Signature + Template → Build 3-step sequence → Enroll → Play | ~30 min |
| C | **Scale to thousands** — multiple inboxes, sender pools, high volume | Add 5+ inboxes → Create Sender Pool → Verify domain → Upload big CSV → Assign KB + prompt → Longer sequence → Enroll → Play. **The system rotates automatically.** | ~1 hour setup, then autopilot |
| D | **Just draft one email** — no sending, get an AI-drafted email you can copy/paste | Sequence Builder → Preview Next → Copy the output. Great for hand-crafted outreach. | ~1 min |

You can also **combine** flows — e.g. use Discovery to build a list of 50 leads, then run flow B on those.

---

## 3. Your first 5 minutes — send your first email

Goal: your first real email goes out in under 5 minutes.

### Minute 1 — Sign in

- Open the URL your admin gave you.
- Click **Register**. Only whitelisted emails may register — if yours isn't on the list, you'll see:
  > *Only whitelisted users are allowed to register. Please contact the administrator.*
- If you're whitelisted, register normally. A brand-new workspace is created just for you.

### Minute 2 — Connect Gmail

- Sidebar → **SMTP Accounts Router** → **+ Add**.
- Email = your Gmail. SMTP Host + Port pre-filled.
- **Password field**: paste a Gmail App Password, not your normal password. Get one from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (2 min setup, needs 2-step verification).
- **Save**. Click **Test Connection** — green tick means you're wired.

Outlook / Zoho / Titan / any SMTP works the same — just different host + port.

### Minute 3 — Find a lead

- Sidebar → **Lead Discovery**.
- Search e.g. `dental clinics in Austin`.
- Tick one interesting result. Click **Analyze Selected**. Wait a few seconds — the AI reads their website.

### Minute 4 — Create campaign + add the lead

- Sidebar → **Outreach Campaigns** → **+ New Campaign**.
- Give it a clear name (`Austin Dental Test`).
- Open it → Leads tab → **From Discovery** (or manually enter one).

### Minute 5 — Send

- Sidebar → **Sequence Builder** → pick your campaign.
- Two starter steps are pre-loaded. Leave them.
- Click **Enroll all leads** → ▶ **Play**.

Your first email is queued. Check the **Queue** tab — counter should be moving.

That's it. First cold email out via Outbound.AI.

---

## 4. Full step-by-step — from zero to running campaign

For anyone doing it properly. ~30-60 minutes end-to-end.

### Step 1 — Verify your sending domain (10 min, one-time)

- Sidebar → **DNS & Verified Domains** → **+ Add Domain**.
- Enter the domain part of your email (`yourcompany.com`).
- Copy the three DNS records (SPF, DKIM, DMARC) and paste them into your registrar's DNS panel (GoDaddy, Cloudflare, Route53, Namecheap, etc.).
- Come back and click **Verify Domain**. All three should turn green in under 10 minutes.

**Why it matters**: emails from an unverified domain go to spam. This is the single biggest deliverability lever.

### Step 2 — Connect one or more sending inboxes

- Sidebar → **SMTP Accounts Router** → **+ Add**.
- Recommended defaults: `Daily limit = 50` for the first 2 weeks. Warmup **ON**.
- For scale, add multiple inboxes (`sales@`, `hello@`, `krutarth@`). The system will rotate automatically.

### Step 3 — Build your Knowledge Base (10 min, huge payoff)

This is what makes the AI actually good. Skip it and you get generic emails. Do it and you get emails that reference your real case studies, pricing, product features.

- Sidebar → **Knowledge Center** → **Knowledge Bases** tab → **+ New**.
- Create one KB per topic. Common setups:
  - **Company Profile** — your one-pager, About-Us, elevator pitch.
  - **Pricing** — your pricing PDF or a text file with tier details.
  - **Case Studies** — customer success stories (PDFs from your marketing site work great).
  - **Portfolio** — sample work, deliverables.
  - **AI Services / Manufacturing / whatever verticals you sell to** — one KB per vertical.
- Upload files. Supported: **PDF, DOCX, TXT, MD, CSV, HTML**.
- The system extracts text → chunks it → generates embeddings → stores vectors. Watch each file's status pill:
  - `PENDING` → `EXTRACTING` → `CHUNKING` → `EMBEDDING` → `READY` (green) ✅
- Use the **test-search widget** at the bottom of each KB to sanity-check retrieval. Ask "what does the product do?" and you should see chunks from your Company Profile come up first.

### Step 4 — Create a signature

- Sidebar → **Knowledge Center** → **Signatures** tab → **+ New**.
- Fill in your name, title, company, phone, LinkedIn.
- Provide both `HTML body` (rich) AND `Plain-text body` (fallback). The system uses HTML in email clients that support it, text elsewhere.
- Tick **"Use as workspace default signature"** to auto-apply everywhere.

### Step 5 — Create an email template (optional)

- Sidebar → **Knowledge Center** → **Email Templates** tab → **+ New**.
- Set subject + HTML + text. Use variables:
  - `{{firstName}}` `{{lastName}}` `{{company}}` `{{industry}}` `{{city}}`
  - `{{personalizedLine}}` — auto-generated per-recipient personalization
  - `{{signature}}` — your signature (auto)
  - `{{unsubscribe}}` — CAN-SPAM unsub link (auto)

Skip this if you want the AI to write from scratch every time (that's usually higher-performing).

### Step 6 — Create prompts (optional)

- Sidebar → **Knowledge Center** → **Prompt Library** tab → **+ New**.
- Example prompt: *"Write a punchy 90-word cold email. Reference one specific fact about the prospect's business. Single CTA to book a 15-min call. Tone: consultative, not salesy."*
- Save it. You'll pick this prompt per-campaign later.

### Step 7 — Find leads

Three ways:

**Google Maps**: Sidebar → **Lead Discovery** → search → tick businesses → **Analyze Selected**.

**AI Lead Finder**: Sidebar → **AI Lead Finder** → topic + platform + count → AI returns leads.

**CSV upload**: campaign → Leads tab → **Upload CSV**. Minimum column: `email`. Optional: `firstName`, `lastName`, `company`, `personalizedLine`.

### Step 8 — Create a campaign

- Sidebar → **Outreach Campaigns** → **+ New Campaign**.
- Name it clearly (e.g. `Q3 SaaS Founders — US`).

Then open the campaign → **Sequence Builder** and configure it:

**Schedule tab** — set the calendar rules:
- Working days: Mon–Fri.
- Send window: 09:00–17:00 in the **prospect's** timezone.
- Timezone: `America/New_York` (or wherever your leads are).
- Max/hour: 30–60. Max/day: 200–500.
- Gap between sends: 30–180 seconds (random, human-like).
- **Goal** (one sentence): *"Book a 15-min discovery call to demo our AI outbound platform."*

### Step 9 — Assign resources (this is where Knowledge Bases plug in)

- Same campaign → Sequence Builder → **Resources** tab.
- **Knowledge Bases**: tick the ones the AI should draw from. Recommended for most campaigns: *Company Profile + Pricing + Case Studies + your vertical-specific KB*. Multiple is fine — the AI blends them.
- **Email Templates**: pick one to enforce structure, or leave blank for the AI to write free-form.
- **Signatures**: tick which signatures may be used. Choose **one primary** — that's what gets appended.
- **Prompt Library**: pick one prompt to shape tone/style.

Click **Save resources**.

### Step 10 — Build the sequence

- Same campaign → Sequence Builder → **Builder** tab.
- Delete the starter steps.
- Add these 4:

| Step | Delay | Mode | AI instruction |
|---|---|---|---|
| 0 | now | AI | The opener — reference something specific about them. |
| 1 | 72 hours | AI | Short bump. New angle. No repetition of Step 0. |
| 2 | 168 hours | AI | Case-study angle. Prove value. Single CTA. |
| 3 | 288 hours | AI | Polite break-up: "Should I close the loop?" |

Save sequence.

### Step 11 — Enroll leads

- Same campaign → Sequence Builder → **Builder** tab → **Enroll all leads**.
- Every lead now has a status (`active`) and a computed `next_send_at` (respecting your schedule).

### Step 12 — Go live

- Sequence Builder → **Queue** tab → ▶ **Resume** (or from Outreach Campaigns page click Play).

The system now:
- Waits for business hours in the prospect's timezone.
- Composes each email at send time using: prospect facts (scraped from their site) + your Knowledge Bases + your prompt + your template + your signature.
- Rotates across your connected inboxes.
- Automatically stops any lead who replies, books a meeting, unsubscribes, bounces, or complains.
- Retries transient failures with exponential backoff.

Leave it running.

---

## 5. Using Knowledge Bases (RAG) — the killer feature

**The point**: instead of the AI hallucinating what your company does, it retrieves *your actual facts* from documents you uploaded, and only writes emails using those facts.

### How it works, step by step

1. You upload a **PDF/DOCX/TXT** to a Knowledge Base.
2. The system **extracts the text** (real `pdf-parse` / `mammoth` — not just filename metadata).
3. Text is **chunked** into 1200-character overlapping windows.
4. Each chunk is **embedded** (turned into a 1536-dim vector) using your chosen provider — OpenAI, Voyage, Gemini, or a local Ollama model.
5. Vectors are **stored in Postgres** alongside the source text.
6. When it's time to write an email to Priya @ Acme, the system:
   - Builds a query from: campaign goal + prospect's company name + industry + personalization facts.
   - Embeds that query with the same provider.
   - Runs **cosine similarity** across all vectors in your selected KBs.
   - Returns the top-6 most relevant chunks.
   - Feeds those chunks into the LLM under a **"COMPANY KNOWLEDGE — never contradict these facts"** header.
7. The LLM writes an email that references those exact facts.

Result: the AI never invents pricing, features, or case studies. If you didn't upload it, it can't say it.

### What to put in your Knowledge Base

| KB | Contents |
|---|---|
| **Company Profile** | One-page overview. Elevator pitch. Founding story. Who you're for. |
| **Pricing** | Tier names, prices, what's included. |
| **Case Studies** | 2-4 paragraph stories. Customer name, problem, solution, measurable result. Two or three of these dramatically improve reply rates. |
| **Product Features** | Feature list. What each does. When to mention it. |
| **Portfolio** | Sample projects, deliverables, screenshots-as-text. |
| **Vertical KBs** | One per industry — e.g. `Healthcare KB`, `Manufacturing KB`, `SaaS KB`. Contains pitches and case studies relevant to that vertical. Assign per-campaign. |

### Combining multiple KBs on one campaign

You **can and should** assign multiple KBs to one campaign. The AI's query hits all of them at once and picks the top-K chunks across the whole pool.

Example: campaign targeting AI startups →
- ✓ Company Profile (always)
- ✓ Case Studies (always)
- ✓ Pricing (so the AI can quote correctly if asked)
- ✓ AI-vertical KB (case studies specific to AI companies)
- ✗ Manufacturing KB (irrelevant — leave off)

### Testing your KB before sending real emails

Open any Knowledge Base → scroll to **Test vector search**. Type a question the way a prospect might phrase it. You'll see the top matching chunks with cosine scores. If the top result is garbage, your file wasn't extracted well — try re-uploading as a plain `.txt` file.

### Embedding provider choice

| Provider | When to use | Cost |
|---|---|---|
| **OpenAI** (default) | Most common; great quality; ~$0.02 per million tokens | Cheap |
| **Voyage** | State-of-the-art quality; slightly better retrieval than OpenAI | Cheap |
| **Gemini** | You already have a Gemini API key | Cheap |
| **Ollama** (local) | Air-gapped / privacy-sensitive; runs on your own hardware | Free |

The provider is picked **per Knowledge Base** at creation time. Don't mix providers within one KB.

---

## 6. How the email you send looks (the new design)

Every email that leaves the system now goes through a **professional email shell**:

- **600px wide, table-based** — renders correctly in Gmail, Outlook (all versions), Apple Mail, Yahoo, and mobile clients.
- **Mobile-responsive** — collapses to full width on phones.
- **Preheader text** — the one-line preview shown next to the subject in the inbox list.
- **Accent brand color** — a thin bar at the top of the email in your brand color.
- **Typographic hierarchy** — first paragraph is slightly bolder (functions as opening hook), rest is standard body.
- **CTA auto-buttons** — links whose text starts with "book", "schedule", "reply", "download", "get", "try", "meet" (etc.) automatically become styled buttons in your brand color.
- **Signature block** — separated by a subtle divider, muted text.
- **CAN-SPAM footer** — company name, physical postal address, one-click unsubscribe link.
- **Invisible tracking pixel** — for open detection.
- **Click-tracked links** — all `<a href>` links are rewritten to route through your tracking endpoint.

Before this release, emails were raw HTML from the AI — plain text or basic paragraphs. Now they land in your prospect's inbox looking like a designed marketing email but personal in tone.

### See it yourself

After deploying, generate a preview by running:

```bash
npx tsx scripts/preview_email.ts
```

That writes a sample HTML to `dist/email_preview.html`. Open it in a browser to see the exact shell prospects will receive.

### What the AI still controls vs. what the shell adds

The AI produces the **body content** (opening line + paragraphs + inline links). The shell adds:

- Container + accent bar
- Preheader
- CTA button styling
- Signature separator
- Footer + tracking

If the AI writes:

```
Hi Priya,

Saw your team just posted three AE roles. We help teams like yours...

Book a 15-min chat next Tuesday?

— Krutarth
```

The prospect sees a beautifully-formatted email with **"Book a 15-min chat"** rendered as a big blue button, your signature below a divider, and CAN-SPAM footer at the bottom.

---

## 7. Reading + replying to incoming mail

- Sidebar → **Replies Intelligent Box**.
- Every reply lands here, sorted newest first, auto-tagged into one of 9 buckets:

  🟢 **Interested** · 📅 **Meeting Requested** · ❓ **Need More Information**  
  💰 **Price Objection** · 🔴 **Not Interested** · 🏝️ **Out of Office**  
  🤖 **Auto Reply** · 🚫 **Spam Complaint** · ⚠️ **Bounce**

- Click a reply → see the AI-generated one-sentence summary + full thread.
- Click **Generate AI Draft** to get a suggested response you can edit and send.
- Everyone who replies is **automatically removed from all follow-ups** across every campaign in your workspace.

---

## 8. Analytics + tracking what worked

**Global**: Sidebar → **Analytics Dashboard** — all-time totals, active campaigns, average open/reply rates, recent replies feed.

**Per campaign**: Sequence Builder → **Analytics** tab —
- Reply rate (the only rate that matters)
- Meeting rate (even better)
- Open rate (grain of salt — proxies inflate)
- Bounce rate (keep < 5%)
- Per sender + per provider breakdowns

**Live queue**: Sequence Builder → **Queue** tab — real-time counts of queued / sending / completed / paused / failed / waiting emails.

---

## 9. Team, roles, and access

- Sidebar → **Team Management** → invite by email.
- **Only whitelisted emails may register.** If you invite someone whose email isn't whitelisted, their registration will be blocked. Ask an admin to add them to `REGISTRATION_WHITELIST` (env var).
- Every workspace is fully isolated. A user in Workspace A can never see, read, or mutate anything in Workspace B — enforced at the database layer.

---

## 10. Troubleshooting

**"Only whitelisted users are allowed to register"** — expected. Your email isn't on the whitelist. Ask the admin to add you.

**"Failed to fetch" toasts** — refresh the page. Silent poll retries handle transient errors; if you still see it after a refresh, the server is likely down.

**Emails go to spam** — verify your domain (§4 step 1). Keep warmup ON. Start at 50 emails/day for the first two weeks.

**AI is generic / doesn't mention my product** — you haven't assigned Knowledge Bases to the campaign. Go to Sequence Builder → Resources → tick your KBs → Save.

**AI hallucinates features you don't have** — your Knowledge Base is missing that info. Add a document containing your real feature list.

**High bounce rate** — your list is bad. Filter your CSV to only emails you're confident exist. Cold-email vendors like Anymail Finder or Hunter validate before returning results.

**No replies at all after 100+ sends** — your copy is the problem, not the platform. Re-read the sequence, shorten the emails, ensure they reference specific facts about the prospect.

**Container "server does not support SSL"** — you're running an old backend image. `git pull && docker compose build backend && docker compose up -d backend`.

---

## 11. Glossary — plain English

| Term | Meaning |
|---|---|
| **Workspace** | Your isolated container of campaigns / leads / data. One per registered user. Nobody else can see your data. |
| **Knowledge Base (KB)** | A folder of uploaded documents (PDF/DOCX/etc.) that the AI reads before writing. |
| **RAG** | Retrieval-Augmented Generation. Fancy name for "the AI looks up your KB before writing". |
| **Embedding** | A math-vector representation of a chunk of text. Enables similarity search. |
| **Chunk** | A ~1200-character piece of a document. The unit of retrieval. |
| **Similarity search** | Given a query, find the top-N most similar chunks. Cosine-distance based. |
| **Sequence** | The ordered list of emails: first email + follow-ups. |
| **Prospect** | A single lead's journey through one campaign. Has status (active/paused/stopped/completed) and next-send-at. |
| **Warmup** | Slowly increasing daily send volume so mailbox providers trust you. |
| **Suppression list** | People who will never be emailed again — bounces, complaints, unsubscribes, manual. |
| **Sender pool** | A group of your sending inboxes. Rotates across them. |
| **CAN-SPAM** | US law requiring physical postal address + unsubscribe link in every commercial email. The platform enforces both. |
| **Preheader** | The one-line preview shown next to the subject in your inbox. |
| **CTA** | Call to action — the one thing you want the prospect to do (e.g. "Book a chat"). |

---

## Cheat sheet — what does what

| I want to… | Go here |
|---|---|
| Add a Gmail / Outlook / SMTP inbox | SMTP Accounts Router |
| Verify my sending domain | DNS & Verified Domains |
| Upload company docs so the AI knows my product | Knowledge Center → Knowledge Bases |
| Save a signature | Knowledge Center → Signatures |
| Save a reusable email template | Knowledge Center → Email Templates |
| Save a reusable prompt | Knowledge Center → Prompt Library |
| Find businesses to email | Lead Discovery *or* AI Lead Finder |
| Import a lead CSV | Campaigns → open campaign → Upload CSV |
| Create a campaign | Outreach Campaigns → + New |
| Set schedule / hours / caps | Sequence Builder → Schedule tab |
| Pick which KBs / templates / signature / prompt this campaign uses | Sequence Builder → Resources tab |
| Design the multi-step follow-up | Sequence Builder → Builder tab |
| See what will be sent next | Sequence Builder → Builder → Preview Next |
| Pause / resume / clone a campaign | Sequence Builder → Queue tab |
| Read + reply to incoming mail | Replies Intelligent Box |
| See real-time send counts | Sequence Builder → Queue tab |
| See reply / open / bounce rates | Sequence Builder → Analytics tab |
| Global dashboard across everything | Analytics Dashboard |
| Add a team member | Team Management |

That's every screen. Start with **§3 (5-minute path)** to feel the shape, then run through **§4** for a real campaign.

Good selling.
