/**
 * Cross-references the "Mandarin::HSK 1-6 vocabulary" Anki deck against the
 * official HSK 3.0 (2025) word lists (data/hsk3-words.json) to produce a
 * per-level coverage grid: every official word, marked known or not, with a
 * 0-1 difficulty score (same formula as the 汉字 dashboard) for known words
 * that have review history.
 *
 * Words are deduped to the lowest level they appear in (~163 words show up
 * at more than one level in the source lists) so each word appears once.
 *
 * Run before committing to update the dashboard:
 *   npm run sync-hsk3
 *
 * Anki + AnkiConnect (add-on 2055492159) must be open.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ANKI_URL = "http://localhost:8765";
const DECK_NAME = "Mandarin::HSK 1-6 vocabulary";
const LEVELS = ["hsk1", "hsk2", "hsk3", "hsk4", "hsk5", "hsk6", "hsk7-9"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORDS_FILE = join(__dirname, "../data/hsk3-words.json");
const WORD_INFO_FILE = join(__dirname, "../data/hsk3-word-info.json");
const OUT_FILE = join(__dirname, "../data/hsk3-coverage.json");

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
      interval: info?.interval ?? null,
      reps: info?.reps ?? null,
      lapses: info?.lapses ?? null,
    });
  }
  return byWord;
}

// Same difficulty formula as app/lab/hanzi/HanziDashboard.tsx.
function computeScores(byWord) {
  const scored = [...byWord.entries()].filter(
    ([, r]) => (r.reps ?? 0) > 0 && r.interval != null && r.lapses != null
  );
  const maxLapses = Math.max(...scored.map(([, r]) => r.lapses), 1);

  const raw = new Map(
    scored.map(([w, r]) => {
      const lapseRate = r.lapses / Math.max(r.reps, 1);
      const lapseAbs = r.lapses / maxLapses;
      const intervalDiff = 1 - Math.min(r.interval, 90) / 90;
      return [w, lapseRate * 0.45 + lapseAbs * 0.2 + intervalDiff * 0.35];
    })
  );

  const ordered = [...raw.entries()].sort((a, b) => a[1] - b[1]);
  const scores = new Map();
  ordered.forEach(([w], i) => {
    scores.set(w, ordered.length > 1 ? i / (ordered.length - 1) : 0.5);
  });
  return scores;
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
  const scores = computeScores(byWord);

  const levels = {};
  const summary = {};
  for (const level of LEVELS) {
    const words = hsk3Words[level];
    levels[level] = words.map((word) => {
      const info = wordInfo[word];
      const base = info ? { word, pinyin: info.pinyin, meaning: info.meaning } : { word };
      const r = byWord.get(word);
      if (!r) return { ...base, known: false };
      const entry = { ...base, known: true, note_id: r.note_id };
      if (scores.has(word)) entry.score = Math.round(scores.get(word) * 10000) / 10000;
      return entry;
    });
    const knownCount = levels[level].filter((w) => w.known).length;
    summary[level] = { total: words.length, known: knownCount };
  }

  const deckLearned = [...byWord.values()].filter((r) => (r.reps ?? 0) > 0).length;
  const deck = { total: byWord.size, learned: deckLearned };

  const out = { levels, summary, deck, updatedAt: new Date().toISOString() };
  writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log(`✓ Wrote ${OUT_FILE}`);
  for (const level of LEVELS) {
    const s = summary[level];
    console.log(`  ${level}: ${s.known}/${s.total} (${Math.round((100 * s.known) / s.total)}%)`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
