/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reader factory. Business logic imports ONLY `getReaderFor(account)`.
 * SES accounts have no inbox to poll — factory returns null for them so
 * the sync worker skips.
 */

import type { EmailAccount } from "../../db/repositories/emailAccount.repository";
import type { MailboxReader } from "./reader";
import { ImapReader } from "./imap.reader";
import { GmailReader } from "./gmail.reader";
import { OutlookReader } from "./outlook.reader";

export function getReaderFor(account: EmailAccount): MailboxReader | null {
  switch (account.provider) {
    case "ses":            return null;                       // no inbox to poll
    case "smtp":           return new ImapReader(account);     // reuses smtp/imap creds
    case "gmail_oauth":    return new GmailReader(account);
    case "outlook_oauth":  return new OutlookReader(account);
    default: {
      const _exhaustive: never = account.provider as never;
      throw new Error(`[mailbox-reader] unknown provider: ${_exhaustive}`);
    }
  }
}
