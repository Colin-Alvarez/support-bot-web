import React, { useState } from "react";

type Citation = {
  index: number;          // 1-based, matches [#n] in the answer text
  title: string;
  url: string;
  snippet: string;
  score: number;
  updated_at?: string | null;
};

type Message = {
  role: "user" | "assistant";
  content: string;        // already HTML-safe & with <br/>/sup injected
  citations?: Citation[]; // optional per assistant message
  timestamp?: string;     // ISO string
};

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderAnswerHtml(raw: string) {
  // 1) Escape any HTML the model might have produced (safety)
  const safe = escapeHtml(raw);
  // 2) Convert [#n] to a small, readable superscript marker
  const withSup = safe.replace(/\[#(\d+)\]/g, (_m, n) => `<sup>[${n}]</sup>`);
  // 3) Convert newlines to <br/>
  return withSup.replace(/\n/g, "<br/>");
}

export default function SupportBotWidget({
  functionUrl = import.meta.env.VITE_FUNCTION_URL,
  title = "Need help? Ask our Support Bot",
}: {
  functionUrl?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: escapeHtml(
        "Hey! My name is TylerBot 5000. I'm your digital assistant here to help get your system back working! Ask me anything about Control4, your alarm, or anything else about your setup."
      ),
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());

  async function send() {
    const q = input.trim();
    if (!q) return;
    setMessages((m) => [...m, { role: "user", content: escapeHtml(q), timestamp: new Date().toISOString() }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(functionUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // anon key is safe to expose for calling Edge Functions
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ query: q, top_k: 10, session_id: sessionId }),
      });

      let answer = "I’m not finding enough info to fully resolve this one.";
      let citations: Citation[] | undefined = undefined;
      let needsHumanHelp = false;

      // If backend returns a non-2xx, try to parse the error but still show a friendly message
      const json = await res.json().catch(() => ({}));
      if (json?.answer) answer = json.answer;
      if (Array.isArray(json?.citations)) citations = json.citations.filter((c: Citation) => c.url && /^https?:\/\//i.test(c.url));
      if (typeof json?.needs_human_help === 'boolean') needsHumanHelp = json.needs_human_help;
      if (typeof json?.session_id === 'string' && json.session_id) setSessionId(json.session_id);

      const rendered = renderAnswerHtml(answer);

      setMessages((m) => [
        ...m,
        { role: "assistant", content: rendered, citations, timestamp: new Date().toISOString() },
      ]);

      // If human help is needed, append a follow-up prompt (UI-level)
      if (needsHumanHelp) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: escapeHtml("Would you like me to create a support ticket so our team can assist you directly?"),
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (_e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: escapeHtml(
            "Oops, something went wrong. If this keeps happening, it might be a backend error rather than 'no answer found.'"
          ),
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="support-fab"
        aria-expanded={open}
        aria-controls="support-bot-panel"
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 50,
          borderRadius: 9999,
          padding: "12px 20px",
          background: "#4f46e5",
          color: "white",
          border: "none",
          cursor: "pointer",
          boxShadow: "0 10px 20px rgba(0,0,0,.35)",
        }}
      >
        💬 Support
      </button>

      {/* Panel */}
      {open && (
        <div
          id="support-bot-panel"
          style={{
            position: "fixed",
            right: 20,
            bottom: 90,
            width: 384,
            maxWidth: "95vw",
            background: "#18181b",
            color: "#e5e5e5",
            borderRadius: 16,
            boxShadow: "0 20px 40px rgba(0,0,0,.5)",
            border: "1px solid #27272a",
            overflow: "hidden",
            zIndex: 50,
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              background: "#27272a",
              borderBottom: "1px solid #3f3f46",
              fontWeight: 600,
            }}
          >
            {title}
          </div>

          <div style={{ height: 384, overflowY: "auto", padding: 16 }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  textAlign: m.role === "user" ? "right" : "left",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    padding: "8px 12px",
                    borderRadius: 12,
                    background: m.role === "user" ? "#4f46e5" : "#0f0f11",
                    border: m.role === "user" ? "none" : "1px solid #27272a",
                    maxWidth: "90%",
                  }}
                >
                  <div
                    dangerouslySetInnerHTML={{ __html: m.content }}
                    style={{ fontSize: 14, lineHeight: "1.35" }}
                  />
                  {/* Citations block for assistant messages */}
                  {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 8,
                        borderTop: "1px dashed #3f3f46",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          letterSpacing: 0.3,
                          textTransform: "uppercase",
                          color: "#9ca3af",
                          marginBottom: 4,
                          fontWeight: 600,
                        }}
                      >
                        Sources
                      </div>
                      <ol style={{ paddingLeft: 18, margin: 0 }}>
                        {m.citations.map((c) => (
                          <li key={c.index} style={{ marginBottom: 6 }}>
                            <a
                              href={c.url || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: "#93c5fd",
                                textDecoration: "underline",
                                textUnderlineOffset: 2,
                                fontWeight: 600,
                                fontSize: 13,
                              }}
                              title={c.title}
                            >
                              {c.title || `Source ${c.index}`}
                            </a>
                            {c.updated_at && (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontSize: 11,
                                  color: "#a3a3a3",
                                }}
                              >
                                (updated {new Date(c.updated_at).toLocaleDateString()})
                              </span>
                            )}
                            <div
                              style={{
                                fontSize: 12,
                                color: "#cbd5e1",
                                marginTop: 2,
                              }}
                            >
                              {c.snippet}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ opacity: 0.7, fontSize: 14 }}>Thinking…</div>
            )}
          </div>

          <div
            style={{
              padding: 12,
              borderTop: "1px solid #27272a",
              display: "flex",
              gap: 8,
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Type your question…"
              style={{
                flex: 1,
                borderRadius: 8,
                background: "#0f0f11",
                border: "1px solid #27272a",
                color: "#e5e5e5",
                padding: "8px 10px",
                outline: "none",
              }}
            />
            <button
              onClick={send}
              disabled={loading}
              style={{
                borderRadius: 8,
                background: "#4f46e5",
                color: "white",
                border: "none",
                padding: "8px 14px",
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "default" : "pointer",
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
