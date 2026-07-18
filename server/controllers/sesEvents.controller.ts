/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SNS webhook: /api/ses/events
 *
 * Handles SNS SubscriptionConfirmation (auto-confirms via SubscribeURL)
 * and Notification (bounce / complaint / delivery / reject / send / open / click).
 *
 * Phase 3.5 hardening:
 *   - Signature-verified via sns-validator BEFORE any side-effect.
 *   - Idempotent: dedupes by (email_id, event_type, sns_message_id).
 *     Duplicate SNS delivery (documented at-least-once) never creates
 *     duplicate DB events, double-counts bounces, or re-suppresses.
 *   - Workspace-scoped writes: uses email.workspace_id for suppression
 *     inserts so bounces landing in workspace A do not leak into B.
 */

import { Request, Response } from "express";
import MessageValidator from "sns-validator";
import { pool } from "../db/pool";
import {
  emailRepository,
  emailEventRepository,
  suppressionRepository,
} from "../db/repositories";
import { emailAccountRepository } from "../db/repositories/emailAccount.repository";
import { suppressionCacheService } from "../services/suppressionCache.service";
import { log } from "../observability/logger";

const validator = new MessageValidator();

interface SnsEnvelope {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId?: string;
  Message?: string;
  SubscribeURL?: string;
  Signature?: string;
  SigningCertURL?: string;
  SignatureVersion?: string;
  TopicArn?: string;
}

interface SesEventPayload {
  eventType?: string;
  mail?: {
    messageId?: string;
    tags?: Record<string, string[]>;
    headers?: Array<{ name: string; value: string }>;
    commonHeaders?: { messageId?: string };
  };
  bounce?: {
    bounceType?: "Undetermined" | "Permanent" | "Transient";
    bounceSubType?: string;
    bouncedRecipients?: Array<{ emailAddress: string; status?: string; diagnosticCode?: string }>;
  };
  complaint?: {
    complainedRecipients?: Array<{ emailAddress: string }>;
    complaintFeedbackType?: string;
  };
  delivery?: {
    recipients?: string[];
    timestamp?: string;
  };
}

function extractEmailIdFromTags(payload: SesEventPayload): string | undefined {
  const tag = payload?.mail?.tags?.["X-Email-Id"]?.[0];
  if (tag) return tag;
  const header = payload?.mail?.headers?.find(
    (h) => h.name?.toLowerCase() === "x-email-id"
  );
  return header?.value;
}

async function validateEnvelope(envelope: SnsEnvelope): Promise<boolean> {
  return new Promise((resolve) => {
    validator.validate(envelope as any, (err) => resolve(!err));
  });
}

async function autoConfirmSubscription(envelope: SnsEnvelope): Promise<void> {
  if (!envelope.SubscribeURL) return;
  try {
    const resp = await fetch(envelope.SubscribeURL, { method: "GET" });
    if (!resp.ok) throw new Error(`SubscribeURL HTTP ${resp.status}`);
    log.info({ topicArn: envelope.TopicArn }, "sns subscription confirmed");
  } catch (err: any) {
    log.warn({ err: err.message }, "sns subscription confirmation failed");
  }
}

/**
 * Idempotency check. Returns true if this (emailId, eventType, snsMessageId)
 * triple has already been recorded — in which case we drop the notification.
 */
async function alreadyProcessed(emailId: string, eventType: string, snsMessageId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM email_events
     WHERE email_id = $1 AND event_type = $2 AND sns_message_id = $3 LIMIT 1`,
    [emailId, eventType, snsMessageId]
  );
  return r.rows.length > 0;
}

/**
 * Persist the event row + sns_message_id atomically. Because the schema has
 * a UNIQUE index on (email_id, event_type, sns_message_id) WHERE sns_message_id
 * IS NOT NULL, a duplicate insert violates the constraint and returns FALSE
 * instead of silently double-recording.
 */
async function recordDedupedEvent(
  emailId: string,
  eventType: string,
  snsMessageId: string,
  rawPayload: any
): Promise<boolean> {
  const id = `ee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await pool.query(
    `INSERT INTO email_events (id, email_id, event_type, sns_message_id, raw_payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (email_id, event_type, sns_message_id) WHERE sns_message_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [id, emailId, eventType, snsMessageId, JSON.stringify(rawPayload ?? null)]
  );
  return (r.rowCount ?? 0) > 0;
}

export class SesEventsController {
  public static async handle(req: Request, res: Response): Promise<void> {
    let envelope: SnsEnvelope;
    if (typeof req.body === "string") {
      try { envelope = JSON.parse(req.body); }
      catch { res.status(400).send("Invalid JSON"); return; }
    } else {
      envelope = req.body as SnsEnvelope;
    }

    if (!envelope || !envelope.Type) {
      res.status(400).send("Missing SNS Type");
      return;
    }

    const isValid = await validateEnvelope(envelope);
    if (!isValid) {
      log.warn("sns signature validation failed — request rejected");
      res.status(400).send("Signature validation failed");
      return;
    }

    if (envelope.Type === "SubscriptionConfirmation") {
      await autoConfirmSubscription(envelope);
      res.status(200).send("OK");
      return;
    }

    if (envelope.Type === "Notification") {
      let payload: SesEventPayload = {};
      try { payload = JSON.parse(envelope.Message || "{}") as SesEventPayload; } catch { /* ignore */ }
      const snsMessageId = envelope.MessageId || `unknown-${Date.now()}`;
      await this.handleSesEvent(payload, snsMessageId);
      res.status(200).send("OK");
      return;
    }

    res.status(200).send("OK");
  }

  private static async handleSesEvent(payload: SesEventPayload, snsMessageId: string): Promise<void> {
    const eventType = (payload.eventType || "").toLowerCase();
    const sesMessageId = payload.mail?.messageId || payload.mail?.commonHeaders?.messageId;
    let emailId = extractEmailIdFromTags(payload);
    if (!emailId && sesMessageId) {
      const row = await emailRepository.findByMessageId(sesMessageId);
      emailId = row?.id;
    }
    if (!emailId) {
      log.warn({ eventType, sesMessageId }, "sns event could not resolve email row");
      return;
    }

    // Idempotency guard — the same SNS Message may arrive twice.
    if (await alreadyProcessed(emailId, eventType, snsMessageId)) {
      log.debug({ emailId, eventType, snsMessageId }, "sns event already applied, skipping");
      return;
    }

    const email = await emailRepository.findById(emailId);
    if (!email) return;
    const senderId = email.senderIdentityId;
    const workspaceId = email.workspaceId;

    switch (eventType) {
      case "bounce": {
        const permanent = payload.bounce?.bounceType === "Permanent";
        const first = await recordDedupedEvent(email.id, "bounce", snsMessageId, payload.bounce);
        if (!first) return;   // beat us to it — nothing more to do
        await emailRepository.recordBounced(email.id, permanent);
        if (senderId) await emailAccountRepository.recordBounce(senderId, permanent);
        if (permanent && workspaceId) {
          const recipients = payload.bounce?.bouncedRecipients || [];
          for (const r of recipients) {
            if (!r.emailAddress) continue;
            await suppressionRepository.add({
              workspaceId,
              email: r.emailAddress,
              reason: "bounce",
              bounceType: payload.bounce?.bounceType,
              bounceSubtype: payload.bounce?.bounceSubType,
              source: "ses-sns",
              campaignId: email.campaignId,
              notes: r.diagnosticCode,
            });
            await suppressionCacheService.invalidateAdd(r.emailAddress, workspaceId);
          }
        }
        break;
      }
      case "complaint": {
        const first = await recordDedupedEvent(email.id, "complaint", snsMessageId, payload.complaint);
        if (!first) return;
        await emailRepository.recordComplained(email.id);
        if (senderId) await emailAccountRepository.recordComplaint(senderId);
        if (workspaceId) {
          const recipients = payload.complaint?.complainedRecipients || [];
          for (const r of recipients) {
            if (!r.emailAddress) continue;
            await suppressionRepository.add({
              workspaceId,
              email: r.emailAddress,
              reason: "complaint",
              source: "ses-sns",
              campaignId: email.campaignId,
              notes: payload.complaint?.complaintFeedbackType,
            });
            await suppressionCacheService.invalidateAdd(r.emailAddress, workspaceId);
          }
        }
        break;
      }
      case "delivery": {
        const first = await recordDedupedEvent(email.id, "delivery", snsMessageId, payload.delivery);
        if (!first) return;
        await emailRepository.recordDelivered(email.id);
        if (senderId) await emailAccountRepository.recordDelivery(senderId);
        break;
      }
      case "reject":
      case "renderingfailure": {
        const first = await recordDedupedEvent(email.id, eventType, snsMessageId, payload as any);
        if (!first) return;
        await emailRepository.setStatus(email.id, "FAILED", {
          errorMessage: `SES ${eventType}`,
        });
        break;
      }
      case "send":
      case "open":
      case "click": {
        const first = await recordDedupedEvent(email.id, eventType, snsMessageId, payload as any);
        if (!first) return;
        if (eventType === "open") await emailRepository.recordOpen(email.id);
        if (eventType === "click") await emailRepository.recordClick(email.id);
        break;
      }
      default: {
        await recordDedupedEvent(email.id, eventType || "unknown", snsMessageId, payload as any);
      }
    }

    log.info({ emailId: email.id, eventType, snsMessageId }, "sns event applied");
  }
}
