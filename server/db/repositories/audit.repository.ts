/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapAudit } from "../rowMappers";
import { AuditLog } from "../../services/db.service.types";

export const auditRepository = {
  async log(entry: Omit<AuditLog, "id" | "timestamp">): Promise<void> {
    const id = `audit-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    await pool.query(
      `INSERT INTO audit_logs (id, user_id, user_email, action, category, ip_address, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        entry.userId || null,
        entry.userEmail || null,
        entry.action,
        entry.category,
        entry.ipAddress || null,
        entry.details || null,
      ]
    );
  },

  async list(limit = 200): Promise<AuditLog[]> {
    const r = await pool.query(
      "SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT $1",
      [limit]
    );
    return r.rows.map(mapAudit);
  },
};
