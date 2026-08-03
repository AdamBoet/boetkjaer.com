"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { type HanziCard } from "./CharacterGrid";
import WritingPractice from "./WritingPractice";
import Hsk3Grid, { type Hsk3Coverage } from "./Hsk3Grid";
import MandarinOverview from "./MandarinOverview";
import FlashcardTab, { type WordPhrase } from "./FlashcardTab";
import HanziTab from "./HanziTab";

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
    signal: AbortSignal.timeout(30000),
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
  hsk3Coverage: initialHsk3Coverage,
  wordsPhrases,
}: {
  initialStats: Stats;
  initialCards: HanziCard[];
  hsk3Coverage: Hsk3Coverage;
  wordsPhrases: WordPhrase[];
}) {
  const [stats, setStats] = useState(initialStats);
  const [cards, setCards] = useState(initialCards);
  const [hsk3Coverage, setHsk3Coverage] = useState(initialHsk3Coverage);
  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [ankiUrl, setAnkiUrl] = useState("http://localhost:8765");
  const [deckName, setDeckName] = useState("Mandarin::汉字 writing");
  const settingsRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"dashboard" | "flashcards" | "hanzi" | "hsk3" | "practice">("dashboard");
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

      // Merge: update existing cards + add new ones from Anki fields. Only
      // let Anki's fetched stats win if they're actually newer than what we
      // already have (`mod` timestamp) — otherwise a grade recorded here on
      // the website (which Anki doesn't know about yet) would get silently
      // overwritten by Anki's older snapshot on the next refresh. This only
      // matters while both Anki and this site are being used in parallel.
      const existingByNoteId = Object.fromEntries(cards.map((c) => [c.note_id, c]));
      const updatedCards: HanziCard[] = allNotes.map((note) => {
        const existing = existingByNoteId[note.noteId];
        const cardId = note.cards?.[0];
        const info = cardId ? cardInfoById[cardId] : undefined;
        const incomingIsNewer = !existing?.mod || !info?.mod || info.mod >= existing.mod;
        const stats: Partial<HanziCard> =
          info && incomingIsNewer
            ? {
                card_id: cardId,
                interval: info.interval,
                reps: info.reps,
                lapses: info.lapses,
                factor: info.factor,
                queue: info.queue,
                due: info.due,
                type: info.type,
                mod: info.mod ?? null,
              }
            : {};
        if (existing) return { ...existing, ...stats };
        const rankTag = note.tags.find((t) => /^\d+$/.test(t));
        return {
          character: note.fields["Character"]?.value ?? "",
          rank: rankTag ? parseInt(rankTag, 10) : 9999,
          pronunciation: note.fields["Pronunciation"]?.value ?? "",
          front: note.fields["Front"]?.value ?? "",
          note_id: note.noteId,
          ...stats,
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

      // Also refresh the HSK 3.0 vocabulary coverage from the same Anki instance.
      const hsk3NoteIds: number[] = await ankiConnect(
        "findNotes",
        { query: 'deck:"Mandarin::HSK 1-6 vocabulary"' },
        effectiveUrl
      );
      if (hsk3NoteIds.length > 0) {
        const hsk3Notes: NoteInfo[] = [];
        for (let i = 0; i < hsk3NoteIds.length; i += 600) {
          const batch = await ankiConnect("notesInfo", { notes: hsk3NoteIds.slice(i, i + 600) }, effectiveUrl);
          hsk3Notes.push(...(Array.isArray(batch) ? batch.filter(Boolean) : []));
        }
        const hsk3CardIds = hsk3Notes.map((n) => n.cards?.[0]).filter((id): id is number => !!id);
        const hsk3CardInfo: {
          cardId: number; interval: number; reps: number; lapses: number;
          factor: number; queue: number; due: number; type: number; mod?: number;
        }[] = [];
        for (let i = 0; i < hsk3CardIds.length; i += 600) {
          const batch = await ankiConnect("cardsInfo", { cards: hsk3CardIds.slice(i, i + 600) }, effectiveUrl);
          hsk3CardInfo.push(...batch);
        }
        const hsk3CardInfoById = Object.fromEntries(hsk3CardInfo.map((c) => [c.cardId, c]));

        const byWord = new Map<string, Partial<import("./Hsk3Grid").Hsk3Word>>();
        for (const n of hsk3Notes) {
          const word = n.fields["Simplified"]?.value?.trim();
          if (!word || byWord.has(word)) continue;
          const cardId = n.cards?.[0];
          const info = cardId ? hsk3CardInfoById[cardId] : null;
          byWord.set(word, {
            note_id: n.noteId,
            card_id: cardId ?? undefined,
            interval: info?.interval,
            reps: info?.reps,
            lapses: info?.lapses,
            factor: info?.factor,
            queue: info?.queue,
            due: info?.due,
            type: info?.type,
            mod: info?.mod ?? null,
          });
        }

        const updatedLevels: Hsk3Coverage["levels"] = {};
        const hsk3Summary: Hsk3Coverage["summary"] = {};
        for (const [levelKey, words] of Object.entries(hsk3Coverage.levels)) {
          updatedLevels[levelKey] = words.map((w) => {
            const r = byWord.get(w.word);
            const { word, pinyin, meaning } = w;
            return r ? { word, pinyin, meaning, known: true, ...r } : { word, pinyin, meaning, known: false };
          });
          const knownCount = updatedLevels[levelKey].filter((w) => w.known).length;
          hsk3Summary[levelKey] = { total: words.length, known: knownCount };
        }
        const deckLearned = [...byWord.values()].filter((r) => (r.reps ?? 0) > 0).length;
        const deck = { total: byWord.size, learned: deckLearned };
        const hsk3UpdatedAt = new Date().toISOString();
        const newHsk3Coverage: Hsk3Coverage = { levels: updatedLevels, summary: hsk3Summary, deck, updatedAt: hsk3UpdatedAt };
        setHsk3Coverage(newHsk3Coverage);

        // Only known words carry review stats that can actually change between
        // refreshes — the ~5,900 words never in the deck stay known:false
        // forever, so skip re-uploading them every time. (If a word is ever
        // removed from the deck, its row goes stale until the next full
        // `npm run sync-hsk3`, which re-seeds everything from scratch.)
        const hsk3Words = Object.entries(updatedLevels)
          .flatMap(([lvl, ws]) => ws.map((w) => ({ ...w, level: lvl })))
          .filter((w) => w.known);
        const hsk3SaveRes = await fetch("/api/hsk3-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stats: { deck_total: deck.total, deck_learned: deck.learned, updated_at: hsk3UpdatedAt },
            words: hsk3Words,
          }),
        });
        if (!hsk3SaveRes.ok) {
          const { error } = await hsk3SaveRes.json();
          throw new Error(`Saved locally but failed to sync HSK vocabulary to database: ${error}`);
        }
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

  const updatedStr = new Date(updatedAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="w-full space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Mandarin Progress</h1>
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

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(["dashboard", "flashcards", "hanzi", "hsk3", "practice"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-zinc-800 dark:border-zinc-200 text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t === "dashboard"
              ? "Dashboard"
              : t === "flashcards"
              ? "Flashcards"
              : t === "hanzi"
              ? "Hanzi"
              : t === "hsk3"
              ? "HSK 3.0"
              : "Practice writing"}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <MandarinOverview cards={cards} stats={stats} hsk3Coverage={hsk3Coverage} isDark={isDark} />
      )}

      {tab === "flashcards" && <FlashcardTab cards={cards} hsk3Coverage={hsk3Coverage} wordsPhrases={wordsPhrases} />}

      {tab === "practice" && <WritingPractice cards={cards} />}

      {tab === "hsk3" && (
        <div className="space-y-4">
          <Hsk3Grid coverage={hsk3Coverage} isDark={isDark} />
        </div>
      )}

      {tab === "hanzi" && <HanziTab cards={cards} hsk3Coverage={hsk3Coverage} stats={stats} isDark={isDark} />}
    </div>
  );
}
