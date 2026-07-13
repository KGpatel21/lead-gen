/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapAgent, mapAgentLog } from "../rowMappers";
import { AiAgent, AgentTaskLog, AgentRole } from "../../../src/types";

export const agentRepository = {
  async list(): Promise<AiAgent[]> {
    const r = await pool.query("SELECT * FROM agents ORDER BY created_at ASC");
    return r.rows.map(mapAgent);
  },

  async findById(id: string): Promise<AiAgent | null> {
    const r = await pool.query("SELECT * FROM agents WHERE id = $1", [id]);
    return r.rows[0] ? mapAgent(r.rows[0]) : null;
  },

  async ensureDefaults(defaults: Omit<AiAgent, "taskCount" | "status">[]): Promise<void> {
    for (const a of defaults) {
      await pool.query(
        `INSERT INTO agents (id, name, role, description, system_prompt, model)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           description = EXCLUDED.description,
           system_prompt = EXCLUDED.system_prompt,
           model = EXCLUDED.model`,
        [a.id, a.name, a.role, a.description, a.systemPrompt, a.model]
      );
    }
  },

  async setStatus(id: string, status: AiAgent["status"]): Promise<void> {
    await pool.query("UPDATE agents SET status = $1 WHERE id = $2", [status, id]);
  },

  async incrementTaskCount(id: string): Promise<void> {
    await pool.query("UPDATE agents SET task_count = task_count + 1 WHERE id = $1", [id]);
  },

  async listLogs(limit = 200): Promise<AgentTaskLog[]> {
    const r = await pool.query(
      "SELECT * FROM agent_logs ORDER BY timestamp DESC LIMIT $1",
      [limit]
    );
    return r.rows.map(mapAgentLog);
  },

  async logRun(entry: Omit<AgentTaskLog, "id" | "timestamp">): Promise<void> {
    const id = `alog-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    await pool.query(
      `INSERT INTO agent_logs (id, agent_id, input, output, status) VALUES ($1,$2,$3,$4,$5)`,
      [id, entry.agentId, entry.input, entry.output, entry.status]
    );
  },
};

export const DEFAULT_AGENTS: Omit<AiAgent, "taskCount" | "status">[] = [
  {
    id: "agent-lead-hunter",
    name: "Lead Hunter Pro",
    role: AgentRole.LEAD_HUNTER,
    description:
      "Prospects high-converting target leads for specific business niches, looks up domains, and writes direct intro icebreakers.",
    systemPrompt:
      "You are Lead Hunter Pro, an elite sales prospecting agent. Your job is to search for high-value prospect leads in a given niche and location. Synthesize contact details, company name, contact motivation, and a bespoke icebreaker. Return the leads in structured, easy-to-read markdown table.",
    model: "gemini-2.5-flash",
  },
  {
    id: "agent-copywriter",
    name: "Copywriter Ninja",
    role: AgentRole.OUTREACH_WRITER,
    description:
      "Drafts highly personalized cold email templates using psychological copy blocks (AIDA, PAS).",
    systemPrompt:
      "You are Copywriter Ninja, a world-class cold email outreach copywriter. Your job is to generate dynamic sequence scripts based on target industries, value propositions, and pain points. Return 1 high-converting email template with subject and body tags.",
    model: "gemini-2.5-flash",
  },
  {
    id: "agent-classifier",
    name: "Smart Triage Classifier",
    role: AgentRole.INBOX_CLASSIFIER,
    description:
      "Filters incoming replies, categorizes sentiments (interested/objections), and drafts suggested objections handlings.",
    systemPrompt:
      "You are Smart Triage Classifier. Parse the incoming email text, label its core sentiment as 'interested', 'not interested', 'meeting booked', or 'spam/optout'. Suggest a bulletproof action plan and pitch-perfect follow-up draft.",
    model: "gemini-2.5-flash",
  },
  {
    id: "agent-deliverability",
    name: "Inbox Health Sentry",
    role: AgentRole.DELIVERABILITY_SECURE,
    description:
      "Scans campaign copies for spam trigger terms, excessive punctuation, and certifies SPF/DKIM sanity.",
    systemPrompt:
      "You are Inbox Health Sentry, a technical deliverability specialist. Analyze the draft for spam trigger words, formatting red flags, and SPF/DKIM verification. Suggest direct fixes to preserve high email reputation scores.",
    model: "gemini-2.5-flash",
  },
];
