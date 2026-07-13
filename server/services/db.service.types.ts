/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-repository DTO types (rows that don't have their own domain type in src/types.ts).
 */

import { SecurityRole } from "../../src/types";

export interface DbUser {
  id: string;
  name: string;
  email: string;
  role: SecurityRole;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  deletedAt?: string;
  subscriptionPlan?: string;
  subscriptionStatus?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionPeriodEnd?: number;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId?: string;
  userEmail?: string;
  action: string;
  category:
    | "CAMPAIGN"
    | "LEAD"
    | "SMTP"
    | "QUEUE"
    | "REPLY"
    | "AUTHENTICATION"
    | "SECURITY"
    | "ERROR";
  ipAddress?: string;
  details?: string;
}

export interface EntityHistoryRecord {
  id: string;
  entityId: string;
  entityType: "CAMPAIGN" | "DOMAIN" | "TEMPLATE";
  changedAt: string;
  changedBy: string;
  previousState: unknown;
  newState: unknown;
}

export type QueueItemStatus = "QUEUED" | "PENDING" | "SENT" | "FAILED";

export interface QueueItem {
  id: string;
  campaignId: string;
  leadId: string;
  to: string;
  subject: string;
  body: string;
  scheduledAt: string;
  status: QueueItemStatus;
  attempts: number;
  priority: number;
  errorMessage?: string;
  lastAttempt?: string;
}
