# Outbound.AI — How to Use

Welcome. This guide shows you how to go from a fresh account to booked meetings, in the shortest path possible.

Written for the person actually running the outreach — no engineer required.

---

## Table of Contents

1. [What you get](#1-what-you-get)
2. [Your first 5 minutes — send your first email](#2-your-first-5-minutes--send-your-first-email)
3. [Your first 30 minutes — a working campaign](#3-your-first-30-minutes--a-working-campaign)
4. [Your first week — dial in what works](#4-your-first-week--dial-in-what-works)
5. [The 8 things every screen does](#5-the-8-things-every-screen-does)
6. [How to write cold emails that get replies](#6-how-to-write-cold-emails-that-get-replies)
7. [Deliverability — how to stay out of spam](#7-deliverability--how-to-stay-out-of-spam)
8. [Best practices that separate 1% reply rate from 10%](#8-best-practices-that-separate-1-reply-rate-from-10)
9. [Team collaboration](#9-team-collaboration)
10. [Frequently asked questions](#10-frequently-asked-questions)
11. [Need help?](#11-need-help)

---

## 1. What you get

Outbound.AI is your all-in-one cold-email workspace. In plain terms:

**Find** — Search Google Maps for real businesses in a niche + city. Or ask AI to build a lead list on any platform. Or upload your own CSV.

**Write** — AI reads each prospect's website and drafts a personalized email using real facts about their business. No mail merge. No `{{firstName}}` gimmicks — actual specifics.

**Send** — From your own Gmail, Outlook, or any email account you connect. Automatic timezone-aware scheduling. Never fires on weekends or evenings unless you want it to.

**Follow up** — Set up a 3-, 5-, or 10-step sequence once. The system handles the rest — different message each time, stops the moment someone replies.

**Track** — Live dashboard shows opens, replies, meetings, and bounces. AI reads every reply and tags it (Interested / Meeting Requested / Not Interested / etc.).

**Reply** — Every response lands in one inbox, categorized. AI drafts a suggested response you can edit and send in two clicks.

The whole thing runs on your infrastructure and your email accounts. Your data never leaves your workspace.

---

## 2. Your first 5 minutes — send your first email

Goal: your first real cold email goes out in under 5 minutes. Follow these exactly.

### Minute 1 — Sign in

Open the URL your team sent you. Click **Register**. Enter name, email, password. You're in.

### Minute 2 — Connect your Gmail

1. Sidebar → **SMTP Accounts Router** → **+ Add**.
2. Fill in your Gmail address. Everything else is pre-filled.
3. For **SMTP Password**, you need a Gmail App Password. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) in a new tab, type `Outbound.AI`, click **Create**. Copy the 16-character password.
4. Paste it. Click **Save**. Click **Test Connection** — you should see a green checkmark.

Using Outlook, Zoho, or something else? Same idea, just different SMTP host. Zoho = `smtp.zoho.com`, Outlook = `smtp-mail.outlook.com`. Your provider's docs will tell you.

### Minute 3 — Find a lead

1. Sidebar → **Lead Discovery**.
2. Type a search: `dental clinics in Austin`, or `roofing companies in Miami`, or whatever your niche is.
3. Click **Search**. Real businesses appear with names, websites, phones, ratings.
4. Pick one that looks interesting. Tick the box. Click **Analyze Selected**.
5. The AI visits their website. In a few seconds, you have a fact sheet on them.

### Minute 4 — Create a campaign and add the lead

1. Sidebar → **Outreach Campaigns** → **+ New Campaign**.
2. Name it something clear like `Austin Dental Test`.
3. Click **Create**.
4. Open the campaign. On the Leads tab, either add the lead you just analyzed, or click **From Discovery** to import the ones you selected.

### Minute 5 — Send

1. Sidebar → **Sequence Builder** → pick your campaign.
2. You'll see a starter sequence (a first email + one follow-up). Leave it as-is.
3. Click **Enroll all leads**.
4. Click **Resume** or the ▶ Play button.

Your first email is scheduled. Depending on the time (business hours, weekday), it may fire immediately or wait until 9 AM tomorrow.

**Check it worked**: Sidebar → **Sequence Builder** → **Queue** tab. You should see the counters updating.

---

## 3. Your first 30 minutes — a working campaign

Now that you've sent one, let's make it a real campaign.

### Add 20+ leads

Cold email is a numbers game — 1–3% reply rate on the first email is normal. To book one meeting, you need 30–50 leads minimum.

Three ways to bulk-add:

1. **Lead Discovery** — search again, tick 20 businesses, hit **Analyze** and **Push to campaign**.
2. **CSV upload** — Campaigns → Leads tab → **Upload CSV**. Paste a CSV with an `email` column (plus optional `firstName`, `lastName`, `company`).
3. **AI Lead Finder** — Sidebar → **AI Lead Finder** → describe your ideal customer → AI returns 20 leads at a time.

### Set your schedule

Sequence Builder → your campaign → **Schedule** tab.

- **Working days**: Mon–Fri (unless your industry is different).
- **Send window**: 9 AM to 5 PM in your prospect's timezone.
- **Timezone**: `America/New_York`, `Europe/London`, etc. Prospect timezone gives you the highest open rates.
- **Max per hour / per day**: leave at 60/500 unless you know what you're doing.
- **Gap between sends**: 30–180 seconds. Adds human-like randomness.
- **Goal** (one sentence): `Book a 15-min call to discuss switching from their current tool to ours.` The AI reads this and shapes messages around it.

### Build a proper sequence

Sequence Builder → **Builder** tab. Delete the starter steps and build these:

| Step | Delay | Mode | Purpose |
|---|---|---|---|
| 0 | now | AI | The opener — reference something specific about them. |
| 1 | 3 days | AI | Short bump. New angle. |
| 2 | 7 days | AI | Case study or example. One clear ask. |
| 3 | 12 days | AI | Polite break-up — "should I close the loop?" |

For each AI step, write a one-line instruction. Example for Step 3: `Polite break-up email. Ask if it is the wrong time or wrong contact. Under 60 words.`

Click **Save sequence**. Peek at the **Timeline** tab to see the schedule laid out.

### Enroll everyone + start

Back on the Builder tab, **Enroll all leads** → **Resume**. You're live.

---

## 4. Your first week — dial in what works

### Day 1

- Sends start. Check the **Queue** tab every few hours to make sure emails are actually going out.
- Any errors will show as **Failed** in the queue with a reason (bad password, bounce, suppression, etc.).

### Days 2–4

- First replies start coming in. Sidebar → **Replies Intelligent Box**.
- Each reply is auto-tagged. Focus on the 🟢 **Interested** and 📅 **Meeting Requested** ones first.
- Reply within 4 hours if possible. Fast replies book 3× more meetings.
- Use **Generate AI Draft** as a starting point, then edit for tone.

### Days 5–7

- Check **Sequence Builder → Analytics** tab.
- Look at reply rate. Anything over 3% on Step 0 is decent. Under 1% means the copy or the list is off.
- **Per Sender** table shows if one of your inboxes has a much lower reply rate than the others — could be a deliverability issue with that specific account.

### After 7 days

Two adjustments to make:

1. **Winners**: Clone the campaign, tweak the subject or opening line, run it against a fresh list.
2. **Losers**: Pause anything under 1% reply rate. Change the target audience OR change the pitch — don't just resend the same thing.

---

## 5. The 8 things every screen does

Quick reference — one line per screen:

| Screen | What it's for | When to open it |
|---|---|---|
| **Analytics Dashboard** | All-campaigns bird's-eye view | Once a day |
| **Lead Discovery** | Search Google Maps for businesses | When you need fresh leads |
| **AI Lead Finder** | AI-generated lead list | When you want LinkedIn-style prospects |
| **CRM Pipeline Board** | Drag prospects between stages | Managing warm leads |
| **Outreach Campaigns** | Create, pause, delete campaigns | Whenever you launch or manage a campaign |
| **Sequence Builder** | The heart of the app — design + monitor sequences | Multiple times per day |
| **SMTP Accounts Router** | Connect and health-check sending inboxes | Once per inbox |
| **Replies Intelligent Box** | Every reply, tagged | Every few hours |

---

## 6. How to write cold emails that get replies

Non-negotiable rules:

**Subject line** — 3 to 5 words. Lowercase. Curiosity-inducing without being clickbait. Bad: `AMAZING OPPORTUNITY!!!` Good: `quick question about zensoft`.

**Opening line** — reference something specific about them from their website. Not their name, not "hope you're doing well". Something a robot wouldn't say. Example: `Saw your team is hiring 3 more account executives — congrats on the growth.`

**Body** — 90 to 140 words. One clear value point. One clear ask.

**Call to action** — ONE ask. Not "reply if you're interested, or share this with your VP, or check out our site." Just: `Worth a 10-minute chat next Tuesday?`

**Signature** — Name, title, company. That's it. No banners. No quotes. No social icons.

### Follow-up rules

- Follow-ups outperform the first email 2:1 in reply rate. Never skip them.
- Every follow-up needs a new angle. Don't just say "did you see my last email?" — that's spam.
- Angles that work: a customer story, an industry-specific stat, a question about their tech stack, a polite break-up.
- Break-up email at the end usually gets the most replies. Yes really.

### Words that trip spam filters

Avoid, especially in subject lines: `FREE`, `GUARANTEE`, `ACT NOW`, `LIMITED TIME`, `100% RISK FREE`, `CLICK HERE`, `URGENT`, `!!!`, ALL-CAPS anything.

---

## 7. Deliverability — how to stay out of spam

If your emails land in spam, everything else is wasted. Do these once, benefit forever:

### The 4-item deliverability checklist

- [ ] **Verified sending domain**. Sidebar → **DNS & Verified Domains**. Add three DNS records (SPF, DKIM, DMARC). Wait ~10 minutes. All three should turn green.
- [ ] **Warmup enabled** on every inbox. It gradually ramps your send volume so mailbox providers trust you.
- [ ] **Daily send limit** starts at 50 per inbox for the first 2 weeks. Then 100. Then 150. Never jump from 50 to 500.
- [ ] **Unsubscribe link** in every email (the platform adds it automatically — don't remove it).

### Signs you're in spam

- Open rates suddenly drop from 40% to 5%.
- Reply rate drops to 0.
- Your test emails to your own Gmail land in the Promotions tab or Spam folder.

### Fix a domain that's in spam

1. Immediately reduce daily send limit to 10 per inbox.
2. Do NOT send more emails from this domain for 3 days.
3. Send one plain-text personal email to a friend and ask them to reply.
4. Ask 5 colleagues to check their spam folder for anything from you and click "Not Spam".
5. After 3 days, resume with 20 emails/day for a week.

### Use multiple sending inboxes (sender pools)

Instead of sending 500 emails from one Gmail, connect 5 inboxes and send 100 from each. Spreads load, protects reputation. The platform rotates automatically.

Sidebar → **SMTP Accounts Router** — add all 5. Then a **Sender Pool** groups them, and your campaign uses the pool.

---

## 8. Best practices that separate 1% reply rate from 10%

**1. Tight targeting beats a big list every time.** 50 perfectly-fitting leads beat 500 kind-of-fitting ones.

**2. First email under 100 words.** Every extra sentence loses ~5% of replies.

**3. Ask one question.** Not "Would you like a demo, or a whitepaper, or..." Just one thing.

**4. Send Tuesday–Thursday, 9–11 AM prospect time.** Avoid Monday morning (inbox flood) and Friday afternoon (already checked out).

**5. Follow up 3 to 5 times.** Most replies come from follow-up #2 or #3.

**6. Use their words, not yours.** Read their About page. If they say "clients" not "customers", you say "clients" too.

**7. Never attach a PDF.** Kills deliverability. Put a link to your site instead — or better, describe the offer in the email itself.

**8. Reply within 4 hours.** The response window is short. Set up notifications.

**9. Track meetings booked, not opens.** Opens are inflated by Gmail image proxies. Meetings are real.

**10. Test one variable at a time.** Don't change the subject AND the body AND the CTA. Change one, run 50 leads, measure, keep or drop.

---

## 9. Team collaboration

If your team has multiple people:

1. **Team Management** → **+ Invite Member**.
2. Enter their name, email, and role.
3. They get an invite link. They register with that email.

Roles:
- **Admin** — everything.
- **User** — can create campaigns, send emails, but can't invite others or change billing.
- **Team Member** — read-only + reply to messages assigned to them.

Every campaign, lead, and reply is scoped to your **workspace**. Team members see the same data. Actions are logged with who did what.

---

## 10. Frequently asked questions

**How many emails can I send per day?**
Depends on your inbox limits, but 200–500 per day per inbox is safe if you've warmed up properly. Connect multiple inboxes to scale beyond that.

**Will it work with my existing Gmail?**
Yes. Any Gmail account works — personal, Google Workspace, whatever. You just need an App Password (2 minutes to set up).

**Does it work with Outlook / Microsoft 365?**
Yes. Same 2-minute App Password flow.

**Do I need a domain?**
Yes — you need to send from a real address (like `you@yourcompany.com`), not `@gmail.com`, for the best deliverability. Cheap domains are $10/year. Worth it.

**How is this different from Mailchimp / MailerLite?**
Those are for marketing to people who already signed up. Outbound.AI is for reaching people who have never heard of you.

**Is cold email legal?**
In the US: yes, as long as you include a physical address + unsubscribe link (both auto-added). In EU/UK: GDPR is stricter — B2B emails to legitimate prospects are allowed under "legitimate interest" but you must honor unsubscribes and provide an address. In Canada: CASL requires more explicit consent, so be careful.

**Can I use my own AI keys?**
Yes. The workspace is set up to use whatever AI provider your admin configured (Groq or Gemini). You don't need to touch this.

**What if a lead unsubscribes?**
Their email goes on the **suppression list**. They will never be contacted again from any campaign, from any inbox, for any reason. This is enforced at the system level.

**Can I schedule a campaign to start in the future?**
Not directly — but you can create the campaign, set it up completely, and just leave it in Draft. When you're ready, click Resume.

**What happens when a lead replies?**
1. The reply lands in the Replies Intelligent Box, categorized by AI.
2. All follow-ups to that person are stopped immediately.
3. If they replied "Interested" or "Meeting Requested", they show up in your CRM Pipeline Board for follow-up.

**Can I A/B test subject lines?**
Yes. In Sequence Builder, each step has an `A/B group` field. Create the same step with `abGroup: A` and `abGroup: B`, different subjects. Prospects are randomly assigned. Compare reply rates in Analytics.

**What if my inbox gets flagged?**
- Pause all campaigns using that inbox immediately.
- Sidebar → SMTP Accounts Router → set that account to Inactive.
- Do NOT send from that inbox for 5–7 days.
- When you resume, start at 10 emails/day for a week.

**How do I export my leads?**
CRM Pipeline Board → **Export CSV**. All leads + their current stage.

**Can I import from Salesforce / HubSpot?**
Not directly. Export from your CRM as a CSV, then upload here.

**What about my prospect's timezone?**
Set it at the campaign level (Schedule tab). The system respects it. If a lead's own timezone is known, that takes priority.

---

## 11. Need help?

**Something's broken:**
- Refresh the page first.
- Check that your SMTP account is Healthy (green) in SMTP Accounts Router.
- If still stuck, contact your admin — they have server logs.

**Deliverability question:**
- Read [Section 7](#7-deliverability--how-to-stay-out-of-spam) again.
- Test your setup with [mail-tester.com](https://mail-tester.com) — score should be 9/10 or higher.

**AI wrote a weird email:**
- Refine the Goal field on your campaign — one clear sentence works better than a paragraph.
- Add more detail to the AI Instruction on the specific step.

**No replies at all after 100+ sends:**
- Your list, subject line, or opener is the problem — not the platform.
- Re-read [Section 6](#6-how-to-write-cold-emails-that-get-replies).
- Try a completely different niche or angle.

---

## Ready?

Open the portal. Add one inbox. Find one lead. Send one email. Come back in an hour to check the reply.

That's the whole loop. Everything else is just doing more of it, better.

Good selling.
