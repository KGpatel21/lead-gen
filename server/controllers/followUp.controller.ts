/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import { followUpRuleRepository } from "../db/repositories";

export class FollowUpController {
  public static async list(req: Request, res: Response): Promise<void> {
    const { campaignId } = req.params;
    const rows = await followUpRuleRepository.listByCampaign(campaignId);
    res.json({ success: true, data: rows });
  }

  public static async ensureDefaults(req: Request, res: Response): Promise<void> {
    const { campaignId } = req.params;
    const rules = await followUpRuleRepository.ensureDefaults(campaignId);
    res.json({ success: true, data: rules });
  }

  public static async setRule(req: Request, res: Response): Promise<void> {
    const { campaignId } = req.params;
    const { step, delayDays, subjectPrefix, bodyInstruction, isActive } = req.body || {};
    if (typeof step !== "number" || typeof delayDays !== "number") {
      res.status(400).json({ success: false, error: "step (number) and delayDays (number) required." });
      return;
    }
    const rule = await followUpRuleRepository.setRule({
      campaignId,
      step,
      delayDays,
      subjectPrefix,
      bodyInstruction,
      isActive,
    });
    res.json({ success: true, rule });
  }
}
