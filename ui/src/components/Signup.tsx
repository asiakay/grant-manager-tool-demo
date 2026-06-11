import { useState, type FormEvent } from "react";
import { signup } from "../api";
import { generatePassword } from "../utils/generatePassword";

interface Props {
  onSuccess: (username: string, password: string) => void;
  onBackToLogin: () => void;
}

export default function Signup({ onSuccess, onBackToLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestedPassword, setSuggestedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleSuggest() {
    const p = generatePassword();
    setPassword(p);
    setConfirmPassword(p);
    setSuggestedPassword(p);
    setCopied(false);
  }

  async function handleCopy() {
    if (!suggestedPassword) return;
    await navigator.clipboard.writeText(suggestedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup(username, password, confirmPassword);
      onSuccess(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">💰</div>
          <h1 className="text-2xl font-bold text-white">Grant Manager</h1>
          <p className="text-gray-400 text-sm mt-1">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Username</label>
            <input
              className="input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9_]+"
              title="Letters, numbers, and underscores only"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-300">Password</label>
              <button
                type="button"
                onClick={handleSuggest}
                className="text-xs text-brand-400 hover:text-brand-300 underline"
              >
                Suggest strong password
              </button>
            </div>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setSuggestedPassword(null); }}
              required
              minLength={8}
            />
            <p className="text-gray-500 text-xs mt-1">Minimum 8 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirm Password</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setSuggestedPassword(null); }}
              required
            />
          </div>

          {suggestedPassword && (
            <div className="bg-green-900/30 border border-green-700 rounded-lg px-3 py-2.5 space-y-1.5">
              <p className="text-green-300 text-xs font-medium">Suggested password — save this before continuing:</p>
              <div className="flex items-center gap-2">
                <code className="text-green-200 text-sm font-mono break-all flex-1 select-all">{suggestedPassword}</code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 text-xs text-green-300 hover:text-green-100 border border-green-700 hover:border-green-500 rounded px-2 py-1 transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-green-500 text-xs">Both password fields have been filled. Store this in a password manager.</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center py-2.5"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-4">
          Already have an account?{" "}
          <button
            onClick={onBackToLogin}
            className="text-brand-400 hover:text-brand-300 underline"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
