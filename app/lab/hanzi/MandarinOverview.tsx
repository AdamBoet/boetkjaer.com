"use client";

import { type HanziCard } from "./CharacterGrid";
import { cardDueDiff } from "./card-utils";
import HardCardsRow from "./HardCardsRow";
import { StatCard, MasteryCard, mastery, type Hsk3Coverage } from "./Hsk3Grid";

const YEARLY_GOAL = 1500;
const CARDS_PER_DAY = 5;

type Stats = {
  learnedCount: number;
  updatedAt: string;
  year: number;
  dayOfYear: number;
  daysInYear: number;
};

export default function MandarinOverview({
  cards,
  stats,
  hsk3Coverage,
  isDark,
}: {
  cards: HanziCard[];
  stats: Stats;
  hsk3Coverage: Hsk3Coverage;
  isDark: boolean;
}) {
  const { learnedCount, dayOfYear, daysInYear } = stats;

  const goalPct = Math.round(Math.min(learnedCount / YEARLY_GOAL, 1) * 100);
  const remaining = Math.max(YEARLY_GOAL - learnedCount, 0);
  const yearPct = Math.round((dayOfYear / daysInYear) * 100);

  const expectedByNow = dayOfYear * CARDS_PER_DAY;
  const cardDelta = learnedCount - expectedByNow;
  const daysDelta = Math.round(Math.abs(cardDelta) / CARDS_PER_DAY);

  const daysLeftInYear = daysInYear - dayOfYear;
  const daysNeeded = Math.ceil(remaining / CARDS_PER_DAY);
  const daysCanSkip = Math.max(0, daysLeftInYear - daysNeeded);
  const daysToCatchup = Math.max(
    0,
    Math.ceil((YEARLY_GOAL * dayOfYear - daysInYear * learnedCount) / (CARDS_PER_DAY * daysInYear - YEARLY_GOAL))
  );

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

  const hanziMastery =
    scoredCards.length === 0 ? 0 : Math.round((1 - scoredCards.reduce((sum, c) => sum + c.raw, 0) / scoredCards.length) * 100);

  const reversed = [...scoredCards].reverse();
  const totalDueToday = reversed.filter((c) => cardDueDiff(c) === 0).length;
  const todayCards = reversed.filter((c) => cardDueDiff(c) === 0).slice(0, 5).map((c) => ({ ...c, score: c.raw }));
  const tomorrowCards = reversed.filter((c) => cardDueDiff(c) === 1).slice(0, 5).map((c) => ({ ...c, score: c.raw }));

  const deck = hsk3Coverage.deck ?? { total: 0, learned: 0 };
  const vocabPct = deck.total > 0 ? Math.round((100 * deck.learned) / deck.total) : 0;
  const allHsk3Words = Object.values(hsk3Coverage.levels).flat();
  const vocabMastery = mastery(allHsk3Words);

  return (
    <div className="space-y-8">
      <div className="space-y-2.5">
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Hanzi characters</h3>

        <div className="flex flex-col sm:flex-row gap-4 items-stretch">
          <div className="flex-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="flex-1 space-y-4 text-center">
                <div className="flex items-end justify-center gap-1">
                  <span className="text-4xl sm:text-5xl font-bold tabular-nums">{learnedCount.toLocaleString("da-DK")}</span>
                  <span className="pb-0.5 text-zinc-400 dark:text-zinc-500 text-xs">/ {YEARLY_GOAL.toLocaleString("da-DK")}</span>
                </div>
                <div className="space-y-1.5">
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

              <div className="hidden sm:block w-px self-stretch bg-zinc-100 dark:bg-zinc-800" />
              <div className="block sm:hidden h-px w-full bg-zinc-100 dark:bg-zinc-800" />

              <div className="flex flex-col items-center sm:items-start justify-center gap-2 text-sm sm:min-w-52 text-center sm:text-left">
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
            </div>
          </div>

          <MasteryCard score={hanziMastery} isDark={isDark} />
        </div>

        {scoredCards.length > 0 && (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6 space-y-3">
            {totalDueToday > 0 ? (
              <>
                <p className="text-sm font-semibold text-red-500 dark:text-red-400">
                  You have {totalDueToday} card{totalDueToday !== 1 ? "s" : ""} due today
                </p>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">The hardest:</p>
                  <HardCardsRow cards={todayCards} scoreMap={scoreMap} columns={5} />
                </div>
              </>
            ) : (
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-500">
                All done for today — good job!
              </p>
            )}
            {tomorrowCards.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors select-none">
                  <span className="transition-transform duration-150 group-open:rotate-90 inline-block">›</span>
                  See tomorrow&apos;s difficult cards
                </summary>
                <div className="pt-2">
                  <HardCardsRow cards={tomorrowCards} scoreMap={scoreMap} columns={5} />
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">HSK vocabulary</h3>
        <div className="flex flex-col sm:flex-row gap-3 items-stretch">
          <StatCard known={deck.learned} total={deck.total} pct={vocabPct} caption="Known · full deck" />
          <MasteryCard score={vocabMastery} isDark={isDark} />
        </div>
      </div>
    </div>
  );
}
