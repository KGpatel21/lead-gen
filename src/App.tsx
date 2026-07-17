/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from "react";
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
import LeadDiscoveryView from "./components/LeadDiscoveryView";
import LoginPage from "./components/LoginPage";

import {
  Campaign, CampaignStatus, SmtpAccount, Domain, Reply, TeamMember, SecurityRole,
} from "./types";

import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider, useToast } from "./context/ToastContext";
import {
  campaignsApi, smtpApi, domainsApi, repliesApi, teamApi, templatesApi, dashboardApi,
  DashboardStats,
} from "./api/endpoints";
import { ApiError } from "./api/client";

const emptyStats: DashboardStats = {
  totalSent: 0,
  avgOpenRate: 0,
  avgReplyRate: 0,
  avgBounceRate: 0,
  activeCampaignsCount: 0,
  avgReputation: 0,
  avgDomainHealth: 0,
  recentReplies: [],
  timeline: {
    sentOverTime: [],
    domainReputationTrend: [],
    warmupTrend: [],
    repliesSentimentBreakdown: [],
  },
};

function AuthedApp() {
  const toast = useToast();
  const { user } = useAuth();

  const [currentView, setView] = useState("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("preferred-theme");
    return saved === "dark" || saved === "light" ? saved : "light";
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("preferred-theme", theme);
  }, [theme]);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [smtpAccounts, setSmtpAccounts] = useState<SmtpAccount[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);

  const surfaceError = useCallback(
    (label: string, err: unknown) => {
      const msg = err instanceof ApiError ? err.message : (err as Error)?.message || String(err);
      console.warn(`[app] ${label} failed:`, msg);
      toast.error(`${label}: ${msg}`);
    },
    [toast]
  );

  // ---- Data fetchers ----
  const fetchStats = useCallback(async () => {
    try { setStats(await dashboardApi.stats()); }
    catch (err) { surfaceError("Dashboard stats", err); }
  }, [surfaceError]);

  const fetchCampaigns = useCallback(async () => {
    try { setCampaigns(await campaignsApi.list()); }
    catch (err) { surfaceError("Campaigns", err); }
  }, [surfaceError]);

  const fetchSmtp = useCallback(async () => {
    try { setSmtpAccounts(await smtpApi.list()); }
    catch (err) { surfaceError("SMTP accounts", err); }
  }, [surfaceError]);

  const fetchDomains = useCallback(async () => {
    try { setDomains(await domainsApi.list()); }
    catch (err) { surfaceError("Domains", err); }
  }, [surfaceError]);

  const fetchReplies = useCallback(async () => {
    try { setReplies(await repliesApi.list()); }
    catch (err) { surfaceError("Replies", err); }
  }, [surfaceError]);

  const fetchTeam = useCallback(async () => {
    try { setTeamMembers(await teamApi.list()); }
    catch (err) { surfaceError("Team", err); }
  }, [surfaceError]);

  const fetchAllSaaSData = useCallback(async () => {
    await Promise.all([fetchStats(), fetchCampaigns(), fetchSmtp(), fetchDomains(), fetchReplies(), fetchTeam()]);
  }, [fetchStats, fetchCampaigns, fetchSmtp, fetchDomains, fetchReplies, fetchTeam]);

  useEffect(() => {
    fetchAllSaaSData();
    const ticker = setInterval(() => {
      Promise.all([fetchStats(), fetchCampaigns(), fetchReplies()]).catch(() => {});
    }, 15_000);
    return () => clearInterval(ticker);
  }, [fetchAllSaaSData, fetchStats, fetchCampaigns, fetchReplies]);

  // ---- Action handlers ----
  const handleCampaignStatusChange = async (id: string, newStatus: CampaignStatus) => {
    try {
      const updated = await campaignsApi.update(id, { status: newStatus });
      setCampaigns((cur) => cur.map((c) => (c.id === id ? updated : c)));
      fetchStats();
      toast.success(`Campaign ${newStatus.toLowerCase()}.`);
    } catch (err) { surfaceError("Update campaign status", err); }
  };

  const handleCreateCampaign = async (name: string, subject: string, body: string): Promise<Campaign> => {
    const created = await campaignsApi.create({ name, subjectTemplate: subject, bodyTemplate: body });
    setCampaigns((cur) => [created, ...cur]);
    toast.success(`Campaign "${created.name}" created.`);
    return created;
  };

  const handleDeleteCampaign = async (id: string) => {
    try {
      await campaignsApi.delete(id);
      setCampaigns((cur) => cur.filter((c) => c.id !== id));
      fetchStats();
      toast.success("Campaign deleted.");
    } catch (err) { surfaceError("Delete campaign", err); }
  };

  const handleUpdateCampaign = async (id: string, patch: Partial<Campaign>) => {
    try {
      const updated = await campaignsApi.update(id, patch);
      setCampaigns((cur) => cur.map((c) => (c.id === id ? updated : c)));
    } catch (err) { surfaceError("Update campaign", err); }
  };

  const handleAddSmtp = async (payload: any): Promise<SmtpAccount> => {
    const added = await smtpApi.create(payload);
    setSmtpAccounts((cur) => [added, ...cur]);
    toast.success(`SMTP account added: ${added.email}`);
    return added;
  };

  const handleUpdateSmtp = async (id: string, patch: Partial<SmtpAccount>) => {
    try {
      const updated = await smtpApi.update(id, patch);
      setSmtpAccounts((cur) => cur.map((s) => (s.id === id ? updated : s)));
    } catch (err) { surfaceError("Update SMTP", err); }
  };

  const handleDeleteSmtp = async (id: string) => {
    try {
      await smtpApi.delete(id);
      setSmtpAccounts((cur) => cur.filter((s) => s.id !== id));
      toast.success("SMTP account removed.");
    } catch (err) { surfaceError("Delete SMTP", err); }
  };

  const handleTestSmtp = async (id: string) => {
    await smtpApi.test(id);
    toast.success("SMTP handshake succeeded.");
    fetchSmtp();
  };

  const handleAddDomain = async (name: string): Promise<Domain> => {
    const added = await domainsApi.create(name);
    setDomains((cur) => [added, ...cur]);
    toast.success(`Domain "${added.name}" added.`);
    return added;
  };

  const handleVerifyDomain = async (id: string): Promise<Domain> => {
    const verified = await domainsApi.verify(id);
    setDomains((cur) => cur.map((d) => (d.id === id ? verified : d)));
    fetchStats();
    toast.info(`SPF ${verified.spfStatus} / DKIM ${verified.dkimStatus} / DMARC ${verified.dmarcStatus}`);
    return verified;
  };

  const handleDeleteDomain = async (id: string) => {
    try {
      await domainsApi.delete(id);
      setDomains((cur) => cur.filter((d) => d.id !== id));
      toast.success("Domain removed.");
    } catch (err) { surfaceError("Delete domain", err); }
  };

  const handleSaveTemplate = async (name: string, subject: string, body: string, category: string) => {
    const created = await templatesApi.create({ name, subject, body, category });
    toast.success(`Template "${created.name}" saved.`);
    return created;
  };

  const handleInviteMember = async (name: string, email: string, role: SecurityRole): Promise<TeamMember> => {
    const { member, inviteToken } = await teamApi.invite({ name, email, role });
    setTeamMembers((cur) => [...cur, member]);
    toast.success(`Invite created. Token: ${inviteToken.slice(0, 12)}…`);
    return member;
  };

  const handleMarkReplyRead = async (id: string) => {
    try {
      const updated = await repliesApi.markRead(id);
      setReplies((cur) => cur.map((r) => (r.id === id ? updated : r)));
      fetchStats();
    } catch (err) { surfaceError("Mark reply read", err); }
  };

  const handleGenerateAiReply = async (id: string): Promise<string> => {
    const result = await repliesApi.generateAiReply(id);
    setReplies((cur) => cur.map((r) => (r.id === id ? { ...r, aiSuggestedReply: result.aiReplyDraft } : r)));
    return result.aiReplyDraft;
  };

  const handleSendReply = async (id: string, body: string) => {
    await repliesApi.send(id, body);
    toast.success("Response recorded.");
  };

  const renderMainView = () => {
    switch (currentView) {
      case "dashboard":
        return <DashboardView stats={stats as any} onNavigate={setView} onReadReply={handleMarkReplyRead} />;
      case "lead-discovery":
        return <LeadDiscoveryView />;
      case "crm":
        return <CrmBoardView campaigns={campaigns} onRefreshAllData={fetchAllSaaSData} />;
      case "lead-finder":
        return <AiLeadFinderView campaigns={campaigns} onCreateCampaign={handleCreateCampaign} onRefreshAllData={fetchAllSaaSData} />;
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
        return <AiGeneratorView onSaveTemplate={handleSaveTemplate} />;
      case "ai-agents":
        return <AgentsView />;
      case "autopilot":
        return <AutopilotConsole />;
      case "team":
        return <TeamView members={teamMembers} onInviteMember={handleInviteMember} />;
      case "settings":
        return <SettingsView />;
      case "enterprise":
        return <EnterpriseConsole smtpAccounts={smtpAccounts} domains={domains} onRefreshAllData={fetchAllSaaSData} />;
      default:
        return <DashboardView stats={stats as any} onNavigate={setView} onReadReply={handleMarkReplyRead} />;
    }
  };

  const runningCampaignsCount = campaigns.filter((c) => c.status === CampaignStatus.RUNNING).length;

  return (
    <div
      className="flex bg-[#f8fafc] text-slate-800 dark:bg-slate-950 dark:text-slate-100 min-h-screen font-sans transition-colors duration-200"
      id="applet-primary-container"
    >
      <Sidebar
        currentView={currentView}
        setView={setView}
        activeCampaigns={runningCampaignsCount}
        theme={theme}
        setTheme={setTheme}
      />
      <div className="flex-1 min-w-0">{renderMainView()}</div>
    </div>
  );
}

function AppRoot() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400">
        <div className="text-sm animate-pulse">Restoring session…</div>
      </div>
    );
  }
  return user ? <AuthedApp /> : <LoginPage />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppRoot />
      </AuthProvider>
    </ToastProvider>
  );
}
