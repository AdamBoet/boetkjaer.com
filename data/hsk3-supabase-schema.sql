create table if not exists hsk3_words (
  word text primary key,
  level text not null,
  known boolean not null default false,
  pinyin text,
  meaning text,
  note_id bigint,
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

create table if not exists hsk3_stats (
  id int primary key default 1,
  deck_total int not null,
  deck_learned int not null,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

grant all on hsk3_words to service_role;
grant all on hsk3_stats to service_role;
grant select on hsk3_words to anon, authenticated;
grant select on hsk3_stats to anon, authenticated;

alter table hsk3_words disable row level security;
alter table hsk3_stats disable row level security;
