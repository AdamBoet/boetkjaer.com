"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type HanziCard } from "./CharacterGrid";
import { LEVELS, type Hsk3Coverage } from "./Hsk3Grid";
import { type WordPhrase } from "./FlashcardTab";

type Source = "hanzi" | "hsk3" | "wp";

interface SearchResult {
  id: string;
  source: Source;
  front: string;
  sub: string;
  back: string;
  interval?: number;
  reps?: number;
  levelLabel?: string; // e.g. "HSK 3" — only set for hsk3 results
}

const SOURCE_LABEL: Record<Source, string> = {
  hanzi: "Hanzi",
  hsk3: "HSK vocab",
  wp: "Words & phrases",
};

// Strips pinyin tone diacritics (NFD decomposes ā into a + combining mark)
// so typing romanized pinyin without tones still matches.
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export default function MandarinSearch({
  cards,
  hsk3Coverage,
  wordsPhrases,
}: {
  cards: HanziCard[];
  hsk3Coverage: Hsk3Coverage;
  wordsPhrases: WordPhrase[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const index = useMemo<SearchResult[]>(() => {
    const hanziResults: SearchResult[] = cards.map((c) => ({
      id: `hanzi-${c.note_id}`,
      source: "hanzi",
      front: c.character,
      sub: c.pronunciation,
      back: c.front,
      interval: c.interval,
      reps: c.reps,
    }));

    const seenHsk3 = new Set<string>();
    const hsk3Results: SearchResult[] = [];
    for (const { key, label } of LEVELS) {
      for (const w of hsk3Coverage.levels[key] ?? []) {
        if (seenHsk3.has(w.word)) continue;
        seenHsk3.add(w.word);
        hsk3Results.push({
          id: `hsk3-${w.word}`,
          source: "hsk3",
          front: w.word,
          sub: w.pinyin ?? "",
          back: w.meaning ?? "",
          interval: w.interval,
          reps: w.reps,
          levelLabel: label,
        });
      }
    }

    const wpResults: SearchResult[] = wordsPhrases.map((p) => ({
      id: `wp-${p.note_id}`,
      source: "wp",
      front: p.word,
      sub: p.pinyin ?? "",
      back: p.meaning ?? "",
      interval: p.interval,
      reps: p.reps,
    }));

    return [...hanziResults, ...hsk3Results, ...wpResults];
  }, [cards, hsk3Coverage, wordsPhrases]);

  const results = useMemo(() => {
    const raw = query.trim();
    if (!raw) return [];
    const q = normalize(raw);
    return index
      .filter((r) => r.front.includes(raw) || normalize(r.sub).includes(q) || normalize(r.back).includes(q))
      .slice(0, 25);
  }, [query, index]);

  useEffect(() => {
    setHighlighted(0);
  }, [results]);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (selected) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted((i) => {
        const next = Math.min(i + 1, results.length - 1);
        itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => {
        const next = Math.max(i - 1, 0);
        itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
        return next;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[highlighted];
      if (r) setSelected(r);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
        >
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setSelected(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleInputKeyDown}
          placeholder="Search characters, pinyin, meaning…"
          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
        />
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 max-h-96 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400 dark:text-zinc-500">No matches</p>
          ) : selected ? (
            <div className="p-4 space-y-3">
              <button
                onClick={() => setSelected(null)}
                className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                ← Back to results
              </button>
              <div className="flex items-start gap-3">
                <span className="text-3xl leading-none shrink-0">{selected.front}</span>
                <div className="min-w-0">
                  {selected.sub && <p className="text-sm text-emerald-700 dark:text-emerald-500">{selected.sub}</p>}
                  {selected.back && (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5 whitespace-pre-line">{selected.back}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 mt-2">{selected.levelLabel ?? SOURCE_LABEL[selected.source]}</span>
                <span className="mt-2">
                  {selected.reps != null && selected.reps > 0
                    ? `${selected.interval ?? 0}d interval · ${selected.reps} review${selected.reps === 1 ? "" : "s"}`
                    : "Not yet studied"}
                </span>
              </div>
            </div>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    ref={(el) => { itemRefs.current[i] = el; }}
                    onClick={() => setSelected(r)}
                    onMouseEnter={() => setHighlighted(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 ${
                      i === highlighted ? "bg-zinc-50 dark:bg-zinc-800/60" : ""
                    }`}
                  >
                    <span className="text-xl leading-none shrink-0 whitespace-nowrap min-w-[2rem]">{r.front}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-800 dark:text-zinc-100 truncate">
                        {r.sub && <span className="text-zinc-500 dark:text-zinc-400 mr-1.5">{r.sub}</span>}
                        <span className="text-zinc-400 dark:text-zinc-500 text-xs">{r.back}</span>
                      </p>
                    </div>
                    <span className="text-[10px] shrink-0 text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">{r.levelLabel ?? SOURCE_LABEL[r.source]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
