"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import CharacterGrid, { LegendSwatches, tileStyle, type HanziCard } from "./CharacterGrid";
import { cardDueDiff } from "./card-utils";
import HardCardsRow from "./HardCardsRow";
import FormulaInfo from "./FormulaInfo";

const YEARLY_GOAL = 1500;
const CARDS_PER_DAY = 5;

async function ankiConnect(
  action: string,
  params: Record<string, unknown> = {},
  url = "http://localhost:8765",
  apiKey = ""
) {
  const body: Record<string, unknown> = { action, version: 6, params };
  if (apiKey) body.key = apiKey;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

type Stats = {
  learnedCount: number;
  updatedAt: string;
  year: number;
  dayOfYear: number;
  daysInYear: number;
};

export default function HanziDashboard({
  initialStats,
  initialCards,
}: {
  initialStats: Stats;
  initialCards: HanziCard[];
}) {
  const [stats, setStats] = useState(initialStats);
  const [cards, setCards] = useState(initialCards);
  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [ankiUrl, setAnkiUrl] = useState("http://localhost:8765");
  const [deckName, setDeckName] = useState("Mandarin::汉字 writing");
  const settingsRef = useRef<HTMLDivElement>(null);
  const masteryInfoRef = useRef<HTMLDivElement>(null);
  const [masteryInfoOpen, setMasteryInfoOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const url = localStorage.getItem("ankiUrl") ?? "http://localhost:8765";
    const deck = localStorage.getItem("ankiDeck") ?? "Mandarin::汉字 writing";
    setAnkiUrl(url);
    setDeckName(deck);
    refreshFromAnki(url, deck, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    }
    if (showSettings) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSettings]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (masteryInfoRef.current && !masteryInfoRef.current.contains(e.target as Node)) {
        setMasteryInfoOpen(false);
      }
    }
    if (masteryInfoOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [masteryInfoOpen]);

  function saveSettings(url: string) {
    localStorage.setItem("ankiUrl", url);
    setAnkiUrl(url);
  }

  function saveDeck(deck: string) {
    localStorage.setItem("ankiDeck", deck);
    setDeckName(deck);
  }

  async function refreshFromAnki(urlOverride?: string, deckOverride?: string, auto = false) {
    const effectiveUrl = urlOverride ?? ankiUrl;
    const effectiveDeck = deckOverride ?? deckName;
    setLoading(true);
    setSynced(false);
    setError(null);
    try {
      type NoteInfo = {
        noteId: number;
        fields: Record<string, { value: string; order: number }>;
        tags: string[];
        cards?: number[];
      };

      // Discover all note IDs in the deck
      const allNoteIds: number[] = await ankiConnect(
        "findNotes",
        { query: `deck:"${effectiveDeck}"` },
        effectiveUrl
      );
      if (allNoteIds.length === 0)
        throw new Error(`No notes found in deck "${effectiveDeck}". Check the deck name in settings.`);

      // Get full note info (fields + tags + card IDs)
      const allNotes: NoteInfo[] = [];
      for (let i = 0; i < allNoteIds.length; i += 50) {
        const batch = await ankiConnect("notesInfo", { notes: allNoteIds.slice(i, i + 50) }, effectiveUrl);
        allNotes.push(...(Array.isArray(batch) ? batch.filter(Boolean) : []));
      }

      // Get review stats for all cards
      const allCardIds = allNotes.flatMap((n) => n.cards ?? []);
      const allCardInfo: {
        cardId: number; interval: number; reps: number; lapses: number;
        factor: number; queue: number; due: number; type: number; mod?: number;
      }[] = [];
      for (let i = 0; i < allCardIds.length; i += 50) {
        const batch = await ankiConnect("cardsInfo", { cards: allCardIds.slice(i, i + 50) }, effectiveUrl);
        allCardInfo.push(...batch);
      }

      const cardInfoById = Object.fromEntries(allCardInfo.map((c) => [c.cardId, c]));
      const reviewStats: Record<number, Partial<HanziCard>> = {};
      for (const note of allNotes) {
        const cardId = note.cards?.[0];
        if (!cardId) continue;
        const info = cardInfoById[cardId];
        if (!info) continue;
        reviewStats[note.noteId] = {
          card_id: cardId,
          interval: info.interval,
          reps: info.reps,
          lapses: info.lapses,
          factor: info.factor,
          queue: info.queue,
          due: info.due,
          type: info.type,
          mod: info.mod ?? null,
        };
      }

      // Merge: update existing cards + add new ones from Anki fields
      const existingByNoteId = Object.fromEntries(initialCards.map((c) => [c.note_id, c]));
      const updatedCards: HanziCard[] = allNotes.map((note) => {
        const existing = existingByNoteId[note.noteId];
        if (existing) return { ...existing, ...(reviewStats[note.noteId] ?? {}) };
        const rankTag = note.tags.find((t) => /^\d+$/.test(t));
        return {
          character: note.fields["Character"]?.value ?? "",
          rank: rankTag ? parseInt(rankTag, 10) : 9999,
          pronunciation: note.fields["Pronunciation"]?.value ?? "",
          front: note.fields["Front"]?.value ?? "",
          note_id: note.noteId,
          ...(reviewStats[note.noteId] ?? {}),
        };
      });
      updatedCards.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

      const learnedCount = updatedCards.filter((c) => (c.reps ?? 0) > 0).length;
      const now = new Date();
      const yearStart = new Date(now.getFullYear(), 0, 1);
      const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
      const dayOfYear = Math.floor((now.getTime() - yearStart.getTime()) / 86400000) + 1;
      const daysInYear = Math.floor((yearEnd.getTime() - yearStart.getTime()) / 86400000);

      const newStats = { learnedCount, updatedAt: now.toISOString(), year: now.getFullYear(), dayOfYear, daysInYear };
      setCards(updatedCards);
      setStats(newStats);

      const saveRes = await fetch("/api/anki-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stats: newStats, cards: updatedCards }),
      });
      if (!saveRes.ok) {
        const { error } = await saveRes.json();
        throw new Error(`Saved locally but failed to sync to database: ${error}`);
      }

      setSynced(true);
      setTimeout(() => setSynced(false), 3000);
    } catch (e) {
      if (!auto) {
        setError(
          e instanceof Error
            ? e.message.includes("fetch")
              ? "Could not reach Anki"
              : e.message
            : "Unknown error"
        );
      }
    } finally {
      setLoading(false);
    }
  }

  const { learnedCount, updatedAt, year, dayOfYear, daysInYear } = stats;

  const goalPct = Math.round(Math.min(learnedCount / YEARLY_GOAL, 1) * 100);
  const remaining = Math.max(YEARLY_GOAL - learnedCount, 0);
  const yearPct = Math.round((dayOfYear / daysInYear) * 100);
  const paceDelta = goalPct - yearPct;

  const expectedByNow = dayOfYear * CARDS_PER_DAY;
  const cardDelta = learnedCount - expectedByNow;
  const daysDelta = Math.round(Math.abs(cardDelta) / CARDS_PER_DAY);

  const daysLeftInYear = daysInYear - dayOfYear;
  const daysNeeded = Math.ceil(remaining / CARDS_PER_DAY);
  const daysCanSkip = Math.max(0, daysLeftInYear - daysNeeded);
  const daysToCatchup = Math.max(
    0,
    Math.ceil(
      (YEARLY_GOAL * dayOfYear - daysInYear * learnedCount) /
        (CARDS_PER_DAY * daysInYear - YEARLY_GOAL)
    )
  );

  const updatedStr = new Date(updatedAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

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

  const hardCards = [...scoredCards].reverse().slice(0, 15).map((c) => ({ ...c, score: c.raw }));

  const comingDueCards = [...scoredCards]
    .reverse()
    .filter((c) => { const d = cardDueDiff(c); return d !== null && d >= 0 && d <= 3; })
    .slice(0, 15)
    .map((c) => ({ ...c, score: c.raw }));

  const hasScores = scoreMap.size > 0;

  const masteryScore = scoredCards.length === 0 ? 0 : Math.round(
    (1 - scoredCards.reduce((sum, c) => sum + c.raw, 0) / scoredCards.length) * 100
  );

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Anki 汉字 Progress</h1>
          <p className="mt-1 text-sm text-zinc-500">Updated {updatedStr}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => refreshFromAnki()}
              disabled={loading}
              className="shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Fetching…" : synced ? "You're up to date" : "Refresh from Anki"}
            </button>
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setShowSettings((v) => !v)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                aria-label="AnkiConnect settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
              </button>
              {showSettings && (
                <div className="absolute right-0 top-full mt-1.5 z-20 w-72 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-4 space-y-3">
                  <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">AnkiConnect settings</p>
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-500">URL</span>
                    <input
                      type="text"
                      value={ankiUrl}
                      onChange={(e) => saveSettings(e.target.value)}
                      className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                      placeholder="http://localhost:8765"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-500">Deck</span>
                    <input
                      type="text"
                      value={deckName}
                      onChange={(e) => saveDeck(e.target.value)}
                      className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                      placeholder="Mandarin::汉字 writing"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
          {error && <p className="text-xs text-red-500 max-w-48 text-right">{error}</p>}
        </div>
      </div>

      {/* Combined progress + skip budget + mastery */}
      <div className="flex flex-col sm:flex-row gap-4 items-stretch">

        <div className="flex-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">

            {/* Progress */}
            <div className="flex-1 space-y-4 text-center">
              <div className="flex items-end justify-center gap-1">
                <span className="text-4xl sm:text-5xl font-bold tabular-nums">{learnedCount.toLocaleString()}</span>
                <span className="pb-0.5 text-zinc-400 dark:text-zinc-500 text-xs">/ {YEARLY_GOAL.toLocaleString()}</span>
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

            {/* Divider */}
            <div className="hidden sm:block w-px self-stretch bg-zinc-100 dark:bg-zinc-800" />
            <div className="block sm:hidden h-px w-full bg-zinc-100 dark:bg-zinc-800" />

            {/* Skip budget */}
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

        {/* Mastery widget */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-5 flex flex-row sm:flex-col items-center justify-center gap-4 sm:gap-2 sm:min-w-[130px]">
          <div
            className="w-10 h-10 rounded-lg border"
            style={tileStyle(1 - masteryScore / 100, isDark)}
          />
          <span className="text-2xl font-bold tabular-nums">{masteryScore}%</span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-zinc-500">Mastery</span>
            <div className="relative" ref={masteryInfoRef}>
              <button
                onClick={() => setMasteryInfoOpen((v) => !v)}
                className="text-zinc-600 hover:text-zinc-400 transition-colors text-sm leading-none"
                aria-label="Show mastery info"
              >
                ⓘ
              </button>
              {masteryInfoOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-52 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-3 text-xs text-zinc-600 dark:text-zinc-300 z-20 space-y-1.5">
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">How mastery is calculated</p>
                  <p>1 − average difficulty score across all reviewed cards.</p>
                  <p className="text-zinc-400 dark:text-zinc-500">Uses the same formula as the card colours: forget rate, lapse count, and interval length.</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Hardest cards */}
      {hardCards.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Hardest to remember</h2>
          <div className="sm:hidden">
            <HardCardsRow cards={hardCards.slice(0, 5)} scoreMap={scoreMap} columns={5} />
          </div>
          <div className="hidden sm:block">
            <HardCardsRow cards={hardCards} scoreMap={scoreMap} columns={15} />
          </div>
        </div>
      )}

      {/* Character grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">All {learnedCount} characters</h2>
          {hasScores && (
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <LegendSwatches />
              <FormulaInfo />
            </div>
          )}
        </div>
        <CharacterGrid cards={cards} scoreMap={hasScores ? scoreMap : undefined} />
      </div>

      <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center">Updated {updatedStr}</p>
    </div>
  );
}
