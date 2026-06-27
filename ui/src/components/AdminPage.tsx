import { useState, useEffect, type FormEvent } from "react";
import AdminUpload from "./AdminUpload";
import { fetchAdminUsers, setAdminStatus, scoreGrantsAI, sendDigest, type AdminUser, type ScoreGrantsResult, type DigestResult } from "../api";

interface Props {
  isAdmin: boolean;
  onBack: () => void;
}

export default function AdminPage({ isAdmin, onBack }: Props) {
  const [uploaded, setUploaded] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const [aiScoring, setAiScoring] = useState(false);
  const [aiResult, setAiResult] = useState<ScoreGrantsResult | null>(null);
  const [aiError, setAiError] = useState("");
  const [digestSending, setDigestSending] = useState(false);
  const [digestResult, setDigestResult] = useState<DigestResult | null>(null);
  const [digestError, setDigestError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    setUsersLoading(true);
    fetchAdminUsers()
      .then(setUsers)
      .catch((e) => setUsersError(e.message))
      .finally(() => setUsersLoading(false));
  }, [isAdmin]);

  async function handleGrant(e: FormEvent) {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    setInviteLoading(true);
    try {
      await setAdminStatus(inviteEmail, true);
      setUsers((prev) =>
        prev.some((u) => u.email === inviteEmail)
          ? prev.map((u) => u.email === inviteEmail ? { ...u, isAdmin: true } : u)
          : [...prev, { email: inviteEmail, isAdmin: true }]
      );
      setInviteSuccess(`${inviteEmail} is now an admin.`);
      setInviteEmail("");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed");
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRevoke(email: string) {
    setUsersError("");
    try {
      await setAdminStatus(email, false);
      setUsers((prev) => prev.map((u) => u.email === email ? { ...u, isAdmin: false } : u));
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Failed to revoke access");
    }
  }

  const admins = users.filter((u) => u.isAdmin);

  return (
    <div className="min-h-screen bg-gray-950 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="btn-ghost gap-1.5 px-2.5"
            aria-label="Back to dashboard"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </button>
          <h1 className="text-xl font-bold text-white">Admin</h1>
        </div>

        {!isAdmin ? (
          <div className="bg-amber-900/30 border border-amber-700 text-amber-300 rounded-xl px-5 py-4 text-sm">
            You don't have admin access. Contact the site administrator to request it.
          </div>
        ) : (
          <>
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Grant data
            </h2>
            {uploaded && (
              <div className="bg-green-900/30 border border-green-700 text-green-300 rounded-xl px-4 py-3 text-sm">
                Grants updated. Return to the{" "}
                <button onClick={onBack} className="underline hover:text-green-200">
                  dashboard
                </button>{" "}
                to see the changes.
              </div>
            )}
            <AdminUpload
              open={true}
              inline={true}
              onClose={onBack}
              onUploaded={() => setUploaded(true)}
            />

            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider pt-2">
              AI scoring
            </h2>

            <div className="card space-y-3">
              <p className="text-sm text-gray-300 font-medium">Solar Roots profile matching</p>
              <p className="text-xs text-gray-500">
                Score unscored grants against the Solar Roots profile (solar, clean energy, climate).
                Generates a summary and Hot/Warm/Cool tier for each grant.
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={async () => {
                    setAiError("");
                    setAiResult(null);
                    setAiScoring(true);
                    try {
                      const r = await scoreGrantsAI(false, 5);
                      setAiResult(r);
                    } catch (e) {
                      setAiError(e instanceof Error ? e.message : "Failed");
                    } finally {
                      setAiScoring(false);
                    }
                  }}
                  disabled={aiScoring}
                  className="btn-primary px-4 flex items-center gap-2"
                >
                  {aiScoring && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Score Grants (AI)
                </button>
                <button
                  onClick={async () => {
                    setDigestError("");
                    setDigestResult(null);
                    setDigestSending(true);
                    try {
                      const r = await sendDigest();
                      setDigestResult(r);
                    } catch (e) {
                      setDigestError(e instanceof Error ? e.message : "Failed");
                    } finally {
                      setDigestSending(false);
                    }
                  }}
                  disabled={digestSending}
                  className="btn-ghost px-4 flex items-center gap-2"
                >
                  {digestSending && <span className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />}
                  Send Digest
                </button>
              </div>
              {aiError && <p className="text-red-400 text-sm">{aiError}</p>}
              {aiResult && (
                <p className="text-green-400 text-sm">
                  {aiResult.message ?? `Scored ${aiResult.scored} of ${aiResult.total} grant(s).`}
                  {aiResult.errors.length > 0 && ` (${aiResult.errors.length} error(s))`}
                </p>
              )}
              {digestError && <p className="text-red-400 text-sm">{digestError}</p>}
              {digestResult && (
                <p className="text-green-400 text-sm">
                  {digestResult.message ?? (digestResult.sent
                    ? `Digest sent with ${digestResult.count} grant(s).`
                    : "No Hot or Warm grants to send.")}
                </p>
              )}
            </div>

            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider pt-2">
              Manage admins
            </h2>

            {/* Grant admin access */}
            <div className="card space-y-3">
              <p className="text-sm text-gray-300 font-medium">Grant admin access</p>
              <form onSubmit={handleGrant} className="flex gap-2">
                <input
                  className="input flex-1"
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
                <button type="submit" disabled={inviteLoading} className="btn-primary px-4">
                  {inviteLoading ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    "Add"
                  )}
                </button>
              </form>
              {inviteError && (
                <p className="text-red-400 text-sm">{inviteError}</p>
              )}
              {inviteSuccess && (
                <p className="text-green-400 text-sm">{inviteSuccess}</p>
              )}
            </div>

            {/* Current admins */}
            <div className="card space-y-3">
              <p className="text-sm text-gray-300 font-medium">Current admins</p>
              {usersLoading && (
                <p className="text-gray-500 text-sm">Loading…</p>
              )}
              {usersError && (
                <p className="text-red-400 text-sm">{usersError}</p>
              )}
              {!usersLoading && admins.length === 0 && (
                <p className="text-gray-500 text-sm">No admin accounts in the database yet.</p>
              )}
              <ul className="space-y-2">
                {admins.map((u) => (
                  <li key={u.email} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-200 truncate">{u.email}</span>
                    <button
                      onClick={() => handleRevoke(u.email)}
                      className="text-red-400 hover:text-red-300 text-xs shrink-0 underline"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
