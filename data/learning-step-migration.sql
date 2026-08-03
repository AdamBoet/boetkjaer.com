-- Adds per-card learning-step tracking so the website's own scheduler can
-- mirror Anki's real state machine (learning steps 1m/10m, relearning step
-- 10m, graduating interval 1d, easy interval 4d) instead of collapsing
-- everything to a flat day-granularity interval.
--
-- No new grants needed — grants are table-level and already cover new
-- columns on hanzi_cards / hsk3_words / words_phrases.

alter table hanzi_cards add column if not exists learning_step int;
alter table hsk3_words add column if not exists learning_step int;
alter table words_phrases add column if not exists learning_step int;
