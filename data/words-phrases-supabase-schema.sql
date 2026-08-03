create table if not exists words_phrases (
  note_id bigint primary key,
  source text not null, -- 'random_words' | 'idioms'
  word text not null,
  pinyin text,
  meaning text,
  card_id bigint,
  interval int,
  reps int,
  lapses int,
  factor int,
  queue int,
  due int,
  type int,
  mod int
);

grant all on words_phrases to service_role;
grant select on words_phrases to anon, authenticated;

alter table words_phrases disable row level security;
