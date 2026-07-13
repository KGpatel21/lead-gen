/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Search,
  Sparkles,
  RefreshCw,
  Download,
  Users,
  CheckCircle,
  Copy,
  Table,
  Plus,
  Linkedin,
  Instagram,
  MapPin,
  Twitter,
  ExternalLink,
  Check,
  Building,
  Mail,
  Phone
} from "lucide-react";
import { Campaign, Lead } from "../types";

// Premium avatars for realistic headshots
const AVATARS = [
  "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1534751516642-a131ffd1037f?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=120&h=120",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=120&h=120"
];

interface AiLeadFinderViewProps {
  campaigns: Campaign[];
  onCreateCampaign: (name: string, subject: string, body: string) => Promise<Campaign>;
  onRefreshAllData: () => void;
}

export default function AiLeadFinderView({
  campaigns,
  onCreateCampaign,
  onRefreshAllData
}: AiLeadFinderViewProps) {
  // Input fields state
  const [aiSearchKeyword, setAiSearchKeyword] = useState("");
  const [aiPlatformSelect, setAiPlatformSelect] = useState("LinkedIn Profiles");
  const [aiCountGoal, setAiCountGoal] = useState<number>(10);
  const [selectedCampId, setSelectedCampId] = useState("");
  
  // Create Campaign modal on the fly
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCampName, setNewCampName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [isCreatingCamp, setIsCreatingCamp] = useState(false);

  // Search execution state
  const [loading, setLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [foundLeads, setFoundLeads] = useState<Lead[]>([]);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  // Suggestions for rapid testing
  const suggestions = [
    { text: "Dentists in Austin", platform: "Google Maps Directories" },
    { text: "Real estate agents in Boston", platform: "LinkedIn Profiles" },
    { text: "Boutique coffee shops in Brooklyn", platform: "Instagram Outbound" },
    { text: "SaaS founders in SF", platform: "Twitter / X Channels" }
  ];

  const handleApplySuggestion = (text: string, platform: string) => {
    setAiSearchKeyword(text);
    setAiPlatformSelect(platform);
  };

  const handleCreateCampaignQuick = async () => {
    if (!newCampName.trim()) return;
    setIsCreatingCamp(true);
    try {
      const defaultSubject = newSubject || `Quick question regarding ${newCampName}`;
      const defaultBody = newBody || `Hi {{firstName}},\n\nI was looking into {{company}} and realized you might benefit from our integrated outbound pipeline.\n\nLet me know if you are free next week.\n\nBest regards,\nKrutarth Patel`;
      const created = await onCreateCampaign(newCampName, defaultSubject, defaultBody);
      setSelectedCampId(created.id);
      setNewCampName("");
      setNewSubject("");
      setNewBody("");
      setShowCreateModal(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreatingCamp(false);
    }
  };

  const handleFindLeads = async () => {
    if (!aiSearchKeyword.trim()) return;
    setLoading(true);
    setFeedbackMsg("");
    setFoundLeads([]);
    
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
        // If they also selected a campaign, import them straight into it
        let campaignText = "";
        if (selectedCampId) {
          const resImport = await fetch(`/api/campaigns/${selectedCampId}/leads/bulk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leads: leadsToImport })
          });
          if (resImport.ok) {
            const campaign = campaigns.find(c => c.id === selectedCampId);
            campaignText = ` and imported straight into your "${campaign?.name || 'Selected'}" campaign!`;
          }
        }
        
        setFoundLeads(leadsToImport);
        setFeedbackMsg(`🚀 AI successfully generated ${leadsToImport.length} leads${campaignText}`);
        onRefreshAllData();
      } else {
        setFeedbackMsg("No leads were found. Please try a different query.");
      }
    } catch (err: any) {
      console.error(err);
      setFeedbackMsg(`Error finding leads: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadExcel = () => {
    if (foundLeads.length === 0) return;
    const headers = ["First Name", "Last Name", "Email", "Company", "Phone", "Platform", "Profile URL", "Personalized Line"];
    const rows = foundLeads.map(l => [
      l.firstName || "",
      l.lastName || "",
      l.email || "",
      l.company || "",
      l.phone || "",
      l.platform || "",
      l.profileUrl || "",
      l.personalizedLine || ""
    ]);
    
    const csvString = [headers.join(","), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${(aiSearchKeyword || "outbound").toLowerCase().replace(/[^a-z0-9]/g, "_")}_leads_spreadsheet.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEmail(text);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  // Get social badge styling
  const getPlatformBadge = (platform?: string) => {
    const name = platform || "LinkedIn";
    if (name.includes("Maps") || name.includes("Google")) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30 px-2 py-0.5 rounded-full">
          <MapPin className="w-3 h-3 shrink-0" />
          Google Maps
        </span>
      );
    } else if (name.includes("Instagram")) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400 border border-pink-100 dark:border-pink-900/30 px-2 py-0.5 rounded-full">
          <Instagram className="w-3 h-3 shrink-0" />
          Instagram
        </span>
      );
    } else if (name.includes("Twitter") || name.includes("X")) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border border-sky-100 dark:border-sky-900/30 px-2 py-0.5 rounded-full">
          <Twitter className="w-3 h-3 shrink-0" />
          Twitter / X
        </span>
      );
    } else {
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30 px-2 py-0.5 rounded-full">
          <Linkedin className="w-3 h-3 shrink-0" />
          LinkedIn
        </span>
      );
    }
  };

  return (
    <div className="flex-1 p-8 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 h-screen overflow-y-auto font-sans transition-colors duration-200" id="lead-finder-view-container">
      
      {/* Header Banner */}
      <div className="mb-6" id="lead-finder-header">
        <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider">AI Lead Sourcing Hub</span>
        <h1 className="text-3xl font-display font-semibold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
          <Search className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
          Autonomous AI Lead Finder
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Scrape verified business profiles, emails, and phone numbers from popular social channels and auto-draft personalized cold intro lines instantly.
        </p>
      </div>

      {/* Main Grid: Control Panel (Left 1/3) & Results Spreadsheet (Right 2/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start" id="lead-finder-grid">
        
        {/* Left Side: Parameters Form Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-5" id="lead-finder-form">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <Sparkles className="w-5 h-5 text-indigo-500 animate-pulse" />
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">Target Search Profile</h2>
          </div>

          <div className="space-y-4">
            
            {/* Suggestions Buttons */}
            <div>
              <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 uppercase block mb-1.5 tracking-wide">Suggested Sourcing Triggers</span>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplySuggestion(s.text, s.platform)}
                    className="text-[10px] bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-md transition-colors cursor-pointer"
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            </div>

            {/* Keyword Input */}
            <div>
              <label className="text-[10px] font-mono text-slate-400 dark:text-slate-500 block mb-1 uppercase tracking-wide">Sourcing Query Prompt</label>
              <input
                type="text"
                placeholder="e.g. Dentists in Austin"
                value={aiSearchKeyword}
                onChange={(e) => setAiSearchKeyword(e.target.value)}
                className="w-full text-xs bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg px-3 py-2.5 outline-none text-slate-850 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-500 font-mono"
              />
            </div>

            {/* Source Network Dropdown */}
            <div>
              <label className="text-[10px] font-mono text-slate-400 dark:text-slate-500 block mb-1 uppercase tracking-wide">Source Network Channel</label>
              <select
                value={aiPlatformSelect}
                onChange={(e) => setAiPlatformSelect(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 text-xs py-2.5 px-3 rounded-lg outline-none font-mono text-slate-850 dark:text-slate-100 focus:border-indigo-500"
              >
                <option value="LinkedIn Profiles">LinkedIn Only</option>
                <option value="Google Maps Directories">Google Maps Directories</option>
                <option value="Instagram Outbound">Instagram Outbound</option>
                <option value="Twitter / X Channels">Twitter / X Channels</option>
                <option value="All Social Platforms">All Platforms Combined</option>
              </select>
            </div>

            {/* Direct Campaign Binding Link */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] font-mono text-slate-400 dark:text-slate-500 block uppercase tracking-wide">Auto-link to Campaign</label>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 font-semibold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> New Campaign
                </button>
              </div>
              <select
                value={selectedCampId}
                onChange={(e) => setSelectedCampId(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 text-xs py-2.5 px-3 rounded-lg outline-none font-mono text-slate-850 dark:text-slate-100 focus:border-indigo-500"
              >
                <option value="">-- Keep in Local Spreadsheet Only --</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    📥 {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Leads Count Picker */}
            <div>
              <label className="text-[10px] font-mono text-slate-400 dark:text-slate-500 block mb-1 uppercase tracking-wide">Quantity to Generate</label>
              <div className="grid grid-cols-4 gap-1.5">
                {[5, 10, 20, 30].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setAiCountGoal(num)}
                    className={`text-xs py-1.5 rounded-lg border font-mono font-bold transition-all cursor-pointer ${
                      aiCountGoal === num
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-750 text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Feedback messages */}
            {feedbackMsg && (
              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[11px] rounded-lg leading-relaxed font-mono">
                {feedbackMsg}
              </div>
            )}

            {/* Run Button */}
            <button
              onClick={handleFindLeads}
              disabled={loading || !aiSearchKeyword.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 text-white text-xs font-semibold py-3 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating verified lead spreadsheet...
                </>
              ) : (
                <>
                  <Search className="w-4.5 h-4.5" />
                  Find and Scrape Social Leads
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Side: Interactive Excel Grid Display */}
        <div className="lg:col-span-2 space-y-4" id="lead-finder-results-section">
          
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col" id="excel-card-container">
            
            {/* Spreadsheet Header Controller Bar */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex justify-between items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Table className="w-4.5 h-4.5 text-indigo-500" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Microsoft Excel Format - Live Leads Grid
                </h3>
              </div>

              {foundLeads.length > 0 && (
                <button
                  onClick={handleDownloadExcel}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download CSV Spreadsheet
                </button>
              )}
            </div>

            {/* spreadsheet body */}
            {foundLeads.length === 0 ? (
              <div className="p-16 flex flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500">
                <Users className="w-12 h-12 opacity-25 mb-4 text-indigo-500" />
                <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Your Spreadsheet is Empty</h4>
                <p className="text-xs max-w-sm leading-normal">
                  Type a niche above (like <span className="font-mono text-indigo-500 dark:text-indigo-400">'Real estate agents in Boston'</span>) and click find. Real-time grounded profiles will load here in an interactive Microsoft Excel format.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-sans text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-850/40 text-[10px] font-mono text-slate-450 uppercase tracking-wider select-none">
                      <th className="px-4 py-3 border-r border-slate-200 dark:border-slate-800">#</th>
                      <th className="px-4 py-3 border-r border-slate-200 dark:border-slate-800">Lead Photo</th>
                      <th className="px-4 py-3 border-r border-slate-200 dark:border-slate-800">First & Last Name</th>
                      <th className="px-4 py-3 border-r border-slate-200 dark:border-slate-800">Email Address</th>
                      <th className="px-4 py-3 border-r border-slate-200 dark:border-slate-800">Company Name</th>
                      <th className="px-4 py-3 border-r border-slate-200 dark:border-slate-800">Phone</th>
                      <th className="px-4 py-3 border-r border-slate-200 dark:border-slate-800">Platform Badge</th>
                      <th className="px-4 py-3 border-r border-slate-200 dark:border-slate-800">Profile URL</th>
                      <th className="px-4 py-3">AI Personalized Icebreaker</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {foundLeads.map((lead, idx) => {
                      // pick a beautiful face avatar deterministically
                      const avatarUrl = AVATARS[idx % AVATARS.length];
                      return (
                        <tr
                          key={lead.id}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-850/40 transition-colors"
                        >
                          {/* Row Index */}
                          <td className="px-4 py-3.5 border-r border-slate-200 dark:border-slate-800 font-mono text-[10px] text-slate-400 text-center bg-slate-50/30 dark:bg-slate-900/20 font-bold">
                            {idx + 1}
                          </td>

                          {/* Profile Headshot Image */}
                          <td className="px-4 py-3.5 border-r border-slate-200 dark:border-slate-800 text-center">
                            <div className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 overflow-hidden mx-auto shadow-sm">
                              <img
                                src={avatarUrl}
                                alt="Lead Face"
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          </td>

                          {/* First & Last Name */}
                          <td className="px-4 py-3.5 border-r border-slate-200 dark:border-slate-800 font-semibold text-slate-800 dark:text-slate-100 font-display">
                            {lead.firstName || "Fallback"} {lead.lastName || "Lead"}
                          </td>

                          {/* Email copy address */}
                          <td className="px-4 py-3.5 border-r border-slate-200 dark:border-slate-800 font-mono text-[11px] text-indigo-650 dark:text-indigo-400 font-medium">
                            <div className="flex items-center gap-1.5 justify-between">
                              <span className="truncate max-w-[130px]">{lead.email}</span>
                              <button
                                onClick={() => copyToClipboard(lead.email)}
                                className="p-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-500 text-slate-400 hover:text-indigo-600 rounded transition-colors cursor-pointer shrink-0"
                                title="Copy Email"
                              >
                                {copiedEmail === lead.email ? (
                                  <Check className="w-3 h-3 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </td>

                          {/* Company Name */}
                          <td className="px-4 py-3.5 border-r border-slate-200 dark:border-slate-800 font-semibold text-slate-700 dark:text-slate-300">
                            {lead.company || "Enterprise Solutions"}
                          </td>

                          {/* Phone */}
                          <td className="px-4 py-3.5 border-r border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {lead.phone || "No phone listed"}
                          </td>

                          {/* Platform Badge */}
                          <td className="px-4 py-3.5 border-r border-slate-200 dark:border-slate-800 text-center">
                            {getPlatformBadge(lead.platform)}
                          </td>

                          {/* Profile Link */}
                          <td className="px-4 py-3.5 border-r border-slate-200 dark:border-slate-800 text-center">
                            <a
                              href={lead.profileUrl || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 font-mono text-[10px]"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Profile
                            </a>
                          </td>

                          {/* AI Personalized Intro line */}
                          <td className="px-4 py-3.5">
                            <p className="text-[10px] text-slate-550 dark:text-slate-400 italic bg-slate-50 dark:bg-slate-850 p-2 rounded-lg border border-slate-100 dark:border-slate-800 leading-normal min-w-[200px]">
                              "{lead.personalizedLine || "I was highly impressed by your business profile."}"
                            </p>
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

      {/* modal block for dynamic campaign generation */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="font-display font-semibold text-slate-850 dark:text-white text-lg">
              Create New Cold Email Campaign
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-mono text-slate-450 dark:text-slate-500 uppercase block mb-1">Campaign Name</label>
                <input
                  type="text"
                  placeholder="e.g. Chicago Chiropractors Sequence"
                  value={newCampName}
                  onChange={(e) => setNewCampName(e.target.value)}
                  className="w-full text-xs bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg px-3 py-2 outline-none text-slate-800 dark:text-slate-100 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-450 dark:text-slate-500 uppercase block mb-1">Subject Line</label>
                <input
                  type="text"
                  placeholder="e.g. Growth options for {{company}}"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  className="w-full text-xs bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg px-3 py-2 outline-none text-slate-800 dark:text-slate-100 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-450 dark:text-slate-500 uppercase block mb-1">Email Body Template</label>
                <textarea
                  rows={4}
                  placeholder={`Hi {{firstName}},\n\n{{personalizedLine}}\n\nI love what you're doing with {{company}}.`}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg p-2.5 outline-none text-slate-800 dark:text-slate-100 focus:border-indigo-500 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3.5 py-1.5 text-xs text-slate-555 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCampaignQuick}
                disabled={isCreatingCamp || !newCampName.trim()}
                className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-lg cursor-pointer transition-all flex items-center gap-1 shadow-sm"
              >
                {isCreatingCamp && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Save Campaign
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
