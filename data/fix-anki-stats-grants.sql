-- anki_stats was created without the default Supabase role grants, so even
-- service_role (which bypasses RLS but still needs table-level GRANTs) got
-- "permission denied for table anki_stats" on upsert. This brings it in
-- line with the other tables: explicit grants + RLS with a public read
-- policy, service_role still bypasses RLS for writes.

grant select, insert, update, delete on anki_stats to service_role;
grant select on anki_stats to anon, authenticated;

alter table anki_stats enable row level security;
drop policy if exists "select_anki_stats" on anki_stats;
create policy "select_anki_stats" on anki_stats for select using (true);
