-- Enable useful extensions (all supported on Supabase)
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- 1) Normalization function
--    Lowercase, trim, collapse whitespace, remove accents, and fix common variants.
--    Add/extend the REGEXP pairs as you discover new aliases.
create or replace function public.normalize_text(input text)
returns text language plpgsql as $$
begin
  if input is null then
    return '';
  end if;
  -- basic cleanup
  input := lower(input);
  input := trim(input);
  -- remove accents
  input := unaccent(input);

  -- common domain-specific normalizations
  -- Control4 variants
  input := regexp_replace(input, '\bcontrol\s*4\b', 'control4', 'g');
  input := regexp_replace(input, '\bc4\b', 'control4', 'g');

  -- 4Sight variants
  input := regexp_replace(input, '\b4\s*sight\b', '4sight', 'g');

  -- OS3 variants
  input := regexp_replace(input, '\bos\s*3\b', 'os3', 'g');
  input := regexp_replace(input, '\bos\s*v?3\b', 'os3', 'g');

  -- App/Login phrasing variants (feel free to extend)
  input := regexp_replace(input, '\blog\s*in\b', 'login', 'g');
  input := regexp_replace(input, '\bcan\'t\b', 'cannot', 'g');

  -- collapse multiple spaces
  input := regexp_replace(input, '\s+', ' ', 'g');
  return input;
end;
$$;

-- 2) Ensure your kb table has text + embedding columns
--    (Adjust names/types if yours differ.)
--    You already have kb_chunks(content, embedding vector(1536)).
--    We add a tsvector computed column for full text search.
alter table if exists public.kb_chunks
  add column if not exists content_norm text generated always as (normalize_text(content)) stored,
  add column if not exists content_tsv tsvector generated always as (
    to_tsvector('english', content_norm)
  ) stored;

-- 3) Indexes for speed
--    Choose your preferred metric for pgvector (cosine recommended for OpenAI embeddings)
create index if not exists idx_kb_chunks_embedding on public.kb_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_kb_chunks_tsv on public.kb_chunks using gin (content_tsv);
create index if not exists idx_kb_chunks_trgm on public.kb_chunks using gin (content_norm gin_trgm_ops);

-- 4) Helper: rank hybrid search results
--    Inputs: query text and embedding, weights let you re-balance signals without code changes.
create or replace function public.search_kb_hybrid(
  q_text text,
  q_embedding vector(1536),
  w_semantic double precision default 0.55,
  w_lexical  double precision default 0.35,
  w_trigram  double precision default 0.10,
  k int default 12
) returns table(
  id bigint,
  content text,
  score double precision,
  sem_score double precision,
  lex_score double precision,
  tri_score double precision
) language sql stable as $$
  with params as (
    select normalize_text(q_text) as qn,
           websearch_to_tsquery('english', normalize_text(q_text)) as tsq
  ), sem as (
    select id, 1 - (kb.embedding <=> q_embedding) as sem_score
    from public.kb_chunks kb
    order by kb.embedding <=> q_embedding
    limit k*10  -- oversample for better fusion
  ), lex as (
    select id, ts_rank_cd(kb.content_tsv, p.tsq, 1) as lex_score
    from public.kb_chunks kb, params p
    where kb.content_tsv @@ p.tsq
    order by lex_score desc
    limit k*10
  ), tri as (
    select id, greatest(similarity(kb.content_norm, p.qn), 0) as tri_score
    from public.kb_chunks kb, params p
    where kb.content_norm % p.qn  -- trigram fuzzy match
    order by tri_score desc
    limit k*10
  ), fused as (
    select kb.id,
           kb.content,
           coalesce(s.sem_score, 0) as sem_score,
           coalesce(l.lex_score, 0) as lex_score,
           coalesce(t.tri_score, 0) as tri_score
    from public.kb_chunks kb
    left join sem s using(id)
    left join lex l using(id)
    left join tri t using(id)
  )
  select id,
         content,
         (w_semantic*sem_score + w_lexical*lex_score + w_trigram*tri_score) as score,
         sem_score,
         lex_score,
         tri_score
  from fused
  order by score desc
  limit k;
$$;

-- 5) Optional: cheap synonym table you can maintain without code changes
--    Use this only if you want drive-by replacements in addition to normalize_text.
create table if not exists public.kb_synonyms (
  from_text text primary key,
  to_text text not null
);

insert into public.kb_synonyms(from_text, to_text) values
  ('control 4', 'control4') on conflict do nothing,
  ('c4', 'control4') on conflict do nothing,
  ('4 sight', '4sight') on conflict do nothing,
  ('os 3', 'os3') on conflict do nothing;

-- Function to apply table-driven synonyms. Called in the Edge Function if desired.
create or replace function public.apply_synonyms(input text)
returns text language sql stable as $$
  with rec as (
    select from_text, to_text from public.kb_synonyms
  )
  select coalesce(
    (select reduce(input,
                   array_agg(from_text),
                   array_agg(to_text))
    ), '')
  from rec;
$$;