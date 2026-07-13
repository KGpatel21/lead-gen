/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { EntityHistoryRecord } from "../../services/db.service.types";

export const historyRepository = {
  async log(entry: {
    entityId: string;
    entityType: EntityHistoryRecord["entityType"];
    changedBy: string;
    previousState: unknown;
    newState: unknown;
  }): Promise<void> {
    const id = `hist-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    await pool.query(
      `INSERT INTO entity_history (id, entity_id, entity_type, changed_by, previous_state, new_state)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [
        id,
        entry.entityId,
        entry.entityType,
        entry.changedBy,
        JSON.stringify(entry.previousState ?? null),
        JSON.stringify(entry.newState ?? null),
      ]
    );
  },
};
