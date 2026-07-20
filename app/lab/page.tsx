import staticStats from "@/data/anki-stats.json";
import staticCards from "@/data/hanzi-cards.json";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import HardCardsRow from "./hanzi/HardCardsRow";
import { cardDueDiff } from "./hanzi/card-utils";
import { type HanziCard } from "./hanzi/CharacterGrid";

export const dynamic = "force-dynamic";

const YEARLY_GOAL = 1500;
const CARDS_PER_DAY = 5;

const numberFormat = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function Overview() {
  const [{ data: statsRow }, { data: cardsRows }, { data: economyTransactions }] = await Promise.all([
    supabase.from("anki_stats").select("*").eq("id", 1).single(),
    supabase.from("hanzi_cards").select("*").order("rank"),
    supabase.from("economy_transactions").select("type, amount"),
  ]);

  const stats = statsRow ?? staticStats;
  const cards = (cardsRows?.length ? cardsRows : staticCards) as HanziCard[];
  const net = (economyTransactions ?? []).reduce(
    (s, t) => s + (t.type === "income" ? t.amount : -t.amount),
    0
  );

  const { learnedCount, year, dayOfYear, daysInYear } = stats;
  const goalPct = Math.round(Math.min(learnedCount / YEARLY_GOAL, 1) * 100);
  const yearPct = Math.round((dayOfYear / daysInYear) * 100);
  const maxLapses = Math.max(...cards.filter(c => c.lapses != null).map(c => c.lapses!), 1);
  const scoredCards = cards
    .filter(c => (c.reps ?? 0) > 0 && c.interval != null && c.lapses != null)
    .map(c => {
      const lapseRate = c.lapses! / Math.max(c.reps!, 1);
      const lapseAbsolute = c.lapses! / maxLapses;
      const intervalDiff = 1 - Math.min(c.interval!, 90) / 90;
      const raw = lapseRate * 0.45 + lapseAbsolute * 0.20 + intervalDiff * 0.35;
      return { ...c, raw };
    })
    .sort((a, b) => a.raw - b.raw);

  const scoreMap = new Map<number, number>();
  scoredCards.forEach((c, i) => {
    scoreMap.set(c.note_id, scoredCards.length > 1 ? i / (scoredCards.length - 1) : 0.5);
  });

  const reversed = [...scoredCards].reverse();
  const totalDueToday = reversed.filter(c => cardDueDiff(c) === 0).length;
  const todayCards = reversed.filter(c => cardDueDiff(c) === 0).slice(0, 5).map(c => ({ ...c, score: c.raw }));
  const tomorrowCards = reversed.filter(c => cardDueDiff(c) === 1).slice(0, 5).map(c => ({ ...c, score: c.raw }));

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500">{year}</p>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6 space-y-4">
        <Link href="/lab/hanzi" className="group block">
          <div className="flex items-center justify-between mb-5">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">汉字 characters progression</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 transition-colors">View →</span>
          </div>

          <div className="space-y-4">
            <div className="flex items-end gap-1">
              <span className="text-5xl font-bold tabular-nums">{learnedCount.toLocaleString()}</span>
              <span className="pb-0.5 text-zinc-400 dark:text-zinc-500 text-xs">/ {YEARLY_GOAL.toLocaleString()}</span>
            </div>
            <div className="space-y-1.5">
              <div className="h-4 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 bg-red-400" style={{ width: `${yearPct}%`, backgroundImage: "repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(255,255,255,0.3) 5px, rgba(255,255,255,0.3) 10px)" }} />
                <div className="absolute inset-y-0 left-0 bg-emerald-700" style={{ width: `${goalPct}%`, backgroundImage: "repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(255,255,255,0.3) 5px, rgba(255,255,255,0.3) 10px)" }} />
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-700 dark:text-emerald-600 font-medium">{goalPct}%</span>
                <span className="text-zinc-400 dark:text-zinc-500 font-medium">{yearPct}% year</span>
              </div>
            </div>
          </div>
        </Link>

        {scoredCards.length > 0 && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4 space-y-3">
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
                  See tomorrow's difficult cards
                </summary>
                <div className="pt-2">
                  <HardCardsRow cards={tomorrowCards} scoreMap={scoreMap} columns={5} />
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      <Link
        href="/lab/economy"
        className="group block rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Economy</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 transition-colors">View →</span>
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">Net</p>
        <p className={`text-4xl font-bold ${net < 0 ? "text-red-500 dark:text-red-400" : "text-emerald-700 dark:text-emerald-500"}`}>
          {numberFormat.format(net)} kr
        </p>
      </Link>
    </div>
  );
}
