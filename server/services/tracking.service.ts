/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tracking + unsubscribe token generation and HTML injection.
 *
 * Tokens are HMAC-signed with `config.jwtSecret` so we do not need a database
 * lookup on every pixel or click. Payload layout:
 *
 *     base64url(JSON.stringify({ e: <emailId>, k: "o"|"c"|"u", u?: <original url> }))
 *     + "." + base64url(HMAC-SHA256)
 *
 * Only the server can mint valid tokens.
 */

import crypto from "crypto";
import { config } from "../config";

export type TokenKind = "open" | "click" | "unsubscribe";

interface TokenPayload {
  e: string;        // email id
  k: "o" | "c" | "u";
  u?: string;       // click target url
  t?: number;       // issued timestamp (seconds)
}

const KIND_TO_LETTER: Record<TokenKind, "o" | "c" | "u"> = {
  open: "o",
  click: "c",
  unsubscribe: "u",
};
const LETTER_TO_KIND: Record<string, TokenKind> = {
  o: "open",
  c: "click",
  u: "unsubscribe",
};

function b64uEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payloadB64: string): string {
  return b64uEncode(crypto.createHmac("sha256", config.jwtSecret).update(payloadB64).digest());
}

export const trackingService = {
  makeToken(kind: TokenKind, emailId: string, targetUrl?: string): string {
    const payload: TokenPayload = { e: emailId, k: KIND_TO_LETTER[kind], t: Math.floor(Date.now() / 1000) };
    if (kind === "click" && targetUrl) payload.u = targetUrl;
    const payloadB64 = b64uEncode(Buffer.from(JSON.stringify(payload), "utf8"));
    return `${payloadB64}.${sign(payloadB64)}`;
  },

  verifyToken(token: string): { kind: TokenKind; emailId: string; targetUrl?: string } | null {
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
    if (!payload || typeof payload.e !== "string" || !payload.k) return null;
    const kind = LETTER_TO_KIND[payload.k];
    if (!kind) return null;
    return { kind, emailId: payload.e, targetUrl: payload.u };
  },

  openPixelUrl(emailId: string): string {
    const t = this.makeToken("open", emailId);
    return `${config.publicBaseUrl.replace(/\/$/, "")}/t/o/${t}`;
  },

  clickUrl(emailId: string, targetUrl: string): string {
    const t = this.makeToken("click", emailId, targetUrl);
    return `${config.publicBaseUrl.replace(/\/$/, "")}/t/c/${t}`;
  },

  unsubscribeUrl(emailId: string): string {
    const t = this.makeToken("unsubscribe", emailId);
    return `${config.publicBaseUrl.replace(/\/$/, "")}/unsubscribe/${t}`;
  },

  /**
   * Rewrites `<a href=...>` links to click-tracked variants and appends a
   * transparent 1×1 pixel. Idempotent: won't double-rewrite a URL that already
   * points at our tracker (`/t/c/`).
   */
  injectHtmlTracking(html: string, emailId: string): string {
    const rewrittenHref = html.replace(
      /(<a\s[^>]*?href\s*=\s*")([^"]+)("[^>]*>)/gi,
      (_m, pre: string, href: string, post: string) => {
        if (!/^https?:\/\//i.test(href)) return `${pre}${href}${post}`;
        if (href.includes("/t/c/") || href.includes("/unsubscribe/")) {
          return `${pre}${href}${post}`;
        }
        return `${pre}${this.clickUrl(emailId, href)}${post}`;
      }
    );
    const pixel = `<img src="${this.openPixelUrl(emailId)}" width="1" height="1" alt="" style="display:block;border:0;height:1px;width:1px;" />`;
    if (/<\/body>/i.test(rewrittenHref)) {
      return rewrittenHref.replace(/<\/body>/i, `${pixel}</body>`);
    }
    return `${rewrittenHref}\n${pixel}`;
  },

  /**
   * Appends a CAN-SPAM style footer with the unsubscribe link to both
   * HTML and plaintext bodies. Skips if the footer marker is already present.
   */
  injectFooters(
    bodyText: string,
    bodyHtml: string | undefined,
    emailId: string,
    orgName: string
  ): { bodyText: string; bodyHtml: string } {
    const link = this.unsubscribeUrl(emailId);
    const marker = "​unsub-footer";

    const textFooter =
      `\n\n---\n${orgName}\nYou can opt out at any time: ${link}\n`;
    const htmlFooter =
      `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;font-family:sans-serif;">` +
      `${orgName} · <a href="${link}" style="color:#6b7280;">Unsubscribe</a>` +
      `<span style="display:none">${marker}</span></div>`;

    const outText = bodyText.includes(marker) || bodyText.includes(link)
      ? bodyText
      : bodyText + textFooter;

    let outHtml = bodyHtml || `<pre style="font-family:sans-serif;">${bodyText}</pre>`;
    if (!outHtml.includes(marker) && !outHtml.includes(link)) {
      if (/<\/body>/i.test(outHtml)) {
        outHtml = outHtml.replace(/<\/body>/i, `${htmlFooter}</body>`);
      } else {
        outHtml = outHtml + htmlFooter;
      }
    }

    return { bodyText: outText, bodyHtml: outHtml };
  },
};
