"use client";

import { useEffect, useRef, useState } from "react";
import type { HanziCard } from "./CharacterGrid";
import HanziWritingBox from "./HanziWritingBox";

function pickRandom(cards: HanziCard[], exclude?: string): HanziCard | undefined {
  if (cards.length === 0) return undefined;
  if (cards.length === 1) return cards[0];
  let choice: HanziCard;
  do {
    choice = cards[Math.floor(Math.random() * cards.length)];
  } while (choice.character === exclude);
  return choice;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export default function WritingPractice({ cards }: { cards: HanziCard[] }) {
  const [current, setCurrent] = useState<HanziCard | undefined>(undefined);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // Character navigation history (so ArrowLeft can go back, not just re-roll)
  const historyRef = useRef<HanziCard[]>([]);
  const historyIndexRef = useRef(-1);

  function goNext() {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      setCurrent(historyRef.current[historyIndexRef.current]);
      return;
    }
    const exclude = historyRef.current[historyIndexRef.current]?.character;
    const nextCard = pickRandom(cardsRef.current, exclude);
    if (!nextCard) return;
    historyRef.current = [...historyRef.current, nextCard];
    historyIndexRef.current += 1;
    setCurrent(nextCard);
  }

  function goPrevious() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    setCurrent(historyRef.current[historyIndexRef.current]);
  }

  // pick a starting character once cards are available, seeding history
  useEffect(() => {
    setCurrent((prev) => {
      if (prev) return prev;
      const first = pickRandom(cards);
      if (first) {
        historyRef.current = [first];
        historyIndexRef.current = 0;
      }
      return first;
    });
  }, [cards]);

  // Left/Right navigate cards — the writing box itself owns T/S/H.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevious();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!current) {
    return <p className="text-sm text-zinc-500">No cards to practice with yet.</p>;
  }

  return (
    <div className="space-y-4">
      <HanziWritingBox
        character={current.character}
        pronunciation={current.pronunciation}
        front={current.front}
        rank={current.rank}
        showHeader
        extraHotkeys={[{ keys: ["←", "→"], description: "Previous / next" }]}
      />

      <div className="md:hidden flex items-center justify-center gap-2">
        <button
          onClick={goPrevious}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"
        >
          ← Previous
        </button>
        <button
          onClick={goNext}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
