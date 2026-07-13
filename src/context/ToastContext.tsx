/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ToastContext: minimal top-right notifications. Auto-dismiss.
 */

import React, { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const AUTO_DISMISS_MS = 4500;
let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId++;
    setToasts((cur) => [...cur, { id, kind, message }]);
    setTimeout(() => remove(id), AUTO_DISMISS_MS);
  }, [remove]);

  const value: ToastContextValue = {
    toast,
    success: (m) => toast(m, "success"),
    error: (m) => toast(m, "error"),
    info: (m) => toast(m, "info"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => {
          const styles =
            t.kind === "success" ? "bg-emerald-600 text-white" :
            t.kind === "error"   ? "bg-red-600 text-white" :
                                   "bg-slate-800 text-white";
          const Icon =
            t.kind === "success" ? CheckCircle2 :
            t.kind === "error"   ? AlertCircle : Info;
          return (
            <div key={t.id}
              className={`shadow-lg rounded-lg px-4 py-3 flex items-start gap-2 animate-in fade-in slide-in-from-top-2 ${styles}`}
              role="alert">
              <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-sm leading-snug break-words">{t.message}</div>
              <button
                onClick={() => remove(t.id)}
                className="opacity-70 hover:opacity-100"
                aria-label="Dismiss">
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}
