/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapTeamMember } from "../rowMappers";
import { TeamMember, SecurityRole } from "../../../src/types";

export interface CreateTeamMemberInput {
  name: string;
  email: string;
  role: SecurityRole;
  status: "ACTIVE" | "INVITED";
  inviteToken?: string;
}

export const teamRepository = {
  async list(): Promise<TeamMember[]> {
    const r = await pool.query(
      "SELECT * FROM team_members WHERE deleted_at IS NULL ORDER BY created_at ASC"
    );
    return r.rows.map(mapTeamMember);
  },

  async findByEmail(email: string): Promise<TeamMember | null> {
    const r = await pool.query(
      "SELECT * FROM team_members WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
      [email]
    );
    return r.rows[0] ? mapTeamMember(r.rows[0]) : null;
  },

  async create(input: CreateTeamMemberInput): Promise<TeamMember> {
    const id = `team-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO team_members (id, name, email, role, status, invite_token)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, input.name, input.email, input.role, input.status, input.inviteToken ?? null]
    );
    return mapTeamMember(r.rows[0]);
  },

  async findByInviteToken(token: string): Promise<TeamMember | null> {
    const r = await pool.query(
      "SELECT * FROM team_members WHERE invite_token = $1 AND deleted_at IS NULL",
      [token]
    );
    return r.rows[0] ? mapTeamMember(r.rows[0]) : null;
  },

  async markActive(id: string): Promise<void> {
    await pool.query(
      "UPDATE team_members SET status = 'ACTIVE', invite_token = NULL WHERE id = $1",
      [id]
    );
  },

  async softDelete(id: string): Promise<void> {
    await pool.query("UPDATE team_members SET deleted_at = NOW() WHERE id = $1", [id]);
  },
};
