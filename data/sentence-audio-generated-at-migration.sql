-- Splits sentence generation into two independently-tracked phases:
-- text (now written by a Claude scheduled task via app/api/mandarin/*)
-- and audio (still generated locally by daily_refresh.py via Kokoro,
-- since that needs macOS). The existing sentence_generated_at/
-- example_generated_at columns keep their old meaning ("text is fresh
-- as of this timestamp" — still what needs_refresh() compares against
-- last review). These new columns mark "audio matches the current
-- text as of this timestamp" — the local pipeline generates audio for
-- anything where audio is older than (or missing relative to) the text.

alter table hsk3_words add column if not exists sentence_audio_generated_at timestamptz;
alter table words_phrases add column if not exists example_audio_generated_at timestamptz;
