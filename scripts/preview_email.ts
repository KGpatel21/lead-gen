import fs from "fs";
import { emailFormatterService } from "../server/services/emailFormatter.service";

const html = emailFormatterService.wrap({
  subject: "Quick question about your growth engine",
  bodyText: [
    "Hi Priya,",
    "Saw your team just posted three AE roles — congrats on the ramp.",
    "We built Outbound.AI to help teams like yours scale outbound without hiring a full SDR team.",
    "Worth a 15-min chat next Tuesday?",
    "— Krutarth",
  ].join("\n\n"),
  bodyHtml: `
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#111827;">Hi Priya,</p>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">Saw your team just posted <strong>three AE roles</strong> — congrats on the ramp.</p>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">We built <strong>Outbound.AI</strong> to help teams at your stage scale outbound without hiring a full SDR team. Sales orgs like yours typically see reply rates <strong>3-4× higher</strong> when the AI writes each first-touch from real prospect facts.</p>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;"><a href="https://calendly.com/example">Book a 15-min chat</a> next Tuesday?</p>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">— Krutarth</p>`,
  preheader: "Saw your Q3 hiring page — congrats on the AE ramp.",
  accentColor: "#2563eb",
  signatureHtml: `
<div><strong style="color:#111827;">Krutarth Patel</strong><br>Founder, Outbound.AI<br>
<a href="https://outbound.ai" style="color:#6b7280;">outbound.ai</a> · +1 (415) 555-0100</div>`,
});

const out = "./dist/email_preview.html";
fs.mkdirSync("./dist", { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${html.length} chars → ${out}`);
console.log(`CTA button uplifts:  ${(html.match(/data-cta="btn"/g) || []).length}`);
console.log(`Shell marker present: ${html.includes('data-outbound-ai-shell="v1"')}`);
console.log(`Preheader present:   ${html.includes("Saw your Q3 hiring")}`);
