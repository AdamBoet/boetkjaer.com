-- Splits the example sentence out of the `meaning` blob into its own
-- fields, matching how hsk3_words already separates sentence/pinyin/
-- meaning. Previously sync-words-phrases.mjs appended the example
-- (Chinese + pinyin + English) directly into `meaning`, which made it
-- impossible to show only the example's Chinese text on the card front
-- before reveal (word_pinyin/word_meaning must stay hidden until flipped).

alter table words_phrases add column if not exists example text;
alter table words_phrases add column if not exists example_pinyin text;
alter table words_phrases add column if not exists example_meaning text;
