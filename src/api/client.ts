/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single source of truth for HTTP calls to the backend.
 *
 * Two mechanisms:
 *   1. `api.*` — typed, structured client for new code (returns unwrapped data).
 *   2. A `window.fetch` interceptor for every `/api/*` call — attaches the
 *      Bearer token, normalizes 401 → session expired.
 *
 * The interceptor is installed on module load. Existing components that do
 * `fetch("/api/campaigns")` keep working; they just start seeing 401s become
 * a session-expired event instead of a silent success.
 */

const TOKEN_KEY = "outbound_ai_token";
const USER_KEY = "outbound_ai_user";

// ------------------------------------------------------------------
// Session storage
// ------------------------------------------------------------------

export type StoredUser = { id: string; name: string; email: string; role: string };

export const session = {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  },
  getUser(): StoredUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as StoredUser; } catch { return null; }
  },
  setUser(user: StoredUser): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clearUser(): void {
    localStorage.removeItem(USER_KEY);
  },
  clearAll(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

// ------------------------------------------------------------------
// Error class
// ------------------------------------------------------------------

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// ------------------------------------------------------------------
// Session-expired broadcast
// ------------------------------------------------------------------
// Fires whenever a request comes back 401. AuthContext listens and logs out.

type SessionExpiredHandler = () => void;
const sessionExpiredHandlers: Set<SessionExpiredHandler> = new Set();

export function onSessionExpired(h: SessionExpiredHandler): () => void {
  sessionExpiredHandlers.add(h);
  return () => sessionExpiredHandlers.delete(h);
}

function fireSessionExpired(): void {
  for (const h of sessionExpiredHandlers) {
    try { h(); } catch (e) { console.error("[api] session-expired handler failed", e); }
  }
}

// ------------------------------------------------------------------
// Interceptor
// ------------------------------------------------------------------

const originalFetch = window.fetch.bind(window);

function shouldIntercept(input: RequestInfo | URL): boolean {
  const url =
    typeof input === "string" ? input :
    input instanceof URL ? input.pathname + input.search :
    input.url;
  // Only touch API calls to our own backend.
  return url.startsWith("/api/") || url.startsWith("/api?");
}

window.fetch = async function patchedFetch(input, init) {
  if (!shouldIntercept(input)) {
    return originalFetch(input, init);
  }
  const token = session.getToken();
  const headers = new Headers(init?.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const patchedInit: RequestInit = { ...init, headers };
  const response = await originalFetch(input, patchedInit);

  if (response.status === 401) {
    // Don't fire for the auth endpoints themselves — a bad login is not a
    // session expiry.
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const isAuthAttempt = url.includes("/api/auth/login") || url.includes("/api/auth/register");
    if (!isAuthAttempt) {
      fireSessionExpired();
    }
  }
  return response;
};

// ------------------------------------------------------------------
// Structured client (preferred for new code)
// ------------------------------------------------------------------

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = path.startsWith("/") ? path : `/api/${path}`;
  const finalUrl = url.startsWith("/api") ? url : `/api${url}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await window.fetch(finalUrl, init);
  let parsed: any = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { parsed = await res.json(); } catch { parsed = null; }
  } else {
    try { parsed = await res.text(); } catch { parsed = null; }
  }

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === "object" && (parsed.error || parsed.message)) ||
      (typeof parsed === "string" && parsed) ||
      `Request failed with status ${res.status}`;
    throw new ApiError(String(message), res.status, parsed);
  }

  // Normalize `{ success, data }` envelope when present, otherwise return raw.
  if (
    parsed &&
    typeof parsed === "object" &&
    "success" in parsed &&
    parsed.success === true &&
    "data" in parsed
  ) {
    return parsed.data as T;
  }
  return parsed as T;
}

export const api = {
  get<T = unknown>(path: string) { return request<T>("GET", path); },
  post<T = unknown>(path: string, body?: unknown) { return request<T>("POST", path, body); },
  put<T = unknown>(path: string, body?: unknown) { return request<T>("PUT", path, body); },
  del<T = unknown>(path: string) { return request<T>("DELETE", path); },
  // Escape hatch for callers that need the full envelope (e.g. `{success,token,user}`)
  raw<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return request<T>(method, path, body);
  },
};
