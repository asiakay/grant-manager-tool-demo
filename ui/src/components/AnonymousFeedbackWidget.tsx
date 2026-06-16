import { useCallback, useRef, useState } from "react";

type Category = "bug" | "feature" | "general";

interface FormState {
  message: string;
  category: Category;
  name: string;
  email: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

export default function AnonymousFeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({
    message: "",
    category: "general",
    name: "",
    email: "",
  });
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [success, setSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setForm({ message: "", category: "general", name: "", email: "" });
    setScreenshot(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setError("");
    setFileError("");
    setSuccess(false);
  }

  function handleClose() {
    setOpen(false);
    if (!success) {
      // keep form state if not submitted so user doesn't lose work
    }
  }

  function handleOpen() {
    setOpen(true);
    setError("");
    setFileError("");
  }

  function acceptFile(file: File) {
    setFileError("");
    if (!ALLOWED_TYPES.has(file.type)) {
      setFileError("Only images are allowed (JPG, PNG, GIF, WebP, AVIF).");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError("File is too large. Maximum size is 5 MB.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setScreenshot(file);
    setPreview(URL.createObjectURL(file));
  }

  function removeScreenshot() {
    setScreenshot(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFileError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.message.trim()) {
      setError("Please describe your feedback before submitting.");
      return;
    }
    setError("");
    setSubmitting(true);

    const fd = new FormData();
    fd.append("message", form.message.trim());
    fd.append("category", form.category);
    if (form.name.trim()) fd.append("name", form.name.trim());
    if (form.email.trim()) fd.append("email", form.email.trim());
    if (screenshot) fd.append("screenshot", screenshot);

    try {
      const res = await fetch("/api/anonymous-feedback", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data as { error?: string }).error ||
          (res.status === 429
            ? "Too many submissions. Please try again later."
            : "Submission failed. Please try again."),
        );
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        setOpen(false);
        resetForm();
      }, 2500);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={handleOpen}
        aria-label="Send feedback"
        title="Send feedback"
        className={`fixed bottom-20 right-4 z-40 flex items-center gap-2 px-3 py-2.5 rounded-full bg-brand-600 hover:bg-brand-500 text-white shadow-lg transition-all duration-200 hover:shadow-brand-500/30 hover:shadow-xl text-sm font-medium ${open ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      >
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
        </svg>
        <span>Feedback</span>
      </button>

      {/* Modal backdrop + dialog */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Submit feedback"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Panel */}
          <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-800 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-100">Share Feedback</h2>
                <p className="text-xs text-gray-400 mt-0.5">No account needed — your report becomes a GitHub issue</p>
              </div>
              <button
                onClick={handleClose}
                className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded-md hover:bg-gray-800"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-5 py-4">
              {success ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-600/20 flex items-center justify-center">
                    <svg className="w-6 h-6 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-200">Feedback submitted — thank you!</p>
                  <p className="text-xs text-gray-400 text-center">
                    Your report was filed as a GitHub issue and will be reviewed by the team.
                  </p>
                </div>
              ) : (
                <form id="anon-feedback-form" onSubmit={handleSubmit} className="space-y-4">
                  {/* Category */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Category</label>
                    <div className="flex gap-2">
                      {(["bug", "feature", "general"] as Category[]).map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, category: cat }))}
                          className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                            form.category === cat
                              ? "bg-brand-600 border-brand-600 text-white"
                              : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                          }`}
                        >
                          {cat === "bug" ? "Bug Report" : cat === "feature" ? "Feature Request" : "General"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Message */}
                  <div>
                    <label htmlFor="anon-msg" className="block text-xs font-medium text-gray-400 mb-1.5">
                      Message <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      id="anon-msg"
                      value={form.message}
                      onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                      placeholder={
                        form.category === "bug"
                          ? "Describe the bug — what happened and what you expected…"
                          : form.category === "feature"
                          ? "Describe the feature you'd like to see…"
                          : "Share your thoughts, suggestions, or comments…"
                      }
                      rows={4}
                      maxLength={5000}
                      required
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                    />
                    <p className="text-right text-xs text-gray-600 mt-0.5">{form.message.length}/5000</p>
                  </div>

                  {/* Screenshot */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      Screenshot <span className="text-gray-600">(optional)</span>
                    </label>

                    {preview ? (
                      <div className="relative rounded-lg overflow-hidden border border-gray-700">
                        <img src={preview} alt="Screenshot preview" className="w-full max-h-48 object-contain bg-gray-950" />
                        <button
                          type="button"
                          onClick={removeScreenshot}
                          className="absolute top-2 right-2 bg-gray-900/80 hover:bg-gray-800 text-gray-300 rounded-full p-1 transition-colors"
                          aria-label="Remove screenshot"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div
                        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={onDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-lg px-4 py-5 text-center cursor-pointer transition-colors ${
                          dragging
                            ? "border-brand-500 bg-brand-500/10"
                            : "border-gray-700 hover:border-gray-500 hover:bg-gray-800/50"
                        }`}
                      >
                        <svg className="w-6 h-6 text-gray-500 mx-auto mb-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p className="text-xs text-gray-400">
                          Drag & drop or <span className="text-brand-400">browse</span>
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">PNG, JPG, GIF, WebP — max 5 MB</p>
                      </div>
                    )}

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) acceptFile(file);
                      }}
                    />

                    {fileError && <p className="text-xs text-red-400 mt-1">{fileError}</p>}
                  </div>

                  {/* Optional contact info */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="anon-name" className="block text-xs font-medium text-gray-400 mb-1.5">
                        Name <span className="text-gray-600">(optional)</span>
                      </label>
                      <input
                        id="anon-name"
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Your name"
                        maxLength={100}
                        className="input"
                      />
                    </div>
                    <div>
                      <label htmlFor="anon-email" className="block text-xs font-medium text-gray-400 mb-1.5">
                        Email <span className="text-gray-600">(optional)</span>
                      </label>
                      <input
                        id="anon-email"
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="For follow-up"
                        maxLength={255}
                        className="input"
                      />
                    </div>
                  </div>

                  {error && (
                    <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-md px-3 py-2">
                      {error}
                    </p>
                  )}
                </form>
              )}
            </div>

            {/* Footer */}
            {!success && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-gray-800 shrink-0">
                <p className="text-xs text-gray-500">
                  Creates an issue in the{" "}
                  <span className="text-gray-400">public GitHub repo</span>
                </p>
                <button
                  type="submit"
                  form="anon-feedback-form"
                  disabled={submitting || !form.message.trim()}
                  className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
                >
                  {submitting ? "Submitting…" : "Submit Feedback"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
