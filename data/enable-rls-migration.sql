-- Re-enables RLS on the four tables where it was disabled earlier to
-- unblock anon reads, replacing "RLS off" with an explicit read-only
-- policy instead. Functionally identical to today: anon/authenticated
-- still get full SELECT access; service_role bypasses RLS entirely for
-- all server-side writes (grading, syncing, media uploads), so nothing
-- else changes. This just removes the "no backstop" gap Supabase's
-- Advisor flags.

alter table hanzi_cards enable row level security;
drop policy if exists allow_all_hanzi_cards on hanzi_cards;
create policy "select_hanzi_cards" on hanzi_cards for select using (true);

alter table hsk3_stats enable row level security;
create policy "select_hsk3_stats" on hsk3_stats for select using (true);

alter table hsk3_words enable row level security;
create policy "select_hsk3_words" on hsk3_words for select using (true);

alter table words_phrases enable row level security;
create policy "select_words_phrases" on words_phrases for select using (true);
