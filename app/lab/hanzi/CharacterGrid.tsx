"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import { cardDueDiff } from "./card-utils";

export interface HanziCard {
  character: string;
  rank: number;
  pronunciation: string;
  front: string;
  note_id: number;
  card_id?: number;
  interval?: number;
  reps?: number;
  lapses?: number;
  factor?: number;
  queue?: number;
  due?: number;
  type?: number;
  mod?: number | null;
}

// percentile 0 = easiest (green), 0.5 = yellow, 1 = hardest (red)
// hue: 120 (green) → 60 (yellow) → 0 (red)
export function tileClass(): string {
  return "flex flex-col items-center justify-center rounded-md sm:rounded-lg border cursor-default py-1 px-0.5 sm:py-2.5 sm:px-1 transition-transform hover:scale-125 hover:z-10";
}

export function tileStyle(percentile?: number, isDark = true): Record<string, string> {
  if (percentile === undefined) {
    return isDark
      ? { backgroundColor: "hsl(0 0% 15%)", borderColor: "hsl(0 0% 28%)" }
      : { backgroundColor: "hsl(0 0% 93%)", borderColor: "hsl(0 0% 78%)" };
  }
  const hue = Math.round(120 * (1 - percentile));
  return isDark
    ? { backgroundColor: `hsl(${hue} 60% 20%)`, borderColor: `hsl(${hue} 65% 42%)` }
    : { backgroundColor: `hsl(${hue} 65% 78%)`, borderColor: `hsl(${hue} 55% 48%)` };
}

export function LegendSwatches() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const items: [string, number][] = [["Easy", 0], ["Harder", 0.5], ["Hardest", 1]];
  return (
    <>
      {items.map(([label, p]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-sm inline-block"
            style={{ ...tileStyle(p, isDark), borderWidth: 1 }}
          />
          {label}
        </span>
      ))}
    </>
  );
}

export function computeTooltipPos(x: number, y: number): Record<string, number> {
  if (typeof window === "undefined") return { left: x + 18, top: y - 12 };
  return {
    left: Math.min(x + 18, window.innerWidth - 240),
    top: Math.max(8, Math.min(y - 12, window.innerHeight - 280)),
  };
}

function relativeTime(unixSeconds: number): string {
  const diffS = Date.now() / 1000 - unixSeconds;
  if (diffS < 3600) return "< 1 hr ago";
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  const d = Math.floor(diffS / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function dueSoon(card: HanziCard): string | null {
  const diff = cardDueDiff(card);
  if (diff === null) return null;
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Due today";
  return `Due in ${diff}d`;
}

export function Tooltip({ card, percentile }: { card: HanziCard; percentile?: number }) {
  const due = dueSoon(card);

  const diffPct = percentile != null ? Math.round(percentile * 100) : null;
  const hue = percentile != null ? Math.round(120 * (1 - percentile)) : null;
  const diffLabel =
    percentile == null ? null
    : percentile < 0.25 ? "Easy"
    : percentile < 0.5  ? "Average"
    : percentile < 0.75 ? "Hard"
    : "Very hard";

  return (
    <div className="w-56 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-3.5 space-y-3 text-sm text-zinc-900 dark:text-zinc-100">
      <div className="flex items-start gap-3">
        <span className="text-4xl leading-none">{card.character}</span>
        <div className="min-w-0">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">{card.pronunciation}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-snug mt-0.5 line-clamp-2">{card.front}</p>
        </div>
      </div>

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

      {(card.interval != null || card.reps != null || card.lapses != null) && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {card.interval != null && (
            <>
              <span className="text-zinc-500">Interval</span>
              <span className="text-zinc-700 dark:text-zinc-200">{card.interval} days</span>
            </>
          )}
          {card.reps != null && (
            <>
              <span className="text-zinc-500">Reviews</span>
              <span className="text-zinc-700 dark:text-zinc-200">{card.reps}×</span>
            </>
          )}
          {card.lapses != null && (
            <>
              <span className="text-zinc-500">Lapses</span>
              <span className={card.lapses > 0 ? "text-red-500" : "text-zinc-700 dark:text-zinc-200"}>{card.lapses}</span>
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

      <a
        href={`https://hanzicraft.com/character/${encodeURIComponent(card.character)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="pointer-events-auto block text-center text-[10px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors border-t border-zinc-100 dark:border-zinc-800 pt-2 mt-1"
        onClick={(e) => e.stopPropagation()}
      >
        View on HanziCraft →
      </a>
    </div>
  );
}

export default function CharacterGrid({
  cards,
  scoreMap,
}: {
  cards: HanziCard[];
  scoreMap?: Map<number, number>;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [hovered, setHovered] = useState<HanziCard | null>(null);
  const [pinned, setPinned] = useState<HanziCard | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [pinnedPos, setPinnedPos] = useState({ x: 0, y: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { setHovered(null); setPinned(null); }, 120);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!pinned) setHoverPos({ x: e.clientX, y: e.clientY });
  }, [pinned]);

  const handleTileClick = useCallback((e: React.MouseEvent<HTMLDivElement>, card: HanziCard) => {
    e.stopPropagation();
    if (pinned?.note_id === card.note_id) { setPinned(null); return; }
    setPinnedPos({ x: e.clientX, y: e.clientY });
    setPinned(card);
  }, [pinned]);

  const activeCard = pinned ?? hovered;
  const tooltipX = pinned ? pinnedPos.x : hoverPos.x;
  const tooltipY = pinned ? pinnedPos.y : hoverPos.y;

  return (
    <div onMouseMove={handleMouseMove} onMouseLeave={scheduleHide} onClick={() => setPinned(null)}>
      <div
        className="grid gap-0.5 sm:gap-1.5 [grid-template-columns:repeat(5,minmax(0,1fr))] sm:[grid-template-columns:repeat(15,minmax(0,1fr))]"
      >
        {cards.map((card) => (
          <div
            key={card.note_id}
            className={tileClass()}
            style={tileStyle(scoreMap?.get(card.note_id), isDark)}
            onMouseEnter={() => { cancelHide(); if (!pinned) setHovered(card); }}
            onMouseLeave={scheduleHide}
            onClick={(e) => handleTileClick(e, card)}
          >
            <span className="text-sm sm:text-xl leading-none select-none">{card.character}</span>
            <span className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-500 mt-0.5 sm:mt-1 tabular-nums">{card.rank}</span>
          </div>
        ))}
      </div>

      {pinned && (
        <div className="sm:hidden fixed inset-0 z-40" onClick={() => setPinned(null)} />
      )}
      {activeCard && (
        <>
          <div
            className="sm:hidden fixed bottom-4 left-0 right-0 z-50 flex justify-center px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip card={activeCard} percentile={scoreMap?.get(activeCard.note_id)} />
          </div>
          <div
            className="hidden sm:block fixed z-50"
            style={computeTooltipPos(tooltipX, tooltipY)}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            onMouseMove={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip card={activeCard} percentile={scoreMap?.get(activeCard.note_id)} />
          </div>
        </>
      )}
    </div>
  );
}
