-- Precomputed Statistics-tab aggregates (Today/Calendar/Hourly/Answer
-- buttons), one row per deck filter ("all", "hanzi", "hsk3", "wp"). Written
-- by a background recompute job instead of every page load recrunching the
-- full review_log client-side.

create table if not exists stats_cache (
  deck text primary key,
  data jsonb not null,
  computed_at timestamptz not null default now()
);

grant select, insert, update on stats_cache to service_role;
