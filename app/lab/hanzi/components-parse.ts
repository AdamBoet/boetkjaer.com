// Helpers for the hoverable "components" line on a hanzi card, e.g.
// "氵 (water), 青 (green; blue)". Pure functions, no React.

export type ComponentPart =
  | { kind: "text"; text: string }
  | { kind: "component"; raw: string; char: string; meaning: string | null };

// A component is a run of Han characters (incl. the CJK radical/stroke blocks,
// which Script=Han does not fully cover) optionally followed by "(meaning)".
// Anything else — separators, stray prose on old hand-edited rows — is kept
// as plain text, so joining every part reproduces the input exactly.
const COMPONENT_RE = /([\p{Script=Han}⺀-⿟㇀-㇯]+)(?:\s*\(([^)]*)\))?/gu;

export function parseComponents(str: string): ComponentPart[] {
  const parts: ComponentPart[] = [];
  let last = 0;
  for (const m of str.matchAll(COMPONENT_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ kind: "text", text: str.slice(last, start) });
    parts.push({ kind: "component", raw: m[0], char: m[1], meaning: m[2]?.trim() || null });
    last = start + m[0].length;
  }
  if (last < str.length) parts.push({ kind: "text", text: str.slice(last) });
  return parts;
}

// Radical variants have no standalone dictionary entry, so look up the full
// character they stand for instead. 阝 is deliberately absent: it is 阜
// "mound" on the left and 邑 "town" on the right, so no single base fits.
export const RADICAL_BASE: Record<string, string> = {
  "氵": "水",
  "氺": "水",
  "讠": "言",
  "纟": "丝",
  "扌": "手",
  "亻": "人",
  "忄": "心",
  "艹": "草",
  "⺮": "竹",
  "衤": "衣",
  "礻": "示",
  "刂": "刀",
  "犭": "犬",
  "灬": "火",
  "罒": "网",
  "⻊": "足",
  "攵": "攴",
  "饣": "食",
  "钅": "金",
  "牜": "牛",
  "⺌": "小",
};

export function lookupKey(char: string): string {
  return RADICAL_BASE[char] ?? char;
}

const STOPWORDS = new Set(["the", "and", "for", "with", "from", "that", "this"]);

// Pinyin to show for a component. CC-CEDICT lists readings alphabetically,
// not by frequency, so prefer readings whose dictionary meaning overlaps the
// meaning already written on the card (石 "stone" -> shí, not dàn), skip
// capitalised proper-noun readings, and cap at two.
export function pickPinyin(entries: { pinyin: string; meaning: string }[], inlineMeaning: string | null): string {
  const common = entries.filter((e) => !/^[A-Z]/.test(e.pinyin));
  const pool = common.length > 0 ? common : entries;
  const words = ((inlineMeaning ?? "").toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
  const matching = words.length
    ? pool.filter((e) => words.some((w) => new RegExp(`\\b${w}`).test(e.meaning.toLowerCase())))
    : [];
  const chosen = matching.length > 0 ? matching : pool;
  return [...new Set(chosen.map((e) => e.pinyin))].slice(0, 2).join(" / ");
}
