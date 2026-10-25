/**
 * Reads the Anki 汉字 cards folder and optionally queries AnkiConnect for
 * review stats. Writes:
 *   data/anki-stats.json   - summary counts for the overview cards
 *   data/hanzi-cards.json  - per-character data + Anki review stats
 *
 * Run before committing to update the dashboard:
 *   npm run sync-stats
 *
 * Anki + AnkiConnect (add-on 2055492159) must be open for review stats.
 * If Anki is offline the script still updates counts and keeps existing stats.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const CARDS_DIR =
  "/Users/adam/Dokumenter/Documents/Projects/Cache/Anki flashcards/Anki 汉字/cards";
const ANKI_URL = "http://localhost:8765";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, "../data/anki-stats.json");
const CARDS_FILE = join(__dirname, "../data/hanzi-cards.json");

async function anki(action, params = {}) {
  const res = await fetch(ANKI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function readCardFiles() {
  const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => {
      const d = JSON.parse(readFileSync(join(CARDS_DIR, f), "utf-8"));
      return {
        character: d.character,
        rank: d.rank,
        pronunciation: d.pronunciation,
        front: d.front,
        note_id: d.note_id,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

function loadExistingCardStats() {
  if (!existsSync(CARDS_FILE)) return {};
  const arr = JSON.parse(readFileSync(CARDS_FILE, "utf-8"));
  return Object.fromEntries(arr.map((c) => [c.note_id, c]));
}

async function fetchAnkiStats(noteIds) {
  const allNotes = [];
  for (let i = 0; i < noteIds.length; i += 50) {
    const batch = await anki("notesInfo", { notes: noteIds.slice(i, i + 50) });
    allNotes.push(...batch);
  }

  const allCardIds = allNotes.flatMap((n) => n.cards ?? []);
  const allCardInfo = [];
  for (let i = 0; i < allCardIds.length; i += 50) {
    const batch = await anki("cardsInfo", { cards: allCardIds.slice(i, i + 50) });
    allCardInfo.push(...batch);
  }

  const cardInfoById = Object.fromEntries(allCardInfo.map((c) => [c.cardId, c]));

  const result = {};
  for (const note of allNotes) {
    const cardId = note.cards?.[0];
    if (!cardId) continue;
    const info = cardInfoById[cardId];
    if (!info) continue;
    result[note.noteId] = {
      card_id: cardId,
      interval: info.interval,
      reps: info.reps,
      lapses: info.lapses,
      factor: info.factor,
      queue: info.queue,
      due: info.due,
      type: info.type,
      mod: info.mod ?? null,
    };
  }
  return result;
}

async function main() {
  const cards = readCardFiles();

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  const dayOfYear = Math.floor((now - yearStart) / 86400000) + 1;
  const daysInYear = Math.floor((yearEnd - yearStart) / 86400000);

  // Try to get per-card review stats from Anki
  let reviewStats = {};
  try {
    reviewStats = await fetchAnkiStats(cards.map((c) => c.note_id));
    console.log(`✓ Fetched Anki review stats for ${Object.keys(reviewStats).length} cards`);
  } catch (e) {
    console.warn(`⚠  Anki not reachable (${e.message}) — keeping existing review stats`);
    const existing = loadExistingCardStats();
    for (const [noteId, card] of Object.entries(existing)) {
      if (card.card_id != null) {
        reviewStats[noteId] = {
          card_id: card.card_id,
          interval: card.interval,
          reps: card.reps,
          lapses: card.lapses,
          factor: card.factor,
          queue: card.queue,
          due: card.due,
          type: card.type,
          mod: card.mod,
        };
      }
    }
  }

  // Only count cards that have been reviewed at least once
  const learnedCount = cards.filter((c) => (reviewStats[c.note_id]?.reps ?? 0) > 0).length;

  writeFileSync(
    STATS_FILE,
    JSON.stringify(
      { learnedCount, updatedAt: now.toISOString(), year: now.getFullYear(), dayOfYear, daysInYear },
      null,
      2
    )
  );
  console.log(`✓ ${learnedCount} cards · wrote ${STATS_FILE}`);

  const merged = cards.map((c) => ({ ...c, ...(reviewStats[c.note_id] ?? {}) }));
  writeFileSync(CARDS_FILE, JSON.stringify(merged, null, 2));
  console.log(`✓ Wrote ${CARDS_FILE}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
