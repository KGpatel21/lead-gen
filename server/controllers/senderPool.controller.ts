/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import { senderPoolRepository, emailAccountRepository, PoolStrategy } from "../db/repositories";
import { pool } from "../db/pool";

const STRATEGIES: PoolStrategy[] = ["round_robin", "least_used", "random", "weighted", "health"];

export class SenderPoolController {
  public static async list(_req: Request, res: Response): Promise<void> {
    const data = await senderPoolRepository.list();
    res.json({ success: true, data });
  }

  public static async get(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const p = await senderPoolRepository.findById(id);
    if (!p) { res.status(404).json({ success: false, error: "not found" }); return; }
    const members = await senderPoolRepository.listMembers(id);
    res.json({ success: true, pool: p, members });
  }

  public static async create(req: Request, res: Response): Promise<void> {
    const { name, strategy, campaignId } = req.body || {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ success: false, error: "name required" });
      return;
    }
    if (strategy && !STRATEGIES.includes(strategy)) {
      res.status(400).json({ success: false, error: `strategy must be one of ${STRATEGIES.join(", ")}` });
      return;
    }
    const p = await senderPoolRepository.create({ name: name.trim(), strategy, campaignId });
    res.status(201).json({ success: true, pool: p });
  }

  public static async update(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { name, strategy, isActive } = req.body || {};
    if (strategy && !STRATEGIES.includes(strategy)) {
      res.status(400).json({ success: false, error: `strategy must be one of ${STRATEGIES.join(", ")}` });
      return;
    }
    const updated = await senderPoolRepository.update(id, { name, strategy, isActive });
    if (!updated) { res.status(404).json({ success: false, error: "not found" }); return; }
    res.json({ success: true, pool: updated });
  }

  public static async addMember(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { accountId, weight } = req.body || {};
    const acct = await emailAccountRepository.findById(accountId);
    if (!acct) { res.status(400).json({ success: false, error: "accountId not found" }); return; }
    const member = await senderPoolRepository.addMember(id, accountId, typeof weight === "number" ? weight : 1);
    res.status(201).json({ success: true, member });
  }

  public static async removeMember(req: Request, res: Response): Promise<void> {
    const { id, accountId } = req.params;
    const ok = await senderPoolRepository.removeMember(id, accountId);
    if (!ok) { res.status(404).json({ success: false, error: "not on pool" }); return; }
    res.json({ success: true });
  }

  public static async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    await senderPoolRepository.delete(id);
    res.json({ success: true });
  }

  public static async bindToCampaign(req: Request, res: Response): Promise<void> {
    const { campaignId, poolId } = req.body || {};
    if (!campaignId || !poolId) {
      res.status(400).json({ success: false, error: "campaignId and poolId required" });
      return;
    }
    await pool.query(
      "UPDATE campaigns SET sender_pool_id = $1, updated_at = NOW() WHERE id = $2",
      [poolId, campaignId]
    );
    res.json({ success: true });
  }
}
