-- Full per-review history, pulled from Anki's own revlog via AnkiConnect's
-- getReviewsOfCards. Lets the Statistics page compute real historical
-- charts (calendar heatmap, hourly breakdown, answer-button counts, "today"
-- summary) instead of approximating them from each card's current state,
-- which is all hanzi_cards/hsk3_words/words_phrases capture.

create table if not exists review_log (
  id bigserial primary key,
  source text not null,               -- 'hanzi' | 'hsk3' | 'wp'
  card_id bigint not null,            -- Anki card id
  review_id bigint not null,          -- Anki's revlog id — epoch ms, doubles as the review timestamp
  ease smallint not null,             -- 1=again, 2=hard, 3=good, 4=easy
  interval integer not null,          -- resulting interval in days (negative = seconds, learning steps)
  last_interval integer not null,     -- interval before this review — >=21 means the card was "mature"
  factor integer not null,
  time_taken_ms integer not null,
  review_type smallint not null,      -- 0=learn, 1=review, 2=relearn, 3=filtered/cram, 4=manual
  reviewed_at timestamptz not null,
  unique (source, card_id, review_id)
);

create index if not exists review_log_reviewed_at_idx on review_log (reviewed_at);
create index if not exists review_log_source_idx on review_log (source);

alter table review_log enable row level security;
drop policy if exists "select_review_log" on review_log;
create policy "select_review_log" on review_log for select using (true);

grant select, insert, update, delete on review_log to service_role;
grant select on review_log to anon, authenticated;
grant usage, select on sequence review_log_id_seq to service_role;
