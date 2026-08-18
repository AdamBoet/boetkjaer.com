"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LEVELS, type Hsk3Coverage } from "./Hsk3Grid";
import { type HanziCard } from "./CharacterGrid";
import {
  type WordPhrase,
  type DeckKey,
  type DueCard,
  DECK_LABELS,
  formatInterval,
  gradeCard,
  buildEditUpdates,
  AudioButton,
} from "./FlashcardTab";
import {
  type Status,
  type MandarinRow as Row,
  STATUS_LABEL,
  STATUS_DOT,
  buildMandarinRows,
} from "./mandarin-rows";

type SortKey = "front" | "deck" | "status" | "interval" | "reps" | "due" | "rank";
type ColumnKey = SortKey;

const COLUMN_LABELS: Record<ColumnKey, string> = {
  front: "Card",
  deck: "Deck",
  status: "Status",
  interval: "Interval",
  reps: "Reps",
  due: "Due",
  rank: "Position",
};

// fr units rather than % so the remaining columns fill the row proportionally
// whenever the user hides one — a % based template would just leave blank
// space where the hidden column used to be.
const COLUMN_WIDTH: Record<ColumnKey, number> = {
  front: 34,
  deck: 16,
  status: 14,
  interval: 10,
  reps: 7,
  due: 13,
  rank: 10,
};

const COLUMN_ALIGN: Record<ColumnKey, "left" | "right"> = {
  front: "left",
  deck: "left",
  status: "left",
  interval: "right",
  reps: "right",
  due: "right",
  rank: "right",
};

const DEFAULT_COLUMN_ORDER: ColumnKey[] = ["front", "deck", "status", "interval", "reps", "due", "rank"];
const DEFAULT_HIDDEN_COLUMNS: ColumnKey[] = [];
const COLUMNS_STORAGE_KEY = "browse_columns_v1";

interface ColumnConfig {
  key: ColumnKey;
  visible: boolean;
}

function defaultColumns(extraHidden: ColumnKey[] = []): ColumnConfig[] {
  return DEFAULT_COLUMN_ORDER.map((key) => ({ key, visible: !DEFAULT_HIDDEN_COLUMNS.includes(key) && !extraHidden.includes(key) }));
}

// On a phone, default a few lower-priority columns to hidden so the table
// doesn't need to be crushed/scrolled to be readable — only ever applied
// when the user has no saved column layout yet (see loadColumns below), so
// it never overrides an existing preference.
function loadColumns(extraHidden: ColumnKey[] = []): ColumnConfig[] {
  if (typeof window === "undefined") return defaultColumns();
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return defaultColumns(extraHidden);
    const parsed = JSON.parse(raw) as ColumnConfig[];
    const known = new Set(parsed.map((c) => c.key));
    // Re-include any column a code change added since the user last saved
    // their layout, so it doesn't silently disappear — unless it defaults
    // to hidden, matching what a fresh layout would show.
    const missing = DEFAULT_COLUMN_ORDER.filter((k) => !known.has(k)).map((key) => ({
      key,
      visible: !DEFAULT_HIDDEN_COLUMNS.includes(key),
    }));
    const kept = parsed.filter((c) => DEFAULT_COLUMN_ORDER.includes(c.key));
    return kept.length > 0 ? [...kept, ...missing] : defaultColumns();
  } catch {
    return defaultColumns();
  }
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toLowerCase();
}

function SidebarButton({
  active,
  onClick,
  label,
  count,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        active
          ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
      <span className="truncate flex-1">{label}</span>
      <span className="tabular-nums text-zinc-400 dark:text-zinc-500">{count}</span>
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
        active
          ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 font-medium"
          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
      }`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
      {label}
    </button>
  );
}

function ColumnsMenu({
  columns,
  onToggle,
}: {
  columns: ColumnConfig[];
  onToggle: (key: ColumnKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M4 5.5A1.5 1.5 0 015.5 4h9A1.5 1.5 0 0116 5.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 014 14.5v-9zM8 5.5v9m4-9v9" stroke="currentColor" strokeWidth="1.3" fill="none" />
        </svg>
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-20 w-48 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-2 space-y-0.5">
          {columns.map(({ key, visible }) => {
            const isOnly = visible && columns.filter((c) => c.visible).length === 1;
            return (
              <label
                key={key}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 ${
                  isOnly ? "opacity-50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={isOnly}
                  onChange={() => onToggle(key)}
                  className="rounded border-zinc-300 dark:border-zinc-600"
                />
                {COLUMN_LABELS[key]}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CardEditor({
  row,
  onSaved,
  onClose,
}: {
  row: Row;
  onSaved: (patch: Partial<DueCard>) => void;
  onClose: () => void;
}) {
  const [front, setFront] = useState(row.front);
  const [sub, setSub] = useState(row.sub);
  const [back, setBack] = useState(row.back);
  // Hanzi-only fields — no equivalent on hsk3/random_words/idioms rows.
  const [components, setComponents] = useState(row.components ?? "");
  const [examples, setExamples] = useState(row.examples ?? "");
  const [pictureUrl, setPictureUrl] = useState(row.pictureUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const dirty =
    front !== row.front ||
    sub !== row.sub ||
    back !== row.back ||
    (row.source === "hanzi" && (components !== (row.components ?? "") || examples !== (row.examples ?? "")));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updates = buildEditUpdates(row.source, front, sub, back);
      if (row.source === "hanzi") Object.assign(updates, { components, examples });
      await gradeCard(row.source, row.dbId, updates);
      onSaved({ front, sub, back, ...(row.source === "hanzi" ? { components, examples } : {}) });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function uploadPicture(file: File) {
    setUploading(true);
    setError(null);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const filename = file.name || `pasted.${file.type.split("/")[1] || "png"}`;
      const res = await fetch("/api/upload-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: row.source, id: row.dbId, filename, contentType: file.type, contentBase64 }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Upload failed");
      }
      const { url } = await res.json();
      setPictureUrl(url);
      onSaved({ pictureUrl: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function removePicture() {
    setUploading(true);
    setError(null);
    try {
      await gradeCard(row.source, row.dbId, { picture_url: null });
      setPictureUrl(null);
      onSaved({ pictureUrl: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove picture");
    } finally {
      setUploading(false);
    }
  }

  // Cmd+V paste-to-upload, matching Anki — only while this editor is mounted.
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      const file = item.getAsFile();
      if (file) uploadPicture(file);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-2xl leading-none">{row.front}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[row.status]}`} />
          {STATUS_LABEL[row.status]}
        </span>
        <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 border-l border-zinc-200 dark:border-zinc-700 pl-3">
          <span>{row.levelLabel ?? DECK_LABELS[row.source]}</span>
          {row.rank != null && <span>position {row.rank}</span>}
          <span>{row.status === "new" ? "no interval yet" : `${formatInterval(row.interval)} interval`}</span>
          <span>{row.reps} review{row.reps === 1 ? "" : "s"}</span>
          {row.lapses > 0 && <span>{row.lapses} lapse{row.lapses === 1 ? "" : "s"}</span>}
        </div>
        <button
          onClick={onClose}
          className="ml-auto text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          Close ✕
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs text-zinc-500">Front</span>
          <input
            value={front}
            onChange={(e) => setFront(e.target.value)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-500">Pinyin</span>
          <input
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs text-zinc-500">Meaning</span>
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </label>
        {row.source === "hanzi" && (
          <>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Components</span>
              <input
                value={components}
                onChange={(e) => setComponents(e.target.value)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Examples</span>
              <textarea
                value={examples}
                onChange={(e) => setExamples(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
            </label>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        {row.source !== "hsk3" ? (
          <div className="flex items-center gap-2">
            {pictureUrl ? (
              <div className="flex items-center gap-2">
                <img src={pictureUrl} alt="" className="max-h-10 rounded-md border border-zinc-200 dark:border-zinc-700" />
                <button onClick={removePicture} disabled={uploading} className="text-[11px] text-red-500 hover:text-red-600 disabled:opacity-50">
                  Remove
                </button>
              </div>
            ) : (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">Paste an image (⌘V) to add a picture</span>
            )}
            {uploading && <span className="text-[11px] text-zinc-400">Uploading…</span>}
          </div>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          {savedFlash && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BrowseTab({
  cards,
  hsk3Coverage,
  wordsPhrases,
  focusCard,
  onFocusHandled,
}: {
  cards: HanziCard[];
  hsk3Coverage: Hsk3Coverage;
  wordsPhrases: WordPhrase[];
  /** Set (e.g. from the flashcard review's "open in Browse" shortcut) to select + scroll to a specific card once. */
  focusCard?: { source: DeckKey; dbId: number | string } | null;
  onFocusHandled?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [deckFilter, setDeckFilter] = useState<DeckKey | "all">("all");
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  const [hsk3Expanded, setHsk3Expanded] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<DueCard>>>({});
  const tableRef = useRef<HTMLDivElement>(null);

  // Column order/visibility, persisted per user. Starts from the default
  // (SSR-safe) layout, then swaps in whatever was saved once mounted —
  // matches the pattern used for other localStorage-backed settings on this
  // page, since reading localStorage during the initial render would make
  // the server-rendered HTML disagree with the client and trigger a
  // hydration mismatch.
  const [columns, setColumns] = useState<ColumnConfig[]>(defaultColumns);
  const [columnsHydrated, setColumnsHydrated] = useState(false);
  // Pointer-based drag instead of native HTML5 drag-and-drop — the browser's
  // built-in drag ghost/dragover events are janky, only reliably start from
  // exactly where the listener is attached (not the whole cell), and give no
  // way to render a smooth floating element under the cursor. Tracking the
  // pointer ourselves fixes all three: the dragged header floats and follows
  // the cursor every frame, a drop indicator shows where it'll land, and the
  // actual reorder happens once on release rather than live (which would
  // otherwise require re-measuring positions mid-drag to avoid jumps).
  const [dragState, setDragState] = useState<{
    key: ColumnKey;
    startX: number;
    startY: number;
    deltaX: number;
    width: number;
    // The floating label's position is anchored to where the drag started,
    // not re-measured from the dragged header's live DOM position — since
    // the other columns now reorder live as you drag (the whole point of
    // this change), the dragged header's own grid slot moves too, and
    // reading its rect on every render would make the floating label jump
    // each time a swap happens.
    originLeft: number;
    originTop: number;
    dropTarget: ColumnKey | null;
    // A plain click also fires pointerdown/pointerup, so the drag visuals
    // (floating header, drop indicator) only switch on once the pointer has
    // actually moved past a small threshold — otherwise every click on a
    // sort button would flash the drag overlay for a frame.
    active: boolean;
  } | null>(null);
  const headerRefs = useRef<Partial<Record<ColumnKey, HTMLDivElement>>>({});
  // Tracks the last column the pointer was over so live reordering only
  // fires when that actually changes, not on every pixel of movement.
  const lastOverKeyRef = useRef<ColumnKey | null>(null);

  useEffect(() => {
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    setColumns(loadColumns(isMobile ? (["reps", "interval", "rank"] as ColumnKey[]) : []));
    setColumnsHydrated(true);
  }, []);

  useEffect(() => {
    if (!columnsHydrated) return;
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  }, [columns, columnsHydrated]);

  function toggleColumn(key: ColumnKey) {
    setColumns((cols) => {
      const target = cols.find((c) => c.key === key);
      if (!target) return cols;
      if (target.visible && cols.filter((c) => c.visible).length <= 1) return cols;
      return cols.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c));
    });
  }

  function reorderColumn(draggedKey: ColumnKey, targetKey: ColumnKey) {
    if (draggedKey === targetKey) return;
    setColumns((cols) => {
      const draggedIdx = cols.findIndex((c) => c.key === draggedKey);
      const targetIdx = cols.findIndex((c) => c.key === targetKey);
      if (draggedIdx === -1 || targetIdx === -1) return cols;
      const next = [...cols];
      const [moved] = next.splice(draggedIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  }

  function columnAtX(clientX: number): ColumnKey | null {
    for (const key of visibleColumns) {
      const el = headerRefs.current[key];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return key;
    }
    return null;
  }

  function startColumnDrag(key: ColumnKey, e: React.PointerEvent) {
    const rect = headerRefs.current[key]?.getBoundingClientRect();
    lastOverKeyRef.current = key;
    setDragState({
      key,
      startX: e.clientX,
      startY: e.clientY,
      deltaX: 0,
      width: rect?.width ?? 120,
      originLeft: rect?.left ?? 0,
      originTop: rect?.top ?? 0,
      dropTarget: null,
      active: false,
    });
  }

  useEffect(() => {
    if (!dragState) return;
    function handleMove(e: PointerEvent) {
      setDragState((s) => {
        if (!s) return s;
        const deltaX = e.clientX - s.startX;
        const active = s.active || Math.hypot(deltaX, e.clientY - s.startY) > 4;
        if (!active) return { ...s, deltaX, active };
        const overKey = columnAtX(e.clientX);
        // Live reorder — the other columns actually shift as you drag over
        // them, rather than only snapping into place once you let go.
        if (overKey && overKey !== lastOverKeyRef.current) {
          lastOverKeyRef.current = overKey;
          reorderColumn(s.key, overKey);
        }
        return { ...s, deltaX, dropTarget: overKey, active };
      });
    }
    function handleUp() {
      setDragState(null);
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState?.key]);

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible).map((c) => c.key), [columns]);
  // A floor per column (via minmax) so on a narrow viewport the table
  // scrolls horizontally instead of the old plain-`fr` behavior, which just
  // divided up whatever width was available and crushed every column
  // (especially the low-fr ones like reps/interval) into unreadable slivers.
  const gridTemplate = useMemo(
    () => visibleColumns.map((k) => `minmax(${COLUMN_WIDTH[k] * 8}px, ${COLUMN_WIDTH[k]}fr)`).join(" "),
    [visibleColumns]
  );

  const baseRows = useMemo<Row[]>(
    () => buildMandarinRows(cards, hsk3Coverage, wordsPhrases),
    [cards, hsk3Coverage, wordsPhrases]
  );

  const rows = useMemo(
    () => baseRows.map((r) => (overrides[r.id] ? { ...r, ...overrides[r.id] } : r)),
    [baseRows, overrides]
  );

  const deckCounts = useMemo(() => {
    const c: Record<DeckKey, number> = { hanzi: 0, hsk3: 0, random_words: 0, idioms: 0 };
    for (const r of rows) c[r.source]++;
    return c;
  }, [rows]);

  const statusCounts = useMemo(() => {
    const c: Record<Status, number> = { new: 0, learning: 0, review: 0, relearning: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const levelCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) if (r.level) c[r.level] = (c[r.level] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let result = rows;
    if (deckFilter !== "all") result = result.filter((r) => r.source === deckFilter);
    if (levelFilter) result = result.filter((r) => r.level === levelFilter);
    if (statusFilter !== "all") result = result.filter((r) => r.status === statusFilter);
    const q = query.trim();
    if (q) {
      const nq = normalize(q);
      result = result.filter(
        (r) => r.front.includes(q) || normalize(r.sub).includes(nq) || normalize(r.back).includes(nq)
      );
    }
    return result;
  }, [rows, deckFilter, levelFilter, statusFilter, query]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      // Cards without a rank (HSK vocab, words & phrases) always sort after
      // ranked ones, regardless of sort direction, rather than flipping to
      // the front when sorting descending — so this skips the shared
      // `* sortDir` below entirely.
      if (sortKey === "rank" && (a.rank == null || b.rank == null)) {
        if (a.rank == null && b.rank == null) return 0;
        return a.rank == null ? 1 : -1;
      }
      let cmp = 0;
      switch (sortKey) {
        case "front":
          cmp = a.front.localeCompare(b.front, "zh");
          break;
        case "deck":
          cmp = DECK_LABELS[a.source].localeCompare(DECK_LABELS[b.source]);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "interval":
          cmp = a.interval - b.interval;
          break;
        case "reps":
          cmp = a.reps - b.reps;
          break;
        case "due":
          cmp = (a.dueDiff ?? Infinity) - (b.dueDiff ?? Infinity);
          break;
        case "rank":
          cmp = (a.rank as number) - (b.rank as number);
          break;
      }
      return cmp * sortDir;
    });
    return out;
  }, [filtered, sortKey, sortDir]);

  // Only the rows actually scrolled into view get mounted — with several
  // thousand cards, rendering every <tr> at once was what made the tab lag.
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => tableRef.current,
    estimateSize: () => 41,
    overscan: 12,
    // A selected row grows to show its inline editor, so row height isn't
    // uniform — measure the actual rendered height instead of trusting the
    // estimate for every row.
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Arrow-key navigation between rows while the editor is open — skipped
  // while typing in one of the editor's own fields, where arrows should
  // move the text cursor instead.
  useEffect(() => {
    if (!selectedId) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const idx = sorted.findIndex((r) => r.id === selectedId);
      if (idx === -1) return;
      const nextIdx = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= sorted.length) return;
      e.preventDefault();
      setSelectedId(sorted[nextIdx].id);
      rowVirtualizer.scrollToIndex(nextIdx, { align: "auto" });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, sorted, rowVirtualizer]);

  // Jump-to-card from outside (the flashcard review's "open in Browse"
  // shortcut): clear whatever filters might be hiding the target row, then
  // — once `sorted` reflects that on a later render — select and scroll to
  // it. Two effects because clearing filters and `sorted` updating can't
  // happen in the same synchronous pass.
  const pendingFocusId = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCard) return;
    const prefix = focusCard.source === "hanzi" ? "hanzi" : focusCard.source === "hsk3" ? "hsk3" : "wp";
    pendingFocusId.current = `${prefix}-${focusCard.dbId}`;
    setQuery("");
    setDeckFilter("all");
    setLevelFilter(null);
    setStatusFilter("all");
  }, [focusCard]);

  useEffect(() => {
    if (!pendingFocusId.current) return;
    const idx = sorted.findIndex((r) => r.id === pendingFocusId.current);
    if (idx === -1) return;
    setSelectedId(sorted[idx].id);
    rowVirtualizer.scrollToIndex(idx, { align: "center" });
    pendingFocusId.current = null;
    onFocusHandled?.();
  }, [sorted, rowVirtualizer, onFocusHandled]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function dueLabel(row: Row) {
    if (row.status === "new") return "—";
    if (row.status === "learning" || row.status === "relearning") return "soon";
    if (row.dueDiff == null) return "—";
    if (row.dueDiff <= 0) return row.dueDiff === 0 ? "today" : `${-row.dueDiff}d overdue`;
    return `in ${row.dueDiff}d`;
  }

  function renderCell(row: Row, key: ColumnKey) {
    switch (key) {
      case "front":
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base leading-none shrink-0 whitespace-nowrap">{row.front}</span>
            <div className="min-w-0 truncate">
              {row.sub && <span className="text-zinc-500 dark:text-zinc-400 mr-1.5">{row.sub}</span>}
              <span className="text-zinc-400 dark:text-zinc-500 text-xs">{row.back}</span>
            </div>
            <AudioButton src={row.audioUrl} label="Play pronunciation" />
          </div>
        );
      case "deck":
        return <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{row.levelLabel ?? DECK_LABELS[row.source]}</span>;
      case "status":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[row.status]}`} />
            {STATUS_LABEL[row.status]}
          </span>
        );
      case "interval":
        return (
          <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
            {row.status === "new" ? "—" : formatInterval(row.interval)}
          </span>
        );
      case "reps":
        return <span className="tabular-nums text-zinc-600 dark:text-zinc-300">{row.reps}</span>;
      case "due":
        return <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{dueLabel(row)}</span>;
      case "rank":
        return <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{row.rank ?? "—"}</span>;
    }
  }

  // The whole cell (not just the label) starts a drag, and a plain click
  // still sorts — see the `active` threshold above for how the two stay
  // independent.
  function HeaderCell({ colKey }: { colKey: ColumnKey }) {
    const align = COLUMN_ALIGN[colKey];
    const isDragging = dragState?.active && dragState.key === colKey;
    return (
      <div
        ref={(el) => {
          if (el) headerRefs.current[colKey] = el;
        }}
        onPointerDown={(e) => startColumnDrag(colKey, e)}
        // Columns reorder live under the cursor as you drag (see the
        // `reorderColumn` call in the pointermove handler), so the dragged
        // header's own slot already shows where it's headed — it just needs
        // to read as "lifted" while the floating label above it tracks the
        // cursor.
        className={`relative px-3 py-2 cursor-grab active:cursor-grabbing select-none touch-none transition-colors ${
          isDragging ? "opacity-30" : ""
        }`}
      >
        <button
          onClick={() => toggleSort(colKey)}
          className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors ${
            align === "right" ? "ml-auto" : ""
          }`}
        >
          {COLUMN_LABELS[colKey]}
          {sortKey === colKey && <span>{sortDir === 1 ? "↑" : "↓"}</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search characters, pinyin, meaning…"
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>
        <ColumnsMenu columns={columns} onToggle={toggleColumn} />
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Mobile filter chips — replaces the sidebar below the lg breakpoint.
          Wraps onto multiple lines rather than scrolling sideways. */}
      <div className="flex lg:hidden flex-wrap items-center gap-1.5 border-b border-zinc-200 dark:border-zinc-800 px-2.5 py-2">
        <FilterChip
          active={deckFilter === "all"}
          onClick={() => {
            setDeckFilter("all");
            setLevelFilter(null);
          }}
          label="All decks"
        />
        {(["hanzi", "hsk3", "random_words", "idioms"] as const).map((k) => (
          <FilterChip
            key={k}
            active={deckFilter === k}
            onClick={() => {
              setDeckFilter(k);
              setLevelFilter(null);
            }}
            label={DECK_LABELS[k]}
          />
        ))}
        <span className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 shrink-0 mx-0.5" />
        {(["new", "learning", "review", "relearning"] as const).map((s) => (
          <FilterChip
            key={s}
            active={statusFilter === s}
            onClick={() => setStatusFilter((cur) => (cur === s ? "all" : s))}
            label={STATUS_LABEL[s]}
            dot={STATUS_DOT[s]}
          />
        ))}
      </div>

      <div className="flex" style={{ height: "min(75vh, 640px)" }}>
        {/* Sidebar (desktop only) */}
        <div className="hidden lg:block w-44 shrink-0 border-r border-zinc-200 dark:border-zinc-800 p-2.5 space-y-4 overflow-y-auto">
          <div className="space-y-0.5">
            <SidebarButton
              active={deckFilter === "all"}
              onClick={() => {
                setDeckFilter("all");
                setLevelFilter(null);
              }}
              label="All decks"
              count={rows.length}
            />
          </div>
          <div>
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">Decks</p>
            <div className="space-y-0.5">
              {(["hanzi", "hsk3", "random_words", "idioms"] as const).map((k) =>
                k === "hsk3" ? (
                  <div key={k}>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => setHsk3Expanded((v) => !v)}
                        aria-label={hsk3Expanded ? "Collapse HSK levels" : "Expand HSK levels"}
                        className="shrink-0 p-1 rounded-md text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className={`w-3.5 h-3.5 transition-transform ${hsk3Expanded ? "rotate-90" : ""}`}
                        >
                          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                        </svg>
                      </button>
                      <div className="flex-1 min-w-0">
                        <SidebarButton
                          active={deckFilter === "hsk3" && !levelFilter}
                          onClick={() => {
                            setDeckFilter("hsk3");
                            setLevelFilter(null);
                          }}
                          label={DECK_LABELS.hsk3}
                          count={deckCounts.hsk3}
                        />
                      </div>
                    </div>
                    {hsk3Expanded && (
                      <div className="pl-3 space-y-0.5 mt-0.5">
                        {LEVELS.map(({ key: levelKey, label }) => (
                          <SidebarButton
                            key={levelKey}
                            active={deckFilter === "hsk3" && levelFilter === levelKey}
                            onClick={() => {
                              setDeckFilter("hsk3");
                              setLevelFilter((cur) => (cur === levelKey ? null : levelKey));
                            }}
                            label={label}
                            count={levelCounts[levelKey] ?? 0}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={k} className="flex items-center gap-0.5">
                    {/* Matches the HSK row's chevron-button width so every
                        label starts at the same x position. */}
                    <span className="shrink-0 w-[22px]" aria-hidden />
                    <div className="flex-1 min-w-0">
                      <SidebarButton
                        active={deckFilter === k}
                        onClick={() => {
                          setDeckFilter(k);
                          setLevelFilter(null);
                        }}
                        label={DECK_LABELS[k]}
                        count={deckCounts[k]}
                      />
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
          <div>
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">Card state</p>
            <div className="space-y-0.5">
              {(["new", "learning", "review", "relearning"] as const).map((s) => (
                <SidebarButton
                  key={s}
                  active={statusFilter === s}
                  onClick={() => setStatusFilter((cur) => (cur === s ? "all" : s))}
                  label={STATUS_LABEL[s]}
                  count={statusCounts[s]}
                  dot={STATUS_DOT[s]}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Virtualized "table" — div/grid rows instead of a native <table>,
            since only the rows scrolled into view get mounted (thousands of
            cards rendered as real <tr>s at once was what made this tab
            lag). Column widths/order are driven by `columns` state, shared
            via `gridTemplate` between the header and every row so they stay
            aligned; header cells are draggable to reorder them. */}
        <div ref={tableRef} className="flex-1 min-w-0 overflow-auto text-sm">
          <div
            className="sticky top-0 z-10 grid bg-zinc-50 dark:bg-zinc-900/95 backdrop-blur border-b border-zinc-200 dark:border-zinc-800"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {visibleColumns.map((key) => (
              <HeaderCell key={key} colKey={key} />
            ))}
          </div>

          {dragState?.active && (
            <div
              className="fixed z-50 pointer-events-none flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300 shadow-lg"
              style={{
                left: dragState.originLeft + dragState.deltaX,
                top: dragState.originTop,
                width: dragState.width,
              }}
            >
              {COLUMN_LABELS[dragState.key]}
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">No cards match.</p>
          ) : (
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const row = sorted[vi.index];
                const isSelected = row.id === selectedId;
                return (
                  <div
                    key={row.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={vi.index}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
                  >
                    <div
                      onClick={() => setSelectedId((cur) => (cur === row.id ? null : row.id))}
                      className={`grid items-center border-b border-zinc-100 dark:border-zinc-800 cursor-pointer transition-colors ${
                        isSelected ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      }`}
                      style={{ gridTemplateColumns: gridTemplate }}
                    >
                      {visibleColumns.map((key) => (
                        <div
                          key={key}
                          className={`px-3 py-2 overflow-hidden ${COLUMN_ALIGN[key] === "right" ? "text-right" : ""}`}
                        >
                          {renderCell(row, key)}
                        </div>
                      ))}
                    </div>
                    {isSelected && (
                      <div className="border-b border-zinc-100 dark:border-zinc-800 px-4 py-4 bg-zinc-50 dark:bg-zinc-800/40">
                        <CardEditor
                          row={row}
                          onSaved={(patch) => setOverrides((o) => ({ ...o, [row.id]: { ...o[row.id], ...patch } }))}
                          onClose={() => setSelectedId(null)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
        {sorted.length} card{sorted.length === 1 ? "" : "s"}
      </div>
      </div>
    </div>
  );
}
