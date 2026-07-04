import { useRef, useState, useEffect, type KeyboardEvent, type ReactNode } from "react";
import type { ChatMessage } from "../types";
import { sendChat } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
  onGrantLink?: (name: string) => void;
}

// Extracts the grant name from an in-app link (/?grant=<name>), or null for external URLs.
function grantNameFromUrl(href: string): string | null {
  try {
    const u = new URL(href, window.location.origin);
    if (u.origin === window.location.origin) {
      return u.searchParams.get("grant");
    }
  } catch {
    // not a valid URL
  }
  return null;
}

// Minimal inline markdown: [text](url) links and **bold**. The AI is instructed
// to cite grants as markdown links pointing back into this app.
function renderInlineMarkdown(text: string, onGrantLink?: (name: string) => void): ReactNode[] {
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const label = m[1];
      const href = m[2];
      const grantName = grantNameFromUrl(href);
      const inApp = grantName !== null && onGrantLink !== undefined;
      nodes.push(
        <a
          key={nodes.length}
          href={href}
          className="text-brand-400 underline underline-offset-2 hover:text-brand-300"
          target={inApp ? undefined : "_blank"}
          rel={inApp ? undefined : "noopener noreferrer"}
          onClick={
            inApp
              ? (e) => {
                  e.preventDefault();
                  onGrantLink(grantName);
                }
              : undefined
          }
        >
          {label}
        </a>
      );
    } else {
      nodes.push(<strong key={nodes.length}>{m[3]}</strong>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MessageBubble({ msg, onGrantLink }: { msg: ChatMessage; onGrantLink?: (name: string) => void }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold mr-2 shrink-0 mt-0.5">
          AI
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-brand-600 text-white rounded-br-sm"
            : "bg-gray-800 text-gray-200 rounded-bl-sm"
        }`}
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {isUser ? msg.content : renderInlineMarkdown(msg.content, onGrantLink)}
      </div>
    </div>
  );
}

function NoAiKeyBanner() {
  return (
    <div className="mx-4 my-3 bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 text-sm">
      <p className="font-semibold text-amber-300 mb-1">⚠️ AI not configured</p>
      <p className="text-amber-200/80 text-xs leading-relaxed">
        The Cloudflare Workers AI binding is not active. Ensure the{" "}
        <code className="bg-amber-900/50 px-1 rounded">[ai]</code> binding is present in{" "}
        <code className="bg-amber-900/50 px-1 rounded">wrangler.toml</code> and redeploy the worker.
      </p>
    </div>
  );
}

export default function ChatPanel({ open, onClose, onGrantLink }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! I can help you analyze grants, compare opportunities, or answer questions about your grant data. What would you like to know?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/ai-status")
      .then((r) => r.json() as Promise<{ configured: boolean; provider: string | null }>)
      .then((data) => { if (!data.configured) setAiUnavailable(true); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError("");
    setAiUnavailable(false);

    abortRef.current = new AbortController();

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMsg]);

    try {
      await sendChat(
        newMessages,
        (chunk) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + chunk,
              };
            }
            return updated;
          });
        },
        abortRef.current.signal
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const status = (err as Error & { status?: number }).status;
      const msg = err instanceof Error ? err.message : String(err);
      if (status === 503) {
        setAiUnavailable(true);
        setMessages((prev) => prev.slice(0, -1)); // remove empty assistant msg
      } else {
        setError(msg);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant" && last.content === "") {
            return updated.slice(0, -1);
          }
          return updated;
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  function handleClear() {
    setMessages([
      {
        role: "assistant",
        content: "Conversation cleared. How can I help you?",
      },
    ]);
    setError("");
    setAiUnavailable(false);
  }

  return (
    <>
      {/* Backdrop (mobile) */}
      {open && (
        <div aria-hidden="true" className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={onClose} />
      )}

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI Chat Assistant"
        className={`fixed right-0 top-0 h-full w-full sm:max-w-sm bg-gray-900 sm:border-l border-gray-800 z-40 flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
            <h2 className="font-semibold text-white text-sm">AI Assistant</h2>
            <span className="badge bg-gray-800 text-gray-400 text-xs">Claude</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleClear} className="btn-ghost px-2 py-1 text-xs" aria-label="Clear conversation">
              Clear
            </button>
            <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close AI chat">
              <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {aiUnavailable && <NoAiKeyBanner />}

        {/* Messages */}
        <div
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
          className="flex-1 overflow-y-auto px-4 py-4"
        >
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} onGrantLink={onGrantLink} />
          ))}
          {loading && messages[messages.length - 1]?.content === "" && (
            <div className="flex justify-start mb-3" aria-label="AI is typing" role="status">
              <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold mr-2 shrink-0" aria-hidden="true">
                AI
              </div>
              <div className="bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1" aria-hidden="true">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="sr-only">AI is typing…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="mx-4 mb-2 text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              aria-label="Message input"
              className="input resize-none flex-1 min-h-[2.5rem] max-h-32 leading-relaxed"
              rows={1}
              placeholder="Ask about grants… (Enter to send)"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + "px";
              }}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            {loading ? (
              <button
                onClick={handleStop}
                aria-label="Stop generating"
                className="btn-outline px-3 py-2 shrink-0 text-red-400 border-red-800 hover:bg-red-900/20"
              >
                <span aria-hidden="true">■</span>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                aria-label="Send message"
                className="btn-primary px-3 py-2 shrink-0"
              >
                <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            )}
          </div>
          <p className="text-gray-600 text-xs mt-1.5">Shift+Enter for new line</p>
        </div>
      </div>
    </>
  );
}
