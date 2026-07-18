/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sender identity CRUD + on-demand SES identity verification refresh.
 */

import { Request, Response } from "express";
import {
  SESv2Client,
  GetEmailIdentityCommand,
  CreateEmailIdentityCommand,
} from "@aws-sdk/client-sesv2";
import { config } from "../config";
import { senderIdentityRepository, SesVerificationStatus } from "../db/repositories";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { logAudit } from "../services/db.service";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function makeClient(): SESv2Client | null {
  if (!config.awsAccessKeyId || !config.awsSecretAccessKey) return null;
  return new SESv2Client({
    region: config.awsRegion,
    credentials: {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    },
  });
}

function mapSesStatus(s?: string): SesVerificationStatus {
  switch (s) {
    case "SUCCESS":
    case "VERIFIED":
      return "VERIFIED";
    case "FAILED":
    case "TEMPORARY_FAILURE":
      return "FAILED";
    default:
      return "PENDING";
  }
}

export class SenderIdentityController {
  public static async list(_req: Request, res: Response): Promise<void> {
    const data = await senderIdentityRepository.list();
    res.json({ success: true, data });
  }

  public static async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { email, displayName, dailySendLimit } = req.body || {};
    if (!EMAIL_REGEX.test(email || "")) {
      res.status(400).json({ success: false, error: "email required (valid format)." });
      return;
    }
    const dupe = await senderIdentityRepository.findByEmail(email);
    if (dupe) {
      res.status(409).json({ success: false, error: "sender_identity already exists." });
      return;
    }
    const created = await senderIdentityRepository.create({
      email,
      displayName,
      dailySendLimit: typeof dailySendLimit === "number" ? dailySendLimit : 200,
    });

    const client = makeClient();
    if (client) {
      // Best-effort: create the SES identity so the customer can verify it.
      // Ignored if it already exists.
      try {
        await client.send(new CreateEmailIdentityCommand({ EmailIdentity: created.email }));
      } catch (err: any) {
        if (err?.name !== "AlreadyExistsException" && err?.$metadata?.httpStatusCode !== 400) {
          console.warn(`[sender] create SES identity failed: ${err?.message}`);
        }
      }
      // Then pull current verification status.
      try {
        const desc = await client.send(new GetEmailIdentityCommand({ EmailIdentity: created.email }));
        await senderIdentityRepository.setVerificationStatus(created.id, mapSesStatus(desc.VerificationStatus));
      } catch (err: any) {
        console.warn(`[sender] get SES identity failed: ${err?.message}`);
      }
    }

    await logAudit(`Sender identity added: ${created.email}`, "SMTP", {
      userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip,
    });

    const refreshed = await senderIdentityRepository.findById(created.id);
    res.status(201).json({ success: true, senderIdentity: refreshed });
  }

  /**
   * POST /api/sender-identities/:id/refresh — re-query SES and update the row.
   */
  public static async refresh(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const s = await senderIdentityRepository.findById(id);
    if (!s) { res.status(404).json({ success: false, error: "not found" }); return; }
    const client = makeClient();
    if (!client) {
      res.status(503).json({ success: false, error: "SES not configured." });
      return;
    }
    try {
      const desc = await client.send(new GetEmailIdentityCommand({ EmailIdentity: s.email }));
      const mapped = mapSesStatus(desc.VerificationStatus);
      await senderIdentityRepository.setVerificationStatus(id, mapped);
      const refreshed = await senderIdentityRepository.findById(id);
      res.json({ success: true, senderIdentity: refreshed });
    } catch (err: any) {
      res.status(502).json({ success: false, error: err?.message || "SES query failed" });
    }
  }

  public static async setActive(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { active } = req.body || {};
    if (typeof active !== "boolean") {
      res.status(400).json({ success: false, error: "active (boolean) required." });
      return;
    }
    const s = await senderIdentityRepository.findById(id);
    if (!s) { res.status(404).json({ success: false, error: "not found" }); return; }
    await senderIdentityRepository.setActive(id, active);
    res.json({ success: true, senderIdentity: await senderIdentityRepository.findById(id) });
  }

  public static async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const s = await senderIdentityRepository.findById(id);
    if (!s) { res.status(404).json({ success: false, error: "not found" }); return; }
    await senderIdentityRepository.softDelete(id);
    res.json({ success: true });
  }
}
