// deno-lint-ignore-file no-explicit-any
import { serve, createClient } from "./deps.ts";

/** CORS */
function corsHeaders(origin: string | null) {
  const allowList = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allow =
    allowList.length === 0 ? "*" : (origin && allowList.includes(origin) ? origin : "null");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

// Interface for the ticket creation request
interface TicketRequest {
  name: string;
  email: string;
  subject: string;
  description: string;
  transcript: string[];
  session_id: string;
}

// Interface for chat message
interface ChatMessage {
  role: string;
  content: string;
  timestamp: string;
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const baseHeaders = corsHeaders(origin);

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: baseHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), { status: 405, headers: baseHeaders });
    }

    const body = await req.json().catch(() => ({}));
    
    // Validate required fields
    const { name, email, subject, description, transcript, session_id } = body as TicketRequest;
    
    if (!name || !email || !subject || !description || !transcript || !session_id) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields", 
          required: ["name", "email", "subject", "description", "transcript", "session_id"] 
        }),
        { status: 400, headers: baseHeaders }
      );
    }

    // Get environment variables
    const FRESHDESK_API_KEY = Deno.env.get("FRESHDESK_API_KEY") || "";
    const FRESHDESK_DOMAIN = Deno.env.get("FRESHDESK_DOMAIN") || "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    // Check for required environment variables
    if (!FRESHDESK_API_KEY || !FRESHDESK_DOMAIN) {
      return new Response(
        JSON.stringify({ error: "Missing Freshdesk configuration" }),
        { status: 500, headers: baseHeaders }
      );
    }

    // Format the transcript for the ticket description
    const formattedTranscript = transcript
      .map((msg: string | ChatMessage) => {
        if (typeof msg === 'string') {
          return msg;
        } else {
          const timestamp = msg.timestamp ? `[${msg.timestamp}] ` : '';
          return `${timestamp}${msg.role === 'user' ? 'Customer' : 'Bot'}: ${msg.content}`;
        }
      })
      .join("\n\n");

    // Create the ticket description with the chat transcript
    const ticketDescription = `
${description}

--- Chat Transcript ---

${formattedTranscript}
`;

    // Create the ticket in Freshdesk
    const freshdeskUrl = `https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`;
    const auth = btoa(`${FRESHDESK_API_KEY}:X`); // Base64 encoding of API key and a placeholder

    const ticketData = {
      name,
      email,
      subject,
      description: ticketDescription,
      status: 2, // Open status
      priority: 2, // Medium priority
      source: 3, // Chat source
      custom_fields: {
        session_id: session_id
      }
    };

    const freshdeskResponse = await fetch(freshdeskUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`
      },
      body: JSON.stringify(ticketData)
    });

    const freshdeskResult = await freshdeskResponse.json();

    if (!freshdeskResponse.ok) {
      return new Response(
        JSON.stringify({ 
          error: "Failed to create Freshdesk ticket", 
          details: freshdeskResult 
        }),
        { status: freshdeskResponse.status, headers: baseHeaders }
      );
    }

    // If Supabase is configured, store the chat transcript in the database
    if (SUPABASE_URL && SERVICE_ROLE) {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
      
      // Store the chat session and ticket information
      await supabase
        .from('support_tickets')
        .insert({
          session_id,
          freshdesk_ticket_id: freshdeskResult.id,
          customer_name: name,
          customer_email: email,
          subject,
          transcript: JSON.stringify(transcript),
          created_at: new Date().toISOString()
        });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        ticket_id: freshdeskResult.id,
        ticket_url: `https://${FRESHDESK_DOMAIN}.freshdesk.com/a/tickets/${freshdeskResult.id}`
      }),
      { status: 200, headers: baseHeaders }
    );
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: "Unhandled error", details: String(e) }),
      { status: 500, headers: baseHeaders }
    );
  }
});