/**
 * Pulls audio (hanzi + HSK vocab decks) and mnemonic pictures (embedded in
 * some Random words / idioms notes) out of Anki's local media collection
 * via AnkiConnect, uploads them to the public "mandarin-media" Supabase
 * Storage bucket, and writes the resulting public URLs back onto the
 * matching hanzi_cards / hsk3_words / words_phrases rows.
 *
 * Anki + AnkiConnect must be open. Requires NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * Run:
 *   node scripts/sync-media.mjs
 */

import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const ANKI_URL = "http://localhost:8765";
const BUCKET = "mandarin-media";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(join(__dirname, "../.env.local"));
} catch {
  // .env.local not found — env vars may already be set (e.g. in CI)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in .env.local");
}
const supabase = createClient(supabaseUrl, serviceKey);

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

const CONTENT_TYPES = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const uploadCache = new Map(); // anki filename -> public URL, avoids re-uploading shared files

// `safeKey` must be a plain ASCII identifier (e.g. an Anki note ID) —
// Supabase Storage's key validation rejects non-ASCII characters *and*
// percent-encoded escapes of them, so Anki's own filenames (often the
// Chinese word itself, e.g. "audio_席.m4a") can't be used directly.
async function uploadAnkiMedia(filename, storagePrefix, safeKey) {
  if (uploadCache.has(filename)) return uploadCache.get(filename);
  const b64 = await anki("retrieveMediaFile", { filename });
  if (!b64) {
    uploadCache.set(filename, null);
    return null;
  }
  const ext = extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const path = `${storagePrefix}/${safeKey}${ext}`;
  const buffer = Buffer.from(b64, "base64");
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) {
    console.warn(`  ! upload failed for ${filename}: ${error.message}`);
    uploadCache.set(filename, null);
    return null;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  uploadCache.set(filename, data.publicUrl);
  return data.publicUrl;
}

// Anki fields store audio as "[sound:filename.mp3]" and pictures as
// "<img src=\"filename.jpg\">" (possibly with other attributes).
function extractSoundFilename(fieldValue) {
  const m = fieldValue?.match(/\[sound:([^\]]+)\]/);
  return m ? m[1] : null;
}
function extractImgFilename(fieldValue) {
  const m = fieldValue?.match(/<img[^>]*\bsrc="([^"]+)"/i);
  return m ? m[1] : null;
}

// Rows already exist (created by the hanzi/hsk3/words-phrases syncs) — an
// upsert would need every NOT NULL column to satisfy the implicit insert
// path, so patch existing rows directly instead.
async function updateRow(table, pk, pkValue, fields) {
  const { error } = await supabase.from(table).update(fields).eq(pk, pkValue);
  if (error) throw new Error(`${table} update failed for ${pk}=${pkValue}: ${error.message}`);
}

async function syncHanziAudio() {
  console.log("\n-- Hanzi audio --");
  const noteIds = await anki("findNotes", { query: 'deck:"Mandarin::汉字 writing"' });
  console.log(`${noteIds.length} notes`);
  let uploaded = 0, skipped = 0;
  for (let i = 0; i < noteIds.length; i += 200) {
    const batch = await anki("notesInfo", { notes: noteIds.slice(i, i + 200) });
    const updates = [];
    for (const n of batch) {
      const filename = extractSoundFilename(n.fields["Audio"]?.value);
      if (!filename) { skipped++; continue; }
      const url = await uploadAnkiMedia(filename, "hanzi-audio", n.noteId);
      if (url) updates.push({ note_id: n.noteId, audio_url: url });
      else skipped++;
    }
    await Promise.all(updates.map((u) => updateRow("hanzi_cards", "note_id", u.note_id, { audio_url: u.audio_url })));
    uploaded += updates.length;
    process.stdout.write(`\r  ${Math.min(i + 200, noteIds.length)}/${noteIds.length}`);
  }
  console.log(`\n✓ ${uploaded} uploaded, ${skipped} skipped (no audio field)`);
}

async function syncHsk3Audio() {
  console.log("\n-- HSK vocab audio --");
  const noteIds = await anki("findNotes", { query: 'deck:"Mandarin::HSK 1-6 vocabulary"' });
  console.log(`${noteIds.length} notes`);
  let uploaded = 0, skipped = 0;
  for (let i = 0; i < noteIds.length; i += 200) {
    const batch = await anki("notesInfo", { notes: noteIds.slice(i, i + 200) });
    const updates = [];
    for (const n of batch) {
      const word = n.fields["Simplified"]?.value?.trim();
      if (!word) { skipped++; continue; }
      const wordAudioFile = extractSoundFilename(n.fields["Audio"]?.value);
      const sentAudioFile = extractSoundFilename(n.fields["SentenceAudio"]?.value);
      const audio_url = wordAudioFile ? await uploadAnkiMedia(wordAudioFile, "hsk3-audio", n.noteId) : null;
      const sentence_audio_url = sentAudioFile ? await uploadAnkiMedia(sentAudioFile, "hsk3-sentence-audio", n.noteId) : null;
      if (audio_url || sentence_audio_url) {
        updates.push({ word, ...(audio_url && { audio_url }), ...(sentence_audio_url && { sentence_audio_url }) });
      } else {
        skipped++;
      }
    }
    await Promise.all(updates.map(({ word, ...fields }) => updateRow("hsk3_words", "word", word, fields)));
    uploaded += updates.length;
    process.stdout.write(`\r  ${Math.min(i + 200, noteIds.length)}/${noteIds.length}`);
  }
  console.log(`\n✓ ${uploaded} uploaded, ${skipped} skipped (no audio field)`);
}

async function syncWordsPhrasesPictures() {
  console.log("\n-- Words & phrases pictures --");
  const rwIds = await anki("findNotes", { query: 'deck:"Mandarin::Random words"' });
  const idiomIds = await anki("findNotes", { query: 'deck:"Mandarin::中文的谚语/成语"' });
  const noteIds = [...rwIds, ...idiomIds];
  console.log(`${noteIds.length} notes`);
  let uploaded = 0;
  for (let i = 0; i < noteIds.length; i += 200) {
    const batch = await anki("notesInfo", { notes: noteIds.slice(i, i + 200) });
    const updates = [];
    for (const n of batch) {
      const filename =
        extractImgFilename(n.fields["Back"]?.value) ?? extractImgFilename(n.fields["Front"]?.value);
      if (!filename) continue;
      const url = await uploadAnkiMedia(filename, "words-phrases-pictures", n.noteId);
      if (url) updates.push({ note_id: n.noteId, picture_url: url });
    }
    await Promise.all(updates.map((u) => updateRow("words_phrases", "note_id", u.note_id, { picture_url: u.picture_url })));
    uploaded += updates.length;
    process.stdout.write(`\r  ${Math.min(i + 200, noteIds.length)}/${noteIds.length}`);
  }
  console.log(`\n✓ ${uploaded} pictures uploaded`);
}

async function main() {
  await syncHanziAudio();
  await syncHsk3Audio();
  await syncWordsPhrasesPictures();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
