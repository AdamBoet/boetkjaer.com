"use client";

import { useEffect, useRef } from "react";
import HanziWriter from "hanzi-writer";
import { GRID_BACKGROUND_STYLE } from "./HanziWritingBox";

// A static, already-filled-in rendering of a character — no quiz, no
// animation, just the finished glyph. Used on the back of a hanzi flashcard
// so the box the user just drew in doesn't just vanish on reveal.
export default function HanziCharacterPreview({ character }: { character: string }) {
  const targetRef = useRef<HTMLDivElement>(null);
  const writerRef = useRef<HanziWriter | null>(null);

  useEffect(() => {
    if (!targetRef.current || !character) return;
    if (!writerRef.current) {
      writerRef.current = HanziWriter.create(targetRef.current, character, {
        width: 280,
        height: 280,
        padding: 12,
        showCharacter: true,
        showOutline: false,
      });
    } else {
      writerRef.current.setCharacter(character);
    }
  }, [character]);

  return (
    <div className="flex justify-center">
      <div
        className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 shrink-0"
        style={{ width: 280, height: 280, ...GRID_BACKGROUND_STYLE }}
      >
        <div ref={targetRef} className="absolute inset-0" style={{ width: 280, height: 280 }} />
      </div>
    </div>
  );
}
