"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { tileStyle as masteryTileStyle, computeTooltipPos } from "./CharacterGrid";

export interface Hsk3Word {
  word: string;
  known: boolean;
  levelLabel?: string; // e.g. "HSK 3" — attached at read time, not stored in Supabase
  pinyin?: string;
  meaning?: string;
  sentence?: string;
  sentence_pinyin?: string;
  sentence_meaning?: string;
  audio_url?: string | null;
  sentence_audio_url?: string | null;
  note_id?: number;
  card_id?: number;
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

export interface Hsk3Coverage {
  levels: Record<string, Hsk3Word[]>;
  summary: Record<string, { total: number; known: number }>;
  deck?: { total: number; learned: number };
  updatedAt: string;
}

export const LEVELS: { key: string; label: string }[] = [
  { key: "hsk1", label: "HSK 1" },
  { key: "hsk2", label: "HSK 2" },
  { key: "hsk3", label: "HSK 3" },
  { key: "hsk4", label: "HSK 4" },
  { key: "hsk5", label: "HSK 5" },
  { key: "hsk6", label: "HSK 6" },
  { key: "hsk7-9", label: "HSK 7–9" },
];

// Same difficulty formula as HanziDashboard.tsx: percentile-ranks every known,
// reviewed word by forget rate + lapse count + interval length, 0 (easy) .. 1 (hard).
export function computeScoreMap(words: Hsk3Word[]): Map<string, number> {
  const scorable = words.filter(
    (w) => w.known && (w.reps ?? 0) > 0 && w.interval != null && w.lapses != null
  );
  const maxLapses = Math.max(...scorable.map((w) => w.lapses!), 1);

  const raw = new Map(
    scorable.map((w) => {
      const lapseRate = w.lapses! / Math.max(w.reps!, 1);
      const lapseAbs = w.lapses! / maxLapses;
      const intervalDiff = 1 - Math.min(w.interval!, 90) / 90;
      return [w.word, lapseRate * 0.45 + lapseAbs * 0.2 + intervalDiff * 0.35];
    })
  );

  const ordered = [...raw.entries()].sort((a, b) => a[1] - b[1]);
  const scores = new Map<string, number>();
  ordered.forEach(([word], i) => {
    scores.set(word, ordered.length > 1 ? i / (ordered.length - 1) : 0.5);
  });
  return scores;
}

// Mastery = 1 - average difficulty score across known, reviewed words.
// Same formula as the overall Mastery widget on the 汉字 dashboard.
export function mastery(words: Hsk3Word[]): number | null {
  const scoreMap = computeScoreMap(words);
  if (scoreMap.size === 0) return null;
  const avg = [...scoreMap.values()].reduce((s, v) => s + v, 0) / scoreMap.size;
  return Math.round((1 - avg) * 100);
}

// Unknown: flat muted tile. Known, no review history yet (new card): flat green.
// Known with review history: same green(easy)→red(hard) scale as the 汉字 grid.
function tileStyle(w: Hsk3Word, score: number | undefined, isDark: boolean): Record<string, string> {
  if (!w.known) {
    return isDark
      ? { backgroundColor: "hsl(0 0% 13%)", borderColor: "hsl(0 0% 24%)" }
      : { backgroundColor: "hsl(0 0% 95%)", borderColor: "hsl(0 0% 84%)" };
  }
  const percentile = score ?? 0;
  const hue = Math.round(120 * (1 - percentile));
  return isDark
    ? { backgroundColor: `hsl(${hue} 60% 20%)`, borderColor: `hsl(${hue} 65% 42%)` }
    : { backgroundColor: `hsl(${hue} 65% 78%)`, borderColor: `hsl(${hue} 55% 48%)` };
}

export function StatCard({
  known,
  total,
  pct,
  caption,
}: {
  known: number;
  total: number;
  pct: number;
  caption?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-5 flex flex-col gap-2 flex-1">
      {caption && <span className="text-xs text-zinc-500 self-start">{caption}</span>}
      <div className="flex flex-col items-center justify-center gap-2 flex-1">
        <span className="text-2xl font-bold tabular-nums">{pct}%</span>
        <span className="text-xs text-zinc-400 tabular-nums">
          {known.toLocaleString("da-DK")}/{total.toLocaleString("da-DK")}
        </span>
        <div className="h-1.5 w-full max-w-[180px] rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden mt-0.5">
          <div
            className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// Identical to the Mastery widget on the 汉字 dashboard: a tile shaded by the
// same green→red scale, the percentage, and an info popover on the label.
export function MasteryCard({ score, isDark }: { score: number | null; isDark: boolean }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setInfoOpen(false);
    }
    if (infoOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [infoOpen]);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-5 flex flex-col items-center justify-center gap-2 sm:min-w-[150px]">
      <div
        className="w-10 h-10 rounded-lg border"
        style={masteryTileStyle(score != null ? 1 - score / 100 : undefined, isDark)}
      />
      <span className="text-2xl font-bold tabular-nums">{score != null ? `${score}%` : "—"}</span>
      <div className="flex items-center gap-1">
        <span className="text-xs text-zinc-500">Mastery</span>
        <div className="relative" ref={infoRef}>
          <button
            onClick={() => setInfoOpen((v) => !v)}
            className="text-zinc-600 hover:text-zinc-400 transition-colors text-sm leading-none"
            aria-label="Show mastery info"
          >
            ⓘ
          </button>
          {infoOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-52 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-3 text-xs text-zinc-600 dark:text-zinc-300 z-20 space-y-1.5">
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">How mastery is calculated</p>
              <p>1 − average difficulty score across all reviewed words.</p>
              <p className="text-zinc-400 dark:text-zinc-500">
                Uses the same formula as the tile colours: forget rate, lapse count, and interval length.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewPanel({ coverage, isDark }: { coverage: Hsk3Coverage; isDark: boolean }) {
  const core = LEVELS.filter(({ key }) => key !== "hsk7-9").reduce(
    (acc, { key }) => {
      const s = coverage.summary[key];
      return { known: acc.known + (s?.known ?? 0), total: acc.total + (s?.total ?? 0) };
    },
    { known: 0, total: 0 }
  );
  const corePct = core.total > 0 ? Math.round((100 * core.known) / core.total) : 0;

  const allWords = LEVELS.flatMap(({ key }) => coverage.levels[key] ?? []);
  const overallMastery = mastery(allWords);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 items-stretch">
        <StatCard known={core.known} total={core.total} pct={corePct} caption="HSK 1-6 progression" />
        <MasteryCard score={overallMastery} isDark={isDark} />
      </div>

      <div className="space-y-2.5">
        {LEVELS.map(({ key, label }) => {
          const s = coverage.summary[key];
          const known = s?.known ?? 0;
          const total = s?.total ?? 0;
          const pct = total > 0 ? Math.round((100 * known) / total) : 0;
          return (
            <div key={key} className="grid grid-cols-[64px_1fr_120px] items-center gap-3">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{label}</span>
              <div className="h-4 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-zinc-500 text-right tabular-nums">
                {known} / {total} · {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Longer words need a smaller font so they never wrap inside the fixed tile height.
function wordTextClass(word: string): string {
  const n = word.length;
  if (n <= 1) return "text-sm sm:text-xl";
  if (n === 2) return "text-xs sm:text-base";
  if (n === 3) return "text-[10px] sm:text-sm";
  return "text-[9px] sm:text-xs";
}

function relativeDue(word: Hsk3Word): string | null {
  if (!word.mod || !word.interval) return null;
  const r = new Date(word.mod * 1000);
  const dueDay = new Date(r.getFullYear(), r.getMonth(), r.getDate() + word.interval);
  const t = new Date();
  const todayDay = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const diff = Math.round((dueDay.getTime() - todayDay.getTime()) / 86400000);
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Due today";
  return `Due in ${diff}d`;
}

function Hsk3Tooltip({
  word,
  score,
  onToggleKnown,
}: {
  word: Hsk3Word;
  score: number | undefined;
  onToggleKnown?: (word: string, known: boolean) => void;
}) {
  const diffPct = score != null ? Math.round(score * 100) : null;
  const hue = score != null ? Math.round(120 * (1 - score)) : null;
  const diffLabel =
    score == null ? null
    : score < 0.25 ? "Easy"
    : score < 0.5  ? "Average"
    : score < 0.75 ? "Hard"
    : "Very hard";
  const due = relativeDue(word);

  return (
    <div className="w-60 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-3.5 space-y-2.5 text-sm text-zinc-900 dark:text-zinc-100">
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none">{word.word}</span>
        <div className="min-w-0">
          {word.pinyin && <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">{word.pinyin}</p>}
          {word.meaning && (
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-snug mt-0.5 line-clamp-3">{word.meaning}</p>
          )}
        </div>
      </div>

      {!word.known && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Not being studied</p>
          {onToggleKnown && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleKnown(word.word, true); }}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
            >
              Start studying
            </button>
          )}
        </div>
      )}

      {diffLabel && hue != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Difficulty</span>
            <span className="font-semibold" style={{ color: `hsl(${hue} 80% 60%)` }}>{diffLabel} · {diffPct}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              style={{ width: `${diffPct}%`, backgroundColor: `hsl(${hue} 70% 50%)` }}
              className="h-full rounded-full"
            />
          </div>
        </div>
      )}

      {(word.interval != null || word.reps != null || word.lapses != null) && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {word.interval != null && (
            <>
              <span className="text-zinc-500">Interval</span>
              <span className="text-zinc-700 dark:text-zinc-200">{word.interval} days</span>
            </>
          )}
          {word.reps != null && (
            <>
              <span className="text-zinc-500">Reviews</span>
              <span className="text-zinc-700 dark:text-zinc-200">{word.reps}×</span>
            </>
          )}
          {word.lapses != null && (
            <>
              <span className="text-zinc-500">Lapses</span>
              <span className={word.lapses > 0 ? "text-red-500" : "text-zinc-700 dark:text-zinc-200"}>{word.lapses}</span>
            </>
          )}
          {due && (
            <>
              <span className="text-zinc-500">Next due</span>
              <span className={due === "Overdue" || due === "Due today" ? "text-amber-500" : "text-zinc-700 dark:text-zinc-200"}>
                {due}
              </span>
            </>
          )}
        </div>
      )}

      {word.known && onToggleKnown && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleKnown(word.word, false); }}
          className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
        >
          Remove from study
        </button>
      )}
    </div>
  );
}

function LevelPanel({
  words,
  isDark,
  onToggleKnown,
}: {
  words: Hsk3Word[];
  isDark: boolean;
  onToggleKnown?: (word: string, known: boolean) => void;
}) {
  const [hovered, setHovered] = useState<Hsk3Word | null>(null);
  const [pinned, setPinned] = useState<Hsk3Word | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [pinnedPos, setPinnedPos] = useState({ x: 0, y: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scoreMap = computeScoreMap(words);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (showTimer.current) clearTimeout(showTimer.current);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { setHovered(null); setPinned(null); }, 120);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  const scheduleShow = useCallback((word: Hsk3Word) => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => setHovered(word), 180);
  }, []);

  const cancelShow = useCallback(() => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!pinned) setHoverPos({ x: e.clientX, y: e.clientY });
  }, [pinned]);

  const handleTileClick = useCallback((e: React.MouseEvent<HTMLDivElement>, word: Hsk3Word) => {
    e.stopPropagation();
    cancelShow();
    if (pinned?.word === word.word) { setPinned(null); return; }
    setPinnedPos({ x: e.clientX, y: e.clientY });
    setPinned(word);
  }, [pinned, cancelShow]);

  const activeWord = pinned ?? hovered;
  const tooltipX = pinned ? pinnedPos.x : hoverPos.x;
  const tooltipY = pinned ? pinnedPos.y : hoverPos.y;

  return (
    <div onMouseMove={handleMouseMove} onMouseLeave={scheduleHide} onClick={() => setPinned(null)}>
      <div className="grid gap-0.5 sm:gap-1.5 [grid-template-columns:repeat(5,minmax(0,1fr))] sm:[grid-template-columns:repeat(15,minmax(0,1fr))]">
        {words.map((w) => (
          <div
            key={w.word}
            className="flex items-center justify-center rounded-md sm:rounded-lg border h-10 sm:h-16 cursor-default transition-transform hover:scale-110 hover:z-10"
            style={tileStyle(w, scoreMap.get(w.word), isDark)}
            onMouseEnter={() => { cancelHide(); if (!pinned) scheduleShow(w); }}
            onMouseLeave={() => { cancelShow(); scheduleHide(); }}
            onClick={(e) => handleTileClick(e, w)}
          >
            <span className={`leading-none select-none whitespace-nowrap ${wordTextClass(w.word)}`}>
              {w.word}
            </span>
          </div>
        ))}
      </div>

      {pinned && (
        <div className="sm:hidden fixed inset-0 z-40" onClick={() => setPinned(null)} />
      )}
      {activeWord && (
        <>
          <div
            className="sm:hidden fixed bottom-4 left-0 right-0 z-50 flex justify-center px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Hsk3Tooltip word={activeWord} score={scoreMap.get(activeWord.word)} onToggleKnown={onToggleKnown} />
          </div>
          <div
            className={`hidden sm:block fixed z-50 ${pinned ? "" : "pointer-events-none"}`}
            style={computeTooltipPos(tooltipX, tooltipY)}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            onMouseMove={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Hsk3Tooltip word={activeWord} score={scoreMap.get(activeWord.word)} onToggleKnown={onToggleKnown} />
          </div>
        </>
      )}
    </div>
  );
}

export default function Hsk3Grid({
  coverage,
  isDark,
  onToggleKnown,
}: {
  coverage: Hsk3Coverage;
  isDark: boolean;
  onToggleKnown?: (word: string, known: boolean) => void;
}) {
  const [level, setLevel] = useState<string>("overview");
  const activeSummary = level !== "overview" ? coverage.summary[level] : null;
  const activePct =
    activeSummary && activeSummary.total > 0
      ? Math.round((100 * activeSummary.known) / activeSummary.total)
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1">
        {["overview", ...LEVELS.map((l) => l.key)].map((key) => {
          const label = key === "overview" ? "Overview" : LEVELS.find((l) => l.key === key)!.label;
          return (
            <button
              key={key}
              onClick={() => setLevel(key)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                level === key
                  ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {level === "overview" ? (
        <OverviewPanel coverage={coverage} isDark={isDark} />
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {LEVELS.find((l) => l.key === level)!.label}
          </h3>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch">
            <StatCard
              known={activeSummary?.known ?? 0}
              total={activeSummary?.total ?? 0}
              pct={activePct}
            />
            <MasteryCard score={mastery(coverage.levels[level] ?? [])} isDark={isDark} />
          </div>
          <LevelPanel words={coverage.levels[level] ?? []} isDark={isDark} onToggleKnown={onToggleKnown} />
        </div>
      )}
    </div>
  );
}
