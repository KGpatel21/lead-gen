/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  LayoutDashboard,
  Mail,
  Inbox,
  Globe,
  Flame,
  Bot,
  Settings,
  Users2,
  Sparkles,
  ShieldCheck,
  Sun,
  Moon,
  Search,
  Sliders
} from "lucide-react";

interface SidebarProps {
  currentView: string;
  setView: (view: string) => void;
  activeCampaigns: number;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}

export default function Sidebar({ currentView, setView, activeCampaigns, theme, setTheme }: SidebarProps) {
  const sections = [
    {
      title: "COLD EMAILING PIPELINE",
      items: [
        { id: "dashboard", label: "Analytics Dashboard", icon: LayoutDashboard },
        { id: "crm", label: "CRM Pipeline Board", icon: Users2, badge: "LIVE" },
        { id: "lead-finder", label: "AI Lead Finder", icon: Search, badge: "NEW" },
        { id: "campaigns", label: "Outreach Campaigns", icon: Mail, badge: activeCampaigns > 0 ? String(activeCampaigns) : undefined },
        { id: "smtp", label: "SMTP Accounts Router", icon: Inbox },
        { id: "domains", label: "DNS & Verified Domains", icon: Globe },
        { id: "replies", label: "Replies Intelligent Box", icon: Sparkles },
        { id: "ai-generator", label: "Template Custom Writer", icon: Bot },
      ]
    },
    {
      title: "SYSTEM OPTIONS",
      items: [
        { id: "enterprise", label: "Enterprise & Deliverability Hub", icon: Sliders, badge: "PRO" },
        { id: "team", label: "Team Management Roster", icon: ShieldCheck },
        { id: "settings", label: "Campaign Settings", icon: Settings },
      ]
    }
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between h-screen sticky top-0 font-sans" id="sidebar-container">
      {/* Top Brand Logo */}
      <div className="p-4 border-b border-slate-800" id="brand-logo">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-md shadow-blue-500/10" id="brand-icon">
            <Flame className="w-4.5 h-4.5 text-white animate-pulse" />
          </div>
          <div>
            <span className="font-display font-bold text-sm tracking-tight text-white">Outbound.AI</span>
            <p className="text-[9px] font-mono text-blue-400 font-semibold tracking-wider uppercase">Pipeline Engine</p>
          </div>
        </div>
      </div>

      {/* Main Menu Links with Hierarchical Headings */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto" id="sidebar-nav">
        {sections.map((sect, sectIdx) => (
          <div key={sectIdx} className="space-y-1.5" id={`sidebar-sect-${sectIdx}`}>
            <span className="text-[9px] font-mono text-slate-500 font-bold uppercase tracking-widest px-3 block">
              {sect.title}
            </span>
            
            <div className="space-y-0.5">
              {sect.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    id={`nav-link-${item.id}`}
                    onClick={() => setView(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all duration-150 cursor-pointer ${
                      isActive
                        ? "bg-blue-600/15 text-blue-400 border-l-2 border-blue-500 font-bold"
                        : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? "text-blue-400" : "text-slate-500"}`} />
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    {item.badge && (
                      <span className={`text-[8.5px] px-1.5 py-0.2 rounded font-bold uppercase ${
                        item.badge === "AI" 
                          ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/20"
                          : "bg-blue-600 text-white"
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom User Rep Card */}
      <div className="p-3 border-t border-slate-800 bg-slate-900" id="sidebar-footer">
        {/* Premium Theme Switcher */}
        <div className="px-1 pb-2.5 mb-2.5 border-b border-slate-800/80 flex items-center justify-between" id="theme-toggle-panel">
          <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">Appearance</span>
          <div className="flex bg-slate-950 p-0.5 rounded-md border border-slate-800/80" id="theme-switch-container">
            <button
              onClick={() => setTheme("light")}
              className={`px-2 py-1 rounded transition-all flex items-center gap-1 text-[9px] font-bold cursor-pointer ${
                theme === "light"
                  ? "bg-slate-800 text-blue-400 font-extrabold"
                  : "text-slate-500 hover:text-slate-305"
              }`}
              id="btn-theme-light"
            >
              <Sun className="w-3 h-3" />
              Light
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`px-2 py-1 rounded transition-all flex items-center gap-1 text-[9px] font-bold cursor-pointer ${
                theme === "dark"
                  ? "bg-slate-800 text-blue-400 font-extrabold"
                  : "text-slate-500 hover:text-slate-305"
              }`}
              id="btn-theme-dark"
            >
              <Moon className="w-3 h-3" />
              Dark
            </button>
          </div>
        </div>

        <div className="p-2.5 bg-slate-800/40 rounded-lg border border-slate-800/60" id="user-profile-summary">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-sm bg-slate-700 flex items-center justify-center font-bold text-[10px] text-blue-400 border border-blue-500/20">
              KP
            </div>
            <div className="overflow-hidden">
              <p className="text-[11px] font-semibold text-slate-200 truncate">Krutarth Patel</p>
              <span className="text-[9px] font-mono text-emerald-400 flex items-center gap-1 font-semibold">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-ping"></span>
                SaaS Administrator
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
