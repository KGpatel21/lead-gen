/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production lead-discovery workflow.
 * Search → Preview → Analyze → Generate → Preview emails → Send via SES.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Search,
  Loader2,
  Globe,
  Star,
  Phone,
  MapPin,
  CheckCircle2,
  Send,
  Sparkles,
  ChevronRight,
  ClipboardList,
  AlertCircle,
  Mail,
} from "lucide-react";
import { leadDiscoveryApi, DiscoveredBusiness, GeneratedEmail } from "../api/endpoints";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/client";

type Step = "search" | "preview" | "analyze" | "generate" | "review" | "send";

const STEPS: { key: Step; label: string }[] = [
  { key: "search", label: "Search" },
  { key: "preview", label: "Preview leads" },
  { key: "analyze", label: "Analyze websites" },
  { key: "generate", label: "Generate emails" },
  { key: "review", label: "Review emails" },
  { key: "send", label: "Send via SES" },
];

interface AnalyzeResult {
  businessId: string;
  status: string;
  reason?: string;
  cache?: boolean;
}

export default function LeadDiscoveryView() {
  const toast = useToast();
  const { user } = useAuth();

  const [step, setStep] = useState<Step>("search");
  const [busy, setBusy] = useState(false);

  // Search inputs
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [count, setCount] = useState(20);

  // Result state
  const [businesses, setBusinesses] = useState<DiscoveredBusiness[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analyzeResults, setAnalyzeResults] = useState<Record<string, AnalyzeResult>>({});

  // Email generation inputs
  const [senderName, setSenderName] = useState(user?.name || "");
  const [senderCompany, setSenderCompany] = useState("");
  const [targetService, setTargetService] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [tone, setTone] = useState<"Direct" | "Warm" | "Consultative" | "Playful">("Consultative");
  const [emailOverride, setEmailOverride] = useState("");

  // Generated emails
  const [emails, setEmails] = useState<GeneratedEmail[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);

  const surface = useCallback((label: string, err: unknown) => {
    const msg = err instanceof ApiError ? err.message : (err as Error).message;
    toast.error(`${label}: ${msg}`);
  }, [toast]);

  const toggleSelect = (id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(businesses.map((b) => b.id)));
  const clearSelection = () => setSelectedIds(new Set());
  const selected = useMemo(() => businesses.filter((b) => selectedIds.has(b.id)), [businesses, selectedIds]);

  // ---- Actions ----

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) {
      toast.error("Enter a search query.");
      return;
    }
    setBusy(true);
    setBusinesses([]);
    setSelectedIds(new Set());
    setAnalyzeResults({});
    setEmails([]);
    setCampaignId(null);
    try {
      const r = await leadDiscoveryApi.search({ query, city: city || undefined, count });
      setBusinesses(r.businesses);
      setStep("preview");
      toast.success(`Found ${r.totalFetched} businesses (${r.freshPages} fresh, ${r.cachedPages} cached).`);
    } catch (err) { surface("Places search", err); }
    finally { setBusy(false); }
  };

  const doAnalyze = async () => {
    if (selected.length === 0) {
      toast.error("Select at least one business first.");
      return;
    }
    setBusy(true);
    setStep("analyze");
    try {
      const r = await leadDiscoveryApi.analyze(selected.map((b) => b.id));
      const map: Record<string, AnalyzeResult> = {};
      for (const row of r.results) map[row.businessId] = row;
      setAnalyzeResults(map);
      const succ = r.results.filter((x) => x.status === "SUCCESS").length;
      const skip = r.results.filter((x) => x.status === "SKIPPED").length;
      const fail = r.results.filter((x) => x.status === "FAILED").length;
      toast.success(`Scraped ${succ} · skipped ${skip} · failed ${fail}`);
    } catch (err) { surface("Firecrawl analyze", err); }
    finally { setBusy(false); }
  };

  const doGenerate = async () => {
    if (!senderName.trim() || !senderCompany.trim() || !targetService.trim()) {
      toast.error("Sender name, sender company and target service are all required.");
      return;
    }
    if (selected.length === 0) {
      toast.error("Select at least one business.");
      return;
    }
    setBusy(true);
    setStep("generate");
    setEmails([]);

    // First, create a campaign to group the batch.
    let cid = campaignId;
    if (!cid) {
      try {
        const camp = await leadDiscoveryApi.createCampaign({
          name: `${targetService} outreach — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          businessIds: selected.map((b) => b.id),
        });
        cid = camp.campaign.id;
        setCampaignId(cid);
      } catch (err) {
        surface("Create campaign", err);
        setBusy(false);
        return;
      }
    }

    // Generate emails one-by-one (sequential — Gemini free-tier friendly).
    const generated: GeneratedEmail[] = [];
    for (const biz of selected) {
      try {
        const r = await leadDiscoveryApi.generateEmail({
          businessId: biz.id,
          campaignId: cid,
          toEmail: emailOverride.trim() || undefined,
          senderName,
          senderCompany,
          targetService,
          valueProp: valueProp || undefined,
          tone,
        });
        generated.push(r.email);
        setEmails([...generated]); // stream into UI
      } catch (err) {
        toast.error(`${biz.name}: ${(err as Error).message}`);
      }
    }
    if (generated.length > 0) {
      setStep("review");
      toast.success(`Generated ${generated.length} email(s).`);
    }
    setBusy(false);
  };

  const doSend = async () => {
    if (!campaignId) return;
    setBusy(true);
    setStep("send");
    try {
      const r = await leadDiscoveryApi.sendCampaign(campaignId);
      toast.success(`SES: sent ${r.sent} · failed ${r.failed}`);
      // Refresh emails to reflect status changes
      const camp = await leadDiscoveryApi.getCampaign(campaignId);
      setEmails(camp.emails);
    } catch (err) { surface("SES send", err); }
    finally { setBusy(false); }
  };

  // ---- Rendering helpers ----

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const Stepper = (
    <ol className="flex items-center gap-1 mb-6 text-[11px] font-medium overflow-x-auto">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1 shrink-0">
          <span
            className={`px-2.5 py-1 rounded-full border ${
              i < stepIndex
                ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900"
                : i === stepIndex
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800"
            }`}
          >
            {i + 1}. {s.label}
          </span>
          {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-slate-400" />}
        </li>
      ))}
    </ol>
  );

  const BusinessRow: React.FC<{ b: DiscoveredBusiness }> = ({ b }) => {
    const isSel = selectedIds.has(b.id);
    const ar = analyzeResults[b.id];
    return (
      <label
        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
          isSel
            ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
            : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
        }`}
      >
        <input type="checkbox" checked={isSel} onChange={() => toggleSelect(b.id)} className="mt-1 accent-blue-600" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{b.name}</h4>
            {b.googleRating != null && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                <Star className="w-3 h-3 fill-current" />
                {b.googleRating}
                {b.googleReviewsCount != null && (
                  <span className="text-slate-500 dark:text-slate-400 ml-1">
                    ({b.googleReviewsCount})
                  </span>
                )}
              </span>
            )}
            {b.businessCategory && (
              <span className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400 px-1.5 py-0.5 border border-slate-200 dark:border-slate-800 rounded">
                {b.businessCategory.replace(/_/g, " ")}
              </span>
            )}
            {ar && (
              <span
                className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${
                  ar.status === "SUCCESS"
                    ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                    : ar.status === "SKIPPED"
                    ? "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400"
                    : "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400"
                }`}
                title={ar.reason}
              >
                {ar.status}{ar.cache ? " (cache)" : ""}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
            {b.address && (
              <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {b.address}</div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {b.website && (
                <a
                  href={b.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Globe className="w-3 h-3" /> {b.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                </a>
              )}
              {b.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {b.phone}
                </span>
              )}
            </div>
          </div>
        </div>
      </label>
    );
  };

  const EmailCard: React.FC<{ e: GeneratedEmail; bizName?: string }> = ({ e, bizName }) => (
    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{bizName || e.businessId}</h4>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">→ {e.toEmail || "(no email extracted)"}</div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          {e.confidenceScore != null && (
            <span
              className={`px-1.5 py-0.5 rounded ${
                e.confidenceScore >= 0.7
                  ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                  : e.confidenceScore >= 0.4
                  ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
                  : "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400"
              }`}
            >
              conf {(e.confidenceScore * 100).toFixed(0)}%
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            {e.status}
          </span>
        </div>
      </div>
      <div className="text-sm">
        <div className="font-medium text-slate-800 dark:text-slate-200">{e.subject}</div>
      </div>
      <pre className="whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-3 rounded border border-slate-100 dark:border-slate-800 font-sans leading-relaxed">
        {e.bodyText}
      </pre>
      {e.painPoints && e.painPoints.length > 0 && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold">Pain points:</span> {e.painPoints.join(" · ")}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">
            Places → Firecrawl → Gemini → SES
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Lead Discovery</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real Google Places businesses, real website analysis, reasoning-only Gemini emails, delivered via Amazon SES.
          </p>
        </div>

        {Stepper}

        {/* Search bar */}
        <form onSubmit={doSearch} className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Business keyword</label>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. dental clinics"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="md:col-span-4">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">City (optional)</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Seattle, WA"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Count</label>
              <input type="number" min={1} max={60} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <button type="submit" disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5">
            {busy && step === "search" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search Google Places
          </button>
        </form>

        {/* Results + selection */}
        {businesses.length > 0 && (
          <section className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                {businesses.length} businesses · {selected.length} selected
              </h2>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAll} className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
                  Select all
                </button>
                <button onClick={clearSelection} className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
                  Clear
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {businesses.map((b) => (
                <BusinessRow key={b.id} b={b} />
              ))}
            </div>

            <div className="flex flex-wrap gap-2 sticky bottom-4 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur border border-slate-200 dark:border-slate-800 rounded-2xl p-3">
              <button onClick={doAnalyze} disabled={busy || selected.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm px-4 py-2">
                {busy && step === "analyze" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
                Analyze {selected.length} website(s)
              </button>
              <button onClick={doGenerate} disabled={busy || selected.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm px-4 py-2">
                {busy && step === "generate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate emails
              </button>
            </div>
          </section>
        )}

        {/* Sender panel (needed for generate step) */}
        {businesses.length > 0 && (
          <section className="mt-6 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
            <h3 className="font-semibold text-sm mb-3">Sender & offer</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Your name</label>
                <input value={senderName} onChange={(e) => setSenderName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Your company</label>
                <input value={senderCompany} onChange={(e) => setSenderCompany(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none" />
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Target service you're offering</label>
                <input value={targetService} onChange={(e) => setTargetService(e.target.value)} placeholder="e.g. automated appointment booking"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none" />
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Value prop (optional)</label>
                <input value={valueProp} onChange={(e) => setValueProp(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Tone</label>
                <select value={tone} onChange={(e) => setTone(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none">
                  <option>Consultative</option>
                  <option>Direct</option>
                  <option>Warm</option>
                  <option>Playful</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                  Send-to override (optional; use when no email is found on-site)
                </label>
                <input value={emailOverride} onChange={(e) => setEmailOverride(e.target.value)} placeholder="you+test@example.com"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none" />
              </div>
            </div>
          </section>
        )}

        {/* Emails preview + send */}
        {emails.length > 0 && (
          <section className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Mail className="w-4 h-4" /> {emails.length} email(s) generated
              </h2>
              <button onClick={doSend} disabled={busy || !campaignId || emails.every((e) => !e.toEmail)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm px-4 py-2">
                {busy && step === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send via Amazon SES
              </button>
            </div>
            {emails.some((e) => !e.toEmail) && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs flex gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                Some businesses have no public email on their site. Provide a "Send-to override" above and re-generate, or add per-business emails in the DB. These rows are queued as PENDING and will be skipped on send.
              </div>
            )}
            <div className="space-y-3">
              {emails.map((e) => (
                <EmailCard key={e.id} e={e} bizName={businesses.find((b) => b.id === e.businessId)?.name} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
