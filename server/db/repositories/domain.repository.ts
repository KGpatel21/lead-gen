/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain repository — workspace-scoped after Phase 6 P0.
 * Every user-facing read requires a workspaceId.
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapDomain } from "../rowMappers";
import { Domain } from "../../../src/types";

export const domainRepository = {
  async list(workspaceId?: string): Promise<Domain[]> {
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM domains WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [workspaceId]
      );
      return r.rows.map(mapDomain);
    }
    const r = await pool.query(
      `SELECT * FROM domains WHERE deleted_at IS NULL ORDER BY created_at DESC`
    );
    return r.rows.map(mapDomain);
  },

  async findById(id: string, workspaceId?: string): Promise<Domain | null> {
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM domains WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [id, workspaceId]
      );
      return r.rows[0] ? mapDomain(r.rows[0]) : null;
    }
    const r = await pool.query(
      `SELECT * FROM domains WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ? mapDomain(r.rows[0]) : null;
  },

  async findByName(name: string, workspaceId?: string): Promise<Domain | null> {
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM domains
         WHERE LOWER(name) = LOWER($1) AND workspace_id = $2 AND deleted_at IS NULL`,
        [name, workspaceId]
      );
      return r.rows[0] ? mapDomain(r.rows[0]) : null;
    }
    const r = await pool.query(
      `SELECT * FROM domains WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
      [name]
    );
    return r.rows[0] ? mapDomain(r.rows[0]) : null;
  },

  async create(name: string, workspaceId: string): Promise<Domain> {
    if (!workspaceId) throw new Error("[domainRepository.create] workspaceId required");
    const id = `dom-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO domains (id, workspace_id, name) VALUES ($1, $2, $3) RETURNING *`,
      [id, workspaceId, name]
    );
    return mapDomain(r.rows[0]);
  },

  async setVerification(
    id: string,
    v: {
      spfStatus: Domain["spfStatus"];
      dkimStatus: Domain["dkimStatus"];
      dmarcStatus: Domain["dmarcStatus"];
      healthScore: number;
    },
    workspaceId?: string
  ): Promise<Domain | null> {
    if (workspaceId) {
      const r = await pool.query(
        `UPDATE domains
           SET spf_status = $1, dkim_status = $2, dmarc_status = $3,
               health_score = $4, last_verified_at = NOW(), updated_at = NOW()
         WHERE id = $5 AND workspace_id = $6 AND deleted_at IS NULL RETURNING *`,
        [v.spfStatus, v.dkimStatus, v.dmarcStatus, v.healthScore, id, workspaceId]
      );
      return r.rows[0] ? mapDomain(r.rows[0]) : null;
    }
    const r = await pool.query(
      `UPDATE domains
         SET spf_status = $1, dkim_status = $2, dmarc_status = $3,
             health_score = $4, last_verified_at = NOW(), updated_at = NOW()
       WHERE id = $5 AND deleted_at IS NULL RETURNING *`,
      [v.spfStatus, v.dkimStatus, v.dmarcStatus, v.healthScore, id]
    );
    return r.rows[0] ? mapDomain(r.rows[0]) : null;
  },

  async softDelete(id: string, workspaceId?: string): Promise<boolean> {
    if (workspaceId) {
      const r = await pool.query(
        `UPDATE domains SET deleted_at = NOW()
         WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [id, workspaceId]
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = await pool.query(
      `UPDATE domains SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (r.rowCount ?? 0) > 0;
  },
};
