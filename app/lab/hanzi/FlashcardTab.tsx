"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { type HanziCard } from "./CharacterGrid";
import { cardDueDiff } from "./card-utils";
import { type Hsk3Coverage, type Hsk3Word } from "./Hsk3Grid";
import HanziWritingBox from "./HanziWritingBox";
import HanziCharacterPreview from "./HanziCharacterPreview";
import { TrackpadModeProvider, useTrackpadModeContext } from "./TrackpadModeContext";
import { GridPrefProvider, useGridPref } from "./GridPrefContext";

export interface WordPhrase {
  note_id: number;
  source: "random_words" | "idioms";
  word: string;
  pinyin: string | null;
  meaning: string | null;
  example?: string | null;
  example_pinyin?: string | null;
  example_meaning?: string | null;
  picture_url?: string | null;
  interval?: number;
  reps?: number;
  lapses?: number;
  factor?: number;
  queue?: number;
  due?: number;
  type?: number;
  learning_step?: number | null;
  mod?: number | null;
}

export type DeckKey = "hanzi" | "hsk3" | "random_words" | "idioms";
export type AnyCard = HanziCard | Hsk3Word | WordPhrase;

export const DECK_LABELS: Record<DeckKey, string> = {
  hanzi: "汉字 writing",
  hsk3: "HSK 3.0",
  random_words: "Random words",
  idioms: "中文的谚语/成语",
};

const DEFAULT_MAX_REVIEWS = 9999;
const DEFAULT_NEW_CARDS = 5;
const NEW_TODAY_CACHE_KEY = "hanziNewTodayCache";

function maxReviewsKey(deck: DeckKey) {
  return `flashcard_max_reviews_${deck}`;
}

function newCardsKey(deck: DeckKey) {
  return `flashcard_new_cards_${deck}`;
}

function loadMaxReviews(deck: DeckKey): number {
  if (typeof window === "undefined") return DEFAULT_MAX_REVIEWS;
  const stored = localStorage.getItem(maxReviewsKey(deck));
  const n = stored ? parseInt(stored, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_REVIEWS;
}

export function loadNewCards(deck: DeckKey): number {
  if (typeof window === "undefined") return DEFAULT_NEW_CARDS;
  const stored = localStorage.getItem(newCardsKey(deck));
  const n = stored ? parseInt(stored, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_NEW_CARDS;
}

export interface DueCard {
  id: string;
  dbId: number | string; // note_id (hanzi) or word (hsk3) — the actual DB key
  source: DeckKey;
  front: string;
  sub: string; // pinyin/pronunciation
  back: string; // meaning/definition
  dueDiff: number | null; // null for cards that have never been studied
  isNew: boolean;
  interval: number;
  factor: number;
  reps: number;
  lapses: number;
  type: number; // 0=new, 1=learning, 2=review, 3=relearning — Anki's own convention
  learningStep: number | null; // index into LEARNING_STEPS_MIN/RELEARNING_STEPS_MIN
  due: number | null; // epoch seconds; only meaningful while type is 1 or 3
  components?: string; // hanzi only — radical breakdown
  examples?: string; // hanzi only — usage examples per pronunciation
  sentence?: string; // hsk3 only — example sentence
  sentencePinyin?: string;
  sentenceMeaning?: string;
  audioUrl?: string | null; // word/character pronunciation
  sentenceAudioUrl?: string | null; // hsk3 only
  pictureUrl?: string | null; // hanzi + wp only
  rank?: number; // hanzi only — frequency rank (lower = more common)
}

type Grade = "again" | "hard" | "good" | "easy";

const MIN_FACTOR = 1300;
const DEFAULT_FACTOR = 2500;

// Anki's actual default scheduling ("Basic" preset): new cards step through
// 1m then 10m before graduating; a lapsed review card relearns via a single
// 10m step; graduating lands you at 1 day, Easy skips straight to 4 days,
// and a lapse's minimum post-relearn interval is 1 day (0% of the old one).
const LEARNING_STEPS_MIN = [1, 10];
const RELEARNING_STEPS_MIN = [10];
const GRADUATE_INTERVAL_DAYS = 1;
const EASY_INTERVAL_DAYS = 4;
const LAPSE_MIN_INTERVAL_DAYS = 1;

interface ScheduleResult {
  interval: number; // days — only meaningful when dueInMin is null (graduated)
  factor: number;
  type: number;
  learningStep: number | null;
  dueInMin: number | null; // minutes from now; null means graduated to day-based scheduling
}

// Mirrors Anki's real per-card state machine rather than a flat SM-2 formula:
// new/learning cards step through LEARNING_STEPS_MIN (Again restarts at
// step 0, Hard shows the average of the current+next step, Good advances a
// step or graduates on the last one, Easy always skips straight to the easy
// interval); a review card that lapses (Again) drops into relearning via
// RELEARNING_STEPS_MIN before returning to day-based review scheduling.
function scheduleCard(
  card: { interval: number; factor: number; reps: number; type: number; learningStep: number | null },
  grade: Grade
): ScheduleResult {
  const { interval, factor, learningStep } = card;
  const isNewCard = (card.reps ?? 0) === 0;
  const isLearningPhase = !isNewCard && card.type === 1;
  const isRelearningPhase = !isNewCard && card.type === 3;

  if (isNewCard || isLearningPhase) {
    const steps = LEARNING_STEPS_MIN;
    const stepIndex = isLearningPhase ? learningStep ?? 0 : 0;
    switch (grade) {
      case "again":
        return { interval: 0, factor, type: 1, learningStep: 0, dueInMin: steps[0] };
      case "hard": {
        const nextIdx = Math.min(stepIndex + 1, steps.length - 1);
        const avgMin = (steps[stepIndex] + steps[nextIdx]) / 2;
        return { interval: 0, factor: Math.max(MIN_FACTOR, factor - 150), type: 1, learningStep: stepIndex, dueInMin: avgMin };
      }
      case "good": {
        const nextIdx = stepIndex + 1;
        if (nextIdx >= steps.length) {
          return { interval: GRADUATE_INTERVAL_DAYS, factor, type: 2, learningStep: null, dueInMin: null };
        }
        return { interval: 0, factor, type: 1, learningStep: nextIdx, dueInMin: steps[nextIdx] };
      }
      case "easy":
        return { interval: EASY_INTERVAL_DAYS, factor: factor + 150, type: 2, learningStep: null, dueInMin: null };
    }
  }

  if (isRelearningPhase) {
    const steps = RELEARNING_STEPS_MIN;
    const stepIndex = learningStep ?? 0;
    switch (grade) {
      case "again":
        return { interval: 0, factor: Math.max(MIN_FACTOR, factor - 200), type: 3, learningStep: 0, dueInMin: steps[0] };
      case "hard":
        return { interval: 0, factor: Math.max(MIN_FACTOR, factor - 150), type: 3, learningStep: stepIndex, dueInMin: steps[stepIndex] * 1.5 };
      case "good": {
        const nextIdx = stepIndex + 1;
        if (nextIdx >= steps.length) {
          return { interval: LAPSE_MIN_INTERVAL_DAYS, factor, type: 2, learningStep: null, dueInMin: null };
        }
        return { interval: 0, factor, type: 3, learningStep: nextIdx, dueInMin: steps[nextIdx] };
      }
      case "easy":
        return {
          interval: Math.max(LAPSE_MIN_INTERVAL_DAYS, Math.round(LAPSE_MIN_INTERVAL_DAYS * (factor / 1000) * 1.3)),
          factor: factor + 150,
          type: 2,
          learningStep: null,
          dueInMin: null,
        };
    }
  }

  // Review stage (graduated, type 2). Hard/Good/Easy's multipliers (1.2x,
  // factor/1000x, factor/1000*1.3x) are already ranked hard < good < easy
  // before rounding, but rounding each independently can still collide two
  // of them onto the same day count once `factor` has drifted down near its
  // floor (e.g. interval=4 -> hard 4.8->5, good 5.2->5). Round all three
  // together and force each to be strictly more than the last, so the
  // buttons never show — or schedule — the same interval.
  if (grade === "again") {
    return { interval, factor: Math.max(MIN_FACTOR, factor - 200), type: 3, learningStep: 0, dueInMin: RELEARNING_STEPS_MIN[0] };
  }
  const hardDays = Math.max(1, Math.round(interval * 1.2));
  const goodDays = Math.max(hardDays + 1, Math.round(interval * (factor / 1000)));
  const easyDays = Math.max(goodDays + 1, Math.round(interval * (factor / 1000) * 1.3));
  switch (grade) {
    case "hard":
      return { interval: hardDays, factor: Math.max(MIN_FACTOR, factor - 150), type: 2, learningStep: null, dueInMin: null };
    case "good":
      return { interval: goodDays, factor, type: 2, learningStep: null, dueInMin: null };
    case "easy":
      return { interval: easyDays, factor: factor + 150, type: 2, learningStep: null, dueInMin: null };
  }
}

export function formatInterval(days: number): string {
  if (days <= 0) return "<10m";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${(days / 30).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

function previewLabel(card: { interval: number; factor: number; reps: number; type: number; learningStep: number | null }, grade: Grade): string {
  const result = scheduleCard(card, grade);
  return result.dueInMin != null ? formatMinutes(result.dueInMin) : formatInterval(result.interval);
}

export async function gradeCard(source: DeckKey, dbId: number | string, updates: Record<string, unknown>) {
  const res = await fetch("/api/grade-card", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, id: dbId, updates }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error ?? "Failed to save grade");
  }
}

const GRADE_TO_EASE: Record<Grade, number> = { again: 1, hard: 2, good: 3, easy: 4 };
const MAX_LOGGED_TIME_MS = 60000; // matches Anki's own revlog cap

// Logs a single review to review_log — this is what makes reviews graded
// directly on the site (not just ones synced in from Anki) show up in the
// Statistics tab's calendar/hourly/answer-button charts. Fire-and-forget:
// a failure here shouldn't block grading, since the scheduling update
// (gradeCard above) is the part that actually matters for what card you
// see next.
function logReview(
  card: { source: DeckKey; dbId: number | string; interval: number; reps: number; type: number },
  grade: Grade,
  result: { interval: number; factor: number },
  shownAt: number
): number {
  const isNewCard = (card.reps ?? 0) === 0;
  const isLearningPhase = !isNewCard && card.type === 1;
  const isRelearningPhase = !isNewCard && card.type === 3;
  const reviewType = isNewCard || isLearningPhase ? 0 : isRelearningPhase ? 2 : 1;
  const now = Date.now();

  fetch("/api/review-log-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: [
        {
          source: card.source,
          db_id: String(card.dbId),
          review_id: now,
          ease: GRADE_TO_EASE[grade],
          interval: result.interval,
          last_interval: card.interval,
          factor: result.factor,
          time_taken_ms: Math.min(MAX_LOGGED_TIME_MS, now - shownAt),
          review_type: reviewType,
          reviewed_at: new Date(now).toISOString(),
        },
      ],
    }),
  }).catch(() => {});

  return now; // the review_id, so an undo can delete this exact row
}

// Undo needs to remove the review_log row logReview just wrote, not just
// revert the card's scheduling — otherwise a card you un-grade still shows
// up in the Statistics charts as if you'd actually reviewed it.
function deleteReviewLog(source: DeckKey, dbId: number | string, reviewId: number) {
  fetch("/api/review-log-sync", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, db_id: String(dbId), review_id: reviewId }),
  }).catch(() => {});
}

interface DeckCounts {
  key: DeckKey;
  label: string;
  // null until `mounted` — these depend on a per-device localStorage cap
  // that isn't known during SSR/the hydration render, and guessing with a
  // hard-coded default was itself the bug: it visibly flashed whenever a
  // user's real setting differed from that default. No number at all for
  // one frame reads as "still loading," not as a wrong answer.
  newCount: number | null;
  learnCount: number;
  dueCount: number | null;
}

function dueDiffFrom(card: { mod?: number | null; interval?: number }): number | null {
  return cardDueDiff(card as HanziCard);
}

// "Due today or overdue" for the actual review queue — review-stage (type 2)
// cards only; learning/relearning cards use isLearningCardDue instead.
function isDueForReview(reps: number | undefined, dueDiff: number | null) {
  return (reps ?? 0) > 0 && dueDiff !== null && dueDiff <= 0;
}

// In Anki's own state model: type 1 = learning, type 3 = relearning.
export function isLearning(type: number | undefined) {
  return type === 1 || type === 3;
}

// Learning/relearning cards use a real epoch-seconds `due` timestamp
// (matching Anki's own convention for these queues), not a day count.
function isLearningCardDue(due: number | null | undefined) {
  return due != null && due <= Math.floor(Date.now() / 1000);
}

export function isNeverStudied(reps: number | undefined) {
  return (reps ?? 0) === 0;
}

export function toDueCard(key: DeckKey, card: AnyCard, dueDiff: number | null, isNew: boolean): DueCard {
  const stats = {
    interval: card.interval ?? 0,
    factor: card.factor ?? DEFAULT_FACTOR,
    reps: card.reps ?? 0,
    lapses: card.lapses ?? 0,
    type: card.type ?? 0,
    learningStep: card.learning_step ?? null,
    due: card.due ?? null,
  };
  if (key === "hanzi") {
    const c = card as HanziCard;
    return {
      id: `hanzi-${c.note_id}`, dbId: c.note_id, source: "hanzi", front: c.character, sub: c.pronunciation, back: c.front, dueDiff, isNew, ...stats,
      components: c.components, examples: c.examples, audioUrl: c.audio_url, pictureUrl: c.picture_url, rank: c.rank,
    };
  }
  if (key === "hsk3") {
    const w = card as Hsk3Word;
    return {
      id: `hsk3-${w.word}`, dbId: w.word, source: "hsk3", front: w.word, sub: w.pinyin ?? "", back: w.meaning ?? "", dueDiff, isNew, ...stats,
      sentence: w.sentence, sentencePinyin: w.sentence_pinyin, sentenceMeaning: w.sentence_meaning,
      audioUrl: w.audio_url, sentenceAudioUrl: w.sentence_audio_url,
    };
  }
  const p = card as WordPhrase;
  return {
    id: `wp-${p.note_id}`, dbId: p.note_id, source: p.source, front: p.word, sub: p.pinyin ?? "", back: p.meaning ?? "", dueDiff, isNew, ...stats,
    sentence: p.example ?? undefined, sentencePinyin: p.example_pinyin ?? undefined, sentenceMeaning: p.example_meaning ?? undefined,
    pictureUrl: p.picture_url,
  };
}

// Hanzi cards' `back` field (the DB's `front` column) is formatted as
// "romanization (meaning)" — e.g. "gui (to return; to belong to)", per
// docs/reference.md's card layout. Swaps the toneless romanization out for
// proper pinyin+number (already available separately as `sub`), keeping the
// "(meaning)" parenthetical as-is — including multi-pronunciation cards
// where both `sub` and `back` list readings "/"-separated in the same order.
function pinyinFrontHeadline(sub: string, back: string): string {
  const parenIdx = back.indexOf("(");
  if (parenIdx === -1) return sub || back;
  return `${sub} ${back.slice(parenIdx)}`;
}

// Anki doesn't shuffle new and due cards into one random pool — it gathers
// each separately (in a stable order) and interleaves new cards into the
// due list at a fixed, ratio-based spacing, so they show up at regular
// intervals instead of clustering or vanishing to the very end. Mirrors
// that instead of randomizing: same deck state always produces the same
// session order, and a `step`-cards-apart new card is never a surprise.
function interleave<T>(due: T[], newOnes: T[]): T[] {
  if (newOnes.length === 0) return due;
  if (due.length === 0) return newOnes;
  const step = due.length / newOnes.length;
  const out: T[] = [];
  let newIdx = 0;
  let nextInsertAt = step;
  for (let i = 0; i < due.length; i++) {
    out.push(due[i]);
    if (newIdx < newOnes.length && i + 1 >= nextInsertAt) {
      out.push(newOnes[newIdx++]);
      nextInsertAt += step;
    }
  }
  while (newIdx < newOnes.length) out.push(newOnes[newIdx++]);
  return out;
}

// Due/overdue and new cards each keep their existing stable order (due:
// whatever order they were fetched in, effectively rank/frequency for
// hanzi; new: same) — capped at `maxReviews`/`newCardsLimit`, then
// interleaved. No randomization, so re-entering the same deck without
// grading anything gives the same session back.
function buildQueue(
  items: { key: DeckKey; card: AnyCard }[],
  maxReviews: number,
  newCardsLimit: number
): { queue: DueCard[]; pending: { card: DueCard; dueAt: number }[] } {
  const due: DueCard[] = [];
  const newOnes: DueCard[] = [];
  const pending: { card: DueCard; dueAt: number }[] = [];
  for (const { key, card } of items) {
    if (!isNeverStudied(card.reps) && isLearning(card.type)) {
      // Learning/relearning card: only surfaces in the queue right now if
      // its step has actually elapsed. One still cooling down isn't
      // skipped, though — it's the *total* count of these that matters
      // (the step delay is just an ordering mechanism, not a filter), so it
      // goes into `pending` instead, where the same timer effect that
      // resurfaces an in-session "Again" also picks it up once due.
      if (isLearningCardDue(card.due)) {
        due.push(toDueCard(key, card, 0, false));
      } else {
        pending.push({ card: toDueCard(key, card, 0, false), dueAt: (card.due ?? 0) * 1000 });
      }
      continue;
    }
    const diff = dueDiffFrom(card);
    if (isDueForReview(card.reps, diff)) {
      due.push(toDueCard(key, card, diff, false));
    } else if (isNeverStudied(card.reps)) {
      newOnes.push(toDueCard(key, card, null, true));
    }
  }
  return {
    // Interleaved, not due-then-new — with a large due backlog, appending
    // new cards after all of it meant they'd only ever come up once every
    // due card in the session had already been cleared, which in practice
    // was "never" for a big deck.
    queue: interleave(due.slice(0, maxReviews), newOnes.slice(0, newCardsLimit)),
    pending,
  };
}

// Counts shown in the deck menu — computed from our own data, not Anki.
// New/Due are capped by the same session settings the review queue itself
// uses, so the numbers shown are exactly what pressing into the deck yields.
function countDeck(key: DeckKey, items: AnyCard[], mounted: boolean, newIntroducedToday: number): DeckCounts {
  let newCount = 0, learnCount = 0, dueCount = 0;
  for (const item of items) {
    const diff = dueDiffFrom(item);
    if (isNeverStudied(item.reps)) newCount++;
    else if (isLearning(item.type)) learnCount++;
    else if (isDueForReview(item.reps, diff)) dueCount++;
  }
  // Session-limit caps come from localStorage, which isn't available during
  // SSR/the initial client render. newCount/dueCount stay null until
  // mounted rather than guessing with a hard-coded default in the meantime
  // — guessing was itself the bug (see the DeckCounts comment above).
  // "New cards per session" is meant as a per-day allowance, not something
  // that resets every time the deck is re-entered — subtract however many
  // distinct new cards have already been introduced today (see the
  // newIntroducedToday computation below) so the number actually counts
  // down over the course of a day instead of always showing the raw cap.
  const cap = mounted ? Math.max(0, loadNewCards(key) - newIntroducedToday) : null;
  return {
    key,
    label: DECK_LABELS[key],
    newCount: cap == null ? null : Math.min(newCount, cap),
    learnCount,
    dueCount: mounted ? Math.min(dueCount, loadMaxReviews(key)) : null,
  };
}

// Anki's deck list "new" and "learn" counts respect each deck's configured
// daily limits (e.g. new cards/day) and today's scheduling state — not just
// "how many cards have never been studied". Rather than reimplement that,
// ask AnkiConnect directly so the numbers always match Anki's own screen.
function CountCell({ value, color }: { value: number | null; color: string }) {
  return (
    <span className={`block text-center tabular-nums text-base font-semibold ${value != null && value > 0 ? color : "text-zinc-300 dark:text-zinc-600"}`}>
      {value ?? ""}
    </span>
  );
}

function DeckSettingsPopover({
  deckKey,
  anchor,
  onClose,
  onSave,
}: {
  deckKey: DeckKey;
  anchor: { top: number; right: number };
  onClose: () => void;
  onSave: (maxReviews: number, newCards: number) => void;
}) {
  const [maxReviews, setMaxReviews] = useState(() => loadMaxReviews(deckKey));
  const [newCards, setNewCards] = useState(() => loadNewCards(deckKey));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        style={{ position: "fixed", top: anchor.top, right: anchor.right }}
        className="z-50 w-64 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-4 space-y-3"
      >
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Session limits</p>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-500">New cards per day</span>
          <input
            type="number"
            min={0}
            value={newCards}
            onChange={(e) => setNewCards(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-sm tabular-nums text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-500">Maximum reviews per session</span>
          <input
            type="number"
            min={1}
            value={maxReviews}
            onChange={(e) => setMaxReviews(parseInt(e.target.value, 10) || 1)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-sm tabular-nums text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </label>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Controls how many cards show up in a review session here. Doesn&apos;t affect Anki&apos;s own limits.
        </p>
        <button
          onClick={() => { onSave(maxReviews, newCards); onClose(); }}
          className="w-full rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 hover:opacity-90 transition-colors"
        >
          Save
        </button>
      </div>
    </>
  );
}

function DeckMenu({
  decks,
  onSelect,
}: {
  decks: DeckCounts[];
  onSelect: (key: DeckKey) => void;
}) {
  const [settingsOpenFor, setSettingsOpenFor] = useState<DeckKey | null>(null);
  const [anchor, setAnchor] = useState({ top: 0, right: 0 });
  const [expanded, setExpanded] = useState(true);
  const [, forceRerender] = useState(0);

  // Every deck's newCount/dueCount go null (or not) together — they're all
  // gated by the same `mounted` flag in countDeck — so any one deck being
  // null means the aggregate row should stay blank too, not add up to a
  // premature 0.
  const countsReady = decks.every((d) => d.newCount != null && d.dueCount != null);
  const totals = {
    newCount: countsReady ? decks.reduce((s, d) => s + (d.newCount ?? 0), 0) : null,
    learnCount: decks.reduce((s, d) => s + d.learnCount, 0),
    dueCount: countsReady ? decks.reduce((s, d) => s + (d.dueCount ?? 0), 0) : null,
  };

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none overflow-hidden">
      <div className="grid grid-cols-[1fr_36px_36px_36px_28px] sm:grid-cols-[minmax(240px,auto)_68px_68px_68px_32px] items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3.5 bg-zinc-50 dark:bg-zinc-950/40 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Deck</span>
        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 text-center">New</span>
        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 text-center">Learn</span>
        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 text-center">Due</span>
        <span />
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full grid grid-cols-[1fr_36px_36px_36px_28px] sm:grid-cols-[minmax(240px,auto)_68px_68px_68px_32px] items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3.5 text-xs font-semibold text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 010-1.06L11.94 8l-4.73-4.71a.75.75 0 111.06-1.06l5.25 5.25a.75.75 0 010 1.06l-5.25 5.25a.75.75 0 01-1.06 0z" clipRule="evenodd" />
          </svg>
          Mandarin
        </span>
        <CountCell value={totals.newCount} color="text-blue-500 dark:text-blue-400" />
        <CountCell value={totals.learnCount} color="text-red-500 dark:text-red-400" />
        <CountCell value={totals.dueCount} color="text-emerald-600 dark:text-emerald-500" />
        <span />
      </button>
      {expanded && decks.map((d) => {
        // Not yet known (pre-mount) shouldn't read as "definitely empty" —
        // only disable once newCount/dueCount have actually loaded.
        const notYetKnown = d.newCount == null || d.dueCount == null;
        const total = (d.newCount ?? 0) + d.learnCount + (d.dueCount ?? 0);
        return (
          <div key={d.key} className="relative border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 group">
            <div className="w-full grid grid-cols-[1fr_36px_36px_36px_28px] sm:grid-cols-[minmax(240px,auto)_68px_68px_68px_32px] items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
              <button
                onClick={() => onSelect(d.key)}
                disabled={!notYetKnown && total === 0}
                className="pl-[18px] text-left text-sm text-zinc-800 dark:text-zinc-100 disabled:cursor-default disabled:opacity-60 hover:underline"
              >
                {d.label}
              </button>
              <CountCell value={d.newCount} color="text-blue-500 dark:text-blue-400" />
              <CountCell value={d.learnCount} color="text-red-500 dark:text-red-400" />
              <CountCell value={d.dueCount} color="text-emerald-600 dark:text-emerald-500" />
              <button
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setAnchor({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
                  setSettingsOpenFor((k) => (k === d.key ? null : d.key));
                }}
                className={`justify-self-end rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-opacity ${
                  settingsOpenFor === d.key ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                }`}
                aria-label={`${d.label} settings`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            {settingsOpenFor === d.key && (
              <DeckSettingsPopover
                deckKey={d.key}
                anchor={anchor}
                onClose={() => setSettingsOpenFor(null)}
                onSave={(maxReviews, newCards) => {
                  localStorage.setItem(maxReviewsKey(d.key), String(maxReviews));
                  localStorage.setItem(newCardsKey(d.key), String(newCards));
                  forceRerender((n) => n + 1);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const GRADES: { key: Grade; label: string }[] = [
  { key: "again", label: "Again" },
  { key: "hard", label: "Hard" },
  { key: "good", label: "Good" },
  { key: "easy", label: "Easy" },
];

function HotkeyRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span>{description}</span>
      <span className="flex items-center gap-1 shrink-0">
        {keys.map((key) => (
          <kbd
            key={key}
            className="rounded border border-zinc-300 dark:border-zinc-600 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:text-zinc-300"
          >
            {key}
          </kbd>
        ))}
      </span>
    </div>
  );
}

function TrackpadToggleButton() {
  const { trackpadMode, toggle } = useTrackpadModeContext();
  return (
    <button
      onClick={toggle}
      aria-pressed={trackpadMode}
      title="Toggle trackpad mode (T)"
      className={`inline-flex items-center h-4 leading-none text-[11px] uppercase tracking-wide transition-colors ${
        trackpadMode
          ? "text-blue-500 dark:text-blue-400 [text-shadow:0_0_10px_rgba(59,130,246,0.85)]"
          : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
      }`}
    >
      Trackpad
    </button>
  );
}

function GridToggleButton() {
  const { showGrid, toggle } = useGridPref();
  return (
    <button
      onClick={toggle}
      aria-pressed={showGrid}
      title="Toggle writing-box grid"
      className={`inline-flex items-center h-4 leading-none text-sm transition-colors ${
        showGrid
          ? "text-blue-500 dark:text-blue-400 [text-shadow:0_0_10px_rgba(59,130,246,0.85)]"
          : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
      }`}
    >
      田
    </button>
  );
}

function HotkeysPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center h-4 leading-none gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wide hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        Hotkeys
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-3 w-56 space-y-2.5 z-20 text-left animate-dropdown-in">
          <HotkeyRow keys={["Space"]} description="Show answer / Good" />
          <HotkeyRow keys={["1"]} description="Again" />
          <HotkeyRow keys={["2"]} description="Hard" />
          <HotkeyRow keys={["3"]} description="Good" />
          <HotkeyRow keys={["4"]} description="Easy" />
          <HotkeyRow keys={["U"]} description="Undo" />
          <HotkeyRow keys={["E"]} description="Edit card" />
          <HotkeyRow keys={["R"]} description="Redraw character" />
          <HotkeyRow keys={["T"]} description="Toggle trackpad mode" />
          <HotkeyRow keys={["B"]} description="Open in Browse" />
        </div>
      )}
    </div>
  );
}

// A single shared <audio> element for all playback (manual button clicks and
// the reveal autoplay chain) — starting any new clip always takes over this
// same element, so a fresh play always cuts off whatever was already
// playing instead of overlapping it.
let sharedAudio: HTMLAudioElement | null = null;

const AUDIO_MUTED_KEY = "hanziAudioMuted";
const AUDIO_VOLUME_KEY = "hanziAudioVolume";

function readAudioVolume(): number {
  const raw = parseFloat(localStorage.getItem(AUDIO_VOLUME_KEY) ?? "1");
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
}

function playAudio(src: string, onEnded?: () => void) {
  if (!sharedAudio) sharedAudio = new Audio();
  // Read the mute/volume preferences fresh on every play rather than
  // trusting whatever the element already has — keeps this correct
  // regardless of mount order relative to the audio control's own effect.
  sharedAudio.muted = localStorage.getItem(AUDIO_MUTED_KEY) === "1";
  sharedAudio.volume = readAudioVolume();
  sharedAudio.pause();
  sharedAudio.onended = onEnded ?? null;
  sharedAudio.src = src;
  sharedAudio.currentTime = 0;
  sharedAudio.play().catch(() => {});
}

function AudioControl() {
  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(1);

  useEffect(() => {
    setMutedState(localStorage.getItem(AUDIO_MUTED_KEY) === "1");
    setVolumeState(readAudioVolume());
  }, []);

  function setMuted(next: boolean) {
    setMutedState(next);
    localStorage.setItem(AUDIO_MUTED_KEY, next ? "1" : "0");
    if (sharedAudio) sharedAudio.muted = next;
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = Number(e.target.value) / 100;
    setVolumeState(next);
    localStorage.setItem(AUDIO_VOLUME_KEY, String(next));
    if (sharedAudio) sharedAudio.volume = next;
    // Dragging the slider up implies wanting sound back.
    if (next > 0 && muted) setMuted(false);
  }

  const silent = muted || volume === 0;

  return (
    <div className="flex items-center h-4 gap-2">
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={handleVolumeChange}
        aria-label="Audio volume"
        className="hidden sm:block w-16 h-4 accent-zinc-500 dark:accent-zinc-400"
      />
      <button
        onClick={() => setMuted(!muted)}
        aria-pressed={muted}
        aria-label={muted ? "Unmute audio" : "Mute audio"}
        title={muted ? "Unmute audio" : "Mute audio"}
        className={`flex items-center h-4 transition-colors ${
          silent
            ? "text-zinc-500 dark:text-zinc-400"
            : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
        }`}
      >
        {silent ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z" />
            <path d="M12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z" />
            <path d="M14.657 5.343a1 1 0 011.414 0A7.975 7.975 0 0118 10a7.975 7.975 0 01-1.929 5.657 1 1 0 11-1.414-1.414A5.975 5.975 0 0016 10a5.975 5.975 0 00-1.343-3.243 1 1 0 010-1.414z" />
            <path d="M12.828 8.172a1 1 0 011.415 0A2.99 2.99 0 0115 10a2.99 2.99 0 01-.757 1.828 1 1 0 11-1.415-1.414A.99.99 0 0013 10a.99.99 0 00-.172-.586 1 1 0 010-1.242z" />
          </svg>
        )}
      </button>
    </div>
  );
}

function playAudioSequence(urls: string[]) {
  let i = 0;
  function next() {
    if (i >= urls.length) return;
    playAudio(urls[i++], next);
  }
  next();
}

export function AudioButton({ src, label }: { src?: string | null; label: string }) {
  if (!src) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        playAudio(src);
      }}
      aria-label={label}
      className="inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full border border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 ml-0.5">
        <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
      </svg>
    </button>
  );
}

export function EditPanel({
  card,
  onClose,
  onSave,
  onPictureUpdated,
}: {
  card: DueCard;
  onClose: () => void;
  onSave: (front: string, sub: string, back: string, components: string, examples: string) => void;
  onPictureUpdated: (url: string | null) => void;
}) {
  const [front, setFront] = useState(card.front);
  const [sub, setSub] = useState(card.sub);
  const [back, setBack] = useState(card.back);
  const [components, setComponents] = useState(card.components ?? "");
  const [examples, setExamples] = useState(card.examples ?? "");
  const [pictureUrl, setPictureUrl] = useState(card.pictureUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  async function uploadPicture(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const filename = file.name || `pasted.${(file.type.split("/")[1] || "png")}`;
      const res = await fetch("/api/upload-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: card.source, id: card.dbId, filename, contentType: file.type, contentBase64 }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Upload failed");
      }
      const { url } = await res.json();
      setPictureUrl(url);
      onPictureUpdated(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function removePicture() {
    setUploading(true);
    setUploadError(null);
    try {
      await gradeCard(card.source, card.dbId, { picture_url: null });
      setPictureUrl(null);
      onPictureUpdated(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to remove picture");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Lets you paste a screenshot straight in with Cmd+V, matching Anki's own
  // image-paste behavior, instead of requiring a file picker every time.
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      const file = item.getAsFile();
      if (file) uploadPicture(file);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.source, card.dbId]);

  return (
    <div className="fixed inset-0 z-40 bg-black/20 flex items-center justify-center px-4" onClick={onClose}>
      <div
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-5 space-y-3"
      >
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Edit card</p>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-500">Front</span>
          <input
            value={front}
            onChange={(e) => setFront(e.target.value)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-500">Pinyin</span>
          <input
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-500">Meaning</span>
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </label>
        {card.source === "hanzi" && (
          <>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Components</span>
              <input
                value={components}
                onChange={(e) => setComponents(e.target.value)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Examples</span>
              <textarea
                value={examples}
                onChange={(e) => setExamples(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
            </label>
          </>
        )}
        {card.source !== "hsk3" && (
          <div className="space-y-1">
            <span className="text-xs text-zinc-500">Picture</span>
            {pictureUrl ? (
              <div className="flex items-start gap-2">
                <img src={pictureUrl} alt="" className="max-w-[160px] rounded-md border border-zinc-200 dark:border-zinc-700" />
                <button
                  onClick={removePicture}
                  disabled={uploading}
                  className="text-[11px] text-red-500 hover:text-red-600 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ) : (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">Paste an image (⌘V) to add a picture</p>
            )}
            {uploading && <p className="text-[11px] text-zinc-400">Uploading…</p>}
            {uploadError && <p className="text-[11px] text-red-500">{uploadError}</p>}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(front, sub, back, components, examples)}
            className="flex-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 hover:opacity-90 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Maps the unified front/sub/back shape back to each source's real columns.
export function buildEditUpdates(
  source: DeckKey,
  front: string,
  sub: string,
  back: string,
  components?: string,
  examples?: string
): Record<string, unknown> {
  if (source === "hanzi") return { character: front, pronunciation: sub, front: back, components, examples };
  return { word: front, pinyin: sub, meaning: back };
}

export type CardStatPatch = {
  interval?: number;
  factor?: number;
  reps?: number;
  lapses?: number;
  mod?: number;
  type?: number;
  queue?: number;
  learning_step?: number | null;
  due?: number | null;
};

function ReviewSession({
  initialQueue,
  initialPending,
  onExit,
  onJumpToCard,
  onCardUpdated,
}: {
  initialQueue: DueCard[];
  initialPending: { card: DueCard; dueAt: number }[];
  onExit: () => void;
  onJumpToCard?: (card: { source: DeckKey; dbId: number | string }) => void;
  onCardUpdated?: (source: DeckKey, dbId: number | string, patch: CardStatPatch) => void;
}) {
  const [queue, setQueue] = useState(initialQueue);
  // Learning/relearning cards that aren't due yet — resurfaced into `queue`
  // by the timer effect below once their step's delay elapses, mirroring
  // Anki interleaving learning cards back into the session automatically.
  // Seeded with every such card in the deck (not just ones this session
  // grades into cooldown) so the deck's full learning-card total always
  // eventually surfaces, matching the deck menu's count.
  const [pending, setPending] = useState<{ card: DueCard; dueAt: number }[]>(initialPending);
  const [revealed, setRevealed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const lastActions = useRef<{ original: DueCard; graded: DueCard; reviewId: number }[]>([]);
  const current = queue[0];
  // When the current card was first shown — used to log how long each
  // review took, capped the same way Anki caps its own revlog (60s) so a
  // card left open in a background tab doesn't skew the "s/card" stat.
  const shownAtRef = useRef(Date.now());
  useEffect(() => {
    shownAtRef.current = Date.now();
  }, [current?.id]);

  // Redraw (R, back side only): swaps the filled-in character preview for a
  // blank drawable box so the user can trace it again. `redoAttempt` forces
  // a fresh mount each press, even for the same character, so a completed
  // redraw doesn't just sit there stale the next time R is pressed.
  const [redoDrawing, setRedoDrawing] = useState(false);
  const [redoAttempt, setRedoAttempt] = useState(0);
  useEffect(() => {
    setRedoDrawing(false);
  }, [current?.id]);

  useEffect(() => {
    if (!revealed) return;
    // Word audio, then sentence audio — chained through the shared audio
    // element so it never overlaps a manual button press either.
    const urls = [current?.audioUrl, current?.sentenceAudioUrl].filter((u): u is string => !!u);
    if (urls.length > 0) playAudioSequence(urls);

    return () => {
      if (sharedAudio) {
        sharedAudio.pause();
        sharedAudio.onended = null;
      }
    };
    // Only fire when the card is actually turned, not on every re-render
    // while it stays revealed (e.g. after an undo restores the same card).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, current?.id]);

  // Successfully writing the character out reveals the back automatically —
  // delayed briefly so the writing box's own green "done" flash is visible
  // before the layout swaps out from under it.
  const writeCompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleWriteComplete() {
    if (writeCompleteTimer.current) clearTimeout(writeCompleteTimer.current);
    writeCompleteTimer.current = setTimeout(() => setRevealed(true), 600);
  }
  useEffect(() => {
    return () => {
      if (writeCompleteTimer.current) clearTimeout(writeCompleteTimer.current);
    };
  }, []);

  const grade = useRef<(g: Grade) => void>(() => {});
  grade.current = (g: Grade) => {
    const card = queue[0];
    if (!card) return;
    const result = scheduleCard(card, g);
    const reps = card.reps + 1;
    const lapses = g === "again" && card.type === 2 ? card.lapses + 1 : card.lapses;
    const mod = Math.floor(Date.now() / 1000);
    const due = result.dueInMin != null ? mod + Math.round(result.dueInMin * 60) : null;

    const patch = {
      interval: result.interval,
      factor: result.factor,
      reps,
      lapses,
      mod,
      type: result.type,
      queue: result.type,
      learning_step: result.learningStep,
      due,
    };
    gradeCard(card.source, card.dbId, patch).catch((e) => {
      setSaveError(e instanceof Error ? e.message : "Failed to save — check your connection.");
    });
    // Keeps the deck menu's New/Learn/Due counts honest live, as each card
    // is graded — they're computed from HanziDashboard's own card arrays,
    // which nothing else updates as this session progresses (grading only
    // wrote to Supabase; local state and the DB would otherwise drift apart
    // until a full reload).
    onCardUpdated?.(card.source, card.dbId, patch);
    const reviewId = logReview(card, g, result, shownAtRef.current);

    const rest = queue.slice(1);
    const updatedCard: DueCard = {
      ...card,
      interval: result.interval,
      factor: result.factor,
      reps,
      lapses,
      isNew: false,
      type: result.type,
      learningStep: result.learningStep,
      due,
      dueDiff: result.dueInMin != null ? null : result.interval <= 0 ? 0 : result.interval,
    };
    lastActions.current = [...lastActions.current, { original: card, graded: updatedCard, reviewId }];

    if (result.dueInMin != null) {
      // Still learning/relearning — holds off the visible queue until its
      // step's delay elapses, instead of instantly cycling back like a
      // graduated card would.
      setPending((p) => [...p, { card: updatedCard, dueAt: Date.now() + result.dueInMin! * 60000 }]);
      setQueue(rest);
    } else {
      setQueue(rest);
    }
    setRevealed(false);
  };

  const undo = useRef<() => void>(() => {});
  undo.current = () => {
    const stack = lastActions.current;
    const action = stack[stack.length - 1];
    if (!action) return;
    const patch = {
      interval: action.original.interval,
      factor: action.original.factor,
      reps: action.original.reps,
      lapses: action.original.lapses,
      type: action.original.type,
      queue: action.original.type,
      learning_step: action.original.learningStep,
      due: action.original.due,
    };
    gradeCard(action.original.source, action.original.dbId, patch).catch((e) => {
      setSaveError(e instanceof Error ? e.message : "Failed to undo — check your connection.");
    });
    onCardUpdated?.(action.original.source, action.original.dbId, patch);
    deleteReviewLog(action.original.source, action.original.dbId, action.reviewId);
    setQueue((q) => [action.original, ...q.filter((c) => c.id !== action.graded.id)]);
    setPending((p) => p.filter((x) => x.card.id !== action.graded.id));
    lastActions.current = stack.slice(0, -1);
    setRevealed(false);
  };

  // Polls for pending learning/relearning cards whose step delay has
  // elapsed and splices them back into the live queue near the front —
  // Anki interleaves them with other due cards rather than appending them
  // at the very end.
  useEffect(() => {
    if (pending.length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      const ready = pending.filter((p) => p.dueAt <= now);
      if (ready.length === 0) return;
      setPending((p) => p.filter((x) => x.dueAt > now));
      setQueue((q) => {
        const next = [...q];
        for (const { card } of ready) {
          const pos = Math.min(next.length, Math.floor(Math.random() * 3) + 1);
          next.splice(pos, 0, card);
        }
        return next;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [pending]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.repeat || editOpen) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key.toLowerCase() === "u") {
        // On the back of a not-yet-graded card, Undo just flips back to the
        // front of that same card. Only on the front does it fall through
        // to actually undoing the previous card's grade.
        if (revealed) { setRevealed(false); return; }
        undo.current();
        return;
      }
      if (e.key.toLowerCase() === "e") { setEditOpen(true); return; }
      if (e.key.toLowerCase() === "b") {
        if (current) onJumpToCard?.({ source: current.source, dbId: current.dbId });
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        else grade.current("good");
        return;
      }

      if (!revealed) return;
      if (e.key.toLowerCase() === "r" && current?.source === "hanzi") {
        setRedoDrawing(true);
        setRedoAttempt((n) => n + 1);
        return;
      }
      if (e.key === "1") grade.current("again");
      else if (e.key === "2") grade.current("hard");
      else if (e.key === "3") grade.current("good");
      else if (e.key === "4") grade.current("easy");
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [revealed, editOpen, current, onJumpToCard]);

  if (!current) {
    const nextIn = pending.length > 0 ? Math.max(0, Math.min(...pending.map((p) => p.dueAt)) - Date.now()) : null;
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 max-w-xl mx-auto">
        <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-500">
          {nextIn != null ? "Waiting on learning cards…" : "All done!"}
        </p>
        {nextIn != null && (
          <p className="text-sm text-zinc-500">Next card back in {formatMinutes(Math.max(1, nextIn / 60000))}</p>
        )}
        <button onClick={onExit} className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
          ← Decks
        </button>
      </div>
    );
  }

  const remainingNew = queue.filter((c) => c.isNew).length;
  const remainingLearningInQueue = queue.filter((c) => !c.isNew && isLearning(c.type)).length;
  // Total learning-card count, not just the ones currently past their
  // cooldown — the still-cooling-down ones in `pending` will surface later
  // in this same session regardless, so they still count toward the total.
  const remainingLearning = remainingLearningInQueue + pending.length;
  const remainingDue = queue.length - remainingNew - remainingLearningInQueue;

  return (
    <div className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-zinc-100 dark:bg-zinc-950 px-4 sm:px-8 pt-4 sm:pt-8">
      <div className="w-full shrink-0 flex items-center justify-between">
        <button
          onClick={onExit}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          ← Decks
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => { if (revealed) setRevealed(false); else undo.current(); }}
            aria-label="Undo"
            title="Undo (U)"
            className="md:hidden text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.128a5.5 5.5 0 010 11H10.5a.75.75 0 010-1.5h3.25a4 4 0 000-8H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z" clipRule="evenodd" />
            </svg>
          </button>
          <AudioControl />
          <div className="hidden md:flex items-center gap-4">
            <TrackpadToggleButton />
            <GridToggleButton />
          </div>
          <div className="hidden md:block">
            <HotkeysPanel />
          </div>
        </div>
      </div>

      <div className="w-full flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center text-center px-4 py-4">
          <div className="max-w-xl m-auto">
            {!revealed && current.isNew && (
              <p className="mb-2 text-xs font-semibold tracking-widest text-emerald-500 dark:text-emerald-400 [text-shadow:0_0_10px_rgba(16,185,129,0.85)]">
                NEW
              </p>
            )}
            <p className="text-2xl text-center">
              {current.source === "hanzi"
                ? revealed
                  ? pinyinFrontHeadline(current.sub, current.back)
                  : current.back
                : current.front}
            </p>

            {!revealed && current.sentence && current.source !== "hanzi" && (
              <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800 text-center">
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line">{current.sentence}</p>
              </div>
            )}

            {current.source === "hanzi" && (
              <div className="mt-6">
                {revealed ? (
                  redoDrawing ? (
                    <HanziWritingBox
                      key={redoAttempt}
                      character={current.front}
                      showHeader={false}
                      showReference={false}
                      traceOutline
                      onComplete={() => setRedoDrawing(false)}
                    />
                  ) : (
                    <HanziCharacterPreview character={current.front} />
                  )
                ) : (
                  <HanziWritingBox
                    character={current.front}
                    showHeader={false}
                    showReference={false}
                    traceOutline={current.isNew}
                    onComplete={handleWriteComplete}
                  />
                )}
              </div>
            )}

            {(revealed || current.isNew) && current.components && (
              <p className="mt-1.5 text-sm text-zinc-400 dark:text-zinc-500 text-center">{current.components}</p>
            )}

            {revealed && (
              <div className="mt-8 space-y-1.5 text-center animate-card-reveal-in">
                {current.source !== "hanzi" && (current.sub || current.back) && (
                  <p className="text-2xl flex items-center justify-center gap-2 flex-wrap">
                    {current.sub && <span className="text-emerald-700 dark:text-emerald-500">{current.sub}</span>}
                    {current.back && (
                      <span className="text-zinc-700 dark:text-zinc-300 whitespace-pre-line">{current.back}</span>
                    )}
                    <AudioButton src={current.audioUrl} label="Play pronunciation" />
                  </p>
                )}
                {current.examples && (
                  <p className="text-2xl text-zinc-700 dark:text-zinc-300 whitespace-pre-line">{current.examples}</p>
                )}
                {current.source === "hanzi" && current.audioUrl && (
                  <div className="flex justify-center">
                    <AudioButton src={current.audioUrl} label="Play pronunciation" />
                  </div>
                )}
                {current.sentence && (
                  <div className="pt-4 mt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-0.5">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center justify-center gap-2">
                      <span>{current.sentence}</span>
                      <AudioButton src={current.sentenceAudioUrl} label="Play sentence audio" />
                    </p>
                    {current.sentencePinyin && <p className="text-sm text-emerald-700 dark:text-emerald-500">{current.sentencePinyin}</p>}
                    {current.sentenceMeaning && <p className="text-sm text-zinc-600 dark:text-zinc-400">{current.sentenceMeaning}</p>}
                  </div>
                )}
                {current.pictureUrl && (
                  <div className="flex justify-center pt-4">
                    <img src={current.pictureUrl} alt="" className="max-w-[220px] rounded-lg border border-zinc-200 dark:border-zinc-800" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 bg-zinc-100 dark:bg-zinc-950 flex flex-col items-center gap-3 pt-4 pb-6 px-4">
          {saveError && <p className="text-xs text-red-500">{saveError}</p>}

          {!revealed ? (
            <>
              <p className="text-sm">
                <span className="text-blue-500 font-medium">{remainingNew}</span>
                {" + "}
                {remainingLearning > 0 && (
                  <>
                    <span className="text-red-500 dark:text-red-400 font-medium">{remainingLearning}</span>
                    {" + "}
                  </>
                )}
                <span className="text-emerald-600 dark:text-emerald-500 font-medium underline">{remainingDue}</span>
              </p>
              <button
                onClick={(e) => { e.currentTarget.blur(); setRevealed(true); }}
                className="rounded-full border border-zinc-300 dark:border-zinc-600 px-10 py-2 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                Show Answer
              </button>
            </>
          ) : (
            <div className="grid grid-cols-4 gap-2 w-full max-w-xl">
              {GRADES.map(({ key, label }) => {
                return (
                  <div key={key} className="flex flex-col items-center gap-1.5">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">{previewLabel(current, key)}</span>
                    <button
                      onClick={(e) => { e.currentTarget.blur(); grade.current(key); }}
                      className="w-full rounded-full border border-zinc-300 dark:border-zinc-600 py-2 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                      {label}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editOpen && (
        <EditPanel
          card={current}
          onClose={() => setEditOpen(false)}
          onSave={(front, sub, back, components, examples) => {
            gradeCard(current.source, current.dbId, buildEditUpdates(current.source, front, sub, back, components, examples)).catch((e) => {
              setSaveError(e instanceof Error ? e.message : "Failed to save edit.");
            });
            setQueue((q) =>
              q.map((c) =>
                c.id === current.id
                  ? { ...c, front, sub, back, ...(current.source === "hanzi" ? { components, examples } : {}) }
                  : c
              )
            );
            setEditOpen(false);
          }}
          onPictureUpdated={(url) => {
            setQueue((q) => q.map((c) => (c.id === current.id ? { ...c, pictureUrl: url } : c)));
          }}
        />
      )}
    </div>
  );
}

export default function FlashcardTab({
  cards,
  hsk3Coverage,
  wordsPhrases,
  onJumpToCard,
  onReviewingChange,
  onCardUpdated,
}: {
  cards: HanziCard[];
  hsk3Coverage: Hsk3Coverage;
  wordsPhrases: WordPhrase[];
  onJumpToCard?: (card: { source: DeckKey; dbId: number | string }) => void;
  onReviewingChange?: (active: boolean) => void;
  onCardUpdated?: (source: DeckKey, dbId: number | string, patch: CardStatPatch) => void;
}) {
  const [selectedDeck, setSelectedDeck] = useState<DeckKey | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    onReviewingChange?.(selectedDeck !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeck]);

  // Pulled from our own review_log table (the same store site-graded and
  // Anki-synced reviews both write to) rather than AnkiConnect — this is
  // meant to work whether or not Anki is even open.
  const [todayStats, setTodayStats] = useState<{ count: number; minutes: number; secPerCard: number } | null>(null);
  // How many distinct new cards have already been introduced today, per
  // deck — subtracted from "New cards per session" in countDeck/the queue
  // build so that cap acts as a per-day allowance instead of resetting
  // every time the deck is re-entered. review_type 0 covers a card's
  // original learn-phase (its true first review, plus any same-day "Again"
  // re-shows before it graduates) and never applies to a card relearning
  // after a lapse on some later day (that's review_type 2) — so deduping
  // today's review_type-0 rows by (source, db_id) gives an accurate count
  // without needing a dedicated "was this a new card" column.
  const [newToday, setNewToday] = useState<Record<DeckKey, number>>({ hanzi: 0, hsk3: 0, random_words: 0, idioms: 0 });
  // The fetch below needs a network round trip, so on every page load the
  // deck menu would briefly show 0 for "introduced today" (understating the
  // remaining New count) before flipping to the real value a moment later —
  // a visible flash on every visit. A same-day cached value is very likely
  // still correct (or will be corrected within a moment anyway), so read it
  // synchronously right after mount — before the network fetch even starts —
  // instead of waiting on the round trip just to show what was already known
  // a minute ago. Can't read it in the initial useState itself: that runs
  // during the SSR-matching hydration render too, and localStorage isn't
  // available server-side, so the hydration render must still start from
  // the same zeros the server rendered to avoid a mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NEW_TODAY_CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as { date: string; counts: Record<DeckKey, number> };
      if (cached.date === new Date().toDateString()) setNewToday(cached.counts);
    } catch {
      // Corrupt/old cache shape — just falls through to the real fetch below.
    }
  }, []);

  useEffect(() => {
    // Re-fetches every time the deck menu becomes visible again (including
    // right after finishing a review session, since selectedDeck going back
    // to null re-runs this) — otherwise the count you just earned wouldn't
    // show up until the whole tab remounted.
    if (selectedDeck !== null) return;
    // Scoped to today's local midnight onward — a revlog with months of
    // history has no reason to be paged through in full just to answer a
    // same-day question.
    const sinceMidnight = new Date();
    sinceMidnight.setHours(0, 0, 0, 0);
    fetch(`/api/review-log?since=${encodeURIComponent(sinceMidnight.toISOString())}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error || !Array.isArray(d.rows)) return;
        const todayKey = new Date().toDateString();
        const todays = (
          d.rows as { reviewed_at: string; time_taken_ms: number; source: DeckKey; db_id: string; review_type: number }[]
        ).filter((r) => new Date(r.reviewed_at).toDateString() === todayKey);
        const timeMs = todays.reduce((s, r) => s + r.time_taken_ms, 0);
        setTodayStats({
          count: todays.length,
          minutes: timeMs / 60000,
          secPerCard: todays.length > 0 ? timeMs / todays.length / 1000 : 0,
        });

        const seenByDeck: Record<DeckKey, Set<string>> = { hanzi: new Set(), hsk3: new Set(), random_words: new Set(), idioms: new Set() };
        for (const r of todays) {
          if (r.review_type === 0 && seenByDeck[r.source]) seenByDeck[r.source].add(r.db_id);
        }
        const counts = {
          hanzi: seenByDeck.hanzi.size,
          hsk3: seenByDeck.hsk3.size,
          random_words: seenByDeck.random_words.size,
          idioms: seenByDeck.idioms.size,
        };
        setNewToday(counts);
        localStorage.setItem(NEW_TODAY_CACHE_KEY, JSON.stringify({ date: todayKey, counts }));
      })
      .catch(() => {});
  }, [selectedDeck]);

  const hsk3Known = useMemo(
    () => Object.values(hsk3Coverage.levels).flat().filter((w) => w.known),
    [hsk3Coverage]
  );
  const randomWords = useMemo(() => wordsPhrases.filter((w) => w.source === "random_words"), [wordsPhrases]);
  const idioms = useMemo(() => wordsPhrases.filter((w) => w.source === "idioms"), [wordsPhrases]);

  const decks = useMemo(
    () => [
      countDeck("hanzi", cards, mounted, newToday.hanzi),
      countDeck("hsk3", hsk3Known, mounted, newToday.hsk3),
      countDeck("random_words", randomWords, mounted, newToday.random_words),
      countDeck("idioms", idioms, mounted, newToday.idioms),
    ],
    [cards, hsk3Known, randomWords, idioms, mounted, newToday]
  );

  const { queue, pending: initialPending } = useMemo(() => {
    if (!selectedDeck) return { queue: [], pending: [] };
    const items =
      selectedDeck === "hanzi"
        ? cards.map((card) => ({ key: "hanzi" as const, card }))
        : selectedDeck === "hsk3"
        ? hsk3Known.map((card) => ({ key: "hsk3" as const, card }))
        : selectedDeck === "random_words"
        ? randomWords.map((card) => ({ key: "random_words" as const, card }))
        : idioms.map((card) => ({ key: "idioms" as const, card }));
    const newCardsLimit = Math.max(0, loadNewCards(selectedDeck) - newToday[selectedDeck]);
    return buildQueue(items, loadMaxReviews(selectedDeck), newCardsLimit);
  }, [selectedDeck, cards, hsk3Known, randomWords, idioms, newToday]);

  if (!selectedDeck) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <DeckMenu decks={decks} onSelect={setSelectedDeck} />
        {todayStats && todayStats.count > 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Studied <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">{todayStats.count}</span> cards in{" "}
            <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">{todayStats.minutes.toFixed(1)}</span> minutes (
            <span className="tabular-nums">{todayStats.secPerCard.toFixed(1)}s/card</span>)
          </p>
        )}
      </div>
    );
  }

  if (queue.length === 0 && initialPending.length === 0) {
    return (
      <div className="space-y-4 max-w-xl">
        <button onClick={() => setSelectedDeck(null)} className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
          ← Decks
        </button>
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-10 text-center">
          <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-500">All caught up!</p>
          <p className="text-sm text-zinc-500 mt-1">Nothing due in this deck right now.</p>
        </div>
      </div>
    );
  }

  return (
    <TrackpadModeProvider key={selectedDeck}>
      <GridPrefProvider>
        <ReviewSession
          initialQueue={queue}
          initialPending={initialPending}
          onExit={() => setSelectedDeck(null)}
          onJumpToCard={onJumpToCard}
          onCardUpdated={onCardUpdated}
        />
      </GridPrefProvider>
    </TrackpadModeProvider>
  );
}
