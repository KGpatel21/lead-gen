/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workspaces + workspace_members. Every user-data row in the system carries
 * a workspace_id; controllers scope by it.
 */

import crypto from "crypto";
import { pool } from "../pool";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerUserId?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  createdAt: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapWorkspace(r: any): Workspace {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    ownerUserId: r.owner_user_id || undefined,
    isDefault: !!r.is_default,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function mapMember(r: any): WorkspaceMember {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    role: r.role,
    createdAt: iso(r.created_at),
  };
}

export const workspaceRepository = {
  async list(): Promise<Workspace[]> {
    const r = await pool.query("SELECT * FROM workspaces ORDER BY created_at ASC");
    return r.rows.map(mapWorkspace);
  },

  async findById(id: string): Promise<Workspace | null> {
    const r = await pool.query("SELECT * FROM workspaces WHERE id = $1", [id]);
    return r.rows[0] ? mapWorkspace(r.rows[0]) : null;
  },

  async getDefault(): Promise<Workspace | null> {
    const r = await pool.query("SELECT * FROM workspaces WHERE is_default = TRUE LIMIT 1");
    return r.rows[0] ? mapWorkspace(r.rows[0]) : null;
  },

  async findByUserId(userId: string): Promise<Workspace[]> {
    const r = await pool.query(
      `SELECT w.* FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = $1
        ORDER BY w.created_at ASC`,
      [userId]
    );
    return r.rows.map(mapWorkspace);
  },

  /**
   * Called during user registration: create a new workspace for the user
   * and attach them as OWNER. The very first user of the whole system
   * is the exception — they get the pre-existing "default" workspace.
   */
  async createForUser(userId: string, name: string): Promise<Workspace> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const id = `ws-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)}-${id.slice(-6)}`;
      const wsInsert = await client.query(
        `INSERT INTO workspaces (id, name, slug, owner_user_id) VALUES ($1,$2,$3,$4) RETURNING *`,
        [id, name, slug, userId]
      );
      await client.query(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role)
         VALUES ($1,$2,$3,'OWNER')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [`wm-${id}-${crypto.randomUUID().split("-")[0]}`, id, userId]
      );
      await client.query(
        "UPDATE users SET workspace_id = COALESCE(workspace_id, $1) WHERE id = $2",
        [id, userId]
      );
      await client.query("COMMIT");
      return mapWorkspace(wsInsert.rows[0]);
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  async members(workspaceId: string): Promise<WorkspaceMember[]> {
    const r = await pool.query(
      "SELECT * FROM workspace_members WHERE workspace_id = $1 ORDER BY created_at ASC",
      [workspaceId]
    );
    return r.rows.map(mapMember);
  },

  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    const r = await pool.query(
      "SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1",
      [workspaceId, userId]
    );
    return r.rows.length > 0;
  },
};
