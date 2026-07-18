/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider factory. Business logic imports ONLY `getProviderFor(account)` —
 * never a specific provider class.
 */

import type { EmailAccount } from "../../db/repositories/emailAccount.repository";
import type { EmailProvider } from "./provider";
import { SesProvider } from "./ses.provider";
import { SmtpProvider } from "./smtp.provider";
import { GmailOAuthProvider } from "./gmail.provider";
import { OutlookOAuthProvider } from "./outlook.provider";

export function getProviderFor(account: EmailAccount): EmailProvider {
  switch (account.provider) {
    case "ses":            return new SesProvider(account);
    case "smtp":           return new SmtpProvider(account);
    case "gmail_oauth":    return new GmailOAuthProvider(account);
    case "outlook_oauth":  return new OutlookOAuthProvider(account);
    default: {
      const _exhaustive: never = account.provider as never;
      throw new Error(`[email-provider] unknown provider on account ${account.id}: ${_exhaustive}`);
    }
  }
}

export { EmailProviderError, EmailProviderNotConfiguredError } from "./provider";
export type { EmailProvider, EmailPayload, SendResult, HealthTestResult } from "./provider";
