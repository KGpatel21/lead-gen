/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  Mail,
  Play,
  Pause,
  Plus,
  Trash2,
  Upload,
  Users,
  Calendar,
  Sparkles,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  Check,
  ChevronRight,
  ChevronLeft,
  X,
  FileText
} from "lucide-react";
import { Campaign, CampaignStatus, Lead, LeadStatus, GeneratedEmailDetail } from "../types";

interface CampaignsViewProps {
  campaigns: Campaign[];
  onStatusChange: (id: string, newStatus: CampaignStatus) => void;
  onCreateCampaign: (name: string, subject: string, body: string) => Promise<Campaign>;
  onDeleteCampaign: (id: string) => void;
  onUpdateCampaign: (id: string, data: Partial<Campaign>) => void;
}

export default function CampaignsView({
  campaigns,
  onStatusChange,
  onCreateCampaign,
  onDeleteCampaign,
  onUpdateCampaign,
}: CampaignsViewProps) {
  const [selectedCampId, setSelectedCampId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");

  const [activeTab, setActiveTab] = useState<"leads" | "sequence" | "schedule" | "emails" | "queue">("leads");

  // Queue state and loading variables
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [isQueueLoading, setIsQueueLoading] = useState(false);

  // CSV Lead Upload
  const [csvInput, setCsvInput] = useState("");
  const [uploadResult, setUploadResult] = useState<{
    successCount: number;
    dupCount: number;
    invalidCount: number;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Bulk AI Personalizer Status
  const [isPersonalizing, setIsPersonalizing] = useState(false);
  const [personalizeInstruction, setPersonalizeInstruction] = useState("Compliment their leadership style or business growth.");
  const [personalizeMessage, setPersonalizeMessage] = useState("");

  // Search lead filters
  const [leadSearch, setLeadSearch] = useState("");

  // Simple AI Lead Finder states
  const [aiSearchKeyword, setAiSearchKeyword] = useState("");
  const [aiPlatformSelect, setAiPlatformSelect] = useState("LinkedIn Profiles");
  const [aiCountGoal, setAiCountGoal] = useState<number>(10);
  const [aiFinderLoading, setAiFinderLoading] = useState(false);
  const [aiFinderMessage, setAiFinderMessage] = useState("");

  // AI Enrichment & Research States
  const [selectedResearchLead, setSelectedResearchLead] = useState<Lead | null>(null);
  const [enrichingLeadId, setEnrichingLeadId] = useState<string | null>(null);
  const [isBulkEnriching, setIsBulkEnriching] = useState(false);
  const [bulkEnrichMessage, setBulkEnrichMessage] = useState("");
  const [inspectorTab, setInspectorTab] = useState<"enrichment" | "research" | "sequence">("enrichment");
  const [selectedSequenceStep, setSelectedSequenceStep] = useState<"initial" | "followUp1" | "followUp2" | "followUp3">("initial");

  const handleEnrichLead = async (leadId: string) => {
    try {
      setEnrichingLeadId(leadId);
      const res = await fetch(`/api/leads/${leadId}/enrich-research`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setLeads(prev => prev.map(l => l.id === leadId ? json.lead : l));
        if (selectedResearchLead && selectedResearchLead.id === leadId) {
          setSelectedResearchLead(json.lead);
        }
      } else {
        alert("Enrichment failed: " + (json.error || "Unknown error"));
      }
    } catch (err: any) {
      console.error(err);
      alert("Error: " + err.message);
    } finally {
      setEnrichingLeadId(null);
    }
  };

  const handleBulkEnrichCampaign = async () => {
    if (!selectedCampaign) return;
    try {
      setIsBulkEnriching(true);
      setBulkEnrichMessage("Launching deep parallel enrichment worker...");
      const res = await fetch(`/api/campaigns/${selectedCampaign.id}/ai-bulk-enrich-research`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setBulkEnrichMessage(`Enriched and researched ${json.count} leads successfully!`);
        fetchCampaignLeads(selectedCampaign.id);
      } else {
        setBulkEnrichMessage("Error: " + (json.error || "failed"));
      }
    } catch (err: any) {
      console.error(err);
      setBulkEnrichMessage("Error: " + err.message);
    } finally {
      setIsBulkEnriching(false);
    }
  };

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampId);

  const fetchCampaignQueue = async (id: string) => {
    try {
      setIsQueueLoading(true);
      const res = await fetch(`/api/queue?campaignId=${id}`);
      const resJson = await res.json();
      if (resJson.success) {
        setQueueItems(resJson.data);
      }
    } catch (err) {
      console.error("Error loading campaign queue:", err);
    } finally {
      setIsQueueLoading(false);
    }
  };

  const handleRetryQueueItem = async (itemId: string) => {
    try {
      const res = await fetch(`/api/queue/${itemId}/retry`, { method: "POST" });
      if (res.ok) {
        if (selectedCampId) {
          fetchCampaignQueue(selectedCampId);
          fetchCampaignLeads(selectedCampId);
        }
      }
    } catch (err) {
      console.error("Error retrying queue item:", err);
    }
  };

  const handleDeleteQueueItem = async (itemId: string) => {
    try {
      const res = await fetch(`/api/queue/${itemId}`, { method: "DELETE" });
      if (res.ok) {
        if (selectedCampId) fetchCampaignQueue(selectedCampId);
      }
    } catch (err) {
      console.error("Error deleting queue item:", err);
    }
  };

  const handleRetryAllFailed = async () => {
    if (!selectedCampId) return;
    try {
      const res = await fetch(`/api/queue/campaign/${selectedCampId}/retry`, { method: "POST" });
      if (res.ok) {
        fetchCampaignQueue(selectedCampId);
        fetchCampaignLeads(selectedCampId);
      }
    } catch (err) {
      console.error("Error retrying failed campaign queue items:", err);
    }
  };

  // Load leads and queue when selecting campaign or switching to queue tab
  useEffect(() => {
    if (selectedCampId) {
      fetchCampaignLeads(selectedCampId);
      fetchCampaignQueue(selectedCampId);
    }
  }, [selectedCampId, activeTab]);

  const fetchCampaignLeads = async (id: string) => {
    try {
      const res = await fetch(`/api/campaigns/${id}/leads`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.data)) {
        setLeads(data.data);
      } else if (Array.isArray(data)) {
        setLeads(data);
      }
    } catch (err) {
      console.error("Error loading campaign leads:", err);
    }
  };

  const handleAiFindLeads = async () => {
    if (!aiSearchKeyword.trim() || !selectedCampId) return;
    setAiFinderLoading(true);
    setAiFinderMessage("");
    try {
      const res = await fetch("/api/autopilot/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: aiSearchKeyword,
          platforms: aiPlatformSelect,
          count: aiCountGoal
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to find leads");
      }
      
      const leadsToImport = data.leads || [];
      if (leadsToImport.length > 0) {
        const resImport = await fetch(`/api/campaigns/${selectedCampId}/leads/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads: leadsToImport })
        });
        if (resImport.ok) {
          setAiFinderMessage(`🚀 Successfully found and imported ${leadsToImport.length} verified leads on ${aiPlatformSelect}!`);
          setAiSearchKeyword("");
          fetchCampaignLeads(selectedCampId);
        } else {
          setAiFinderMessage(`Successfully generated ${leadsToImport.length} leads. Please refresh to view.`);
          fetchCampaignLeads(selectedCampId);
        }
      } else {
        setAiFinderMessage("No leads were found. Please try a different query.");
      }
    } catch (err: any) {
      console.error(err);
      setAiFinderMessage(`Error finding leads: ${err.message || err}`);
    } finally {
      setAiFinderLoading(false);
    }
  };

  const handleLaunchCampaign = async () => {
    if (!newCampaignName) return;
    try {
      const created = await onCreateCampaign(newCampaignName, newSubject, newBody);
      setNewCampaignName("");
      setNewSubject("");
      setNewBody("");
      setShowCreateModal(false);
      setSelectedCampId(created.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCsvUploadSubmit = async () => {
    if (!selectedCampId || !csvInput) return;
    setIsUploading(true);
    setUploadResult(null);

    try {
      const res = await fetch(`/api/campaigns/${selectedCampId}/leads/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText: csvInput }),
      });
      const data = await res.json();
      if (res.ok) {
        setUploadResult({
          successCount: data.successCount,
          dupCount: data.dupCount,
          invalidCount: data.invalidCount,
        });
        setCsvInput("");
        fetchCampaignLeads(selectedCampId);
      } else {
        alert(data.error || "Failed to upload leads");
      }
    } catch (err) {
      console.error("Error upload leads:", err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleAiBulkPersonalize = async () => {
    if (!selectedCampId) return;
    setIsPersonalizing(true);
    setPersonalizeMessage("");

    try {
      const res = await fetch(`/api/campaigns/${selectedCampId}/ai-bulk-personalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customizationInstruction: personalizeInstruction }),
      });
      const data = await res.json();
      if (res.ok) {
        setPersonalizeMessage(data.message || "Personalized successfully!");
        fetchCampaignLeads(selectedCampId);
      } else {
        setPersonalizeMessage(data.error || "Personalizer encountered an error");
      }
    } catch (err: any) {
      setPersonalizeMessage("Failed to personalization: " + err.message);
    } finally {
      setIsPersonalizing(false);
    }
  };

  const deleteLead = async (leadId: string) => {
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
      if (res.ok) {
        setLeads(leads.filter(l => l.id !== leadId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendLeadNow = async (leadId: string) => {
    try {
      const res = await fetch(`/api/leads/${leadId}/send-now`, {
        method: "POST"
      });
      const data = await res.json();
      if (res.ok) {
        setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: LeadStatus.SENT } : l));
        setTimeout(() => {
          if (selectedCampId) {
            fetchCampaignLeads(selectedCampId);
          }
        }, 2200);
      } else {
        alert(data.error || "Failed to trigger manual send");
      }
    } catch (err: any) {
      console.error(err);
      alert("Error triggering manual email dispatch: " + err.message);
    }
  };

  // Safe variables update handlers
  const handleSaveSequence = () => {
    if (!selectedCampaign) return;
    onUpdateCampaign(selectedCampaign.id, {
      subjectTemplate: selectedCampaign.subjectTemplate,
      bodyTemplate: selectedCampaign.bodyTemplate,
    });
    alert("Email Sequence updated successfully!");
  };

  const handleSaveSchedule = () => {
    if (!selectedCampaign) return;
    onUpdateCampaign(selectedCampaign.id, {
      scheduleTimeStart: selectedCampaign.scheduleTimeStart,
      scheduleTimeEnd: selectedCampaign.scheduleTimeEnd,
      timezone: selectedCampaign.timezone,
    });
    alert("Campaign schedule constraints locked.");
  };

  const filteredLeads = leads.filter(l =>
    l.email.toLowerCase().includes(leadSearch.toLowerCase()) ||
    l.firstName.toLowerCase().includes(leadSearch.toLowerCase()) ||
    l.company.toLowerCase().includes(leadSearch.toLowerCase())
  );

  return (
    <div className="flex-1 p-6 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto font-sans transition-colors duration-200" id="campaigns-view-container">
      
      {!selectedCampaign ? (
        // LIST VIEW OF CAMPAIGNS
        <div className="animate-none">
          <div className="flex justify-between items-center mb-6" id="campaigns-header">
            <div>
              <span className="text-[9px] font-mono text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">Outbound Sequences</span>
              <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white tracking-tight animate-none">Campaign Management</h1>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3.5 py-2 rounded-lg cursor-pointer transition-all shadow-sm"
              id="btn-create-campaign-modal"
            >
              <Plus className="w-4 h-4" />
              Create Campaign
            </button>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm overflow-hidden animate-none" id="campaigns-table-card">
            {campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-slate-400 dark:text-slate-500">
                <Mail className="w-10 h-10 opacity-30 mb-3 text-blue-550" />
                <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">No campaigns active</h3>
                <p className="text-xs max-w-sm text-center text-slate-400 dark:text-slate-500 leading-normal">Add a cold outbound list, build templates, rotate SMTP accounts and watch meeting conversions grow.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-sans text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-850/40 text-slate-500 dark:text-slate-400 select-none">
                      <th className="px-5 py-3 font-semibold text-[10px] uppercase tracking-wider">Campaign Name</th>
                      <th className="px-5 py-3 font-semibold text-[10px] uppercase tracking-wider">Status</th>
                      <th className="px-5 py-3 font-semibold text-[10px] uppercase tracking-wider">Dispatched</th>
                      <th className="px-5 py-3 font-semibold text-[10px] uppercase tracking-wider">Open %</th>
                      <th className="px-5 py-3 font-semibold text-[10px] uppercase tracking-wider">Reply %</th>
                      <th className="px-5 py-3 font-semibold text-[10px] uppercase tracking-wider">Bounces</th>
                      <th className="px-5 py-3 font-semibold text-[10px] uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {campaigns.map((camp) => {
                      const openRate = camp.sentCount > 0 ? Math.round((camp.openCount / camp.sentCount) * 100) : 0;
                      const replyRate = camp.sentCount > 0 ? Math.round((camp.replyCount / camp.sentCount) * 100) : 0;

                      return (
                        <tr
                          key={camp.id}
                          className="hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <button
                              onClick={() => setSelectedCampId(camp.id)}
                              className="font-semibold text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer transition-colors block text-left font-display text-[13px]"
                            >
                              {camp.name}
                            </button>
                            <span className="text-[9px] font-mono text-slate-400 dark:text-slate-550">Launched {new Date(camp.createdAt).toLocaleDateString()}</span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${
                                camp.status === CampaignStatus.RUNNING
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30"
                                  : camp.status === CampaignStatus.PAUSED
                                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30"
                                  : camp.status === CampaignStatus.COMPLETED
                                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-105 dark:border-blue-900/30"
                                  : "bg-slate-50 text-slate-500 dark:bg-slate-850 dark:text-slate-400 border border-slate-150 dark:border-slate-800"
                              }`}
                            >
                              {camp.status}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 font-mono font-semibold text-slate-700 dark:text-slate-300">{camp.sentCount}</td>
                          <td className="px-5 py-3.5 font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{openRate}%</td>
                          <td className="px-5 py-3.5 font-mono text-blue-600 dark:text-blue-400 font-semibold">{replyRate}%</td>
                          <td className="px-5 py-3.5 font-mono text-rose-600 dark:text-rose-400">{camp.bounceCount}</td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex justify-end gap-1.5">
                              {camp.status === CampaignStatus.RUNNING ? (
                                <button
                                  onClick={() => onStatusChange(camp.id, CampaignStatus.PAUSED)}
                                  className="p-1.5 bg-white dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-700 dark:hover:text-amber-400 text-amber-600 rounded border border-slate-200 dark:border-slate-700 cursor-pointer transition-all"
                                  title="Pause Send"
                                >
                                  <Pause className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => onStatusChange(camp.id, CampaignStatus.RUNNING)}
                                  className="p-1.5 bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-400 text-emerald-600 rounded border border-slate-200 dark:border-slate-700 cursor-pointer transition-all"
                                  title="Play Send"
                                >
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                </button>
                              )}
                              <button
                                onClick={() => onDeleteCampaign(camp.id)}
                                className="p-1.5 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 text-slate-400 dark:text-slate-500 rounded border border-slate-200 dark:border-slate-700 cursor-pointer transition-all"
                                title="Delete Sequence"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
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
      ) : (
        // DETAILED CAMPAIGN MULTI-TAB WORKSPACE
        <div>
          {/* Back button */}
          <button
            onClick={() => { setSelectedCampId(null); setUploadResult(null); }}
            className="flex items-center gap-1.5 text-slate-450 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white text-xs font-semibold mb-6 cursor-pointer transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back to campaigns
          </button>

          <div className="flex justify-between items-start mb-6" id="camp-detail-title-panel">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-display font-bold text-slate-850 dark:text-white">{selectedCampaign.name}</h1>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${
                  selectedCampaign.status === CampaignStatus.RUNNING 
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30" 
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                }`}>
                  {selectedCampaign.status}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-mono">ID: {selectedCampaign.id} • Built {new Date(selectedCampaign.createdAt).toLocaleDateString()}</p>
            </div>

            <div className="flex gap-1.5">
              {selectedCampaign.status === CampaignStatus.RUNNING ? (
                <button
                  onClick={() => onStatusChange(selectedCampaign.id, CampaignStatus.PAUSED)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800/60 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-xs font-semibold rounded-lg cursor-pointer transition-all"
                >
                  <Pause className="w-3.5 h-3.5" /> Pause Campaign
                </button>
              ) : (
                <button
                  onClick={() => onStatusChange(selectedCampaign.id, CampaignStatus.RUNNING)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold rounded-lg cursor-pointer transition-all shadow-sm"
                >
                  <Play className="w-3.5 h-3.5" /> Launch Campaign
                </button>
              )}
              <button
                onClick={() => { onDeleteCampaign(selectedCampaign.id); setSelectedCampId(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600 dark:hover:text-rose-400 text-slate-500 dark:text-slate-400 text-xs font-semibold rounded-lg cursor-pointer transition-all border border-slate-200 dark:border-slate-700"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>

          {/* Core Analytics Banner for selected Campaign */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-lg shadow-sm" id="campaign-banner-stats">
            <div className="p-2.5 bg-slate-50/70 dark:bg-slate-850/50 rounded border border-slate-100 dark:border-slate-800">
              <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 block uppercase font-semibold">Dispatched</span>
              <span className="text-lg font-display font-bold text-slate-800 dark:text-slate-100 mt-0.5 block">{selectedCampaign.sentCount}</span>
            </div>
            <div className="p-2.5 bg-slate-50/70 dark:bg-slate-850/50 rounded border border-slate-100 dark:border-slate-800">
              <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 block uppercase font-semibold">Open Rate</span>
              <span className="text-lg font-display font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                {selectedCampaign.sentCount > 0 ? Math.round((selectedCampaign.openCount / selectedCampaign.sentCount) * 100) : 0}%
              </span>
            </div>
            <div className="p-2.5 bg-slate-50/70 dark:bg-slate-850/50 rounded border border-slate-100 dark:border-slate-800">
              <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 block uppercase font-semibold">Response Rate</span>
              <span className="text-lg font-display font-bold text-blue-600 dark:text-blue-400 mt-0.5 block">
                {selectedCampaign.sentCount > 0 ? Math.round((selectedCampaign.replyCount / selectedCampaign.sentCount) * 100) : 0}%
              </span>
            </div>
            <div className="p-2.5 bg-slate-50/70 dark:bg-slate-850/50 rounded border border-slate-100 dark:border-slate-800">
              <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 block uppercase font-semibold">Bounce Rate</span>
              <span className="text-lg font-display font-bold text-rose-600 dark:text-rose-400 mt-0.5 block">
                {selectedCampaign.sentCount > 0 ? Math.round((selectedCampaign.bounceCount / selectedCampaign.sentCount) * 100) : 0}%
              </span>
            </div>
            <div className="p-2.5 bg-slate-50/70 dark:bg-slate-850/50 rounded border border-slate-100 dark:border-slate-800 col-span-2 md:col-span-1">
              <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 block uppercase font-semibold">Unsubscribed</span>
              <span className="text-lg font-display font-bold text-slate-500 dark:text-slate-400 mt-0.5 block">{selectedCampaign.unsubCount}</span>
            </div>
          </div>

          {/* Sub Workspace Tabs Switching */}
          <div className="flex border-b border-slate-200 dark:border-slate-850 mb-6 gap-6/10" id="camp-workspace-tabs">
            <button
              onClick={() => setActiveTab("leads")}
              className={`pb-2.5 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === "leads" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-400 hover:text-slate-700"
              }`}
            >
              Leads list ({leads.length})
            </button>
            <button
              onClick={() => setActiveTab("sequence")}
              className={`pb-2.5 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === "sequence" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-400 hover:text-slate-700"
              }`}
            >
              Email template
            </button>
            <button
              onClick={() => setActiveTab("schedule")}
              className={`pb-2.5 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === "schedule" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-400 hover:text-slate-700"
              }`}
            >
              Schedule settings
            </button>
            <button
              onClick={() => setActiveTab("emails")}
              className={`pb-2.5 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === "emails" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-400 hover:text-slate-700"
              }`}
              id="tab-selector-emails"
            >
              ✉ Emails ({leads.length})
            </button>
            <button
              onClick={() => setActiveTab("queue")}
              className={`pb-2.5 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === "queue" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-400 hover:text-slate-700"
              }`}
              id="tab-selector-queue"
            >
              ⏱ Queue ({queueItems.length})
            </button>
          </div>

          {/* TAB CONTENTS: LEADS UPLOADER & MANAGEMENT */}
          {activeTab === "leads" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="camp-sub-leads">
              
              {/* Left Column: Leads list */}
              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <div className="flex justify-between items-center mb-4 gap-4">
                  <h3 className="font-semibold text-xs text-slate-600 uppercase tracking-wide">Contacts in Campaign</h3>
                  <div className="relative w-48 bg-slate-50 border border-slate-200 rounded-lg flex items-center pr-2">
                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" />
                    <input
                      type="text"
                      placeholder="Search email..."
                      value={leadSearch}
                      onChange={(e) => setLeadSearch(e.target.value)}
                      className="w-full text-xs bg-transparent border-0 outline-none text-slate-700 py-1.5 pl-1.5"
                    />
                  </div>
                </div>

                {filteredLeads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-slate-400 text-center border border-dashed border-slate-200 rounded-lg">
                    <Users className="w-8 h-8 opacity-40 mb-2" />
                    <p className="text-xs">No matching prospects found. Copy-paste CSV columns on the side.</p>
                  </div>
                ) : (
                  <div className="overflow-y-auto max-h-96 pr-2 space-y-2" id="leads-list-scroller">
                    {filteredLeads.map((lead) => (
                      <div
                        key={lead.id}
                        className="p-3 bg-slate-50 border border-slate-105 rounded-lg flex items-start justify-between gap-4 hover:border-slate-200 transition-all"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-slate-750">{lead.firstName || "Fallback"} {lead.lastName || "Lead"}</span>
                            <span className="text-[10px] font-mono text-slate-400">@{lead.company || "Unknown"}</span>
                          </div>
                          <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">{lead.email}</p>
                          {lead.personalizedLine ? (
                            <p className="text-[10px] text-blue-700 bg-blue-50 border border-blue-100 p-1.5 rounded mt-1.5 italic font-medium leading-normal">
                              "{lead.personalizedLine}"
                            </p>
                          ) : (
                            <span className="text-[9px] text-slate-500 font-mono block mt-1.5">No Personalized Line AI Drafted</span>
                          )}
                          
                          {lead.proposedService && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <span className="text-[10px] text-teal-850 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-md font-semibold font-display flex items-center gap-1 shadow-sm">
                                ✨ Proposed Service: {lead.proposedService}
                              </span>
                            </div>
                          )}

                          {lead.descriptionMeta && (
                            <p className="text-[10px] text-slate-500 font-mono mt-1 bg-slate-100/50 p-1.5 rounded border border-slate-200/40 leading-normal">
                              📋 Scraped Details: {lead.descriptionMeta}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {enrichingLeadId === lead.id ? (
                            <span className="text-[10px] text-indigo-650 dark:text-indigo-400 font-medium flex items-center gap-1 font-mono">
                              <RefreshCw className="w-3 h-3 animate-spin" /> Scraping
                            </span>
                          ) : (
                            <button
                              onClick={() => handleEnrichLead(lead.id)}
                              className="px-2 py-1 text-[10px] font-bold text-indigo-750 dark:text-indigo-400 bg-indigo-50/55 dark:bg-indigo-950/40 hover:bg-indigo-100/60 dark:hover:bg-indigo-900/40 border border-indigo-200/40 dark:border-indigo-805 rounded-lg transition-all cursor-pointer flex items-center gap-1"
                              title="Run full AI scraper, business research, and sequence builder"
                            >
                              <Sparkles className="w-2.5 h-2.5" />
                              Research
                            </button>
                          )}

                          <button
                            onClick={() => setSelectedResearchLead(lead)}
                            className="px-2 py-1 text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100/60 dark:bg-slate-850 hover:bg-slate-200/60 dark:hover:bg-slate-800 border border-slate-205 dark:border-slate-700/60 rounded-lg transition-all cursor-pointer flex items-center gap-1"
                            title="Open Lead Intelligence Hub"
                          >
                            <FileText className="w-2.5 h-2.5" />
                            Intel Hub
                          </button>

                          {lead.status === LeadStatus.PENDING && (
                            <button
                              onClick={() => handleSendLeadNow(lead.id)}
                              className="px-2 py-1 text-[10px] font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-all cursor-pointer flex items-center gap-1 shadow-sm font-display hover:scale-102"
                              title="Send email pitch immediately"
                            >
                              <Play className="w-2.5 h-2.5 fill-current" />
                              Send Now
                            </button>
                          )}
                          <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            lead.status === LeadStatus.REPLIED
                              ? "bg-indigo-950 text-indigo-400"
                              : lead.status === LeadStatus.BOUNCED
                              ? "bg-red-950 text-red-500"
                              : lead.status === LeadStatus.PENDING
                              ? "bg-slate-900 text-slate-400"
                              : "bg-emerald-950 text-emerald-400"
                          }`}>
                            {lead.status}
                          </span>
                          <button
                            onClick={() => deleteLead(lead.id)}
                            className="p-1 text-slate-500 hover:text-red-400 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded transition-all cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Dynamic bulk lead uploader and AI Bulk Personalizer */}
              <div className="space-y-6">
                
                {/* Find New Leads with AI */}
                <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-3.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-500 animate-pulse" />
                    <div>
                      <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800">🔍 Find New Leads with AI</h3>
                      <p className="text-[10px] text-slate-450 mt-0.5">Scrape contacts from specific social channels instantly.</p>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1 uppercase tracking-wide">Target Search Query</label>
                      <input
                        type="text"
                        placeholder="e.g. Real estate agents in New York"
                        value={aiSearchKeyword}
                        onChange={(e) => setAiSearchKeyword(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 outline-none text-slate-700 focus:border-indigo-500 font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1 uppercase tracking-wide">Source Network</label>
                        <select
                          value={aiPlatformSelect}
                          onChange={(e) => setAiPlatformSelect(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 text-xs py-2 px-2.5 rounded-lg outline-none font-mono text-slate-700 focus:border-indigo-500"
                        >
                          <option value="LinkedIn Profiles">LinkedIn Only</option>
                          <option value="Google Maps Directories">Google Maps Only</option>
                          <option value="Instagram Outbound">Instagram Only</option>
                          <option value="Twitter / X Channels">Twitter Only</option>
                          <option value="All Social Platforms">All Platforms</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1 uppercase tracking-wide">Number of Leads</label>
                        <select
                          value={aiCountGoal}
                          onChange={(e) => setAiCountGoal(Number(e.target.value))}
                          className="w-full bg-slate-50 border border-slate-200 text-xs py-2 px-2.5 rounded-lg outline-none font-mono text-slate-700 focus:border-indigo-500"
                        >
                          <option value={10}>10 Leads</option>
                          <option value={20}>20 Leads</option>
                          <option value={30}>30 Leads</option>
                          <option value={50}>50 Leads</option>
                          <option value={5}>5 Leads</option>
                        </select>
                      </div>
                    </div>

                    {aiFinderMessage && (
                      <div className="p-2.5 bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10.5px] rounded-lg leading-normal font-mono">
                        {aiFinderMessage}
                      </div>
                    )}

                    <button
                      onClick={handleAiFindLeads}
                      disabled={aiFinderLoading || !aiSearchKeyword.trim()}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white text-xs font-semibold py-2.5 rounded-lg cursor-pointer transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      {aiFinderLoading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Searching {aiPlatformSelect}...
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4" />
                          Generate Verified Leads
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Outbound CSV Textarea */}
                <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 mb-1 flex items-center gap-1.5">
                    <Upload className="w-4 h-4 text-blue-600" /> Upload Outbound Leads
                  </h3>
                  <p className="text-[11px] text-slate-400 mb-2.5">Place a comma-separated list of emails. First row acts as column headers.</p>
                  
                  <textarea
                    rows={4}
                    placeholder="email,firstname,company&#10;sarah@stripe.com,Sarah,Stripe&#10;kevin@hubspot.com,Kevin,HubSpot"
                    value={csvInput}
                    onChange={(e) => setCsvInput(e.target.value)}
                    className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-blue-500 text-slate-700 resize-none mb-3"
                  />

                  {uploadResult && (
                    <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg text-[11px] space-y-1 mb-3">
                      <span className="font-bold text-blue-800">CSV Import Analysis:</span>
                      <p className="text-slate-700">✔ Imported successfully: {uploadResult.successCount}</p>
                      <p className="text-slate-550 font-mono">⚠️ Bypassed Duplicates: {uploadResult.dupCount}</p>
                      <p className="text-rose-600 font-mono">❌ Invalid emails parsed: {uploadResult.invalidCount}</p>
                    </div>
                  )}

                  <button
                    onClick={handleCsvUploadSubmit}
                    disabled={isUploading || !csvInput}
                    className="w-full bg-white hover:bg-slate-50 border border-slate-205 text-slate-750 disabled:bg-slate-50 disabled:text-slate-400 text-xs font-semibold py-2 rounded-lg cursor-pointer transition-all flex items-center justify-center gap-2"
                  >
                    {isUploading ? "Importing Outbounds..." : "Execute Bulk Import"}
                  </button>
                </div>

                {/* AI Bulk first-line generator */}
                <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-blue-600 mb-1 flex items-center gap-1.5 font-display">
                    <Sparkles className="w-4 h-4 text-blue-500" /> AI Bulk Personalizer
                  </h3>
                  <p className="text-[11px] text-slate-400 mb-3 leading-normal">Uses Gemini API to personalize the cold emails with realistic business openers.</p>

                  <div className="mb-3 space-y-1">
                    <label className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Style Guideline Prompt</label>
                    <input
                      type="text"
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none text-slate-700 focus:border-blue-500"
                      value={personalizeInstruction}
                      onChange={(e) => setPersonalizeInstruction(e.target.value)}
                    />
                  </div>

                  {personalizeMessage && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 text-[11px] rounded-lg mb-3 leading-normal">
                      {personalizeMessage}
                    </div>
                  )}

                  <button
                    onClick={handleAiBulkPersonalize}
                    disabled={isPersonalizing || leads.length === 0}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white text-xs font-semibold py-2 rounded-lg cursor-pointer transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    {isPersonalizing ? "Drafting Personalizations..." : "Generate AI Personalized Openers"}
                  </button>
                </div>

                {/* AI Research & Enrichment Engine */}
                <div className="bg-white border border-slate-205 rounded-lg p-5 shadow-sm space-y-3">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-indigo-650 dark:text-indigo-400 flex items-center gap-1.5 font-display">
                    <Sparkles className="w-4 h-4 text-indigo-550" /> AI Research & Enrichment
                  </h3>
                  <p className="text-[11px] text-slate-450 dark:text-slate-400 leading-normal">
                    Trigger deep Google Search grounding and crawl every lead to discover websites, social links, reviews, booking channels, tech stack, and pain points, then auto-generate a 4-step sequence.
                  </p>

                  {bulkEnrichMessage && (
                    <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100/40 dark:border-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-[11px] rounded-lg font-mono">
                      {bulkEnrichMessage}
                    </div>
                  )}

                  <button
                    onClick={handleBulkEnrichCampaign}
                    disabled={isBulkEnriching || leads.length === 0}
                    className="w-full bg-indigo-600 hover:bg-indigo-705 disabled:bg-slate-100 disabled:text-slate-400 text-white text-xs font-semibold py-2 rounded-lg cursor-pointer transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    {isBulkEnriching ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Crawling & Enriching...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Run Bulk AI Research & Scrape
                      </>
                    )}
                  </button>
                </div>

              </div>

            </div>
          )}

          {/* TAB CONTENTS: SEQUENCE EDITOR */}
          {activeTab === "sequence" && (
            <div className="max-w-xl bg-white border border-slate-205 rounded-lg p-5 shadow-sm animate-none" id="camp-sub-sequence">
              <h3 className="font-bold text-xs uppercase text-slate-800 mb-3 flex items-center gap-1 tracking-wider">Email Sequence Pitch Node</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-mono text-slate-400 block mb-1">Email Subject Line</label>
                  <input
                    type="text"
                    value={selectedCampaign.subjectTemplate}
                    onChange={(e) => onUpdateCampaign(selectedCampaign.id, { subjectTemplate: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 outline-none focus:border-blue-500 font-medium"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 block font-mono">Variables: {'{{company}}'} , {'{{firstName}}'}</span>
                </div>

                <div>
                  <label className="text-[10px] font-mono text-slate-400 block mb-1">Rich Content Text Template</label>
                  <textarea
                    rows={12}
                    value={selectedCampaign.bodyTemplate}
                    onChange={(e) => onUpdateCampaign(selectedCampaign.id, { bodyTemplate: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 outline-none focus:border-blue-500 font-mono leading-relaxed"
                  />
                  <div className="flex gap-2 mt-1">
                    <span className="text-[9px] font-mono text-slate-400 font-bold">Variables: {'{{firstName}}'}</span>
                    <span className="text-[9px] font-mono text-slate-400">• {'{{company}}'}</span>
                    <span className="text-[9px] font-mono text-slate-400">• {'{{personalizedLine}}'}</span>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3.5 flex justify-end animate-none">
                  <button
                    onClick={handleSaveSequence}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition-all shadow-sm"
                  >
                    Save Email Template
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENTS: SCHEDULING SETTINGS */}
          {activeTab === "schedule" && (
            <div className="max-w-xl bg-white border border-slate-200 rounded-lg p-5 shadow-sm animate-none" id="camp-sub-schedule">
              <h3 className="font-bold text-xs uppercase text-slate-800 mb-3 flex items-center gap-1.5 tracking-wider">
                <Calendar className="w-4 h-4 text-blue-600" /> Outbound Schedule constraints
              </h3>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-mono text-slate-400 block mb-1">Timezone target</label>
                    <select
                      value={selectedCampaign.timezone}
                      onChange={(e) => onUpdateCampaign(selectedCampaign.id, { timezone: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-700 outline-none focus:border-blue-500"
                    >
                      <option value="America/New_York">EST (America/New York)</option>
                      <option value="America/Chicago">CST (America/Chicago)</option>
                      <option value="America/Los_Angeles">PST (America/Los Angeles)</option>
                      <option value="Europe/London">GMT (Europe/London)</option>
                      <option value="Asia/Kolkata">IST (Asia/Kolkata)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono text-slate-400 block mb-1">Flexible Random Delivery Window</label>
                    <select
                      value={selectedCampaign.flexibleDeliveryInterval || "1h"}
                      onChange={(e) => onUpdateCampaign(selectedCampaign.id, { flexibleDeliveryInterval: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-700 outline-none focus:border-blue-500 font-medium"
                    >
                      <option value="30m">Within 30 Minutes (Randomized)</option>
                      <option value="1h">Within 1 Hour (Randomized)</option>
                      <option value="2h">Within 2 Hours (Randomized)</option>
                      <option value="4h">Within 4 Hours (Randomized)</option>
                      <option value="12h">Within 12 Hours (Randomized)</option>
                      <option value="24h">Within 24 Hours (Randomized)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-mono text-slate-400 block mb-1">Delivery Day Constraints</label>
                    <div className="flex gap-1.5 flex-wrap mt-1">
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                        <span key={day} className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-[10px] rounded font-semibold text-slate-650 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {day}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-mono text-slate-400 block mb-1">Delivers From</label>
                      <input
                        type="time"
                        value={selectedCampaign.scheduleTimeStart}
                        onChange={(e) => onUpdateCampaign(selectedCampaign.id, { scheduleTimeStart: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-700 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-400 block mb-1">Delivers To</label>
                      <input
                        type="time"
                        value={selectedCampaign.scheduleTimeEnd}
                        onChange={(e) => onUpdateCampaign(selectedCampaign.id, { scheduleTimeEnd: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-700 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50/50 p-3.5 rounded-lg border border-blue-105 text-[11px] text-slate-600 leading-relaxed">
                  <span className="font-bold text-blue-800 block mb-1">🎯 Flexible Random Delivery Delay Engine:</span>
                  Emails are dispatched on a flexible, non-fixed schedule. Currently set to trigger <strong>randomly within {selectedCampaign.flexibleDeliveryInterval === "30m" ? "30 minutes" : selectedCampaign.flexibleDeliveryInterval === "2h" ? "2 hours" : selectedCampaign.flexibleDeliveryInterval === "4h" ? "4 hours" : selectedCampaign.flexibleDeliveryInterval === "12h" ? "12 hours" : selectedCampaign.flexibleDeliveryInterval === "24h" ? "24 hours" : "1 hour"}</strong> per outbound prospect. This guarantees organic send patterns and human-like writing rhythm to fully bypass server filters.
                </div>

                <div className="border-t border-slate-105 pt-3.5 flex justify-end">
                  <button
                    onClick={handleSaveSchedule}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition-all shadow-sm"
                  >
                    Apply Schedule settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "emails" && (
            <div className="space-y-6" id="camp-sub-emails-tab">
              {/* Email Outbox Analytics Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-880 p-4 rounded-xl shadow-xs">
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase font-bold tracking-wider">Ready / Pending</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-display font-bold text-slate-700 dark:text-slate-200">
                      {leads.filter(l => l.status === LeadStatus.PENDING).length}
                    </span>
                    <span className="text-[10px] text-slate-450">queued</span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-880 p-4 rounded-xl shadow-xs">
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase font-bold tracking-wider">Dispatched (Sent)</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-display font-bold text-blue-600 dark:text-blue-400">
                      {leads.filter(l => l.status !== LeadStatus.PENDING).length}
                    </span>
                    <span className="text-[10px] text-slate-450">delivered</span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-880 p-4 rounded-xl shadow-xs">
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase font-bold tracking-wider">Opened</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-display font-bold text-emerald-600 dark:text-emerald-400">
                      {leads.filter(l => l.status === LeadStatus.OPENED || l.status === LeadStatus.CLICKED || l.status === LeadStatus.REPLIED).length}
                    </span>
                    <span className="text-[10px] text-slate-450">engagements</span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-880 p-4 rounded-xl shadow-xs">
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase font-bold tracking-wider">Replies Received</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-display font-bold text-purple-600 dark:text-purple-400">
                      {leads.filter(l => l.status === LeadStatus.REPLIED).length}
                    </span>
                    <span className="text-[10px] text-slate-450">responses</span>
                  </div>
                </div>
              </div>

              {/* Emails List */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <div className="flex justify-between items-center mb-5 gap-4">
                  <div>
                    <h3 className="font-bold text-xs uppercase tracking-wide text-slate-700 dark:text-slate-300">Outbound Cold Pitch Mailbox</h3>
                    <p className="text-[11px] text-slate-450 dark:text-slate-500">Review the final compiled AI email output for each prospect before dispatching.</p>
                  </div>
                  
                  {leads.filter(l => l.status === LeadStatus.PENDING).length > 0 && (
                    <div className="text-[11px] text-indigo-650 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/30 px-3 py-1.5 rounded-lg font-mono font-medium animate-pulse">
                      ⚡ Autopilot will rotate SMTPs to send these randomly
                    </div>
                  )}
                </div>

                {/* Sandbox & Credit Labs Status Bar */}
                <div className="mb-6 p-4 rounded-xl border bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 text-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold font-mono tracking-wider uppercase text-slate-400 dark:text-slate-500 block">Outbox Mode & Credit Labs</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">Sandbox Environment Mode:</span>
                      <span className="bg-amber-100 dark:bg-amber-950/45 text-amber-850 dark:text-amber-400 font-bold px-2 py-0.5 rounded text-[10px]">
                        Active (Credit Labs: Unlimited)
                      </span>
                    </div>
                    <p className="text-[10.5px] text-slate-450 leading-relaxed max-w-xl">
                      💡 <strong>Credential Notice:</strong> Since SMTP profiles without passwords run as safe simulations, outbound flows route to our visual sandbox. To send <strong>real-world emails</strong>, edit your account and provide an <strong>App Password</strong> in the <strong>Inboxes & Warmup</strong> tab.
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-2 rounded-lg font-mono text-[10.5px]">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-slate-650 dark:text-slate-400">SMTP Router: Online</span>
                  </div>
                </div>

                {leads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-450 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    <Users className="w-10 h-10 opacity-30 mb-3 text-blue-550" />
                    <h4 className="font-bold text-xs text-slate-700 dark:text-slate-300 uppercase">No Prospects Loaded Yet</h4>
                    <p className="text-xs max-w-sm mt-1 text-slate-500 dark:text-slate-400 leading-normal">
                      Import contact lists inside the <strong>Leads list</strong> tab, or run the <strong>AI Lead Finder</strong> to automatically compile outbound emails.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {leads.map((lead) => {
                      const finalSubject = (selectedCampaign.subjectTemplate || "Quick question regarding {{company}}")
                        .replace(/\{\{company\}\}/g, lead.company || "Enterprise")
                        .replace(/\{\{firstName\}\}/g, lead.firstName || "Prospect")
                        .replace(/\{\{lastName\}\}/g, lead.lastName || "Partner");

                      const personalizedStr = lead.personalizedLine || 
                        (lead.proposedService ? `I custom-designed ${lead.proposedService} to support ${lead.company || "your business"}.` : "I discovered your brand online and was highly impressed.");

                      const finalBody = (selectedCampaign.bodyTemplate || "Hi {{firstName}},\n\nI was looking into {{company}}.\n\n{{personalizedLine}}")
                        .replace(/\{\{firstName\}\}/g, lead.firstName || "Prospect")
                        .replace(/\{\{lastName\}\}/g, lead.lastName || "Partner")
                        .replace(/\{\{company\}\}/g, lead.company || "Enterprise")
                        .replace(/\{\{personalizedLine\}\}/g, personalizedStr);

                      return (
                        <div
                          key={lead.id}
                          className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all bg-slate-50/20 dark:bg-slate-900/45"
                        >
                          {/* Header Bar */}
                          <div className="bg-slate-50 dark:bg-slate-850 border-b border-slate-150 dark:border-slate-800 px-4 py-3 flex flex-wrap justify-between items-center gap-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                {lead.firstName} {lead.lastName}
                              </span>
                              <span className="text-[10px] text-slate-450 dark:text-slate-400 font-mono font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded">
                                {lead.email}
                              </span>
                              {lead.company && (
                                <span className="text-[10px] font-semibold text-slate-550 dark:text-slate-400 font-display">
                                  @ {lead.company}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              {/* Status Badge */}
                              <span className={`text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full uppercase ${
                                lead.status === LeadStatus.REPLIED
                                  ? "bg-indigo-950 text-indigo-400 border border-indigo-900"
                                  : lead.status === LeadStatus.BOUNCED
                                  ? "bg-rose-950 text-rose-400 border border-rose-900"
                                  : lead.status === LeadStatus.FAILED
                                  ? "bg-red-950 text-red-400 border border-red-900"
                                  : lead.status === LeadStatus.OPENED || lead.status === LeadStatus.CLICKED
                                  ? "bg-emerald-950 text-emerald-400 border border-emerald-900 animate-pulse"
                                  : lead.status === LeadStatus.SENT
                                  ? "bg-blue-950 text-blue-400 border border-blue-900"
                                  : "bg-slate-900 text-slate-400 border border-slate-800"
                              }`}>
                                {lead.status}
                              </span>

                              {/* Manual Send Action */}
                              {lead.status === LeadStatus.PENDING || lead.status === LeadStatus.FAILED ? (
                                <button
                                  onClick={() => handleSendLeadNow(lead.id)}
                                  className="bg-blue-600 hover:bg-blue-700 hover:scale-102 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-sm flex items-center gap-1.5 font-display"
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  {lead.status === LeadStatus.FAILED ? "Retry Send" : "Instant Send"}
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400 dark:text-slate-550 font-mono font-semibold italic bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200/40 dark:border-slate-700/40">
                                  Sent: {lead.updatedAt ? new Date(lead.updatedAt).toLocaleTimeString() : "Just now"}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Email Body Block */}
                          <div className="p-4 space-y-3 bg-white dark:bg-slate-900">
                            {lead.errorMessage && (
                              <div className="border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-xs font-mono rounded-lg p-2.5 flex items-start gap-2 animate-pulse">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-500" />
                                <div>
                                  <span className="font-bold uppercase tracking-wider block text-[9px] mb-0.5 text-red-700 dark:text-red-400">SMTP Connection Failure</span>
                                  {lead.errorMessage}
                                </div>
                              </div>
                            )}

                            <div className="border border-slate-100 dark:border-slate-800 rounded-lg p-2.5 bg-slate-50/40 dark:bg-slate-950/20 text-[11px] space-y-1">
                              <p className="text-slate-550 dark:text-slate-450"><strong className="text-slate-700 dark:text-slate-300 font-semibold font-mono">From:</strong> Connected High-Reputation Outbox (Rotated)</p>
                              <p className="text-slate-550 dark:text-slate-450"><strong className="text-slate-700 dark:text-slate-300 font-semibold font-mono">To:</strong> {lead.email}</p>
                              <p className="text-slate-700 dark:text-slate-300 font-medium"><strong className="text-slate-500 dark:text-slate-500 font-normal font-mono">Subject:</strong> {finalSubject}</p>
                            </div>

                            {lead.proposedService && (
                              <div className="flex gap-1.5 flex-wrap">
                                <span className="text-[10px] text-teal-850 dark:text-teal-450 bg-teal-50 dark:bg-teal-950/40 border border-teal-100 dark:border-teal-900/30 px-2 py-0.5 rounded-md font-semibold font-display flex items-center gap-1 shadow-sm">
                                  ✨ Prop. Service: {lead.proposedService}
                                </span>
                              </div>
                            )}

                            <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                              <p className="text-xs font-sans text-slate-650 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                {finalBody}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "queue" && (
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm p-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4 mb-5">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 font-display">
                    ⏱ Persistent Email Queue
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Independent, rate-limited, priority-sorted deliverability queue for this campaign.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => fetchCampaignQueue(selectedCampaign.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-xs font-semibold rounded-lg text-slate-700 dark:text-slate-200 cursor-pointer transition-all"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isQueueLoading ? "animate-spin" : ""}`} /> Refresh
                  </button>
                  {queueItems.some(q => q.status === "FAILED") && (
                    <button
                      onClick={handleRetryAllFailed}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-sm"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Retry All Failed ({queueItems.filter(q => q.status === "FAILED").length})
                    </button>
                  )}
                </div>
              </div>

              {isQueueLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-450">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                  <p className="text-xs font-mono">Synchronizing outbox priority queue...</p>
                </div>
              ) : queueItems.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-950/20">
                  <Mail className="w-10 h-10 text-slate-300 dark:text-slate-750 mx-auto mb-3" />
                  <p className="text-xs font-semibold text-slate-550 dark:text-slate-400">Queue is empty</p>
                  <p className="text-[10px] text-slate-400 mt-1 max-w-sm mx-auto">
                    Leads added to this campaign will be automatically processed and enqueued when the campaign is running.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Summary Badges */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pb-2">
                    <div className="bg-white dark:bg-slate-950/40 border border-slate-150 dark:border-slate-850 p-2 rounded-lg text-center">
                      <span className="text-[10px] text-slate-400 block uppercase font-mono font-semibold">Total Queued</span>
                      <span className="text-base font-bold text-slate-750 dark:text-slate-200 mt-0.5 block">{queueItems.length}</span>
                    </div>
                    <div className="bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-950/30 p-2 rounded-lg text-center">
                      <span className="text-[10px] text-amber-600 block uppercase font-mono font-semibold">Scheduled</span>
                      <span className="text-base font-bold text-amber-700 mt-0.5 block">
                        {queueItems.filter(q => q.status === "QUEUED").length}
                      </span>
                    </div>
                    <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-950/30 p-2 rounded-lg text-center">
                      <span className="text-[10px] text-blue-600 block uppercase font-mono font-semibold">Sending</span>
                      <span className="text-base font-bold text-blue-700 mt-0.5 block">
                        {queueItems.filter(q => q.status === "PENDING").length}
                      </span>
                    </div>
                    <div className="bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-950/30 p-2 rounded-lg text-center">
                      <span className="text-[10px] text-rose-600 block uppercase font-mono font-semibold">Failed</span>
                      <span className="text-base font-bold text-rose-700 mt-0.5 block">
                        {queueItems.filter(q => q.status === "FAILED" || q.attempts >= 3).length}
                      </span>
                    </div>
                  </div>

                  {/* List */}
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-950/10">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 text-[10px] font-mono uppercase tracking-wider">
                          <th className="p-3">Lead / Recipient</th>
                          <th className="p-3">Subject / Pitch</th>
                          <th className="p-3">Priority</th>
                          <th className="p-3">Scheduled Delivery</th>
                          <th className="p-3">Attempts</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150 dark:divide-slate-850">
                        {queueItems.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20 transition-all">
                            <td className="p-3">
                              <div className="font-semibold text-slate-850 dark:text-slate-200">{item.to}</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {item.id.substring(0, 14)}...</div>
                            </td>
                            <td className="p-3 max-w-xs">
                              <div className="font-medium truncate text-slate-750 dark:text-slate-350">{item.subject}</div>
                              <div className="text-[10px] text-slate-400 truncate mt-0.5">{item.body}</div>
                            </td>
                            <td className="p-3">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                                item.priority === 1
                                  ? "bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/30"
                                  : item.priority === 3
                                  ? "bg-slate-50 dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-800"
                                  : "bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/30"
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  item.priority === 1 ? "bg-rose-500" : item.priority === 3 ? "bg-slate-400" : "bg-amber-500"
                                }`}></span>
                                {item.priority === 1 ? "High" : item.priority === 3 ? "Low" : "Medium"}
                              </span>
                            </td>
                            <td className="p-3 text-slate-550 dark:text-slate-450 font-mono">
                              <div>{new Date(item.scheduledAt).toLocaleDateString()}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5">{new Date(item.scheduledAt).toLocaleTimeString()}</div>
                            </td>
                            <td className="p-3 font-mono text-slate-650 dark:text-slate-350">
                              {item.attempts} / 3
                            </td>
                            <td className="p-3">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                item.status === "SENT"
                                  ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/30"
                                  : item.status === "PENDING"
                                  ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900/30 animate-pulse"
                                  : item.status === "FAILED"
                                  ? "bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/30"
                                  : "bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/30"
                              }`}>
                                {item.status}
                              </span>
                              {item.errorMessage && (
                                <p className="text-[9px] text-rose-500 font-mono mt-1 max-w-[150px] truncate" title={item.errorMessage}>
                                  {item.errorMessage}
                                </p>
                              )}
                            </td>
                            <td className="p-3 text-right space-x-1.5">
                              {(item.status === "FAILED" || item.status === "QUEUED") && (
                                <button
                                  onClick={() => handleRetryQueueItem(item.id)}
                                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-all cursor-pointer inline-block"
                                  title="Send / Retry Now"
                                >
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteQueueItem(item.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-all cursor-pointer inline-block"
                                title="Remove / Cancel"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* CREATE CAMPAIGN POPUP MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-none" id="modal-create-campaign">
          <div className="bg-white border border-slate-200 w-full max-w-xl rounded-lg overflow-hidden flex flex-col justify-between shadow-2xl">
            <div className="p-4.5 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xs font-display font-bold text-slate-800 uppercase tracking-wide">Create New Cold outreach Sequence</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-650 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4.5 space-y-3.5">
              <div>
                <label className="text-[10px] font-mono text-slate-400 block mb-1">Campaign title</label>
                <input
                  type="text"
                  placeholder="E.g., Series Round-A Q3 Outbound Outreach"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-700 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-400 block mb-1">Subject Heading</label>
                <input
                  type="text"
                  placeholder="Quick brainstorm for {{company}}"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-700 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-400 block mb-1">Pitch Template</label>
                <textarea
                  rows={5}
                  placeholder="Hi {{firstName}}, wondering how {{company}} manages cold email reputation..."
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-105 bg-slate-50/70 flex justify-end gap-2 text-xs">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleLaunchCampaign}
                disabled={!newCampaignName}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-semibold rounded-lg cursor-pointer transition-all shadow-sm"
              >
                Create Campaign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI RESEARCH & ENRICHMENT INSPECTOR OVERLAY MODAL */}
      {selectedResearchLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4 overflow-y-auto" id="ai-research-inspector-modal">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-850">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-lg border border-indigo-500/10">
                  {(selectedResearchLead.company || "E")[0]}
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    {selectedResearchLead.company} Intelligence Hub
                    {selectedResearchLead.aiResearch?.aiLeadScore && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                        Lead Score: {selectedResearchLead.aiResearch.aiLeadScore}/100
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    Contact: {selectedResearchLead.firstName} {selectedResearchLead.lastName} • {selectedResearchLead.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedResearchLead(null)}
                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-500 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Sub-Tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 gap-6">
              {["enrichment", "research", "sequence"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setInspectorTab(tab as any)}
                  className={`py-3 text-xs uppercase font-bold tracking-wider cursor-pointer border-b-2 transition-all ${
                    inspectorTab === tab
                      ? "text-indigo-650 dark:text-indigo-400 border-indigo-500"
                      : "text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border-transparent"
                  }`}
                >
                  {tab === "enrichment" ? "🌐 Lead Enrichment Scrape" : tab === "research" ? "🔬 Deep AI Research" : "✉ Follow-Up Sequence"}
                </button>
              ))}
            </div>

            {/* Modal Body Scroll Container */}
            <div className="p-6 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/20 flex-1 space-y-6">
              
              {inspectorTab === "enrichment" && (
                <div className="space-y-6">
                  {/* Grid of details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Basic Enrichment */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                      <h4 className="text-[11px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">Business Identity</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/40">
                          <span className="text-slate-400 dark:text-slate-550">Website</span>
                          <a href={selectedResearchLead.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 font-medium truncate max-w-xs">{selectedResearchLead.website || "N/A"}</a>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/40">
                          <span className="text-slate-400 dark:text-slate-550">Industry</span>
                          <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedResearchLead.industry || "N/A"}</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/40">
                          <span className="text-slate-400 dark:text-slate-550">Employees</span>
                          <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedResearchLead.employees || "N/A"}</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-400 dark:text-slate-550">Hours</span>
                          <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedResearchLead.businessHours || "N/A"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Google Reviews & Booking */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                      <h4 className="text-[11px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">Reputation & Channels</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/40">
                          <span className="text-slate-400 dark:text-slate-550">Google Rating</span>
                          <span className="text-amber-600 dark:text-amber-400 font-bold">★ {selectedResearchLead.googleReviews?.rating || "N/A"}</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/40">
                          <span className="text-slate-400 dark:text-slate-550">Review Count</span>
                          <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedResearchLead.googleReviews?.reviewCount || "0"} reviews</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-400 dark:text-slate-550">Booking / Calendar Link</span>
                          {selectedResearchLead.bookingLinks ? (
                            <a href={selectedResearchLead.bookingLinks} target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 font-medium truncate max-w-xs">{selectedResearchLead.bookingLinks}</a>
                          ) : (
                            <span className="text-slate-450 italic">None found</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Services */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
                      <h4 className="text-[11px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">Services Scraped</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedResearchLead.services && selectedResearchLead.services.length > 0 ? (
                          selectedResearchLead.services.map((srv, idx) => (
                            <span key={idx} className="bg-slate-105 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-[10.5px] px-2.5 py-1 rounded-md border border-slate-200/40 dark:border-slate-700/40 font-medium">{srv}</span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-450 italic">No specific services loaded</span>
                        )}
                      </div>
                    </div>

                    {/* Technologies */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
                      <h4 className="text-[11px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">Technologies Detected</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedResearchLead.technologies && selectedResearchLead.technologies.length > 0 ? (
                          selectedResearchLead.technologies.map((tech, idx) => (
                            <span key={idx} className="bg-blue-50 dark:bg-blue-950/40 text-blue-850 dark:text-blue-300 text-[10.5px] px-2.5 py-1 rounded-md border border-blue-100 dark:border-blue-900/20 font-mono">{tech}</span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-450 italic">No specific tech stack loaded</span>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Social Links */}
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
                    <h4 className="text-[11px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">Social Channels Crawler</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      {["linkedin", "facebook", "instagram", "twitter"].map((platform) => {
                        const val = (selectedResearchLead.socialLinks as any)?.[platform];
                        return (
                          <div key={platform} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 border border-slate-105 dark:border-slate-800/60 flex items-center justify-between">
                            <span className="capitalize font-semibold text-slate-550 dark:text-slate-400">{platform}</span>
                            {val ? (
                              <a href={val} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline">Link</a>
                            ) : (
                              <span className="text-slate-400 text-[11px] italic">No profile</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Latest Posts */}
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
                    <h4 className="text-[11px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">Latest Social Media / Blog Posts</h4>
                    {selectedResearchLead.latestPosts && selectedResearchLead.latestPosts.length > 0 ? (
                      <div className="space-y-2">
                        {selectedResearchLead.latestPosts.map((post, idx) => (
                          <p key={idx} className="text-xs text-slate-650 dark:text-slate-350 bg-slate-50 dark:bg-slate-850 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 leading-relaxed font-serif italic">
                            "{post}"
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-455 italic">No recent posts crawl data found</p>
                    )}
                  </div>

                  {/* Key reviews if present */}
                  {selectedResearchLead.googleReviews?.keyReviews && selectedResearchLead.googleReviews.keyReviews.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
                      <h4 className="text-[11px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">Google Reviews Feed Highlights</h4>
                      <div className="space-y-2">
                        {selectedResearchLead.googleReviews.keyReviews.map((rev, idx) => (
                          <p key={idx} className="text-xs text-slate-650 dark:text-slate-355 bg-amber-50/20 dark:bg-amber-950/10 p-2.5 rounded-lg border border-amber-100/40 dark:border-amber-900/20 leading-relaxed italic">
                            "{rev}"
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}

              {inspectorTab === "research" && (
                <div className="space-y-6">
                  {/* Business Summary Card */}
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                    <h4 className="text-[11px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">AI Scraped Business Summary</h4>
                    <p className="text-xs text-slate-750 dark:text-slate-300 leading-relaxed font-serif">
                      {selectedResearchLead.aiResearch?.businessSummary || selectedResearchLead.businessDescription || "No summary generated"}
                    </p>
                  </div>

                  {/* Pain Points & Opportunities Bento */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-none">
                    
                    {/* Pain Points */}
                    <div className="bg-rose-50/30 dark:bg-rose-950/10 p-5 rounded-xl border border-rose-100 dark:border-rose-950/40 shadow-sm space-y-3.5">
                      <h4 className="text-[11px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1.5 font-display">
                        ⚠️ Identified Business Pain Points
                      </h4>
                      {selectedResearchLead.aiResearch?.painPoints && selectedResearchLead.aiResearch.painPoints.length > 0 ? (
                        <ul className="space-y-2">
                          {selectedResearchLead.aiResearch.painPoints.map((point, idx) => (
                            <li key={idx} className="text-xs text-slate-750 dark:text-slate-300 flex items-start gap-2 leading-relaxed">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-550 shrink-0 mt-1.5"></span>
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-450 italic">No pain points flagged yet</p>
                      )}
                    </div>

                    {/* Opportunities */}
                    <div className="bg-emerald-50/30 dark:bg-emerald-950/10 p-5 rounded-xl border border-emerald-100 dark:border-emerald-950/40 shadow-sm space-y-3.5">
                      <h4 className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 font-display">
                        🚀 Operational Opportunities
                      </h4>
                      {selectedResearchLead.aiResearch?.opportunities && selectedResearchLead.aiResearch.opportunities.length > 0 ? (
                        <ul className="space-y-2">
                          {selectedResearchLead.aiResearch.opportunities.map((opp, idx) => (
                            <li key={idx} className="text-xs text-slate-750 dark:text-slate-300 flex items-start gap-2 leading-relaxed">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 mt-1.5"></span>
                              <span>{opp}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-455 italic">No active optimization recommendations logged</p>
                      )}
                    </div>

                  </div>

                  {/* Improvement Suggestions */}
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3.5">
                    <h4 className="text-[11px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">Actionable Improvement Suggestions</h4>
                    {selectedResearchLead.aiResearch?.improvementSuggestions && selectedResearchLead.aiResearch.improvementSuggestions.length > 0 ? (
                      <div className="space-y-2">
                        {selectedResearchLead.aiResearch.improvementSuggestions.map((sug, idx) => (
                          <div key={idx} className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-850 p-3 rounded-lg border border-slate-105 dark:border-slate-800 leading-normal flex items-start gap-3">
                            <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">0{idx + 1}.</span>
                            <span>{sug}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-450 italic">No suggestions loaded yet</p>
                    )}
                  </div>

                </div>
              )}

              {inspectorTab === "sequence" && (
                <div className="space-y-6">
                  {selectedResearchLead.aiEmails ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-none" id="followups-sequence-viewer">
                      
                      {/* Step Chips selector on Left */}
                      <div className="md:col-span-1 flex flex-row md:flex-col gap-1 overflow-x-auto shrink-0 pb-2 md:pb-0" id="step-selector-pills">
                        {["initial", "followUp1", "followUp2", "followUp3"].map((step, idx) => (
                          <button
                            key={step}
                            onClick={() => setSelectedSequenceStep(step as any)}
                            className={`p-3 rounded-xl border text-left cursor-pointer transition-all shrink-0 md:shrink-1 ${
                              selectedSequenceStep === step
                                ? "bg-indigo-600/10 border-indigo-500"
                                : "bg-white dark:bg-slate-900 border-slate-205 dark:border-slate-800 hover:border-slate-300"
                            }`}
                          >
                            <span className="text-[9px] font-mono text-indigo-600 dark:text-indigo-400 block font-bold uppercase">Step 0{idx + 1}</span>
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1 block capitalize">{step === "initial" ? "Initial pitch" : step === "followUp1" ? "First Follow-up" : step === "followUp2" ? "Value Draft" : "Polite Exit"}</span>
                          </button>
                        ))}
                      </div>

                      {/* Display Selected Email draft on Right */}
                      {(() => {
                        const emailData = (selectedResearchLead.aiEmails as any)?.[selectedSequenceStep] as GeneratedEmailDetail | undefined;
                        if (!emailData) return <div className="md:col-span-3 text-xs text-slate-450 italic">No draft details found.</div>;

                        return (
                          <div className="md:col-span-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm" id="follow-up-inspector-detail">
                            
                            {/* Analytics and spam gauges */}
                            <div className="grid grid-cols-3 gap-3 pb-3 border-b border-slate-100 dark:border-slate-800/40">
                              <div className="bg-slate-50 dark:bg-slate-850 p-2.5 rounded-lg border border-slate-105 dark:border-slate-800/50">
                                <span className="text-[9px] font-mono text-slate-450 uppercase block font-semibold">Tone Dial</span>
                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mt-0.5 block truncate">{emailData.tone}</span>
                              </div>
                              <div className="bg-slate-50 dark:bg-slate-850 p-2.5 rounded-lg border border-slate-105 dark:border-slate-800/50">
                                <span className="text-[9px] font-mono text-slate-450 uppercase block font-semibold">Spam Score</span>
                                <span className={`text-xs font-bold mt-0.5 block ${emailData.spamScore < 2 ? "text-emerald-600" : emailData.spamScore < 4 ? "text-amber-600" : "text-rose-600"}`}>
                                  {emailData.spamScore}/10
                                </span>
                              </div>
                              <div className="bg-slate-50 dark:bg-slate-850 p-2.5 rounded-lg border border-slate-105 dark:border-slate-800/50">
                                <span className="text-[9px] font-mono text-slate-450 uppercase block font-semibold">Readability</span>
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-0.5 block">
                                  {emailData.readabilityScore}/100
                                </span>
                              </div>
                            </div>

                            {/* Email Subject & Preview */}
                            <div className="space-y-1.5 text-xs">
                              <div>
                                <span className="text-slate-400 font-mono text-[10px] block uppercase">Subject Line:</span>
                                <p className="font-bold text-slate-800 dark:text-slate-100 mt-0.5">{emailData.subject}</p>
                              </div>
                              <div>
                                <span className="text-slate-400 font-mono text-[10px] block uppercase mt-2">Inbox Preview Hook:</span>
                                <p className="text-slate-500 font-medium mt-0.5 italic">"{emailData.preview}"</p>
                              </div>
                            </div>

                            {/* Actual Email Draft Area */}
                            <div className="bg-slate-50/50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-105 dark:border-slate-805 text-xs font-serif leading-relaxed text-slate-750 dark:text-slate-300 space-y-3.5" id="rendered-sales-pitch-canvas">
                              <p className="font-semibold">{emailData.opening}</p>
                              <p className="whitespace-pre-line">{emailData.body}</p>
                              <p className="font-bold text-indigo-750 dark:text-indigo-300">{emailData.cta}</p>
                              <p className="whitespace-pre-line font-medium text-slate-500">{emailData.signature}</p>
                            </div>

                          </div>
                        );
                      })()}

                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center text-slate-400">
                      <Sparkles className="w-10 h-10 opacity-30 mb-2 text-indigo-500 animate-pulse" />
                      <p className="text-xs">No FOLLOW-UP sequence generated yet.</p>
                      <button
                        onClick={() => handleEnrichLead(selectedResearchLead.id)}
                        className="mt-3 bg-indigo-650 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg cursor-pointer transition-all shadow-sm flex items-center gap-1.5"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Generate Complete AI Research & Emails
                      </button>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50 dark:bg-slate-850 shrink-0">
              <button
                onClick={() => setSelectedResearchLead(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                Close Hub
              </button>
              <button
                onClick={() => handleEnrichLead(selectedResearchLead.id)}
                disabled={enrichingLeadId !== null}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-650 hover:bg-indigo-700 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 shadow-sm"
              >
                {enrichingLeadId ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Updating Scrape...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Force Re-scrawl & Enrichment
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
