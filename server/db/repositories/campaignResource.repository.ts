/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign resource junction repository — assigns Knowledge Bases,
 * Email Templates, Signatures, and Prompts to individual campaigns.
 *
 * A campaign can hold ANY number of each resource. Templates and
 * prompts can be scoped to a specific `stepIndex` inside the campaign's
 * sequence; a NULL step_index means "applies to all steps".
 */

import { pool } from "../pool";

export interface CampaignResourceSelection {
  knowledgeBaseIds: string[];
  templateIds: Array<{ templateId: string; stepIndex: number | null }>;
  signatureIds: string[];
  primarySignatureId: string | null;
  promptIds: Array<{ promptId: string; stepIndex: number | null }>;
}

export const campaignResourceRepository = {
  // -------- Knowledge Bases --------
  async listKbs(campaignId: string, workspaceId: string): Promise<string[]> {
    const r = await pool.query(
      `SELECT knowledge_base_id AS id FROM campaign_knowledge_bases
       WHERE campaign_id = $1 AND workspace_id = $2 ORDER BY created_at ASC`,
      [campaignId, workspaceId]
    );
    return r.rows.map((row) => row.id);
  },

  async setKbs(campaignId: string, workspaceId: string, ids: string[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM campaign_knowledge_bases WHERE campaign_id = $1 AND workspace_id = $2`,
        [campaignId, workspaceId]
      );
      for (const id of ids) {
        await client.query(
          `INSERT INTO campaign_knowledge_bases (workspace_id, campaign_id, knowledge_base_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [workspaceId, campaignId, id]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  // -------- Templates --------
  async listTemplates(campaignId: string, workspaceId: string) {
    const r = await pool.query(
      `SELECT template_id, step_index FROM campaign_email_templates
       WHERE campaign_id = $1 AND workspace_id = $2 ORDER BY step_index NULLS FIRST, created_at ASC`,
      [campaignId, workspaceId]
    );
    return r.rows.map((row) => ({ templateId: row.template_id, stepIndex: row.step_index }));
  },

  async setTemplates(
    campaignId: string,
    workspaceId: string,
    entries: Array<{ templateId: string; stepIndex: number | null }>
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM campaign_email_templates WHERE campaign_id = $1 AND workspace_id = $2`,
        [campaignId, workspaceId]
      );
      for (const e of entries) {
        await client.query(
          `INSERT INTO campaign_email_templates (workspace_id, campaign_id, template_id, step_index)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [workspaceId, campaignId, e.templateId, e.stepIndex]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  // -------- Signatures --------
  async listSignatures(campaignId: string, workspaceId: string) {
    const r = await pool.query(
      `SELECT signature_id, is_primary FROM campaign_signatures
       WHERE campaign_id = $1 AND workspace_id = $2 ORDER BY is_primary DESC, created_at ASC`,
      [campaignId, workspaceId]
    );
    return r.rows.map((row) => ({ signatureId: row.signature_id, isPrimary: !!row.is_primary }));
  },

  async setSignatures(
    campaignId: string,
    workspaceId: string,
    ids: string[],
    primaryId: string | null
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM campaign_signatures WHERE campaign_id = $1 AND workspace_id = $2`,
        [campaignId, workspaceId]
      );
      for (const id of ids) {
        await client.query(
          `INSERT INTO campaign_signatures (workspace_id, campaign_id, signature_id, is_primary)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [workspaceId, campaignId, id, primaryId === id]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  // -------- Prompts --------
  async listPrompts(campaignId: string, workspaceId: string) {
    const r = await pool.query(
      `SELECT prompt_id, step_index FROM campaign_prompts
       WHERE campaign_id = $1 AND workspace_id = $2 ORDER BY step_index NULLS FIRST, created_at ASC`,
      [campaignId, workspaceId]
    );
    return r.rows.map((row) => ({ promptId: row.prompt_id, stepIndex: row.step_index }));
  },

  async setPrompts(
    campaignId: string,
    workspaceId: string,
    entries: Array<{ promptId: string; stepIndex: number | null }>
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM campaign_prompts WHERE campaign_id = $1 AND workspace_id = $2`,
        [campaignId, workspaceId]
      );
      for (const e of entries) {
        await client.query(
          `INSERT INTO campaign_prompts (workspace_id, campaign_id, prompt_id, step_index)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [workspaceId, campaignId, e.promptId, e.stepIndex]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  // -------- Composite fetch used by the sequence composer --------
  async getSelection(campaignId: string, workspaceId: string): Promise<CampaignResourceSelection> {
    const [kbs, templates, signatures, prompts] = await Promise.all([
      this.listKbs(campaignId, workspaceId),
      this.listTemplates(campaignId, workspaceId),
      this.listSignatures(campaignId, workspaceId),
      this.listPrompts(campaignId, workspaceId),
    ]);
    const primary = signatures.find((s) => s.isPrimary) || signatures[0] || null;
    return {
      knowledgeBaseIds: kbs,
      templateIds: templates,
      signatureIds: signatures.map((s) => s.signatureId),
      primarySignatureId: primary?.signatureId ?? null,
      promptIds: prompts,
    };
  },
};
