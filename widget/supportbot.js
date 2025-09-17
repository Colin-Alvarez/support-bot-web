(function(){
  const API = "https://YOUR-SUPABASE-FUNCTIONS-URL/ask-bot";
  let sessionId = crypto.randomUUID();

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className=cls; if (html) e.innerHTML=html; return e; }

  const btn = el('button', 'sb-launch', 'Need help?');
  const panel = el('div', 'sb-panel');
  const header = el('div', 'sb-header', 'Support Assistant');
  const body = el('div', 'sb-body');
  const inputWrap = el('div', 'sb-input');
  const input = el('input'); input.placeholder = "Ask a question… e.g., 'Remote won’t connect'";
  const send = el('button','', 'Send');

  inputWrap.append(input, send);
  panel.append(header, body, inputWrap);
  document.body.append(btn, panel);

  btn.onclick = () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; input.focus(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send.click(); });

  function addMsg(text, who='assistant', cites=[]) {
    const m = el('div', 'sb-msg');
    m.innerHTML = (who==='user' ? `<b>You:</b> ` : `<b>Bot:</b> `) + text;
    if (cites?.length && who==='assistant') {
      const c = el('div', 'sb-cite');
      c.innerHTML = `Sources: ` + cites.map(u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).join(' · ');
      m.append(c);
    }
    body.append(m);
    body.scrollTop = body.scrollHeight;
  }

  addMsg("I can help with setup, remotes, network, and scenes. Ask me anything.");

  async function ask(q) {
    addMsg(q, 'user');
    input.value = '';
    addMsg('…thinking…');
    const thinking = body.lastChild;

    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ message: q, session_id: sessionId })
    }).then(r => r.json()).catch(() => ({ answer: "Sorry, I hit a snag.", citations: [] }));

    thinking.remove();
    addMsg(res.answer || "Sorry, I couldn’t find that.", 'assistant', res.citations || []);
  }

  send.onclick = () => { const q = input.value.trim(); if (q) ask(q); };
})();
