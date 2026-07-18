/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Open pixel, click redirect, and unsubscribe endpoints. These are the
 * only unauthenticated /api-adjacent routes the app exposes (they're mounted
 * outside /api because email clients hit them directly).
 */

import { Request, Response } from "express";
import { trackingService } from "../services/tracking.service";
import {
  emailRepository,
  emailEventRepository,
  suppressionRepository,
} from "../db/repositories";

// 1×1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export class TrackingController {
  /**
   * GET /t/o/:token — records an open and returns a 1×1 pixel.
   */
  public static async open(req: Request, res: Response): Promise<void> {
    const verified = trackingService.verifyToken(req.params.token || "");
    if (verified && verified.kind === "open") {
      try {
        await emailRepository.recordOpen(verified.emailId);
        await emailEventRepository.log({
          emailId: verified.emailId,
          eventType: "open",
          rawPayload: { ua: req.get("user-agent") || null, ip: req.ip },
        });
      } catch (err) {
        console.warn("[tracking] open record failed:", (err as Error).message);
      }
    }
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.end(PIXEL);
  }

  /**
   * GET /t/c/:token — records a click and 302-redirects to the original URL.
   */
  public static async click(req: Request, res: Response): Promise<void> {
    const verified = trackingService.verifyToken(req.params.token || "");
    if (!verified || verified.kind !== "click" || !verified.targetUrl) {
      res.status(400).send("Invalid tracking link.");
      return;
    }
    try {
      await emailRepository.recordClick(verified.emailId);
      await emailEventRepository.log({
        emailId: verified.emailId,
        eventType: "click",
        rawPayload: { targetUrl: verified.targetUrl, ua: req.get("user-agent") || null, ip: req.ip },
      });
    } catch (err) {
      console.warn("[tracking] click record failed:", (err as Error).message);
    }
    res.redirect(302, verified.targetUrl);
  }

  /**
   * GET /unsubscribe/:token — renders confirmation + writes suppression.
   * Also handles POST for the RFC 8058 one-click header.
   */
  public static async unsubscribe(req: Request, res: Response): Promise<void> {
    const verified = trackingService.verifyToken(req.params.token || "");
    if (!verified || verified.kind !== "unsubscribe") {
      res.status(400).type("html").send(errorPage("Invalid unsubscribe link."));
      return;
    }
    const email = await emailRepository.findById(verified.emailId);
    if (!email || !email.toEmail) {
      res.status(404).type("html").send(errorPage("This unsubscribe request has expired."));
      return;
    }
    try {
      await suppressionRepository.add({
        email: email.toEmail,
        reason: "unsubscribe",
        source: `list-unsubscribe:${email.id}`,
        campaignId: email.campaignId,
      });
      await emailEventRepository.log({
        emailId: email.id,
        eventType: "unsubscribe",
        rawPayload: { ua: req.get("user-agent") || null, ip: req.ip },
      });
    } catch (err) {
      console.warn("[unsubscribe] failed to record:", (err as Error).message);
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
<p><strong>${escapeHtml(email)}</strong> has been added to our suppression list. You won't receive further emails from any of our campaigns.</p>
<p>If this was a mistake, reply to any prior email and we'll remove you from the suppression list.</p>
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
