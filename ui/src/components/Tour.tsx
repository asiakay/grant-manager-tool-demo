import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";

interface TourStep {
  target?: string; // data-tour value; absent = centered welcome card
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
}

const STEPS: TourStep[] = [
  {
    title: "Welcome to your Dashboard! 👋",
    body: "Let's take a 30-second tour of the key features so you can hit the ground running.",
  },
  {
    target: "summary-cards",
    title: "Your Grant Pipeline",
    body: "These tiles show counts by status — applied, offered, funded, and closed — so you can see your pipeline at a glance.",
    placement: "bottom",
  },
  {
    target: "filters",
    title: "Filter & Search",
    body: "Narrow down by type, stage, award size, or deadline. Your personalized scores update as you filter.",
    placement: "bottom",
  },
  {
    target: "grant-table",
    title: "Ranked Grant Matches",
    body: "Every grant is ranked by your personalized match score. Click a row to see full details, save to a watchlist, or flag as a candidate.",
    placement: "top",
  },
  {
    target: "chat-btn",
    title: "Ask the AI Anything",
    body: "Questions about eligibility, requirements, or what to write? The AI chat reads the grant and answers.",
    placement: "bottom",
  },
  {
    target: "tracker-btn",
    title: "Track Your Applications",
    body: "Open the Grant Tracker to log applications, build your logic model, set reporting schedules, and submit actuals.",
    placement: "bottom",
  },
];

interface Rect { top: number; left: number; width: number; height: number; }
const PAD = 8;

interface Props {
  onFinish: () => void;
}

export default function Tour({ onFinish }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const measure = useCallback(() => {
    if (!currentStep.target) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${currentStep.target}"]`);
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Re-measure after scroll settles
    setTimeout(() => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }, 350);
  }, [currentStep.target]);

  useEffect(() => { measure(); }, [measure]);

  // Re-measure on resize
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  function advance() {
    if (isLast) { onFinish(); } else { setStep((s) => s + 1); }
  }

  // Spotlight geometry
  const sl = rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null;

  // Tooltip position relative to spotlight
  function tooltipStyle(): React.CSSProperties {
    if (!sl) {
      // Centered card for welcome step
      return { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 320 };
    }
    const placement = currentStep.placement ?? "bottom";
    const TOOLTIP_W = 300;
    const MARGIN = 12;
    const vpH = window.innerHeight;
    const vpW = window.innerWidth;

    // clamp left/right so tooltip stays in viewport
    const centeredLeft = sl.left + sl.width / 2 - TOOLTIP_W / 2;
    const clampedLeft = Math.max(12, Math.min(centeredLeft, vpW - TOOLTIP_W - 12));

    if (placement === "top" || (placement === "bottom" && sl.top + sl.height + 150 > vpH)) {
      return { position: "fixed", bottom: vpH - sl.top + MARGIN, left: clampedLeft, width: TOOLTIP_W };
    }
    // default bottom
    return { position: "fixed", top: sl.top + sl.height + MARGIN, left: clampedLeft, width: TOOLTIP_W };
  }

  const content = (
    <div>
      {/* Overlay */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9000, pointerEvents: "none" }}
        aria-hidden="true"
      >
        {sl ? (
          /* Spotlight via huge box-shadow */
          <div
            style={{
              position: "fixed",
              top: sl.top,
              left: sl.left,
              width: sl.width,
              height: sl.height,
              borderRadius: 8,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)",
              pointerEvents: "none",
            }}
          />
        ) : (
          /* Full dark overlay for welcome step */
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)" }} />
        )}
      </div>

      {/* Tooltip card */}
      <div
        style={{
          ...tooltipStyle(),
          zIndex: 9001,
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 12,
          padding: "1.25rem",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          color: "#f1f5f9",
          fontFamily: "inherit",
        }}
      >
        {/* Progress dots */}
        <div style={{ display: "flex", gap: 5, marginBottom: "0.75rem" }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: i === step ? "#3b82f6" : i < step ? "#1d4ed8" : "#475569",
                transition: "background 0.2s",
              }}
            />
          ))}
        </div>

        <p style={{ fontSize: "0.65rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.4rem" }}>
          {step + 1} of {STEPS.length}
        </p>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem", lineHeight: 1.3 }}>
          {currentStep.title}
        </h3>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8", lineHeight: 1.55, marginBottom: "1rem" }}>
          {currentStep.body}
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            onClick={onFinish}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "0.8rem", padding: "0.4rem 0", flexShrink: 0 }}
          >
            Skip tour
          </button>
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              style={{ background: "none", border: "1px solid #334155", cursor: "pointer", color: "#94a3b8", fontSize: "0.8rem", padding: "0.45rem 0.9rem", borderRadius: 6 }}
            >
              Back
            </button>
          )}
          <button
            onClick={advance}
            style={{ background: "#3b82f6", border: "none", cursor: "pointer", color: "#fff", fontSize: "0.85rem", fontWeight: 600, padding: "0.45rem 1.1rem", borderRadius: 6 }}
          >
            {isLast ? "Done ✓" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
