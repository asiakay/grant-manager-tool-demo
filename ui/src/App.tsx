import { useEffect, useState } from "react";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Dashboard from "./components/Dashboard";
import { checkAuth, login } from "./api";

type AuthState = "loading" | "unauthenticated" | "signup" | "authenticated";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("loading");

  useEffect(() => {
    checkAuth().then((ok) => {
      setAuth(ok ? "authenticated" : "unauthenticated");
    });
  }, []);

  async function handleSignupSuccess(username: string, password: string) {
    try {
      await login(username, password);
      setAuth("authenticated");
    } catch {
      // Auto-login failed after signup; fall back to login page
      setAuth("unauthenticated");
    }
  }

  if (auth === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (auth === "signup") {
    return (
      <Signup
        onSuccess={(username, password) => handleSignupSuccess(username, password)}
        onBackToLogin={() => setAuth("unauthenticated")}
      />
    );
  }

  if (auth === "unauthenticated") {
    return (
      <Login
        onSuccess={() => setAuth("authenticated")}
        onSignUp={() => setAuth("signup")}
      />
    );
  }

  return <Dashboard onLogout={() => setAuth("unauthenticated")} />;
}
