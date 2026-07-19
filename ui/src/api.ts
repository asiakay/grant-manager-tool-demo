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

export async function signup(email: string, password: string, confirmPassword: string): Promise<void> {
  const body = new URLSearchParams({ username: email, password, confirm_password: confirmPassword });
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
  const text = await res.text().catch(() => "");
  if (!text || text.trimStart().startsWith("<")) throw new Error("Server error. Please try again.");
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error) throw new Error(parsed.error);
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(text || "Login failed");
    throw e;
  }
  throw new Error(text || "Login failed");
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/logout`, { credentials: "include" });
}

export interface PagedGrants {
  data: Grant[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FetchGrantsOptions {
  includeForecast?: boolean;
}

export async function fetchGrants(page = 1, pageSize = 500, options: FetchGrantsOptions = {}): Promise<PagedGrants> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (options.includeForecast) params.set("includeForecast", "true");
  const res = await fetch(`${BASE}/api/grants?${params}`, { credentials: "include" });
  return handleResponse<PagedGrants>(res);
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
    let msg = text || "Chat request failed";
    try {
      const data = JSON.parse(text);
      if (data.error) msg = data.error;
    } catch { /* not JSON, use raw text */ }
    const err = new Error(msg) as Error & { status: number };
    err.status = res.status;
    throw err;
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
  // Prefer the server-supplied filename from Content-Disposition; fall back to a static name.
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  a.download = match ? match[1] : "grants.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface UserProfile {
  // Step 1: context
  focusAreas: string[];
  orgType: string;
  stage: string;
  mission?: string;
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

export interface MissionAnalysis {
  focusAreas: string[];
  orgType: string;
  stage: string;
  rationale: string;
}

export async function analyzeMission(mission: string): Promise<MissionAnalysis> {
  const res = await fetch(`${BASE}/api/profile/analyze-mission`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify({ mission }),
  });
  if (!res.ok) throw new Error("Analysis failed");
  return res.json();
}

export interface MeInfo {
  username: string;
  isAdmin: boolean;
}

export async function fetchMe(): Promise<MeInfo | null> {
  try {
    const res = await fetch(`${BASE}/api/me`, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json() as { username?: string; isAdmin?: boolean };
    if (!data.username) return null;
    return { username: data.username, isAdmin: data.isAdmin ?? false };
  } catch {
    return null;
  }
}

export interface AdminUser {
  email: string;
  isAdmin: boolean;
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${BASE}/api/admin/users`, { credentials: "include" });
  return handleResponse<AdminUser[]>(res);
}

export async function setAdminStatus(email: string, isAdmin: boolean): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/set-admin`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ email, isAdmin }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Failed to update admin status");
}

export interface CsvUploadResult {
  ok: boolean;
  mode: "merge" | "replace";
  inserted: number;
  updated: number;
  skipped: number;
  total: number;
  unknownColumns: string[];
}

export async function uploadGrantsCsv(file: File, mode: "merge" | "replace"): Promise<CsvUploadResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", mode);
  const res = await fetch(`${BASE}/api/admin/upload-csv`, {
    method: "POST",
    headers: csrfHeaders(),
    body,
    credentials: "include",
  });
  if (res.status === 401) throw new Error("Unauthenticated");
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return res.json();
}

export interface ScoreGrantsResult {
  ok: boolean;
  scored: number;
  total: number;
  errors: { name: string; error: string }[];
  message?: string;
}

export async function scoreGrants(rescore = false, batch = 10): Promise<ScoreGrantsResult> {
  const res = await fetch(`${BASE}/api/admin/score-grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify({ batch, rescore }),
  });
  if (res.status === 401) throw new Error("Unauthenticated");
  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error || `Error ${res.status}`);
    }
    // Non-JSON (e.g. Cloudflare HTML error pages) — don't dump raw HTML
    throw new Error(`Server error (${res.status})`);
  }
  return res.json();
}

export async function scoreGrantsAI(rescore = false, batch = 5): Promise<ScoreGrantsResult> {
  const res = await fetch(`${BASE}/api/admin/score-grants-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify({ batch, rescore }),
  });
  if (res.status === 401) throw new Error("Unauthenticated");
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Server error (${res.status})`);
  }
  return res.json();
}

export interface DigestResult {
  ok: boolean;
  count: number;
  sent: boolean;
  message?: string;
}

export async function sendDigest(): Promise<DigestResult> {
  const res = await fetch(`${BASE}/api/admin/send-digest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
  });
  if (res.status === 401) throw new Error("Unauthenticated");
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Server error (${res.status})`);
  }
  return res.json();
}

export async function requestPasswordReset(email: string): Promise<{ token?: string; message: string }> {
  const res = await fetch(`${BASE}/api/request-password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json() as { ok?: boolean; token?: string; message?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return { token: data.token, message: data.message ?? "If that account exists, a reset email has been sent." };
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

export async function liveSearch(q: string, page = 1, pageSize = 25): Promise<PagedGrants & { configured: boolean }> {
  const params = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize) });
  const res = await fetch(`${BASE}/api/live-search?${params}`, { credentials: "include" });
  if (res.status === 503) {
    return { data: [], total: 0, page: 1, pageSize, configured: false };
  }
  return handleResponse<PagedGrants & { configured: boolean }>(res);
}

const FOCUS_AREA_QUERIES: Record<string, string> = {
  "Health & Medicine":         "health medicine clinical",
  "Education & Workforce":     "education workforce training",
  "Technology & Innovation":   "technology innovation research",
  "Housing & Community":       "affordable housing community development",
  "Environment & Climate":     "climate environment clean energy",
  "Agriculture & Food":        "agriculture food rural",
  "Social Services":           "social services community welfare",
  "Arts & Humanities":         "arts humanities culture",
  "International Development": "international development global",
  "Veterans & Military":       "veterans military service members",
  "Research & Science":        "research science scientific",
  "Justice & Safety":          "justice safety equity law",
};

export async function fetchLiveGrantsForDashboard(focusAreas: string[]): Promise<Grant[]> {
  const query = focusAreas.length > 0
    ? (FOCUS_AREA_QUERIES[focusAreas[0]] ?? focusAreas[0])
    : "federal grants nonprofit";
  try {
    const res = await liveSearch(query, 1, 15);
    if (!res.configured) return [];
    return res.data.map((g) => ({ ...g, source: "live" as const }));
  } catch {
    return [];
  }
}

export async function fetchLiveSearchStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/live-search-status`, { credentials: "include" });
    if (!res.ok) return false;
    const data = await res.json() as { configured: boolean };
    return data.configured;
  } catch {
    return false;
  }
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

// ── Compliance & Audit Trail ──────────────────────────────────────────────────

export interface ComplianceGrant {
  id: number;
  program_id: number | null;
  grant_name: string;
  funder: string | null;
  total_awarded: number | null;
  period_start: string | null;
  period_end: string | null;
  status: "active" | "flagged" | "under_audit" | "resolved";
  created_by: string;
  created_at: string;
  updated_at: string;
  budget_line_count?: number;
  checklist_failures?: number;
}

export interface BudgetLine {
  id: number;
  compliance_grant_id: number;
  category: string;
  allocated: number;
  spent: number;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface AuditEvent {
  id: number;
  compliance_grant_id: number;
  event_type: "budget_change" | "status_change" | "note_added" | "flag_raised" | "checklist_update";
  actor: string;
  description: string;
  before_value: string | null;
  after_value: string | null;
  created_at: string;
}

export interface ChecklistItem {
  id: number;
  compliance_grant_id: number;
  item: string;
  status: "pending" | "pass" | "fail" | "na";
  checked_by: string | null;
  checked_at: string | null;
  created_at: string;
}

export interface ComplianceDetail {
  grant: ComplianceGrant;
  budgetLines: BudgetLine[];
  checklist: ChecklistItem[];
  auditLog: AuditEvent[];
}

/** Returns all compliance grants for the current user, ordered by most-recently updated first. */
export async function fetchComplianceGrants(): Promise<ComplianceGrant[]> {
  const res = await fetch(`${BASE}/api/compliance/grants`, { credentials: "include" });
  return handleResponse<ComplianceGrant[]>(res);
}

/** Creates a new compliance grant record. Returns the auto-assigned database id. */
export async function createComplianceGrant(data: {
  grant_name: string;
  funder?: string;
  total_awarded?: number;
  period_start?: string;
  period_end?: string;
  program_id?: number;
}): Promise<{ id: number }> {
  const res = await fetch(`${BASE}/api/compliance/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return handleResponse<{ id: number }>(res);
}

/** Fetches full compliance detail for a single grant: grant metadata, budget lines, checklist items, and audit log. */
export async function fetchComplianceDetail(id: number): Promise<ComplianceDetail> {
  const res = await fetch(`${BASE}/api/compliance/grants/${id}`, { credentials: "include" });
  return handleResponse<ComplianceDetail>(res);
}

/**
 * Updates a compliance grant's status or metadata. Status transitions write an audit event
 * with before/after values; metadata-only changes do not.
 */
export async function updateComplianceGrant(id: number, data: Partial<Pick<ComplianceGrant, "status" | "funder" | "total_awarded" | "period_start" | "period_end">>): Promise<void> {
  const res = await fetch(`${BASE}/api/compliance/grants/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify(data),
  });
  await handleResponse<{ ok: boolean }>(res);
}

/**
 * Creates or updates a budget line for the given grant. Category matching is case-insensitive,
 * so "Programming" and "programming" resolve to the same row. Writes an audit event with
 * before/after JSON on every update.
 */
export async function upsertBudgetLine(grantId: number, data: { category: string; allocated?: number; spent?: number; notes?: string }): Promise<void> {
  const res = await fetch(`${BASE}/api/compliance/grants/${grantId}/budget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify(data),
  });
  await handleResponse<{ ok: boolean }>(res);
}

/** Adds a funder requirement to the compliance checklist. New items start with status "pending". */
export async function addChecklistItem(grantId: number, item: string): Promise<void> {
  const res = await fetch(`${BASE}/api/compliance/grants/${grantId}/checklist`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify({ item }),
  });
  await handleResponse<{ ok: boolean }>(res);
}

/** Updates the status of a compliance checklist item. Writes an audit event with before/after values. */
export async function updateChecklistItem(itemId: number, status: ChecklistItem["status"]): Promise<void> {
  const res = await fetch(`${BASE}/api/compliance/checklist/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  await handleResponse<{ ok: boolean }>(res);
}

/** Appends a remediation note to the grant's audit log as a "note_added" event. Notes cannot be edited or deleted. */
export async function addRemediationNote(grantId: number, note: string): Promise<void> {
  const res = await fetch(`${BASE}/api/compliance/grants/${grantId}/note`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    credentials: "include",
    body: JSON.stringify({ note }),
  });
  await handleResponse<{ ok: boolean }>(res);
}
