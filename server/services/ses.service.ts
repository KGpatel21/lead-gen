/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Amazon SES v2 sender.
 *
 * - Single client instance
 * - Sends multipart (Text + HTML) messages
 * - Emits `X-Campaign-Id` / `X-Email-Id` tracking headers
 * - Retries transient failures with exponential backoff
 * - Records SES MessageId back into the email row
 * - Config-set opt-in (per SES account setup)
 *
 * Bounce / complaint webhooks (SNS → /api/ses/notify) are Phase 2; SES's
 * automatic bounce/complaint suppression is still enforced by AWS itself.
 */

import {
  SESv2Client,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import { config } from "../config";
import { emailRepository, emailEventRepository, Email } from "../db/repositories";

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
    super(`AWS SES is not configured (missing ${missing}). See .env.example for required variables.`);
    this.name = "SesNotConfiguredError";
  }
}

class SesService {
  private client: SESv2Client | null = null;

  public isConfigured(): boolean {
    return !!(config.awsAccessKeyId && config.awsSecretAccessKey && config.sesFromEmail);
  }

  private require(): { client: SESv2Client; from: string } {
    if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
      throw new SesNotConfiguredError("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY");
    }
    if (!config.sesFromEmail) {
      throw new SesNotConfiguredError("SES_FROM_EMAIL");
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
    return { client: this.client, from: config.sesFromEmail };
  }

  public async sendEmailRow(email: Email): Promise<Email> {
    const { client, from } = this.require();
    const fromEmail = email.fromEmail || from;

    const cmdInput: SendEmailCommandInput = {
      FromEmailAddress: fromEmail,
      Destination: { ToAddresses: [email.toEmail] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: email.bodyText, Charset: "UTF-8" },
            ...(email.bodyHtml
              ? { Html: { Data: email.bodyHtml, Charset: "UTF-8" } }
              : {}),
          },
          Headers: [
            { Name: "X-Email-Id", Value: email.id },
            ...(email.campaignId ? [{ Name: "X-Campaign-Id", Value: email.campaignId }] : []),
          ],
        },
      },
      ...(config.sesConfigurationSet
        ? { ConfigurationSetName: config.sesConfigurationSet }
        : {}),
    };

    // Mark SENDING before the network call so a crash mid-flight is recoverable.
    await emailRepository.setStatus(email.id, "SENDING", { provider: "ses" });

    let lastErr: any;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
          rawPayload: { messageId: out.MessageId, provider: "ses" },
        });
        return updated ?? email;
      } catch (err: any) {
        lastErr = err;
        const errName = err?.name || err?.$metadata?.errorType || "";
        const retriable = RETRIABLE_ERROR_NAMES.has(errName) || err?.$metadata?.httpStatusCode === 500 || err?.$metadata?.httpStatusCode === 503;
        console.warn(`[ses] send attempt ${attempt}/${MAX_RETRIES} failed:`, errName, err?.message);
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
      rawPayload: { error: msg },
    });
    throw lastErr;
  }
}

export const sesService = new SesService();
