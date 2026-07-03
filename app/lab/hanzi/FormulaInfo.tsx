"use client";

import { useState, useRef, useEffect } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

function Math({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function FormulaInfo() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-zinc-600 hover:text-zinc-400 transition-colors text-sm leading-none"
        aria-label="Show difficulty formula"
      >
        ⓘ
      </button>

      {open && (
        <div className="absolute right-0 top-6 z-50 w-96 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-5 space-y-5 text-zinc-900 dark:text-zinc-100">

          <p className="text-base font-semibold">Difficulty formula</p>

          {/* Main equation */}
          <div className="rounded-xl bg-zinc-100 dark:bg-zinc-800 px-4 py-5 flex justify-center overflow-x-auto">
            <Math display tex="\text{score} = r \times 0.45 \;+\; l \times 0.20 \;+\; d \times 0.35" />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">The constants are weights — they control how much each factor contributes. Forget rate matters most (45%), then interval length (35%), then raw lapse count (20%).</p>

          {/* Variable definitions */}
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Math tex="r = \dfrac{\text{lapses}}{\text{reviews}}" />
              </div>
              <p className="text-xs text-zinc-500">How often you forget, relative to total reviews. Normalises for how long you've had the card.</p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Math tex="l = \dfrac{\text{lapses}}{\text{max lapses}}" />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-600">Absolute number of times forgotten, normalised so one very hard card doesn't skew the rest.</p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Math tex="d = 1 - \dfrac{\min(\text{interval},\;90)}{90}" />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-600">Short interval means the card keeps coming back. Capped at 90 days — anything longer is considered fully mature.</p>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
