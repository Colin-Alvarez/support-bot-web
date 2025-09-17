// deno-lint-ignore-file no-explicit-any
import { serve, createClient } from "./deps.ts";

const OPENAI_MODEL = "gpt-4o-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";

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

// Local normalization to mirror DB-side normalization
function normalizeLocal(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/control\s*4\b/g, "control4")
    .replace(/\b4\s*sight\b/g, "4sight")
    .replace(/\bos\s*v?3\b/g, "os3")
    .replace(/\s+/g, " ")
    .trim();
}

type KBRow = {
  id?: string;
  content: string;
  score?: number;
  source_url?: string | null;
  source_title?: string | null;
  updated_at?: string | null;
};

type Citation = {
  index: number;          // 1-based, matches [#n] in the answer
  title: string;
  url: string;
  snippet: string;
  score: number;
  updated_at?: string | null;
};

function safeUrl(r: KBRow): string {
  // If your RPC returns a doc/article id and you need to synthesize a URL, do it here.
  // Example (Freshdesk): return r.source_url ?? `https://your.freshdesk.com/support/solutions/articles/${r.id}`;
  return r.source_url ?? "#";
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
    if (body?.health === true) {
      // Quick runtime check without hitting OpenAI/DB
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: baseHeaders });
    }

    const query: string | undefined = body?.query;
    const topK: number = Math.max(1, Math.min(Number(body?.top_k ?? 10), 25));
    const w_semantic = Number.isFinite(body?.w_semantic) ? body.w_semantic : 0.55;
    const w_lexical = Number.isFinite(body?.w_lexical) ? body.w_lexical : 0.35;
    const w_trigram = Number.isFinite(body?.w_trigram) ? body.w_trigram : 0.1;
    const sessionId: string = body?.session_id || crypto.randomUUID();
    const maxHistoryMessages = Number(body?.max_history ?? 4); // Number of previous messages to include

    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'query' (string)" }), {
        status: 400,
        headers: baseHeaders,
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_ROLE =
      Deno.env.get("SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      "";
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

    // Helpful env checks (return JSON instead of generic 502)
    if (!SUPABASE_URL) {
      return new Response(JSON.stringify({ error: "Missing SUPABASE_URL env" }), {
        status: 500,
        headers: baseHeaders,
      });
    }
    if (!SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: "Missing SERVICE_ROLE_KEY env" }), {
        status: 500,
        headers: baseHeaders,
      });
    }
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY env" }), {
        status: 500,
        headers: baseHeaders,
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const qNorm = normalizeLocal(query);

    // 1) Embed normalized query
    const embHttp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: qNorm }),
    });
    const embRes = await embHttp.json();
    const embedding: number[] | undefined = embRes?.data?.[0]?.embedding;
    if (!embedding) {
      return new Response(
        JSON.stringify({
          error: "Failed to get embedding",
          details: embRes?.error ?? null,
          status: embHttp.status,
        }),
        { status: 502, headers: baseHeaders },
      );
    }

    // 2) Hybrid search RPC
    const { data: rows, error } = await supabase.rpc("search_kb_hybrid", {
      q_text: qNorm,
      q_embedding: embedding,
      w_semantic,
      w_lexical,
      w_trigram,
      k: topK,
    });

    if (error) {
      console.error("RPC error:", error);
      return new Response(
        JSON.stringify({ error: "Hybrid search failed", details: error.message }),
        { status: 502, headers: baseHeaders },
      );
    }

    const hits: KBRow[] = Array.isArray(rows) ? rows : [];

    // Use the top K rows for LLM context in this exact order so [#n] is stable.
    const topForLLM = hits.slice(0, Math.min(hits.length, topK));

    const context = topForLLM
      .map(
        (r: KBRow, i: number) =>
          `[#${i + 1} | score=${Number(r.score ?? 0).toFixed(3)}]\n${r.content}`,
      )
      .join("\n\n");

    const system =
      `You are TylerBot 5000, a friendly, helpful support assistant for a technology company that specializes in Control4 home automation systems. 
      
Your primary goal is to provide accurate, helpful information based on the CONTEXT provided, but you should respond in a conversational, engaging manner.

Guidelines:
- Be warm and personable in your tone
- Use simple, clear language that non-technical users can understand
- When appropriate, ask clarifying questions to better understand the user's issue
- Acknowledge the user's frustration or confusion when they're having problems
- Always cite your sources using [#n] notation when providing technical information
- If you don't know a technical answer, be honest and offer to create a support ticket
- Maintain a helpful, positive tone throughout the conversation

IMPORTANT: For basic social interactions (greetings, how are you, thanks, etc.), respond naturally without requiring CONTEXT. For example:
- If asked "How are you?", respond positively like "I'm doing great, thanks for asking! How can I help you today?"
- If greeted with "Hello" or "Hi", respond with a friendly greeting
- If thanked, acknowledge with "You're welcome" or similar
- If asked your name, remind them you are TylerBot 5000, a digital assistant

For all technical questions about Control4, alarms, remotes, or system setup, use ONLY information from the provided CONTEXT and cite your sources.

Remember that you're speaking with end users who may not be technically savvy, so avoid jargon unless it's in the CONTEXT.`;
    // Fetch conversation history if session ID is provided
    let conversationHistory = [];
    if (sessionId && maxHistoryMessages > 0) {
      try {
        const { data: historyData, error: historyError } = await supabase
          .from('chat_messages')
          .select('role, content')
          .eq('session_id', sessionId)
          .order('timestamp', { ascending: true })
          .limit(maxHistoryMessages * 2); // Fetch pairs of messages (user + assistant)
        
        if (!historyError && historyData && historyData.length > 0) {
          conversationHistory = historyData.map(msg => ({
            role: msg.role,
            content: msg.content
          }));
        }
      } catch (historyErr) {
        console.error("Failed to fetch conversation history:", historyErr);
        // Continue even if history fetch fails
      }
    }

    // Prepare the context message
    const contextMessage = `CONTEXT:\n${context}`;
    
    // Build messages array with history
    const messages = [
      { role: "system", content: system }
    ];
    
    // Add conversation history if available
    if (conversationHistory.length > 0) {
      // Add the most recent messages, but limit to maxHistoryMessages
      const recentHistory = conversationHistory.slice(-maxHistoryMessages * 2);
      messages.push(...recentHistory);
    }
    
    // Add the current context and query
    messages.push(
      { role: "user", content: `${query}\n\n${contextMessage}` }
    );

    // 3) Chat completion
    const chatHttp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.7, // Slightly higher temperature for more conversational responses
        messages: messages,
      }),
    });
    const chatRes = await chatHttp.json();

    const answer: string =
      chatRes?.choices?.[0]?.message?.content ??
      (hits.length ? "I'm not sure about that, but I'd be happy to help with any Control4 or home automation questions you might have!" : "I couldn't find specific information about that in our knowledge base. Is there something else about your Control4 system I can help with?");
    
    // Check if the answer indicates the bot couldn't help with a technical question
    const noAnswerPatterns = [
      /I don't know/i,
      /I couldn't find that/i,
      /I'm not sure/i,
      /I don't have information/i,
      /not in our knowledge base/i,
      /I don't have enough information/i,
      /I can't answer/i,
      /I can't provide/i,
      /I'm unable to/i
    ];
    
    // Detect if this was a social/greeting question or a technical question
    const socialPatterns = [
      /how are you/i,
      /hello/i,
      /hi there/i,
      /good morning/i,
      /good afternoon/i,
      /good evening/i,
      /hey/i,
      /thanks/i,
      /thank you/i,
      /your name/i,
      /who are you/i,
      /what are you/i,
      /how is your day/i
    ];
    
    const isSocialQuestion = socialPatterns.some(pattern => pattern.test(query));
    
    // Only suggest human help if it's a technical question the bot couldn't answer
    const needsHumanHelp = !isSocialQuestion && 
      (noAnswerPatterns.some(pattern => pattern.test(answer)) || hits.length === 0);

    // 4) Build citations that match [#1..#n]
    const citations: Citation[] = topForLLM.map((r, i) => ({
      index: i + 1,
      title: r.source_title || "Knowledge Base Article",
      url: safeUrl(r),
      snippet: (r.content || "").slice(0, 240) + ((r.content?.length ?? 0) > 240 ? "…" : ""),
      score: Number(r.score ?? 0),
      updated_at: r.updated_at ?? undefined,
    }));

    // Store the conversation in the database if session_id is provided
    if (sessionId) {
      try {
        await supabase.from('chat_messages').insert({
          session_id: sessionId,
          role: 'user',
          content: query,
          timestamp: new Date().toISOString()
        });
        
        await supabase.from('chat_messages').insert({
          session_id: sessionId,
          role: 'assistant',
          content: answer,
          timestamp: new Date().toISOString()
        });
      } catch (dbError) {
        console.error("Failed to store chat message:", dbError);
        // Continue even if storage fails
      }
    }

    // Keep "sources" for backward-compat with your current frontend, but add "citations" for the new UI.
    // Add a flag to indicate if human help might be needed
    return new Response(JSON.stringify({ 
      answer, 
      citations, 
      sources: hits,
      needs_human_help: needsHumanHelp,
      session_id: sessionId
    }), {
      status: 200,
      headers: baseHeaders,
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "Unhandled error", details: String(e) }), {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
});