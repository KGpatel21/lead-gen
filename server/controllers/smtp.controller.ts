/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import { dbService } from "../services/db.service";
import { smtpService } from "../services/smtp.service";
import { SecurityService } from "../services/security.service";
import { SmtpAccount, Domain, EmailTemplate, WarmupPhase } from "../../src/types";

export class SmtpController {
  public static getSmtpAccounts(req: Request, res: Response) {
    const dbState = dbService.getState();
    const activeSmtp = dbState.smtpAccounts.filter(s => !s.deletedAt);
    res.json({ success: true, data: activeSmtp });
  }

  public static createSmtpAccount(req: Request, res: Response) {
    const { name, email, smtpHost, smtpPort, username, smtpPassword, dailyLimit } = req.body;
    const dbState = dbService.getState();

    const exists = dbState.smtpAccounts.some(
      s => s.email.toLowerCase() === email.toLowerCase() && !s.deletedAt
    );
    if (exists) {
      res.status(400).json({ success: false, error: "An SMTP account with this email is already registered." });
      return;
    }

    const encryptedPassword = smtpPassword ? SecurityService.encryptSecret(smtpPassword) : "";

    const newAccount: SmtpAccount = {
      id: `smtp-${Date.now()}`,
      email,
      smtpHost,
      smtpPort,
      username,
      smtpPassword: encryptedPassword,
      dailyLimit: dailyLimit || 150,
      sentToday: 0,
      warmupEnabled: true, // Default to automatic deliverability warming
      warmupDailyLimit: 10,
      warmupSentToday: 0,
      warmupPhase: WarmupPhase.BEGINNER,
      spamRisk: "LOW",
      reputationScore: 100, // Starts at perfect deliverability placement
    };

    dbState.smtpAccounts.push(newAccount);
    dbService.saveDb();
    dbService.logAudit(`SMTP credential registered: ${email}`, "SMTP", undefined, `Host: ${smtpHost}:${smtpPort}`);

    res.status(201).json({ success: true, smtpAccount: newAccount });
  }

  public static updateSmtpAccount(req: Request, res: Response) {
    const { id } = req.params;
    const dbState = dbService.getState();
    const smtp = dbState.smtpAccounts.find(s => s.id === id && !s.deletedAt);
    if (!smtp) {
      res.status(404).json({ success: false, error: "SMTP account not found." });
      return;
    }

    const fields = ["smtpHost", "smtpPort", "username", "dailyLimit", "warmupEnabled", "warmupDailyLimit"];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        (smtp as any)[f] = req.body[f];
      }
    }

    if (req.body.smtpPassword) {
      smtp.smtpPassword = SecurityService.encryptSecret(req.body.smtpPassword);
    }

    dbService.saveDb();
    dbService.logAudit(`SMTP settings updated: ${smtp.email}`, "SMTP");

    res.json({ success: true, smtpAccount: smtp });
  }

  public static deleteSmtpAccount(req: Request, res: Response) {
    const { id } = req.params;
    const dbState = dbService.getState();
    const smtp = dbState.smtpAccounts.find(s => s.id === id && !s.deletedAt);
    if (!smtp) {
      res.status(404).json({ success: false, error: "SMTP account not found." });
      return;
    }

    smtp.deletedAt = new Date().toISOString();
    dbService.saveDb();
    dbService.logAudit(`SMTP soft-deleted: ${smtp.email}`, "SMTP");

    res.json({ success: true, message: "SMTP connection profile removed successfully." });
  }

  public static async testSmtpAccount(req: Request, res: Response) {
    const { id } = req.params;
    const dbState = dbService.getState();
    const smtp = dbState.smtpAccounts.find(s => s.id === id && !s.deletedAt);
    if (!smtp) {
      res.status(404).json({ success: false, error: "SMTP profile not found." });
      return;
    }

    try {
      if (smtp.smtpPassword) {
        await smtpService.testSmtpConnection(smtp);
      }
      
      smtp.errorMessage = undefined;
      smtp.reputationScore = Math.min(100, smtp.reputationScore + 5);
      dbService.saveDb();
      dbService.logAudit(`SMTP Diagnostics passed: ${smtp.email}`, "SMTP");

      res.json({ success: true, message: "Handshake Diagnostic: SMTP Connection authenticated successfully!" });
    } catch (err: any) {
      smtp.errorMessage = err.message || "Connection refused";
      smtp.reputationScore = Math.max(10, smtp.reputationScore - 15);
      dbService.saveDb();
      dbService.logAudit(`SMTP Diagnostics failed: ${smtp.email}`, "ERROR", undefined, smtp.errorMessage);

      res.json({ success: false, error: `SMTP Connection test failed: ${smtp.errorMessage}` });
    }
  }

  public static getDomains(req: Request, res: Response) {
    const dbState = dbService.getState();
    const activeDomains = dbState.domains.filter(d => !d.deletedAt);
    res.json({ success: true, data: activeDomains });
  }

  public static createDomain(req: Request, res: Response) {
    const { domainName } = req.body;
    if (!domainName) {
      res.status(400).json({ success: false, error: "Domain name is required." });
      return;
    }

    const dbState = dbService.getState();
    const exists = dbState.domains.some(
      d => d.name.toLowerCase() === domainName.toLowerCase() && !d.deletedAt
    );
    if (exists) {
      res.status(400).json({ success: false, error: "Domain is already registered." });
      return;
    }

    const newDomain: Domain = {
      id: `dom-${Date.now()}`,
      name: domainName,
      spfStatus: "PENDING",
      dkimStatus: "PENDING",
      dmarcStatus: "PENDING",
      healthScore: 50,
      inboxCount: 0,
      blacklistStatus: "CLEAN"
    };

    dbState.domains.push(newDomain);
    dbService.saveDb();
    dbService.logAudit(`Domain added to deliverability sentry: ${domainName}`, "SMTP");

    res.status(201).json({ success: true, domain: newDomain });
  }

  public static async verifyDomain(req: Request, res: Response) {
    const { id } = req.params;
    const dbState = dbService.getState();
    const domain = dbState.domains.find(d => d.id === id && !d.deletedAt);
    if (!domain) {
      res.status(404).json({ success: false, error: "Domain profile not found." });
      return;
    }

    const previousState = { ...domain };

    // Perform live, real-time DNS queries
    const dnsResult = await smtpService.performRealDnsVerification(domain.name);
    domain.spfStatus = dnsResult.spfStatus;
    domain.dkimStatus = dnsResult.dkimStatus;
    domain.dmarcStatus = dnsResult.dmarcStatus;
    domain.healthScore = dnsResult.healthScore;

    dbService.saveDb();
    dbService.logEntityHistory(id, "DOMAIN", "system", previousState, domain);
    dbService.logAudit(`DNS records verified for domain: ${domain.name}. SPF: ${domain.spfStatus}, DKIM: ${domain.dkimStatus}, DMARC: ${domain.dmarcStatus}`, "SMTP");

    res.json({ success: true, domain });
  }

  public static deleteDomain(req: Request, res: Response) {
    const { id } = req.params;
    const dbState = dbService.getState();
    const domain = dbState.domains.find(d => d.id === id && !d.deletedAt);
    if (!domain) {
      res.status(404).json({ success: false, error: "Domain profile not found." });
      return;
    }

    domain.deletedAt = new Date().toISOString();
    dbService.saveDb();
    dbService.logAudit(`Domain deliverability profile deleted: ${domain.name}`, "SMTP");

    res.json({ success: true, message: "Domain deliverability sentry removed successfully." });
  }

  public static getTemplates(req: Request, res: Response) {
    const dbState = dbService.getState();
    res.json({ success: true, data: dbState.templates });
  }

  public static createTemplate(req: Request, res: Response) {
    const { name, subject, body, category } = req.body;
    const dbState = dbService.getState();

    const newTemplate: EmailTemplate = {
      id: `tpl-${Date.now()}`,
      name,
      subject,
      body,
      category: category || "Outbound",
      createdAt: new Date().toISOString()
    };

    dbState.templates.push(newTemplate);
    dbService.saveDb();
    dbService.logAudit(`Outbound email template created: ${name}`, "CAMPAIGN");

    res.status(201).json({ success: true, template: newTemplate });
  }
}
