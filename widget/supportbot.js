(function(){
  const API_ASK = "https://YOUR-SUPABASE-FUNCTIONS-URL/ask-bot";
  const API_TICKET = "https://YOUR-SUPABASE-FUNCTIONS-URL/create-ticket";
  let sessionId = crypto.randomUUID();
  let chatTranscript = [];

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className=cls; if (html) e.innerHTML=html; return e; }

  const btn = el('button', 'sb-launch', 'Need help?');
  const panel = el('div', 'sb-panel');
  const header = el('div', 'sb-header', 'Support Assistant');
  const body = el('div', 'sb-body');
  const inputWrap = el('div', 'sb-input');
  const input = el('input'); input.placeholder = "Ask a question… e.g., 'Remote won't connect'";
  const send = el('button','', 'Send');

  // Create ticket form elements (initially hidden)
  const ticketForm = el('div', 'sb-ticket-form');
  ticketForm.style.display = 'none';
  
  const ticketTitle = el('div', 'sb-ticket-title', 'Create Support Ticket');
  
  const nameLabel = el('label', '', 'Your Name');
  const nameInput = el('input', 'sb-form-input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Full Name';
  
  const emailLabel = el('label', '', 'Email Address');
  const emailInput = el('input', 'sb-form-input');
  emailInput.type = 'email';
  emailInput.placeholder = 'email@example.com';
  
  const subjectLabel = el('label', '', 'Subject');
  const subjectInput = el('input', 'sb-form-input');
  subjectInput.placeholder = 'Brief description of your issue';
  
  const descLabel = el('label', '', 'Additional Details');
  const descInput = el('textarea', 'sb-form-input');
  descInput.placeholder = 'Please provide any additional details about your issue';
  
  const submitBtn = el('button', 'sb-submit-ticket', 'Submit Ticket');
  const cancelBtn = el('button', 'sb-cancel-ticket', 'Cancel');
  
  const buttonWrap = el('div', 'sb-button-wrap');
  buttonWrap.append(submitBtn, cancelBtn);
  
  ticketForm.append(
    ticketTitle,
    nameLabel, nameInput,
    emailLabel, emailInput,
    subjectLabel, subjectInput,
    descLabel, descInput,
    buttonWrap
  );

  inputWrap.append(input, send);
  panel.append(header, body, inputWrap, ticketForm);
  document.body.append(btn, panel);

  btn.onclick = () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; input.focus(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send.click(); });

  // Show the ticket form
  function showTicketForm() {
    inputWrap.style.display = 'none';
    ticketForm.style.display = 'block';
    
    // Pre-fill subject with the last question if available
    if (chatTranscript.length > 0) {
      const lastUserMessage = chatTranscript.filter(msg => 
        (typeof msg === 'object' && msg.role === 'user') || 
        (typeof msg === 'string' && msg.startsWith('You:'))
      ).pop();
      
      if (lastUserMessage) {
        const content = typeof lastUserMessage === 'object' ? 
          lastUserMessage.content : 
          lastUserMessage.replace('You: ', '');
        
        subjectInput.value = content.length > 60 ? 
          content.substring(0, 57) + '...' : 
          content;
      }
    }
    
    nameInput.focus();
  }

  // Hide the ticket form and show chat input
  function hideTicketForm() {
    ticketForm.style.display = 'none';
    inputWrap.style.display = 'flex';
    input.focus();
  }

  // Add message to chat and transcript
  function addMsg(text, who='assistant', cites=[]) {
    const m = el('div', 'sb-msg');
    const formattedText = who==='user' ? `<b>You:</b> ${text}` : `<b>Bot:</b> ${text}`;
    m.innerHTML = formattedText;
    
    if (cites?.length && who==='assistant') {
      const c = el('div', 'sb-cite');
      c.innerHTML = `Sources: ` + cites.map(u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).join(' · ');
      m.append(c);
    }
    
    body.append(m);
    body.scrollTop = body.scrollHeight;
    
    // Add to transcript for ticket creation
    chatTranscript.push({
      role: who,
      content: text,
      timestamp: new Date().toISOString()
    });
  }

  // Add a system message (not from user or bot)
  function addSystemMsg(text) {
    const m = el('div', 'sb-system-msg');
    m.innerHTML = text;
    body.append(m);
    body.scrollTop = body.scrollHeight;
  }

  // Create a ticket with the Freshdesk API
  async function createTicket() {
    if (!nameInput.value.trim() || !emailInput.value.trim() || !subjectInput.value.trim()) {
      addSystemMsg('<b>Error:</b> Please fill in all required fields.');
      return;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput.value.trim())) {
      addSystemMsg('<b>Error:</b> Please enter a valid email address.');
      return;
    }
    
    addSystemMsg('Creating your support ticket...');
    
    try {
      const res = await fetch(API_TICKET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nameInput.value.trim(),
          email: emailInput.value.trim(),
          subject: subjectInput.value.trim(),
          description: descInput.value.trim(),
          transcript: chatTranscript,
          session_id: sessionId
        })
      }).then(r => r.json());
      
      if (res.success && res.ticket_id) {
        addSystemMsg(`<b>Success!</b> Your ticket #${res.ticket_id} has been created. A support agent will contact you soon.`);
        
        // Clear the form
        nameInput.value = '';
        emailInput.value = '';
        subjectInput.value = '';
        descInput.value = '';
        
        // Hide the form
        hideTicketForm();
      } else {
        addSystemMsg(`<b>Error:</b> ${res.error || 'Failed to create ticket. Please try again.'}`);
      }
    } catch (err) {
      console.error('Ticket creation error:', err);
      addSystemMsg('<b>Error:</b> Failed to create ticket. Please try again later.');
    }
  }

  // Initialize with welcome message
  addMsg("I can help with setup, remotes, network, and scenes. Ask me anything.");

  // Ask the bot a question
  async function ask(q) {
    addMsg(q, 'user');
    input.value = '';
    addMsg('…thinking…');
    const thinking = body.lastChild;

    try {
      const res = await fetch(API_ASK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: q, 
          session_id: sessionId 
        })
      }).then(r => r.json());

      thinking.remove();
      
      // Get citation URLs
      const citeUrls = res.citations ? 
        res.citations.map(c => c.url).filter(url => url && url !== '#') : 
        [];
      
      addMsg(res.answer || "Sorry, I couldn't find that.", 'assistant', citeUrls);
      
      // If the bot couldn't answer, offer to create a ticket
      if (res.needs_human_help) {
        setTimeout(() => {
          addSystemMsg('I don\'t have enough information to answer your question. Would you like to create a support ticket to get help from our technical team?');
          
          const actionRow = el('div', 'sb-action-row');
          const createTicketBtn = el('button', 'sb-action-btn', 'Create Ticket');
          const continueBtn = el('button', 'sb-action-btn', 'Continue Chatting');
          
          createTicketBtn.onclick = () => {
            actionRow.remove();
            showTicketForm();
          };
          
          continueBtn.onclick = () => {
            actionRow.remove();
            input.focus();
          };
          
          actionRow.append(createTicketBtn, continueBtn);
          body.append(actionRow);
          body.scrollTop = body.scrollHeight;
        }, 1000);
      }
    } catch (err) {
      thinking.remove();
      console.error('Chat error:', err);
      addMsg("Sorry, I hit a snag. Please try again.", 'assistant');
    }
  }

  // Event listeners
  send.onclick = () => { 
    const q = input.value.trim(); 
    if (q) ask(q); 
  };
  
  submitBtn.onclick = createTicket;
  cancelBtn.onclick = hideTicketForm;
})();