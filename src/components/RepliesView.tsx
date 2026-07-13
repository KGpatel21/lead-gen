/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Inbox,
  Sparkles,
  Bot,
  Send,
  Check,
  RefreshCw,
  Mail,
  User,
  Clock,
  CheckCircle
} from "lucide-react";
import { Reply, ReplySentiment } from "../types";

interface RepliesViewProps {
  replies: Reply[];
  onMarkRead: (id: string) => void;
  onGenerateAiReply: (id: string) => Promise<string>;
  onSendReply?: (id: string, body: string) => Promise<void>;
}

export default function RepliesView({
  replies,
  onMarkRead,
  onGenerateAiReply,
  onSendReply,
}: RepliesViewProps) {
  const [selectedReplyId, setSelectedReplyId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [aiDraftText, setAiDraftText] = useState("");
  const [showRepliedBanner, setShowRepliedBanner] = useState(false);

  // Sentiment Filter State
  const [sentimentFilter, setSentimentFilter] = useState<string>("ALL");

  const selectedReply = replies.find((r) => r.id === selectedReplyId);

  const handleSelectReply = (id: string) => {
    setSelectedReplyId(id);
    onMarkRead(id);
    const repObj = replies.find((r) => r.id === id);
    if (repObj) {
      setAiDraftText(repObj.aiSuggestedReply || "");
    }
    setShowRepliedBanner(false);
  };

  const handleTriggerAiSuggestedReply = async () => {
    if (!selectedReplyId) return;
    setIsGenerating(true);
    try {
      const suggested = await onGenerateAiReply(selectedReplyId);
      setAiDraftText(suggested);
    } catch (err) {
      console.error(err);
      alert("Encountered error generating responder: verify server logs.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecuteSendReply = async () => {
    if (!selectedReplyId) return;
    setIsSendingReply(true);
    try {
      if (onSendReply) {
        await onSendReply(selectedReplyId, aiDraftText);
      }
      setShowRepliedBanner(true);
      // Wait a moment and then clear or keep
      setTimeout(() => {
        setAiDraftText("");
      }, 1500);
    } catch (err: any) {
      console.error(err);
      alert(`Failed to send reply: ${err.message || err}`);
    } finally {
      setIsSendingReply(false);
    }
  };

  // Filter list
  const filteredReplies = replies.filter((r) => {
    if (sentimentFilter === "ALL") return true;
    return r.sentiment.toLowerCase() === sentimentFilter.toLowerCase();
  });

  return (
    <div className="flex-1 p-8 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 h-screen overflow-hidden flex flex-col font-sans transition-colors duration-200" id="replies-view-wrapper">
      
      <div className="mb-6 shrink-0" id="replies-header">
        <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider">Unibox Inbox Feed</span>
        <h1 className="text-3xl font-display font-semibold text-slate-900 dark:text-white tracking-tight">Unified Prospective Inbox</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Consolidated prospect replies categorized automatically by AI sentiment.</p>
      </div>

      {/* Main Mailbox Workspace Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch" id="responses-split-box">
        
        {/* LEFT COLUMN: Replies List */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col min-h-0 shadow-sm" id="replies-sidebar-list">
          {/* Filters Bar */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-900 flex justify-between items-center gap-2 flex-wrap shrink-0">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest font-mono">Replies</span>
            <div className="flex gap-1 flex-wrap">
              {["ALL", "Interested", "Pricing", "Meeting", "Spam", "Not Interested"].map((sf) => (
                <button
                  key={sf}
                  onClick={() => setSentimentFilter(sf)}
                  className={`text-[9px] font-semibold uppercase px-2 py-1 rounded-lg transition-all cursor-pointer ${
                    sentimentFilter === sf
                      ? "bg-indigo-600/10 text-indigo-650 dark:text-indigo-400 border border-indigo-500/20"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-250"
                  }`}
                >
                  {sf === "ALL" ? "All" : sf}
                </button>
              ))}
            </div>
          </div>

          {/* List items */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5" id="replies-inbox-items">
            {filteredReplies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
                <Inbox className="w-10 h-10 opacity-30 mb-2" />
                <p className="text-xs">No matching responses in folder.</p>
              </div>
            ) : (
              filteredReplies.map((reply) => {
                const isSelected = selectedReplyId === reply.id;
                const isInterested = reply.sentiment === ReplySentiment.INTERESTED || reply.sentiment === ReplySentiment.MEETING || reply.sentiment === ReplySentiment.PRICING;
                const isNegative = reply.sentiment === ReplySentiment.SPAM;

                return (
                  <div
                    key={reply.id}
                    onClick={() => handleSelectReply(reply.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                      isSelected
                        ? "bg-indigo-600/10 border-indigo-500"
                        : reply.isRead
                        ? "bg-slate-50 dark:bg-slate-900/10 border-slate-100 dark:border-slate-900 hover:bg-slate-100/60 dark:hover:bg-slate-950"
                        : "bg-slate-100/40 dark:bg-slate-900/40 border-slate-200 dark:border-slate-850 hover:border-slate-300 dark:hover:border-slate-800"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{reply.firstName} {reply.lastName}</span>
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">@{reply.company}</span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300 font-medium truncate mb-1">{reply.subject}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{reply.body}</p>

                    <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-900/40">
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          reply.sentiment === ReplySentiment.MEETING
                            ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border border-blue-500/20"
                            : reply.sentiment === ReplySentiment.PRICING
                            ? "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-400 border border-purple-500/20"
                            : reply.sentiment === ReplySentiment.INTERESTED
                            ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-500/10"
                            : reply.sentiment === ReplySentiment.NOT_INTERESTED
                            ? "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800"
                            : "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {reply.sentiment}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500">
                        {new Date(reply.timestamp).toLocaleDateString()}
                      </span>
                    </div>

                    {!reply.isRead && (
                      <span className="absolute top-4 right-4 w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Active Response Inspector & AI Suggested Copilot */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col min-h-0 shadow-sm" id="active-replies-viewer">
          {selectedReply ? (
            <div className="flex-1 flex flex-col min-h-0" id="full-threat-inspector">
              
              {/* Header Details */}
              <div className="p-6 border-b border-slate-200 dark:border-slate-900 shrink-0 flex justify-between items-start flex-wrap gap-4" id="inspector-header">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center font-bold text-sm text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-indigo-500/10 shrink-0">
                    {selectedReply.firstName[0]}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{selectedReply.firstName} {selectedReply.lastName}</h2>
                    <p className="text-xs text-slate-400 dark:text-slate-550 mt-0.5 font-mono">{selectedReply.leadEmail} • {selectedReply.company}</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-mono">Campaign routing: {selectedReply.campaignName}</p>
                  </div>
                </div>

                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                    selectedReply.sentiment === ReplySentiment.MEETING
                      ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border border-blue-500/15"
                      : selectedReply.sentiment === ReplySentiment.PRICING
                      ? "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-400 border border-purple-500/15"
                      : selectedReply.sentiment === ReplySentiment.INTERESTED
                      ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-500/15"
                      : selectedReply.sentiment === ReplySentiment.NOT_INTERESTED
                      ? "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800"
                      : "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-500/15"
                  }`}
                >
                  Sentiment: {selectedReply.sentiment}
                </span>
              </div>

              {/* Msg Scroll content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6" id="inspector-body">
                {/* Incoming Prospect Speech block */}
                <div className="p-5 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-900 relative">
                  <span className="absolute -top-2.5 left-4 bg-white dark:bg-slate-950 px-2 py-0.5 font-mono text-[9px] text-slate-550 dark:text-slate-400 uppercase border border-slate-200 dark:border-slate-850 rounded">Prospect Message Received</span>
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-2 font-mono">
                    <span>Subject: {selectedReply.subject}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(selectedReply.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{selectedReply.body}</p>
                </div>

                {/* Gemini AI Suggested Outbound Responder panel */}
                <div className="p-5 bg-indigo-950/5 dark:bg-indigo-950/10 rounded-2xl border border-indigo-500/10 relative space-y-4">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <span className="bg-white dark:bg-slate-950 px-2 py-0.5 font-mono text-[9px] text-indigo-650 dark:text-indigo-400 uppercase border border-indigo-500/20 rounded flex items-center gap-1 font-display">
                      <Bot className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                      Gemini Outbound Copilot
                    </span>
                    <button
                      onClick={handleTriggerAiSuggestedReply}
                      disabled={isGenerating}
                      className="text-[10px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 dark:disabled:bg-slate-900 text-white font-semibold px-2.5 py-1 rounded-lg cursor-pointer transform hover:scale-102 transition duration-150 flex items-center gap-1"
                    >
                      {isGenerating ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Drafting Response...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3" />
                          Generate Custom AI Draft
                        </>
                      )}
                    </button>
                  </div>

                  {aiDraftText ? (
                    <div className="space-y-3">
                      <textarea
                        rows={6}
                        value={aiDraftText}
                        onChange={(e) => setAiDraftText(e.target.value)}
                        className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-800 border border-slate-200 dark:border-none rounded-xl p-3 outline-none text-slate-800 dark:text-slate-300 leading-relaxed"
                      />

                      {showRepliedBanner ? (
                        <div className="flex items-center gap-2 p-3 bg-emerald-100 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs rounded-xl">
                          <CheckCircle className="w-4 h-4" /> Message Dispatch sequence executed. Marked resolved!
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <button
                            onClick={handleExecuteSendReply}
                            disabled={isSendingReply}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-lg shadow-indigo-600/15 disabled:opacity-55"
                          >
                            <Send className={`w-3.5 h-3.5 ${isSendingReply ? "animate-pulse" : ""}`} />
                            {isSendingReply ? "Sending..." : "Send Suggested Reply"}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic">Click the Suggest AI button to let Gemini read meeting constraints and output optimal client-booking drafts.</p>
                  )}
                </div>
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400 dark:text-slate-500 text-center">
              <Mail className="w-12 h-12 opacity-35 text-indigo-550 mb-3 animate-pulse" />
              <h3 className="font-semibold text-slate-500 dark:text-slate-400">Select prospect thread</h3>
              <p className="text-xs max-w-xs mt-1">Review sentiments, check details, and leverage server-side Gemini intelligence to generate meetings booking sequences instantly.</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
