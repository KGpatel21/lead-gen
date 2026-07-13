/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapDomain } from "../rowMappers";
import { Domain } from "../../../src/types";

export const domainRepository = {
  async list(): Promise<Domain[]> {
    const r = await pool.query(
      "SELECT * FROM domains WHERE deleted_at IS NULL ORDER BY created_at DESC"
    );
    return r.rows.map(mapDomain);
  },

  async findById(id: string): Promise<Domain | null> {
    const r = await pool.query(
      "SELECT * FROM domains WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    return r.rows[0] ? mapDomain(r.rows[0]) : null;
  },

  async findByName(name: string): Promise<Domain | null> {
    const r = await pool.query(
      "SELECT * FROM domains WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL",
      [name]
    );
    return r.rows[0] ? mapDomain(r.rows[0]) : null;
  },

  async create(name: string): Promise<Domain> {
    const id = `dom-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO domains (id, name) VALUES ($1, $2) RETURNING *`,
      [id, name]
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
    }
  ): Promise<Domain | null> {
    const r = await pool.query(
      `UPDATE domains
         SET spf_status = $1, dkim_status = $2, dmarc_status = $3,
             health_score = $4, last_verified_at = NOW(), updated_at = NOW()
       WHERE id = $5 AND deleted_at IS NULL RETURNING *`,
      [v.spfStatus, v.dkimStatus, v.dmarcStatus, v.healthScore, id]
    );
    return r.rows[0] ? mapDomain(r.rows[0]) : null;
  },

  async softDelete(id: string): Promise<void> {
    await pool.query("UPDATE domains SET deleted_at = NOW() WHERE id = $1", [id]);
  },
};
