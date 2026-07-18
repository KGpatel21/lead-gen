/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SNS webhook: /api/ses/events
 *
 * Handles both SNS SubscriptionConfirmation (auto-confirm by GET-ing the
 * SubscribeURL) and Notification (bounce/complaint/delivery/reject/send).
 *
 * Verifies the SNS message signature — never trusts the payload otherwise.
 * Updates: email row status, sender reputation, suppression list, events log.
 */

import { Request, Response } from "express";
import MessageValidator from "sns-validator";
import {
  emailRepository,
  emailEventRepository,
  suppressionRepository,
} from "../db/repositories";
import { emailAccountRepository } from "../db/repositories/emailAccount.repository";

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
    if (!resp.ok) throw new Error(`SubscribeURL returned HTTP ${resp.status}`);
    console.log(`[sns] subscription confirmed topic=${envelope.TopicArn || "unknown"}`);
  } catch (err: any) {
    console.warn(`[sns] failed to confirm subscription: ${err?.message}`);
  }
}

export class SesEventsController {
  /**
   * POST /api/ses/events
   * Amazon SNS posts messages here. Signature must be verified.
   */
  public static async handle(req: Request, res: Response): Promise<void> {
    // SNS sets Content-Type: text/plain but body is JSON. Support both parsed
    // and raw body flavors.
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
      console.warn("[sns] signature validation failed — request rejected");
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
      await this.handleSesEvent(payload);
      res.status(200).send("OK");
      return;
    }

    res.status(200).send("OK");
  }

  private static async handleSesEvent(payload: SesEventPayload): Promise<void> {
    const eventType = (payload.eventType || "").toLowerCase();
    const messageId = payload.mail?.messageId || payload.mail?.commonHeaders?.messageId;
    let emailId = extractEmailIdFromTags(payload);
    if (!emailId && messageId) {
      const row = await emailRepository.findByMessageId(messageId);
      emailId = row?.id;
    }

    if (!emailId) {
      console.warn(`[sns] event=${eventType} could not resolve email row (messageId=${messageId ?? "?"})`);
      return;
    }

    const email = await emailRepository.findById(emailId);
    if (!email) return;
    const senderId = email.senderIdentityId;

    switch (eventType) {
      case "bounce": {
        const permanent = payload.bounce?.bounceType === "Permanent";
        await emailRepository.recordBounced(email.id, permanent);
        await emailEventRepository.log({
          emailId: email.id,
          eventType: "bounce",
          rawPayload: payload.bounce,
        });
        if (senderId) await emailAccountRepository.recordBounce(senderId, permanent);
        // Suppress permanent bounces so we never retry.
        if (permanent) {
          const recipients = payload.bounce?.bouncedRecipients || [];
          for (const r of recipients) {
            if (r.emailAddress) {
              await suppressionRepository.add({
                email: r.emailAddress,
                reason: "bounce",
                bounceType: payload.bounce?.bounceType,
                bounceSubtype: payload.bounce?.bounceSubType,
                source: "ses-sns",
                campaignId: email.campaignId,
                notes: r.diagnosticCode,
              });
            }
          }
        }
        break;
      }
      case "complaint": {
        await emailRepository.recordComplained(email.id);
        await emailEventRepository.log({
          emailId: email.id,
          eventType: "complaint",
          rawPayload: payload.complaint,
        });
        if (senderId) await emailAccountRepository.recordComplaint(senderId);
        const recipients = payload.complaint?.complainedRecipients || [];
        for (const r of recipients) {
          if (r.emailAddress) {
            await suppressionRepository.add({
              email: r.emailAddress,
              reason: "complaint",
              source: "ses-sns",
              campaignId: email.campaignId,
              notes: payload.complaint?.complaintFeedbackType,
            });
          }
        }
        break;
      }
      case "delivery": {
        await emailRepository.recordDelivered(email.id);
        await emailEventRepository.log({
          emailId: email.id,
          eventType: "delivery",
          rawPayload: payload.delivery,
        });
        if (senderId) await emailAccountRepository.recordDelivery(senderId);
        break;
      }
      case "reject":
      case "renderingfailure": {
        await emailRepository.setStatus(email.id, "FAILED", {
          errorMessage: `SES ${eventType}`,
        });
        await emailEventRepository.log({
          emailId: email.id,
          eventType,
          rawPayload: payload as any,
        });
        break;
      }
      case "send":
      case "open":
      case "click": {
        await emailEventRepository.log({
          emailId: email.id,
          eventType,
          rawPayload: payload as any,
        });
        if (eventType === "open") await emailRepository.recordOpen(email.id);
        if (eventType === "click") await emailRepository.recordClick(email.id);
        break;
      }
      default:
        await emailEventRepository.log({
          emailId: email.id,
          eventType: eventType || "unknown",
          rawPayload: payload as any,
        });
    }

    console.log(`[sns] event=${eventType} email=${email.id} recorded`);
  }
}
