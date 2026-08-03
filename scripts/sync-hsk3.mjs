/**
 * Cross-references the "Mandarin::HSK 1-6 vocabulary" Anki deck against the
 * official HSK 3.0 (2025) word lists (data/hsk3-words.json) and upserts the
 * result straight into Supabase (hsk3_words + hsk3_stats) — every official
 * word, marked known or not, carrying the same raw Anki review stats as
 * hanzi_cards (interval, reps, lapses, factor, queue, due, type, mod) so
 * difficulty can be computed client-side, plus pinyin/meaning from
 * data/hsk3-word-info.json. Supabase is the only store for this data — no
 * local JSON fallback, so this script (or the "Refresh from Anki" button on
 * the live dashboard) is the only way to populate or update it.
 *
 * Words are deduped to the lowest level they appear in (~163 words show up
 * at more than one level in the source lists) so each word appears once.
 *
 * Run:
 *   npm run sync-hsk3
 *
 * Anki + AnkiConnect (add-on 2055492159) must be open. Requires
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const ANKI_URL = "http://localhost:8765";
const DECK_NAME = "Mandarin::HSK 1-6 vocabulary";
const LEVELS = ["hsk1", "hsk2", "hsk3", "hsk4", "hsk5", "hsk6", "hsk7-9"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORDS_FILE = join(__dirname, "../data/hsk3-words.json");
const WORD_INFO_FILE = join(__dirname, "../data/hsk3-word-info.json");

try {
  process.loadEnvFile(join(__dirname, "../.env.local"));
} catch {
  // .env.local not found — env vars may already be set (e.g. in CI)
}

async function anki(action, params = {}) {
  const res = await fetch(ANKI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function fetchDeckWords() {
  const noteIds = await anki("findNotes", { query: `deck:"${DECK_NAME}"` });
  if (noteIds.length === 0) throw new Error(`No notes found in deck "${DECK_NAME}"`);

  const notes = [];
  for (let i = 0; i < noteIds.length; i += 200) {
    const batch = await anki("notesInfo", { notes: noteIds.slice(i, i + 200) });
    notes.push(...batch);
  }

  const cardIds = notes.map((n) => n.cards?.[0]).filter(Boolean);
  const cardInfo = [];
  for (let i = 0; i < cardIds.length; i += 200) {
    const batch = await anki("cardsInfo", { cards: cardIds.slice(i, i + 200) });
    cardInfo.push(...batch);
  }
  const cardInfoById = Object.fromEntries(cardInfo.map((c) => [c.cardId, c]));

  const byWord = new Map();
  for (const n of notes) {
    const word = n.fields["Simplified"]?.value?.trim();
    if (!word || byWord.has(word)) continue;
    const cardId = n.cards?.[0];
    const info = cardId ? cardInfoById[cardId] : null;
    byWord.set(word, {
      note_id: n.noteId,
      card_id: cardId ?? null,
      interval: info?.interval ?? null,
      reps: info?.reps ?? null,
      lapses: info?.lapses ?? null,
      factor: info?.factor ?? null,
      queue: info?.queue ?? null,
      due: info?.due ?? null,
      type: info?.type ?? null,
      mod: info?.mod ?? null,
    });
  }
  return byWord;
}

// ~163 words appear at more than one level in the source lists (usually a
// common character whose core sense is basic but a secondary sense/compound
// is tested higher) — keep each word at the lowest level only.
function dedupeToFirstLevel(hsk3Words) {
  const seen = new Set();
  const deduped = {};
  for (const level of LEVELS) {
    deduped[level] = (hsk3Words[level] ?? []).filter((word) => {
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    });
  }
  return deduped;
}

async function main() {
  const hsk3Words = dedupeToFirstLevel(JSON.parse(readFileSync(WORDS_FILE, "utf-8")));
  const wordInfo = JSON.parse(readFileSync(WORD_INFO_FILE, "utf-8"));
  const byWord = await fetchDeckWords();
  console.log(`✓ Fetched ${byWord.size} words from "${DECK_NAME}"`);

  const levels = {};
  const summary = {};
  const allRows = [];
  for (const level of LEVELS) {
    const words = hsk3Words[level];
    levels[level] = words.map((word) => {
      const info = wordInfo[word];
      const r = byWord.get(word);
      const entry = {
        word,
        level,
        known: !!r,
        pinyin: info?.pinyin ?? null,
        meaning: info?.meaning ?? null,
        ...(r ?? {}),
      };
      allRows.push(entry);
      return entry;
    });
    const knownCount = levels[level].filter((w) => w.known).length;
    summary[level] = { total: words.length, known: knownCount };
  }

  const deckLearned = [...byWord.values()].filter((r) => (r.reps ?? 0) > 0).length;
  const deck = { total: byWord.size, learned: deckLearned };
  const updatedAt = new Date().toISOString();

  for (const level of LEVELS) {
    const s = summary[level];
    console.log(`  ${level}: ${s.known}/${s.total} (${Math.round((100 * s.known) / s.total)}%)`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in .env.local");
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const batchSize = 1000;
  const batches = [];
  for (let i = 0; i < allRows.length; i += batchSize) batches.push(allRows.slice(i, i + batchSize));

  const concurrency = 4;
  for (let i = 0; i < batches.length; i += concurrency) {
    const results = await Promise.all(
      batches.slice(i, i + concurrency).map((batch) => supabase.from("hsk3_words").upsert(batch, { onConflict: "word" }))
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(`Supabase upsert (hsk3_words) failed: ${failed.error.message}`);
  }
  const { error: statsError } = await supabase
    .from("hsk3_stats")
    .upsert({ id: 1, deck_total: deck.total, deck_learned: deck.learned, updated_at: updatedAt });
  if (statsError) throw new Error(`Supabase upsert (hsk3_stats) failed: ${statsError.message}`);

  console.log(`✓ Upserted ${allRows.length} words + stats to Supabase`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
