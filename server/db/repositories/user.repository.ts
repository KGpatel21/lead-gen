/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapUser } from "../rowMappers";
import { DbUser } from "../../services/db.service.types";
import { SecurityRole } from "../../../src/types";

export interface CreateUserInput {
  name: string;
  email: string;
  role: SecurityRole;
  passwordHash: string;
  passwordSalt: string;
}

export const userRepository = {
  async findById(id: string): Promise<DbUser | null> {
    const r = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return r.rows[0] ? mapUser(r.rows[0]) : null;
  },

  async findByEmail(email: string): Promise<DbUser | null> {
    const r = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
      [email]
    );
    return r.rows[0] ? mapUser(r.rows[0]) : null;
  },

  async count(): Promise<number> {
    const r = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL");
    return r.rows[0].n;
  },

  async findFirstAdmin(): Promise<DbUser | null> {
    const r = await pool.query(
      "SELECT * FROM users WHERE role = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1",
      [SecurityRole.ADMIN]
    );
    return r.rows[0] ? mapUser(r.rows[0]) : null;
  },

  async create(input: CreateUserInput): Promise<DbUser> {
    const id = `usr-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO users (id, name, email, role, password_hash, password_salt)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, input.name, input.email, input.role, input.passwordHash, input.passwordSalt]
    );
    return mapUser(r.rows[0]);
  },

  async updatePassword(userId: string, passwordHash: string, passwordSalt: string): Promise<void> {
    await pool.query(
      "UPDATE users SET password_hash = $1, password_salt = $2 WHERE id = $3",
      [passwordHash, passwordSalt, userId]
    );
  },

  async setSubscription(userId: string, sub: {
    plan?: string;
    status?: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    currentPeriodEnd?: number;
  }): Promise<void> {
    await pool.query(
      `UPDATE users SET
         subscription_plan       = COALESCE($2, subscription_plan),
         subscription_status     = COALESCE($3, subscription_status),
         stripe_customer_id      = COALESCE($4, stripe_customer_id),
         stripe_subscription_id  = COALESCE($5, stripe_subscription_id),
         subscription_period_end = COALESCE($6, subscription_period_end)
       WHERE id = $1`,
      [
        userId,
        sub.plan ?? null,
        sub.status ?? null,
        sub.stripeCustomerId ?? null,
        sub.stripeSubscriptionId ?? null,
        sub.currentPeriodEnd ?? null,
      ]
    );
  },

  async findByStripeCustomerId(customerId: string): Promise<DbUser | null> {
    const r = await pool.query(
      "SELECT * FROM users WHERE stripe_customer_id = $1 LIMIT 1",
      [customerId]
    );
    return r.rows[0] ? mapUser(r.rows[0]) : null;
  },

  async softDelete(userId: string): Promise<void> {
    await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1", [userId]);
  },
};
