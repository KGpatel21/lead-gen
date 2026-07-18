/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Open pixel, click redirect, and unsubscribe endpoints. Public — email
 * clients hit them directly, so authentication is impossible.
 *
 * Phase 3.5 hardening:
 *   - Tokens carry an expiry (90 days) and are rejected past it. Enforced
 *     inside trackingService.verifyToken.
 *   - Open pixel flags Gmail / Apple Mail Privacy Protection image-proxy
 *     prefetches so dashboards can distinguish real opens from prefetches.
 *   - All HTML responses set a strict Content-Security-Policy.
 */

import { Request, Response } from "express";
import { trackingService } from "../services/tracking.service";
import {
  emailRepository,
  emailEventRepository,
  suppressionRepository,
} from "../db/repositories";
import { suppressionCacheService } from "../services/suppressionCache.service";
import { log } from "../observability/logger";

// 1×1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

// Well-known email-client image proxies. When these fetch our pixel we flag
// the open as `open_from_proxy = true` — the campaign dashboard can then
// discount prefetch opens from real opens.
const IMAGE_PROXY_UA_PATTERNS = [
  /GoogleImageProxy/i,
  /YahooMailProxy/i,
  /ymlp\.com/i,
  /Superhuman/i,
];

// Apple Mail Privacy Protection loads the pixel via a Mask iCloud relay
// with a specific UA. Detect and flag.
const APPLE_MPP_UA_PATTERNS = [/applewebkit.*mobile.*mail/i, /Applebot/i, /Apple-CFNetwork/i];

function detectProxy(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  return (
    IMAGE_PROXY_UA_PATTERNS.some((re) => re.test(userAgent)) ||
    APPLE_MPP_UA_PATTERNS.some((re) => re.test(userAgent))
  );
}

const HTML_CSP =
  "default-src 'none'; " +
  "style-src 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "form-action 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'none';";

function setHtmlSecurityHeaders(res: Response): void {
  res.setHeader("Content-Security-Policy", HTML_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export class TrackingController {
  public static async open(req: Request, res: Response): Promise<void> {
    const verified = trackingService.verifyToken(req.params.token || "");
    if (verified && verified.kind === "open") {
      const userAgent = req.get("user-agent") || undefined;
      const fromProxy = detectProxy(userAgent);
      try {
        await emailRepository.recordOpen(verified.emailId, { userAgent, fromProxy });
        await emailEventRepository.log({
          emailId: verified.emailId,
          eventType: fromProxy ? "open_prefetch" : "open",
          rawPayload: { ua: userAgent || null, ip: req.ip, ageSec: verified.ageSec, fromProxy },
        });
      } catch (err) {
        log.warn({ err: (err as Error).message, emailId: verified.emailId }, "tracking open record failed");
      }
    }
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.end(PIXEL);
  }

  public static async click(req: Request, res: Response): Promise<void> {
    const verified = trackingService.verifyToken(req.params.token || "");
    if (!verified || verified.kind !== "click" || !verified.targetUrl) {
      setHtmlSecurityHeaders(res);
      res.status(400).send("Invalid tracking link.");
      return;
    }
    try {
      await emailRepository.recordClick(verified.emailId);
      await emailEventRepository.log({
        emailId: verified.emailId,
        eventType: "click",
        rawPayload: {
          targetUrl: verified.targetUrl,
          ua: req.get("user-agent") || null,
          ip: req.ip,
          ageSec: verified.ageSec,
        },
      });
    } catch (err) {
      log.warn({ err: (err as Error).message, emailId: verified.emailId }, "tracking click record failed");
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.redirect(302, verified.targetUrl);
  }

  public static async unsubscribe(req: Request, res: Response): Promise<void> {
    setHtmlSecurityHeaders(res);
    const verified = trackingService.verifyToken(req.params.token || "");
    if (!verified || verified.kind !== "unsubscribe") {
      res.status(400).type("html").send(errorPage("Invalid unsubscribe link."));
      return;
    }
    const email = await emailRepository.findById(verified.emailId);
    if (!email || !email.toEmail || !email.workspaceId) {
      res.status(404).type("html").send(errorPage("This unsubscribe request has expired."));
      return;
    }
    try {
      await suppressionRepository.add({
        workspaceId: email.workspaceId,
        email: email.toEmail,
        reason: "unsubscribe",
        source: `list-unsubscribe:${email.id}`,
        campaignId: email.campaignId,
      });
      await suppressionCacheService.invalidateAdd(email.toEmail, email.workspaceId);
      await emailEventRepository.log({
        emailId: email.id,
        eventType: "unsubscribe",
        rawPayload: { ua: req.get("user-agent") || null, ip: req.ip },
      });
    } catch (err) {
      log.warn({ err: (err as Error).message, emailId: email.id }, "unsubscribe record failed");
    }
    if (req.method === "POST") {
      res.status(200).send("OK");
      return;
    }
    res.type("html").send(successPage(email.toEmail));
  }
}

function successPage(email: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Unsubscribed</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#0f172a}h1{font-size:22px}p{color:#475569;line-height:1.5}</style></head>
<body><h1>You've been unsubscribed</h1>
<p><strong>${escapeHtml(email)}</strong> has been added to our suppression list. You will not receive further emails from any of our campaigns.</p>
<p>If this was a mistake, reply to any prior email and we will remove you from the suppression list.</p>
</body></html>`;
}
function errorPage(message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Error</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#0f172a}p{color:#475569;line-height:1.5}</style></head>
<body><h1>Something went wrong</h1><p>${escapeHtml(message)}</p></body></html>`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
