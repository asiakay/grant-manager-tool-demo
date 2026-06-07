import { useState, type FormEvent } from "react";
import { requestPasswordReset, resetPassword } from "../api";

interface Props {
  onBack: () => void;
  onSuccess: () => void;
}

export default function ForgotPassword({ onBack, onSuccess }: Props) {
  const [step, setStep] = useState<"request" | "reset">("request");
  const [username, setUsername] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await requestPasswordReset(username);
      setMessage(result.message);
      if (result.token) {
        setResetToken(result.token);
      }
      setStep("reset");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await resetPassword(resetToken, password, confirmPassword);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🔑</div>
          <h1 className="text-2xl font-bold text-white">Reset Password</h1>
          <p className="text-gray-400 text-sm mt-1">
            {step === "request" ? "Enter your username to get a reset token" : "Enter your reset token and new password"}
          </p>
        </div>

        {step === "request" ? (
          <form onSubmit={handleRequest} className="card space-y-4">
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
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Requesting…
                </>
              ) : (
                "Get reset token"
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="card space-y-4">
            {message && (
              <div className="bg-blue-900/40 border border-blue-700 text-blue-300 rounded-lg px-3 py-2 text-sm">
                {message}
              </div>
            )}
            {error && (
              <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Reset Token</label>
              <input
                className="input"
                type="text"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                required
                placeholder="Paste the token from your email"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">New Password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
              <p className="text-gray-500 text-xs mt-1">Minimum 8 characters</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirm New Password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Resetting…
                </>
              ) : (
                "Reset password"
              )}
            </button>
          </form>
        )}

        <p className="text-center text-gray-500 text-sm mt-4">
          <button onClick={onBack} className="text-brand-400 hover:text-brand-300 underline">
            Back to sign in
          </button>
        </p>
      </div>
    </div>
  );
}
