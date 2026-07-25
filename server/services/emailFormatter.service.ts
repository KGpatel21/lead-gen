/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Email formatter — wraps a raw AI-generated body in a professional,
 * mobile-friendly, email-client-safe HTML shell.
 *
 * Design principles for outbound cold email HTML:
 *   • Use tables. Not divs. Every email client from 2003 renders tables
 *     consistently; flexbox / grid / most CSS 2018+ features do not.
 *   • Inline every CSS declaration. External stylesheets and `<style>`
 *     blocks are stripped by Gmail, Outlook, and most webmail providers.
 *   • Max width 600px. Anything wider gets horizontally cropped on
 *     mobile clients.
 *   • Keep the DOM minimal. Complex nesting causes Outlook to render
 *     ghost rows. Keep it flat.
 *   • Escape user-supplied content. AI can produce arbitrary strings.
 *
 * The shell adds:
 *   • Optional preheader (hidden preview text shown next to subject).
 *   • Optional accent brand color (deduced from campaign or workspace).
 *   • Typographic hierarchy for opening line vs body vs CTA.
 *   • Automatic CTA-button detection: any `<a>` whose text matches a
 *     verb ("book", "schedule", "reply", "chat", "download", "get", etc.)
 *     becomes a styled button. Every other link stays inline (still
 *     tracked by the tracker).
 *
 * Idempotent. If the incoming HTML already contains our
 * `data-outbound-ai-shell="v1"` marker, this returns it unchanged so a
 * re-run doesn't double-wrap.
 */

const SHELL_MARKER_ATTR = 'data-outbound-ai-shell="v1"';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const CTA_VERBS = /^(book|schedule|reply|respond|chat|talk|meet|download|get|start|try|see|learn more|check|view|read|watch|grab|claim|reserve|register|explore|open)/i;

function looksLikeCta(anchor: string): boolean {
  const inner = anchor.replace(/<[^>]+>/g, "").trim();
  if (!inner || inner.length > 60) return false;
  return CTA_VERBS.test(inner);
}

/**
 * Turn a subset of `<a href>` anchors into styled buttons. Uses a naive
 * regex on the outer tag pair — safe because we're operating on our own
 * template output, not arbitrary user HTML.
 */
function upgradeCtaLinks(html: string, accent: string): string {
  return html.replace(
    /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi,
    (match, attrs, inner) => {
      if (!looksLikeCta(match)) return match;
      // Skip if already wrapped by our button transform.
      if (/data-cta="btn"/i.test(match)) return match;
      // Preserve href + target + rel; drop any inline style user provided.
      const hrefMatch = /href\s*=\s*"([^"]+)"/i.exec(attrs);
      if (!hrefMatch) return match;
      const href = hrefMatch[1];
      return (
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;">` +
        `<tr><td style="border-radius:8px;background:${accent};padding:12px 22px;">` +
        `<a href="${href}" data-cta="btn" target="_blank" rel="noopener" style="color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;letter-spacing:0.2px;display:inline-block;">` +
        inner.trim() +
        `</a></td></tr></table>`
      );
    }
  );
}

/**
 * If the input `body` is plaintext (no HTML tags detected), convert it
 * to structured paragraphs. First paragraph gets slight extra weight to
 * function as an opening line.
 */
function plaintextToHtml(text: string): string {
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";
  return paragraphs
    .map((p, i) => {
      const escaped = escapeHtml(p).replace(/\n/g, "<br>");
      const style =
        i === 0
          ? "margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#111827;"
          : "margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;";
      return `<p style="${style}">${escaped}</p>`;
    })
    .join("\n");
}

export interface EmailShellInput {
  subject: string;
  /** Raw HTML fragment for the body (paragraphs, links). May be empty. */
  bodyHtml?: string;
  /** Plaintext version — used when bodyHtml is empty. */
  bodyText: string;
  /** Optional signature block (already HTML). */
  signatureHtml?: string;
  /** Optional 1-line preview text shown next to the subject in most inboxes. */
  preheader?: string;
  /** Brand color used for the accent bar and CTA button. Any CSS color. */
  accentColor?: string;
  /** Sender / workspace display name. Kept out of the shell — footer holds it. */
  senderCompany?: string;
}

export const emailFormatterService = {
  /**
   * Wrap a raw body in a professional 600px table-based email template.
   * Returns HTML ready for tracking pixel + footer injection.
   *
   * The output structure:
   *   <html>
   *     <body> preheader
   *       <table 600px center>
   *         <tr> accent bar
   *         <tr> body content (paragraphs, links, CTA buttons)
   *         <tr> signature (if any)
   *       </table>
   *     </body>
   *   </html>
   */
  wrap(input: EmailShellInput): string {
    // Idempotency: if the caller has already wrapped, don't re-wrap.
    if (input.bodyHtml && input.bodyHtml.includes(SHELL_MARKER_ATTR)) {
      return input.bodyHtml;
    }

    const accent = (input.accentColor || "#2563eb").trim();
    const preheader = escapeHtml((input.preheader || "").trim()).slice(0, 200);

    // If the caller gave us HTML, use it. Otherwise convert plaintext.
    const bodyInner = input.bodyHtml && input.bodyHtml.trim()
      ? input.bodyHtml.trim()
      : plaintextToHtml(input.bodyText);

    const bodyWithCtaButtons = upgradeCtaLinks(bodyInner, accent);

    const signatureRow = input.signatureHtml && input.signatureHtml.trim()
      ? `
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <div style="border-top:1px solid #e5e7eb;padding-top:20px;color:#4b5563;font-size:13px;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
              ${input.signatureHtml.trim()}
            </div>
          </td>
        </tr>`
      : "";

    const shell = `<!doctype html>
<html lang="en" xmlns:o="urn:schemas-microsoft-com:office:office" ${SHELL_MARKER_ATTR}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(input.subject || "")}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  @media only screen and (max-width:600px) {
    .oai-container { width:100% !important; }
    .oai-pad      { padding-left:20px !important; padding-right:20px !important; }
  }
  a { color:${accent}; }
  body { margin:0; padding:0; background:#f3f4f6; }
</style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
${preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-family:sans-serif;">${preheader}</div>` : ""}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f3f4f6;">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="oai-container" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04);">
        <tr>
          <td style="height:4px;background:${accent};line-height:4px;font-size:4px;">&nbsp;</td>
        </tr>
        <tr>
          <td class="oai-pad" style="padding:32px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            ${bodyWithCtaButtons}
          </td>
        </tr>
        ${signatureRow}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

    return shell;
  },
};
