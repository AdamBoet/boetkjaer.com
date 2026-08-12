-- review_log.card_id originally stored Anki's internal numeric card id,
-- which only exists for cards synced from Anki. Reviews graded directly on
-- the site (no Anki involved at all) don't have one — so this switches the
-- column to store the app's own card identifier instead: the same `dbId`
-- already used everywhere else (note_id for hanzi/words&phrases, the word
-- itself for HSK vocab). Renamed to db_id to make that explicit.

alter table review_log drop constraint if exists review_log_source_card_id_review_id_key;
alter table review_log rename column card_id to db_id;
alter table review_log alter column db_id type text using db_id::text;
alter table review_log add constraint review_log_source_db_id_review_id_key unique (source, db_id, review_id);
