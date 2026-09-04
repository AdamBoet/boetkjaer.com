import { supabase, fetchAllRows } from "@/lib/supabase";
import staticStats from "@/data/anki-stats.json";
import staticCards from "@/data/hanzi-cards.json";
import { type HanziCard } from "./CharacterGrid";
import { type Hsk3Coverage, type Hsk3Word } from "./Hsk3Grid";
import { type WordPhrase } from "./FlashcardTab";

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

export async function fetchMandarinData() {
  const [{ data: statsRow }, cardsRows, { data: hsk3StatsRow }, hsk3WordsRows, wordsPhrasesRows] = await Promise.all([
    supabase.from("anki_stats").select("*").eq("id", 1).single(),
    fetchAllRows<HanziCard>("hanzi_cards", "*", "rank"),
    supabase.from("hsk3_stats").select("*").eq("id", 1).single(),
    fetchAllRows<Hsk3Word & { level: string }>("hsk3_words", "*", "word"),
    fetchAllRows<WordPhrase>("words_phrases", "*", "word"),
  ]);

  const stats = statsRow ?? staticStats;
  const cards = (cardsRows.length ? cardsRows : staticCards) as HanziCard[];
  const wordsPhrases = wordsPhrasesRows;

  const hsk3Coverage: Hsk3Coverage =
    hsk3WordsRows?.length && hsk3StatsRow
      ? {
          ...buildHsk3Coverage(hsk3WordsRows, hsk3StatsRow.updated_at),
          deck: { total: hsk3StatsRow.deck_total, learned: hsk3StatsRow.deck_learned },
        }
      : emptyHsk3Coverage();

  return { stats, cards, wordsPhrases, hsk3Coverage };
}
