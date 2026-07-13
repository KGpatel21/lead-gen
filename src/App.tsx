/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import DashboardView from "./components/DashboardView";
import CampaignsView from "./components/CampaignsView";
import InboxesView from "./components/InboxesView";
import DomainsView from "./components/DomainsView";
import RepliesView from "./components/RepliesView";
import AiGeneratorView from "./components/AiGeneratorView";
import TeamView from "./components/TeamView";
import SettingsView from "./components/SettingsView";
import AgentsView from "./components/AgentsView";
import AutopilotConsole from "./components/AutopilotConsole";
import AiLeadFinderView from "./components/AiLeadFinderView";
import CrmBoardView from "./components/CrmBoardView";
import EnterpriseConsole from "./components/EnterpriseConsole";

import {
  Campaign,
  CampaignStatus,
  Lead,
  SmtpAccount,
  Domain,
  Reply,
  TeamMember,
  SecurityRole
} from "./types";

export default function App() {
  const [currentView, setView] = useState("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("preferred-theme");
    return saved === "dark" || saved === "light" ? saved : "light";
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("preferred-theme", theme);
  }, [theme]);

  // Primary platform states synced from server JSON DB
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [smtpAccounts, setSmtpAccounts] = useState<SmtpAccount[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // Detailed dashboard stats block
  const [stats, setStats] = useState({
    totalSent: 0,
    avgOpenRate: 0,
    avgReplyRate: 0,
    avgBounceRate: 0,
    activeCampaignsCount: 0,
    avgReputation: 100,
    avgDomainHealth: 100,
    recentReplies: [] as Reply[],
    timeline: {
      sentOverTime: [] as { date: string; sent: number; opens: number; replies: number }[],
      domainReputationTrend: [] as { date: string; avgScore: number }[],
      warmupTrend: [] as { date: string; sent: number; recovered: number }[],
      repliesSentimentBreakdown: [] as { name: string; value: number; color: string }[]
    }
  });

  // Load all foundational tables on mount
  useEffect(() => {
    fetchAllSaaSData();

    // Setup progressive data reload ticker to catch background simulated dispatches
    const ticker = setInterval(() => {
      fetchStatsAndCampaigns();
    }, 8000);

    return () => clearInterval(ticker);
  }, []);

  const [isServerOnline, setIsServerOnline] = useState(true);

  const safeJsonFetch = async (url: string, options?: RequestInit) => {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Received non-JSON response from server.");
      }
      return await res.json();
    } catch (err: any) {
      console.warn(`Fetch error for ${url}:`, err.message || err);
      throw err;
    }
  };

  const fetchAllSaaSData = async () => {
    try {
      await Promise.all([
        fetchStats().catch(err => console.error("Stats fetch failed:", err)),
        fetchCampaigns().catch(err => console.error("Campaigns fetch failed:", err)),
        fetchSmtp().catch(err => console.error("SMTP accounts fetch failed:", err)),
        fetchDomains().catch(err => console.error("Domains fetch failed:", err)),
        fetchReplies().catch(err => console.error("Replies fetch failed:", err)),
        fetchTeam().catch(err => console.error("Team fetch failed:", err))
      ]);
      setIsServerOnline(true);
    } catch (err) {
      console.error("Critical initial sync failed:", err);
      setIsServerOnline(false);
    }
  };

  const fetchStatsAndCampaigns = async () => {
    try {
      await Promise.all([
        fetchStats(),
        fetchCampaigns(),
        fetchReplies()
      ]);
      setIsServerOnline(true);
    } catch (err) {
      console.warn("Background auto-refresh failed (server may be offline):", err);
    }
  };

  // REST API calls
  const fetchStats = async () => {
    const data = await safeJsonFetch("/api/dashboard/stats");
    if (data) setStats(data);
  };

  const fetchCampaigns = async () => {
    const res = await safeJsonFetch("/api/campaigns");
    if (res) {
      if (res.success && Array.isArray(res.data)) {
        setCampaigns(res.data);
      } else if (Array.isArray(res)) {
        setCampaigns(res);
      } else if (res.data && Array.isArray(res.data)) {
        setCampaigns(res.data);
      }
    }
  };

  const fetchSmtp = async () => {
    const data = await safeJsonFetch("/api/smtp-accounts");
    if (data) {
      if (Array.isArray(data)) {
        setSmtpAccounts(data);
      } else if (data.success && Array.isArray(data.data)) {
        setSmtpAccounts(data.data);
      } else if (Array.isArray(data.data)) {
        setSmtpAccounts(data.data);
      }
    }
  };

  const fetchDomains = async () => {
    const data = await safeJsonFetch("/api/domains");
    if (data) {
      if (Array.isArray(data)) {
        setDomains(data);
      } else if (data.success && Array.isArray(data.data)) {
        setDomains(data.data);
      } else if (Array.isArray(data.data)) {
        setDomains(data.data);
      }
    }
  };

  const fetchReplies = async () => {
    const data = await safeJsonFetch("/api/replies");
    if (data) {
      if (Array.isArray(data)) {
        setReplies(data);
      } else if (data.success && Array.isArray(data.data)) {
        setReplies(data.data);
      } else if (Array.isArray(data.data)) {
        setReplies(data.data);
      }
    }
  };

  const fetchTeam = async () => {
    const data = await safeJsonFetch("/api/team");
    if (data) {
      if (Array.isArray(data)) {
        setTeamMembers(data);
      } else if (data.success && Array.isArray(data.data)) {
        setTeamMembers(data.data);
      } else if (Array.isArray(data.data)) {
        setTeamMembers(data.data);
      }
    }
  };

  // Action Controllers passed down
  const handleCampaignStatusChange = async (id: string, newStatus: CampaignStatus) => {
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setCampaigns(campaigns.map(c => c.id === id ? { ...c, status: newStatus } : c));
        fetchStats();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateCampaign = async (name: string, subject: string, body: string): Promise<Campaign> => {
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, subjectTemplate: subject, bodyTemplate: body }),
    });
    const created = await res.json();
    const campaignObj = created.success && created.data ? created.data : created;
    setCampaigns([...campaigns, campaignObj]);
    return campaignObj;
  };

  const handleDeleteCampaign = async (id: string) => {
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    if (res.ok) {
      setCampaigns(campaigns.filter(c => c.id !== id));
      fetchStats();
    }
  };

  const handleUpdateCampaign = async (id: string, updateData: Partial<Campaign>) => {
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateData),
    });
    if (res.ok) {
      const updated = await res.json();
      const campaignObj = updated.success && updated.data ? updated.data : updated;
      setCampaigns(campaigns.map(c => c.id === id ? campaignObj : c));
    }
  };

  const handleAddSmtp = async (smtpData: any): Promise<SmtpAccount> => {
    const res = await fetch("/api/smtp-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(smtpData),
    });
    const added = await res.json();
    setSmtpAccounts([...smtpAccounts, added]);
    setDomains(domains.map(d => smtpData.email.endsWith(d.name) ? { ...d, inboxCount: d.inboxCount + 1 } : d));
    return added;
  };

  const handleUpdateSmtp = async (id: string, updateData: Partial<SmtpAccount>) => {
    const res = await fetch(`/api/smtp-accounts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateData),
    });
    if (res.ok) {
      const updated = await res.json();
      setSmtpAccounts(smtpAccounts.map(s => s.id === id ? updated : s));
      fetchStats();
    }
  };

  const handleDeleteSmtp = async (id: string) => {
    const target = smtpAccounts.find(s => s.id === id);
    const res = await fetch(`/api/smtp-accounts/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSmtpAccounts(smtpAccounts.filter(s => s.id !== id));
      if (target) {
        setDomains(domains.map(d => target.email.endsWith(d.name) ? { ...d, inboxCount: Math.max(0, d.inboxCount - 1) } : d));
      }
    }
  };

  const handleTestSmtp = async (id: string) => {
    const res = await fetch(`/api/smtp-accounts/${id}/test`, {
      method: "POST",
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.details || errData.error || "Failed to connect to SMTP server");
    }
    const smtpRes = await fetch("/api/smtp-accounts");
    if (smtpRes.ok) {
      const updatedList = await smtpRes.json();
      setSmtpAccounts(updatedList);
    }
  };

  const handleAddDomain = async (domainName: string): Promise<Domain> => {
    const res = await fetch("/api/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: domainName }),
    });
    const added = await res.json();
    setDomains([...domains, added]);
    return added;
  };

  const handleVerifyDomain = async (id: string): Promise<Domain> => {
    const res = await fetch(`/api/domains/${id}/verify`, { method: "PUT" });
    const verified = await res.json();
    setDomains(domains.map(d => d.id === id ? verified : d));
    fetchStats();
    return verified;
  };

  const handleDeleteDomain = async (id: string) => {
    const res = await fetch(`/api/domains/${id}`, { method: "DELETE" });
    if (res.ok) {
      setDomains(domains.filter(d => d.id !== id));
    }
  };

  const handleSaveTemplateAsTemplate = async (name: string, subject: string, body: string, category: string) => {
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, subject, body, category }),
    });
    return await res.json();
  };

  const handleInviteMember = async (name: string, email: string, role: SecurityRole): Promise<TeamMember> => {
    const res = await fetch("/api/team/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, role }),
    });
    const invited = await res.json();
    setTeamMembers([...teamMembers, invited]);
    return invited;
  };

  const handleMarkReplyRead = async (id: string) => {
    await fetch(`/api/replies/${id}/read`, { method: "POST" });
    setReplies(replies.map(r => r.id === id ? { ...r, isRead: true } : r));
    fetchStats();
  };

  const handleGenerateAiReply = async (id: string): Promise<string> => {
    const res = await fetch(`/api/replies/${id}/ai-reply`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Generation error");
    
    // Auto sync state update
    setReplies(replies.map(r => r.id === id ? { ...r, aiSuggestedReply: data.draft } : r));
    return data.draft;
  };

  const handleSendReply = async (id: string, body: string) => {
    const res = await fetch(`/api/replies/${id}/send-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.details || errData.error || "Failed to dispatch reply");
    }
  };

  // Render match layout
  const renderMainView = () => {
    switch (currentView) {
      case "dashboard":
        return (
          <DashboardView
            stats={stats}
            onNavigate={(view) => setView(view)}
            onReadReply={handleMarkReplyRead}
          />
        );
      case "crm":
        return (
          <CrmBoardView
            campaigns={campaigns}
            onRefreshAllData={fetchAllSaaSData}
          />
        );
      case "lead-finder":
        return (
          <AiLeadFinderView
            campaigns={campaigns}
            onCreateCampaign={handleCreateCampaign}
            onRefreshAllData={fetchAllSaaSData}
          />
        );
      case "campaigns":
        return (
          <CampaignsView
            campaigns={campaigns}
            onStatusChange={handleCampaignStatusChange}
            onCreateCampaign={handleCreateCampaign}
            onDeleteCampaign={handleDeleteCampaign}
            onUpdateCampaign={handleUpdateCampaign}
          />
        );
      case "smtp":
        return (
          <InboxesView
            smtpAccounts={smtpAccounts}
            onAddSmtp={handleAddSmtp}
            onUpdateSmtp={handleUpdateSmtp}
            onDeleteSmtp={handleDeleteSmtp}
            onTestSmtp={handleTestSmtp}
          />
        );
      case "domains":
        return (
          <DomainsView
            domains={domains}
            onAddDomain={handleAddDomain}
            onVerifyDomain={handleVerifyDomain}
            onDeleteDomain={handleDeleteDomain}
          />
        );
      case "replies":
        return (
          <RepliesView
            replies={replies}
            onMarkRead={handleMarkReplyRead}
            onGenerateAiReply={handleGenerateAiReply}
            onSendReply={handleSendReply}
          />
        );
      case "ai-generator":
        return (
          <AiGeneratorView
            onSaveTemplate={handleSaveTemplateAsTemplate}
          />
        );
      case "ai-agents":
        return <AgentsView />;
      case "autopilot":
        return <AutopilotConsole />;
      case "team":
        return (
          <TeamView
            members={teamMembers}
            onInviteMember={handleInviteMember}
          />
        );
      case "settings":
        return <SettingsView />;
      case "enterprise":
        return (
          <EnterpriseConsole
            smtpAccounts={smtpAccounts}
            domains={domains}
            onRefreshAllData={fetchAllSaaSData}
          />
        );
      default:
        return <AutopilotConsole />;
    }
  };

  const runningCampaignsCount = campaigns.filter(c => c.status === CampaignStatus.RUNNING).length;

  return (
    <div className="flex bg-[#f8fafc] text-slate-800 dark:bg-slate-950 dark:text-slate-100 min-h-screen font-sans transition-colors duration-200" id="applet-primary-container">
      <Sidebar
        currentView={currentView}
        setView={setView}
        activeCampaigns={runningCampaignsCount}
        theme={theme}
        setTheme={setTheme}
      />
      {renderMainView()}
    </div>
  );
}
