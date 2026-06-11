import { useEffect, useState } from "react";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Dashboard from "./components/Dashboard";
import ProfileSetup from "./components/ProfileSetup";
import WelcomePage from "./components/WelcomePage";
import ForgotPassword from "./components/ForgotPassword";
import AdminPage from "./components/AdminPage";
import FeedbackBar from "./components/FeedbackBar";
import { checkAuth, login, fetchProfile, saveProfile, fetchMe, fetchCsrfToken } from "./api";
import type { UserProfile } from "./api";

type AuthState = "loading" | "unauthenticated" | "signup" | "forgot-password" | "profile-setup" | "welcome" | "authenticated" | "admin";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [username, setUsername] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAuth().then(async (ok) => {
      if (!ok) { setAuth("unauthenticated"); return; }
      const [p, me] = await Promise.all([
        fetchProfile().catch(() => null),
        fetchMe(),
        fetchCsrfToken(),
      ]);
      const hasWeights = p && p.weights && typeof p.weights === "object";
      setProfile(p);
      setUsername(me?.username ?? "");
      setIsAdmin(me?.isAdmin ?? false);
      setAuth(hasWeights ? "welcome" : "profile-setup");
    });
  }, []);

  async function handleSignupSuccess(user: string, password: string) {
    try {
      await login(user, password);
      await fetchCsrfToken();
      setUsername(user);
      setAuth("profile-setup");
    } catch {
      setAuth("unauthenticated");
    }
  }

  async function handleLoginSuccess() {
    const [p, me] = await Promise.all([
      fetchProfile().catch(() => null),
      fetchMe(),
      fetchCsrfToken(),
    ]);
    const hasWeights = p && p.weights && typeof p.weights === "object";
    setProfile(p);
    setUsername(me?.username ?? "");
    setIsAdmin(me?.isAdmin ?? false);
    setAuth(hasWeights ? "welcome" : "profile-setup");
  }

  async function handleProfileSave(p: UserProfile) {
    setProfileSaving(true);
    try {
      await saveProfile(p);
      setProfile(p);
      setAuth("welcome");
    } catch {
      setProfile(p);
      setAuth("welcome");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleWelcomeProfileSave(p: UserProfile) {
    setProfileSaving(true);
    try {
      await saveProfile(p);
      setProfile(p);
    } catch {
      setProfile(p);
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
        onSuccess={(user, password) => handleSignupSuccess(user, password)}
        onBackToLogin={() => setAuth("unauthenticated")}
      />
    );
  }

  if (auth === "forgot-password") {
    return (
      <ForgotPassword
        onBack={() => setAuth("unauthenticated")}
        onSuccess={() => setAuth("unauthenticated")}
      />
    );
  }

  if (auth === "unauthenticated") {
    return (
      <Login
        onSuccess={handleLoginSuccess}
        onSignUp={() => setAuth("signup")}
        onForgotPassword={() => setAuth("forgot-password")}
      />
    );
  }

  if (auth === "profile-setup") {
    return (
      <>
        <ProfileSetup
          initial={profile}
          onSave={handleProfileSave}
          onSkip={() => setAuth("authenticated")}
          saving={profileSaving}
        />
        <FeedbackBar />
      </>
    );
  }

  if (auth === "welcome" && profile) {
    return (
      <>
        <WelcomePage
          username={username || "there"}
          profile={profile}
          onViewMatches={() => setAuth("authenticated")}
          onSaveProfile={handleWelcomeProfileSave}
          saving={profileSaving}
        />
        <FeedbackBar />
      </>
    );
  }

  if (auth === "admin") {
    return (
      <>
        <AdminPage
          isAdmin={isAdmin}
          onBack={() => setAuth("authenticated")}
        />
        <FeedbackBar />
      </>
    );
  }

  return (
    <>
      <Dashboard
        onLogout={() => setAuth("unauthenticated")}
        onBackToProfile={profile ? () => setAuth("welcome") : undefined}
        onGoToAdmin={isAdmin ? () => setAuth("admin") : undefined}
      />
      <FeedbackBar />
    </>
  );
}
