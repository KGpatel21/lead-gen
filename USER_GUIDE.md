# Outbound.AI — User Guide

A step-by-step manual for using the platform. Written for founders, salespeople, and marketers — no coding needed.

If you are looking for the developer / server-setup docs, open `README.md` instead.

---

## Table of Contents

1. [What Outbound.AI does](#1-what-outboundai-does)
2. [First-time login](#2-first-time-login)
3. [The main menu](#3-the-main-menu)
4. [Step 1 — Connect a sending email](#4-step-1--connect-a-sending-email)
5. [Step 2 — Verify your sending domain](#5-step-2--verify-your-sending-domain)
6. [Step 3 — Find leads](#6-step-3--find-leads)
7. [Step 4 — Create a campaign](#7-step-4--create-a-campaign)
8. [Step 5 — Build a multi-step sequence](#8-step-5--build-a-multi-step-sequence)
9. [Step 6 — Add leads to a campaign](#9-step-6--add-leads-to-a-campaign)
10. [Step 7 — Start sending](#10-step-7--start-sending)
11. [Watching replies come in](#11-watching-replies-come-in)
12. [Analytics dashboard](#12-analytics-dashboard)
13. [Common tasks](#13-common-tasks)
14. [If something goes wrong](#14-if-something-goes-wrong)
15. [Glossary — plain-English word list](#15-glossary--plain-english-word-list)

---

## 1. What Outbound.AI does

Outbound.AI is a **cold-email platform**. In one sentence: it helps you find businesses, write personal emails to them, send those emails from your own inbox, and then follow up automatically until they reply.

You give it:

- Who you want to reach (e.g. *"dental clinics in Austin"*).
- Your sending email account (Gmail, Outlook, Zoho, Amazon SES, or any SMTP).
- Your value pitch (what you sell, who you sell to).

It gives you back:

- A list of real businesses that match, with real websites and contact info.
- A personalized first email + up to unlimited follow-ups written by AI.
- Automatic sending on a schedule you control (business hours, weekdays, timezones).
- Automatic stop the moment someone replies — no accidental follow-ups after a "yes" or a "no thanks".
- A live dashboard showing opens, replies, meetings booked, bounces.

That's it. You don't need to know how any of the tech works.

---

## 2. First-time login

1. Open your browser and go to the URL your admin gave you.
   - On a laptop: usually `http://localhost:3000`.
   - On a cloud server: something like `http://your-server-ip` or `https://your-domain.com`.
2. You will see a login screen.
3. First time only — click **Register**. Enter your name, email, and a password (at least 8 characters).
4. From then on, click **Login** and use the same email + password.

Forgot your password? Ask your admin to reset it — there is no self-service reset yet.

---

## 3. The main menu

Once you're logged in, the left sidebar is your control center. Here's what each item does in one line:

**Cold emailing pipeline**

| Menu item | What it's for |
|---|---|
| **Analytics Dashboard** | Big-picture numbers: total sent, open rate, reply rate, active campaigns. |
| **Lead Discovery** | Search Google Maps for real businesses to email. |
| **CRM Pipeline Board** | See every prospect as a card, drag them between stages (New → Interested → Meeting Booked → Closed). |
| **AI Lead Finder** | Ask the AI to build a lead list from just a topic + platform. |
| **Outreach Campaigns** | Your list of campaigns. Create, pause, resume, delete. |
| **Sequence Builder** | Design the multi-step follow-up flow for a campaign (Day 0 → Day 3 → Day 7 → …). |
| **SMTP Accounts Router** | Connect the email inboxes you'll send from. |
| **DNS & Verified Domains** | Add your sending domain and check SPF/DKIM/DMARC health. |
| **Replies Intelligent Box** | Every reply that came back, tagged by AI (Interested / Meeting / Not Interested / Out of Office / Bounce / etc.). |
| **Template Custom Writer** | Save and re-use email templates. |

**System options**

| Menu item | What it's for |
|---|---|
| **Enterprise & Deliverability Hub** | Advanced monitoring for the pros. |
| **Team Management** | Invite colleagues. |
| **Campaign Settings** | App-wide preferences. |

---

## 4. Step 1 — Connect a sending email

Before you can send anything, you need at least one **sending email** — the inbox your messages will go out from.

The platform supports four types:

1. **Gmail** (with a special "app password" — see below).
2. **Outlook / Microsoft 365**.
3. **Amazon SES** (best for high volume — 100+ per day).
4. **Any other SMTP** — Zoho, Titan, GoDaddy, Fastmail, Hostinger, cPanel, Yahoo, etc.

### Adding a Gmail account (most common)

1. Click **SMTP Accounts Router** in the sidebar.
2. Click the **+ Add SMTP Account** button.
3. Fill in the form:
   - **Email**: your full Gmail address (e.g. `you@gmail.com`).
   - **SMTP Host**: `smtp.gmail.com` (already filled in).
   - **SMTP Port**: `465` (already filled in).
   - **Username**: same as your email.
   - **Daily limit**: how many emails per day you want to send from this inbox. Start with 50. Raise slowly over 2–4 weeks up to 200.
   - **Warmup**: keep this ON. It gently ramps your sending volume so Gmail doesn't flag you.
   - **SMTP Password**: this is **NOT** your Gmail password. Read the next paragraph.
4. Click **Save**.

**Getting a Gmail App Password (2 minutes)**

Gmail refuses to accept your normal password from apps. You need a special "app password".

1. Open [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) in a new tab.
2. If it asks you to turn on 2-Step Verification first, do that (it takes 1 minute).
3. Under **App name**, type `Outbound.AI` and click **Create**.
4. Google will show a 16-character password like `abcd efgh ijkl mnop`. Copy it.
5. Paste it into the **SMTP Password** field in Outbound.AI (spaces are fine — the platform ignores them).
6. Click **Save**.
7. Click **Test Connection** next to the newly saved account. You should see a green check.

### Adding an Outlook / Microsoft 365 account

Same as Gmail but with these settings:
- **SMTP Host**: `smtp-mail.outlook.com`
- **SMTP Port**: `587`
- **Password**: your Outlook password (or an app password if 2FA is on).

### Adding Amazon SES (for higher volume)

Ask your admin — SES needs an AWS account and DNS setup. Once configured, it appears as one more account in the same list.

### Adding any other provider

Any provider that supports SMTP works. Just enter the SMTP host + port + username + password from your provider's documentation.

---

## 5. Step 2 — Verify your sending domain

**Why it matters**: emails sent from an unverified domain land in spam. Verifying takes 5 minutes and dramatically improves inbox placement.

1. Click **DNS & Verified Domains** in the sidebar.
2. Click **+ Add Domain**.
3. Enter your sending domain (e.g. `yourcompany.com` — the part after the `@` in your email).
4. The platform shows you three DNS records to add:
   - **SPF** — tells the world what servers are allowed to send from your domain.
   - **DKIM** — a cryptographic signature that proves the email is really from you.
   - **DMARC** — instructions for what mailboxes should do when they get an email that fails SPF or DKIM.
5. Copy each record. Go to your domain registrar (GoDaddy, Namecheap, Cloudflare, Route 53, etc.) and paste them into your DNS.
6. Come back to Outbound.AI and click **Verify Domain**.
7. Wait up to 24 hours (usually just a few minutes). All three checks should turn green.

If any check stays red, your domain registrar has instructions specific to their interface — search "how to add TXT record on [your registrar]".

---

## 6. Step 3 — Find leads

You have three ways to build a lead list.

### Option A — Lead Discovery (best for local businesses)

1. Click **Lead Discovery** in the sidebar.
2. Type a search like `dental clinics in Austin` or `roofing companies in Miami`.
3. Click **Search**.
4. You'll see a grid of real businesses pulled from Google Maps: name, address, phone, website, rating, review count.
5. Tick the boxes next to businesses you want to add. Click **Analyze Selected**.
6. The system visits each website and pulls out the business's services, tech stack, about-us text, emails, phones, and social links. This is your fact sheet.
7. Businesses that pass analysis are ready to email.

### Option B — AI Lead Finder

For when you want people on a specific platform (LinkedIn, etc.).

1. Click **AI Lead Finder**.
2. Enter a **topic** (e.g. `SaaS founders`), a **platform** (e.g. `LinkedIn Profiles`), and a **count** (e.g. `20`).
3. Click **Find Leads**. The AI returns a list of prospects with names, companies, emails, and a personalized opener for each.

### Option C — Upload your own CSV

1. Go to **Outreach Campaigns** → open a campaign → **Upload CSV**.
2. Your CSV needs a column called `email` at minimum. Optional columns: `firstName`, `lastName`, `company`, `personalizedLine`.
3. Paste the CSV text into the box. Click **Import**.
4. The system shows how many were added, how many were duplicates, and how many were invalid.

---

## 7. Step 4 — Create a campaign

A **campaign** is a group of leads plus the plan for how you'll email them.

1. Click **Outreach Campaigns**.
2. Click **+ New Campaign**.
3. Give it a clear name like `Q3 Dental Clinics Austin` — you'll thank yourself later.
4. (Optional) Fill in a starter subject and body template. You can change these later or let AI write them per-lead.
5. Click **Create**.

Your new campaign appears in the list with status **Draft**. It won't send anything until you switch it to **Running**.

### Campaign settings (worth 30 seconds)

Open the campaign → **Schedule** tab. Set:

- **Working days**: usually Mon–Fri.
- **Send window**: `09:00` to `17:00` is typical.
- **Timezone**: yours, or the prospect's if you're targeting a specific region.
- **Max per hour / Max per day**: safety caps. 60/hour and 500/day are safe defaults.
- **Gap between sends**: 30–180 seconds. Adds random human-like jitter.
- **Goal**: one sentence like "Book a 15-min discovery call". The AI reads this.

---

## 8. Step 5 — Build a multi-step sequence

This is what makes cold email actually work. Most replies come from follow-up #2 or #3, not the first email.

1. Click **Sequence Builder** in the sidebar.
2. Select your campaign at the top.
3. You'll see the **Builder** tab with two example steps. Delete them or edit them.

### For each step, decide:

- **Step number**: 0 is the first email, then 1, 2, 3, … for follow-ups.
- **Delay**: how many hours to wait after the previous step. Typical schedule:
  - Step 0 — immediate.
  - Step 1 — after 72 hours (3 days).
  - Step 2 — after 168 hours (7 days).
  - Step 3 — after 288 hours (12 days) — the polite break-up email.
- **Mode**:
  - **AI generated** — you give a one-line instruction and the AI writes the message using the prospect's website facts. Recommended for follow-ups.
  - **Manual template** — you write the subject + body yourself. Recommended for the first email if you want tight control.
- **Subject** — supports these placeholders:
  - `{{firstName}}` — becomes the lead's first name
  - `{{company}}` — becomes their company
  - `{{personalizedLine}}` — becomes an AI-written detail about them
- **Body** — same placeholders. Keep it short. 90–140 words is best.
- **AI Instruction** (only for AI mode) — e.g. *"Short bump. Reference the first email. Try a new angle."*

### Add, remove, reorder steps

- **+ Add follow-up** at the bottom adds a new step.
- Each step card has ▲ / ▼ arrows to move it up or down.
- The trash icon deletes a step.

Click **Save sequence** when you're happy. Peek at the **Timeline** tab to see the estimated schedule laid out visually.

---

## 9. Step 6 — Add leads to a campaign

You have leads (from Step 3) and you have a campaign with a sequence (from Steps 4–5). Now connect them.

1. Open your campaign in **Outreach Campaigns**.
2. Click the **Leads** tab.
3. Either:
   - Click **+ Add Lead** and type in one manually, or
   - Click **Upload CSV** and paste a CSV, or
   - Come from **Lead Discovery** — the "Push to campaign" button sends selected businesses directly.

Once leads are in the campaign, click the **Sequence Builder** → **Builder** tab and hit **Enroll all leads**. Every lead now has a per-prospect state:

- **Current step**: which email is due next.
- **Next send at**: the exact time it will go out (respecting your working days + hours + timezone).
- **Status**: `active`, `paused`, `stopped`, or `completed`.

---

## 10. Step 7 — Start sending

1. In **Outreach Campaigns**, find your campaign and click the ▶ **Play** button, OR from **Sequence Builder** → **Queue** tab → click **Resume**.
2. Campaign status switches to **Running**.
3. Emails start going out at the next allowed send time (respecting your schedule).

You can leave it running. The system will:

- Wait for the correct business hours in the prospect's timezone.
- Rotate between your sending inboxes (if you have more than one).
- Add a random pause between sends so it looks human.
- Automatically stop a lead the moment they reply, book a meeting, unsubscribe, or bounce.
- Retry failed sends up to 5 times with exponential backoff.

---

## 11. Watching replies come in

1. Click **Replies Intelligent Box**.
2. Every incoming reply appears here, sorted by newest first.
3. Each reply is auto-tagged by AI into one of nine categories:

   | Category | What it means |
   |---|---|
   | 🟢 **Interested** | They want to hear more. |
   | 📅 **Meeting Requested** | They asked for time on your calendar. |
   | ❓ **Need More Information** | They have questions. Answer them. |
   | 💰 **Price Objection** | Cost is the issue. |
   | 🔴 **Not Interested** | Move on. |
   | 🏝️ **Out of Office** | Follow up when they're back. |
   | 🤖 **Auto Reply** | Automated bounce-back, no action needed. |
   | 🚫 **Spam Complaint** | Remove from list immediately. |
   | ⚠️ **Bounce** | Bad email address. |

4. Click a reply to see the full thread + the AI's one-sentence summary.
5. Click **Generate AI Draft** to get a suggested response you can edit and send.

**Follow-ups automatically stop** for anyone who replies — you'll never accidentally follow up after someone says yes or no.

---

## 12. Analytics dashboard

Two places to look:

### The main **Analytics Dashboard**

Big picture across all campaigns:

- Total emails sent today, this week, all time.
- Average open rate, reply rate, bounce rate.
- Number of active campaigns.
- Sending reputation score.
- Recent replies feed.

### Per-campaign dashboard

In **Sequence Builder** → **Analytics** tab. Shows:

- **Reply rate** — the number that matters most.
- **Meeting rate** — even better.
- **Open rate** — take with a grain of salt (Apple and Gmail proxies inflate this).
- **Bounce rate** — keep under 5% or your sender reputation suffers.
- **Per sender** — reply rate broken down by which inbox sent from.
- **Per provider** — SES vs Gmail vs SMTP performance.

---

## 13. Common tasks

### Pause a campaign

Sequence Builder → **Queue** tab → **Pause**. Or from Outreach Campaigns, click the ⏸ button. No more emails go out until you Resume.

### Resume a paused campaign

Same buttons — **Resume** / ▶ Play.

### Clone a campaign

Sequence Builder → **Queue** tab → **Clone**. Copies the campaign + all sequence steps into a new draft campaign. Useful for A/B testing or re-running the same play in a new region.

### Archive a campaign

Sequence Builder → **Queue** tab → **Archive**. Hides it from the main list without deleting anything.

### Skip one lead

If you don't want to send the current step to one specific prospect, open the campaign's prospect list, find them, click **Skip** — advances them to the next step without sending.

### Force-send the next step now

Same list, click **Force Next** — sends the next email immediately (still respecting the suppression list and stop conditions).

### Preview what will go out

Click **Preview Next** on a prospect — see the exact subject + body the AI would generate right now, without actually sending it.

### Add someone to the suppression list

Anyone on this list will never be emailed again, from any campaign, ever.

1. **Replies Intelligent Box** → find their reply → click **Add to suppression**, OR
2. From **Team Management** → **Suppression List** → **+ Add** → enter email → choose reason.

### Add a company holiday

Sequence Builder → **Schedule** tab → **Holidays** section → **+ Add** → pick date. No emails send on that date.

---

## 14. If something goes wrong

### "Failed to fetch" or nothing loads

- Refresh the page.
- If still broken, ask your admin to check the server is up (they'll know what to do).

### An email account shows as "Unhealthy"

- Go to **SMTP Accounts Router**.
- Find the account, click **Test Connection**.
- If it fails: your password may have expired, or Gmail may have revoked your app password. Generate a new app password (see Step 4) and update it here.

### High bounce rate

- Check your leads. A CSV full of guessed emails will bounce a lot.
- Make sure your **DNS & Verified Domains** are all green.
- Slow down your daily send limit for a few days.

### Emails go to spam

- Verify your domain (Step 5) if you haven't.
- Keep **Warmup** on for your inbox.
- Avoid spammy words in subject lines (FREE, GUARANTEED, ACT NOW, etc.).
- Keep your body under 150 words.
- Always include an unsubscribe link (the platform adds one automatically).

### No replies at all

- Check your reply rate in **Analytics** — < 1% means your copy needs work.
- Try shorter emails.
- Personalize more — mention something specific about their business.
- Send follow-ups. First-email reply rates are usually 1–3%. With 3 follow-ups you can hit 10%+.

### The system stopped a lead I didn't want stopped

- Open the campaign → prospect list → find them.
- If status is `stopped`, look at the **reason**:
  - `replied` — they replied. This is correct; don't override.
  - `bounced` / `complained` — their email was bad. Don't retry.
  - `manual` — you or a teammate stopped them.
  - `unsubscribed` — legally you cannot re-add them (CAN-SPAM law).

---

## 15. Glossary — plain-English word list

| Term | Meaning |
|---|---|
| **Cold email** | An email to someone you have never met, to introduce your business. |
| **Campaign** | A group of leads + a sequence + a schedule. |
| **Sequence** | The ordered list of emails — first email + follow-ups. |
| **Step** | One email in a sequence. Step 0 = first email, Step 1 = follow-up #1, etc. |
| **Lead / Prospect** | A person or business you want to email. |
| **SMTP** | The protocol used to send email. Every provider has SMTP settings. |
| **App Password** | A special password you generate in Gmail/Outlook that lets Outbound.AI send email as you, without exposing your real login password. |
| **SPF / DKIM / DMARC** | Three DNS records that prove to Gmail/Outlook you're not a spammer. Set them once, benefit forever. |
| **Warmup** | Slowly increasing daily send volume so mailbox providers trust you. |
| **Bounce** | Email came back — the address doesn't exist. |
| **Reply rate** | % of sent emails that got a reply. 3–10% is good for cold. |
| **Open rate** | % of sent emails that were opened. 40–60% is normal. Not a reliable metric anymore. |
| **Suppression list** | People who will never be emailed again — bounces, complaints, unsubscribes, or manually added. |
| **Sender pool** | A group of your sending inboxes. Instead of sending 500 emails from one Gmail, the system spreads them across 5 inboxes (100 each) for better deliverability. |
| **Rotation** | The rule for which inbox sends next. Round-robin = take turns. Weighted = some inboxes send more. |
| **Timezone-aware** | The system sends at the prospect's local business hours, not yours. So a US-based sender emailing London prospects sends at 9am London time, not 9am US time. |
| **Stop condition** | A rule that halts follow-ups automatically — reply received, meeting booked, unsubscribed, bounced, etc. |
| **CAN-SPAM** | US law that requires every commercial email to have a physical postal address + unsubscribe link. The platform adds both automatically. |

---

## Need help?

Ask your admin — they have access to the server logs and can see what happened. For most issues, refreshing the page or re-testing your SMTP connection fixes things.

Good luck sending. Start small (50 emails/day, 1 inbox, 1 campaign) and grow from there. Cold email works — but slow, personal, and patient beats fast and spammy every time.
