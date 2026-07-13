/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  Mail,
  Send,
  Eye,
  MessageSquare,
  Activity,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  Inbox,
  CheckCircle,
  Clock,
  ExternalLink,
  Bot
} from "lucide-react";
import { Reply, ReplySentiment } from "../types";

interface DashboardViewProps {
  stats: {
    totalSent: number;
    avgOpenRate: number;
    avgReplyRate: number;
    avgBounceRate: number;
    activeCampaignsCount: number;
    avgReputation: number;
    avgDomainHealth: number;
    recentReplies: Reply[];
    timeline: {
      sentOverTime: { date: string; sent: number; opens: number; replies: number }[];
      domainReputationTrend: { date: string; avgScore: number }[];
      warmupTrend: { date: string; sent: number; recovered: number }[];
      repliesSentimentBreakdown: { name: string; value: number; color: string }[];
    };
  };
  onNavigate: (view: string) => void;
  onReadReply: (id: string) => void;
}

export default function DashboardView({ stats, onNavigate, onReadReply }: DashboardViewProps) {
  // Simple calculated metrics
  const activeSmtpHourlyRotations = 120; // 120/hour limit
  const spamReputationHealth = stats.avgReputation;

  // Custom premium SVG-based charts to avoid bundle conflicts and ensure fluid rendering in iframe
  const renderSentChart = () => {
    const data = stats.timeline.sentOverTime;
    const padding = 40;
    const height = 180;
    const width = 500;
    const maxVal = Math.max(...data.map(d => d.sent)) || 100;

    const points = data.map((d, index) => {
      const x = padding + (index * (width - padding * 2)) / (data.length - 1);
      const y = height - padding - (d.sent / maxVal) * (height - padding * 2);
      return { x, y, ...d };
    });

    const openPoints = data.map((d, index) => {
      const x = padding + (index * (width - padding * 2)) / (data.length - 1);
      const y = height - padding - (d.opens / maxVal) * (height - padding * 2);
      return { x, y };
    });

    const pathD = points.length > 0 ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ") : "";
    const openPathD = openPoints.length > 0 ? `M ${openPoints[0].x} ${openPoints[0].y} ` + openPoints.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ") : "";

    const areaD = points.length > 0 ? `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z` : "";

    return (
      <svg className="w-full h-full text-indigo-500" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Dynamic Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
          const y = padding + ratio * (height - padding * 2);
          return (
            <line
              key={idx}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="4 4"
              className="text-slate-200 dark:text-slate-800"
            />
          );
        })}

        {/* Fill Area */}
        {areaD && <path d={areaD} fill="url(#chartGradient)" />}

        {/* Lines */}
        {pathD && <path d={pathD} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />}
        {openPathD && <path d={openPathD} fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3" />}

        {/* Interactive Dots */}
        {points.map((p, idx) => (
          <g key={idx} className="group cursor-pointer">
            <circle cx={p.x} cy={p.y} r="3.5" fill="#2563eb" stroke="#ffffff" strokeWidth="1.5" />
            <circle cx={p.x} cy={p.y} r="8" fill="#2563eb" fillOpacity="0" className="hover:fill-opacity-10 transition-all duration-150" />
          </g>
        ))}

        {/* Date Labels */}
        {points.map((p, idx) => (
          <text
            key={idx}
            x={p.x}
            y={height - 10}
            fill="#64748b"
            fontSize="10"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {p.date}
          </text>
        ))}
      </svg>
    );
  };

  return (
    <div className="flex-1 p-6 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto font-sans transition-colors duration-200" id="dashboard-view-wrapper">
      
      {/* Upper Control Bar */}
      <div className="flex justify-between items-center mb-6" id="dashboard-header-bar">
        <div>
          <span className="text-[9px] font-mono text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">Enterprise Outbound Overview</span>
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white tracking-tight">Outbound Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onNavigate("campaigns")}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3.5 py-2 rounded-lg cursor-pointer shadow-sm transition-all"
            id="dashboard-btn-create"
          >
            <Mail className="w-3.5 h-3.5" />
            Launch Campaign
          </button>
          <button
            onClick={() => onNavigate("ai-generator")}
            className="flex items-center gap-1.5 bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium px-3.5 py-2 rounded-lg cursor-pointer shadow-sm transition-all"
            id="dashboard-btn-generator"
          >
            <Bot className="w-3.5 h-3.5 text-blue-550" />
            Draft Pitch with AI
          </button>
        </div>
      </div>

      {/* Main SaaS Quick Stats Counters */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" id="dashboard-counters-grid">
        {/* Email Dispatches */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 relative overflow-hidden shadow-sm transition-colors" id="stat-sent">
          <div className="absolute right-4 top-4 bg-blue-50 dark:bg-blue-950/20 p-2 rounded-lg border border-blue-100 dark:border-blue-900/30">
            <Send className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Emails Dispatched</p>
          <h3 className="text-2xl font-display font-bold mt-1.5 text-slate-900 dark:text-white">{stats.totalSent.toLocaleString()}</h3>
          <p className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold mt-1.5 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            +18% since previous week
          </p>
        </div>

        {/* Avg Open Rate */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 relative overflow-hidden shadow-sm transition-colors" id="stat-opens">
          <div className="absolute right-4 top-4 bg-emerald-50 dark:bg-emerald-950/20 p-2 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
            <Eye className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Average Open Rate</p>
          <h3 className="text-2xl font-display font-bold mt-1.5 text-slate-900 dark:text-white">{stats.avgOpenRate}%</h3>
          <div className="w-full bg-slate-100 dark:bg-slate-850 h-1.5 rounded-full mt-2.5 overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${stats.avgOpenRate}%` }}></div>
          </div>
        </div>

        {/* Reply Conversions */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 relative overflow-hidden shadow-sm transition-colors" id="stat-replies">
          <div className="absolute right-4 top-4 bg-sky-50 dark:bg-sky-950/20 p-2 rounded-lg border border-sky-100 dark:border-sky-900/30">
            <MessageSquare className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          </div>
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Response Conversions</p>
          <h3 className="text-2xl font-display font-bold mt-1.5 text-slate-900 dark:text-white">{stats.avgReplyRate}%</h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-450 font-semibold mt-1.5 flex items-center gap-1">
            Industry Benchmark: <span className="text-emerald-600 dark:text-emerald-400 font-bold">6-8%</span>
          </p>
        </div>

        {/* Active Campaigns */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 relative overflow-hidden shadow-sm transition-colors" id="stat-active">
          <div className="absolute right-4 top-4 bg-amber-50 dark:bg-amber-950/20 p-2 rounded-lg border border-amber-100 dark:border-amber-900/30">
            <Activity className="w-4 h-4 text-amber-600/90" />
          </div>
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Active Campaigns</p>
          <h3 className="text-2xl font-display font-bold mt-1.5 text-slate-900 dark:text-white">{stats.activeCampaignsCount}</h3>
          <p className="text-[10px] text-amber-600 dark:text-amber-450 font-semibold mt-1.5 flex items-center gap-1">
            {stats.activeCampaignsCount > 0 ? "SMTP Accounts Rotating" : "No campaign running"}
          </p>
        </div>
      </div>

      {/* Main Multi-Sector Visual Charts & Delivery Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6" id="dashboard-graphics-block">
        
        {/* Core Dispatch Speed Line Graph */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 lg:col-span-2 flex flex-col justify-between shadow-sm transition-colors animate-none" id="sent-trend-card">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Deliverability Metrics over Time</h2>
              <p className="text-[11px] text-slate-400 dark:text-slate-400">Comparing total emails sent (solid) vs opened (dotted)</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-medium">
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-350">
                <span className="w-2 h-2 rounded-full bg-blue-600"></span> Sent
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-350">
                <span className="w-2 h-2 rounded bg-emerald-500"></span> Opens
              </span>
            </div>
          </div>
          <div className="h-40 w-full" id="svg-sent-chart-container">
            {renderSentChart()}
          </div>
        </div>

        {/* Sender Deliverability & Alignment Risk */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between shadow-sm transition-colors animate-none" id="sender-health-card">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 animate-none">Inbox Health Diagnostics</h2>
            <p className="text-[11px] text-slate-400 dark:text-slate-400 mb-4">Collective reputation scores of connected inboxes</p>
            
            {/* Reputation Gauges */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-350 mb-1">
                  <span>Collective Sender Reputation</span>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">{spamReputationHealth}%</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${spamReputationHealth}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-350 mb-1">
                  <span>Domain DNS Verification</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{stats.avgDomainHealth}%</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${stats.avgDomainHealth}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-50/50 dark:bg-blue-955/20 border border-blue-100 dark:border-blue-900/40 p-3 rounded-lg text-xs space-y-1 mt-4">
            <span className="font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Good Health (No blacklist matches)
            </span>
            <p className="text-slate-500 dark:text-slate-400 leading-normal text-[11px]">All outbound emails currently route with randomized delivery offsets mimicking human-like pacing.</p>
          </div>
        </div>
      </div>

      {/* Grid: Sentiment breakdown & Recent Incoming Prospects */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" id="dashboard-additional-metrics">
        {/* Sentiment Analysis Gauge */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm transition-colors" id="sentiment-analysis-widget">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1 font-display">Response Sentiment Analysis</h2>
          <p className="text-[11px] text-slate-400 dark:text-slate-450 mb-4">Leveraging AI to classify positive sales pipelines</p>
          
          <div className="space-y-3 mt-2">
            {stats.timeline.repliesSentimentBreakdown.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-xs text-slate-600 dark:text-slate-305">
                  <span className="flex items-center gap-1.5 font-medium text-[11px]">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }}></span>
                    {item.name}
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400 text-[11px]">{item.value}%</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${item.value}%`, backgroundColor: item.color }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent replies lists */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 lg:col-span-2 flex flex-col justify-between shadow-sm transition-colors" id="recent-replies-widget">
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 font-display">Target Prospect Replies</h2>
                <p className="text-[11px] text-slate-400 dark:text-slate-450">Real-time incoming IMAP reply feeds</p>
              </div>
              <button
                onClick={() => onNavigate("replies")}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-semibold flex items-center gap-1 cursor-pointer transition-all"
              >
                View Unified Mailbox
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>

            {stats.recentReplies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-slate-405">
                <Inbox className="w-8 h-8 opacity-30 mb-2 text-slate-300" />
                <p className="text-xs text-slate-400">Waiting for incoming sales responses...</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1" id="replies-scroller">
                {stats.recentReplies.map((reply) => {
                  const isInterested = reply.sentiment === ReplySentiment.INTERESTED || reply.sentiment === ReplySentiment.MEETING || reply.sentiment === ReplySentiment.PRICING;
                  const isNegative = reply.sentiment === ReplySentiment.SPAM;

                  return (
                    <div
                      key={reply.id}
                      onClick={() => onNavigate("replies")}
                      className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                        reply.isRead 
                          ? "bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800/60 hover:bg-slate-100/50 dark:hover:bg-slate-850" 
                          : "bg-blue-50/20 dark:bg-blue-950/15 border-blue-100/80 dark:border-blue-900/40 hover:bg-blue-50/30 dark:hover:bg-blue-950/25"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-150 truncate">{reply.firstName} {reply.lastName}</span>
                          <span className="text-[9px] font-mono text-slate-400 dark:text-slate-455 shrink-0">@{reply.company}</span>
                          {!reply.isRead && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0"></span>
                          )}
                        </div>
                        <p className="text-xs text-slate-800 dark:text-slate-200 font-medium truncate mb-0.5">{reply.subject}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{reply.body}</p>
                      </div>

                      <div className="shrink-0 flex flex-col items-end gap-1.5">
                        <span
                          className={`text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                            reply.sentiment === ReplySentiment.MEETING
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                              : reply.sentiment === ReplySentiment.PRICING
                              ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                              : reply.sentiment === ReplySentiment.INTERESTED
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                              : reply.sentiment === ReplySentiment.NOT_INTERESTED
                              ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                              : "bg-rose-50 text-rose-700 border border-rose-100 dark:bg-rose-950/25 dark:text-rose-400 dark:border-rose-900/30"
                          }`}
                        >
                          {reply.sentiment}
                        </span>
                        <span className="text-[9px] font-mono text-slate-400 dark:text-slate-450">
                          {new Date(reply.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
