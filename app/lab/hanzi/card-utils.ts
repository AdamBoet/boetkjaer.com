import type { HanziCard } from "./CharacterGrid";

// Anki's raw "Front" note field stores each pronunciation's gloss as
// "word (gloss)" — the leading word just repeats what the Pronunciation
// field already says. Only unwraps when the "/"-separated segment count
// matches the pronunciation count exactly; otherwise the text isn't
// segmented per-pronunciation (e.g. a bulk-imported CEDICT entry with a
// single gloss spanning all readings) and is left untouched rather than
// risk mangling it.
export function cleanMeaning(pronunciation: string, front: string): string {
  const prons = pronunciation.split("/").map((s) => s.trim());
  const segments = front.split("/").map((s) => s.trim());
  if (prons.length < 2 || segments.length !== prons.length) return front;
  return segments
    .map((s) => {
      const m = s.match(/\(([^)]*)\)/);
      return m ? m[1].trim() : s;
    })
    .join(" / ");
}

export function cardDueDiff(card: HanziCard): number | null {
  if (!card.mod || !card.interval) return null;
  const r = new Date(card.mod * 1000);
  const dueDay = new Date(r.getFullYear(), r.getMonth(), r.getDate() + card.interval);
  const t = new Date();
  const todayDay = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((dueDay.getTime() - todayDay.getTime()) / 86400000);
}
