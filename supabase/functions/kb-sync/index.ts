// deno-lint-ignore-file no-explicit-any
import { serve, createClient } from "./deps.ts";

const EMBEDDING_MODEL = "text-embedding-3-small";

/** Basic CORS */
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Content-Type": "application/json",
  };
}

function stripHtml(html: string) {
  // Naive but works well enough for Freshdesk KB
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function chunk(text: string, max = 1200, overlap = 200) {
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + max));
    i += Math.max(1, max - overlap);
  }
  return parts;
}

async function embedAll(input: string[], openaiKey: string) {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input })
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`Embeddings error ${resp.status}: ${JSON.stringify(json)}`);
  return (json.data as any[]).map(d => d.embedding as number[]);
}

async function fetchJson(url: string, apiKey: string, extraHeaders: Record<string,string> = {}) {
  const auth = btoa(`${apiKey}:X`); // Freshdesk basic auth (API key as username)
  const res = await fetch(url, {
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Freshdesk ${res.status} ${url} → ${t}`);
  }
  return res.json();
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  try {
    // --- envs
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
    const FRESHDESK_DOMAIN = Deno.env.get("FRESHDESK_DOMAIN") || ""; // e.g. support-thlproducts
    const FRESHDESK_API_KEY = Deno.env.get("FRESHDESK_API_KEY") || "";

    if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_API_KEY || !FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing one or more envs", want: ["SUPABASE_URL","SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY","OPENAI_API_KEY","FRESHDESK_DOMAIN","FRESHDESK_API_KEY"] }), { status: 500, headers });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { full } = await req.json().catch(() => ({}));
    // get last sync
    const { data: state } = await supabase.from("kb_sync_state").select("*").eq("id","freshdesk").maybeSingle();
    const since = full ? undefined : state?.last_synced_at;

    // discover all articles (categories -> folders -> articles)
    // Freshdesk API:
    // GET /api/v2/solutions/categories
    // GET /api/v2/solutions/categories/{id}/folders
    // GET /api/v2/solutions/folders/{id}/articles?per_page=100&page=N
    const base = `https://${FRESHDESK_DOMAIN}.freshdesk.com`;
    const cats = await fetchJson(`${base}/api/v2/solutions/categories`, FRESHDESK_API_KEY);

    const folderIds: number[] = [];
    for (const c of cats) {
      const folders = await fetchJson(`${base}/api/v2/solutions/categories/${c.id}/folders`, FRESHDESK_API_KEY);
      for (const f of folders) folderIds.push(f.id);
    }

    const articles: any[] = [];
    for (const fid of folderIds) {
      let page = 1;
      while (true) {
        const url = `${base}/api/v2/solutions/folders/${fid}/articles?per_page=100&page=${page}`;
        const batch = await fetchJson(url, FRESHDESK_API_KEY);
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const a of batch) {
          // incremental filter by updated_at if we have a checkpoint
          if (!since || new Date(a.updated_at) > new Date(since)) {
            articles.push(a);
          }
        }
        if (batch.length < 100) break;
        page++;
      }
    }

    // Fetch bodies (description HTML) and build rows
    let inserted = 0;
    for (const a of articles) {
      // full article (includes description)
      const detail = await fetchJson(`${base}/api/v2/solutions/articles/${a.id}`, FRESHDESK_API_KEY);
      const text = stripHtml(detail.description || detail.description_text || "");
      if (!text) continue;

      const parts = chunk(text);
      const embs = await embedAll(parts, OPENAI_API_KEY);

      // Strategy: replace existing chunks for this article, then insert fresh
      await supabase.from("kb_chunks").delete().eq("source_id", String(a.id));

      const rows = parts.map((content, i) => ({
        id: crypto.randomUUID(),            // assuming kb_chunks.id is uuid
        content,
        embedding: embs[i],
        source: "freshdesk",
        source_id: String(a.id),
        source_url: `${base}/support/solutions/articles/${a.id}`,
        updated_at: detail.updated_at ? new Date(detail.updated_at).toISOString() : new Date().toISOString(),
      }));

      const { error } = await supabase.from("kb_chunks").insert(rows);
      if (error) throw error;
      inserted += rows.length;
      // be polite to Freshdesk (rate limits): tiny pause
      await new Promise(r => setTimeout(r, 150));
    }

    // update checkpoint
    const nowIso = new Date().toISOString();
    await supabase.from("kb_sync_state").upsert({ id: "freshdesk", last_synced_at: nowIso });

    return new Response(JSON.stringify({ ok: true, scanned: articles.length, inserted }), { status: 200, headers });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers });
  }
});
