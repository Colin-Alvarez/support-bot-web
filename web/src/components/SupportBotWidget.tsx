import React, { useState } from 'react';

const SupportBotWidget = () => {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]); // Define messages state
  const [input, setInput] = useState(''); // Define input state
  const [loading, setLoading] = useState(false); // Define loading state
  const [open, setOpen] = useState(false); // Define open state

// Define 'q' as an example query string
const q = input.trim();

const send = async () => {
  const q = input.trim();

  try {
    // Define 'res' by making an HTTP request
    const res = await fetch('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });
    const json = await res.json();
    const answer: string = json.answer ?? 'Sorry, I could not find that.';

    // Optional: add a tiny renderer for [#n] citations → superscripts
    const rendered = answer.replace(/\[#(\d+)\]/g, '<sup>[$1]</sup>');

    setMessages((m) => [...m, { role: 'assistant', content: rendered }]);
  } catch (e: any) {
    setMessages((m) => [...m, { role: 'assistant', content: 'Oops, something went wrong.' }]);
  } finally {
    setLoading(false);
  }
};


return (
<>
{/* FAB */}
<button
onClick={() => setOpen((v) => !v)}
className="fixed bottom-5 right-5 z-50 rounded-full shadow-lg px-5 py-3 bg-indigo-600 text-white hover:bg-indigo-700"
aria-expanded={open ? true : false}
aria-controls="support-bot-panel"
>
💬 Support
</button>


{/* Panel */}
{open && (
<div id="support-bot-panel" className="fixed bottom-20 right-5 z-50 w-96 max-w-[95vw] bg-zinc-900 text-zinc-100 rounded-2xl shadow-2xl border border-zinc-800 overflow-hidden">
<div className="px-4 py-3 bg-zinc-800/70 border-b border-zinc-700 font-medium">
Support Bot
</div>
<div className="h-96 overflow-y-auto p-4 space-y-3">
{messages.map((m, i) => (
<div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
<div
className={
'inline-block px-3 py-2 rounded-xl ' +
(m.role === 'user' ? 'bg-indigo-600' : 'bg-zinc-800 border border-zinc-700')
}
dangerouslySetInnerHTML={{ __html: m.content.replace(/\n/g, '<br/>') }}
/>
</div>
))}
{loading && <div className="text-sm opacity-70">Thinking…</div>}
</div>
<div className="p-3 border-t border-zinc-800 flex gap-2">
<input
value={input}
onChange={(e) => setInput(e.target.value)}
onKeyDown={(e) => e.key === 'Enter' && send()}
className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
placeholder="Type your question…"
/>
<button
onClick={send}
disabled={loading}
className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 disabled:opacity-50"
>
Send
</button>
</div>
</div>
)}
</>
);
}