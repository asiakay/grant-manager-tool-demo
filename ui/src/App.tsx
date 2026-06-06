import { useEffect, useState } from "react";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Dashboard from "./components/Dashboard";
import ProfileSetup from "./components/ProfileSetup";
import { checkAuth, login, fetchProfile, saveProfile } from "./api";
import type { UserProfile } from "./api";

type AuthState = "loading" | "unauthenticated" | "signup" | "profile-setup" | "authenticated";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    checkAuth().then(async (ok) => {
      if (!ok) { setAuth("unauthenticated"); return; }
      const profile = await fetchProfile().catch(() => null);
      setAuth(profile ? "authenticated" : "profile-setup");
    });
  }, []);

  async function handleSignupSuccess(username: string, password: string) {
    try {
      await login(username, password);
      setAuth("profile-setup");
    } catch {
      setAuth("unauthenticated");
    }
  }

  async function handleProfileSave(profile: UserProfile) {
    setProfileSaving(true);
    try {
      await saveProfile(profile);
      setAuth("authenticated");
    } catch {
      // proceed anyway
      setAuth("authenticated");
    } finally {
      setProfileSaving(false);
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
        onSuccess={async () => {
          const profile = await fetchProfile().catch(() => null);
          setAuth(profile ? "authenticated" : "profile-setup");
        }}
        onSignUp={() => setAuth("signup")}
      />
    );
  }

  if (auth === "profile-setup") {
    return (
      <ProfileSetup
        onSave={handleProfileSave}
        onSkip={() => setAuth("authenticated")}
        saving={profileSaving}
      />
    );
  }

  return <Dashboard onLogout={() => setAuth("unauthenticated")} />;
}
