/**
 * Syncs the "Mandarin::Random words" and "Mandarin::中文的谚语/成语" decks
 * into a single Supabase table (words_phrases), which the website's
 * Flashcards tab presents as one merged "Words and phrases" deck.
 *
 * Random words notes are simple: Front = word, Back = word<br>pinyin<br>
 * meaning<br><br>example_cn<br>example_pinyin<br>example_en.
 *
 * Idiom/saying notes are messy hand-formatted HTML with no consistent
 * structure, so they're just HTML-stripped into a front phrase + a single
 * combined "meaning" blob rather than split into pinyin/meaning/example.
 *
 * Run:
 *   npm run sync-words-phrases
 *
 * Anki + AnkiConnect must be open. Requires NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const ANKI_URL = "http://localhost:8765";
const RANDOM_WORDS_DECK = "Mandarin::Random words";
const IDIOMS_DECK = "Mandarin::中文的谚语/成语";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

async function fetchDeckNotes(deckName) {
  const noteIds = await anki("findNotes", { query: `deck:"${deckName}"` });
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
  return notes.map((n) => ({ note: n, cardInfo: cardInfoById[n.cards?.[0]] }));
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function statRow({ note, cardInfo }) {
  return {
    note_id: note.noteId,
    card_id: note.cards?.[0] ?? null,
    interval: cardInfo?.interval ?? null,
    reps: cardInfo?.reps ?? null,
    lapses: cardInfo?.lapses ?? null,
    factor: cardInfo?.factor ?? null,
    queue: cardInfo?.queue ?? null,
    due: cardInfo?.due ?? null,
    type: cardInfo?.type ?? null,
    mod: cardInfo?.mod ?? null,
  };
}

function parseRandomWord(entry) {
  const { note } = entry;
  const front = note.fields["Front"]?.value?.trim() ?? "";
  const back = note.fields["Back"]?.value ?? "";
  // Some notes wrap lines in <div> (with the blank separator as a whole
  // <div><br></div>) instead of bare <br><br> — splitting on <br> alone
  // shifts positions for those. stripHtml already normalizes both cases
  // into newline-joined, blank-filtered lines.
  const lines = stripHtml(back).split("\n");
  const [, pinyin, meaning, exampleCn, examplePinyin, exampleEn] = lines;
  return {
    ...statRow(entry),
    source: "random_words",
    word: front,
    pinyin: pinyin || null,
    meaning: meaning || null,
    example: exampleCn || null,
    example_pinyin: examplePinyin || null,
    example_meaning: exampleEn || null,
  };
}

function parseIdiom(entry) {
  const { note } = entry;
  const frontRaw = stripHtml(note.fields["Front"]?.value ?? "");
  const backRaw = stripHtml(note.fields["Back"]?.value ?? "");
  const front = frontRaw.split("\n")[0]?.trim() ?? frontRaw;
  // Drop the leading "Saying"/"Idiom" label line the Back field starts with.
  const meaning = backRaw.replace(/^(Saying|Idiom)\n/i, "").trim();
  return {
    ...statRow(entry),
    source: "idioms",
    word: front,
    pinyin: null,
    meaning: meaning || null,
  };
}

async function main() {
  const randomWords = await fetchDeckNotes(RANDOM_WORDS_DECK);
  const idioms = await fetchDeckNotes(IDIOMS_DECK);
  console.log(`✓ Fetched ${randomWords.length} random words, ${idioms.length} idioms/sayings`);

  const rows = [...randomWords.map(parseRandomWord), ...idioms.map(parseIdiom)];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in .env.local");
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const batchSize = 1000;
  const batches = [];
  for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize));
  const concurrency = 4;
  for (let i = 0; i < batches.length; i += concurrency) {
    const results = await Promise.all(
      batches.slice(i, i + concurrency).map((batch) =>
        supabase.from("words_phrases").upsert(batch, { onConflict: "note_id" })
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(`Supabase upsert failed: ${failed.error.message}`);
  }

  console.log(`✓ Upserted ${rows.length} rows to Supabase (words_phrases)`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
