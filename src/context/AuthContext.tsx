/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthContext: current user, login, register, logout, session persistence.
 *
 * On boot, reads token+user from localStorage. Verifies the token by hitting
 * `/api/auth/me` — if that 401s, the fetch interceptor fires session-expired
 * and we clear state cleanly.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authApi } from "../api/endpoints";
import { onSessionExpired, session, StoredUser } from "../api/client";

interface AuthContextValue {
  user: StoredUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(() => session.getUser());
  const [isLoading, setIsLoading] = useState<boolean>(!!session.getToken());

  // Verify persisted session on mount.
  useEffect(() => {
    let cancelled = false;
    if (session.getToken()) {
      authApi.me()
        .then((u) => {
          if (cancelled) return;
          setUser(u);
          session.setUser(u);
        })
        .catch(() => {
          // 401 already cleared via interceptor's session-expired broadcast.
          if (cancelled) return;
          session.clearAll();
          setUser(null);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  // Listen for session-expired events from the fetch interceptor.
  useEffect(() => {
    return onSessionExpired(() => {
      session.clearAll();
      setUser(null);
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await authApi.login({ email, password });
    setUser(r.user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const r = await authApi.register({ name, email, password });
    setUser(r.user);
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>");
  return ctx;
}
