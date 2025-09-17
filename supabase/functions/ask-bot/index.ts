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

    const context = (rows ?? [])
      .map(
        (r: any, i: number) =>
          `[#${i + 1} | score=${Number(r.score ?? 0).toFixed(3)}]\n${r.content}`,
      )
      .join("\n\n");

    const system =
      `You are a concise support assistant. Answer using only CONTEXT. If unsure, say you don't know. Always cite like [#n].`;
    const prompt = `USER QUESTION:\n${query}\n\nCONTEXT:\n${context}`;

    // 3) Chat completion
    const chatHttp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    const chatRes = await chatHttp.json();

    const answer: string =
      chatRes?.choices?.[0]?.message?.content ??
      (rows?.length ? "I don't know." : "I couldn’t find that in our knowledge base.");

    return new Response(JSON.stringify({ answer, sources: rows ?? [] }), {
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
