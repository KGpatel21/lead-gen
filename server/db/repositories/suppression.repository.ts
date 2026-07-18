/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Suppression list. Phase 3.5: workspace-scoped. Two workspaces may keep
 * independent suppression lists for the same address.
 *
 * Populated by:
 *   - SNS bounce notifications (permanent bounces)
 *   - SNS complaint notifications
 *   - /unsubscribe/:token
 *   - Admin manual insert
 */

import crypto from "crypto";
import { pool } from "../pool";

export type SuppressionReason = "bounce" | "complaint" | "unsubscribe" | "manual";

export interface Suppression {
  id: string;
  workspaceId: string;
  email: string;
  reason: SuppressionReason;
  bounceType?: string;
  bounceSubtype?: string;
  source?: string;
  notes?: string;
  campaignId?: string;
  suppressedAt: string;
}

export interface AddSuppressionInput {
  workspaceId: string;
  email: string;
  reason: SuppressionReason;
  bounceType?: string;
  bounceSubtype?: string;
  source?: string;
  notes?: string;
  campaignId?: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): Suppression {
  return {
    id: r.id,
    workspaceId: r.workspace_id || "",
    email: r.email,
    reason: r.reason as SuppressionReason,
    bounceType: r.bounce_type || undefined,
    bounceSubtype: r.bounce_subtype || undefined,
    source: r.source || undefined,
    notes: r.notes || undefined,
    campaignId: r.campaign_id || undefined,
    suppressedAt: iso(r.suppressed_at),
  };
}

export const suppressionRepository = {
  async isSuppressed(email: string, workspaceId: string): Promise<boolean> {
    const r = await pool.query(
      "SELECT 1 FROM email_suppressions WHERE workspace_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1",
      [workspaceId, email]
    );
    return r.rows.length > 0;
  },

  async findByEmail(email: string, workspaceId: string): Promise<Suppression | null> {
    const r = await pool.query(
      "SELECT * FROM email_suppressions WHERE workspace_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1",
      [workspaceId, email]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async list(workspaceId: string, limit = 500): Promise<Suppression[]> {
    const r = await pool.query(
      "SELECT * FROM email_suppressions WHERE workspace_id = $1 ORDER BY suppressed_at DESC LIMIT $2",
      [workspaceId, limit]
    );
    return r.rows.map(mapRow);
  },

  async listAllSuppressedEmails(workspaceId: string): Promise<string[]> {
    const r = await pool.query(
      "SELECT LOWER(email) AS email FROM email_suppressions WHERE workspace_id = $1",
      [workspaceId]
    );
    return r.rows.map((row) => row.email);
  },

  async add(input: AddSuppressionInput): Promise<Suppression> {
    if (!input.workspaceId) throw new Error("suppressionRepository.add requires workspaceId");
    const id = `supp-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO email_suppressions
         (id, workspace_id, email, reason, bounce_type, bounce_subtype, source, notes, campaign_id)
       VALUES ($1, $2, LOWER($3), $4, $5, $6, $7, $8, $9)
       ON CONFLICT (workspace_id, (LOWER(email))) DO UPDATE SET
         reason         = EXCLUDED.reason,
         bounce_type    = COALESCE(EXCLUDED.bounce_type,    email_suppressions.bounce_type),
         bounce_subtype = COALESCE(EXCLUDED.bounce_subtype, email_suppressions.bounce_subtype),
         source         = COALESCE(EXCLUDED.source,         email_suppressions.source),
         notes          = COALESCE(EXCLUDED.notes,          email_suppressions.notes),
         suppressed_at  = NOW()
       RETURNING *`,
      [
        id,
        input.workspaceId,
        input.email,
        input.reason,
        input.bounceType || null,
        input.bounceSubtype || null,
        input.source || null,
        input.notes || null,
        input.campaignId || null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async remove(email: string, workspaceId: string): Promise<boolean> {
    const r = await pool.query(
      "DELETE FROM email_suppressions WHERE workspace_id = $1 AND LOWER(email) = LOWER($2)",
      [workspaceId, email]
    );
    return (r.rowCount ?? 0) > 0;
  },
};
