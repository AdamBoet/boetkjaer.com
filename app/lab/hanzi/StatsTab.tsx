"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type HanziCard } from "./CharacterGrid";
import { type Hsk3Coverage } from "./Hsk3Grid";
import { type WordPhrase, type DeckKey, DECK_LABELS } from "./FlashcardTab";
import { buildMandarinRows } from "./mandarin-rows";

type Horizon = "1m" | "3m" | "1y";

const HORIZON_CONFIG: Record<Horizon, { label: string; days: number; bucketDays: number }> = {
  "1m": { label: "1 month", days: 30, bucketDays: 1 },
  "3m": { label: "3 months", days: 90, bucketDays: 7 },
  "1y": { label: "1 year", days: 364, bucketDays: 28 },
};

const INTERVAL_BUCKETS: { max: number; label: string }[] = [
  { max: 1, label: "<1d" },
  { max: 7, label: "1–6d" },
  { max: 21, label: "1–3wk" },
  { max: 60, label: "3wk–2mo" },
  { max: 180, label: "2–6mo" },
  { max: 365, label: "6mo–1y" },
  { max: Infinity, label: "1y+" },
];

// Fixed categorical order for answer-button grades, kept separate from the
// New/Learning/Review/Relearning status palette so the two dimensions don't
// blur together when both appear on the page.
const GRADE_LABELS = ["Again", "Hard", "Good", "Easy"];
const GRADE_COLORS = ["bg-rose-500", "bg-amber-500", "bg-lime-500", "bg-emerald-600"];

interface TodayStats {
  count: number;
  minutes: number;
  secPerCard: number;
  again: number;
  againPct: number;
  learn: number;
  review: number;
  relearn: number;
  matureTotal: number;
  matureCorrect: number;
}

interface HourlyStat {
  hour: number;
  count: number;
  correct: number;
  pct: number | null;
}

interface AnswerButtonsStage {
  stage: "Learning" | "Young" | "Mature";
  counts: number[];
}

interface StatsApiData {
  today: TodayStats;
  calendarByDate: Record<string, number>;
  hourlyStats: HourlyStat[];
  answerButtons: AnswerButtonsStage[];
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function StatTile({ label, value, dot }: { label: string; value: number | string; dot?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex-1 min-w-[110px]">
      <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{value}</p>
    </div>
  );
}

// Simple hover-tooltipped bar chart — a handful of divs rather than a
// charting library, matching the custom-SVG approach already used for the
// saturation curve on the Hanzi tab. Every bar shares one flat fill color;
// intensity comes from opacity rather than a top-to-bottom color blend. By
// default (no `barOpacity`), higher-value bars are drawn *more* opaque —
// the tallest/most-common bars read as the most prominent, matching the
// ordinary "darker = more" dataviz convention. `barOpacity` lets a chart
// override that with a different metric entirely (Future Due fades by day
// offset from today, not review count — there, farther from today reads as
// *more* faded, the opposite direction from the value-based default).
function BarChart({
  bars,
  barColor,
  barOpacity,
  height = 140,
  showAllLabels = false,
  barMaxWidth = 18,
}: {
  bars: { label: string; value: number; tooltip?: string | string[] }[];
  barColor: string;
  barOpacity?: (number | null)[];
  height?: number;
  showAllLabels?: boolean;
  barMaxWidth?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const showEveryLabel = showAllLabels || bars.length <= 12;
  const hoveredBar = hover != null ? bars[hover] : null;

  function handleMove(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  // Touch has no hover — tapping a bar shows its tooltip the same way
  // hovering does on desktop; tapping the same bar again dismisses it.
  function handleTap(e: React.MouseEvent, i: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setHover((h) => (h === i ? null : i));
  }

  return (
    <div className="relative overflow-x-auto" ref={containerRef}>
      <div
        className="flex items-end justify-center gap-[3px] mx-auto"
        style={{ height, minWidth: bars.length * (barMaxWidth + 3) }}
        onMouseMove={handleMove}
      >
        {bars.map((b, i) => {
          const fadeFrom = barOpacity ? barOpacity[i] : b.value / max;
          const clamped = fadeFrom == null ? null : Math.max(0, Math.min(1, fadeFrom));
          // Explicit barOpacity (e.g. Future Due's distance-from-today) means
          // higher = more faded; the value-based default means higher = more
          // opaque, so the tallest bars read as the most prominent.
          const opacity = clamped == null ? undefined : barOpacity ? 1 - 0.9 * clamped : 0.1 + 0.9 * clamped;
          return (
          <div
            key={i}
            className={`relative flex-1 min-w-0 h-full flex items-end transition-colors ${
              hover === i ? "bg-zinc-100 dark:bg-zinc-800/60" : ""
            }`}
            style={{ maxWidth: barMaxWidth }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            onClick={(e) => handleTap(e, i)}
          >
            <div
              className={`w-full rounded-t-sm transition-opacity ${b.value === 0 ? "bg-zinc-200 dark:bg-zinc-700" : barColor}`}
              style={{
                height: `${b.value === 0 ? 2 : Math.max(2, (b.value / max) * 100)}%`,
                opacity: b.value === 0 ? undefined : hover === i ? 1 : opacity,
              }}
            />
          </div>
          );
        })}
      </div>
      {hoveredBar && mouse && (
        <div
          className="absolute z-10 whitespace-nowrap rounded-xl bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-xl px-3.5 py-2.5 pointer-events-none"
          style={{ left: mouse.x, top: mouse.y, transform: "translate(-50%, calc(-100% - 12px))" }}
        >
          {Array.isArray(hoveredBar.tooltip) ? (
            <div className="space-y-0.5">
              <p className="text-[13px] font-semibold">{hoveredBar.tooltip[0]}</p>
              {hoveredBar.tooltip.slice(1).map((line, idx) => (
                <p key={idx} className="text-[12px] text-zinc-500 dark:text-zinc-400">{line}</p>
              ))}
            </div>
          ) : (
            hoveredBar.tooltip ?? (
              <span className="text-[12px]">
                <span className="font-semibold">{hoveredBar.value}</span> · {hoveredBar.label}
              </span>
            )
          )}
        </div>
      )}
      <div
        className="flex justify-center gap-[3px] mt-1 mx-auto"
        style={{ minWidth: bars.length * (barMaxWidth + 3) }}
      >
        {bars.map((b, i) => (
          // Must match the bar column's own max-w exactly — giving labels a
          // different width than their bar desyncs each row's centering
          // (both rows are independently justify-center'd, so mismatched
          // per-item widths drift out of alignment the further an item is
          // from the middle). Long labels wrap instead of overflowing.
          <div key={i} className="flex-1 min-w-0 text-center" style={{ maxWidth: barMaxWidth }}>
            {(showEveryLabel || i % Math.ceil(bars.length / 8) === 0) && (
              <span className="text-[9px] text-zinc-400 dark:text-zinc-500 tabular-nums leading-tight break-words">{b.label}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CALENDAR_LEVELS = [
  "bg-zinc-100 dark:bg-zinc-800",
  "bg-emerald-200 dark:bg-emerald-900",
  "bg-emerald-400 dark:bg-emerald-700",
  "bg-emerald-500 dark:bg-emerald-600",
  "bg-emerald-700 dark:bg-emerald-400",
];

function levelFor(count: number, max: number): number {
  if (count === 0) return 0;
  if (max <= 1) return 2;
  const frac = count / max;
  if (frac > 0.75) return 4;
  if (frac > 0.5) return 3;
  if (frac > 0.25) return 2;
  return 1;
}

function CalendarHeatmap({ byDate }: { byDate: Map<string, number> }) {
  const years = useMemo(() => {
    const ys = new Set<number>();
    for (const key of byDate.keys()) ys.add(parseInt(key.slice(0, 4), 10));
    const nowY = new Date().getFullYear();
    ys.add(nowY);
    return [...ys].sort((a, b) => a - b);
  }, [byDate]);

  const [year, setYear] = useState(years[years.length - 1]);
  const yearIdx = years.indexOf(year);
  const [hover, setHover] = useState<string | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  function handleMove(e: React.MouseEvent) {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  // Touch has no hover — tapping a day shows its tooltip; tapping the same
  // day again dismisses it.
  function handleTap(e: React.MouseEvent, key: string) {
    const rect = gridRef.current?.getBoundingClientRect();
    if (rect) setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setHover((h) => (h === key ? null : key));
  }

  const { cells, max } = useMemo(() => {
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);
    const start = new Date(jan1);
    start.setDate(start.getDate() - start.getDay()); // back up to the preceding Sunday
    const end = new Date(dec31);
    end.setDate(end.getDate() + (6 - end.getDay())); // forward to the following Saturday

    const out: { key: string; count: number; inYear: boolean }[] = [];
    let maxCount = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = localDateKey(d);
      const count = byDate.get(key) ?? 0;
      if (d.getFullYear() === year) maxCount = Math.max(maxCount, count);
      out.push({ key, count, inYear: d.getFullYear() === year });
    }
    return { cells: out, max: maxCount };
  }, [byDate, year]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => yearIdx > 0 && setYear(years[yearIdx - 1])}
          disabled={yearIdx <= 0}
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Previous year"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>
        <span className="text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-200">{year}</span>
        <button
          onClick={() => yearIdx < years.length - 1 && setYear(years[yearIdx + 1])}
          disabled={yearIdx >= years.length - 1}
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Next year"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      {/* pt-7 gives hover tooltips room to render above the day squares —
          `overflow-x-auto` alone makes the browser treat overflow-y as
          clipped too (CSS doesn't allow mixing visible with a scrolling
          axis), so without this padding tooltips popping upward got cut
          off at the container's own top edge. pb-7 balances it so the grid
          sits centered in its section instead of pushed toward the top. */}
      <div className="relative overflow-x-auto pt-7 pb-7 flex justify-center" ref={gridRef} onMouseMove={handleMove}>
        <div
          className="grid grid-flow-col gap-[3px] w-max"
          style={{ gridTemplateRows: "repeat(7, 10px)" }}
        >
          {cells.map((c) => (
            <div
              key={c.key}
              onMouseEnter={() => setHover(c.key)}
              onMouseLeave={() => setHover((h) => (h === c.key ? null : h))}
              onClick={(e) => handleTap(e, c.key)}
              className={`relative w-[10px] h-[10px] rounded-[2px] ${
                c.inYear ? CALENDAR_LEVELS[levelFor(c.count, max)] : "bg-transparent"
              }`}
            />
          ))}
        </div>
        {hover && mouse && (() => {
          const c = cells.find((cell) => cell.key === hover);
          if (!c || !c.inYear) return null;
          return (
            <div
              className="absolute z-10 whitespace-nowrap rounded-xl bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-xl px-3.5 py-2.5 pointer-events-none"
              style={{ left: mouse.x, top: mouse.y, transform: "translate(-50%, calc(-100% - 12px))" }}
            >
              <p className="text-[13px] font-semibold">{c.count} review{c.count === 1 ? "" : "s"}</p>
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{c.key}</p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default function StatsTab({
  cards,
  hsk3Coverage,
  wordsPhrases,
}: {
  cards: HanziCard[];
  hsk3Coverage: Hsk3Coverage;
  wordsPhrases: WordPhrase[];
}) {
  const [horizon, setHorizon] = useState<Horizon>("1m");
  const [includeBacklog, setIncludeBacklog] = useState(false);
  const [deckFilter, setDeckFilter] = useState<DeckKey | "all">("all");

  // Today/Calendar/Hourly/Answer-buttons come from a background-computed
  // cache (/api/stats) instead of fetching the full review_log and
  // crunching it client-side on every visit — see /api/stats/recompute,
  // run hourly by a Vercel Cron, on demand via the Refresh link, and once
  // automatically every time this tab is opened (below) so it self-updates
  // without the cron's lag or a manual click.
  const [stats, setStats] = useState<StatsApiData | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const deckFilterRef = useRef(deckFilter);
  useEffect(() => {
    deckFilterRef.current = deckFilter;
  }, [deckFilter]);

  const loadStats = useCallback((deck: DeckKey | "all") => {
    setStatsError(null);
    fetch(`/api/stats?deck=${deck}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setStatsError(d.error);
        else {
          setStats(d.data);
          setComputedAt(d.computedAt);
        }
      })
      .catch(() => setStatsError("Could not load review history"));
  }, []);

  useEffect(() => {
    setStats(null);
    loadStats(deckFilter);
  }, [deckFilter, loadStats]);

  async function refreshStatsNow() {
    setRefreshing(true);
    try {
      await fetch("/api/stats/recompute", { method: "POST" });
      loadStats(deckFilterRef.current);
    } catch {
      setStatsError("Could not refresh stats");
    } finally {
      setRefreshing(false);
    }
  }

  // Shows the (possibly slightly stale) cached stats immediately on open,
  // then kicks off one recompute in the background and silently swaps in
  // the fresh result — so opening this tab is what keeps it current,
  // instead of requiring a manual Refresh click every time.
  useEffect(() => {
    setRefreshing(true);
    fetch("/api/stats/recompute", { method: "POST" })
      .then(() => loadStats(deckFilterRef.current))
      .catch(() => {})
      .finally(() => setRefreshing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allRows = useMemo(() => buildMandarinRows(cards, hsk3Coverage, wordsPhrases), [cards, hsk3Coverage, wordsPhrases]);
  const rows = useMemo(
    () => (deckFilter === "all" ? allRows : allRows.filter((r) => r.source === deckFilter)),
    [allRows, deckFilter]
  );

  const totals = useMemo(() => {
    let reviews = 0;
    let lapses = 0;
    for (const r of rows) {
      reviews += r.reps;
      lapses += r.lapses;
    }
    return { reviews, lapses };
  }, [rows]);

  // Only review-stage cards have a meaningful multi-day due date — Anki's
  // own Future Due chart works the same way, since new/learning cards are
  // due within minutes/hours rather than on a calendar-day schedule.
  const futureDue = useMemo(() => {
    const { days, bucketDays } = HORIZON_CONFIG[horizon];
    const numBuckets = Math.ceil(days / bucketDays);
    const counts = new Array(numBuckets).fill(0);
    let overdue = 0;
    const overdueOffsets: number[] = [];
    for (const r of rows) {
      if (r.status !== "review" || r.dueDiff == null) continue;
      if (r.dueDiff < 0) {
        overdue++;
        overdueOffsets.push(-r.dueDiff);
        continue;
      }
      const idx = Math.floor(r.dueDiff / bucketDays);
      if (idx < numBuckets) counts[idx]++;
    }

    // Sized to reach exactly the most overdue card, not padded out to the
    // full horizon window — a single card 3 days overdue shouldn't draw 30
    // empty backlog bars just because "1 month" is selected.
    const maxDaysAgo = overdueOffsets.length > 0 ? Math.max(...overdueOffsets) : 0;
    const backlogCounts = new Array(Math.ceil(maxDaysAgo / bucketDays)).fill(0);
    for (const daysAgo of overdueOffsets) {
      backlogCounts[Math.floor((daysAgo - 1) / bucketDays)]++;
    }

    // Running total always includes the existing backlog as its baseline —
    // those cards are already due, whether or not the Backlog bars are
    // currently shown — so "due by day N" reads as a true cumulative count.
    let running = overdue;
    const forwardBars = counts.map((value, i) => {
      const startDay = i * bucketDays;
      const endDay = startDay + bucketDays - 1;
      const label = bucketDays === 1 ? `${startDay}d` : `${startDay}-${endDay}d`;
      const header = bucketDays === 1
        ? `In ${startDay} day${startDay === 1 ? "" : "s"}:`
        : `In ${startDay}-${endDay} days:`;
      running += value;
      return {
        label,
        value,
        tooltip: [header, `${value} card${value === 1 ? "" : "s"} due`, `Running total: ${running.toLocaleString()}`],
      };
    });

    // Oldest bucket first (left), most recently overdue last (right, right
    // next to today) — reads chronologically left to right, same as the
    // forward bars that follow it. Its own running total accumulates from 0
    // up to the full overdue count, so the two chart halves' totals connect.
    let backlogRunning = 0;
    const backlogBars = [...backlogCounts]
      .reverse()
      .map((value, idx, arr) => {
        const j = arr.length - 1 - idx;
        const startDaysAgo = j * bucketDays + 1;
        const endDaysAgo = startDaysAgo + bucketDays - 1;
        const label = bucketDays === 1 ? `-${startDaysAgo}d` : `-${endDaysAgo}d`;
        const header = bucketDays === 1
          ? `${startDaysAgo} day${startDaysAgo === 1 ? "" : "s"} overdue:`
          : `${startDaysAgo}-${endDaysAgo} days overdue:`;
        backlogRunning += value;
        return {
          label,
          value,
          tooltip: [header, `${value} card${value === 1 ? "" : "s"}`, `Running total: ${backlogRunning.toLocaleString()}`],
        };
      });

    const forwardSum = counts.reduce((sum, v) => sum + v, 0);
    return {
      bars: includeBacklog ? [...backlogBars, ...forwardBars] : forwardBars,
      todayIndex: includeBacklog ? backlogBars.length : 0,
      overdue,
      total: forwardSum + overdue,
    };
  }, [rows, horizon, includeBacklog]);

  const intervalHistogram = useMemo(() => {
    const counts = INTERVAL_BUCKETS.map(() => 0);
    for (const r of rows) {
      if (r.status === "new") continue;
      const idx = INTERVAL_BUCKETS.findIndex((b) => r.interval < b.max);
      counts[idx === -1 ? INTERVAL_BUCKETS.length - 1 : idx]++;
    }
    return INTERVAL_BUCKETS.map((b, i) => ({ label: b.label, value: counts[i] }));
  }, [rows]);


  const avgPerDay = Math.round(futureDue.total / HORIZON_CONFIG[horizon].days);

  // Everything below this point comes from the precomputed stats cache
  // (backed by Anki's real revlog via getReviewsOfCards, synced on "Refresh
  // from Anki", plus any site-graded reviews) rather than the current-state
  // snapshot the charts above use — it's what makes Today, the calendar,
  // hourly breakdown, and answer buttons possible at all.
  const today = stats?.today ?? null;
  const calendarByDate = useMemo(() => new Map(Object.entries(stats?.calendarByDate ?? {})), [stats]);
  const hourlyStats = stats?.hourlyStats ?? null;
  const answerButtons = stats?.answerButtons ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center flex-wrap gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 w-fit">
          {(["all", "hanzi", "hsk3", "random_words", "idioms"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setDeckFilter(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                deckFilter === k
                  ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                  : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {k === "all" ? "All decks" : DECK_LABELS[k]}
            </button>
          ))}
        </div>
        {computedAt && (
          <button
            onClick={refreshStatsNow}
            disabled={refreshing}
            className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : `Updated ${formatAgo(computedAt)} · Refresh`}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <StatTile label="Total reviews" value={totals.reviews} />
        <StatTile label="Total lapses" value={totals.lapses} />
      </div>

      {today && today.count > 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-1.5 text-center">
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Today</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Studied <span className="font-semibold tabular-nums">{today.count}</span> cards in{" "}
            <span className="font-semibold tabular-nums">{today.minutes.toFixed(1)}</span> minutes (
            <span className="tabular-nums">{today.secPerCard.toFixed(1)}s/card</span>)
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Again count: <span className="font-semibold tabular-nums">{today.again}</span> (
            <span className="tabular-nums">{today.againPct.toFixed(1)}%</span>)
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Learn: <span className="font-semibold tabular-nums">{today.learn}</span>, Review:{" "}
            <span className="font-semibold tabular-nums">{today.review}</span>, Relearn:{" "}
            <span className="font-semibold tabular-nums">{today.relearn}</span>
          </p>
          {today.matureTotal > 0 && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Correct answers on mature cards: <span className="font-semibold tabular-nums">{today.matureCorrect}/{today.matureTotal}</span> (
              <span className="tabular-nums">{((today.matureCorrect / today.matureTotal) * 100).toFixed(1)}%</span>)
            </p>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Future due</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Reviews coming up, by when they're due.</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeBacklog}
                onChange={(e) => setIncludeBacklog(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 focus:ring-1 focus:ring-zinc-400"
              />
              Backlog
            </label>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5">
              {(Object.keys(HORIZON_CONFIG) as Horizon[]).map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    horizon === h
                      ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                      : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {HORIZON_CONFIG[h].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <BarChart
          bars={futureDue.bars}
          barColor="bg-emerald-600 dark:bg-emerald-500"
          barOpacity={futureDue.bars.map((_, i) => {
            const spread = Math.max(1, futureDue.todayIndex, futureDue.bars.length - 1 - futureDue.todayIndex);
            return Math.abs(i - futureDue.todayIndex) / spread;
          })}
        />
        <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 pt-1 border-t border-zinc-100 dark:border-zinc-800">
          <span>
            Total: <span className="font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">{futureDue.total}</span> reviews
          </span>
          <span>
            Average: <span className="font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">{avgPerDay}</span> /day
          </span>
          {futureDue.overdue > 0 && (
            <span>
              <span className="font-semibold text-red-500 tabular-nums">{futureDue.overdue}</span> overdue right now
            </span>
          )}
        </div>
      </div>

      {statsError && (
        <p className="text-xs text-red-500">{statsError}</p>
      )}

      {!statsError && stats === null && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Loading review history…</p>
      )}

      {!statsError && stats !== null && (calendarByDate.size === 0 ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          No review history synced yet — click "Refresh from Anki" to pull it in.
        </p>
      ) : (
        <>
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Calendar</p>
            <CalendarHeatmap byDate={calendarByDate} />
          </div>

          {hourlyStats && (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
              <div>
                <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Hourly breakdown</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Review volume by hour of day.</p>
              </div>
              <BarChart
                bars={hourlyStats.map((h) => ({
                  label: `${h.hour}`,
                  value: h.count,
                  tooltip:
                    h.pct != null
                      ? [`From ${h.hour}:00~${(h.hour + 1) % 24}:00`, `${h.count.toLocaleString()} reviews`, `${h.pct}% correct (${h.correct.toLocaleString()})`]
                      : [`From ${h.hour}:00~${(h.hour + 1) % 24}:00`, "No reviews"],
                }))}
                barColor="bg-sky-500 dark:bg-sky-600"
                showAllLabels
              />
            </div>
          )}

        </>
      ))}

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
        <div>
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Interval distribution</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">How mature your studied cards are — longer intervals mean you know them better.</p>
        </div>
        <BarChart bars={intervalHistogram} barColor="bg-sky-600 dark:bg-sky-500" barMaxWidth={40} />
      </div>

      {answerButtons && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Answer buttons</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">How often each grade was pressed, by card maturity.</p>
          </div>
          <div className="flex justify-center gap-12" style={{ height: 140 }}>
            {answerButtons.map(({ stage, counts }) => {
              const max = Math.max(1, ...answerButtons.flatMap((s) => s.counts));
              return (
                <div key={stage} className="flex flex-col items-center gap-1.5 h-full">
                  <div className="flex-1 flex items-end gap-1">
                    {counts.map((c, i) => (
                      <div key={i} className="w-4 flex flex-col items-center justify-end h-full">
                        <div
                          className={`w-full rounded-t-sm ${GRADE_COLORS[i]}`}
                          style={{ height: `${Math.max(2, (c / max) * 100)}%` }}
                          title={`${GRADE_LABELS[i]}: ${c}`}
                        />
                      </div>
                    ))}
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{stage}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-center pt-2 border-t border-zinc-100 dark:border-zinc-800">
            {GRADE_LABELS.map((g, i) => (
              <span key={g} className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${GRADE_COLORS[i]}`} />
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
