/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Mail, Lock, User, Loader2, LogIn, UserPlus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiError } from "../api/client";

type Mode = "login" | "register";

export default function LoginPage() {
  const { login, register } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
        toast.success("Signed in.");
      } else {
        if (name.trim().length < 2) throw new Error("Name is required.");
        if (password.length < 8) throw new Error("Password must be at least 8 characters.");
        await register(name.trim(), email.trim(), password);
        toast.success("Account created.");
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 items-center justify-center shadow-lg mb-4">
            <Mail className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Outbound.AI
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
            {mode === "login" ? "Sign in to your workspace" : "Create your workspace"}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 space-y-4"
        >
          {mode === "register" && (
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Full name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Ada Lovelace"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="you@example.com"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === "register" ? 8 : undefined}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 transition-colors"
          >
            {busy ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Working…</>
            ) : mode === "login" ? (
              <><LogIn className="w-4 h-4" />Sign in</>
            ) : (
              <><UserPlus className="w-4 h-4" />Create account</>
            )}
          </button>

          <div className="text-center text-sm text-slate-500 dark:text-slate-400 pt-2">
            {mode === "login" ? (
              <>
                No account yet?{" "}
                <button
                  type="button"
                  onClick={() => { setMode("register"); setError(null); }}
                  className="text-blue-600 hover:underline font-medium"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => { setMode("login"); setError(null); }}
                  className="text-blue-600 hover:underline font-medium"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </form>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
          The first account registered on a fresh database becomes the workspace admin.
        </p>
      </div>
    </div>
  );
}
