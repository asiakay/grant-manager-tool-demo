import { useEffect, useRef, useState } from "react";
import AnonymousFeedbackWidget from "./AnonymousFeedbackWidget";

// ── constants ──────────────────────────────────────────────────────────────
const LS_PERMANENT = "feedback_dismissed_permanently";
const LS_SUBMITTED = "feedback_submitted";
const LS_TIME      = "feedback_time_spent";
const THRESHOLD    = 30; // seconds before feedback panel auto-expands
const MAX_IMAGE    = 5 * 1024 * 1024;
const ALLOWED_IMG  = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);
const GITHUB_REPO  = "https://github.com/asiakay/grant-manager-tool-demo";

// ── FeedbackPanel (star-rating / NPS style) ────────────────────────────────
function FeedbackPanel({ onClose }: { onClose: () => void }) {
  const [rating, setRating]   = useState(0);
  const [hover, setHover]     = useState(0);
  const [comment, setComment] = useState("");
  const [email, setEmail]     = useState("");
  const [optedIn, setOptedIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState(false);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) { setError("Please select a star rating."); return; }
    setError("");
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("rating", String(rating));
      if (comment.trim()) fd.append("comment", comment.trim());
      if (email.trim())   fd.append("email", email.trim());
      fd.append("opted_in", optedIn ? "1" : "0");
      const res  = await fetch("/api/feedback", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const data = await res.json() as { success: boolean; issue_url?: string };
      if (data.issue_url) setIssueUrl(data.issue_url);
      setSuccess(true);
      localStorage.setItem(LS_SUBMITTED, "true");
      setTimeout(() => onClose(), 3500);
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-sm text-gray-200">Thanks for your feedback!</span>
        {issueUrl && (
          <a href={issueUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-brand-400 hover:text-brand-300 underline ml-1">
            View GitHub issue →
          </a>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-4 space-y-3 max-w-xl">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-200">How's your experience?</span>
        <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300" aria-label="Close">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Stars */}
      <div className="flex gap-1">
        {[1,2,3,4,5].map((s) => (
          <button key={s} type="button"
            onClick={() => setRating(s)}
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            className="transition-transform hover:scale-110" aria-label={`${s} star`}>
            <svg className={`w-6 h-6 transition-colors ${s <= (hover || rating) ? "text-yellow-400" : "text-gray-600"}`}
              fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </button>
        ))}
      </div>

      <textarea value={comment} onChange={(e) => setComment(e.target.value)}
        placeholder="Tell us what you think..." rows={2}
        className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none" />

      <input type="email" value={email}
        onChange={(e) => { setEmail(e.target.value); if (!e.target.value) setOptedIn(false); }}
        placeholder="Get updates about this tool (optional)"
        className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />

      {email.trim() && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={optedIn} onChange={(e) => setOptedIn(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-brand-500 focus:ring-brand-500" />
          <span className="text-xs text-gray-400">Yes, keep me posted on news and updates</span>
        </label>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={() => { localStorage.setItem(LS_PERMANENT, "true"); onClose(); }}
          className="text-xs text-gray-500 hover:text-gray-400 underline transition-colors">
          Don't show this again
        </button>
        <button type="submit" disabled={submitting}
          className="px-4 py-1.5 text-sm rounded-md bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white transition-colors">
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </form>
  );
}

// ── StickyNav ──────────────────────────────────────────────────────────────
export default function StickyNav() {
  // feedback panel state
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedbackDisabled =
    localStorage.getItem(LS_PERMANENT) === "true" ||
    localStorage.getItem(LS_SUBMITTED) === "true";

  // 30-second auto-show timer for feedback panel
  const accumulated = useRef(parseInt(localStorage.getItem(LS_TIME) || "0", 10));
  useEffect(() => {
    if (feedbackDisabled) return;
    const iv = setInterval(() => {
      accumulated.current += 1;
      localStorage.setItem(LS_TIME, String(accumulated.current));
      if (accumulated.current >= THRESHOLD) {
        setFeedbackOpen(true);
        clearInterval(iv);
      }
    }, 1000);
    const save = () => localStorage.setItem(LS_TIME, String(accumulated.current));
    document.addEventListener("visibilitychange", save);
    window.addEventListener("beforeunload", save);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", save);
      window.removeEventListener("beforeunload", save);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // report (bug/feature) widget state
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [fileError, setFileError]   = useState("");
  const reportInputRef = useRef<HTMLInputElement>(null);

  function handleReportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setFileError("");
    if (!file) return;
    if (!ALLOWED_IMG.has(file.type)) { setFileError("Please select an image file."); return; }
    if (file.size > MAX_IMAGE) { setFileError("Image must be under 5 MB."); return; }
    setReportFile(file);
    setReportOpen(true);
    // reset input so the same file can re-trigger if the user closes and re-opens
    if (reportInputRef.current) reportInputRef.current.value = "";
  }

  function handleReportClick() {
    setFileError("");
    reportInputRef.current?.click();
  }

  function handleReportClose() {
    setReportOpen(false);
    setReportFile(null);
  }

  function handleFeedbackClose() {
    setFeedbackOpen(false);
    // reset timer so it doesn't auto-show again this session
    accumulated.current = 0;
    localStorage.setItem(LS_TIME, "0");
  }

  return (
    <>
      {/* The report widget — rendered at root level so it overlays everything */}
      {reportOpen && (
        <AnonymousFeedbackWidget
          initialFile={reportFile}
          defaultOpen={true}
          onClose={handleReportClose}
        />
      )}

      {/* Sticky bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40"
        style={{ background: "rgba(17,24,39,0.97)", borderTop: "1px solid rgba(75,85,99,0.4)" }}
      >
        {/* Feedback panel — slides open above the bar */}
        {feedbackOpen && !feedbackDisabled && (
          <div className="border-b border-gray-800">
            <FeedbackPanel onClose={handleFeedbackClose} />
          </div>
        )}

        {/* Nav bar */}
        <div className="flex items-center justify-between px-4 py-2 max-w-5xl mx-auto">
          {/* Left: GitHub link */}
          <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            View on GitHub
          </a>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2">
            {fileError && <p className="text-xs text-red-400">{fileError}</p>}

            {/* Report a Bug / Suggest a Feature — screenshot triggers the form */}
            <input
              ref={reportInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
              className="sr-only"
              onChange={handleReportFileChange}
            />
            <button
              onClick={handleReportClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-gray-300 border border-gray-700 hover:border-gray-500 hover:text-white transition-colors"
              title="Attach a screenshot to report a bug or suggest a feature"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Report a Bug / Suggest
            </button>

            {/* General Feedback */}
            {!feedbackDisabled && (
              <button
                onClick={() => setFeedbackOpen((o) => !o)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-gray-300 border border-gray-700 hover:border-gray-500 hover:text-white transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Feedback
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
