import { NextRequest, NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hanzi = require("hanzi");

// CommonJS module with all CC-CEDICT data bundled as require()'d JS —
// no filesystem reads, no env vars, no network — but that also means it's
// not Edge-compatible.
export const runtime = "nodejs";

hanzi.start();

type Entry = { traditional: string; pinyin: string; meaning: string };
type Segment = { word: string; entries: Entry[] };

// Numbered-tone pinyin (CC-CEDICT's native format, e.g. "xi1 huan5") to
// accented display form (e.g. "xǐ huan") — no existing JS utility for this
// in the repo; pypinyin/to_tone() on the Python side isn't reachable here.
const TONE_MARKS: Record<string, string[]> = {
  a: ["a", "ā", "á", "ǎ", "à"],
  e: ["e", "ē", "é", "ě", "è"],
  i: ["i", "ī", "í", "ǐ", "ì"],
  o: ["o", "ō", "ó", "ǒ", "ò"],
  u: ["u", "ū", "ú", "ǔ", "ù"],
  ü: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
};
// Vowel priority for placing the tone mark when a syllable has more than
// one vowel (e.g. "huan" -> the 'a'), per the standard pinyin tone-mark
// rule: a > e > o > (the second vowel of iu/ui) > i > u > ü. "iu" is a
// special case (mark the 'u', not the 'i' that generic priority would
// otherwise hit first) — "ui" already gets the right vowel ('i') from
// plain priority order, since i comes before u in the list below.
const VOWEL_PRIORITY = ["a", "e", "o", "i", "u", "ü"];

function toneSyllable(syllable: string): string {
  const match = syllable.match(/^([a-züv]+)([0-5])$/i);
  if (!match) return syllable;
  const [, letters, toneStr] = match;
  const tone = Number(toneStr);
  const base = letters.toLowerCase().replace(/v/g, "ü");
  if (tone === 0 || tone === 5) return base; // neutral tone, no mark
  let target: string | null = null;
  if (base.includes("iu")) {
    target = "u";
  } else {
    for (const v of VOWEL_PRIORITY) {
      if (base.includes(v)) {
        target = v;
        break;
      }
    }
  }
  if (!target || !TONE_MARKS[target]) return base;
  const marked = TONE_MARKS[target][tone];
  const pos = base.indexOf(target);
  return base.slice(0, pos) + marked + base.slice(pos + 1);
}

function toneMarkPinyin(numbered: string): string {
  return numbered
    .split(" ")
    .map((syl) => toneSyllable(syl))
    .join(" ");
}

function lookupSegment(word: string): Segment {
  const results = hanzi.definitionLookup(word) as
    | { traditional: string; simplified: string; pinyin: string; definition: string }[]
    | null;
  if (!results || results.length === 0) return { word, entries: [] };
  return {
    word,
    entries: results.map((r) => ({
      traditional: r.traditional,
      pinyin: toneMarkPinyin(r.pinyin),
      meaning: r.definition,
    })),
  };
}

export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get("text");
  if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });

  const words: string[] = hanzi.segment(text);
  const segments = words.map(lookupSegment);
  return NextResponse.json({ segments });
}
