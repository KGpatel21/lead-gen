/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Globe,
  Plus,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  X,
  CheckCircle,
  AlertTriangle
} from "lucide-react";
import { Domain } from "../types";

interface DomainsViewProps {
  domains: Domain[];
  onAddDomain: (name: string) => Promise<Domain>;
  onVerifyDomain: (id: string) => Promise<Domain>;
  onDeleteDomain: (id: string) => void;
}

export default function DomainsView({
  domains,
  onAddDomain,
  onVerifyDomain,
  onDeleteDomain,
}: DomainsViewProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [domainName, setDomainName] = useState("");
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!domainName) return;
    try {
      await onAddDomain(domainName);
      setDomainName("");
      setShowAddModal(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleVerifyClick = async (id: string) => {
    setVerifyingId(id);
    try {
      await onVerifyDomain(id);
    } catch (err) {
      console.error(err);
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className="flex-1 p-8 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto font-sans transition-colors duration-200" id="domains-view-wrapper">
      
      <div className="flex justify-between items-center mb-8" id="domains-header">
        <div>
          <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider">Deliverability Protections</span>
          <h1 className="text-3xl font-display font-semibold text-slate-900 dark:text-white tracking-tight">Domain DNS Monitoring</h1>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl cursor-pointer transition-all shadow-lg shadow-indigo-600/10"
          id="btn-add-domain"
        >
          <Plus className="w-4 h-4" />
          Add Outbound Domain
        </button>
      </div>

      {/* Guide explaining SPF, DKIM, DMARC */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 mb-8 shadow-sm" id="domains-guide-card">
        <h2 className="font-semibold text-sm text-slate-800 dark:text-slate-200 mb-2 uppercase tracking-wider flex items-center gap-2 font-display">
          <ShieldCheck className="w-5 h-5 text-indigo-500 dark:text-indigo-400" /> DNS Compliance Guidelines
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
          To maintain high delivery rates and protect your domains from Google and Microsoft spam filters, you must configure three core TXT records in your DNS register (GoDaddy, Cloudflare, etc.).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs" id="dns-guides-grid">
          <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">1. SPF (Sender Policy Framework)</span>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Lists which email servers are authorized to send outbounds on behalf of your custom domain.</p>
          </div>
          <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">2. DKIM (DomainKeys Identified Mail)</span>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Adds a cryptographic digital signature to all outgoing headers, certifying that mails weren't modified in transit.</p>
          </div>
          <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">3. DMARC (Alignment Policies)</span>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">States how the receiver's server should handle outbounds that fail SPF or DKIM audits (reject, quarantine, or none).</p>
          </div>
        </div>
      </div>

      {/* Domains Table container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm" id="domains-table-card">
        {domains.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Globe className="w-12 h-12 opacity-35 text-indigo-550 mx-auto mb-3 animate-pulse" />
            <h3 className="font-semibold text-slate-450 dark:text-slate-400">No registered domains found</h3>
            <p className="text-xs max-w-sm mx-auto mt-1">Register your company sending domains here to run SPF/DKIM verification cycles.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400">
                  <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Domain Address</th>
                  <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">SPF Compliance</th>
                  <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">DKIM Signature</th>
                  <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">DMARC alignment</th>
                  <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Health Rating</th>
                  <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {domains.map((dom) => (
                  <tr key={dom.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/45 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-medium text-slate-800 dark:text-slate-200 block font-display">{dom.name}</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono block mt-0.5">Connected inboxes: {dom.inboxCount}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        dom.spfStatus === "VALID" ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400" : "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-500"
                      }`}>
                        {dom.spfStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        dom.dkimStatus === "VALID" ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400" : "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-500"
                      }`}>
                        {dom.dkimStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        dom.dmarcStatus === "VALID" ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400" : "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-500"
                      }`}>
                        {dom.dmarcStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">{dom.healthScore}%</span>
                        <div className="w-16 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              dom.healthScore >= 90 ? "bg-emerald-500" : "bg-amber-500"
                            }`}
                            style={{ width: `${dom.healthScore}%` }}
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleVerifyClick(dom.id)}
                          disabled={verifyingId === dom.id}
                          className="p-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-indigo-600 dark:text-indigo-400 disabled:text-slate-400 dark:disabled:text-slate-600 rounded-lg cursor-pointer transition-all border border-slate-200 dark:border-slate-800"
                          title="Verify DNS Records"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${verifyingId === dom.id ? "animate-spin text-slate-400 dark:text-slate-500" : ""}`} />
                        </button>
                        <button
                          onClick={() => onDeleteDomain(dom.id)}
                          className="p-1.5 bg-slate-50 hover:bg-red-50 dark:bg-slate-900 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 rounded-lg cursor-pointer transition-all border border-slate-200 dark:border-slate-800"
                          title="Delete Domain Reference"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* POPUP MODAL: REGISTER DOMAIN */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-905 bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-between">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-display font-semibold text-slate-100">Add Sending Domain</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <label className="text-xs font-mono text-slate-300 block mb-1">Company Outbound Domain Address</label>
              <input
                type="text"
                placeholder="E.g., google-outbound.com"
                value={domainName}
                onChange={(e) => setDomainName(e.target.value)}
                className="w-full bg-slate-955 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500"
              />
              <span className="text-[10px] text-slate-500 block mt-1.5 leading-relaxed">
                Ensure this matches a domain you own with access details to edit its DNS zone configuration.
              </span>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-955 flex justify-end gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!domainName}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                Register Domain Record
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
