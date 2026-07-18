/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Amazon SES v2 provider.
 */

import { SESv2Client, SendEmailCommand, SendEmailCommandInput, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { config } from "../../config";
import type { EmailAccount } from "../../db/repositories/emailAccount.repository";
import { EmailPayload, EmailProvider, EmailProviderError, EmailProviderNotConfiguredError, HealthTestResult, SendResult } from "./provider";

let cachedClient: SESv2Client | null = null;

const RETRIABLE_ERR_NAMES = new Set([
  "Throttling", "ThrottlingException", "TooManyRequestsException",
  "RequestTimeout", "ServiceUnavailable", "InternalServerError",
]);

function buildClient(): SESv2Client {
  if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
    throw new EmailProviderNotConfiguredError("ses", "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY");
  }
  if (!cachedClient) {
    cachedClient = new SESv2Client({
      region: config.awsRegion,
      credentials: {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
      },
    });
  }
  return cachedClient;
}

export class SesProvider implements EmailProvider {
  public readonly kind = "ses";
  constructor(public readonly account: EmailAccount) {}

  public async send(payload: EmailPayload): Promise<SendResult> {
    const client = buildClient();
    const from = this.account.displayName
      ? `"${this.account.displayName}" <${this.account.email}>`
      : this.account.email;

    const headers: Array<{ Name: string; Value: string }> = [];
    if (payload.trackingId) headers.push({ Name: "X-Email-Id", Value: payload.trackingId });
    if (payload.campaignId) headers.push({ Name: "X-Campaign-Id", Value: payload.campaignId });
    for (const [n, v] of Object.entries(payload.headers || {})) headers.push({ Name: n, Value: v });

    const input: SendEmailCommandInput = {
      FromEmailAddress: payload.from || from,
      Destination: { ToAddresses: [payload.to] },
      Content: {
        Simple: {
          Subject: { Data: payload.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: payload.text, Charset: "UTF-8" },
            ...(payload.html ? { Html: { Data: payload.html, Charset: "UTF-8" } } : {}),
          },
          Headers: headers.length ? headers : undefined,
        },
      },
      ...(payload.replyTo ? { ReplyToAddresses: [payload.replyTo] } : {}),
      ...(config.sesConfigurationSet ? { ConfigurationSetName: config.sesConfigurationSet } : {}),
    };

    const start = Date.now();
    try {
      const out = await client.send(new SendEmailCommand(input));
      return {
        messageId: out.MessageId,
        provider: this.kind,
        accountId: this.account.id,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      const errName = err?.name || "";
      const status = err?.$metadata?.httpStatusCode;
      const retriable = RETRIABLE_ERR_NAMES.has(errName) || status === 500 || status === 503 || status === 429;
      throw new EmailProviderError("ses", err?.message || `SES send failed`, {
        upstreamStatus: status,
        retriable,
        httpStatus: status === 429 ? 429 : 502,
      });
    }
  }

  public async test(): Promise<HealthTestResult> {
    const client = buildClient();
    const start = Date.now();
    try {
      const desc = await client.send(new GetEmailIdentityCommand({ EmailIdentity: this.account.email }));
      const latencyMs = Date.now() - start;
      const verified = desc.VerificationStatus === "SUCCESS";
      return {
        ok: verified,
        message: verified ? "SES identity verified" : `SES identity status: ${desc.VerificationStatus}`,
        latencyMs,
      };
    } catch (err: any) {
      return { ok: false, message: err?.message || "SES query failed", latencyMs: Date.now() - start };
    }
  }
}
