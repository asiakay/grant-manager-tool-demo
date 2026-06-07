import type { Grant, ChatMessage } from "./types";

const BASE = "";

// Module-level CSRF token cache — populated after login via fetchCsrfToken().
let _csrfToken: string | null = null;

export async function fetchCsrfToken(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/csrf`, { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json() as { token: string };
    _csrfToken = data.token ?? null;
  } catch {
    // Non-fatal — requests without CSRF will get 403 and surface errors naturally
  }
}

function csrfHeaders(): Record<string, string> {
  return _csrfToken ? { "X-CSRF-Token": _csrfToken } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    throw new Error("Unauthenticated");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function signup(username: string, password: string, confirmPassword: string): Promise<void> {
  const body = new URLSearchParams({ username, password, confirm_password: confirmPassword });
  const res = await fetch(`${BASE}/signup`, {
    method: "POST",
    body,
    credentials: "include",
  });
  if (res.ok) return;
  const data = await res.json().catch(() => ({})) as { error?: string };
  throw new Error(data.error || "Sign-up failed");
}

export async function login(username: string, password: string): Promise<void> {
  const body = new URLSearchParams({ username, password });
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    body,
    credentials: "include",
    redirect: "manual",
  });
  // Worker redirects to /dashboard on success with Set-Cookie
  if (res.status === 302 || res.status === 0 || res.ok) return;
  const text = await res.text();
  throw new Error(text || "Login failed");
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/logout`, { credentials: "include" });
}

export async function fetchGrants(): Promise<Grant[]> {
  const res = await fetch(`${BASE}/api/grants`, { credentials: "include" });
  return handleResponse<Grant[]>(res);
}

export async function updateNotes(grantName: string, notes: string): Promise<void> {
  const body = new FormData();
  body.append("Name", grantName);
  body.append("Notes/Actions", notes);
  const res = await fetch(`${BASE}/api/notes`, {
    method: "POST",
    headers: csrfHeaders(),
    body,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || "Failed to save notes");
  }
}

export async function sendChat(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify({ messages }),
    signal,
  });

  if (res.status === 401) {
    throw new Error("Unauthenticated");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || "Chat request failed");
  }

  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream") || contentType.includes("text/plain")) {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // Handle SSE format
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const text =
              parsed.response ||
              parsed.choices?.[0]?.delta?.content ||
              parsed.choices?.[0]?.text ||
              "";
            if (text) onChunk(text);
          } catch {
            if (data) onChunk(data);
          }
        } else if (line && !line.startsWith(":")) {
          onChunk(line);
        }
      }
    }
  } else {
    const data = await res.json();
    const text =
      data.response ||
      data.choices?.[0]?.message?.content ||
      data.result?.response ||
      "";
    if (text) onChunk(text);
  }
}

export async function exportCsv(): Promise<void> {
  const res = await fetch(`${BASE}/data`, { credentials: "include" });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "grants.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export interface UserProfile {
  // Step 1: context
  focusAreas: string[];
  orgType: string;
  stage: string;
  // Step 2: scoring weights
  weights: {
    Relevance: number;
    Fit: number;
    Ease: number;
    StackAlignment: number;
    CadenceRecency: number;
  };
}

export const DEFAULT_WEIGHTS: UserProfile["weights"] = {
  Relevance: 0.3,
  Fit: 0.3,
  Ease: 0.2,
  StackAlignment: 0.1,
  CadenceRecency: 0.1,
};

export async function fetchProfile(): Promise<UserProfile | null> {
  const res = await fetch(`${BASE}/api/profile`, { credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  const res = await fetch(`${BASE}/api/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error("Failed to save profile");
}

export async function fetchMe(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/me`, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json() as { username: string };
    return data.username ?? null;
  } catch {
    return null;
  }
}

export async function requestPasswordReset(username: string): Promise<{ token?: string; message: string }> {
  const res = await fetch(`${BASE}/api/request-password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const data = await res.json() as { ok?: boolean; token?: string; message?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return { token: data.token, message: data.message ?? "If that account exists, a reset link has been sent." };
}

export async function resetPassword(token: string, password: string, confirmPassword: string): Promise<void> {
  const res = await fetch(`${BASE}/api/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password, confirm_password: confirmPassword }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Password reset failed");
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/grants`, {
      credentials: "include",
      signal: AbortSignal.timeout(5000),
    });
    return res.status !== 401;
  } catch {
    return false;
  }
}
