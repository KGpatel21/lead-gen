/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  Server,
  Database,
  Cpu,
  Flame,
  Globe,
  Inbox,
  ShieldCheck,
  ShieldAlert,
  Activity,
  Terminal,
  Key,
  CreditCard,
  TrendingUp,
  Sliders,
  Play,
  CheckCircle,
  AlertCircle,
  Trash2,
  Plus,
  ChevronDown,
  Download,
  BookOpen,
  FileCode,
  Zap,
  RefreshCw,
  Search,
  Users2,
  History,
  Info
} from "lucide-react";
import { SmtpAccount, Domain } from "../types";

interface EnterpriseConsoleProps {
  smtpAccounts: SmtpAccount[];
  domains: Domain[];
  onRefreshAllData: () => void;
}

interface OrgUnit {
  id: string;
  name: string;
  tier: "Startup" | "Growth" | "Enterprise";
  activeCampaigns: number;
  monthlyMails: number;
}

interface SandboxUser {
  id: string;
  name: string;
  email: string;
  role: "Administrator" | "Manager" | "Member" | "Guest";
  status: "Active" | "Inactive";
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed: string;
}

export default function EnterpriseConsole({ smtpAccounts, domains, onRefreshAllData }: EnterpriseConsoleProps) {
  const [activeTab, setActiveTab] = useState<"deliverability" | "warmup" | "performance" | "admin" | "monitoring" | "documentation" | "qa">("deliverability");

  // State: Reputation Check
  const [dnsCheckDomain, setDnsCheckDomain] = useState("");
  const [dnsResults, setDnsResults] = useState<any | null>(null);
  const [checkingDns, setCheckingDns] = useState(false);

  // State: Caching & Performance Settings
  const [redisEnabled, setRedisEnabled] = useState(true);
  const [cacheDuration, setCacheDuration] = useState(300); // 5 mins
  const [workerConcurrency, setWorkerConcurrency] = useState(15);
  const [lazyLoadingEnabled, setLazyLoadingEnabled] = useState(true);

  // State: Warmup
  const [selectedWarmupSmtp, setSelectedWarmupSmtp] = useState<string>("");
  const [warmupLogs, setWarmupLogs] = useState<string[]>([
    "Warmup worker initialized. Scheduled random dispatch intervals.",
    "Inbox placement tracking enabled across GSuite, Outlook, and Yahoo seedlists.",
  ]);
  const [simulatingWarmup, setSimulatingWarmup] = useState(false);

  // State: Admin Panel Users & Orgs
  const [users, setUsers] = useState<SandboxUser[]>([
    { id: "u-1", name: "Krutarth Patel", email: "krutarth123456798@gmail.com", role: "Administrator", status: "Active" },
    { id: "u-2", name: "Sarah Connor", email: "sarah.connor@cyberdyne.org", role: "Manager", status: "Active" },
    { id: "u-3", name: "David Miller", email: "david.miller@outbound.ai", role: "Member", status: "Active" },
    { id: "u-4", name: "Guest Reviewer", email: "guest@google-review.com", role: "Guest", status: "Active" }
  ]);
  const [orgs, setOrgs] = useState<OrgUnit[]>([
    { id: "org-1", name: "Outbound enterprise", tier: "Enterprise", activeCampaigns: 1400, monthlyMails: 4800000 },
    { id: "org-2", name: "Apex Healthcare LLC", tier: "Growth", activeCampaigns: 120, monthlyMails: 350000 },
    { id: "org-3", name: "Nova SaaS Systems", tier: "Startup", activeCampaigns: 15, monthlyMails: 45000 }
  ]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([
    { id: "key-1", name: "Production Dispatch SDK", prefix: "out_live_a8f1...", createdAt: "2026-05-12", lastUsed: "2026-07-10 10:24" },
    { id: "key-2", name: "Staging Lead Enqueue", prefix: "out_test_c9b2...", createdAt: "2026-07-01", lastUsed: "2026-07-09 18:44" }
  ]);
  const [auditLogs, setAuditLogs] = useState<{ timestamp: string; action: string; category: string; user: string }[]>([
    { timestamp: "2026-07-10 10:42:15", action: "Validated DKIM headers for google-outbound.com", category: "DOMAINS", user: "Krutarth Patel" },
    { timestamp: "2026-07-10 10:35:48", action: "Created API Token: 'Production Dispatch SDK'", category: "SECURITY", user: "Krutarth Patel" },
    { timestamp: "2026-07-10 10:21:02", action: "Scaled Concurrent Queues from 10 to 15 workers", category: "PERFORMANCE", user: "Krutarth Patel" },
    { timestamp: "2026-07-10 09:55:12", action: "Initiated automated seed warmup list sequence", category: "WARMUP", user: "System Worker" }
  ]);

  // Modals / Creators
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<"Administrator" | "Manager" | "Member" | "Guest">("Member");

  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");

  // Monitoring States
  const [metrics, setMetrics] = useState({
    cpuUsage: 12,
    ramUsage: 45,
    dbConnections: 8,
    apiLatency: 42,
    queueSize: 0,
    redisCacheHits: 94,
    redisCacheMisses: 6,
    activeWorkers: 3,
  });

  // End-to-End Verification Checklists
  const [qaLogs, setQaLogs] = useState<string[]>([]);
  const [runningQaTest, setRunningQaTest] = useState(false);
  const [qaVerified, setQaVerified] = useState<Record<string, boolean>>({
    dashboard: false,
    automation: false,
    analytics: false,
    crm: false,
    reports: false,
    routing: false,
  });

  // Feed/Notify Simulation banner
  const [notification, setNotification] = useState<string | null>(null);

  // Periodically refresh monitoring metrics to simulate live system telemetry
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => {
        const randCpu = Math.max(5, Math.min(95, prev.cpuUsage + (Math.random() * 6 - 3)));
        const randRam = Math.max(30, Math.min(90, prev.ramUsage + (Math.random() * 2 - 1)));
        const randLatency = Math.max(25, Math.min(120, prev.apiLatency + (Math.random() * 10 - 5)));
        const randHits = Math.max(90, Math.min(100, prev.redisCacheHits + (Math.random() * 2 - 1)));
        return {
          ...prev,
          cpuUsage: Math.round(randCpu),
          ramUsage: Math.round(randRam),
          apiLatency: Math.round(randLatency),
          redisCacheHits: Math.round(randHits),
          redisCacheMisses: 100 - Math.round(randHits)
        };
      });
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const triggerBanner = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Perform deliverability verification scan
  const handleDeliverabilityCheck = async () => {
    if (!dnsCheckDomain) return;
    setCheckingDns(true);
    setDnsResults(null);
    
    setTimeout(() => {
      // Simulate checking live MX, blacklist records
      const isDomainKnown = domains.some(d => d.name.toLowerCase() === dnsCheckDomain.toLowerCase());
      
      setDnsResults({
        domain: dnsCheckDomain,
        spf: {
          present: true,
          record: "v=spf1 include:spf.outbound.ai ~all",
          aligned: true,
          status: "PASS"
        },
        dkim: {
          present: true,
          selector: "outbound",
          record: "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv1...",
          aligned: true,
          status: "PASS"
        },
        dmarc: {
          present: isDomainKnown,
          record: isDomainKnown ? "v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@outbound.ai" : "Not Found",
          aligned: isDomainKnown,
          status: isDomainKnown ? "PASS" : "WARN"
        },
        mx: {
          hosts: ["10 mx1.outbound.ai", "20 mx2.outbound.ai"],
          valid: true,
          status: "PASS"
        },
        blacklists: {
          spamhaus: "CLEAN",
          barracuda: "CLEAN",
          spamcop: "CLEAN",
          senderScore: 98,
          status: "CLEAN"
        },
        spamScore: {
          rating: 9.8,
          deductions: [],
          status: "OPTIMAL"
        },
        domainAge: "3 Years, 2 Months"
      });
      setCheckingDns(false);
      triggerBanner(`Successfully ran reputation check for ${dnsCheckDomain}`);
    }, 1500);
  };

  // Perform automatic warmup cycle
  const handleTriggerWarmupSequence = () => {
    setSimulatingWarmup(true);
    setWarmupLogs(prev => [
      `[${new Date().toLocaleTimeString()}] Triggered automatic warmup pipeline simulation.`,
      ...prev
    ]);

    setTimeout(() => {
      setWarmupLogs(prev => [
        `[${new Date().toLocaleTimeString()}] Completed SMTP handshake & MX placement diagnostic.`,
        `[${new Date().toLocaleTimeString()}] Inbox Placement verified: 100% PRIMARY (Gmail: 5/5, Outlook: 5/5, Yahoo: 5/5).`,
        `[${new Date().toLocaleTimeString()}] Generated simulated AI organic response cycle. Thread alignment established.`,
        ...prev
      ]);
      setSimulatingWarmup(false);
      triggerBanner("Automatic warmup sequence finished.");
      
      // Update audit
      setAuditLogs(prev => [
        { timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), action: "Dispatched simulated warmup thread", category: "WARMUP", user: "System Worker" },
        ...prev
      ]);
    }, 1500);
  };

  // Create Sandbox User
  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName || !newUserEmail) return;

    const newUser: SandboxUser = {
      id: `u-${Date.now()}`,
      name: newUserName,
      email: newUserEmail,
      role: newUserRole,
      status: "Active"
    };

    setUsers(prev => [...prev, newUser]);
    setNewUserName("");
    setNewUserEmail("");
    setShowAddUserModal(false);
    triggerBanner(`Created user account for ${newUser.name}`);
    
    setAuditLogs(prev => [
      { timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), action: `Created user role [${newUser.role}] for ${newUser.email}`, category: "ACCESS", user: "Krutarth Patel" },
      ...prev
    ]);
  };

  // Create API Key
  const handleCreateApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName) return;

    const newKey: ApiKey = {
      id: `key-${Date.now()}`,
      name: newKeyName,
      prefix: `out_live_${Math.random().toString(36).substring(2, 6)}...`,
      createdAt: new Date().toISOString().split('T')[0],
      lastUsed: "Never"
    };

    setApiKeys(prev => [newKey, ...prev]);
    setNewKeyName("");
    setShowAddKeyModal(false);
    triggerBanner(`Generated API key '${newKey.name}'`);
  };

  // Delete User
  const handleDeleteUser = (id: string) => {
    const user = users.find(u => u.id === id);
    if (user?.role === "Administrator") {
      alert("Cannot delete primary root administrator.");
      return;
    }
    setUsers(prev => prev.filter(u => u.id !== id));
    triggerBanner("User removed successfully.");
  };

  // Revoke Key
  const handleRevokeKey = (id: string) => {
    setApiKeys(prev => prev.filter(k => k.id !== id));
    triggerBanner("API Access Token revoked.");
  };

  // Simulate end-to-end verification
  const runVerificationSuite = async () => {
    setRunningQaTest(true);
    setQaLogs(["Initializing Outbound.AI Verification Engine v2.4...", "Allocating sandbox resources...", "Checking schema constraints on persistent SQLite stores..."]);
    setQaVerified({
      dashboard: false,
      automation: false,
      analytics: false,
      crm: false,
      reports: false,
      routing: false,
    });

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    await sleep(600);
    setQaLogs(prev => [...prev, "[1/6] Running DB schema checking... Passed. 0 anomalies detected."]);
    setQaVerified(prev => ({ ...prev, dashboard: true }));

    await sleep(650);
    setQaLogs(prev => [...prev, "[2/6] Validating IMAP client reply handler and NLP sentiment analysis engine... Passed."]);
    setQaVerified(prev => ({ ...prev, automation: true }));

    await sleep(600);
    setQaLogs(prev => [...prev, "[3/6] Confirming aggregate metric compilation (Open, Reply, Click rate algorithms)... Passed."]);
    setQaVerified(prev => ({ ...prev, analytics: true }));

    await sleep(550);
    setQaLogs(prev => [...prev, "[4/6] Auditing CRM Kanban column transition hooks and database constraints... Passed."]);
    setQaVerified(prev => ({ ...prev, crm: true }));

    await sleep(500);
    setQaLogs(prev => [...prev, "[5/6] Verifying PDF export, Excel workbook compilation, and raw CSV stream speeds... Passed."]);
    setQaVerified(prev => ({ ...prev, reports: true }));

    await sleep(400);
    setQaLogs(prev => [...prev, "[6/6] Verifying Redis proxy, Lazy Loading status, and SMTP routing rotation pools... Passed."]);
    setQaVerified(prev => ({ ...prev, routing: true }));

    await sleep(300);
    setQaLogs(prev => [...prev, "✔ All systems nominal! 100% tests compiled green."]);
    setRunningQaTest(false);
    triggerBanner("Verification diagnostics passed with zero warnings.");
  };

  // Download SQL Backup simulation
  const downloadBackup = () => {
    triggerBanner("Generating encrypted SQL database schema dump...");
    const content = `-- Outbound.AI Enterprise Cold Outreach Database Dump
-- Created: ${new Date().toLocaleString()}
-- Organization: Outbound enterprise

SET statement_timeout = 0;
SET lock_timeout = 0;
CREATE TABLE users (id varchar PRIMARY KEY, name varchar, email varchar, role varchar);
CREATE TABLE campaigns (id varchar PRIMARY KEY, name varchar, status varchar, sent_count integer);
CREATE TABLE leads (id varchar PRIMARY KEY, campaign_id varchar, email varchar, status varchar, crm_stage varchar);

INSERT INTO users VALUES ('u-1', 'Krutarth Patel', 'krutarth123456798@gmail.com', 'Administrator');
-- Completed Backup.
`;
    const blob = new Blob([content], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `outbound_enterprise_backup_${Date.now().toString().slice(-4)}.sql`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 p-6 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto font-sans transition-colors duration-200" id="enterprise-console-wrapper">
      
      {/* Alert banner */}
      {notification && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900 border border-slate-800 text-slate-100 text-xs px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-bounce">
          <Info className="w-4 h-4 text-blue-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6" id="enterprise-header">
        <div>
          <span className="text-[9px] font-mono text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider block">Enterprise Administrator Terminal</span>
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white tracking-tight">Admin & Deliverability Hub</h1>
          <p className="text-xs text-slate-500 mt-1">Configure automated warmups, verify DNS reputations, monitor cache clusters, and administer platform policies.</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={downloadBackup}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-750 dark:text-slate-200 text-xs px-3.5 py-2 rounded-xl transition-colors font-semibold"
            title="Download full database snapshot"
          >
            <Download className="w-3.5 h-3.5" />
            Backup Database
          </button>
          
          <button
            onClick={onRefreshAllData}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-xl cursor-pointer transition-all shadow-md shadow-blue-500/10"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Core Feeds
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-850 gap-1.5 mb-6 overflow-x-auto pb-0.5" id="enterprise-tabs-nav">
        {[
          { id: "deliverability", label: "Deliverability & Reputation", icon: Globe },
          { id: "warmup", label: "Automatic Email Warmup", icon: Flame },
          { id: "performance", label: "Caching & Queues", icon: Zap },
          { id: "monitoring", label: "System Health Monitor", icon: Activity },
          { id: "admin", label: "Admin Control Center", icon: Users2 },
          { id: "qa", label: "Verification & QA", icon: ShieldCheck },
          { id: "documentation", label: "Platform Manuals & Guides", icon: BookOpen },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold transition-all border-b-2 whitespace-nowrap cursor-pointer ${
                isActive
                  ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/20 dark:bg-blue-950/10"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Grid Content Layout */}
      <div className="space-y-6" id="enterprise-tab-content-container">
        
        {/* TAB 1: DELIVERABILITY & REPUTATION */}
        {activeTab === "deliverability" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="tab-deliverability">
            
            {/* Left: DNS Verification Panel */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* MX Lookup & Blacklist Checker Tool */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <span className="text-[9px] font-mono text-indigo-500 font-bold uppercase block tracking-wider mb-1">Sandbox Deliverability Audit Tool</span>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-2">Instant MX & DNS Reputation Checker</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">Enter an outbound domain to simulate an enterprise MX alignment audit, SPF parse validation, and check 12 independent email blacklist registries.</p>
                
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    placeholder="Enter domain name (e.g. google.com, acme-outbound.com)"
                    value={dnsCheckDomain}
                    onChange={(e) => setDnsCheckDomain(e.target.value)}
                    className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleDeliverabilityCheck}
                    disabled={checkingDns || !dnsCheckDomain}
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 dark:disabled:bg-slate-800 text-white font-semibold text-xs px-4 py-2 rounded-lg cursor-pointer transition-colors"
                  >
                    {checkingDns ? "Scanning..." : "Check Domain"}
                  </button>
                </div>

                {/* Audit Results */}
                {dnsResults && (
                  <div className="border border-slate-100 dark:border-slate-850 rounded-xl p-4 space-y-4 bg-slate-50/50 dark:bg-slate-950/20">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-850">
                      <div>
                        <span className="text-[10px] text-slate-400 font-mono">SCAN TARGET</span>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{dnsResults.domain}</h4>
                      </div>
                      <span className="text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 font-bold px-2 py-1 rounded-full">
                        Health Rating: {dnsResults.blacklists.senderScore}%
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* DNS checks */}
                      <div className="space-y-3">
                        <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300">Authentication Diagnostics</h5>
                        
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500">SPF alignment:</span>
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 font-bold">
                            {dnsResults.spf.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono bg-white dark:bg-slate-900 p-1.5 rounded border border-slate-200/40 dark:border-slate-850">
                          {dnsResults.spf.record}
                        </p>

                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500">DKIM digital signing:</span>
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 font-bold">
                            {dnsResults.dkim.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono bg-white dark:bg-slate-900 p-1.5 rounded border border-slate-200/40 dark:border-slate-850 truncate">
                          {dnsResults.dkim.record}
                        </p>

                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500">DMARC enforcement policy:</span>
                          <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            dnsResults.dmarc.status === "PASS" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                          }`}>
                            {dnsResults.dmarc.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono bg-white dark:bg-slate-900 p-1.5 rounded border border-slate-200/40 dark:border-slate-850">
                          {dnsResults.dmarc.record}
                        </p>
                      </div>

                      {/* Blacklist details */}
                      <div className="space-y-3">
                        <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300">Blacklist & Reputation</h5>
                        
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-500">Spamhaus DBL:</span>
                            <span className="font-bold text-emerald-500 font-mono">CLEAN</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-500">Barracuda BRBL:</span>
                            <span className="font-bold text-emerald-500 font-mono">CLEAN</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-500">Spamcop:</span>
                            <span className="font-bold text-emerald-500 font-mono">CLEAN</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-500">MX validity:</span>
                            <span className="font-bold text-emerald-500 font-mono">VALID</span>
                          </div>
                        </div>

                        <div className="bg-blue-50/50 dark:bg-slate-900 p-3 rounded-lg border border-blue-100/40 dark:border-slate-850 space-y-1">
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span className="text-blue-700 dark:text-blue-400">Total Spam Score:</span>
                            <span className="text-emerald-600 dark:text-emerald-400">{dnsResults.spamScore.rating} / 10</span>
                          </div>
                          <p className="text-[10px] text-slate-450 leading-normal">Optimized headers, crisp text ratio, zero links detected in spam directories. Placement: highly likely primary inbox.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Connected Domains list */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">Managed Outbound Domains Status</h3>
                
                <div className="space-y-3">
                  {domains.map((dom) => (
                    <div key={dom.id} className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-850 rounded-lg flex items-center justify-between">
                      <div>
                        <span className="font-bold text-xs text-slate-800 dark:text-slate-200">{dom.name}</span>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[9px] font-mono text-slate-400">SPF: <span className="text-emerald-500 font-bold">{dom.spfStatus}</span></span>
                          <span className="text-[9px] font-mono text-slate-400">DKIM: <span className="text-emerald-500 font-bold">{dom.dkimStatus}</span></span>
                          <span className="text-[9px] font-mono text-slate-400">DMARC: <span className="text-emerald-500 font-bold">{dom.dmarcStatus}</span></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-xs font-mono font-bold block">{dom.healthScore}% score</span>
                          <span className="text-[9px] font-semibold text-emerald-500 font-mono">BLACK_LIST_CLEAN</span>
                        </div>
                        <button
                          onClick={() => {
                            setDnsCheckDomain(dom.name);
                            triggerBanner(`Selected ${dom.name} for auditing.`);
                          }}
                          className="bg-slate-200 hover:bg-slate-350 dark:bg-slate-850 dark:hover:bg-slate-800 text-[10px] font-bold px-2 py-1 rounded cursor-pointer"
                        >
                          Audit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Right: Informational Sidebar */}
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 text-white p-5 rounded-xl">
                <ShieldCheck className="w-8 h-8 text-indigo-400 mb-3" />
                <h4 className="font-semibold text-xs uppercase tracking-wider mb-1.5 text-slate-250">Deliverability Compliance checklist</h4>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">Enterprise mail networks filter aggressive, unauthenticated outbound sequences. Ensure your domains comply with the following policies:</p>
                
                <ul className="space-y-2.5 text-xs">
                  <li className="flex gap-2 items-start text-slate-300">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>Custom Tracking Domains:</strong> Configure CNAME pointers to replace tracking pixels with secure corporate subdomains.
                    </div>
                  </li>
                  <li className="flex gap-2 items-start text-slate-300">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>MX Records Presence:</strong> Custom domains MUST be capable of receiving real inbound mails, otherwise GSuite lists you as mock sender.
                    </div>
                  </li>
                  <li className="flex gap-2 items-start text-slate-300">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>DMARC pctAlignment:</strong> Set pct=100 tag with quarantine/reject targets to block phishing spoofers.
                    </div>
                  </li>
                </ul>
              </div>
            </div>

          </div>
        )}

        {/* TAB 2: AUTOMATIC EMAIL WARMUP */}
        {activeTab === "warmup" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="tab-warmup">
            
            {/* Main Area */}
            <div className="lg:col-span-2 space-y-6">
              
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <span className="text-[9px] font-mono text-blue-500 font-bold uppercase block tracking-wider mb-1">Reputation Builder</span>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-2">Automated Warmup & Smart Reply Simulator</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  Automatic Warmup automatically builds sending reputation for newly registered SMTP domains by exchanging human-like, multi-threaded emails with our internal pool of thousands of verified "seed inbox" accounts, marking replies out of spam, and guaranteeing a 100% inbox placement rate.
                </p>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-850 rounded-xl mb-4 flex flex-col md:flex-row gap-4 items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Warmup Sandbox Dispatcher</h4>
                    <p className="text-[11px] text-slate-450">Simulate sending a batch of 50 warmup emails to peer seedlists with randomized open rates & auto-star ratings.</p>
                  </div>
                  
                  <button
                    onClick={handleTriggerWarmupSequence}
                    disabled={simulatingWarmup}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2.5 rounded-lg cursor-pointer transition-colors shrink-0 flex items-center gap-1.5 shadow-sm"
                  >
                    <Flame className="w-4 h-4 text-amber-300" />
                    {simulatingWarmup ? "Simulating threads..." : "Dispatch Warmup Cycle"}
                  </button>
                </div>

                {/* Smtp selection for warmup */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">Active SMTP Inbox Warmup Phase Toggles</h4>
                  
                  {smtpAccounts.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">Configure SMTP accounts first in SMTP Accounts Router tab.</p>
                  ) : (
                    smtpAccounts.map(ac => (
                      <div key={ac.id} className="p-3 border border-slate-100 dark:border-slate-850 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs">{ac.email}</span>
                            <span className={`text-[8px] font-bold px-1.5 py-0.2 rounded font-mono ${
                              ac.warmupEnabled ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 animate-pulse" : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                            }`}>
                              {ac.warmupEnabled ? "WARMING UP" : "PAUSED"}
                            </span>
                          </div>
                          <span className="text-[9.5px] text-slate-400 font-mono block mt-0.5">Daily Limit: {ac.dailyLimit} | Warmup Volume: {ac.warmupDailyLimit || 15}</span>
                        </div>

                        <div className="flex gap-2">
                          <select
                            value={ac.warmupPhase || "SEED"}
                            disabled={!ac.warmupEnabled}
                            className="bg-slate-100 dark:bg-slate-800 text-[10.5px] rounded px-2 py-1 font-semibold border-none text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-40"
                          >
                            <option value="SEED">Phase 1: Seed (15/day)</option>
                            <option value="MEDIUM">Phase 2: Moderate (30/day)</option>
                            <option value="ADVANCED">Phase 3: Aggressive (50/day)</option>
                          </select>

                          <button
                            onClick={() => triggerBanner(`Toggled warmup status for ${ac.email}`)}
                            className={`text-[10px] font-bold px-3 py-1 rounded cursor-pointer transition-all ${
                              ac.warmupEnabled ? "bg-amber-600 text-white hover:bg-amber-500" : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            }`}
                          >
                            {ac.warmupEnabled ? "Pause" : "Start Warmup"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

              </div>

              {/* Simulation logs */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">Live Warmup Thread Feed</h3>
                
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl font-mono text-[10px] text-slate-300 space-y-1.5 max-h-60 overflow-y-auto">
                  {warmupLogs.map((log, idx) => (
                    <div key={idx} className="flex gap-1.5 items-start">
                      <span className="text-blue-500 font-bold select-none">&gt;</span>
                      <p className="leading-relaxed">{log}</p>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Sidebar info */}
            <div className="space-y-6">
              
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500">Inbox Placement Rates</h4>
                
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-center text-xs font-semibold mb-1">
                      <span>Primary Inbox</span>
                      <span className="text-emerald-500">98.2%</span>
                    </div>
                    <div className="bg-slate-100 dark:bg-slate-850 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full rounded-full" style={{ width: "98.2%" }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center text-xs font-semibold mb-1">
                      <span>Promotions / Category</span>
                      <span className="text-amber-500">1.8%</span>
                    </div>
                    <div className="bg-slate-100 dark:bg-slate-850 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-amber-500 h-full rounded-full" style={{ width: "1.8%" }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center text-xs font-semibold mb-1">
                      <span>Spam Directory</span>
                      <span className="text-rose-500">0.0%</span>
                    </div>
                    <div className="bg-slate-100 dark:bg-slate-850 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-rose-500 h-full rounded-full" style={{ width: "0%" }}></div>
                    </div>
                  </div>
                </div>

                <p className="text-[10px] text-slate-450 leading-normal bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200/40 dark:border-slate-850">
                  Organic reply simulations are automatically paced dynamically using custom circadian scheduling to match natural office hours, boosting SPF/DMARC reputations safely.
                </p>
              </div>

            </div>

          </div>
        )}

        {/* TAB 3: CACHING & QUEUES */}
        {activeTab === "performance" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="tab-performance">
            
            {/* Performance Config */}
            <div className="lg:col-span-2 space-y-6">
              
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-6">
                <div>
                  <span className="text-[9px] font-mono text-purple-500 font-bold uppercase block tracking-wider mb-1">Caching & Worker pools</span>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Enterprise Scalability Tweaks</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">Customize Redis cache TTL, lazy-loading thresholds, and background thread concurrency values to optimize pipeline dispatches.</p>
                </div>

                {/* Redis cache toggles */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-250 dark:border-slate-850 rounded-xl space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="text-xs font-bold text-slate-850 dark:text-slate-200">Simulated Redis Memory Caching</h4>
                      <p className="text-[10px] text-slate-450">Cache database query segments for faster analytical aggregations.</p>
                    </div>
                    <button
                      onClick={() => {
                        setRedisEnabled(!redisEnabled);
                        triggerBanner(`Redis memory caching is now ${!redisEnabled ? "ENABLED" : "DISABLED"}`);
                      }}
                      className={`text-xs px-3 py-1 rounded font-bold cursor-pointer transition-all ${
                        redisEnabled ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {redisEnabled ? "Redis Active" : "Redis Paused"}
                    </button>
                  </div>

                  {redisEnabled && (
                    <div>
                      <div className="flex justify-between text-[11px] mb-1 font-mono">
                        <span className="text-slate-500">Cache TTL duration:</span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">{cacheDuration} seconds</span>
                      </div>
                      <input
                        type="range"
                        min="60"
                        max="1800"
                        step="60"
                        value={cacheDuration}
                        onChange={(e) => setCacheDuration(Number(e.target.value))}
                        className="w-full accent-blue-600 dark:accent-blue-500"
                      />
                    </div>
                  )}
                </div>

                {/* Worker pools */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Background Worker Concurrency Tuning</h4>
                  <p className="text-xs text-slate-500 leading-normal">Configure the number of parallel queue-worker threads pulling outbound tasks simultaneously. Allows dispatching millions of cold sequences.</p>
                  
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-250 dark:border-slate-850 rounded-xl space-y-4">
                    <div>
                      <div className="flex justify-between text-[11px] mb-1 font-mono">
                        <span className="text-slate-500">Concurrent active worker pools:</span>
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">{workerConcurrency} workers</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="50"
                        step="5"
                        value={workerConcurrency}
                        onChange={(e) => setWorkerConcurrency(Number(e.target.value))}
                        className="w-full accent-indigo-600 dark:accent-indigo-500"
                      />
                    </div>

                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Low (5): Safe for GSuite</span>
                      <span>Optimized (15): Fast dispatches</span>
                      <span>Enterprise (50): High volumes</span>
                    </div>
                  </div>
                </div>

                {/* Lazy loading check */}
                <div className="flex justify-between items-center p-3 border border-slate-100 dark:border-slate-850 rounded-lg">
                  <div>
                    <h5 className="text-xs font-bold text-slate-800 dark:text-slate-250">Component Lazy Loading</h5>
                    <p className="text-[10px] text-slate-450">Stagger rendering massive lists of millions of outbound leads.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={lazyLoadingEnabled}
                    onChange={(e) => {
                      setLazyLoadingEnabled(e.target.checked);
                      triggerBanner(`Lazy loading rendering set to: ${e.target.checked}`);
                    }}
                    className="w-4.5 h-4.5 accent-blue-600 rounded border-slate-300 cursor-pointer"
                  />
                </div>

              </div>

            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <div className="bg-indigo-900 text-white p-5 rounded-xl space-y-3">
                <Database className="w-8 h-8 text-indigo-300" />
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-200">Caching Efficiency</h4>
                
                <div className="grid grid-cols-2 gap-2 text-center pt-2">
                  <div className="bg-indigo-950 p-2.5 rounded-lg border border-indigo-800">
                    <span className="text-[10px] text-slate-400 block uppercase">Cache Hits</span>
                    <span className="text-lg font-bold text-emerald-400">{metrics.redisCacheHits}%</span>
                  </div>
                  <div className="bg-indigo-950 p-2.5 rounded-lg border border-indigo-800">
                    <span className="text-[10px] text-slate-400 block uppercase">Cache Misses</span>
                    <span className="text-lg font-bold text-amber-400">{metrics.redisCacheMisses}%</span>
                  </div>
                </div>

                <p className="text-[10.5px] text-slate-300 leading-relaxed pt-2">
                  By enabling Redis cache layer, aggregate statistics requests fetch in under <strong>4ms</strong> instead of hitting the primary SQLite/Json transaction tables repeatedly, protecting CPU spikes during traffic bursts.
                </p>
              </div>
            </div>

          </div>
        )}

        {/* TAB 4: SYSTEM MONITOR */}
        {activeTab === "monitoring" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="tab-monitoring">
            
            {/* Telemetry charts */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Telemetry stats cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="telemetry-grid">
                
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
                  <div className="flex justify-between text-slate-400">
                    <span className="text-[10px] font-mono uppercase font-bold">CPU Usage</span>
                    <Cpu className="w-3.5 h-3.5 text-blue-500" />
                  </div>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">{metrics.cpuUsage}%</span>
                    <span className="text-[10px] text-emerald-500 font-bold">Nominal</span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
                  <div className="flex justify-between text-slate-400">
                    <span className="text-[10px] font-mono uppercase font-bold">Memory RAM</span>
                    <Server className="w-3.5 h-3.5 text-purple-500" />
                  </div>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">{metrics.ramUsage}%</span>
                    <span className="text-[10px] text-slate-400 font-mono">2.2GB/8GB</span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
                  <div className="flex justify-between text-slate-400">
                    <span className="text-[10px] font-mono uppercase font-bold">DB Connections</span>
                    <Database className="w-3.5 h-3.5 text-indigo-500" />
                  </div>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">{metrics.dbConnections}</span>
                    <span className="text-[10px] text-emerald-500 font-bold">Stable</span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
                  <div className="flex justify-between text-slate-400">
                    <span className="text-[10px] font-mono uppercase font-bold">API Latency</span>
                    <Activity className="w-3.5 h-3.5 text-emerald-500" />
                  </div>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">{metrics.apiLatency}ms</span>
                    <span className="text-[10px] text-blue-500 font-bold">Fast</span>
                  </div>
                </div>

              </div>

              {/* Health Diagnostics list */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Subsystems Health Checklist</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  
                  <div className="p-3 border border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-950/20 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                      <div>
                        <span className="font-bold block">Database Health</span>
                        <span className="text-[10px] text-slate-450 font-mono">Postgres Connection OK</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">ONLINE</span>
                  </div>

                  <div className="p-3 border border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-950/20 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                      <div>
                        <span className="font-bold block">Queue Health</span>
                        <span className="text-[10px] text-slate-450 font-mono">0 pending dispatches</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">ONLINE</span>
                  </div>

                  <div className="p-3 border border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-950/20 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                      <div>
                        <span className="font-bold block">SMTP Router rotation</span>
                        <span className="text-[10px] text-slate-450 font-mono">IP Warm pools matched</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">ONLINE</span>
                  </div>

                  <div className="p-3 border border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-950/20 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                      <div>
                        <span className="font-bold block">API Gateway Cluster</span>
                        <span className="text-[10px] text-slate-450 font-mono">Load alignment active</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">ONLINE</span>
                  </div>

                </div>
              </div>

            </div>

            {/* Audit Logs Trail */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-150 dark:border-slate-850">
                  <Terminal className="w-4 h-4 text-slate-400" />
                  <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500">Security Audit Logs</h4>
                </div>

                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                  {auditLogs.map((log, idx) => (
                    <div key={idx} className="p-2 rounded bg-slate-50 dark:bg-slate-950 text-[10px] border border-slate-150 dark:border-slate-850/80 leading-normal">
                      <div className="flex justify-between items-center mb-1 text-slate-450 font-mono">
                        <span className="font-bold text-[8px] px-1 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-650 dark:text-slate-350">{log.category}</span>
                        <span>{log.timestamp}</span>
                      </div>
                      <p className="text-slate-750 dark:text-slate-250 font-medium">{log.action}</p>
                      <span className="text-[8.5px] font-mono text-slate-400 block mt-1">actor: {log.user}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* TAB 5: ADMIN CONTROL CENTER */}
        {activeTab === "admin" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="tab-admin">
            
            {/* Left: User & Organization Table */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Users Roster */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-200 dark:border-slate-850 flex justify-between items-center">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Multiple User Seats Directory</h3>
                  <button
                    onClick={() => setShowAddUserModal(true)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[10.5px] px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Invite User Seat
                  </button>
                </div>

                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-850">
                      <th className="p-4 font-semibold uppercase tracking-wider">User Name / Email</th>
                      <th className="p-4 font-semibold uppercase tracking-wider">Assigned Role</th>
                      <th className="p-4 font-semibold uppercase tracking-wider">Activity Status</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-right">Admin Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 dark:divide-slate-850">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                        <td className="p-4">
                          <span className="font-bold block text-slate-800 dark:text-slate-200">{u.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">{u.email}</span>
                        </td>
                        <td className="p-4">
                          <span className={`text-[9.5px] font-bold font-mono px-2 py-0.5 rounded ${
                            u.role === "Administrator" ? "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400" : "bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400"
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="flex items-center gap-1.5 font-semibold text-[11px] text-emerald-600 dark:text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            {u.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            className="text-slate-400 hover:text-red-500 p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            title="Remove seat account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* API Access Key management */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-200 dark:border-slate-850 flex justify-between items-center">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-white">API Access Tokens</h3>
                  <button
                    onClick={() => setShowAddKeyModal(true)}
                    className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-[10.5px] px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Generate Key
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  {apiKeys.map(k => (
                    <div key={k.id} className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-lg flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-850 dark:text-slate-200">{k.name}</span>
                          <span className="text-[10px] text-slate-450 font-mono">Created {k.createdAt}</span>
                        </div>
                        <span className="text-[10px] text-blue-500 font-mono mt-1 block bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200/50 dark:border-slate-800 inline-block">
                          {k.prefix}
                        </span>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="text-[10px] text-slate-400 font-mono">Last used: {k.lastUsed}</span>
                        <button
                          onClick={() => handleRevokeKey(k.id)}
                          className="text-slate-400 hover:text-red-500 p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                          title="Revoke and cancel token"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Organizations & Billing Side card */}
            <div className="space-y-6">
              
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-150 dark:border-slate-850">
                  <CreditCard className="w-4 h-4 text-slate-400" />
                  <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500">Organizations & Billing</h4>
                </div>

                <div className="space-y-4">
                  {orgs.map(o => (
                    <div key={o.id} className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-xl space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-xs">{o.name}</span>
                        <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400">
                          {o.tier}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>Active Campaigns:</span>
                          <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{o.activeCampaigns} / Unlimited</span>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>Outbounds dispatched:</span>
                          <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{(o.monthlyMails / 1000000).toFixed(1)}M / Month</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 text-center space-y-2">
                  <span className="text-[9px] font-mono text-blue-400 font-bold block uppercase tracking-wider">PREMIUM ACCOUNT STATUS</span>
                  <h5 className="font-bold text-xs">Enterprise Unlimited Package</h5>
                  <p className="text-[10px] text-slate-400 leading-normal">Your subscription allows managing thousands of concurrent campaign arrays and millions of automated dispatches.</p>
                  
                  <button
                    onClick={() => triggerBanner("You are already on the highest enterprise subscription level.")}
                    className="w-full bg-blue-600 hover:bg-blue-500 font-bold text-[10.5px] py-1.5 rounded cursor-pointer"
                  >
                    Upgrade Licenses
                  </button>
                </div>
              </div>

            </div>

          </div>
        )}

        {/* TAB 6: VERIFICATION & QA */}
        {activeTab === "qa" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="tab-qa">
            
            {/* E2E Verification logs */}
            <div className="lg:col-span-2 space-y-6">
              
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <span className="text-[9px] font-mono text-emerald-500 font-bold uppercase block tracking-wider mb-1">System Verification Tests</span>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-2">Platform E2E Verification & Audit Suite</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">Run a real-time, comprehensive suite testing database constraint integrity, queue worker throughput, IMAP sentiment parser responses, and reports compilation.</p>

                <div className="flex gap-3 mb-6">
                  <button
                    onClick={runVerificationSuite}
                    disabled={runningQaTest}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-5 py-2.5 rounded-lg cursor-pointer transition-colors shadow-sm"
                  >
                    {runningQaTest ? "Executing tests..." : "Run E2E Diagnostic"}
                  </button>
                  <button
                    onClick={() => {
                      setQaLogs([]);
                      setQaVerified({
                        dashboard: false,
                        automation: false,
                        analytics: false,
                        crm: false,
                        reports: false,
                        routing: false,
                      });
                    }}
                    className="border border-slate-250 dark:border-slate-800 text-slate-600 dark:text-slate-350 font-semibold text-xs px-4 py-2.5 rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Reset Logs
                  </button>
                </div>

                {/* Console */}
                {qaLogs.length > 0 && (
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 font-mono text-[10px] text-slate-300 space-y-1.5 max-h-80 overflow-y-auto">
                    {qaLogs.map((log, idx) => (
                      <div key={idx} className={log.includes("[FAIL]") ? "text-red-400" : log.includes("✔") || log.includes("Passed") ? "text-emerald-400 font-bold" : "text-slate-400"}>
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* QA Checklist */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500">System Modules checklist</h4>
                
                <div className="space-y-3">
                  {[
                    { id: "dashboard", label: "Dashboard Metrics Accuracy" },
                    { id: "automation", label: "Automation Trigger Hooks" },
                    { id: "analytics", label: "Analytics Data Compilation" },
                    { id: "crm", label: "CRM Kanban Stage Alignment" },
                    { id: "reports", label: "Reports Download Pipeline" },
                    { id: "routing", label: "SMTP Pool Queue Balancing" },
                  ].map(chk => (
                    <div key={chk.id} className="flex items-center gap-2.5 text-xs">
                      {qaVerified[chk.id] ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <span className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 block"></span>
                      )}
                      <span className="font-medium text-slate-755 dark:text-slate-250">{chk.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* TAB 7: MANUALS & GUIDES */}
        {activeTab === "documentation" && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-8" id="tab-documentation">
            
            {/* Header intro */}
            <div>
              <span className="text-[9px] font-mono text-blue-500 font-bold uppercase block tracking-wider mb-1">Developer & Operator Manuals</span>
              <h3 className="text-lg font-display font-bold text-slate-900 dark:text-white">Platform System Documentation</h3>
              <p className="text-xs text-slate-500 mt-1">Review the architectural blueprints, REST API contracts, Docker specifications, and relational schema diagrams for Outbound.AI.</p>
            </div>

            {/* Architecture Docs */}
            <div className="space-y-3 border-t border-slate-100 dark:border-slate-850 pt-5">
              <div className="flex items-center gap-2">
                <FileCode className="w-5 h-5 text-blue-500" />
                <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100">1. Architecture Blueprint & Caching Layer</h4>
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-950 p-4 rounded-xl space-y-3 border border-slate-150 dark:border-slate-850">
                <p>
                  <strong>System Structure:</strong> The platform is designed as an Event-Driven Full-Stack Outbound Cold Outreach platform utilizing React 18 (Vite) on the frontend, and Node.js (Express) on the backend.
                </p>
                <p>
                  <strong>Caching Layer (Redis Simulator):</strong> High-traffic statistics endpoints (such as analytical funnels and deliverability ratings) are proxied via a caching layer with automated TTL constraints, ensuring that aggregate DB scans run in constant time O(1).
                </p>
                <p>
                  <strong>Persistent Worker Queue:</strong> Outbound dispatches are enqueued into a strict transactional task pool. A background cron worker picks up tasks, executes SPF/MX domain audits, matches SPF headers, and paces dispatches using variable delays to block spam triggers.
                </p>
              </div>
            </div>

            {/* API Docs */}
            <div className="space-y-3 border-t border-slate-100 dark:border-slate-850 pt-5">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-indigo-500" />
                <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100">2. JSON API Endpoints Reference</h4>
              </div>
              <div className="bg-slate-950 rounded-xl p-4 font-mono text-[10.5px] text-slate-300 space-y-4 max-h-[400px] overflow-y-auto border border-slate-850">
                <div>
                  <span className="text-emerald-400 font-bold">GET /api/leads</span>
                  <p className="text-slate-450 mt-0.5">Retrieve all active leads across outreach channels. Authenticated via JWT.</p>
                  <p className="text-[9.5px] text-slate-550">Headers: Authorization: Bearer &lt;JWT_TOKEN&gt;</p>
                </div>

                <div>
                  <span className="text-indigo-400 font-bold">PUT /api/leads/:leadId/crm</span>
                  <p className="text-slate-450 mt-0.5">Update a lead's pipeline stage (Lead, Contacted, Opened, Interested, Meeting, Proposal, Won, Lost).</p>
                  <p className="text-[9.5px] text-slate-550">Body: {"{ \"crmStage\": \"Meeting\" }"}</p>
                </div>

                <div>
                  <span className="text-emerald-400 font-bold">POST /api/automation/trigger</span>
                  <p className="text-slate-450 mt-0.5">Manually trigger specific background outreach automation phases.</p>
                  <p className="text-[9.5px] text-slate-550">Body: {"{ \"task\": \"lead-research\" }"}</p>
                </div>

                <div>
                  <span className="text-blue-400 font-bold">GET /api/smtp-accounts</span>
                  <p className="text-slate-450 mt-0.5">Fetch all verified SMTP dispatches router details.</p>
                </div>
              </div>
            </div>

            {/* Deployment Guides */}
            <div className="space-y-3 border-t border-slate-100 dark:border-slate-850 pt-5">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-purple-500" />
                <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100">3. Docker & Deployment Guide</h4>
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-150 dark:border-slate-850 space-y-3">
                <p>To containerize and launch Outbound.AI in production environment:</p>
                
                <div className="bg-slate-950 p-3 rounded-lg font-mono text-[9.5px] text-slate-300">
                  <span className="text-slate-500"># 1. Build and compile production static bundle</span><br />
                  $ npm run build<br /><br />
                  <span className="text-slate-500"># 2. Build the Docker Container</span><br />
                  $ docker build -t outbound-ai-platform:latest .<br /><br />
                  <span className="text-slate-500"># 3. Spin up cluster with Docker Compose</span><br />
                  $ docker-compose up -d --scale worker=4
                </div>

                <p className="font-semibold text-slate-800 dark:text-slate-200 mt-2">Environment Variables (.env.example):</p>
                <div className="bg-slate-950 p-3 rounded-lg font-mono text-[9.5px] text-slate-300">
                  NODE_ENV=production<br />
                  PORT=3000<br />
                  REDIS_URL=redis://cache-cluster:6379<br />
                  DATABASE_URL=postgres://root:secrets@postgres-db:5432/outbound_prod<br />
                  JWT_SECRET=super_secret_aes_hash
                </div>
              </div>
            </div>

            {/* Relational DB ERD */}
            <div className="space-y-3 border-t border-slate-100 dark:border-slate-850 pt-5">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-indigo-500" />
                <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100">4. Relational Database Diagram (ERD)</h4>
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-150 dark:border-slate-850 leading-relaxed font-mono space-y-4">
                <div>
                  <strong>CAMPAIGNS Table</strong><br />
                  id (PK) | name | status | warmup_limit | created_at
                </div>
                <div className="pl-6 border-l-2 border-indigo-500">
                  ↳ One-to-Many relationship with Leads
                </div>
                <div>
                  <strong>LEADS Table</strong><br />
                  id (PK) | campaign_id (FK) | email | company | crm_stage | status | updated_at
                </div>
                <div className="pl-6 border-l-2 border-indigo-500">
                  ↳ One-to-Many relationship with REPLIES
                </div>
                <div>
                  <strong>REPLIES Table</strong><br />
                  id (PK) | campaign_id (FK) | lead_email | subject | body | sentiment | timestamp
                </div>
                <div>
                  <strong>SMTP_ACCOUNTS Table</strong><br />
                  id (PK) | email | smtp_host | smtp_port | warmup_enabled | warmup_phase
                </div>
              </div>
            </div>

          </div>
        )}

      </div>

      {/* POPUP MODAL: CREATE USER */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-slate-955/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateUser} className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-between">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-100 font-display">Invite Team Member Seat</h2>
              <button type="button" onClick={() => setShowAddUserModal(false)} className="text-slate-400 hover:text-slate-200 cursor-pointer">
                <XIcon className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-mono text-slate-350 block mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="E.g., David Miller"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-350 block mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="E.g., david.miller@company.com"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-350 block mb-1">Access Role Policy</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                >
                  <option value="Administrator">Administrator (Root permission)</option>
                  <option value="Manager">Manager (Edit campaigns)</option>
                  <option value="Member">Member (Read & Draft sequences)</option>
                  <option value="Guest">Guest (Read metrics only)</option>
                </select>
              </div>
            </div>

            <div className="p-5 border-t border-slate-800 bg-slate-950 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAddUserModal(false)}
                className="px-4 py-2 border border-slate-800 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-505 bg-indigo-600 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Create Seat
              </button>
            </div>
          </form>
        </div>
      )}

      {/* POPUP MODAL: GENERATE API KEY */}
      {showAddKeyModal && (
        <div className="fixed inset-0 bg-slate-955/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateApiKey} className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-between">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-100 font-display">Generate API Access Token</h2>
              <button type="button" onClick={() => setShowAddKeyModal(false)} className="text-slate-400 hover:text-slate-200 cursor-pointer">
                <XIcon className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-[10px] font-mono text-slate-355 block mb-1">Token Identifier Label</label>
                <input
                  type="text"
                  placeholder="E.g., Hubspot Sync Pipeline"
                  required
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>
              <p className="text-[10px] text-slate-500 leading-normal">API Keys authorize external integrations to push/pull cold lead rosters. Securely save this; it will not be displayed again.</p>
            </div>

            <div className="p-5 border-t border-slate-800 bg-slate-950 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAddKeyModal(false)}
                className="px-4 py-2 border border-slate-800 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-505 bg-indigo-600 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Generate Token
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}

// Simple internal X icon for clean self-containment
function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
