-- "Words and phrases" is being split back into two separate decks:
-- "Random words" (source = 'random_words') and "中文的谚语/成语" (source =
-- 'idioms') — they were previously combined under one "wp" deck key in the
-- UI, but words_phrases.source already distinguishes them per-row.
--
-- review_log rows logged before this split used the generic literal 'wp'
-- for every word/phrase review, regardless of which of the two it actually
-- was. Backfill those using the word/phrase's current source, so historical
-- Statistics (Calendar/Hourly/Answer buttons) split correctly too instead
-- of losing pre-split history under a now-unused 'wp' bucket.

update review_log
set source = wp.source
from words_phrases wp
where review_log.source = 'wp'
  and review_log.db_id = wp.note_id::text;
