"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ClickableHanziWord } from "./FlashcardTab";

const SUGGEST_DELAY_MS = 300;

type SavedSong = { id: number; title: string; artist: string; lyrics: string };

// A row in the dropdown: a suggestion while typing, or a full lyrics search
// result (which has an LRCLIB id and a first line to preview) after Search.
type SongOption = {
  title: string;
  artist: string;
  durationSeconds: number | null;
  lrclibId?: number;
  preview?: string;
};

function formatDuration(seconds: number | null) {
  if (!seconds) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}

export default function SongsTab() {
  const [library, setLibrary] = useState<SavedSong[] | null>(null);
  const [openSongId, setOpenSongId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [options, setOptions] = useState<SongOption[]>([]);
  const [searchedEmpty, setSearchedEmpty] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState<SongOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const suggestionCache = useRef(new Map<string, SongOption[]>());
  const suggestAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    api<{ songs: SavedSong[] }>("/api/songs")
      .then(({ songs }) => setLibrary(songs))
      .catch((e) => {
        setLibrary([]);
        setError(errorMessage(e));
      });
  }, []);

  // Suggestions as you type. Waits out IME composition, when the box holds
  // half-typed pinyin rather than what's being searched for. A failure just
  // shows no suggestions: Search still works, and reports its own errors.
  useEffect(() => {
    const q = query.trim();
    if (composing) return;
    setSearchedEmpty(false);
    setActiveIndex(-1);
    if (!q) {
      setOptions([]);
      return;
    }
    const cached = suggestionCache.current.get(q);
    if (cached) {
      setOptions(cached);
      return;
    }
    const controller = new AbortController();
    suggestAbort.current = controller;
    const timer = setTimeout(async () => {
      try {
        const { suggestions } = await api<{ suggestions: SongOption[] }>(
          `/api/songs/suggest?q=${encodeURIComponent(q)}`,
          { signal: controller.signal },
        );
        suggestionCache.current.set(q, suggestions);
        setOptions(suggestions);
      } catch {
        if (!controller.signal.aborted) setOptions([]);
      }
    }, SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, composing]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function closeOnOutsideClick(e: MouseEvent) {
      if (!searchRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [dropdownOpen]);

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    suggestAbort.current?.abort(); // a late suggestion mustn't replace these results
    setSearching(true);
    setError(null);
    try {
      const { results } = await api<{ results: SongOption[] }>(`/api/songs/search?q=${encodeURIComponent(q)}`);
      setOptions(results);
      setSearchedEmpty(results.length === 0);
      setActiveIndex(-1);
      setDropdownOpen(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSearching(false);
    }
  }

  async function save(option: SongOption) {
    setSaving(option);
    setError(null);
    try {
      const { song } = await api<{ song: SavedSong }>("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          option.lrclibId
            ? { lrclibId: option.lrclibId }
            : { title: option.title, artist: option.artist, durationSeconds: option.durationSeconds },
        ),
      });
      setLibrary((cur) => [song, ...(cur ?? []).filter((s) => s.id !== song.id)]);
      setQuery("");
      setDropdownOpen(false);
      setOpenSongId(song.id);
    } catch (e) {
      setError(`${option.title}: ${errorMessage(e)}`);
    } finally {
      setSaving(null);
    }
  }

  async function remove(song: SavedSong) {
    setError(null);
    try {
      await api(`/api/songs?id=${song.id}`, { method: "DELETE" });
      setLibrary((cur) => (cur ?? []).filter((s) => s.id !== song.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function handleInputKeys(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return; // Enter and arrows belong to the IME here
    if (e.key === "Escape") {
      setDropdownOpen(false);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && options.length > 0) {
      e.preventDefault();
      setDropdownOpen(true);
      // Cycles through the rows and back to -1, the text box itself.
      const step = e.key === "ArrowDown" ? 1 : -1;
      const stops = options.length + 1;
      setActiveIndex((i) => ((i + 1 + step + stops) % stops) - 1);
    } else if (e.key === "Enter" && dropdownOpen && options[activeIndex]) {
      e.preventDefault();
      save(options[activeIndex]);
    }
  }

  const openSong = library?.find((s) => s.id === openSongId);

  if (openSong) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <button
          onClick={() => setOpenSongId(null)}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          ← Library
        </button>
        <div>
          <h2 className="text-2xl font-medium text-zinc-900 dark:text-zinc-100">{openSong.title}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{openSong.artist}</p>
        </div>
        <div className="space-y-3 pb-16 text-xl text-zinc-900 dark:text-zinc-100">
          {openSong.lyrics.split("\n").map((line, i) => (
            <p key={i}>
              <ClickableHanziWord text={line} />
            </p>
          ))}
        </div>
      </div>
    );
  }

  const showDropdown = dropdownOpen && query.trim() !== "" && (options.length > 0 || searchedEmpty);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div ref={searchRef} className="relative">
        <form onSubmit={search} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            onKeyDown={handleInputKeys}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            placeholder="Search for a song or artist"
            maxLength={100}
            role="combobox"
            aria-expanded={showDropdown}
            aria-autocomplete="list"
            autoComplete="off"
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="shrink-0 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-96 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
            {options.length === 0 ? (
              <p className="px-3 py-2.5 text-sm text-zinc-500 dark:text-zinc-400">
                No lyrics found. Try the song title on its own, in Chinese characters.
              </p>
            ) : (
              <ul role="listbox">
                {options.map((option, i) => (
                  <li key={`${option.lrclibId ?? ""}${option.title}|${option.artist}`} role="option" aria-selected={i === activeIndex}>
                    <button
                      onClick={() => save(option)}
                      onMouseEnter={() => setActiveIndex(i)}
                      disabled={saving !== null}
                      className={`block w-full px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                        i === activeIndex ? "bg-zinc-100 dark:bg-zinc-800" : ""
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-zinc-900 dark:text-zinc-100">
                          {option.title} <span className="text-sm text-zinc-500 dark:text-zinc-400">{option.artist}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                          {saving === option ? "Finding lyrics…" : formatDuration(option.durationSeconds)}
                        </span>
                      </span>
                      {option.preview && (
                        <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">{option.preview}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Library</h2>
        {library === null ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
        ) : library.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No songs yet. Search for one above.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
            {library.map((song) => (
              <li key={song.id} className="flex items-center">
                <button
                  onClick={() => setOpenSongId(song.id)}
                  className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
                >
                  {song.title} <span className="text-sm text-zinc-500 dark:text-zinc-400">{song.artist}</span>
                </button>
                <button
                  onClick={() => remove(song)}
                  aria-label={`Remove ${song.title}`}
                  className="shrink-0 px-3 py-2.5 text-sm text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
