/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Center — Phase 6 UI.
 *
 * Four tabs (Knowledge Bases / Signatures / Templates / Prompts) plus
 * an Admin summary card at the top showing per-workspace usage stats.
 * All CRUD is real — no mock data.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, BookOpen, Bot, Check, ChevronRight, Database, FileText, GitBranch, Loader2,
  Mail, Plus, RefreshCw, Save, Search, Signature as SigIcon, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { useToast } from "../context/ToastContext";
import { usePolling } from "../hooks/usePolling";
import {
  knowledgeApi, signaturesApi, emailTemplatesV2Api, promptsApi,
  KnowledgeBaseDto, KnowledgeFileDto, SignatureDto, EmailTemplateV2Dto, PromptDto,
} from "../api/endpoints";

type Tab = "kbs" | "signatures" | "templates" | "prompts" | "admin";

export default function KnowledgeCenterView() {
  const [tab, setTab] = useState<Tab>("kbs");
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  const loadStats = React.useCallback(async () => {
    try { setStats((await knowledgeApi.adminDashboard()).stats); } catch { /* silent */ }
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);
  usePolling(loadStats, { intervalMs: 30_000, fireOnMount: false });

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <header className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">Knowledge Center</h1>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-blue-500/40 text-blue-500">PHASE 6</span>
        </div>
      </header>

      <StatsStrip stats={stats} />

      <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {([
          ["kbs",         "Knowledge Bases", Database],
          ["signatures",  "Signatures",       SigIcon],
          ["templates",   "Email Templates",  Mail],
          ["prompts",     "Prompt Library",   Bot],
          ["admin",       "Admin",            Sparkles],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px flex items-center gap-1.5 ${
              tab === id
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </nav>

      {tab === "kbs"        && <KnowledgeBasesPanel onChange={loadStats} />}
      {tab === "signatures" && <SignaturesPanel onChange={loadStats} />}
      {tab === "templates"  && <TemplatesPanel onChange={loadStats} />}
      {tab === "prompts"    && <PromptsPanel onChange={loadStats} />}
      {tab === "admin"      && <AdminPanel stats={stats} onRefresh={loadStats} />}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Stats strip
// -----------------------------------------------------------------------------
function StatsStrip({ stats }: { stats: Record<string, any> | null }) {
  const s = stats || {};
  const bytesFmt = (n: number) => {
    if (!n) return "0 B";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <StatCard label="Knowledge Bases" value={String(s.knowledgeBases ?? 0)} icon={<Database className="w-4 h-4" />} />
      <StatCard label="Chunks" value={String(s.chunks ?? 0)} icon={<FileText className="w-4 h-4" />} />
      <StatCard label="Vectors" value={String(s.vectors ?? 0)} icon={<Sparkles className="w-4 h-4" />} />
      <StatCard label="Storage" value={bytesFmt(Number(s.storageBytes || 0))} icon={<Archive className="w-4 h-4" />} />
      <StatCard label="Templates" value={String(s.emailTemplates ?? 0)} icon={<Mail className="w-4 h-4" />} />
      <StatCard label="Signatures" value={String(s.signatures ?? 0)} icon={<SigIcon className="w-4 h-4" />} />
    </div>
  );
}
function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
      <div className="text-[10px] font-mono uppercase text-slate-500 flex items-center gap-1.5">{icon}{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white truncate">{value}</div>
    </div>
  );
}

// =============================================================================
// Knowledge Bases
// =============================================================================
function KnowledgeBasesPanel({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [kbs, setKbs] = useState<KnowledgeBaseDto[]>([]);
  const [providers, setProviders] = useState<Array<{ kind: string; defaultModel: string; configured: boolean }>>([]);
  const [selected, setSelected] = useState<KnowledgeBaseDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [list, provs] = await Promise.all([knowledgeApi.listKbs(), knowledgeApi.providers()]);
      setKbs(list.knowledgeBases);
      setProviders(provs.providers);
      if (selected) {
        setSelected(list.knowledgeBases.find((k) => k.id === selected.id) || null);
      }
    } catch (err: any) { toast.error(`Load KBs: ${err.message || err}`); }
    finally { setLoading(false); }
  }, [toast, selected]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(
    () => kbs.filter((k) => !search || k.name.toLowerCase().includes(search.toLowerCase())),
    [kbs, search]
  );

  const doCreate = async (payload: { name: string; description: string; embeddingProvider: string; tags: string[] }) => {
    try {
      await knowledgeApi.createKb(payload);
      toast.success(`Knowledge base "${payload.name}" created.`);
      setCreating(false);
      await load(); onChange();
    } catch (err: any) { toast.error(`Create failed: ${err.message || err}`); }
  };
  const doDelete = async (kb: KnowledgeBaseDto) => {
    if (!confirm(`Archive "${kb.name}"? Its files and vectors will be soft-deleted.`)) return;
    try {
      await knowledgeApi.deleteKb(kb.id);
      toast.success("Archived.");
      if (selected?.id === kb.id) setSelected(null);
      await load(); onChange();
    } catch (err: any) { toast.error(err.message || String(err)); }
  };

  return (
    <div className="grid grid-cols-12 gap-4">
      <aside className="col-span-12 lg:col-span-4 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search knowledge bases…"
              className="w-full pl-8 pr-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> New
          </button>
          <button onClick={load} className="p-2 rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="space-y-2 max-h-[70vh] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-xs text-slate-500 p-4 border border-dashed border-slate-300 dark:border-slate-700 rounded-md text-center">
              No knowledge bases yet. Create your first one — e.g. "Company Profile", "Case Studies", "Pricing".
            </div>
          )}
          {filtered.map((kb) => (
            <button
              key={kb.id}
              onClick={() => setSelected(kb)}
              className={`w-full text-left p-3 rounded-lg border ${
                selected?.id === kb.id
                  ? "border-blue-500 bg-blue-50 dark:bg-slate-800"
                  : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">{kb.name}</div>
                <StatusPill status={kb.status} />
              </div>
              <div className="mt-1 text-[11px] text-slate-500 flex gap-3">
                <span>{kb.fileCount} files</span>
                <span>{kb.chunkCount} chunks</span>
                <span>{kb.vectorCount} vectors</span>
              </div>
              <div className="mt-1 text-[10px] font-mono text-slate-400 truncate">
                {kb.embeddingProvider}:{kb.embeddingModel}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="col-span-12 lg:col-span-8">
        {creating && (
          <KnowledgeBaseCreateForm
            providers={providers}
            onCancel={() => setCreating(false)}
            onSubmit={doCreate}
          />
        )}
        {!creating && !selected && (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-slate-500 text-sm">
            Select a knowledge base on the left, or click <b>New</b> to create one.
          </div>
        )}
        {!creating && selected && (
          <KnowledgeBaseDetail
            kb={selected}
            onRefresh={async () => { await load(); onChange(); }}
            onDelete={() => doDelete(selected)}
          />
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600 border-slate-300",
    INDEXING: "bg-blue-100 text-blue-600 border-blue-300 dark:bg-blue-500/10",
    READY: "bg-emerald-100 text-emerald-600 border-emerald-300 dark:bg-emerald-500/10",
    ERROR: "bg-red-100 text-red-600 border-red-300 dark:bg-red-500/10",
    ARCHIVED: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/10",
    ACTIVE: "bg-emerald-100 text-emerald-600 border-emerald-300 dark:bg-emerald-500/10",
    PENDING: "bg-slate-100 text-slate-600 border-slate-300",
    EXTRACTING: "bg-blue-100 text-blue-600 border-blue-300",
    CHUNKING: "bg-blue-100 text-blue-600 border-blue-300",
    EMBEDDING: "bg-purple-100 text-purple-600 border-purple-300 dark:bg-purple-500/10",
  };
  return (
    <span className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded-full border ${map[status] || map.DRAFT}`}>
      {status}
    </span>
  );
}

function KnowledgeBaseCreateForm({
  providers, onCancel, onSubmit,
}: {
  providers: Array<{ kind: string; defaultModel: string; configured: boolean }>;
  onCancel: () => void;
  onSubmit: (p: { name: string; description: string; embeddingProvider: string; tags: string[] }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [provider, setProvider] = useState(providers.find((p) => p.configured)?.kind || "openai");

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Create knowledge base</h2>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
      </div>
      <label className="block text-xs">
        <span className="text-slate-600 dark:text-slate-400 font-medium">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AI Services, Case Studies, Pricing"
          className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
      </label>
      <label className="block text-xs">
        <span className="text-slate-600 dark:text-slate-400 font-medium">Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
          className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="text-slate-600 dark:text-slate-400 font-medium">Tags (comma-separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="core, product, sales"
            className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
        </label>
        <label className="block text-xs">
          <span className="text-slate-600 dark:text-slate-400 font-medium">Embedding provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm">
            {providers.map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.kind}{p.configured ? "" : " (needs API key)"} — {p.defaultModel}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-4 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-sm">Cancel</button>
        <button
          disabled={!name.trim()}
          onClick={() => onSubmit({
            name: name.trim(), description: description.trim(),
            embeddingProvider: provider,
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          })}
          className="px-5 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function KnowledgeBaseDetail({ kb, onRefresh, onDelete }: {
  kb: KnowledgeBaseDto;
  onRefresh: () => Promise<void>;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [files, setFiles] = useState<KnowledgeFileDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [testQuery, setTestQuery] = useState("");
  const [hits, setHits] = useState<Array<{ score: number; content: string; fileName?: string }>>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await knowledgeApi.listFiles(kb.id);
      setFiles(r.files);
    } catch (err: any) { toast.error(err.message || String(err)); }
  }, [kb.id, toast]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, { intervalMs: 8_000, fireOnMount: false });

  const doUpload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      const arr = Array.from(list);
      const r = await knowledgeApi.uploadFiles(kb.id, arr);
      const ok = r.uploads.filter((u) => u.status === "READY").length;
      const dup = r.uploads.filter((u) => u.status === "DUPLICATE").length;
      const err = r.uploads.filter((u) => u.status === "ERROR").length;
      toast.success(`Upload: ${ok} indexed, ${dup} duplicate, ${err} errored.`);
      if (err > 0) {
        const first = r.uploads.find((u) => u.status === "ERROR");
        if (first?.errorMessage) toast.error(`First error: ${first.errorMessage}`);
      }
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) { toast.error(err.message || String(err)); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
  };

  const doDeleteFile = async (f: KnowledgeFileDto) => {
    if (!confirm(`Delete ${f.fileName}? Its chunks and vectors will be removed.`)) return;
    try {
      await knowledgeApi.deleteFile(kb.id, f.id);
      await Promise.all([load(), onRefresh()]);
    } catch (err: any) { toast.error(err.message || String(err)); }
  };

  const doSearch = async () => {
    if (!testQuery.trim()) return;
    try {
      const r = await knowledgeApi.search(kb.id, testQuery.trim(), 6);
      setHits(r.hits);
    } catch (err: any) { toast.error(err.message || String(err)); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{kb.name}</h3>
            {kb.description && <p className="text-xs text-slate-500 mt-0.5">{kb.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={kb.status} />
            <button onClick={onDelete} className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 mt-4">
          <MiniStat label="Files" value={String(kb.fileCount)} />
          <MiniStat label="Chunks" value={String(kb.chunkCount)} />
          <MiniStat label="Vectors" value={String(kb.vectorCount)} />
          <MiniStat label="Provider" value={kb.embeddingProvider} sub={kb.embeddingModel} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold flex items-center gap-1.5"><FileText className="w-4 h-4" /> Files</h4>
          <div className="flex gap-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,.csv,.html,.htm"
              onChange={(e) => doUpload(e.target.files)}
              className="hidden"
            />
            <button
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload files
            </button>
          </div>
        </div>
        {files.length === 0 && (
          <div className="text-xs text-slate-500 p-4 border border-dashed border-slate-300 dark:border-slate-700 rounded-md text-center">
            No files yet. Supported: PDF, DOCX, TXT, MD, CSV, HTML.
          </div>
        )}
        {files.length > 0 && (
          <div className="space-y-1.5">
            {files.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 group">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{f.fileName}</div>
                  <div className="text-[11px] text-slate-500 flex gap-3">
                    <span>{Math.round(f.fileSize / 1024)} KB</span>
                    <span>{f.chunkCount} chunks · {f.vectorCount} vectors</span>
                    {f.errorMessage && <span className="text-red-500 truncate max-w-[300px]">{f.errorMessage}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={f.status} />
                  <button onClick={() => doDeleteFile(f)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 opacity-0 group-hover:opacity-100">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><Search className="w-4 h-4" /> Test vector search</h4>
        <div className="flex gap-2">
          <input
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
            placeholder="Ask a question to see the top matching chunks…"
            className="flex-1 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
          <button onClick={doSearch} className="px-4 py-1.5 rounded-md bg-slate-800 text-white text-xs font-medium hover:bg-slate-900">Search</button>
        </div>
        {hits.length > 0 && (
          <ol className="mt-3 space-y-2">
            {hits.map((h, i) => (
              <li key={i} className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{h.fileName || "(unknown file)"}</span>
                  <span className="font-mono">score {h.score.toFixed(3)}</span>
                </div>
                <div className="text-xs mt-1 line-clamp-3">{h.content}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
      <div className="text-[10px] font-mono uppercase text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 truncate">{sub}</div>}
    </div>
  );
}

// =============================================================================
// Signatures
// =============================================================================
function SignaturesPanel({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<SignatureDto[]>([]);
  const [editing, setEditing] = useState<Partial<SignatureDto> | null>(null);

  const load = React.useCallback(async () => {
    try { setItems((await signaturesApi.list()).signatures); } catch (err: any) { toast.error(err.message || String(err)); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await signaturesApi.update(editing.id, editing);
      else await signaturesApi.create(editing as any);
      toast.success("Saved.");
      setEditing(null);
      await load(); onChange();
    } catch (err: any) { toast.error(err.message || String(err)); }
  };
  const del = async (id: string) => {
    if (!confirm("Delete signature?")) return;
    try { await signaturesApi.del(id); await load(); onChange(); } catch (err: any) { toast.error(err.message || String(err)); }
  };

  return (
    <ResourceListDetail
      items={items}
      selected={editing as any}
      renderTitle={(s: any) => (
        <div className="flex items-center gap-2">
          <span className="truncate">{s.name}</span>
          {s.isDefault && <span className="text-[9px] font-mono px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded border border-blue-500/30">DEFAULT</span>}
        </div>
      )}
      renderMeta={(s: any) => `${s.role || "—"} · v${s.version}`}
      newItem={() => setEditing({
        name: "", role: "", title: "", company: "", website: "", phone: "", linkedin: "",
        address: "", disclaimer: "", htmlBody: "", textBody: "", isDefault: false,
      })}
      onSelect={(s) => setEditing(s as any)}
      onDelete={(s) => del((s as any).id)}
      empty="Signatures like Founder / Sales / Support. Attached at send time — not tied to Gmail/Outlook."
    >
      {editing && <SignatureEditor value={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} />}
    </ResourceListDetail>
  );
}

function SignatureEditor({ value, onChange, onSave, onCancel }: {
  value: Partial<SignatureDto>;
  onChange: (v: Partial<SignatureDto>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const patch = (k: keyof SignatureDto, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Name (internal)" v={value.name || ""} onChange={(v) => patch("name", v)} placeholder="Founder Signature" />
        <Input label="Role" v={value.role || ""} onChange={(v) => patch("role", v)} placeholder="Sales / Founder / Support" />
        <Input label="Title" v={value.title || ""} onChange={(v) => patch("title", v)} placeholder="Head of Sales" />
        <Input label="Company" v={value.company || ""} onChange={(v) => patch("company", v)} />
        <Input label="Website" v={value.website || ""} onChange={(v) => patch("website", v)} />
        <Input label="Phone" v={value.phone || ""} onChange={(v) => patch("phone", v)} />
        <Input label="LinkedIn" v={value.linkedin || ""} onChange={(v) => patch("linkedin", v)} />
        <Input label="Address" v={value.address || ""} onChange={(v) => patch("address", v)} />
      </div>
      <TextArea label="HTML body" rows={5} v={value.htmlBody || ""} onChange={(v) => patch("htmlBody", v)}
        placeholder="<p><strong>Jane Smith</strong><br/>Head of Sales, Acme<br/>jane@acme.com</p>" />
      <TextArea label="Plain-text body" rows={5} v={value.textBody || ""} onChange={(v) => patch("textBody", v)}
        placeholder="Jane Smith / Head of Sales, Acme / jane@acme.com" />
      <TextArea label="Disclaimer (optional)" rows={2} v={value.disclaimer || ""} onChange={(v) => patch("disclaimer", v)} />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={!!value.isDefault} onChange={(e) => patch("isDefault", e.target.checked)} />
        <span>Use as workspace default signature</span>
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-4 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-sm">Cancel</button>
        <button onClick={onSave} disabled={!value.name || !value.htmlBody || !value.textBody}
          className="px-5 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          <Save className="w-4 h-4" /> Save signature
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Email Templates (V2)
// =============================================================================
function TemplatesPanel({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<EmailTemplateV2Dto[]>([]);
  const [editing, setEditing] = useState<Partial<EmailTemplateV2Dto> | null>(null);

  const load = React.useCallback(async () => {
    try { setItems((await emailTemplatesV2Api.list()).templates); } catch (err: any) { toast.error(err.message || String(err)); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await emailTemplatesV2Api.update(editing.id, editing);
      else await emailTemplatesV2Api.create(editing as any);
      toast.success("Saved.");
      setEditing(null);
      await load(); onChange();
    } catch (err: any) { toast.error(err.message || String(err)); }
  };
  const del = async (id: string) => {
    if (!confirm("Delete template?")) return;
    try { await emailTemplatesV2Api.del(id); await load(); onChange(); } catch (err: any) { toast.error(err.message || String(err)); }
  };
  const dup = async (id: string) => {
    try { await emailTemplatesV2Api.duplicate(id); await load(); onChange(); } catch (err: any) { toast.error(err.message || String(err)); }
  };

  return (
    <ResourceListDetail
      items={items}
      selected={editing as any}
      renderTitle={(t: any) => (
        <span className="truncate">{t.name}</span>
      )}
      renderMeta={(t: any) => `${t.category} · v${t.version}`}
      newItem={() => setEditing({
        name: "", description: "", category: "Cold Outreach", tags: [],
        subject: "", htmlBody: "", textBody: "", variables: [],
      })}
      onSelect={(t) => setEditing(t as any)}
      onDelete={(t) => del((t as any).id)}
      extraActions={(t) => (
        <button onClick={(e) => { e.stopPropagation(); dup((t as any).id); }} className="text-[10px] text-slate-500 hover:text-blue-500 mr-2">Duplicate</button>
      )}
      empty='Templates like "Cold Outreach", "Follow-up", "Meeting Request". Supports {{firstName}}, {{company}}, {{signature}} variables.'
    >
      {editing && <TemplateEditor value={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} />}
    </ResourceListDetail>
  );
}

function TemplateEditor({ value, onChange, onSave, onCancel }: {
  value: Partial<EmailTemplateV2Dto>;
  onChange: (v: Partial<EmailTemplateV2Dto>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const patch = (k: keyof EmailTemplateV2Dto, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Name" v={value.name || ""} onChange={(v) => patch("name", v)} placeholder="Cold Outreach v3" />
        <Input label="Category" v={value.category || "General"} onChange={(v) => patch("category", v)} />
        <Input label="Tags (comma-sep)" v={(value.tags || []).join(", ")} onChange={(v) => patch("tags", v.split(",").map((t) => t.trim()).filter(Boolean))} />
        <Input label="Variables (comma-sep)" v={(value.variables || []).join(", ")} onChange={(v) => patch("variables", v.split(",").map((t) => t.trim()).filter(Boolean))} />
      </div>
      <Input label="Subject" v={value.subject || ""} onChange={(v) => patch("subject", v)} placeholder="Quick thought for {{company}}" />
      <TextArea label="HTML body" rows={7} v={value.htmlBody || ""} onChange={(v) => patch("htmlBody", v)}
        placeholder="<p>Hi {{firstName}},</p>..." />
      <TextArea label="Text body" rows={7} v={value.textBody || ""} onChange={(v) => patch("textBody", v)}
        placeholder="Hi {{firstName}},..." />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-4 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-sm">Cancel</button>
        <button onClick={onSave} disabled={!value.name || !value.subject || !value.htmlBody || !value.textBody}
          className="px-5 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          <Save className="w-4 h-4" /> Save template
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Prompt Library
// =============================================================================
function PromptsPanel({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<PromptDto[]>([]);
  const [editing, setEditing] = useState<Partial<PromptDto> | null>(null);

  const load = React.useCallback(async () => {
    try { setItems((await promptsApi.list()).prompts); } catch (err: any) { toast.error(err.message || String(err)); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await promptsApi.update(editing.id, editing);
      else await promptsApi.create(editing as any);
      toast.success("Saved.");
      setEditing(null);
      await load(); onChange();
    } catch (err: any) { toast.error(err.message || String(err)); }
  };
  const del = async (id: string) => {
    if (!confirm("Delete prompt?")) return;
    try { await promptsApi.del(id); await load(); onChange(); } catch (err: any) { toast.error(err.message || String(err)); }
  };

  return (
    <ResourceListDetail
      items={items}
      selected={editing as any}
      renderTitle={(p: any) => <span className="truncate">{p.name}</span>}
      renderMeta={(p: any) => `${p.category} · temp ${p.temperature}`}
      newItem={() => setEditing({ name: "", description: "", category: "Cold Email", userPrompt: "", temperature: 0.7, variables: [] })}
      onSelect={(p) => setEditing(p as any)}
      onDelete={(p) => del((p as any).id)}
      empty="Prompt Library entries like Cold Email, Follow-up, Break-up. Assigned per-campaign or per-step."
    >
      {editing && <PromptEditor value={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} />}
    </ResourceListDetail>
  );
}
function PromptEditor({ value, onChange, onSave, onCancel }: {
  value: Partial<PromptDto>;
  onChange: (v: Partial<PromptDto>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const patch = (k: keyof PromptDto, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Name" v={value.name || ""} onChange={(v) => patch("name", v)} placeholder="Cold Email — Consultative" />
        <Input label="Category" v={value.category || "General"} onChange={(v) => patch("category", v)} />
        <Input label="AI model (optional)" v={value.aiModel || ""} onChange={(v) => patch("aiModel", v)} placeholder="e.g. llama-3.3-70b-versatile" />
        <Input label="Temperature" v={String(value.temperature ?? 0.7)} onChange={(v) => patch("temperature", Number(v) || 0.7)} type="number" />
      </div>
      <TextArea label="System prompt (optional)" rows={3} v={value.systemPrompt || ""} onChange={(v) => patch("systemPrompt", v)} />
      <TextArea label="User prompt" rows={7} v={value.userPrompt || ""} onChange={(v) => patch("userPrompt", v)}
        placeholder="Write a cold email that..." />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-4 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-sm">Cancel</button>
        <button onClick={onSave} disabled={!value.name || !value.userPrompt}
          className="px-5 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          <Save className="w-4 h-4" /> Save prompt
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Admin (bigger view of the stats strip)
// =============================================================================
function AdminPanel({ stats, onRefresh }: { stats: Record<string, unknown> | null; onRefresh: () => void }) {
  const s = (stats || {}) as Record<string, any>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Knowledge Center usage</h2>
        <button onClick={onRefresh} className="p-2 rounded-md border border-slate-300 dark:border-slate-700"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <BigStat label="Knowledge Bases" value={String(s.knowledgeBases ?? 0)} />
        <BigStat label="Files (all statuses)" value={JSON.stringify(s.files || {})} />
        <BigStat label="Chunks / Vectors" value={`${s.chunks ?? 0} / ${s.vectors ?? 0}`} />
        <BigStat label="Approx. tokens indexed" value={String(s.tokenEstimate ?? 0)} />
        <BigStat label="Storage" value={`${Math.round(Number(s.storageBytes || 0) / 1024)} KB`} />
        <BigStat label="Templates / Signatures / Prompts" value={`${s.emailTemplates ?? 0} / ${s.signatures ?? 0} / ${s.prompts ?? 0}`} />
        <BigStat label="Campaign KB assignments" value={String((s.campaignAssignments as any)?.kb_assigns ?? 0)} />
        <BigStat label="Campaign template assignments" value={String((s.campaignAssignments as any)?.tpl_assigns ?? 0)} />
        <BigStat label="Campaign signature assignments" value={String((s.campaignAssignments as any)?.sig_assigns ?? 0)} />
      </div>
    </div>
  );
}
function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="text-[11px] font-mono uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold break-all">{value}</div>
    </div>
  );
}

// =============================================================================
// Shared list + detail scaffold (used by Signatures / Templates / Prompts)
// =============================================================================
function ResourceListDetail(props: {
  items: Array<{ id: string; name: string }>;
  selected: { id?: string } | null;
  renderTitle: (item: any) => React.ReactNode;
  renderMeta: (item: any) => React.ReactNode;
  newItem: () => void;
  onSelect: (item: any) => void;
  onDelete: (item: any) => void;
  extraActions?: (item: any) => React.ReactNode;
  empty: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-12 gap-4">
      <aside className="col-span-12 lg:col-span-4 space-y-3">
        <button onClick={props.newItem}
          className="w-full px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 flex items-center justify-center gap-1.5">
          <Plus className="w-4 h-4" /> New
        </button>
        <div className="space-y-1.5 max-h-[70vh] overflow-y-auto">
          {props.items.length === 0 && (
            <div className="text-xs text-slate-500 p-4 border border-dashed border-slate-300 dark:border-slate-700 rounded-md text-center">
              {props.empty}
            </div>
          )}
          {props.items.map((it) => (
            <div
              key={it.id}
              onClick={() => props.onSelect(it)}
              className={`p-3 rounded-lg border cursor-pointer group flex items-center justify-between gap-2 ${
                props.selected?.id === it.id
                  ? "border-blue-500 bg-blue-50 dark:bg-slate-800"
                  : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{props.renderTitle(it)}</div>
                <div className="text-[10px] text-slate-500 truncate">{props.renderMeta(it)}</div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                {props.extraActions?.(it)}
                <button onClick={(e) => { e.stopPropagation(); props.onDelete(it); }}
                  className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </div>
            </div>
          ))}
        </div>
      </aside>
      <section className="col-span-12 lg:col-span-8">
        {props.selected
          ? props.children
          : (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-slate-500 text-sm">
              Select an item on the left, or click <b>New</b> to create one.
            </div>
          )}
      </section>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Reusable inputs
// -----------------------------------------------------------------------------
function Input({ label, v, onChange, placeholder, type = "text" }: {
  label: string; v: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-slate-600 dark:text-slate-400 font-medium">{label}</span>
      <input
        type={type}
        value={v}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
      />
    </label>
  );
}
function TextArea({ label, v, onChange, placeholder, rows = 4 }: {
  label: string; v: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <label className="block text-xs">
      <span className="text-slate-600 dark:text-slate-400 font-medium">{label}</span>
      <textarea
        rows={rows}
        value={v}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono"
      />
    </label>
  );
}
