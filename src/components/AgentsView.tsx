/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  Bot,
  Play,
  Sparkles,
  ChevronRight,
  Clock,
  CheckCircle,
  AlertCircle,
  Table,
  UserCheck,
  Code,
  HelpCircle,
  FileText,
  Workflow,
  Search,
  Check
} from "lucide-react";
import { AiAgent, AgentRole, AgentTaskLog } from "../types";

export default function AgentsView() {
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [logs, setLogs] = useState<AgentTaskLog[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AiAgent | null>(null);
  const [taskInput, setTaskInput] = useState("");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ outputText: string; extraActions?: string[] } | null>(null);
  const [errorText, setErrorText] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchAgents();
    fetchLogs();
  }, []);

  const fetchAgents = async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setAgents(data);
      if (data.length > 0) {
        setSelectedAgent(data[0]);
        // Set default cue prompt for first agent
        updateDefaultCue(data[0].role);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/agents/logs");
      const data = await res.json();
      setLogs(data);
    } catch (e) {
      console.error(e);
    }
  };

  const updateDefaultCue = (role: AgentRole) => {
    if (role === AgentRole.LEAD_HUNTER) {
      setTaskInput("Prospect 3 realistic high-value tech leads focused on 'SaaS Automation Solutions' in 'Austin, Texas'. Include their full name, company, email address, and a catchy sales icebreaker!");
    } else if (role === AgentRole.OUTREACH_WRITER) {
      setTaskInput("Construct a 3-step high-converting cold email outreach body template with standard {{firstName}} and {{company}} placeholders. The service is 'Modern Cloud Security Audits' and the target persona is CTOs.");
    } else if (role === AgentRole.INBOX_CLASSIFIER) {
      setTaskInput("Analyze this actual customer reply text: 'Hey, thanks for reaching out. I'm actually not the right person for this, you should email our director of marketing, Sarah at sarah@growthexponent.com. She is interested in email tools.' Classify the sentiment and compile the recommended next-step follow-up message.");
    } else if (role === AgentRole.DELIVERABILITY_SECURE) {
      setTaskInput("Audit the following cold outreach draft for spam-trigger terms, casing errors, link safety, and compliance layout headers: 'DEAR FRIEND!!! CHECK OUT THIS SECRET REVENUE INCREASE OFFER TODAY!! 100% FREE NO RISK CLICK MY BIO LINK INSTANTLY NOW!!!'");
    }
  };

  const handleAgentClick = (agent: AiAgent) => {
    setSelectedAgent(agent);
    setRunResult(null);
    setErrorText("");
    updateDefaultCue(agent.role);
  };

  const handleExecuteAgent = async () => {
    if (!selectedAgent || running || !taskInput.trim()) return;

    setRunning(true);
    setRunResult(null);
    setErrorText("");

    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskInput })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed execution on model.");
      }

      setRunResult({
        outputText: data.outputText,
        extraActions: data.extraActions
      });

      // Refetch stats and log details
      fetchAgents();
      fetchLogs();
    } catch (e: any) {
      setErrorText(e.message || "Execution exception occured.");
    } finally {
      setRunning(false);
    }
  };

  const copyToClipboard = () => {
    if (!runResult) return;
    navigator.clipboard.writeText(runResult.outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 p-8 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto font-sans transition-colors duration-200" id="ai-generator-view-container">
      
      {/* Header Banner */}
      <div className="mb-8" id="agents-header">
        <span className="text-[10px] font-mono text-indigo-650 dark:text-indigo-400 font-bold uppercase tracking-wider">Multi-Agent Sandbox Framework</span>
        <h1 className="text-3xl font-display font-bold text-slate-900 dark:text-white tracking-tight">AI Agent Hub</h1>
        <p className="text-xs text-slate-550 dark:text-slate-400 mt-1">
          Deploy and test specialized sub-agents trained for specific micro-roles. Creating singular, domain-focused agents yields up to 80% higher precision and better results than generic unified AI dispatches.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8" id="agents-layout-grid">
        
        {/* Left Column: List of Configured Sub-Agents */}
        <div className="space-y-4 lg:col-span-1" id="agents-list-panel">
          <h2 className="text-xs uppercase font-mono text-slate-450 dark:text-slate-500 font-bold tracking-wider">Available Specialized Agents</h2>
          
          <div className="space-y-3" id="agent-cards-stack">
            {agents.map((agent) => {
              const isSelected = selectedAgent?.id === agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => handleAgentClick(agent)}
                  className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
                    isSelected
                      ? "bg-white dark:bg-slate-900 border-indigo-600 dark:border-indigo-400 shadow-md shadow-indigo-600/5"
                      : "bg-white dark:bg-slate-900/60 border-slate-200 hover:border-slate-350 dark:border-slate-800 dark:hover:border-slate-700"
                  }`}
                  id={`agent-card-${agent.id}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-lg ${isSelected ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400" : "bg-slate-100 dark:bg-slate-800 text-slate-450"}`}>
                        <Bot className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">{agent.name}</h3>
                        <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest">{agent.role.replace("_", " ")}</span>
                      </div>
                    </div>
                    
                    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${
                      agent.status === "ACTIVE"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 animate-pulse"
                        : agent.status === "ERROR"
                        ? "bg-red-100 text-red-700 dark:bg-red-950/15 dark:text-red-450"
                        : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/15 dark:text-emerald-400"
                    }`}>
                      {agent.status}
                    </span>
                  </div>

                  <p className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-normal line-clamp-2">
                    {agent.description}
                  </p>

                  <div className="border-t border-slate-100 dark:border-slate-800/80 pt-2 mt-1 flex justify-between items-center text-[10px] font-mono text-slate-400">
                    <span>Model: {agent.model}</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">Tasks Run: {agent.taskCount}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quick Informative Guild Banner */}
          <div className="bg-indigo-50/40 dark:bg-indigo-955/10 border border-indigo-100 dark:border-indigo-900/40 p-4 rounded-xl text-xs space-y-2 mt-4">
            <span className="font-semibold text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5 font-mono text-[11px]">
              <Workflow className="w-3.5 h-3.5" /> What makes Agents precise?
            </span>
            <p className="text-slate-550 dark:text-slate-400 text-[10.5px] leading-relaxed">
              Instead of prompting a standard AI with "help me sell", we break the pipeline into <strong>dedicated workers</strong>. When Lead Hunter Pro extracts leads, the platform automatically parses and registers them directly into your database. Copywriter Ninja then crafts tailored messages. This targeted cycle guarantees stellar conversion rates.
            </p>
          </div>
        </div>

        {/* Right Column: Execution Terminal and Active Workspace */}
        <div className="lg:col-span-2 space-y-6" id="agents-execution-workspace">
          
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm" id="terminal-card">
            
            {/* Active agent meta bar */}
            {selectedAgent && (
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4" id="terminal-meta-bar">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold">
                    <Sparkles className="w-4.5 h-4.5 animate-pulse" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Terminal: {selectedAgent.name} Workstation</h2>
                    <p className="text-[10px] text-slate-400 font-mono">Specializing in: {selectedAgent.role.replace("_", " ")}</p>
                  </div>
                </div>
                
                <span className="text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                  Active Sandbox Role
                </span>
              </div>
            )}

            {/* Instruction input area */}
            <div className="space-y-4" id="terminal-input-panel">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-705 dark:text-slate-350">Provide Task Prompt / Instructions</span>
                <button
                  onClick={() => selectedAgent && updateDefaultCue(selectedAgent.role)}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer font-mono font-bold text-[10px]"
                >
                  Reset to recommended cue
                </button>
              </div>

              <textarea
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                rows={4}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs p-3.5 rounded-xl outline-none leading-relaxed font-mono resize-none focus:border-indigo-500"
                placeholder="Instruct your specialized micro-agent..."
              />

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 italic">
                  Powered by Gemini-3.5-flash with real extraction filters.
                </span>
                
                <button
                  onClick={handleExecuteAgent}
                  disabled={running || !taskInput.trim()}
                  className="bg-indigo-600 hover:bg-indigo-550 disabled:bg-slate-200 dark:disabled:bg-slate-800 text-white text-xs font-semibold px-5 py-2.5 rounded-xl flex items-center gap-1.5 transition-all shadow-md shadow-indigo-600/10 cursor-pointer font-mono"
                  id="btn-run-agent"
                >
                  {running ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Executing Agent WorkCycle...
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Execute Agent Instructions
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* ERROR HUD */}
            {errorText && (
              <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl mt-4 flex items-start gap-2.5 text-xs">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-rose-800 dark:text-rose-350 block">Agent Execution Exception</span>
                  <p className="text-rose-700/80 dark:text-rose-400 mt-0.5 leading-relaxed font-mono">{errorText}</p>
                </div>
              </div>
            )}

            {/* RESULTS SCREEN */}
            {runResult && (
              <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-6 space-y-4" id="terminal-results-hud">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold font-mono text-emerald-650 dark:text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" /> Agent Output Received successfully
                  </span>
                  <button
                    onClick={copyToClipboard}
                    className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 flex items-center gap-1 p-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-2.5 py-1 rounded-lg font-mono text-[10px]"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <FileText className="w-3 h-3" />}
                    {copied ? "Copied Output!" : "Copy Output"}
                  </button>
                </div>

                {/* Automation actions notification badge */}
                {runResult.extraActions && runResult.extraActions.length > 0 && (
                  <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-100 dark:border-emerald-900/30 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed font-semibold">
                    {runResult.extraActions.map((act, i) => (
                      <div key={i} className="flex gap-2.5 items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-ping"></span>
                        {act}
                      </div>
                    ))}
                  </div>
                )}

                {/* Dynamic styled terminal output screen */}
                <div className="bg-slate-950 text-slate-100 p-4 rounded-xl border border-slate-800 max-h-96 overflow-y-auto leading-relaxed text-xs font-mono whitespace-pre-wrap selection:bg-indigo-600 mt-2">
                  {runResult.outputText}
                </div>
              </div>
            )}
          </div>

          {/* Historical Logs & Audits Component */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm" id="agent-audit-logs-card">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Execution Analytics & Audit Trail</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">Real-time recording of agent invocations, inputs, and database pipeline side-effects.</p>
            </div>

            {logs.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400 font-mono border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40">
                No sandbox agent logs found. Run an agent from the terminal above.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800" id="logs-history-scroller">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 text-slate-500 font-semibold font-mono border-b border-slate-150">
                      <th className="p-3">Agent</th>
                      <th className="p-3">Timestamp</th>
                      <th className="p-3">Input Action</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {logs.slice(0, 8).map((log) => {
                      const associatedAgent = agents.find(a => a.id === log.agentId);
                      return (
                        <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60 font-mono text-[10.5px]">
                          <td className="p-3 font-semibold text-slate-700 dark:text-slate-350">{associatedAgent?.name || log.agentId}</td>
                          <td className="p-3 text-slate-400">{new Date(log.timestamp).toLocaleTimeString()}</td>
                          <td className="p-3 text-slate-505 truncate max-w-[240px]">{log.input}</td>
                          <td className="p-3">
                            <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${log.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
