/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Users2,
  Plus,
  UserPlus,
  Shield,
  Trash2,
  X,
  CheckCircle2,
  Mail
} from "lucide-react";
import { TeamMember, SecurityRole } from "../types";

interface TeamViewProps {
  members: TeamMember[];
  onInviteMember: (name: string, email: string, role: SecurityRole) => Promise<TeamMember>;
}

export default function TeamView({ members, onInviteMember }: TeamViewProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SecurityRole>(SecurityRole.TEAM_MEMBER);
  
  const handleInvite = async () => {
    if (!name || !email) return;
    try {
      await onInviteMember(name, email, role);
      setName("");
      setEmail("");
      setRole(SecurityRole.TEAM_MEMBER);
      setShowInviteModal(false);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 p-8 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto font-sans transition-colors duration-200" id="team-view-wrapper">
      
      <div className="flex justify-between items-center mb-8" id="team-header">
        <div>
          <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider">Access Rights Control</span>
          <h1 className="text-3xl font-display font-semibold text-slate-900 dark:text-white tracking-tight">Team Workspace Management</h1>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl cursor-pointer transition-all shadow-lg shadow-indigo-600/10"
          id="btn-invite-member"
        >
          <UserPlus className="w-4 h-4" />
          Invite Workspace Member
        </button>
      </div>

      {/* Team rows table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm" id="team-table-card">
        <table className="w-full text-left text-sm font-sans">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400">
              <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Member Name</th>
              <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Email Address</th>
              <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Workspace Role</th>
              <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Active Status</th>
              <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Joined Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
            {members.map((member) => (
              <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-800 dark:text-slate-200 font-display">
                  {member.name}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-500 dark:text-slate-400">{member.email}</td>
                <td className="px-6 py-4">
                  <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-semibold text-xs">
                    <Shield className="w-3.5 h-3.5 text-indigo-550 dark:text-indigo-400" />
                    {member.role}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    member.status === "ACTIVE"
                      ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-550/20"
                      : "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-500 border border-amber-550/15"
                  }`}>
                    {member.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {new Date(member.joinedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* POPUP MODAL: INVITE MEMBER */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-between">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-display font-semibold text-slate-100 font-display">Invite Team Member</h2>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-mono text-slate-300 block mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="E.g., John Miller"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-955 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-slate-300 block mb-1">Email Username</label>
                <input
                  type="email"
                  placeholder="john@enterpriseai.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-955 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-slate-300 block mb-1">Access Role Assign</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as SecurityRole)}
                  className="w-full bg-slate-955 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500"
                >
                  <option value={SecurityRole.TEAM_MEMBER}>Team Member (Outbound campaigns contributor)</option>
                  <option value={SecurityRole.USER}>Standard User (Inbox manager)</option>
                  <option value={SecurityRole.ADMIN}>Administrator (Full system controls)</option>
                </select>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-955 flex justify-end gap-3">
              <button
                onClick={() => setShowInviteModal(false)}
                className="px-4 py-2 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={!name || !email}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
