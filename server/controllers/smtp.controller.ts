/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMTP + Domain + Legacy Templates controller — every endpoint is now
 * workspace-scoped.
 */

import { Response } from "express";
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
  public static async getSmtpAccounts(req: AuthenticatedRequest, res: Response): Promise<void> {
    const list = await smtpRepository.list(req.workspaceId);
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
    const dupe = await smtpRepository.findByEmail(email, req.workspaceId);
    if (dupe) {
      res.status(409).json({ success: false, error: "SMTP account with this email already registered." });
      return;
    }
    const encrypted = smtpPassword ? SecurityService.encryptSecret(smtpPassword) : "";
    const created = await smtpRepository.create({
      workspaceId: req.workspaceId!,
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
    const existing = await smtpRepository.findById(id, req.workspaceId);
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
    const updated = await smtpRepository.update(id, patch, req.workspaceId);
    await logAudit(`SMTP updated: ${existing.email}`, "SMTP", { userId: req.user?.id, ipAddress: req.ip });
    res.json({ success: true, smtpAccount: updated ? { ...updated, smtpPassword: updated.smtpPassword ? "***" : "" } : null });
  }

  public static async deleteSmtpAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const smtp = await smtpRepository.findById(id, req.workspaceId);
    if (!smtp) {
      res.status(404).json({ success: false, error: "SMTP account not found." });
      return;
    }
    await smtpRepository.softDelete(id, req.workspaceId);
    await logAudit(`SMTP deleted: ${smtp.email}`, "SMTP", { userId: req.user?.id, ipAddress: req.ip });
    res.json({ success: true });
  }

  public static async testSmtpAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const smtp = await smtpRepository.findById(id, req.workspaceId);
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

  // -------- Domains --------
  public static async getDomains(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await domainRepository.list(req.workspaceId);
    res.json({ success: true, data });
  }

  public static async createDomain(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { domainName } = req.body;
    if (typeof domainName !== "string" || domainName.trim() === "") {
      res.status(400).json({ success: false, error: "domainName required." });
      return;
    }
    const dupe = await domainRepository.findByName(domainName, req.workspaceId);
    if (dupe) {
      res.status(409).json({ success: false, error: "Domain already registered in this workspace." });
      return;
    }
    const created = await domainRepository.create(domainName.trim(), req.workspaceId!);
    await logAudit(`Domain added: ${domainName}`, "SECURITY", { userId: req.user?.id });
    res.status(201).json({ success: true, domain: created });
  }

  public static async verifyDomain(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const dom = await domainRepository.findById(id, req.workspaceId);
    if (!dom) {
      res.status(404).json({ success: false, error: "Domain not found." });
      return;
    }
    const dns = await smtpService.performRealDnsVerification(dom.name);
    const updated = await domainRepository.setVerification(dom.id, {
      spfStatus: dns.spfStatus,
      dkimStatus: dns.dkimStatus,
      dmarcStatus: dns.dmarcStatus,
      healthScore: dns.healthScore,
    }, req.workspaceId);
    res.json({ success: true, domain: updated });
  }

  public static async deleteDomain(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const dom = await domainRepository.findById(id, req.workspaceId);
    if (!dom) {
      res.status(404).json({ success: false, error: "Domain not found." });
      return;
    }
    await domainRepository.softDelete(id, req.workspaceId);
    res.json({ success: true });
  }

  // -------- Legacy templates (quick-slot) --------
  public static async getTemplates(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await templateRepository.list(req.workspaceId);
    res.json({ success: true, data });
  }

  public static async createTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { name, subject, body, category } = req.body;
    if (!name || !subject || !body) {
      res.status(400).json({ success: false, error: "name, subject, body required." });
      return;
    }
    const created = await templateRepository.create({
      workspaceId: req.workspaceId!,
      name, subject, body, category,
    });
    res.status(201).json({ success: true, template: created });
  }

  // -------- History (audit trail) — kept but scoped by JOIN --------
  public static async _preserveHistoryImport(): Promise<void> {
    // Kept so the import isn't dead-code stripped by esbuild. historyRepository
    // is used by other controllers via the shared barrel.
    void historyRepository;
  }
}
