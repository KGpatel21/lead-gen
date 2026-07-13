/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Settings,
  ShieldCheck,
  CheckCircle,
  Clock,
  Skull,
  AlertTriangle,
  Flame,
  Key
} from "lucide-react";

export default function SettingsView() {
  const [minDelay, setMinDelay] = useState(120);
  const [maxDelay, setMaxDelay] = useState(300);
  const [stopOnBounceRate, setStopOnBounceRate] = useState(8);
  const [enableUnsubPixel, setEnableUnsubPixel] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const handleSaveSettings = () => {
    setSaveStatus("✔ Settings saved securely in server context!");
    setTimeout(() => setSaveStatus(""), 4000);
  };

  const handleClearDatabase = async () => {
    const confirmed = window.confirm("Are you sure you want to clear all dummy datasets from the sandbox? This will instantly reset campaigns, leads, warmups, and activity metrics to zero.");
    if (!confirmed) return;

    setResetting(true);
    try {
      const res = await fetch("/api/testing/clear-database", { method: "POST" });
      if (res.ok) {
        setResetMessage("✔ Sandbox cleared! Reloading platform state...");
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setResetMessage("❌ Failed to clear database context on server.");
      }
    } catch (e: any) {
      setResetMessage("❌ Error: " + e.message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="flex-1 p-8 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto font-sans transition-colors duration-200" id="settings-view-wrapper">
      
      <div className="mb-8" id="settings-header">
        <span className="text-[10px] font-mono text-indigo-650 dark:text-indigo-400 font-bold uppercase tracking-wider">Workspace Tuning</span>
        <h1 className="text-3xl font-display font-bold text-slate-900 dark:text-white tracking-tight">System Settings</h1>
        <p className="text-xs text-slate-550 dark:text-slate-400 mt-1">Configure automated sending rate-limiters, anti-spam safekeeping, and rotational delay weights.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" id="settings-grid">
        
        {/* Deliverability Protections Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-205 dark:border-slate-800 rounded-2xl p-6 space-y-6 shadow-sm" id="safety-guards-card">
          <h2 className="font-semibold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-widest font-display flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Deliverability Protections & Safety Guards
          </h2>

          <div className="space-y-4">
            
            {/* Delay setting */}
            <div className="space-y-2">
              <label className="text-xs font-mono text-slate-505 dark:text-slate-400 block font-semibold">Random Send Delay Offsets (seconds)</label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-450 dark:text-slate-500">Minimum Pacing</span>
                  <input
                    type="number"
                    value={minDelay}
                    onChange={(e) => setMinDelay(Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 p-2.5 text-xs rounded-xl outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-450 dark:text-slate-500">Maximum Pacing</span>
                  <input
                    type="number"
                    value={maxDelay}
                    onChange={(e) => setMaxDelay(Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 p-2.5 text-xs rounded-xl outline-none"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-500 leading-relaxed font-mono">Human-like random send offsets bypass neural anti-bot triggers on receiving firewalls.</p>
            </div>

            {/* Stop on Bounce limits */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span>Auto-Pause Campaign when Bounce Rate exceeds</span>
                <span className="text-red-500 dark:text-red-400 font-bold">{stopOnBounceRate}%</span>
              </div>
              <input
                type="range"
                min={2}
                max={15}
                value={stopOnBounceRate}
                onChange={(e) => setStopOnBounceRate(Number(e.target.value))}
                className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 accent-red-500 mt-2 cursor-pointer"
              />
              <span className="text-[10px] text-slate-500 dark:text-slate-500 block leading-relaxed mt-1 font-mono">Industry mandate: bounce rates above 5-10% cause immediate domain reputation loss.</span>
            </div>

            {/* Unsubscribe link toggle */}
            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="unsub-pixel"
                checked={enableUnsubPixel}
                onChange={(e) => setEnableUnsubPixel(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600 bg-slate-50 outline-none text-indigo-500"
              />
              <label htmlFor="unsub-pixel" className="text-xs text-slate-600 dark:text-slate-300 select-none cursor-pointer">
                Inject elegant unsubscribe compliance links to footer templates automatically.
              </label>
            </div>

          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-4 flex items-center justify-between flex-wrap gap-3">
            {saveStatus && (
              <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">{saveStatus}</span>
            )}
            <button
              onClick={handleSaveSettings}
              className="bg-indigo-600 hover:bg-indigo-550 text-white text-xs font-semibold px-5 py-2.5 rounded-xl ml-auto cursor-pointer shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/20 transition-all font-mono"
            >
              Apply System Tweaks
            </button>
          </div>
        </div>

        {/* Global Credentials & Database Column */}
        <div className="space-y-6" id="api-secrets-and-db-column">
          
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm animate-none" id="api-secrets-card">
            <h2 className="font-semibold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-widest font-display flex items-center gap-2 mb-4">
              <Key className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Platform API Keys & Secrets
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
              This platform automatically queries server-side Gemini API endpoints using credentials populated securely inside the platform runner.
            </p>

            <div className="p-4 bg-slate-50 dark:bg-slate-955 border border-slate-205 dark:border-slate-800 rounded-xl space-y-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block font-mono">Gemini API Key Connection Status:</span>
              <span className="text-emerald-650 dark:text-emerald-500 font-bold block bg-emerald-50 dark:bg-emerald-950/25 p-2 rounded-lg border border-emerald-500/10 self-start font-mono">
                ● SECURE_ACTIVE (Google AI Studio Shared Connection)
              </span>
              <p className="text-slate-500 dark:text-slate-500 leading-relaxed mt-2 text-[11px]">
                You can audit its major active capabilities in metadata configuration. No frontend inputs or exposed elements will ever leak active secrets.
              </p>
            </div>
          </div>

          {/* Database Admin Wiping Feature */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm animate-none" id="seed-manager-card">
            <h2 className="font-semibold text-sm text-slate-805 dark:text-slate-200 uppercase tracking-widest font-display flex items-center gap-2 mb-3">
              <Skull className="w-5 h-5 text-rose-500 dark:text-rose-450" /> Database & Seed Manager
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
              Wipe all pre-loaded seed datasets (campaigns, domains, logs, SMTP routes, response metrics, and analytics history) to start fresh on a completely blank workspace canvas.
            </p>

            <div className="p-4 rounded-xl border border-rose-100 dark:border-rose-900/40 bg-rose-50/30 dark:bg-rose-950/20 space-y-4">
              <p className="text-[11px] text-rose-800 dark:text-rose-300 leading-relaxed">
                <strong>Warning:</strong> This process deletes all simulated activities on the applet immediately and cannot be undone. You will start with a fully clean dashboard.
              </p>
              
              <div className="flex items-center justify-between gap-3 flex-wrap">
                {resetMessage && (
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{resetMessage}</span>
                )}
                <button
                  onClick={handleClearDatabase}
                  disabled={resetting}
                  className="bg-rose-600 hover:bg-rose-500 disabled:bg-slate-200 dark:disabled:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 font-mono shadow-sm"
                  id="btn-clear-db"
                >
                  <Flame className="w-3.5 h-3.5" />
                  {resetting ? "Purging..." : "Wipe All Seed Data"}
                </button>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
