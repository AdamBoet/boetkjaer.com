-- The screenshot-upload button was random_words-only; adding a second copy
-- of it to the idioms deck-overview screen (so idiom lookups can be routed
-- there directly instead of always landing in random_words and needing to
-- be re-sorted by hand) needs screenshot_queue to record which deck each
-- upload was meant for. daily_refresh.py's process_screenshot_queue reads
-- this to set the new words_phrases row's source instead of assuming
-- 'random_words' unconditionally.
--
-- Existing pending/processed rows predate this column and were all
-- random_words uploads (the only deck the button existed on), hence the
-- default.

alter table screenshot_queue
  add column if not exists target_source text not null default 'random_words';

alter table screenshot_queue
  add constraint screenshot_queue_target_source_check
  check (target_source in ('random_words', 'idioms'));
