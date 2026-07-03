"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import { tileClass, tileStyle, computeTooltipPos, Tooltip, type HanziCard } from "./CharacterGrid";

export type ScoredCard = HanziCard & { score: number };

export default function HardCardsRow({
  cards,
  scoreMap,
  columns = 15,
}: {
  cards: ScoredCard[];
  scoreMap: Map<number, number>;
  columns?: number;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [hovered, setHovered] = useState<ScoredCard | null>(null);
  const [pinned, setPinned] = useState<ScoredCard | null>(null);
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

  const handleTileClick = useCallback((e: React.MouseEvent<HTMLDivElement>, card: ScoredCard) => {
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
        className="grid gap-0.5 sm:gap-1.5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {cards.map((card) => (
          <div
            key={card.note_id}
            className={tileClass()}
            style={tileStyle(scoreMap.get(card.note_id), isDark)}
            onMouseEnter={() => { cancelHide(); if (!pinned) setHovered(card); }}
            onMouseLeave={scheduleHide}
            onClick={(e) => handleTileClick(e, card)}
          >
            <span className="text-sm sm:text-xl leading-none select-none">{card.character}</span>
            <span className="text-[9px] sm:text-[10px] text-zinc-500 mt-0.5 sm:mt-1 tabular-nums">{card.rank}</span>
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
            <Tooltip card={activeCard} percentile={scoreMap.get(activeCard.note_id)} />
          </div>
          <div
            className="hidden sm:block fixed z-50"
            style={computeTooltipPos(tooltipX, tooltipY)}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            onMouseMove={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip card={activeCard} percentile={scoreMap.get(activeCard.note_id)} />
          </div>
        </>
      )}
    </div>
  );
}
