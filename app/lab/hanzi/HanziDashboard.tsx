"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { type HanziCard } from "./CharacterGrid";
import Hsk3Grid, { type Hsk3Coverage } from "./Hsk3Grid";
import FlashcardTab, { type WordPhrase, type DeckKey, type CardStatPatch } from "./FlashcardTab";
import HanziTab from "./HanziTab";
import BrowseTab from "./BrowseTab";
import StatsTab from "./StatsTab";
import { useReviewing } from "../../components/ReviewingContext";

const YEARLY_GOAL = 1500;
const CARDS_PER_DAY = 5;

const NOTIFICATION_PROMPT_SEEN_KEY = "hanziNotificationPromptSeen";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Asked once, the first time the app is opened on a device, rather than
// buried as a settings toggle — lets the daily sentence-refresh cron (runs
// locally, see Anki flashcards/Anki 汉字/sentence_audio/daily_refresh.py)
// notify an installed iOS/Android PWA when it finishes, via Web Push.
function NotificationPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (localStorage.getItem(NOTIFICATION_PROMPT_SEEN_KEY)) return;
    if (Notification.permission !== "default") return;
    setVisible(true);
  }, []);

  function dismiss() {
    localStorage.setItem(NOTIFICATION_PROMPT_SEEN_KEY, "1");
    setVisible(false);
  }

  async function enable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!key) throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        });
        await fetch("/api/push-subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub),
        });
      }
    } catch {
      // Ignore — worst case the user just doesn't get notifications.
    }
    dismiss();
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl p-5 space-y-3">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">Enable notifications?</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Get notified on this device when the nightly sentence refresh finishes.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={dismiss}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            Not now
          </button>
          <button
            onClick={enable}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? "..." : "Enable"}
          </button>
        </div>
      </div>
    </div>
  );
}

type AnkiReview = {
  id: number; // epoch ms — also the review's timestamp
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number; // ms taken to answer
  type: number;
};

// Pulls Anki's actual per-review history (not just current card state) for
// the Statistics tab's calendar/hourly/answer-button charts, and uploads it
// to review_log. Runs after the per-deck cardsInfo sync, using the same
// card IDs so review_log and hanzi_cards/hsk3_words never disagree on which
// cards exist.
async function syncReviewLog(
  source: "hanzi" | "hsk3" | "random_words" | "idioms",
  cardIds: number[],
  cardIdToDbId: Map<number, string | number>,
  effectiveUrl: string
) {
  if (cardIds.length === 0) return;
  const rows: {
    source: string;
    db_id: string;
    review_id: number;
    ease: number;
    interval: number;
    last_interval: number;
    factor: number;
    time_taken_ms: number;
    review_type: number;
    reviewed_at: string;
  }[] = [];

  for (let i = 0; i < cardIds.length; i += 200) {
    const batch = cardIds.slice(i, i + 200);
    const reviewsByCard: Record<string, AnkiReview[]> = await ankiConnect(
      "getReviewsOfCards",
      { cards: batch },
      effectiveUrl
    );
    for (const [cardIdStr, reviews] of Object.entries(reviewsByCard)) {
      const cardId = parseInt(cardIdStr, 10);
      const dbId = cardIdToDbId.get(cardId);
      if (dbId == null) continue; // card wasn't part of a note we recognize — skip rather than guess
      for (const r of reviews) {
        rows.push({
          source,
          db_id: String(dbId),
          review_id: r.id,
          ease: r.ease,
          interval: r.ivl,
          last_interval: r.lastIvl,
          factor: r.factor,
          time_taken_ms: r.time,
          review_type: r.type,
          reviewed_at: new Date(r.id).toISOString(),
        });
      }
    }
  }

  // Upload in chunks so a large first-time backfill (tens of thousands of
  // reviews) doesn't go out as one giant request body.
  for (let i = 0; i < rows.length; i += 5000) {
    const res = await fetch("/api/review-log-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rows.slice(i, i + 5000) }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(`Saved locally but failed to sync review history: ${error}`);
    }
  }
}

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
  wordsPhrases: initialWordsPhrases,
}: {
  initialStats: Stats;
  initialCards: HanziCard[];
  hsk3Coverage: Hsk3Coverage;
  wordsPhrases: WordPhrase[];
}) {
  const [stats, setStats] = useState(initialStats);
  const [cards, setCards] = useState(initialCards);
  const [hsk3Coverage, setHsk3Coverage] = useState(initialHsk3Coverage);
  const [wordsPhrases, setWordsPhrases] = useState(initialWordsPhrases);
  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [ankiUrl, setAnkiUrl] = useState("http://localhost:8765");
  const [deckName, setDeckName] = useState("Mandarin::汉字 writing");
  const settingsRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"flashcards" | "hanzi" | "hsk3" | "browse" | "stats">("flashcards");
  // Bridges the flashcard review's "open in Browse" shortcut (B) to the
  // Browse tab, which reads it once, jumps to that row, then clears it.
  const [focusCard, setFocusCard] = useState<{ source: DeckKey; dbId: number | string } | null>(null);
  // Hides the header + tab bar while an actual flashcard review session is
  // active (not the deck-menu screen), so the review gets the full page.
  const { reviewing, setReviewing } = useReviewing();
  // Grading writes straight to Supabase but never touched this component's
  // own `cards`/`hsk3Coverage`/`wordsPhrases` state — so the deck menu kept
  // showing whatever counts were true when the page first loaded, no matter
  // how many cards got graded in between. Patch the same fields locally,
  // live, every time a card's status actually changes (grade or undo), so
  // the counts stay honest throughout the session instead of only catching
  // up once it ends.
  function handleCardUpdated(source: DeckKey, dbId: number | string, rawPatch: CardStatPatch) {
    // A null `due` (graduated cards use a day-based interval instead) means
    // "not applicable" here same as `undefined` does for these display
    // types — they just never modeled the null case locally.
    const patch = { ...rawPatch, due: rawPatch.due ?? undefined };
    if (source === "hanzi") {
      setCards((prev) => prev.map((c) => (c.note_id === dbId ? { ...c, ...patch } : c)));
      return;
    }
    if (source === "random_words" || source === "idioms") {
      setWordsPhrases((prev) =>
        prev.map((w) => (w.source === source && w.note_id === dbId ? { ...w, ...patch } : w))
      );
      return;
    }
    // hsk3: dbId is the word itself, and words are nested per HSK level —
    // same lookup approach as handleToggleHsk3Known below.
    setHsk3Coverage((cov) => {
      const levels = { ...cov.levels };
      for (const [levelKey, words] of Object.entries(levels)) {
        const idx = words.findIndex((w) => w.word === dbId);
        if (idx === -1) continue;
        const updatedWords = [...words];
        updatedWords[idx] = { ...words[idx], ...patch };
        levels[levelKey] = updatedWords;
        break;
      }
      return { ...cov, levels };
    });
  }
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

  // Site-native replacement for what "Refresh from Anki" used to be the
  // only way to do: adding an HSK word to (or pausing it from) your active
  // study set. Updates local state optimistically, then confirms with the
  // API; a failure reverts the optimistic change.
  async function handleToggleHsk3Known(word: string, known: boolean) {
    const prevCoverage = hsk3Coverage;
    setHsk3Coverage((cov) => {
      const levels = { ...cov.levels };
      const summary = { ...cov.summary };
      for (const [levelKey, words] of Object.entries(levels)) {
        const idx = words.findIndex((w) => w.word === word);
        if (idx === -1) continue;
        const current = words[idx];
        if (current.known === known) break;
        const updatedWords = [...words];
        updatedWords[idx] = known
          ? {
              ...current,
              known: true,
              ...(current.reps == null
                ? { interval: 0, reps: 0, lapses: 0, factor: 2500, queue: 0, due: 0, type: 0, mod: Math.floor(Date.now() / 1000) }
                : {}),
            }
          : { ...current, known: false };
        levels[levelKey] = updatedWords;
        const s = summary[levelKey] ?? { total: words.length, known: 0 };
        summary[levelKey] = { ...s, known: s.known + (known ? 1 : -1) };
        break;
      }
      return { ...cov, levels, summary };
    });

    try {
      const res = await fetch("/api/hsk3-toggle-known", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, known }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update word");
    } catch (e) {
      setHsk3Coverage(prevCoverage);
      setError(e instanceof Error ? e.message : "Failed to update word");
    }
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

        // Content fields always come fresh from Anki — it's the
        // authoritative source for card content (character, meaning,
        // components, examples), unlike scheduling stats which the website
        // can also update independently.
        const rankTag = note.tags.find((t) => /^\d+$/.test(t));
        const pronunciation = note.fields["Pronunciation"]?.value ?? "";
        const rawFront = note.fields["Front"]?.value ?? "";
        const content: Partial<HanziCard> = {
          character: note.fields["Character"]?.value ?? "",
          rank: rankTag ? parseInt(rankTag, 10) : existing?.rank ?? 9999,
          pronunciation,
          front: rawFront,
          components: note.fields["Components"]?.value ?? "",
          examples: note.fields["Examples"]?.value ?? "",
        };

        if (existing) return { ...existing, ...content, ...stats };
        return { ...content, note_id: note.noteId, ...stats } as HanziCard;
      });
      // New cards are now authored straight into Supabase and never touch
      // Anki (see the "Anki flashcards" project) — they'll never show up in
      // `allNotes`. Building `updatedCards` purely from Anki's notes would
      // silently drop every one of them from the site the moment this
      // background sync runs. Keep any card Anki doesn't know about as-is.
      const noteIdsInAnki = new Set(allNotes.map((n) => n.noteId));
      const siteOnlyCards = cards.filter((c) => !noteIdsInAnki.has(c.note_id));
      updatedCards.push(...siteOnlyCards);
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

      const hanziCardIdToDbId = new Map<number, string | number>();
      for (const note of allNotes) for (const cid of note.cards ?? []) hanziCardIdToDbId.set(cid, note.noteId);
      await syncReviewLog("hanzi", allCardIds, hanziCardIdToDbId, effectiveUrl);

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
            sentence: n.fields["SentenceSimplified"]?.value?.replace(/<[^>]+>/g, "").trim() || undefined,
            sentence_pinyin: n.fields["SentencePinyin.1"]?.value?.replace(/<[^>]+>/g, "").trim() || undefined,
            sentence_meaning: n.fields["SentenceMeaning"]?.value?.replace(/<[^>]+>/g, "").trim() || undefined,
          });
        }

        const updatedLevels: Hsk3Coverage["levels"] = {};
        const hsk3Summary: Hsk3Coverage["summary"] = {};
        for (const [levelKey, words] of Object.entries(hsk3Coverage.levels)) {
          updatedLevels[levelKey] = words.map((w) => {
            const r = byWord.get(w.word);
            // Keep every existing field (audio_url, sentence_audio_url,
            // etc.) instead of rebuilding from just word/pinyin/meaning —
            // that silently dropped media URLs from memory on every refresh.
            return r ? { ...w, known: true, ...r } : { ...w, known: false };
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

        const hsk3CardIdToDbId = new Map<number, string | number>();
        for (const n of hsk3Notes) {
          const word = n.fields["Simplified"]?.value?.trim();
          const cardId = n.cards?.[0];
          if (word && cardId) hsk3CardIdToDbId.set(cardId, word);
        }
        await syncReviewLog("hsk3", hsk3CardIds, hsk3CardIdToDbId, effectiveUrl);
      }

      // Also refresh scheduling state for Random words / 中文的谚语/成语 —
      // content fields (word/pinyin/meaning/...) are left alone here; those
      // are only ever touched by `npm run sync-words-phrases`. This block
      // exists purely so Due counts don't go stale between full syncs.
      const wpDecks: { deck: string; source: "random_words" | "idioms" }[] = [
        { deck: "Mandarin::Random words", source: "random_words" },
        { deck: "Mandarin::中文的谚语/成语", source: "idioms" },
      ];
      const existingWpByNoteId = new Map(wordsPhrases.map((p) => [p.note_id, p]));
      const wpUpdates = new Map<number, WordPhrase>();

      for (const { deck, source } of wpDecks) {
        const noteIds: number[] = await ankiConnect("findNotes", { query: `deck:"${deck}"` }, effectiveUrl);
        if (noteIds.length === 0) continue;

        const notes: NoteInfo[] = [];
        for (let i = 0; i < noteIds.length; i += 600) {
          const batch = await ankiConnect("notesInfo", { notes: noteIds.slice(i, i + 600) }, effectiveUrl);
          notes.push(...(Array.isArray(batch) ? batch.filter(Boolean) : []));
        }
        const cardIds = notes.map((n) => n.cards?.[0]).filter((id): id is number => !!id);
        const cardInfo: {
          cardId: number; interval: number; reps: number; lapses: number;
          factor: number; queue: number; due: number; type: number; mod?: number;
        }[] = [];
        for (let i = 0; i < cardIds.length; i += 600) {
          const batch = await ankiConnect("cardsInfo", { cards: cardIds.slice(i, i + 600) }, effectiveUrl);
          cardInfo.push(...batch);
        }
        const cardInfoById = Object.fromEntries(cardInfo.map((c) => [c.cardId, c]));

        for (const note of notes) {
          const existing = existingWpByNoteId.get(note.noteId);
          const cardId = note.cards?.[0];
          const info = cardId ? cardInfoById[cardId] : undefined;
          if (!info || !existing) continue;
          const incomingIsNewer = !existing.mod || !info.mod || info.mod >= existing.mod;
          if (!incomingIsNewer) continue;
          wpUpdates.set(note.noteId, {
            ...existing,
            interval: info.interval,
            reps: info.reps,
            lapses: info.lapses,
            factor: info.factor,
            queue: info.queue,
            due: info.due,
            type: info.type,
            mod: info.mod ?? null,
          });
        }

        const cardIdToDbId = new Map<number, string | number>();
        for (const n of notes) for (const cid of n.cards ?? []) cardIdToDbId.set(cid, n.noteId);
        await syncReviewLog(source, cardIds, cardIdToDbId, effectiveUrl);
      }

      if (wpUpdates.size > 0) {
        const updatedWordsPhrases = wordsPhrases.map((p) => wpUpdates.get(p.note_id) ?? p);
        setWordsPhrases(updatedWordsPhrases);

        const wpRows = [...wpUpdates.values()].map((p) => ({
          note_id: p.note_id,
          interval: p.interval,
          reps: p.reps,
          lapses: p.lapses,
          factor: p.factor,
          queue: p.queue,
          due: p.due,
          type: p.type,
          mod: p.mod,
        }));
        const wpSaveRes = await fetch("/api/words-phrases-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: wpRows }),
        });
        if (!wpSaveRes.ok) {
          const { error } = await wpSaveRes.json();
          throw new Error(`Saved locally but failed to sync words/phrases to database: ${error}`);
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
    <div className="w-full space-y-8 -mt-20 pt-4 md:mt-0 md:pt-0">
      <NotificationPrompt />
      {!reviewing && (
        <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 border-b border-zinc-200 dark:border-zinc-800">
          {(["flashcards", "hanzi", "hsk3", "browse", "stats"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t
                  ? "border-zinc-800 dark:border-zinc-200 text-zinc-900 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {t === "flashcards"
                ? "Flashcards"
                : t === "hanzi"
                ? "Hanzi"
                : t === "hsk3"
                ? "HSK 3.0"
                : t === "browse"
                ? "Browse"
                : "Statistics"}
            </button>
          ))}
        </div>
      )}

      {tab === "flashcards" && (
        <FlashcardTab
          cards={cards}
          hsk3Coverage={hsk3Coverage}
          wordsPhrases={wordsPhrases}
          onJumpToCard={(c) => {
            // Jumping to Browse mid-review unmounts FlashcardTab (it only
            // renders while tab === "flashcards"), so nothing else would
            // ever flip `reviewing` back off — leaving the shared tab bar
            // permanently hidden with no way to navigate anywhere else.
            setReviewing(false);
            setFocusCard(c);
            setTab("browse");
          }}
          onReviewingChange={setReviewing}
          onCardUpdated={handleCardUpdated}
        />
      )}

      {tab === "hsk3" && (
        <div className="space-y-4">
          <Hsk3Grid coverage={hsk3Coverage} isDark={isDark} onToggleKnown={handleToggleHsk3Known} />
        </div>
      )}

      {tab === "hanzi" && <HanziTab cards={cards} hsk3Coverage={hsk3Coverage} stats={stats} isDark={isDark} />}

      {tab === "browse" && (
        <BrowseTab
          cards={cards}
          hsk3Coverage={hsk3Coverage}
          wordsPhrases={wordsPhrases}
          focusCard={focusCard}
          onFocusHandled={() => setFocusCard(null)}
        />
      )}

      {tab === "stats" && <StatsTab cards={cards} hsk3Coverage={hsk3Coverage} wordsPhrases={wordsPhrases} />}
    </div>
  );
}
