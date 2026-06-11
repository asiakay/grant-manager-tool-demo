import { useEffect, useRef, useState } from "react";

const LS_PERMANENT = "feedback_dismissed_permanently";
const LS_SUBMITTED = "feedback_submitted";
const LS_TIME = "feedback_time_spent";
const THRESHOLD = 30; // seconds

export default function FeedbackBar() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [optedIn, setOptedIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const accumulated = useRef(
    parseInt(localStorage.getItem(LS_TIME) || "0", 10)
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function saveTime() {
    localStorage.setItem(LS_TIME, String(accumulated.current));
  }

  useEffect(() => {
    if (
      localStorage.getItem(LS_PERMANENT) === "true" ||
      localStorage.getItem(LS_SUBMITTED) === "true"
    ) {
      return;
    }

    intervalRef.current = setInterval(() => {
      accumulated.current += 1;
      if (accumulated.current >= THRESHOLD && !visible) {
        setVisible(true);
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    }, 1000);

    function onHide() {
      saveTime();
    }

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onHide);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onHide);
      saveTime();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDismiss() {
    setExpanded(false);
    setVisible(false);
    accumulated.current = 0;
    localStorage.setItem(LS_TIME, "0");
  }

  function handleDontShow() {
    localStorage.setItem(LS_PERMANENT, "true");
    setVisible(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) {
      setError("Please select a star rating.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          comment: comment.trim() || null,
          email: email.trim() || null,
          opted_in: optedIn,
        }),
      });
      if (!res.ok) throw new Error("Server error");
      setSuccess(true);
      localStorage.setItem(LS_SUBMITTED, "true");
      setTimeout(() => setVisible(false), 2200);
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 ease-in-out ${
        expanded ? "shadow-2xl" : "shadow-lg"
      }`}
      style={{ background: "rgba(17,24,39,0.97)", borderTop: "1px solid rgba(75,85,99,0.5)" }}
    >
      {/* Collapsed bar */}
      {!expanded && !success && (
        <div className="flex items-center justify-between px-4 py-2.5 max-w-3xl mx-auto">
          <span className="text-sm text-gray-300">How's your experience?</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
              aria-label="Expand feedback form"
            >
              Share feedback
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={handleDismiss}
              className="text-gray-500 hover:text-gray-300 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Expanded form */}
      {expanded && !success && (
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-200">Share your feedback</span>
            <button
              onClick={() => setExpanded(false)}
              className="text-gray-500 hover:text-gray-300 transition-colors"
              aria-label="Collapse"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Star rating */}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRating(s)}
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="transition-transform hover:scale-110"
                  aria-label={`${s} star`}
                >
                  <svg
                    className={`w-6 h-6 ${
                      s <= (hoverRating || rating)
                        ? "text-yellow-400"
                        : "text-gray-600"
                    } transition-colors`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </button>
              ))}
            </div>

            {/* Comment */}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell us what you think..."
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
            />

            {/* Email */}
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (!e.target.value) setOptedIn(false); }}
              placeholder="Get updates about this tool (optional)"
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />

            {/* Opt-in checkbox — only shown when email is present */}
            {email.trim() && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={optedIn}
                  onChange={(e) => setOptedIn(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-brand-500 focus:ring-brand-500"
                />
                <span className="text-xs text-gray-400">Yes, keep me posted on news and updates</span>
              </label>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleDontShow}
                className="text-xs text-gray-500 hover:text-gray-400 underline transition-colors"
              >
                Don't show this again
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 text-sm rounded-md bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              >
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Success state */}
      {success && (
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm text-gray-200">Thanks for your feedback!</span>
        </div>
      )}
    </div>
  );
}
