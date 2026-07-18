/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public barrel for the email provider abstraction.
 */

export { getProviderFor, EmailProviderError, EmailProviderNotConfiguredError } from "./factory";
export type { EmailProvider, EmailPayload, SendResult, HealthTestResult } from "./factory";
export { SMTP_PRESETS } from "./smtp.provider";
export { gmailOAuth, GMAIL_SCOPES } from "./gmail.provider";
export { outlookOAuth, OUTLOOK_SCOPES } from "./outlook.provider";
