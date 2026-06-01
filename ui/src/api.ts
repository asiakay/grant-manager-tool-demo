import type { Grant, ChatMessage } from "./types";

const BASE = "";

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("Unauthenticated");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
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
  const res = await fetch(`${BASE}/new_schema`, {
    method: "POST",
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
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ messages }),
    signal,
  });

  if (res.status === 401) {
    window.location.href = "/";
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
