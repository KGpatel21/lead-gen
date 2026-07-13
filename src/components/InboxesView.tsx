/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Inbox,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  Play,
  Plus,
  Trash2,
  RefreshCw,
  Flame,
  X,
  PlusCircle,
  HelpCircle
} from "lucide-react";
import { SmtpAccount, WarmupPhase } from "../types";

interface InboxesViewProps {
  smtpAccounts: SmtpAccount[];
  onAddSmtp: (data: any) => Promise<SmtpAccount>;
  onUpdateSmtp: (id: string, data: Partial<SmtpAccount>) => void;
  onDeleteSmtp: (id: string) => void;
  onTestSmtp?: (id: string) => Promise<void>;
}

export default function InboxesView({
  smtpAccounts,
  onAddSmtp,
  onUpdateSmtp,
  onDeleteSmtp,
  onTestSmtp,
}: InboxesViewProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [email, setEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState(465);
  const [username, setUsername] = useState("");
  const [dailyLimit, setDailyLimit] = useState(50);
  const [warmupEnabled, setWarmupEnabled] = useState(true);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [testingSmtpId, setTestingSmtpId] = useState<string | null>(null);

  const handleCreateSmtp = async () => {
    if (!email || !smtpHost) return;
    try {
      await onAddSmtp({
        email,
        smtpHost,
        smtpPort,
        username: username || email,
        dailyLimit,
        warmupEnabled,
        smtpPassword,
      });
      setEmail("");
      setUsername("");
      setSmtpPassword("");
      setShowAddModal(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingSmtpId(id);
    try {
      if (onTestSmtp) {
        await onTestSmtp(id);
        alert("SMTP Connection successfully verified!");
      } else {
        alert("SMTP Verification not configured in parent container.");
      }
    } catch (err: any) {
      alert(`SMTP Verification Failed: ${err.message || err}`);
    } finally {
      setTestingSmtpId(null);
    }
  };

  const toggleWarmup = (id: string, currentValue: boolean) => {
    onUpdateSmtp(id, { warmupEnabled: !currentValue });
  };

  const handleLimitChange = (id: string, value: number) => {
    onUpdateSmtp(id, { dailyLimit: value });
  };

  const handleWarmupPhaseChange = (id: string, phase: WarmupPhase) => {
    let limit = 15;
    if (phase === WarmupPhase.MEDIUM) limit = 30;
    if (phase === WarmupPhase.ADVANCED) limit = 50;
    
    onUpdateSmtp(id, { warmupPhase: phase, warmupDailyLimit: limit });
  };

  return (
    <div className="flex-1 p-8 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto font-sans transition-colors duration-200" id="inboxes-view-wrapper">
      
      <div className="flex justify-between items-center mb-8" id="inbox-header">
        <div>
          <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider">SMTP Rotation & Delivery</span>
          <h1 className="text-3xl font-display font-semibold text-slate-900 dark:text-white tracking-tight">Connected Inboxes & Warmup</h1>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl cursor-pointer transition-all shadow-lg shadow-indigo-600/10"
          id="btn-add-smtp"
        >
          <Plus className="w-4 h-4" />
          Connect Inbox
        </button>
      </div>

      {/* Global Warmup Simulation stats banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8" id="warmup-stats-banner">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest block font-medium">Warmup Inboxes Online</span>
          <span className="text-2xl font-display font-semibold text-slate-800 dark:text-slate-100 mt-1 block">
            {smtpAccounts.filter(s => s.warmupEnabled).length} / {smtpAccounts.length}
          </span>
          <span className="text-[10px] text-emerald-650 dark:text-emerald-400 font-medium block mt-1">✔ Active background dialogue simulation</span>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest block font-medium">Warmup Sent-Today</span>
          <span className="text-2xl font-display font-semibold text-indigo-600 dark:text-indigo-400 mt-1 block">
            {smtpAccounts.reduce((sum, s) => sum + s.warmupSentToday, 0)} emails
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 block mt-1">Gradually expanding daily limit volumes</span>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest block font-medium">Collective Sender Reputation Score</span>
          <span className="text-2xl font-display font-semibold text-emerald-600 dark:text-emerald-400 mt-1 block">
            {smtpAccounts.length > 0
              ? Math.round(smtpAccounts.reduce((sum, s) => sum + s.reputationScore, 0) / smtpAccounts.length)
              : 100}%
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 block">90%+ protects domain index from spam audits</span>
        </div>
      </div>

      {/* Inboxes List Cards */}
      <div className="space-y-6" id="inboxes-list-layout">
        {smtpAccounts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center text-slate-500 shadow-sm">
            <Inbox className="w-12 h-12 opacity-30 text-indigo-550 mx-auto animate-pulse mb-3" />
            <h3 className="font-semibold text-slate-700 dark:text-slate-400">No connected SMTP servers found</h3>
            <p className="text-xs max-w-sm mx-auto mt-1">Connect your Gmail or GSuite / Microsoft accounts with custom port credentials to configure round-robin delivery profiles.</p>
          </div>
        ) : (
          smtpAccounts.map((smtp) => (
            <div
              key={smtp.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 hover:border-slate-350 dark:hover:border-slate-700 transition-all flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 shadow-sm"
            >
              {/* Account profile */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-950 flex items-center justify-center border border-slate-200 dark:border-slate-800 shrink-0">
                    <Inbox className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                  </div>
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{smtp.email}</h3>
                      {smtp.smtpPassword ? (
                        <span className="text-[9px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/40 font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                          ⚡ Real Outbox Connected
                        </span>
                      ) : (
                        <span className="text-[9px] bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/40 font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                          💤 Sandbox Simulation
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{smtp.smtpHost}:{smtp.smtpPort}</p>
                  </div>
                </div>

                {smtp.errorMessage && (
                  <div className="mb-4 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 rounded-xl p-3 text-[11px] font-mono flex items-start gap-2.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-500" />
                    <div>
                      <span className="font-bold uppercase tracking-wider block text-[9px] mb-0.5">SMTP Authentication / Socket Failure</span>
                      {smtp.errorMessage}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 bg-slate-50 dark:bg-slate-950/30 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800/60 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 text-[10px] block font-mono">Dispatches Today</span>
                    <span className="text-slate-700 dark:text-slate-200 font-bold block mt-0.5">{smtp.sentToday} / {smtp.dailyLimit}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 text-[10px] block font-mono">Reputation Rank</span>
                    <span className={`font-bold block mt-0.5 ${
                      smtp.reputationScore >= 95 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-500"
                    }`}>{smtp.reputationScore}%</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 text-[10px] block font-mono">Deliverability risk</span>
                    <span className={`font-bold block mt-0.5 ${
                      smtp.spamRisk === "LOW" ? "text-emerald-600 dark:text-emerald-500" : "text-amber-600 dark:text-amber-500"
                    }`}>{smtp.spamRisk}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 text-[10px] block font-mono">Inbox Warmup</span>
                    <span className="text-indigo-600 dark:text-indigo-400 font-semibold block mt-0.5">
                      {smtp.warmupEnabled ? "ACTIVE (Rotating)" : "DISABLED"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Control panels */}
              <div className="shrink-0 flex flex-col md:flex-row items-stretch md:items-center gap-6 border-t lg:border-t-0 border-slate-100 dark:border-slate-900 pt-4 lg:pt-0">
                
                {/* Adjust limits slider */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase block font-semibold">Max Daily Limit</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={10}
                      max={200}
                      value={smtp.dailyLimit}
                      onChange={(e) => handleLimitChange(smtp.id, Number(e.target.value))}
                      className="w-24 accent-indigo-500 cursor-pointer h-1.5 rounded-full bg-slate-200 dark:bg-slate-800"
                    />
                    <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 w-8">{smtp.dailyLimit}</span>
                  </div>
                </div>

                {/* Switch Warmup level */}
                {smtp.warmupEnabled && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 uppercase block font-semibold">Warmup Category</label>
                    <div className="flex gap-1" id="phase-toggles">
                      {[WarmupPhase.BEGINNER, WarmupPhase.MEDIUM, WarmupPhase.ADVANCED].map((ph) => (
                        <button
                          key={ph}
                          onClick={() => handleWarmupPhaseChange(smtp.id, ph)}
                          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg cursor-pointer transition-all ${
                            smtp.warmupPhase === ph
                              ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20"
                              : "bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {ph.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions toggles & trash */}
                <div className="flex items-center gap-3 justify-end">
                  <button
                    onClick={() => handleTestConnection(smtp.id)}
                    disabled={testingSmtpId === smtp.id}
                    className="flex items-center gap-1 text-[10px] font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-500/20 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingSmtpId === smtp.id ? "animate-spin text-indigo-500" : "text-slate-400"}`} />
                    {testingSmtpId === smtp.id ? "Testing..." : "Test Connection"}
                  </button>
                  <button
                    onClick={() => toggleWarmup(smtp.id, smtp.warmupEnabled)}
                    className={`flex items-center gap-1 text-[10px] font-bold px-3 py-1.5 rounded-xl cursor-pointer transition-all ${
                      smtp.warmupEnabled
                        ? "bg-emerald-600/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400"
                        : "bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-850 dark:hover:text-slate-200"
                    }`}
                    title={smtp.warmupEnabled ? "Pause Warmup Loop" : "Enable Warmup Loop"}
                  >
                    <Flame className={`w-3.5 h-3.5 ${smtp.warmupEnabled ? "text-emerald-500" : "text-slate-400"}`} />
                    {smtp.warmupEnabled ? "Warmup On" : "Enable"}
                  </button>
                  <button
                    onClick={() => onDeleteSmtp(smtp.id)}
                    className="p-1.5 border border-slate-200 dark:border-slate-800 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-950/45 bg-slate-50 dark:bg-slate-900 rounded-xl hover:text-red-500 dark:hover:text-red-400 text-slate-400 dark:text-slate-500 transition-all cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

              </div>
            </div>
          ))
        )}
      </div>

      {/* POPUP MODAL: CONNECT SMTP DETAILS */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" id="modal-smtp">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-between">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-display font-semibold text-slate-100">Connect SMTP Outbound Server</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-mono text-slate-300 block mb-1">Email Username Profile</label>
                <input
                  type="email"
                  placeholder="E.g., sales@outbound.enterpriseai.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-955 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-slate-300 block mb-1">Email Provider / preset</label>
                <select
                  onChange={(e) => {
                    const preset = e.target.value;
                    if (preset === "gmail") {
                      setSmtpHost("smtp.gmail.com");
                      setSmtpPort(465);
                    } else if (preset === "outlook") {
                      setSmtpHost("smtp.office365.com");
                      setSmtpPort(587);
                    } else if (preset === "zoho") {
                      setSmtpHost("smtp.zoho.com");
                      setSmtpPort(465);
                    } else if (preset === "ses") {
                      setSmtpHost("email-smtp.us-east-1.amazonaws.com");
                      setSmtpPort(465);
                    } else if (preset === "mailgun") {
                      setSmtpHost("smtp.mailgun.org");
                      setSmtpPort(587);
                    } else if (preset === "sendgrid") {
                      setSmtpHost("smtp.sendgrid.net");
                      setSmtpPort(587);
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="custom">Custom SMTP Server</option>
                  <option value="gmail">Google Gmail / Workspace GSuite</option>
                  <option value="outlook">Microsoft Outlook / Office 365</option>
                  <option value="zoho">Zoho Mail</option>
                  <option value="ses">Amazon SES</option>
                  <option value="mailgun">Mailgun</option>
                  <option value="sendgrid">SendGrid</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-xs font-mono text-slate-300 block mb-1">SMTP Outbound Host</label>
                  <input
                    type="text"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    className="w-full bg-slate-955 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-slate-300 block mb-1">Port</label>
                  <input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                    className="w-full bg-slate-955 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-mono text-slate-300 block mb-1">App-Specific Security Password (Optional)</label>
                <input
                  type="password"
                  placeholder="•••••••••••••••••••••"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  className="w-full bg-slate-955 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none"
                />
                <span className="text-[10px] text-slate-500 block mt-1">If blank, sandbox simulation will run. For Gmail/GSuite, please use a Google App Password.</span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="chk-warm"
                  checked={warmupEnabled}
                  onChange={(e) => setWarmupEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-500 accent-indigo-600 bg-slate-950 border-slate-800"
                />
                <label htmlFor="chk-warm" className="text-xs text-slate-300 select-none cursor-pointer">
                  Activate auto-conversation warmup system instantly.
                </label>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-950 flex justify-end gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSmtp}
                disabled={!email || !smtpHost}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                Authorize Connection
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
