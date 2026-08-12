-- Adds columns to store URLs for media pulled from Anki and uploaded to
-- the new public "mandarin-media" Supabase Storage bucket: pronunciation
-- audio (hanzi + HSK vocab decks), sentence audio (HSK vocab), and mnemonic
-- pictures embedded in some Random words / idioms notes.

alter table hanzi_cards add column if not exists audio_url text;

alter table hsk3_words add column if not exists audio_url text;
alter table hsk3_words add column if not exists sentence_audio_url text;

alter table words_phrases add column if not exists picture_url text;
