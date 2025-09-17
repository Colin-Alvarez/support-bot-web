import React, { useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

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
      content:
        "Hey! My name is TylerBot 5000. I'm your digital assistant here to help get your system back working!Ask me anything about Control4, your alarm, or anything else about your setup.",
    },
  ]);
  const [input, setInput] = useState("");

  async function send() {
    const q = input.trim();
    if (!q) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(functionUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // anon key is safe to expose for calling Edge Functions
          "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ query: q, top_k: 10 })
      });
      const json = await res.json();
      const answer: string = json.answer ?? "Sorry, I couldn’t find that.";

      // render [#n] citations as superscripts
      const rendered = answer.replace(/\[#(\d+)\]/g, "<sup>[$1]</sup>");

      setMessages((m) => [...m, { role: "assistant", content: rendered }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Oops, something went wrong." },
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
          boxShadow: "0 10px 20px rgba(0,0,0,.35)"
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
            zIndex: 50
          }}
        >
          <div style={{ padding: "12px 16px", background: "#27272a", borderBottom: "1px solid #3f3f46", fontWeight: 600 }}>
            {title}
          </div>

          <div style={{ height: 384, overflowY: "auto", padding: 16 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ textAlign: m.role === "user" ? "right" : "left", marginBottom: 8 }}>
                <div
                  style={{
                    display: "inline-block",
                    padding: "8px 12px",
                    borderRadius: 12,
                    background: m.role === "user" ? "#4f46e5" : "#0f0f11",
                    border: m.role === "user" ? "none" : "1px solid #27272a",
                    maxWidth: "90%"
                  }}
                  dangerouslySetInnerHTML={{ __html: m.content.replace(/\n/g, "<br/>") }}
                />
              </div>
            ))}
            {loading && <div style={{ opacity: 0.7, fontSize: 14 }}>Thinking…</div>}
          </div>

          <div style={{ padding: 12, borderTop: "1px solid #27272a", display: "flex", gap: 8 }}>
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
                outline: "none"
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
                cursor: loading ? "default" : "pointer"
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
