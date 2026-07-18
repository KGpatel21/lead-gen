/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tracking + unsubscribe token generation and HTML injection.
 *
 * Phase 3.5 hardening:
 *   - Signed with `config.trackingHmacSecret` (NOT the JWT secret).
 *   - Tokens carry an `iat` (seconds) and are rejected after
 *     `TOKEN_MAX_AGE_SEC` (90 days). Prevents replay of ancient links.
 *   - Footer includes the company name AND physical postal address so
 *     every email is CAN-SPAM compliant (see config.senderPostalAddress).
 */

import crypto from "crypto";
import { config } from "../config";

export type TokenKind = "open" | "click" | "unsubscribe";

interface TokenPayload {
  e: string;        // email id
  k: "o" | "c" | "u";
  u?: string;       // click target url
  t: number;        // issued timestamp (seconds since epoch)
}

const KIND_TO_LETTER: Record<TokenKind, "o" | "c" | "u"> = {
  open: "o", click: "c", unsubscribe: "u",
};
const LETTER_TO_KIND: Record<string, TokenKind> = {
  o: "open", c: "click", u: "unsubscribe",
};

/** 90 days — links older than this are rejected. */
const TOKEN_MAX_AGE_SEC = 60 * 60 * 24 * 90;

function b64uEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function sign(payloadB64: string): string {
  return b64uEncode(
    crypto.createHmac("sha256", config.trackingHmacSecret).update(payloadB64).digest()
  );
}

export const trackingService = {
  makeToken(kind: TokenKind, emailId: string, targetUrl?: string): string {
    const payload: TokenPayload = { e: emailId, k: KIND_TO_LETTER[kind], t: Math.floor(Date.now() / 1000) };
    if (kind === "click" && targetUrl) payload.u = targetUrl;
    const payloadB64 = b64uEncode(Buffer.from(JSON.stringify(payload), "utf8"));
    return `${payloadB64}.${sign(payloadB64)}`;
  },

  verifyToken(token: string): { kind: TokenKind; emailId: string; targetUrl?: string; ageSec: number } | null {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    const [payloadB64, sig] = token.split(".", 2);
    const expected = sign(payloadB64);
    let sigBuf: Buffer;
    let expBuf: Buffer;
    try {
      sigBuf = b64uDecode(sig);
      expBuf = b64uDecode(expected);
    } catch { return null; }
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    let payload: TokenPayload;
    try {
      payload = JSON.parse(b64uDecode(payloadB64).toString("utf8")) as TokenPayload;
    } catch { return null; }
    if (!payload || typeof payload.e !== "string" || !payload.k || typeof payload.t !== "number") return null;

    const kind = LETTER_TO_KIND[payload.k];
    if (!kind) return null;

    // Enforce max age. Tokens minted in the future (clock skew or forgery
    // attempts) are also rejected.
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - payload.t;
    if (ageSec > TOKEN_MAX_AGE_SEC) return null;
    if (ageSec < -60) return null; // more than a minute in the future = fake

    return { kind, emailId: payload.e, targetUrl: payload.u, ageSec };
  },

  openPixelUrl(emailId: string): string {
    return `${config.publicBaseUrl.replace(/\/$/, "")}/t/o/${this.makeToken("open", emailId)}`;
  },

  clickUrl(emailId: string, targetUrl: string): string {
    return `${config.publicBaseUrl.replace(/\/$/, "")}/t/c/${this.makeToken("click", emailId, targetUrl)}`;
  },

  unsubscribeUrl(emailId: string): string {
    return `${config.publicBaseUrl.replace(/\/$/, "")}/unsubscribe/${this.makeToken("unsubscribe", emailId)}`;
  },

  /**
   * Rewrites `<a href=...>` to click-tracked URLs and appends a 1×1 pixel.
   * Idempotent — a URL already pointing at our tracker is left alone.
   */
  injectHtmlTracking(html: string, emailId: string): string {
    const rewritten = html.replace(
      /(<a\s[^>]*?href\s*=\s*")([^"]+)("[^>]*>)/gi,
      (_m, pre: string, href: string, post: string) => {
        if (!/^https?:\/\//i.test(href)) return `${pre}${href}${post}`;
        if (href.includes("/t/c/") || href.includes("/unsubscribe/")) return `${pre}${href}${post}`;
        return `${pre}${this.clickUrl(emailId, href)}${post}`;
      }
    );
    const pixel = `<img src="${this.openPixelUrl(emailId)}" width="1" height="1" alt="" style="display:block;border:0;height:1px;width:1px;" />`;
    if (/<\/body>/i.test(rewritten)) return rewritten.replace(/<\/body>/i, `${pixel}</body>`);
    return `${rewritten}\n${pixel}`;
  },

  /**
   * Appends the CAN-SPAM footer to both plaintext and HTML bodies.
   * Includes:
   *   - Company name
   *   - Physical postal address (REQUIRED by CAN-SPAM §7704(a)(5))
   *   - One-click unsubscribe link
   *
   * If postal address is not configured, the footer still injects the
   * unsubscribe link and company name — production boot will have refused
   * to start in that case, so this only matters in dev.
   */
  injectFooters(
    bodyText: string,
    bodyHtml: string | undefined,
    emailId: string,
    orgName?: string
  ): { bodyText: string; bodyHtml: string } {
    const link = this.unsubscribeUrl(emailId);
    const marker = "​unsub-footer";
    const companyName = orgName || config.senderCompanyName || "Outbound.AI";
    const postalAddress = config.senderPostalAddress;

    const textLines = [
      "",
      "---",
      companyName,
      ...(postalAddress ? [postalAddress] : []),
      `Unsubscribe: ${link}`,
      "",
    ];
    const textFooter = textLines.join("\n");

    const htmlAddressLine = postalAddress
      ? `<div style="color:#6b7280;font-size:12px;margin-top:4px">${escapeHtml(postalAddress)}</div>`
      : "";
    const htmlFooter =
      `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;font-family:sans-serif;line-height:1.4;">` +
      `<div>${escapeHtml(companyName)}</div>` +
      htmlAddressLine +
      `<div style="margin-top:8px"><a href="${link}" style="color:#6b7280;text-decoration:underline;">Unsubscribe from this list</a></div>` +
      `<span style="display:none">${marker}</span></div>`;

    const outText = bodyText.includes(marker) || bodyText.includes(link)
      ? bodyText
      : bodyText + textFooter;

    let outHtml = bodyHtml || `<pre style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(bodyText)}</pre>`;
    if (!outHtml.includes(marker) && !outHtml.includes(link)) {
      if (/<\/body>/i.test(outHtml)) outHtml = outHtml.replace(/<\/body>/i, `${htmlFooter}</body>`);
      else outHtml = outHtml + htmlFooter;
    }

    return { bodyText: outText, bodyHtml: outHtml };
  },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
