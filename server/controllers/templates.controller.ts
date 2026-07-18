/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reusable email templates with variables + version history.
 *
 * A template row itself is mutable (current_version increments), and every
 * mutation is copied into template_versions before overwrite so history is
 * append-only.
 */

import { Request, Response } from "express";
import { pool } from "../db/pool";
import { templateVersionRepository } from "../db/repositories";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import crypto from "crypto";

const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function extractVariables(subject: string, body: string): string[] {
  const found = new Set<string>();
  for (const s of [subject, body]) {
    for (const m of s.matchAll(VARIABLE_RE)) found.add(m[1]);
  }
  return Array.from(found);
}

interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  variables: string[];
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}
const iso = (v: unknown): string => v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
function mapTemplate(r: any): TemplateRow {
  return {
    id: r.id,
    name: r.name,
    subject: r.subject,
    body: r.body,
    category: r.category,
    variables: r.variables || [],
    currentVersion: r.current_version ?? 1,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export class TemplatesController {
  public static async list(_req: Request, res: Response): Promise<void> {
    const r = await pool.query(
      "SELECT * FROM templates WHERE deleted_at IS NULL ORDER BY created_at DESC"
    );
    res.json({ success: true, data: r.rows.map(mapTemplate) });
  }

  public static async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { name, subject, body, category } = req.body || {};
    if (typeof name !== "string" || typeof subject !== "string" || typeof body !== "string") {
      res.status(400).json({ success: false, error: "name, subject, body required." });
      return;
    }
    const id = `tpl-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const variables = extractVariables(subject, body);
    const r = await pool.query(
      `INSERT INTO templates (id, name, subject, body, category, variables, current_version)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,1) RETURNING *`,
      [id, name, subject, body, category || "Outbound", JSON.stringify(variables)]
    );
    const template = mapTemplate(r.rows[0]);
    await templateVersionRepository.record({
      templateId: id,
      version: 1,
      name,
      subject,
      body,
      variables,
      changedBy: req.user?.email,
    });
    res.status(201).json({ success: true, template });
  }

  public static async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const existing = await pool.query(
      "SELECT * FROM templates WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (!existing.rows[0]) { res.status(404).json({ success: false, error: "not found" }); return; }
    const cur = mapTemplate(existing.rows[0]);
    const nextName = typeof req.body?.name === "string" ? req.body.name : cur.name;
    const nextSubject = typeof req.body?.subject === "string" ? req.body.subject : cur.subject;
    const nextBody = typeof req.body?.body === "string" ? req.body.body : cur.body;
    const nextCategory = typeof req.body?.category === "string" ? req.body.category : cur.category;
    const nextVersion = cur.currentVersion + 1;
    const variables = extractVariables(nextSubject, nextBody);
    const r = await pool.query(
      `UPDATE templates SET name=$1, subject=$2, body=$3, category=$4, variables=$5::jsonb,
              current_version=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
      [nextName, nextSubject, nextBody, nextCategory, JSON.stringify(variables), nextVersion, id]
    );
    await templateVersionRepository.record({
      templateId: id,
      version: nextVersion,
      name: nextName,
      subject: nextSubject,
      body: nextBody,
      variables,
      changedBy: req.user?.email,
    });
    res.json({ success: true, template: mapTemplate(r.rows[0]) });
  }

  public static async duplicate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const existing = await pool.query(
      "SELECT * FROM templates WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (!existing.rows[0]) { res.status(404).json({ success: false, error: "not found" }); return; }
    const cur = mapTemplate(existing.rows[0]);
    const newId = `tpl-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const newName = `${cur.name} (copy)`;
    const r = await pool.query(
      `INSERT INTO templates (id, name, subject, body, category, variables, current_version)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,1) RETURNING *`,
      [newId, newName, cur.subject, cur.body, cur.category, JSON.stringify(cur.variables)]
    );
    await templateVersionRepository.record({
      templateId: newId,
      version: 1,
      name: newName,
      subject: cur.subject,
      body: cur.body,
      variables: cur.variables,
      changedBy: req.user?.email,
    });
    res.status(201).json({ success: true, template: mapTemplate(r.rows[0]) });
  }

  public static async preview(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const values = (req.body?.variables || {}) as Record<string, string>;
    const existing = await pool.query(
      "SELECT * FROM templates WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (!existing.rows[0]) { res.status(404).json({ success: false, error: "not found" }); return; }
    const cur = mapTemplate(existing.rows[0]);
    const render = (s: string) =>
      s.replace(VARIABLE_RE, (_m, key) => (values[key] != null ? String(values[key]) : `{{${key}}}`));
    res.json({
      success: true,
      preview: {
        subject: render(cur.subject),
        body: render(cur.body),
        missingVariables: cur.variables.filter((v) => values[v] == null),
      },
    });
  }

  public static async history(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const rows = await templateVersionRepository.listByTemplate(id);
    res.json({ success: true, data: rows });
  }

  public static async remove(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    await pool.query("UPDATE templates SET deleted_at = NOW() WHERE id = $1", [id]);
    res.json({ success: true });
  }
}
