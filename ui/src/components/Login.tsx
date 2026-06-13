import { useState, type FormEvent } from "react";
import { login } from "../api";

interface Props {
  onSuccess: () => void;
  onDemoSuccess: () => void;
  onSignUp: () => void;
  onForgotPassword: () => void;
}

export default function Login({ onSuccess, onDemoSuccess, onSignUp, onForgotPassword }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleTryDemo() {
    setError("");
    setLoading(true);
    try {
      await login("demo", "demo");
      onDemoSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo login failed");
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
          <p className="text-gray-400 text-sm mt-1">Sign in to access your grant dashboard</p>
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
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-gray-400 hover:text-gray-300 text-sm underline"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center py-2.5"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs text-gray-500">
              <span className="bg-gray-900 px-2">or</span>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleTryDemo}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium py-2.5 transition-colors disabled:opacity-50"
          >
            Try the demo
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-4">
          Don't have an account?{" "}
          <button
            onClick={onSignUp}
            className="text-brand-400 hover:text-brand-300 underline"
          >
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}
