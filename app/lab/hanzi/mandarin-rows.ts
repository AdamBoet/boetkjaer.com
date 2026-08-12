import { type HanziCard } from "./CharacterGrid";
import { LEVELS, type Hsk3Coverage } from "./Hsk3Grid";
import { type WordPhrase, type DueCard, toDueCard, isLearning, isNeverStudied } from "./FlashcardTab";
import { cardDueDiff } from "./card-utils";

export type Status = "new" | "learning" | "review" | "relearning";

export interface MandarinRow extends DueCard {
  status: Status;
  levelLabel?: string;
  level?: string; // HSK level key (e.g. "hsk3") — LEVELS[].key, hsk3 rows only
}

export function statusOf(card: { reps?: number; type?: number }): Status {
  if (isNeverStudied(card.reps)) return "new";
  if (card.type === 3) return "relearning";
  if (isLearning(card.type)) return "learning";
  return "review";
}

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  learning: "Learning",
  review: "Review",
  relearning: "Relearning",
};

export const STATUS_DOT: Record<Status, string> = {
  new: "bg-blue-500",
  learning: "bg-amber-500",
  relearning: "bg-red-500",
  review: "bg-emerald-500",
};

// The single unified card list across every deck — shared by the
// Browse and Statistics tabs so both work from the exact same rows instead
// of re-deriving (and risking drift from) their own copies.
export function buildMandarinRows(
  cards: HanziCard[],
  hsk3Coverage: Hsk3Coverage,
  wordsPhrases: WordPhrase[]
): MandarinRow[] {
  const hanziRows: MandarinRow[] = cards.map((c) => {
    const diff = cardDueDiff(c);
    const card = toDueCard("hanzi", c, diff, isNeverStudied(c.reps));
    return { ...card, status: statusOf(c) };
  });

  const seenHsk3 = new Set<string>();
  const hsk3Rows: MandarinRow[] = [];
  for (const { key, label } of LEVELS) {
    for (const w of hsk3Coverage.levels[key] ?? []) {
      if (!w.known || seenHsk3.has(w.word)) continue;
      seenHsk3.add(w.word);
      const diff = w.mod && w.interval ? cardDueDiff({ mod: w.mod, interval: w.interval } as HanziCard) : null;
      const card = toDueCard("hsk3", w, diff, isNeverStudied(w.reps));
      hsk3Rows.push({ ...card, status: statusOf(w), levelLabel: label, level: key });
    }
  }

  const wpRows: MandarinRow[] = wordsPhrases.map((p) => {
    const diff = p.mod && p.interval ? cardDueDiff({ mod: p.mod, interval: p.interval } as HanziCard) : null;
    const card = toDueCard(p.source, p, diff, isNeverStudied(p.reps));
    return { ...card, status: statusOf(p) };
  });

  return [...hanziRows, ...hsk3Rows, ...wpRows];
}
