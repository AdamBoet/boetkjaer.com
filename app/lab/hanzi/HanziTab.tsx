"use client";

import { useEffect, useRef, useState } from "react";
import CharacterGrid, { LegendSwatches, type HanziCard } from "./CharacterGrid";
import FormulaInfo from "./FormulaInfo";
import { MasteryCard, LEVELS, type Hsk3Coverage } from "./Hsk3Grid";
import { loadNewCards } from "./FlashcardTab";

const DEFAULT_YEARLY_GOAL = 1500;
const YEARLY_GOAL_KEY = "hanzi_yearly_goal";


function loadYearlyGoal(): number {
  if (typeof window === "undefined") return DEFAULT_YEARLY_GOAL;
  const n = parseInt(localStorage.getItem(YEARLY_GOAL_KEY) ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_YEARLY_GOAL;
}

// Rank-ordered, cumulative-% frequency of each character across a modern
// Chinese corpus (Jun Da's frequency list, ~9,933 characters, 193M-char
// corpus). Static reference data — never changes, so it's fetched once
// from a bundled public asset rather than synced from anywhere.
type FreqEntry = { c: string; p: number };

// Diminishing-returns curve: cumulative % of written Chinese covered by the
// top-N most frequent characters, on a LINEAR rank axis — a log axis puts
// "top 100 characters" at the visual midpoint of the chart (since there are
// ~9,933 total), which flattens exactly the region that matters most and
// makes the highest-value characters look unimpactful. Linear gives the
// familiar steep-then-flat curve that actually matches the numbers (42% at
// 100, 89% at 1,000, 99% at 3,000). A dot marks the rank-equivalent
// position of the user's own (non-contiguous) coverage percentage.
function SaturationCurve({ freq, valuePct }: { freq: FreqEntry[]; valuePct: number | null }) {
  const width = 400;
  const height = 130;
  const pad = { top: 6, right: 8, bottom: 18, left: 24 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = freq.length;
  // Cap the visible axis at 5k — virtually all curve movement happens well
  // before that, so showing the full ~9,933 range wastes half the chart on
  // a flat tail.
  const xMax = Math.min(5000, n);

  const xScale = (rank: number) => pad.left + (rank / xMax) * innerW;
  const yScale = (pct: number) => pad.top + innerH - (pct / 100) * innerH;

  // Sample ranks are bunched toward the low end (cubic easing) so the steep
  // early climb stays smooth, even though the x position itself is linear.
  const sampleCount = 150;
  const points: string[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    const rank = Math.max(1, Math.round(1 + (xMax - 1) * t ** 3));
    const entry = freq[rank - 1];
    if (entry) points.push(`${i === 0 ? "M" : "L"}${xScale(rank).toFixed(1)},${yScale(entry.p).toFixed(1)}`);
  }
  const pathD = points.join(" ");

  let dot: { x: number; y: number; rank: number } | null = null;
  if (valuePct != null) {
    const idx = freq.findIndex((f) => f.p >= valuePct);
    const rank = idx === -1 ? n : idx + 1;
    dot = { x: xScale(Math.min(rank, xMax)), y: yScale(valuePct), rank };
  }

  const yTicks = [0, 25, 50, 75, 100];
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((f * xMax) / 100) * 100);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
      {yTicks.map((t) => (
        <line
          key={t}
          x1={pad.left}
          x2={width - pad.right}
          y1={yScale(t)}
          y2={yScale(t)}
          className="stroke-zinc-100 dark:stroke-zinc-800"
          strokeWidth={1}
        />
      ))}
      <path d={pathD} fill="none" className="stroke-zinc-400 dark:stroke-zinc-500" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {dot && (
        <>
          <line x1={dot.x} x2={dot.x} y1={yScale(0)} y2={dot.y} className="stroke-emerald-600 dark:stroke-emerald-500" strokeWidth={1} strokeDasharray="2 3" />
          <line x1={pad.left} x2={dot.x} y1={dot.y} y2={dot.y} className="stroke-emerald-600 dark:stroke-emerald-500" strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={dot.x} cy={dot.y} r={4} className="fill-emerald-600 dark:fill-emerald-500" />
          <text x={pad.left - 4} y={dot.y + 3} textAnchor="end" className="fill-emerald-700 dark:fill-emerald-400 font-semibold" style={{ fontSize: 9 }}>
            {valuePct!.toFixed(1)}%
          </text>
          <text x={dot.x} y={height - 4} textAnchor="middle" className="fill-emerald-700 dark:fill-emerald-400 font-semibold" style={{ fontSize: 9 }}>
            {dot.rank.toLocaleString("da-DK")}
          </text>
        </>
      )}
      {yTicks.map((t) => (
        <text
          key={t}
          x={pad.left - 4}
          y={yScale(t) + 3}
          textAnchor="end"
          className="fill-zinc-400 dark:fill-zinc-500"
          style={{ fontSize: 9 }}
        >
          {t}%
        </text>
      ))}
      {xTicks.map((rank) => (
        <text
          key={rank}
          x={xScale(rank)}
          y={height - 4}
          textAnchor="middle"
          className="fill-zinc-400 dark:fill-zinc-500"
          style={{ fontSize: 9 }}
        >
          {rank >= 1000 ? `${Math.round(rank / 1000)}k` : rank}
        </text>
      ))}
    </svg>
  );
}

type Stats = {
  learnedCount: number;
  updatedAt: string;
  dayOfYear: number;
  daysInYear: number;
};

export default function HanziTab({
  cards,
  hsk3Coverage,
  stats,
  isDark,
}: {
  cards: HanziCard[];
  hsk3Coverage: Hsk3Coverage;
  stats: Stats;
  isDark: boolean;
}) {
  const [sub, setSub] = useState<"overview" | "characters">("overview");
  const [yearlyGoal, setYearlyGoal] = useState(DEFAULT_YEARLY_GOAL);
  const [cardsPerDay, setCardsPerDay] = useState(loadNewCards("hanzi"));
  useEffect(() => {
    setYearlyGoal(loadYearlyGoal());
    setCardsPerDay(loadNewCards("hanzi"));
  }, []);
  const [freq, setFreq] = useState<FreqEntry[] | null>(null);
  useEffect(() => {
    fetch("/char-frequency.json")
      .then((r) => r.json())
      .then(setFreq)
      .catch(() => setFreq(null));
  }, []);

  const { updatedAt, dayOfYear, daysInYear } = stats;
  // Live, not the cached anki_stats snapshot (stats.learnedCount) — that
  // only updates when "Refresh from Anki" runs, so it drifts stale as soon
  // as cards get graded directly on the site (which writes straight to
  // Supabase, bypassing Anki entirely).
  const learnedCount = cards.filter((c) => (c.reps ?? 0) > 0).length;
  const updatedStr = new Date(updatedAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const maxLapses = Math.max(...cards.filter((c) => c.lapses != null).map((c) => c.lapses!), 1);
  const scoredCards = cards
    .filter((c) => (c.reps ?? 0) > 0 && c.interval != null && c.lapses != null)
    .map((c) => {
      const lapseRate = c.lapses! / Math.max(c.reps!, 1);
      const lapseAbsolute = c.lapses! / maxLapses;
      const intervalDiff = 1 - Math.min(c.interval!, 90) / 90;
      const raw = lapseRate * 0.45 + lapseAbsolute * 0.2 + intervalDiff * 0.35;
      return { ...c, raw };
    })
    .sort((a, b) => a.raw - b.raw);

  const scoreMap = new Map<number, number>();
  scoredCards.forEach((c, i) => {
    scoreMap.set(c.note_id, scoredCards.length > 1 ? i / (scoredCards.length - 1) : 0.5);
  });
  const hasScores = scoreMap.size > 0;

  const hanziMastery =
    scoredCards.length === 0 ? 0 : Math.round((1 - scoredCards.reduce((sum, c) => sum + c.raw, 0) / scoredCards.length) * 100);

  const goalPct = Math.round(Math.min(learnedCount / yearlyGoal, 1) * 100);
  const remaining = Math.max(yearlyGoal - learnedCount, 0);
  const yearPct = Math.round((dayOfYear / daysInYear) * 100);

  const expectedByNow = dayOfYear * cardsPerDay;
  const cardDelta = learnedCount - expectedByNow;
  const daysDelta = Math.round(Math.abs(cardDelta) / cardsPerDay);

  const daysLeftInYear = daysInYear - dayOfYear;
  const daysNeeded = Math.ceil(remaining / cardsPerDay);
  const daysCanSkip = Math.max(0, daysLeftInYear - daysNeeded);
  const daysToCatchup = Math.max(
    0,
    Math.ceil((yearlyGoal * dayOfYear - daysInYear * learnedCount) / (cardsPerDay * daysInYear - yearlyGoal))
  );

  // "Unlocked" = every character in the word is one you've learned in the
  // Hanzi deck, even if you've never studied that word directly.
  const allHsk3Words = Object.values(hsk3Coverage.levels).flat();
  const knownCharSet = new Set(cards.filter((c) => (c.reps ?? 0) > 0).map((c) => c.character));
  const uniqueHskWords = Array.from(new Map(allHsk3Words.map((w) => [w.word, w])).values());
  const unlockedWords = uniqueHskWords.filter((w) => Array.from(w.word).every((ch) => knownCharSet.has(ch)));
  const unlockPct = uniqueHskWords.length > 0 ? Math.round((100 * unlockedWords.length) / uniqueHskWords.length) : 0;

  const unlockByLevel = LEVELS.map(({ key, label }) => {
    const levelWords = Array.from(new Map((hsk3Coverage.levels[key] ?? []).map((w) => [w.word, w])).values());
    const known = levelWords.filter((w) => Array.from(w.word).every((ch) => knownCharSet.has(ch))).length;
    const total = levelWords.length;
    const pct = total > 0 ? Math.round((100 * known) / total) : 0;
    return { key, label, known, total, pct };
  });

  // Sum the individual frequency share (cumulative % diff between adjacent
  // ranks) of every character you know — this generalizes the "top N
  // characters cover X% of written Chinese" stat to your actual (non-
  // contiguous) known set, rather than assuming you learned in rank order.
  let readPct: number | null = null;
  if (freq) {
    let sum = 0;
    let prevCumulative = 0;
    for (const { c, p } of freq) {
      if (knownCharSet.has(c)) sum += p - prevCumulative;
      prevCumulative = p;
    }
    readPct = sum;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1">
        {(["overview", "characters"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setSub(key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              sub === key
                ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {key === "overview" ? "Overview" : "Characters"}
          </button>
        ))}
      </div>

      {sub === "overview" ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6">
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div className="flex items-end justify-center gap-1">
                <span className="text-4xl sm:text-5xl font-bold tabular-nums">{learnedCount.toLocaleString("da-DK")}</span>
                <span className="pb-0.5 text-zinc-400 dark:text-zinc-500 text-xs">/ {yearlyGoal.toLocaleString("da-DK")}</span>
              </div>
              <div className="w-full max-w-sm space-y-1.5">
                <div className="h-4 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden relative">
                  <div
                    className="absolute inset-y-0 left-0 bg-red-400"
                    style={{ width: `${yearPct}%`, backgroundImage: "repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(255,255,255,0.3) 5px, rgba(255,255,255,0.3) 10px)" }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-emerald-700"
                    style={{ width: `${goalPct}%`, backgroundImage: "repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(255,255,255,0.3) 5px, rgba(255,255,255,0.3) 10px)" }}
                  />
                </div>
                <div className="flex items-center justify-center gap-3 text-xs">
                  <span className="text-emerald-700 dark:text-emerald-600 font-medium">{goalPct}%</span>
                  <span className="text-zinc-400 dark:text-zinc-500 font-medium">{yearPct}% year</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6 space-y-4">
            <div className="flex flex-col items-center gap-2 text-sm text-center">
              <p>
                <span className={`font-bold ${cardDelta < 0 ? "text-red-500" : ""}`}>{daysDelta} days</span>
                {" skipped"}
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                {"skip no more than "}
                <span className={`font-bold ${daysCanSkip <= 0 ? "text-red-500" : "text-zinc-700 dark:text-zinc-200"}`}>{daysCanSkip} days</span>
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                {daysToCatchup > 0 ? (
                  <>
                    {"stay consistent for "}
                    <span className="font-bold text-amber-500">{daysToCatchup} days</span>
                    {" to catch up"}
                  </>
                ) : (
                  <>you&apos;re on pace</>
                )}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Yearly goal
                <input
                  type="number"
                  min={1}
                  value={yearlyGoal}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10) || 1;
                    setYearlyGoal(v);
                    localStorage.setItem(YEARLY_GOAL_KEY, String(v));
                  }}
                  className="w-20 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-1.5 py-1 text-xs tabular-nums text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-stretch">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-5 flex flex-col gap-1.5 flex-1">
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                You can read <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200 tabular-nums">{readPct != null ? `${readPct.toFixed(1)}%` : "—"}</span> of Chinese text
              </p>
              {freq && <SaturationCurve freq={freq} valuePct={readPct} />}
            </div>
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-5 flex flex-col gap-1.5 flex-1">
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                This unlocks <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200 tabular-nums">{unlockPct}%</span> of the HSK vocabulary
              </p>
              <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-1.5">
                <div className="grid grid-cols-[56px_1fr_64px] items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  <span>Level</span>
                  <span />
                  <span className="text-right">Known</span>
                </div>
                {unlockByLevel.map(({ key, label, known, total, pct }) => (
                  <div key={key} className="grid grid-cols-[56px_1fr_64px] items-center gap-2">
                    <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">{label}</span>
                    <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-zinc-500 text-right tabular-nums">
                      {known}/{total}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-5 flex flex-col items-center justify-center gap-1.5 flex-1">
              <span className="text-2xl font-bold tabular-nums">{learnedCount.toLocaleString("da-DK")}</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">characters known</span>
            </div>
            <MasteryCard score={hanziMastery} isDark={isDark} />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">All {learnedCount} characters</h2>
              {hasScores && (
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <LegendSwatches />
                  <FormulaInfo />
                </div>
              )}
            </div>
            <CharacterGrid cards={cards} scoreMap={hasScores ? scoreMap : undefined} />
          </div>

          <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center">Updated {updatedStr}</p>
        </>
      )}
    </div>
  );
}
