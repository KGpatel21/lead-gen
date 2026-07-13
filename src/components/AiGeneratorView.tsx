/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Bot,
  Sparkles,
  RefreshCw,
  Copy,
  BookOpen,
  CheckCircle,
  FileText,
  AlertTriangle
} from "lucide-react";

interface AiGeneratorViewProps {
  onSaveTemplate: (name: string, subject: string, body: string, category: string) => Promise<any>;
}

export default function AiGeneratorView({ onSaveTemplate }: AiGeneratorViewProps) {
  const [compDesc, setCompDesc] = useState("We build high-capacity edge proxies for software engineers.");
  const [valueProp, setValueProp] = useState("Our system reduces API response latency times by up to 35% under maximum server load conditions.");
  const [tone, setTone] = useState("casual");

  // Output States
  const [loading, setLoading] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  
  // Statuses
  const [savedStatus, setSavedStatus] = useState("");

  const handleGenerateOutbound = async () => {
    setLoading(true);
    setSavedStatus("");
    try {
      const res = await fetch("/api/ai/generate-campaign-pitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyDescription: compDesc,
          valueProposition: valueProp,
          tone,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubject(data.subjectTemplate || "");
        setBody(data.bodyTemplate || "");
      } else {
        alert(data.error || "Generation faulted");
      }
    } catch (err) {
      console.error(err);
      alert("Error reaching copywriting sub-engines.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyNewTemplate = async () => {
    if (!subject || !body) return;
    try {
      await onSaveTemplate(
        `AI Generated ${tone.toUpperCase()}`,
        subject,
        body,
        "AI Copywriter"
      );
      setSavedStatus("✔ Custom draft added to reusable templates list!");
    } catch (err) {
      console.error(err);
    }
  };  return (
    <div className="flex-1 p-8 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto font-sans transition-colors duration-200" id="ai-generator-wrapper">
      
      <div className="mb-8" id="generator-header">
        <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider">AI Copilot Creative Studio</span>
        <h1 className="text-3xl font-display font-semibold text-slate-900 dark:text-white tracking-tight">AI Outbound Copywriter</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Leverage Gemini API to compose highly resonant B2B sequences using precise customizable tones.</p>
      </div>

      {/* Main Grid Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" id="generator-split-view">
        
        {/* Left Column: Form Guidelines */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 shadow-sm" id="guidelines-form">
          <h2 className="font-semibold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-widest font-display flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500 dark:text-indigo-400 animate-spin" /> Outreach Modeling Objectives
          </h2>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-mono text-slate-500 dark:text-slate-400 block mb-1">Company / Product / Service Profile</label>
              <textarea
                rows={3}
                value={compDesc}
                onChange={(e) => setCompDesc(e.target.value)}
                placeholder="What does your company provide of maximum value?"
                className="w-full text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-indigo-500 text-slate-800 dark:text-slate-200"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-slate-500 dark:text-slate-400 block mb-1">Core Unique Value Proposition</label>
              <textarea
                rows={3}
                value={valueProp}
                onChange={(e) => setValueProp(e.target.value)}
                placeholder="Detail precise quantitative highlights of your product."
                className="w-full text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none focus:border-indigo-500 text-slate-800 dark:text-slate-200"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono text-slate-500 dark:text-slate-400 block mb-1">Outbound Tone Guide</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 outline-none text-slate-800 dark:text-slate-200 focus:border-indigo-500"
                >
                  <option value="casual">Casual Outbound (Human-to-Human)</option>
                  <option value="professional">Professional Outbound (Enterprise Sales)</option>
                  <option value="friendly">Friendly Academic Outbound (Problem-Centered)</option>
                  <option value="direct sales">Direct Outbound (Low-friction pitch)</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={handleGenerateOutbound}
                  disabled={loading || !compDesc || !valueProp}
                  className="w-full h-11 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 dark:disabled:bg-slate-900 text-white disabled:text-slate-400 dark:disabled:text-slate-600 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all shadow-lg shadow-indigo-600/15"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-slate-400 dark:text-slate-300" />
                      Modeling copy...
                    </>
                  ) : (
                    <>
                      <Bot className="w-4 h-4" />
                      Create Outbound Campaign Draft
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: AI Generated Outputs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-sm" id="ai-copywriter-outputs">
          <div>
            <h2 className="font-semibold text-sm text-slate-800 dark:text-slate-200 mb-4 uppercase tracking-wider font-display">AI Generated Outbound Copy</h2>
            
            {subject || body ? (
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-850 rounded-xl">
                  <span className="text-[10px] font-mono text-slate-450 dark:text-slate-500 block uppercase mb-1">Subject:</span>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{subject}</p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-850 rounded-xl max-h-80 overflow-y-auto">
                  <span className="text-[10px] font-mono text-slate-450 dark:text-slate-500 block uppercase mb-1">Body paragraph outline:</span>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-mono whitespace-pre-wrap">{body}</p>
                </div>

                {savedStatus && (
                  <div className="p-3 bg-emerald-100 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs rounded-xl">
                    {savedStatus}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-center">
                <Bot className="w-12 h-12 opacity-35 text-indigo-550 mb-2 animate-pulse" />
                <p className="text-xs max-w-sm">Define objectives click on 'Create Outbound Campaign Draft' on the side. Gemini will write compliance-safe, high-converting, localized pitches.</p>
              </div>
            )}
          </div>

          {(subject || body) && (
            <div className="border-t border-slate-100 dark:border-slate-900 pt-4 mt-4 flex gap-3">
              <button
                onClick={handleCopyNewTemplate}
                className="w-full bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-indigo-650 dark:text-indigo-400 text-xs font-semibold py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all"
              >
                <BookOpen className="w-4 h-4" /> Save Pitch to Templates Library
              </button>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
