/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Amazon SES v2 sender with production features:
 *
 * - Round-robin sender rotation across verified identities
 * - Per-identity daily quota enforcement (enforced at DB-pick time)
 * - Per-recipient suppression check before every send
 * - Automatic HTML tracking (open pixel + click rewrite)
 * - CAN-SPAM unsubscribe footer injection with signed tokens
 * - Retry with exponential backoff on transient AWS errors
 * - Persists SES MessageId + writes send/reject events
 *
 * Bounces / complaints / deliveries land here via SNS →
 *   /api/ses/events → sesEventController → this update path.
 */

import {
  SESv2Client,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import { config } from "../config";
import {
  emailRepository,
  emailEventRepository,
  suppressionRepository,
  senderIdentityRepository,
  Email,
  SenderIdentity,
} from "../db/repositories";
import { trackingService } from "./tracking.service";

const MAX_RETRIES = 3;
const RETRIABLE_ERROR_NAMES = new Set([
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
  "RequestTimeout",
  "ServiceUnavailable",
  "InternalServerError",
]);

export class SesNotConfiguredError extends Error {
  public readonly httpStatus = 503;
  constructor(missing: string) {
    super(`AWS SES is not configured (missing ${missing}). See .env.example.`);
    this.name = "SesNotConfiguredError";
  }
}

export class RecipientSuppressedError extends Error {
  public readonly httpStatus = 409;
  constructor(email: string, reason: string) {
    super(`Recipient ${email} is on the suppression list (${reason}). Skipping.`);
    this.name = "RecipientSuppressedError";
  }
}

export class NoSenderAvailableError extends Error {
  public readonly httpStatus = 503;
  constructor() {
    super(
      "No verified sender identity is available under quota. Add a VERIFIED identity via POST /api/sender-identities."
    );
    this.name = "NoSenderAvailableError";
  }
}

interface SesDispatchResult {
  email: Email;
  senderEmail: string;
  messageId?: string;
}

class SesService {
  private client: SESv2Client | null = null;

  public isConfigured(): boolean {
    return !!(config.awsAccessKeyId && config.awsSecretAccessKey);
  }

  private requireClient(): SESv2Client {
    if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
      throw new SesNotConfiguredError("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY");
    }
    if (!this.client) {
      this.client = new SESv2Client({
        region: config.awsRegion,
        credentials: {
          accessKeyId: config.awsAccessKeyId,
          secretAccessKey: config.awsSecretAccessKey,
        },
      });
    }
    return this.client;
  }

  /**
   * Send a persisted email row. Handles suppression, sender rotation,
   * tracking + unsubscribe injection, retry, and DB status updates.
   *
   * Used both by the BullMQ send worker and the synchronous send endpoint.
   */
  public async sendEmailRow(email: Email, opts: { orgName?: string } = {}): Promise<SesDispatchResult> {
    if (!email.toEmail) {
      await emailRepository.setStatus(email.id, "FAILED", {
        errorMessage: "Email row has no destination address.",
      });
      throw new Error("No destination email on row.");
    }
    if (await suppressionRepository.isSuppressed(email.toEmail)) {
      const s = await suppressionRepository.findByEmail(email.toEmail);
      await emailRepository.setStatus(email.id, "FAILED", {
        errorMessage: `Suppressed (${s?.reason || "unknown"})`,
      });
      await emailEventRepository.log({
        emailId: email.id,
        eventType: "suppressed",
        rawPayload: { reason: s?.reason, source: s?.source },
      });
      throw new RecipientSuppressedError(email.toEmail, s?.reason || "unknown");
    }

    const client = this.requireClient();

    // Round-robin sender pick with atomic decrement of daily quota.
    const sender: SenderIdentity | null =
      email.senderIdentityId != null
        ? await senderIdentityRepository.findById(email.senderIdentityId)
        : await senderIdentityRepository.pickNextForRotation();

    if (!sender || !sender.isHealthy || !sender.isActive || sender.sesVerificationStatus !== "VERIFIED") {
      throw new NoSenderAvailableError();
    }

    // Build the outgoing content: inject unsubscribe footer + click/open tracking.
    const orgName = opts.orgName || "Outbound.AI";
    const withFooters = trackingService.injectFooters(email.bodyText, email.bodyHtml, email.id, orgName);
    const bodyHtml = trackingService.injectHtmlTracking(withFooters.bodyHtml, email.id);

    const fromAddress = sender.displayName ? `"${sender.displayName}" <${sender.email}>` : sender.email;

    const cmdInput: SendEmailCommandInput = {
      FromEmailAddress: fromAddress,
      Destination: { ToAddresses: [email.toEmail] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: withFooters.bodyText, Charset: "UTF-8" },
            Html: { Data: bodyHtml, Charset: "UTF-8" },
          },
          Headers: [
            { Name: "X-Email-Id", Value: email.id },
            ...(email.campaignId ? [{ Name: "X-Campaign-Id", Value: email.campaignId }] : []),
            { Name: "List-Unsubscribe", Value: `<${trackingService.unsubscribeUrl(email.id)}>` },
            { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
          ],
        },
      },
      ...(config.sesConfigurationSet
        ? { ConfigurationSetName: config.sesConfigurationSet }
        : {}),
    };

    await emailRepository.setStatus(email.id, "SENDING", { provider: "ses" });
    await emailRepository.linkSender(email.id, sender.id);

    let lastErr: any;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const started = Date.now();
      try {
        const out = await client.send(new SendEmailCommand(cmdInput));
        const updated = await emailRepository.setStatus(email.id, "SENT", {
          provider: "ses",
          messageId: out.MessageId,
          sentAt: new Date(),
        });
        await emailEventRepository.log({
          emailId: email.id,
          eventType: "send",
          rawPayload: { messageId: out.MessageId, provider: "ses", senderId: sender.id },
        });
        console.log(
          `[ses] send OK email=${email.id} to=${email.toEmail} sender=${sender.email} messageId=${out.MessageId} latency=${Date.now() - started}ms attempt=${attempt}`
        );
        return { email: updated ?? email, senderEmail: sender.email, messageId: out.MessageId };
      } catch (err: any) {
        lastErr = err;
        const errName = err?.name || err?.$metadata?.errorType || "";
        const httpStatus = err?.$metadata?.httpStatusCode;
        const retriable =
          RETRIABLE_ERROR_NAMES.has(errName) ||
          httpStatus === 500 ||
          httpStatus === 503 ||
          httpStatus === 429;
        console.warn(
          `[ses] send FAIL email=${email.id} attempt=${attempt}/${MAX_RETRIES} status=${httpStatus} name=${errName} err="${(err?.message || "").slice(0, 160)}"`
        );
        await senderIdentityRepository.recordFailure(sender.id, err?.message || errName);
        if (!retriable || attempt >= MAX_RETRIES) break;
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }

    const msg = lastErr?.message || "SES send failed";
    await emailRepository.setStatus(email.id, "FAILED", {
      provider: "ses",
      errorMessage: msg,
    });
    await emailEventRepository.log({
      emailId: email.id,
      eventType: "reject",
      rawPayload: { error: msg, senderId: sender.id },
    });
    throw lastErr;
  }
}

export const sesService = new SesService();
