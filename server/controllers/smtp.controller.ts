/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import {
  smtpRepository,
  domainRepository,
  templateRepository,
  historyRepository,
} from "../db/repositories";
import { smtpService } from "../services/smtp.service";
import { SecurityService } from "../services/security.service";
import { logAudit } from "../services/db.service";
import { WarmupPhase } from "../../src/types";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SmtpController {
  public static async getSmtpAccounts(_req: Request, res: Response): Promise<void> {
    const list = await smtpRepository.list();
    // Never leak encrypted passwords
    const sanitized = list.map((s) => ({ ...s, smtpPassword: s.smtpPassword ? "***" : "" }));
    res.json({ success: true, data: sanitized });
  }

  public static async createSmtpAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { email, smtpHost, smtpPort, username, smtpPassword, dailyLimit } = req.body;
    if (!EMAIL_REGEX.test(email || "")) {
      res.status(400).json({ success: false, error: "Invalid email." });
      return;
    }
    if (typeof smtpHost !== "string" || typeof smtpPort !== "number" || typeof username !== "string") {
      res.status(400).json({ success: false, error: "smtpHost, smtpPort, username required." });
      return;
    }
    const dupe = await smtpRepository.findByEmail(email);
    if (dupe) {
      res.status(409).json({ success: false, error: "SMTP account with this email already registered." });
      return;
    }
    const encrypted = smtpPassword ? SecurityService.encryptSecret(smtpPassword) : "";
    const created = await smtpRepository.create({
      email,
      smtpHost,
      smtpPort,
      username,
      smtpPassword: encrypted,
      dailyLimit: typeof dailyLimit === "number" ? dailyLimit : 50,
      warmupEnabled: true,
      warmupDailyLimit: 15,
      warmupPhase: WarmupPhase.BEGINNER,
    });
    await logAudit(`SMTP account added: ${email}`, "SMTP", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: `${smtpHost}:${smtpPort}`,
      ipAddress: req.ip,
    });
    res.status(201).json({ success: true, smtpAccount: { ...created, smtpPassword: created.smtpPassword ? "***" : "" } });
  }

  public static async updateSmtpAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const existing = await smtpRepository.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, error: "SMTP account not found." });
      return;
    }
    const patch: Record<string, unknown> = {};
    for (const f of ["smtpHost", "smtpPort", "username", "dailyLimit", "warmupEnabled", "warmupDailyLimit"] as const) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    if (typeof req.body.smtpPassword === "string" && req.body.smtpPassword.length > 0) {
      patch.smtpPassword = SecurityService.encryptSecret(req.body.smtpPassword);
    }
    const updated = await smtpRepository.update(id, patch);
    await logAudit(`SMTP updated: ${existing.email}`, "SMTP", { userId: req.user?.id, ipAddress: req.ip });
    res.json({ success: true, smtpAccount: updated ? { ...updated, smtpPassword: updated.smtpPassword ? "***" : "" } : null });
  }

  public static async deleteSmtpAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const smtp = await smtpRepository.findById(id);
    if (!smtp) {
      res.status(404).json({ success: false, error: "SMTP account not found." });
      return;
    }
    await smtpRepository.softDelete(id);
    await logAudit(`SMTP deleted: ${smtp.email}`, "SMTP", { userId: req.user?.id, ipAddress: req.ip });
    res.json({ success: true });
  }

  public static async testSmtpAccount(_req: Request, res: Response): Promise<void> {
    const { id } = _req.params;
    const smtp = await smtpRepository.findById(id);
    if (!smtp) {
      res.status(404).json({ success: false, error: "SMTP account not found." });
      return;
    }
    if (!smtp.smtpPassword) {
      res.status(400).json({ success: false, error: "SMTP account has no password on file." });
      return;
    }
    try {
      await smtpService.testSmtpConnection(smtp);
      await smtpRepository.adjustReputation(smtp.id, +5);
      await logAudit(`SMTP diagnostic pass: ${smtp.email}`, "SMTP");
      res.json({ success: true, message: "SMTP handshake succeeded." });
    } catch (err: any) {
      await smtpRepository.adjustReputation(smtp.id, -15, err?.message);
      await logAudit(`SMTP diagnostic fail: ${smtp.email}`, "ERROR", { details: err?.message });
      res.status(400).json({ success: false, error: err?.message || "Handshake failed." });
    }
  }

  public static async getDomains(_req: Request, res: Response): Promise<void> {
    const data = await domainRepository.list();
    res.json({ success: true, data });
  }

  public static async createDomain(req: Request, res: Response): Promise<void> {
    const { domainName } = req.body;
    if (typeof domainName !== "string" || domainName.trim() === "") {
      res.status(400).json({ success: false, error: "domainName is required." });
      return;
    }
    const dupe = await domainRepository.findByName(domainName);
    if (dupe) {
      res.status(409).json({ success: false, error: "Domain already registered." });
      return;
    }
    const domain = await domainRepository.create(domainName.trim());
    await logAudit(`Domain added: ${domain.name}`, "SMTP");
    res.status(201).json({ success: true, domain });
  }

  public static async verifyDomain(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const before = await domainRepository.findById(id);
    if (!before) {
      res.status(404).json({ success: false, error: "Domain not found." });
      return;
    }
    const result = await smtpService.performRealDnsVerification(before.name);
    const after = await domainRepository.setVerification(id, result);
    if (after) {
      await historyRepository.log({
        entityId: id,
        entityType: "DOMAIN",
        changedBy: req.user?.email || "system",
        previousState: before,
        newState: after,
      });
    }
    await logAudit(
      `Domain verify: ${before.name}`,
      "SMTP",
      { details: `SPF=${result.spfStatus} DKIM=${result.dkimStatus} DMARC=${result.dmarcStatus}` }
    );
    res.json({ success: true, domain: after });
  }

  public static async deleteDomain(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const domain = await domainRepository.findById(id);
    if (!domain) {
      res.status(404).json({ success: false, error: "Domain not found." });
      return;
    }
    await domainRepository.softDelete(id);
    await logAudit(`Domain deleted: ${domain.name}`, "SMTP");
    res.json({ success: true });
  }

  public static async getTemplates(_req: Request, res: Response): Promise<void> {
    const data = await templateRepository.list();
    res.json({ success: true, data });
  }

  public static async createTemplate(req: Request, res: Response): Promise<void> {
    const { name, subject, body, category } = req.body;
    if (typeof name !== "string" || typeof subject !== "string" || typeof body !== "string") {
      res.status(400).json({ success: false, error: "name, subject, body required." });
      return;
    }
    const template = await templateRepository.create({ name, subject, body, category });
    await logAudit(`Template created: ${name}`, "CAMPAIGN");
    res.status(201).json({ success: true, template });
  }
}
