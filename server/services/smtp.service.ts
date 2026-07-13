/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Nodemailer SMTP dispatch + real DNS verification (SPF/DMARC/MX).
 *
 * The prior "mock DNS pass for test/example domains" fallback has been
 * removed. If SPF/DMARC/MX aren't published, the domain doesn't verify.
 */

import nodemailer from "nodemailer";
import dns from "dns";
import { SmtpAccount } from "../../src/types";
import { SecurityService } from "./security.service";

export interface DnsVerificationResult {
  spfStatus: "VALID" | "INVALID" | "PENDING";
  dkimStatus: "VALID" | "INVALID" | "PENDING";
  dmarcStatus: "VALID" | "INVALID" | "PENDING";
  healthScore: number;
}

class SmtpService {
  private buildTransporter(smtp: SmtpAccount) {
    const decryptedPassword = smtp.smtpPassword
      ? SecurityService.decryptSecret(smtp.smtpPassword)
      : "";
    return nodemailer.createTransport({
      host: smtp.smtpHost,
      port: smtp.smtpPort,
      secure: smtp.smtpPort === 465,
      auth: { user: smtp.username, pass: decryptedPassword },
    });
  }

  public async sendRealSmtpEmail(
    smtp: SmtpAccount,
    to: string,
    subject: string,
    body: string
  ): Promise<{ messageId?: string }> {
    const transporter = this.buildTransporter(smtp);
    const info = await transporter.sendMail({
      from: `"${smtp.username}" <${smtp.email}>`,
      to,
      subject,
      text: body,
    });
    return { messageId: info.messageId };
  }

  public async testSmtpConnection(smtp: SmtpAccount): Promise<boolean> {
    const transporter = this.buildTransporter(smtp);
    await transporter.verify();
    return true;
  }

  public async performRealDnsVerification(domainName: string): Promise<DnsVerificationResult> {
    const [spfPresent, dmarcPresent, mxPresent] = await Promise.all([
      this.hasSpf(domainName),
      this.hasDmarc(domainName),
      this.hasMx(domainName),
    ]);
    // Standard DKIM selectors are per-tenant; without one we can't verify DKIM,
    // so we report PENDING unless a well-known selector responds.
    const dkimPresent = await this.hasCommonDkimSelector(domainName);

    const scored =
      (spfPresent ? 30 : 0) +
      (dmarcPresent ? 25 : 0) +
      (mxPresent ? 25 : 0) +
      (dkimPresent ? 20 : 0);

    return {
      spfStatus: spfPresent ? "VALID" : "INVALID",
      dkimStatus: dkimPresent ? "VALID" : "PENDING",
      dmarcStatus: dmarcPresent ? "VALID" : "INVALID",
      healthScore: scored,
    };
  }

  private async hasSpf(domain: string): Promise<boolean> {
    try {
      const records = await dns.promises.resolveTxt(domain);
      return records.some((chunks) => chunks.some((s) => s.startsWith("v=spf1")));
    } catch {
      return false;
    }
  }

  private async hasDmarc(domain: string): Promise<boolean> {
    try {
      const records = await dns.promises.resolveTxt(`_dmarc.${domain}`);
      return records.some((chunks) => chunks.some((s) => s.startsWith("v=DMARC1")));
    } catch {
      return false;
    }
  }

  private async hasMx(domain: string): Promise<boolean> {
    try {
      const records = await dns.promises.resolveMx(domain);
      return Array.isArray(records) && records.length > 0;
    } catch {
      return false;
    }
  }

  private async hasCommonDkimSelector(domain: string): Promise<boolean> {
    const selectors = ["google", "selector1", "selector2", "default", "mail", "s1"];
    for (const sel of selectors) {
      try {
        const records = await dns.promises.resolveTxt(`${sel}._domainkey.${domain}`);
        if (records.some((chunks) => chunks.some((s) => s.includes("v=DKIM1")))) {
          return true;
        }
      } catch {
        /* selector not present, try next */
      }
    }
    return false;
  }
}

export const smtpService = new SmtpService();
