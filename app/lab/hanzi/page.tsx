import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import staticStats from "@/data/anki-stats.json";
import staticCards from "@/data/hanzi-cards.json";
import HanziDashboard from "./HanziDashboard";
import { type HanziCard } from "./CharacterGrid";
import { type Hsk3Coverage, type Hsk3Word } from "./Hsk3Grid";
import { type WordPhrase } from "./FlashcardTab";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mandarin",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mandarin",
  },
};

const LEVEL_KEYS = ["hsk1", "hsk2", "hsk3", "hsk4", "hsk5", "hsk6", "hsk7-9"];

function buildHsk3Coverage(rows: (Hsk3Word & { level: string })[], updatedAt: string): Hsk3Coverage {
  const levels: Hsk3Coverage["levels"] = {};
  const summary: Hsk3Coverage["summary"] = {};
  for (const key of LEVEL_KEYS) {
    const words = rows.filter((r) => r.level === key).map(({ level: _level, ...w }) => w);
    levels[key] = words;
    summary[key] = { total: words.length, known: words.filter((w) => w.known).length };
  }
  return { levels, summary, updatedAt };
}

function emptyHsk3Coverage(): Hsk3Coverage {
  const levels: Hsk3Coverage["levels"] = {};
  const summary: Hsk3Coverage["summary"] = {};
  for (const key of LEVEL_KEYS) {
    levels[key] = [];
    summary[key] = { total: 0, known: 0 };
  }
  return { levels, summary, deck: { total: 0, learned: 0 }, updatedAt: "" };
}

// Supabase/PostgREST caps a single select() at 1000 rows by default — with
// 10,900 words, that silently truncated the grid. Page through in batches.
async function fetchAllHsk3Words(): Promise<(Hsk3Word & { level: string })[]> {
  const pageSize = 1000;
  const rows: (Hsk3Word & { level: string })[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("hsk3_words")
      .select("*")
      .order("word")
      .range(from, from + pageSize - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

export default async function HanziPage() {
  const [{ data: statsRow }, { data: cardsRows }, { data: hsk3StatsRow }, hsk3WordsRows, { data: wordsPhrasesRows }] = await Promise.all([
    supabase.from("anki_stats").select("*").eq("id", 1).single(),
    supabase.from("hanzi_cards").select("*").order("rank"),
    supabase.from("hsk3_stats").select("*").eq("id", 1).single(),
    fetchAllHsk3Words(),
    supabase.from("words_phrases").select("*").order("word"),
  ]);

  const stats = statsRow ?? staticStats;
  const cards = (cardsRows?.length ? cardsRows : staticCards) as HanziCard[];
  const wordsPhrases = (wordsPhrasesRows ?? []) as WordPhrase[];

  const hsk3Coverage: Hsk3Coverage =
    hsk3WordsRows?.length && hsk3StatsRow
      ? {
          ...buildHsk3Coverage(hsk3WordsRows, hsk3StatsRow.updated_at),
          deck: { total: hsk3StatsRow.deck_total, learned: hsk3StatsRow.deck_learned },
        }
      : emptyHsk3Coverage();

  return (
    <HanziDashboard
      initialStats={stats}
      initialCards={cards}
      hsk3Coverage={hsk3Coverage}
      wordsPhrases={wordsPhrases}
    />
  );
}
