// ingest/index.ts
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env (tries ./ then ../)
{
  const candidates = [resolve(__dirname, '.env'), resolve(__dirname, '../.env')];
  let loaded = false;
  for (const p of candidates) {
    const res = dotenv.config({ path: p });
    if (res.parsed && Object.keys(res.parsed).length > 0) {
      console.log(`[env] loaded ${Object.keys(res.parsed).length} vars from ${p}`);
      loaded = true;
      break;
    }
  }
  if (!loaded) console.warn('[env] no .env found or it contained 0 vars — falling back to process env only');
}

import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio'; // ✅ ESM-safe import; cheerio.load will exist
import { JSDOM } from 'jsdom';
import OpenAI from 'openai';
import pg from 'pg';

/** Quick sanity: fail fast if required envs are missing */
['OPENAI_API_KEY', 'SUPABASE_DB_URL'].forEach((k) => {
  if (!process.env[k]) {
    console.error(`❌ Missing env var: ${k}`);
    process.exit(1);
  }
});

/** =======================
 *  Config
 *  ======================= */
const KB_ROOT = (process.env.KB_ROOT || 'https://support-thlproducts.freshdesk.com').replace(/\/+$/, '');
const KB_SOLUTIONS_ROOT = `${KB_ROOT}/support/solutions`;
const EMBEDDING_MODEL = 'text-embedding-3-small'; // 1536 dims
const SLEEP_MS = Number(process.env.CRAWL_DELAY_MS || 300);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Supabase pool (pooler URL uses username 'postgres.<projectRef>')
const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL!,
  ssl: { rejectUnauthorized: false },
});

// quick debug so we can verify username/host
{
  const u = new URL(process.env.SUPABASE_DB_URL!);
  const masked = u.toString().replace(u.password, '***');
  console.log('[db] using', masked);
}

/** =======================
 *  Small Utils
 *  ======================= */
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function absolute(url: string) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return new URL(url, KB_ROOT).href;
}

async function safeGet(url: string, tries = 3): Promise<AxiosResponse<string>> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await axios.get<string>(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'THL-SupportBot/1.0 (+https://support-thlproducts.freshdesk.com)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        // axios auto-decompresses gzip/deflate
        validateStatus: (s) => s >= 200 && s < 400, // treat 3xx as ok (some pages redirect)
        maxRedirects: 5,
      });
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(300 * (i + 1));
    }
  }
  throw lastErr;
}

/** =======================
 *  Crawlers
 *  ======================= */

// Gather all folder URLs from the solutions root
async function listFolders(rootUrl: string): Promise<string[]> {
  const resp = await safeGet(rootUrl);
  const html = resp.data;
  if (!html || typeof html !== 'string') {
    throw new Error(`Empty HTML at ${rootUrl}`);
  }
  console.log('[debug] listFolders HTML length:', html.length);

  const $ = cheerio.load(html);
  const folders = new Set<string>();

  // Primary selector
  $('a[href^="/support/solutions/folders/"]').each((_, a) => {
    const href = $(a).attr('href');
    if (href) folders.add(absolute(href));
  });

  // Fallback selector if theme differs
  if (folders.size === 0) {
    $('a[href*="/support/solutions/folders/"]').each((_, a) => {
      const href = $(a).attr('href');
      if (href) folders.add(absolute(href));
    });
  }

  console.log('[debug] listFolders found:', folders.size);
  return [...folders];
}

// Given a folder page, collect all article links (supports pagination)
async function listArticles(folderUrl: string): Promise<string[]> {
  const articles = new Set<string>();
  let nextUrl: string | null = folderUrl;

  while (nextUrl) {
    const resp = await safeGet(nextUrl);
    const html = resp.data;
    if (!html || typeof html !== 'string') {
      throw new Error(`Empty HTML at ${nextUrl}`);
    }
    console.log('[debug] listArticles HTML length:', html.length, 'url:', nextUrl);

    const $ = cheerio.load(html);

    $('a[href^="/support/solutions/articles/"]').each((_, a) => {
      const href = $(a).attr('href');
      if (href) articles.add(absolute(href));
    });

    // Detect "next" pagination link (varies by theme)
    const relNext = $('a[rel="next"]').attr('href');
    const pagerNext = $('li.pagination-next a').attr('href');
    const more = relNext || pagerNext || '';
    nextUrl = more ? absolute(more) : null;

    await sleep(SLEEP_MS);
  }

  console.log('[debug] listArticles found:', articles.size, 'for folder:', folderUrl);
  return [...articles];
}

// Extract title + cleaned text from a Freshdesk article page
async function extractFreshdeskArticle(articleUrl: string) {
  const resp = await safeGet(articleUrl);
  const html = resp.data;
  if (!html || typeof html !== 'string') {
    throw new Error(`Empty HTML at ${articleUrl}`);
  }

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const title = (doc.querySelector('h1')?.textContent || '').trim() || articleUrl;

  const candidates = [
    '.article-content',
    '.solution-article',
    '.topic-content',
    '#solution-content',
    'main',
    'article',
  ];
  const node = candidates.map((sel) => doc.querySelector(sel)).find(Boolean) || doc.body;

  node
    .querySelectorAll('nav, header, footer, script, style, .feedback, .rating, .article-actions')
    .forEach((n) => n.remove());

  const text =
    node.textContent?.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || '';

  const modified =
    [...doc.querySelectorAll('time, .article-updated, .last-updated')]
      .map((n) => n.textContent?.trim() || '')
      .find((t) => /Modified on|Updated/i.test(t)) || null;

  return { title, html, text, modified };
}

/** =======================
 *  Embeddings & Chunking
 *  ======================= */

function chunk(text: string, maxChars = 3500) {
  const parts: string[] = [];
  let buf = '';
  for (const para of text.split(/\n{2,}/)) {
    const candidate = buf ? `${buf}\n\n${para}` : para;
    if (candidate.length > maxChars) {
      if (buf.trim()) parts.push(buf.trim());
      buf = para;
    } else {
      buf = candidate;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.map((content, i) => ({ content, chunk_index: i }));
}

async function embed(batch: string[]) {
  if (batch.length === 0) return [];
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
  return res.data.map((d) => d.embedding);
}

/** =======================
 *  DB Helpers
 *  ======================= */

async function upsertDoc(client: pg.PoolClient, url: string, title: string, html: string, text: string) {
  const doc = await client.query(
    `insert into kb_documents (source_url, title, html, text)
     values ($1,$2,$3,$4)
     on conflict (source_url) do update
       set title=excluded.title,
           html=excluded.html,
           text=excluded.text,
           updated_at=now()
     returning id`,
    [url, title, html, text],
  );
  return doc.rows[0].id as string;
}

/** =======================
 *  Orchestrator
 *  ======================= */

async function runFreshdesk(root = KB_SOLUTIONS_ROOT) {
  console.log(`🔎 Crawling Freshdesk KB: ${root}`);
  console.log('[debug] cheerio keys:', Object.keys(cheerio)); // should include 'load'

  const client = await pool.connect();

  try {
    const folders = await listFolders(root);
    console.log(`📁 Found ${folders.length} folder(s).`);

    for (const f of folders) {
      console.log(`\n→ Folder: ${f}`);
      const articles = await listArticles(f);
      console.log(`   📝 Found ${articles.length} article(s).`);

      for (const url of articles) {
        try {
          const { title, html, text } = await extractFreshdeskArticle(url);

          if (!text || text.length < 50) {
            console.warn(`   ⚠️ Skipping (very short/empty): ${url}`);
            await sleep(SLEEP_MS);
            continue;
          }

          const docId = await upsertDoc(client, url, title, html, text);

          const chunks = chunk(text);
          const embeddings = await embed(chunks.map((c) => c.content));

          // idempotent re-index
          await client.query('delete from kb_chunks where doc_id=$1', [docId]);

          // helper: format pgvector literal safely
function toVectorLiteral(vec: unknown) {
  // force numeric array (handles strings like "0.123")
  const nums = (Array.isArray(vec) ? vec : []).map((v) => Number(v));
  if (!nums.length || nums.some((n) => !Number.isFinite(n))) {
    throw new Error('Bad embedding: expected numeric array');
  }
  // join as numbers, no quotes, square brackets
  return `[${nums.join(',')}]`;
}

for (let i = 0; i < chunks.length; i++) {
  try {
    const vecLit = toVectorLiteral(embeddings[i]); // <- create bracketed literal

    // Optional debug for the first chunk of each doc
    if (i === 0) {
      console.log('   [debug] first 3 dims:', vecLit.slice(0, 32) + '...');
    }

    
      await client.query(
        `insert into kb_chunks
            (doc_id, chunk_index, content, section, anchor, tokens, embedding, metadata)
        values
            ($1,$2,$3,$4,$5,$6,$7::vector,$8)
        on conflict on constraint kb_chunks_doc_unique do update   -- 👈 use the named constraint
            set content   = excluded.content,
                embedding = excluded.embedding,
                metadata  = excluded.metadata`,
        [
            docId,
            i,
            chunks[i].content,
            null,
            null,
            null,
            vecLit,
            { url }
        ]
        );

  } catch (e: any) {
    console.error(`   ❌ Embedding insert failed for chunk ${i}:`, e?.message || e);
  }
}


          console.log(`   ✅ Indexed: ${title} (${url}) [${chunks.length} chunk(s)]`);
        } catch (e: any) {
          console.error(`   ❌ Error indexing ${url}:`, e?.message || e);
        }

        await sleep(SLEEP_MS);
      }

      await sleep(SLEEP_MS * 2);
    }

    console.log('\n🎉 Done indexing Freshdesk KB.');
  } finally {
    client.release();
  }
}

/** =======================
 *  Entry
 *  ======================= */

runFreshdesk().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
