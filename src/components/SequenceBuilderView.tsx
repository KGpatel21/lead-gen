/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5: professional Campaign Automation UI.
 *
 * Sub-views:
 *   - Sequence Builder (drag-and-drop reordering + AI/manual per step)
 *   - Timeline preview (Day 0 → Day N)
 *   - Live Queue (queued/sending/completed/paused/failed/waiting counts)
 *   - Analytics (open/reply/bounce/meeting/unsub)
 *   - Sender pool + provider + timezone controls
 *
 * Real-time refresh every 8s via the workspace dashboard endpoint.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePolling } from "../hooks/usePolling";
import {
  Bot, Calendar, ChevronDown, ChevronUp, Clock, GitBranch, Layers, Loader2, Mail, Pause,
  Play, Plus, RefreshCw, Save, Send, Sparkles, Trash2, TrendingUp, Type, Users, X,
} from "lucide-react";
import {
  campaignsApi, campaignAutomationApi, CampaignDashboardSummary, SequenceStepDto,
} from "../api/endpoints";
import { Campaign, CampaignStatus } from "../types";
import { useToast } from "../context/ToastContext";

const DAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TZ_OPTIONS = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Amsterdam", "Asia/Tokyo",
  "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC",
];
const TONES = ["Direct", "Warm", "Consultative", "Playful"];

function emptyStep(idx: number): SequenceStepDto {
  return {
    stepIndex: idx,
    abGroup: "A",
    delayHours: idx === 0 ? 0 : 72,
    mode: "ai",
    subject: "",
    bodyText: "",
    aiInstruction: idx === 0 ? "Cold intro — reference the prospect's business explicitly." : "",
    isActive: true,
  };
}

interface StepCardProps {
  step: SequenceStepDto;
  onChange: (patch: Partial<SequenceStepDto>) => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  index: number;
  isFirst: boolean;
  isLast: boolean;
}

function StepCard({ step, onChange, onRemove, onMoveUp, onMoveDown, index, isFirst, isLast }: StepCardProps) {
  const expandedInit = index === 0;
  const [expanded, setExpanded] = useState(expandedInit);
  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
        <div className="w-9 h-9 rounded-md bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
          {index === 0 ? "0" : `+${step.delayHours}h`}
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Step {index + 1} — {index === 0 ? "Initial email" : `Follow-up #${index}`}
          </div>
          <div className="text-[11px] text-slate-500">
            Delay {step.delayHours ?? 0}h · Mode {step.mode} · A/B {step.abGroup ?? "A"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 disabled:opacity-30"
            aria-label="Move up"
            title="Move up"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 disabled:opacity-30"
            aria-label="Move down"
            title="Move down"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-mono px-2 py-1 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800"
          >
            {expanded ? "Collapse" : "Edit"}
          </button>
          {onRemove && (
            <button
              onClick={onRemove}
              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
              aria-label="Remove step"
              title="Remove step"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Delay before this step (hours)
              <input
                type="number"
                min={0}
                value={step.delayHours ?? 0}
                onChange={(e) => onChange({ delayHours: Math.max(0, Number(e.target.value)) })}
                disabled={index === 0}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
              />
              {index === 0 && (
                <span className="text-[10px] text-slate-500">Step 0 always sends immediately.</span>
              )}
            </label>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              A/B group
              <input
                value={step.abGroup ?? "A"}
                onChange={(e) => onChange({ abGroup: e.target.value.toUpperCase().slice(0, 2) || "A" })}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                placeholder="A"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onChange({ mode: "ai" })}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm font-medium ${
                step.mode === "ai"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-slate-950 text-slate-600 border-slate-300 dark:border-slate-700"
              }`}
            >
              <Bot className="w-4 h-4" /> AI generated
            </button>
            <button
              onClick={() => onChange({ mode: "manual" })}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm font-medium ${
                step.mode === "manual"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-slate-950 text-slate-600 border-slate-300 dark:border-slate-700"
              }`}
            >
              <Type className="w-4 h-4" /> Manual template
            </button>
          </div>

          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            Subject line {step.mode === "ai" ? "(optional — AI writes it)" : ""}
            <input
              value={step.subject || ""}
              onChange={(e) => onChange({ subject: e.target.value })}
              placeholder={step.mode === "manual" ? "Re: {{company}} — following up" : "Leave blank for AI"}
              className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>

          {step.mode === "manual" ? (
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Body ({"{{firstName}}"}, {"{{company}}"}, {"{{personalizedLine}}"} available)
              <textarea
                value={step.bodyText || ""}
                onChange={(e) => onChange({ bodyText: e.target.value })}
                rows={6}
                placeholder="Hi {{firstName}},

I saw that {{company}}...

{{personalizedLine}}

Would you be open to a 10-min chat this week?"
                className="mt-1 w-full px-2 py-1.5 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </label>
          ) : (
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              AI instruction
              <textarea
                value={step.aiInstruction || ""}
                onChange={(e) => onChange({ aiInstruction: e.target.value })}
                rows={4}
                placeholder="e.g. Short bump. Reference the initial pitch; try a new angle."
                className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  campaigns: Campaign[];
  onRefresh: () => void;
}

export default function SequenceBuilderView({ campaigns, onRefresh }: Props) {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string>(campaigns[0]?.id || "");
  const [steps, setSteps] = useState<SequenceStepDto[]>([]);
  const [dashboard, setDashboard] = useState<CampaignDashboardSummary | null>(null);
  const [dashboardAll, setDashboardAll] = useState<CampaignDashboardSummary[]>([]);
  const [tab, setTab] = useState<"builder" | "timeline" | "queue" | "analytics" | "schedule">("builder");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedId && campaigns[0]) setSelectedId(campaigns[0].id);
  }, [campaigns, selectedId]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedId) || null,
    [campaigns, selectedId]
  );

  const loadSteps = React.useCallback(async () => {
    if (!selectedId) return;
    try {
      const r = await campaignAutomationApi.listSteps(selectedId);
      const sorted = [...r.steps].sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
      if (sorted.length === 0) {
        setSteps([emptyStep(0), { ...emptyStep(1), aiInstruction: "Short bump — reference the first email, add one new angle." }]);
      } else {
        setSteps(sorted);
      }
    } catch (err: any) {
      toast.error(`Load sequence: ${err?.message || err}`);
    }
  }, [selectedId, toast]);

  const loadDashboard = React.useCallback(async () => {
    if (!selectedId) return;
    try {
      const r = await campaignAutomationApi.dashboardCampaign(selectedId);
      setDashboard(r.dashboard);
    } catch { /* ignore */ }
  }, [selectedId]);

  const loadWorkspaceDashboard = React.useCallback(async () => {
    try {
      const r = await campaignAutomationApi.dashboardWorkspace();
      setDashboardAll(r.campaigns);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSteps(); loadDashboard(); }, [loadSteps, loadDashboard]);
  useEffect(() => { loadWorkspaceDashboard(); }, [loadWorkspaceDashboard]);

  // Single polling loop covers BOTH endpoints. Was firing two separate
  // requests every 8 s with no in-flight guard and no visibility check —
  // that stacked up quickly and was a major contributor to the "failed to
  // fetch" storm on slower networks.
  const dashboardTick = useCallback(async () => {
    await Promise.allSettled([loadWorkspaceDashboard(), loadDashboard()]);
  }, [loadWorkspaceDashboard, loadDashboard]);

  usePolling(dashboardTick, {
    intervalMs: 20_000,       // was 8 s; still feels live for a builder view
    fireOnMount: false,
    onError: (err) => console.warn("[SequenceBuilder] dashboard poll failed:", err),
  });

  const patchStep = (idx: number, patch: Partial<SequenceStepDto>) => {
    setSteps((cur) => cur.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addStep = () => {
    setSteps((cur) => [...cur, emptyStep(cur.length)]);
  };
  const removeStep = (idx: number) => {
    setSteps((cur) => cur.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepIndex: i })));
  };
  const moveStep = (idx: number, delta: -1 | 1) => {
    setSteps((cur) => {
      const target = idx + delta;
      if (target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      const tmp = next[idx];
      next[idx] = next[target];
      next[target] = tmp;
      return next.map((s, i) => ({ ...s, stepIndex: i }));
    });
  };

  const saveSequence = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      // Normalize step indices.
      const payload = steps.map((s, i) => ({ ...s, stepIndex: i, delayHours: i === 0 ? 0 : (s.delayHours ?? 24) }));
      await campaignAutomationApi.saveSteps(selectedId, payload);
      toast.success(`Sequence saved (${payload.length} steps).`);
      await loadSteps();
    } catch (err: any) {
      toast.error(`Save failed: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const enrollNow = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const r = await campaignAutomationApi.enroll(selectedId, []);
      toast.success(`Enrolled ${r.enrolled} leads.`);
      onRefresh();
      loadDashboard();
    } catch (err: any) {
      toast.error(`Enroll failed: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const doLifecycle = async (fn: () => Promise<any>, label: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      onRefresh();
      loadDashboard();
    } catch (err: any) {
      toast.error(`${label} failed: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <header className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2">
          <GitBranch className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">Sequence Builder</h1>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-blue-500/40 text-blue-500">
            PHASE 5
          </span>
        </div>
        <div className="flex-1" />
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm min-w-[260px]"
        >
          <option value="">— Select campaign —</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={onRefresh}
          className="p-2 rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      {!selectedCampaign && (
        <div className="p-8 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-500 text-sm">
          Select a campaign above to design its multi-step sequence.
        </div>
      )}

      {selectedCampaign && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Status" value={selectedCampaign.status} icon={<Sparkles className="w-4 h-4" />} />
            <SummaryCard
              label="Prospects (active)"
              value={String(dashboard?.prospects?.active ?? 0)}
              icon={<Users className="w-4 h-4" />}
            />
            <SummaryCard
              label="Reply rate"
              value={`${dashboard?.rates?.replyRate ?? 0}%`}
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <SummaryCard
              label="Next upcoming"
              value={
                dashboard?.upcoming
                  ? `Step ${dashboard.upcoming.step + 1} · ${dashboard.upcoming.when ? new Date(dashboard.upcoming.when).toLocaleString() : ""}`
                  : "—"
              }
              icon={<Clock className="w-4 h-4" />}
            />
          </div>

          <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
            {(["builder", "timeline", "schedule", "queue", "analytics"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${
                  tab === t
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "builder" && (
            <div className="space-y-3">
              {steps.map((s, i) => (
                <React.Fragment key={i}>
                  <StepCard
                    index={i}
                    isFirst={i === 0}
                    isLast={i === steps.length - 1}
                    step={s}
                    onChange={(patch) => patchStep(i, patch)}
                    onRemove={steps.length > 1 ? () => removeStep(i) : undefined}
                    onMoveUp={() => moveStep(i, -1)}
                    onMoveDown={() => moveStep(i, 1)}
                  />
                </React.Fragment>
              ))}
              <div className="flex gap-3">
                <button
                  onClick={addStep}
                  className="flex items-center gap-2 px-4 py-2 rounded-md border-2 border-dashed border-slate-300 dark:border-slate-700 text-slate-600 hover:border-blue-500 hover:text-blue-500 text-sm font-medium"
                >
                  <Plus className="w-4 h-4" /> Add follow-up
                </button>
                <div className="flex-1" />
                <button
                  onClick={saveSequence}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 text-sm"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save sequence
                </button>
                <button
                  onClick={enrollNow}
                  disabled={busy}
                  className="flex items-center gap-2 px-5 py-2 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60 text-sm"
                >
                  <Send className="w-4 h-4" /> Enroll all leads
                </button>
              </div>
            </div>
          )}

          {tab === "timeline" && (
            <div className="space-y-3">
              <div className="text-sm text-slate-600 dark:text-slate-400">
                Estimated timing assumes step 0 sends at enrollment; each subsequent step waits its declared delay
                (business-hours + timezone rules apply at runtime).
              </div>
              <ol className="relative border-l-2 border-blue-500/40 pl-6 space-y-4">
                {steps.map((s, i) => {
                  const totalHours = steps.slice(0, i + 1).reduce((sum, s2, idx) => sum + (idx === 0 ? 0 : s2.delayHours ?? 0), 0);
                  return (
                    <li key={i} className="relative">
                      <div className="absolute -left-[38px] top-1 w-4 h-4 rounded-full bg-blue-600 border-4 border-white dark:border-slate-950" />
                      <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                        <div className="flex items-center gap-2 text-xs text-slate-500 font-mono uppercase">
                          <Layers className="w-3 h-3" /> Step {i + 1}
                          <span className="text-slate-400">·</span>
                          <Clock className="w-3 h-3" /> Day {Math.round(totalHours / 24)}
                          <span className="text-slate-400">·</span>
                          <Bot className="w-3 h-3" /> {s.mode}
                        </div>
                        <div className="text-sm mt-1 font-medium">
                          {s.subject || (s.mode === "ai" ? "AI-written subject" : "(no subject)")}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 line-clamp-2">
                          {s.mode === "manual" ? (s.bodyText || "(empty body)") : (s.aiInstruction || "(no instruction)")}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {tab === "schedule" && (
            <ScheduleEditor
              campaign={selectedCampaign}
              onSave={async (patch) => {
                await campaignsApi.update(selectedCampaign.id, patch);
                onRefresh();
                toast.success("Schedule saved.");
              }}
            />
          )}

          {tab === "queue" && (
            <QueuePanel dashboard={dashboard} onLifecycle={doLifecycle} campaign={selectedCampaign} />
          )}

          {tab === "analytics" && <AnalyticsPanel dashboard={dashboard} allCampaigns={dashboardAll} />}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
      <div className="text-[11px] font-mono uppercase text-slate-500 flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white truncate">{value}</div>
    </div>
  );
}

function ScheduleEditor({
  campaign,
  onSave,
}: {
  campaign: Campaign;
  onSave: (patch: Partial<Campaign> & Record<string, unknown>) => Promise<void>;
}) {
  const [days, setDays] = useState<string[]>(campaign.scheduleDays || []);
  const [start, setStart] = useState(campaign.scheduleTimeStart || "09:00");
  const [end, setEnd] = useState(campaign.scheduleTimeEnd || "17:00");
  const [tz, setTz] = useState(campaign.timezone || "America/New_York");
  const [tone, setTone] = useState((campaign as any).defaultTone || "Consultative");
  const [maxPerHour, setMaxPerHour] = useState<number>((campaign as any).maxPerHour ?? 60);
  const [maxPerDay, setMaxPerDay] = useState<number>((campaign as any).maxPerDay ?? 500);
  const [minGap, setMinGap] = useState<number>((campaign as any).minGapSeconds ?? 45);
  const [maxGap, setMaxGap] = useState<number>((campaign as any).maxGapSeconds ?? 180);
  const [maxRetries, setMaxRetries] = useState<number>((campaign as any).maxRetries ?? 5);
  const [goal, setGoal] = useState<string>((campaign as any).goal || "");
  const [respectTz, setRespectTz] = useState<boolean>((campaign as any).respectProspectTz !== false);
  const [saving, setSaving] = useState(false);

  const toggle = (d: string) => {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        scheduleDays: days,
        scheduleTimeStart: start,
        scheduleTimeEnd: end,
        timezone: tz,
        defaultTone: tone,
        maxPerHour, maxPerDay, minGapSeconds: minGap, maxGapSeconds: maxGap,
        maxRetries, goal, respectProspectTz: respectTz,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
      <div>
        <div className="text-xs font-mono uppercase text-slate-500 mb-2 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5" /> Working days
        </div>
        <div className="flex flex-wrap gap-2">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => toggle(d)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                days.includes(d)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-600"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <LabeledInput label="Start" value={start} onChange={setStart} type="time" />
        <LabeledInput label="End"   value={end}   onChange={setEnd}   type="time" />
        <label className="text-xs">
          <div className="font-medium text-slate-600 dark:text-slate-400">Timezone</div>
          <select
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            {TZ_OPTIONS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <div className="font-medium text-slate-600 dark:text-slate-400">Default tone</div>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            {TONES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <LabeledInput label="Max/hour" value={String(maxPerHour)} onChange={(v) => setMaxPerHour(Number(v))} type="number" />
        <LabeledInput label="Max/day"  value={String(maxPerDay)}  onChange={(v) => setMaxPerDay(Number(v))} type="number" />
        <LabeledInput label="Min gap (s)" value={String(minGap)} onChange={(v) => setMinGap(Number(v))} type="number" />
        <LabeledInput label="Max gap (s)" value={String(maxGap)} onChange={(v) => setMaxGap(Number(v))} type="number" />
        <LabeledInput label="Max retries"  value={String(maxRetries)}  onChange={(v) => setMaxRetries(Number(v))} type="number" />
      </div>
      <label className="text-xs">
        <div className="font-medium text-slate-600 dark:text-slate-400">Campaign goal (used by AI)</div>
        <textarea
          rows={2}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={respectTz} onChange={(e) => setRespectTz(e.target.checked)} />
        <span className="font-medium text-slate-600 dark:text-slate-400">Respect prospect timezone</span>
      </label>
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 text-sm"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save schedule
        </button>
      </div>
    </div>
  );
}

function LabeledInput({
  label, value, onChange, type = "text",
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="text-xs">
      <div className="font-medium text-slate-600 dark:text-slate-400">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
      />
    </label>
  );
}

function QueuePanel({
  dashboard,
  onLifecycle,
  campaign,
}: {
  dashboard: CampaignDashboardSummary | null;
  onLifecycle: (fn: () => Promise<any>, label: string) => Promise<void>;
  campaign: Campaign;
}) {
  const b = dashboard?.buckets || {};
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          ["Queued",    b.queued ?? 0,     "bg-slate-500"],
          ["Sending",   b.sending ?? 0,    "bg-blue-500"],
          ["Completed", b.completed ?? 0,  "bg-emerald-500"],
          ["Paused",    b.paused ?? 0,     "bg-amber-500"],
          ["Failed",    b.failed ?? 0,     "bg-red-500"],
          ["Waiting",   b.waiting ?? 0,    "bg-purple-500"],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <div className={`text-[10px] font-mono uppercase text-white px-1.5 py-0.5 rounded ${color as string} inline-block`}>
              {label as string}
            </div>
            <div className="mt-1 text-2xl font-bold">{value as number}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {campaign.status !== CampaignStatus.PAUSED && (
          <button
            onClick={() => onLifecycle(() => campaignAutomationApi.pause(campaign.id), "Paused")}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-amber-500 text-white text-sm font-medium hover:bg-amber-600"
          >
            <Pause className="w-4 h-4" /> Pause
          </button>
        )}
        {campaign.status !== CampaignStatus.RUNNING && (
          <button
            onClick={() => onLifecycle(() => campaignAutomationApi.resume(campaign.id), "Resumed")}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600"
          >
            <Play className="w-4 h-4" /> Resume
          </button>
        )}
        <button
          onClick={() => onLifecycle(() => campaignAutomationApi.clone(campaign.id), "Cloned")}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-slate-700 text-white text-sm font-medium hover:bg-slate-800"
        >
          <Layers className="w-4 h-4" /> Clone
        </button>
        <button
          onClick={() => onLifecycle(() => campaignAutomationApi.archive(campaign.id), "Archived")}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-slate-500 text-white text-sm font-medium hover:bg-slate-600"
        >
          <X className="w-4 h-4" /> Archive
        </button>
      </div>
      {dashboard?.stopReasons && Object.keys(dashboard.stopReasons).length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[11px] font-mono uppercase text-slate-500 mb-2">Stop reasons</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(dashboard.stopReasons).map(([r, n]) => (
              <span key={r} className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                {r}: <b>{n}</b>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AnalyticsPanel({
  dashboard,
  allCampaigns,
}: {
  dashboard: CampaignDashboardSummary | null;
  allCampaigns: CampaignDashboardSummary[];
}) {
  const rates = dashboard?.rates || {};
  const counts = dashboard?.counts || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ["Sent",     counts.sent ?? 0],
          ["Opens",    counts.opened ?? 0],
          ["Replies",  counts.replied ?? 0],
          ["Meetings", counts.meetings ?? 0],
          ["Bounces",  counts.bounced ?? 0],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <div className="text-[11px] font-mono uppercase text-slate-500">{label as string}</div>
            <div className="mt-1 text-2xl font-bold">{value as number}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ["Open rate",   `${rates.openRate ?? 0}%`,   "text-blue-500"],
          ["Reply rate",  `${rates.replyRate ?? 0}%`,  "text-emerald-500"],
          ["Meeting rate", `${rates.meetingRate ?? 0}%`, "text-indigo-500"],
          ["Bounce rate", `${rates.bounceRate ?? 0}%`, "text-red-500"],
          ["Unsub rate",  `${rates.unsubRate ?? 0}%`,  "text-amber-500"],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <div className="text-[11px] font-mono uppercase text-slate-500">{label as string}</div>
            <div className={`mt-1 text-2xl font-bold ${color as string}`}>{value as string}</div>
          </div>
        ))}
      </div>
      {dashboard?.perSender && dashboard.perSender.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Mail className="w-4 h-4" /> Per sender</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <th className="text-left py-1.5">Email</th>
                <th className="text-right">Provider</th>
                <th className="text-right">Sent</th>
                <th className="text-right">Opened</th>
                <th className="text-right">Replied</th>
                <th className="text-right">Bounced</th>
                <th className="text-right">Reply%</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.perSender.map((s) => (
                <tr key={s.accountId} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-1.5">{s.email}</td>
                  <td className="text-right font-mono">{s.provider}</td>
                  <td className="text-right">{s.sent}</td>
                  <td className="text-right">{s.opened}</td>
                  <td className="text-right">{s.replied}</td>
                  <td className="text-right">{s.bounced}</td>
                  <td className="text-right font-semibold">{s.replyRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {allCampaigns.length > 1 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-sm font-semibold mb-2 flex items-center gap-1.5"><TrendingUp className="w-4 h-4" /> Workspace overview</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <th className="text-left py-1.5">Campaign</th>
                <th className="text-right">Status</th>
                <th className="text-right">Sent</th>
                <th className="text-right">Reply%</th>
                <th className="text-right">Meetings</th>
                <th className="text-right">Bounce%</th>
              </tr>
            </thead>
            <tbody>
              {allCampaigns.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-1.5 font-medium">{c.name}</td>
                  <td className="text-right font-mono">{c.status}</td>
                  <td className="text-right">{c.counts.sent ?? 0}</td>
                  <td className="text-right">{c.rates.replyRate ?? 0}%</td>
                  <td className="text-right">{c.counts.meetings ?? 0}</td>
                  <td className="text-right">{c.rates.bounceRate ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
