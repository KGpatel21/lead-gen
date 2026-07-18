/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5 campaign automation API.
 * REST verbs specific to sequences, prospects, holidays, and campaign
 * lifecycle actions (pause/resume/clone/archive/skip/force/cancel-queued).
 * Everything is workspace-scoped via WorkspaceScopedRequest.
 */

import { Response } from "express";
import {
  campaignRepository,
  campaignProspectRepository,
  sequenceStepRepository,
  holidayRepository,
  senderPoolRepository,
  leadRepository,
} from "../db/repositories";
import { WorkspaceScopedRequest } from "../middleware/workspaceContext.middleware";
import { CampaignStatus } from "../../src/types";
import { sequenceEngineService } from "../services/sequenceEngine.service";
import { triggerAdvance } from "../queues/sequenceTickQueue";
import { emailQueue, pauseCampaign, resumeCampaign, cancelCampaign } from "../queues/emailQueue";
import { logAudit } from "../services/db.service";
import { pool } from "../db/pool";

function bad(res: Response, msg: string, code = 400) {
  res.status(code).json({ success: false, error: msg });
}

export class CampaignAutomationController {
  // -------- Sequences --------
  public static async listSteps(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    const steps = await sequenceStepRepository.listByCampaign(id, req.workspaceId);
    res.json({ success: true, steps });
  }

  public static async replaceSteps(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
    if (steps.length === 0) { bad(res, "steps[] required"); return; }
    for (const s of steps) {
      if (typeof s.stepIndex !== "number") { bad(res, `stepIndex missing on step ${JSON.stringify(s)}`); return; }
      if (s.mode && !["ai", "manual"].includes(s.mode)) { bad(res, `mode must be ai|manual`); return; }
      if (s.senderPoolId) {
        const pool = await senderPoolRepository.findById(s.senderPoolId, req.workspaceId!);
        if (!pool) { bad(res, `senderPoolId invalid: ${s.senderPoolId}`); return; }
      }
    }
    const saved = await sequenceStepRepository.replaceAll(id, req.workspaceId!, steps);
    res.json({ success: true, steps: saved });
  }

  public static async upsertStep(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    const b = req.body || {};
    if (typeof b.stepIndex !== "number") { bad(res, "stepIndex required"); return; }
    const step = await sequenceStepRepository.create({
      workspaceId: req.workspaceId!,
      campaignId: id,
      stepIndex: b.stepIndex,
      abGroup: b.abGroup,
      delayHours: b.delayHours,
      mode: b.mode,
      subject: b.subject,
      bodyText: b.bodyText,
      bodyHtml: b.bodyHtml,
      aiInstruction: b.aiInstruction,
      senderPoolId: b.senderPoolId,
      accountId: b.accountId,
      isActive: b.isActive,
    });
    res.status(201).json({ success: true, step });
  }

  public static async deleteStep(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { stepId } = req.params;
    const ok = await sequenceStepRepository.delete(stepId, req.workspaceId);
    if (!ok) { bad(res, "step not found", 404); return; }
    res.json({ success: true });
  }

  // -------- Enrollment / prospects --------
  public static async listProspects(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    const prospects = await campaignProspectRepository.listByCampaign(id, req.workspaceId);
    res.json({ success: true, prospects });
  }

  public static async enrollLeads(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }

    let leadIds: string[] = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
    if (leadIds.length === 0) {
      // No explicit leadIds → enroll every lead already attached to the campaign.
      const leads = await leadRepository.listByCampaign(id);
      leadIds = leads.map((l: any) => l.id);
    }
    const result = await sequenceEngineService.enrollBulk({
      workspaceId: req.workspaceId!,
      campaignId: id,
      leadIds,
    });
    await logAudit(`Enrolled ${result.enrolled} leads into campaign '${camp.name}'`, "CAMPAIGN", {
      userId: req.user?.id,
      userEmail: req.user?.email,
    });
    res.json({ success: true, ...result });
  }

  public static async skipLead(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { prospectId } = req.params;
    const updated = await campaignProspectRepository.skipLead(prospectId, req.workspaceId);
    if (!updated) { bad(res, "prospect not found", 404); return; }
    res.json({ success: true, prospect: updated });
  }

  public static async forceNextStep(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { prospectId } = req.params;
    const prospect = await campaignProspectRepository.findById(prospectId, req.workspaceId);
    if (!prospect) { bad(res, "prospect not found", 404); return; }
    const jobId = await triggerAdvance(prospectId);
    res.json({ success: true, jobId });
  }

  public static async previewNext(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { prospectId } = req.params;
    const prospect = await campaignProspectRepository.findById(prospectId, req.workspaceId);
    if (!prospect) { bad(res, "prospect not found", 404); return; }
    try {
      const preview = await sequenceEngineService.previewNext(prospectId);
      res.json({ success: true, preview });
    } catch (err: any) {
      bad(res, err?.message || "preview failed", 500);
    }
  }

  // -------- Lifecycle --------
  public static async pause(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    await campaignRepository.setStatus(id, CampaignStatus.PAUSED);
    const pausedProspects = await campaignProspectRepository.pauseCampaign(id);
    const { paused: pausedEmails } = await pauseCampaign(id);
    await logAudit(`Campaign '${camp.name}' paused`, "CAMPAIGN", {
      userId: req.user?.id, userEmail: req.user?.email,
    });
    res.json({ success: true, pausedProspects, pausedEmails });
  }

  public static async resume(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    await campaignRepository.setStatus(id, CampaignStatus.RUNNING);
    const resumedProspects = await campaignProspectRepository.resumeCampaign(id);
    const { resumed: resumedEmails } = await resumeCampaign(id);
    await logAudit(`Campaign '${camp.name}' resumed`, "CAMPAIGN", {
      userId: req.user?.id, userEmail: req.user?.email,
    });
    res.json({ success: true, resumedProspects, resumedEmails });
  }

  public static async clone(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const newName = String(req.body?.name || "").trim() || "";
    const clone = await campaignRepository.clone(id, req.workspaceId!, newName);
    if (!clone) { bad(res, "source campaign not found", 404); return; }
    // Copy the sequence steps too.
    const srcSteps = await sequenceStepRepository.listByCampaign(id, req.workspaceId);
    for (const s of srcSteps) {
      await sequenceStepRepository.create({
        workspaceId: req.workspaceId!,
        campaignId: clone.id,
        stepIndex: s.stepIndex,
        abGroup: s.abGroup,
        delayHours: s.delayHours,
        mode: s.mode,
        subject: s.subject,
        bodyText: s.bodyText,
        bodyHtml: s.bodyHtml,
        aiInstruction: s.aiInstruction,
        senderPoolId: s.senderPoolId,
        accountId: s.accountId,
        isActive: s.isActive,
      });
    }
    await logAudit(`Campaign cloned from ${id} → ${clone.id}`, "CAMPAIGN", {
      userId: req.user?.id, userEmail: req.user?.email,
    });
    res.status(201).json({ success: true, campaign: clone, stepsCopied: srcSteps.length });
  }

  public static async archive(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    await campaignRepository.archive(id);
    res.json({ success: true });
  }

  public static async unarchive(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    await campaignRepository.unarchive(id);
    res.json({ success: true });
  }

  public static async cancelQueued(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { emailId } = req.params;
    // Cancel the DB row.
    const r = await pool.query(
      "UPDATE emails SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND workspace_id = $2 AND status IN ('READY','RETRY','PAUSED') RETURNING id",
      [emailId, req.workspaceId]
    );
    // Remove any pending BullMQ job.
    let removed = 0;
    const states: Array<"waiting" | "delayed" | "prioritized"> = ["waiting", "delayed", "prioritized"];
    for (const state of states) {
      const jobs = await emailQueue.getJobs([state], 0, 10_000, true);
      for (const job of jobs) {
        if (job.data?.emailId === emailId) {
          try { await job.remove(); removed++; } catch { /* ignore */ }
        }
      }
    }
    if ((r.rowCount ?? 0) === 0 && removed === 0) { bad(res, "email not cancelable", 404); return; }
    res.json({ success: true, cancelledRow: r.rowCount ?? 0, removedJobs: removed });
  }

  public static async deleteCampaign(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const camp = await campaignRepository.findById(id, req.workspaceId);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    await cancelCampaign(id);
    await campaignRepository.softDelete(id);
    res.json({ success: true });
  }

  // -------- Holidays --------
  public static async listHolidays(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const list = await holidayRepository.list(req.workspaceId!, id);
    res.json({ success: true, holidays: list });
  }

  public static async addHoliday(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const { date, name, scope } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) { bad(res, "date must be YYYY-MM-DD"); return; }
    const hs = scope === "global" ? "global" : "campaign";
    const created = await holidayRepository.add({
      workspaceId: req.workspaceId!,
      scope: hs,
      date,
      campaignId: hs === "campaign" ? id : undefined,
      name,
    });
    res.status(201).json({ success: true, holiday: created });
  }

  public static async removeHoliday(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { holidayId } = req.params;
    const ok = await holidayRepository.remove(holidayId, req.workspaceId!);
    if (!ok) { bad(res, "not found", 404); return; }
    res.json({ success: true });
  }
}
