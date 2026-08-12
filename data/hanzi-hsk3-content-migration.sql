-- Adds text content fields pulled from Anki notes that weren't synced
-- before: hanzi's Components (radical breakdown) + Examples (usage
-- examples per pronunciation), and HSK vocab's example sentence + pinyin +
-- English translation.

alter table hanzi_cards add column if not exists components text;
alter table hanzi_cards add column if not exists examples text;

alter table hsk3_words add column if not exists sentence text;
alter table hsk3_words add column if not exists sentence_pinyin text;
alter table hsk3_words add column if not exists sentence_meaning text;
