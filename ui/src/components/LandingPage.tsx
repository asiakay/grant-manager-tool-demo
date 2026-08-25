interface Props {
  onSignUp: () => void;
  onLogin: () => void;
}

export default function LandingPage({ onSignUp, onLogin }: Props) {
  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f8fafc", color: "#0f172a", lineHeight: "1.6", minHeight: "100vh" }}>

      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 2rem", background: "#ffffff", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 10 }}>
        <span style={{ fontWeight: 700, fontSize: "1.1rem", color: "#2563eb" }}>GrantMatch</span>
        <div style={{ display: "flex", gap: "1rem" }}>
          <button onClick={onLogin} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "0.9rem", padding: "0.4rem 0.9rem", borderRadius: "6px" }}>
            Log in
          </button>
          <button onClick={onSignUp} style={{ background: "#2563eb", border: "none", cursor: "pointer", color: "#fff", fontSize: "0.9rem", fontWeight: 600, padding: "0.4rem 0.9rem", borderRadius: "6px" }}>
            Sign up free
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "5rem 2rem 3rem", textAlign: "center" }}>
        <span style={{ display: "inline-block", background: "#eff6ff", color: "#2563eb", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", padding: "0.3rem 0.8rem", borderRadius: 99, marginBottom: "1.5rem" }}>
          AI-Powered Grant Tracking
        </span>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.02em", marginBottom: "1.25rem" }}>
          Find and win <span style={{ color: "#2563eb" }}>the right grants</span><br />for your project
        </h1>
        <p style={{ fontSize: "1.15rem", color: "#64748b", maxWidth: 600, margin: "0 auto 2.5rem" }}>
          GrantMatch scores, ranks, and tracks funding opportunities based on your project's
          profile — so you spend time applying, not searching.
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={onSignUp} style={{ background: "#2563eb", color: "#fff", border: "none", cursor: "pointer", padding: "0.75rem 1.75rem", borderRadius: 8, fontSize: "1rem", fontWeight: 600, boxShadow: "0 2px 8px rgba(37,99,235,0.25)" }}>
            Get started free
          </button>
          <button onClick={onLogin} style={{ background: "transparent", color: "#2563eb", border: "2px solid #2563eb", cursor: "pointer", padding: "0.75rem 1.75rem", borderRadius: 8, fontSize: "1rem", fontWeight: 600 }}>
            Log in to your account
          </button>
        </div>
      </section>

      {/* Features */}
      <section style={{ maxWidth: 960, margin: "3rem auto 5rem", padding: "0 2rem" }}>
        <h2 style={{ textAlign: "center", fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}>Everything you need to track funding</h2>
        <p style={{ textAlign: "center", color: "#64748b", marginBottom: "3rem" }}>Built for founders, researchers, and teams navigating the grant landscape.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1.5rem" }}>
          {[
            { icon: "🎯", title: "Personalized Scoring", desc: "Each grant is scored against your profile's relevance, fit, ease, and stack alignment — tunable weights, your priorities." },
            { icon: "🤖", title: "AI Assistant", desc: "Ask questions about your grant pipeline in plain English. Get summaries, deadline alerts, and application tips instantly." },
            { icon: "📋", title: "Centralized Pipeline", desc: "Track every opportunity — deadline, cadence, sponsor, eligibility — in one sortable, filterable table." },
            { icon: "📝", title: "Notes & Actions", desc: "Attach notes and next steps to any grant. Keep your team aligned on what's in progress and what's been submitted." },
            { icon: "📤", title: "CSV Export", desc: "Export your full grant list at any time for reporting, offline review, or sharing with stakeholders." },
            { icon: "🔒", title: "Secure & Private", desc: "Per-user accounts with session-based auth. Your grant data and scoring weights stay private to you." },
          ].map(({ icon, title, desc }) => (
            <div key={title} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem" }}>
              <div style={{ fontSize: "1.75rem", marginBottom: "0.75rem" }}>{icon}</div>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.4rem" }}>{title}</h3>
              <p style={{ fontSize: "0.9rem", color: "#64748b" }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA strip */}
      <section style={{ background: "#2563eb", color: "#fff", textAlign: "center", padding: "4rem 2rem" }}>
        <h2 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.75rem" }}>Ready to build your grant pipeline?</h2>
        <p style={{ opacity: 0.85, marginBottom: "2rem" }}>Create a free account and start tracking opportunities today.</p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={onSignUp} style={{ background: "#fff", color: "#2563eb", border: "none", cursor: "pointer", padding: "0.75rem 1.75rem", borderRadius: 8, fontSize: "1rem", fontWeight: 600 }}>
            Create free account
          </button>
          <button onClick={onLogin} style={{ background: "transparent", color: "#fff", border: "2px solid #fff", cursor: "pointer", padding: "0.75rem 1.75rem", borderRadius: 8, fontSize: "1rem", fontWeight: 600 }}>
            Log in
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ textAlign: "center", padding: "2rem", fontSize: "0.85rem", color: "#64748b", borderTop: "1px solid #e2e8f0" }}>
        &copy; 2026 GrantMatch &mdash; Powered by Cloudflare Workers
      </footer>

    </div>
  );
}
