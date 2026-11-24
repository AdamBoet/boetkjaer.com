"use client";

import { useCallback, useEffect, useState } from "react";
import { type WeightEntry } from "./types";
import WeightChart from "./WeightChart";

const kgFormat = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ISO timestamp -> value for <input type="datetime-local"> in local time.
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HealthDashboard({
  initialEntries,
  loadError,
}: {
  initialEntries: WeightEntry[];
  loadError: string | null;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(loadError);
  const [showEntries, setShowEntries] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WeightEntry | null>(null);
  const [editing, setEditing] = useState<{ entry: WeightEntry; weight: string; when: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Re-sync with the database on mount, when the tab regains focus and when
  // the entries list opens, so the page never acts on a stale list.
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/health/weight", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setEntries((json.entries as WeightEntry[]).map(e => ({ ...e, weight_kg: Number(e.weight_kg) })));
    } catch {
      // Offline or similar: keep what we have.
    }
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  useEffect(() => {
    if (showEntries) reload();
  }, [showEntries, reload]);

  useEffect(() => {
    if (!showEntries) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Close the topmost dialog first (confirm / edit), otherwise the list.
      if (confirmDelete) setConfirmDelete(null);
      else if (editing) setEditing(null);
      else setShowEntries(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showEntries, confirmDelete, editing]);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(weight.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a valid weight");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/health/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight_kg: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      const entry = { ...json.entry, weight_kg: Number(json.entry.weight_kg) } as WeightEntry;
      setEntries(prev => [entry, ...prev]);
      setWeight("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: number) {
    const prev = entries;
    setEntries(entries.filter(e => e.id !== id));
    const res = await fetch(`/api/health/weight/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setEntries(prev);
      setError("Failed to delete");
    }
  }

  function startEdit(entry: WeightEntry) {
    setEditError(null);
    setEditing({ entry, weight: kgFormat.format(entry.weight_kg), when: toLocalInput(entry.created_at) });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const value = Number(editing.weight.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setEditError("Enter a valid weight");
      return;
    }
    const when = new Date(editing.when);
    if (Number.isNaN(when.getTime())) {
      setEditError("Enter a valid date and time");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/health/weight/${editing.entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight_kg: value, created_at: when.toISOString() }),
      });
      const json = await res.json();
      if (res.status === 404) {
        // Deleted elsewhere (or in a stale tab): drop it from the list.
        setEditing(null);
        reload();
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      const updated = { ...json.entry, weight_kg: Number(json.entry.weight_kg) } as WeightEntry;
      setEntries(prev =>
        prev
          .map(x => (x.id === updated.id ? updated : x))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      );
      setEditing(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setEditSaving(false);
    }
  }

  const latest = entries[0];

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6); // last 7 days, today included
  const today = entries.find(e => new Date(e.created_at) >= todayStart);
  const weekEntries = entries.filter(e => new Date(e.created_at) >= weekStart);
  const weekAvg = weekEntries.length
    ? weekEntries.reduce((sum, e) => sum + e.weight_kg, 0) / weekEntries.length
    : null;
  // Change vs the 7 days before that (days 7–13 ago).
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevEntries = entries.filter(e => {
    const t = new Date(e.created_at);
    return t >= prevWeekStart && t < weekStart;
  });
  const prevAvg = prevEntries.length
    ? prevEntries.reduce((sum, e) => sum + e.weight_kg, 0) / prevEntries.length
    : null;
  const weekChange = weekAvg != null && prevAvg != null ? weekAvg - prevAvg : null;

  return (
    <div className="max-w-2xl space-y-8">
      <div className="hidden md:block">
        <h1 className="text-2xl font-bold tracking-tight">Weight</h1>
      </div>

      <form
        onSubmit={addEntry}
        className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6 space-y-4"
      >
          <button
            type="button"
            onClick={() => setShowEntries(true)}
            aria-label="All entries"
            title="All entries"
            className="absolute top-3 right-3 rounded-lg p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        <div className="text-center">
          <label htmlFor="weight-input" className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">
            What&apos;s your weight today?
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold">ONLY</span> measure after waking up and pissing
          </p>
        </div>
        <div className="mx-auto flex max-w-[14rem] flex-col gap-3">
          <div className="relative">
            <input
              id="weight-input"
              type="text"
              inputMode="decimal"
              value={weight}
              onChange={e => setWeight(e.target.value.replace(/[^0-9.,]/g, ""))}
              className="block w-full h-12 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-12 text-center text-lg tabular-nums outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
              autoFocus
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-zinc-400 dark:text-zinc-500">kg</span>
          </div>
          <button
            type="submit"
            disabled={saving || !weight.trim()}
            className="h-12 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white px-8 text-base font-medium disabled:opacity-40 transition-opacity"
          >
            {saving ? "Saving…" : "Track"}
          </button>
        </div>
        {error && <p className="text-center text-sm text-red-500 dark:text-red-400">{error}</p>}
      </form>

      {latest && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6">
          <div className="grid grid-cols-2 divide-x divide-zinc-100 dark:divide-zinc-800">
            <div className="text-center px-2">
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">Today</p>
              <p className="text-3xl sm:text-4xl font-bold tabular-nums">
                {today ? `${kgFormat.format(today.weight_kg)} kg` : "—"}
              </p>
            </div>
            <div className="text-center px-2">
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">7-day average</p>
              <p className="text-3xl sm:text-4xl font-bold tabular-nums">
                {weekAvg != null ? `${kgFormat.format(weekAvg)} kg` : "—"}
                {weekChange != null && Math.abs(weekChange) >= 0.05 && (
                  <span
                    className={`ml-2 align-middle text-sm sm:text-base font-semibold ${weekChange > 0 ? "text-green-600 dark:text-green-500" : "text-red-500 dark:text-red-400"}`}
                    title="vs the previous 7 days"
                  >
                    {weekChange > 0 ? "+" : "−"}
                    {kgFormat.format(Math.abs(weekChange))}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {showEntries && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEntries(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="All entries"
            className="relative w-full max-w-md max-h-[80vh] flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="text-sm font-semibold">All entries ({entries.length})</h2>
              <button
                type="button"
                onClick={() => setShowEntries(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {entries.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">No entries yet</p>
            ) : (
              <ul className="overflow-y-auto px-5 divide-y divide-zinc-100 dark:divide-zinc-800">
                {entries.map(entry => {
                  return (
                    <li key={entry.id} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="text-zinc-500 dark:text-zinc-400">{formatDate(entry.created_at)}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-medium tabular-nums">{kgFormat.format(entry.weight_kg)} kg</span>
                        <button
                          type="button"
                          onClick={() => startEdit(entry)}
                          aria-label="Edit entry"
                          className="text-zinc-300 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(entry)}
                          aria-label="Delete entry"
                          className="text-zinc-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        >
                          ✕
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditing(null)} />
          <form
            onSubmit={saveEdit}
            role="dialog"
            aria-modal="true"
            aria-label="Edit entry"
            className="relative w-full max-w-xs rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-5 space-y-4"
          >
            <p className="text-center text-base font-semibold">Edit entry</p>
            <label className="block">
              <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Weight</span>
              <span className="relative block">
                <input
                  type="text"
                  inputMode="decimal"
                  value={editing.weight}
                  onChange={e => setEditing({ ...editing, weight: e.target.value.replace(/[^0-9.,]/g, "") })}
                  className="block w-full h-11 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-3 pr-10 text-base tabular-nums outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                  autoFocus
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-zinc-400 dark:text-zinc-500">kg</span>
              </span>
            </label>
            <label className="block">
              <span className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Date &amp; time</span>
              <input
                type="datetime-local"
                value={editing.when}
                onChange={e => setEditing({ ...editing, when: e.target.value })}
                className="block w-full h-11 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-base outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
              />
            </label>
            {editError && <p className="text-center text-sm text-red-500 dark:text-red-400">{editError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="h-10 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="h-10 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-40 transition-colors"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDelete(null)} />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete entry"
            className="relative w-full max-w-xs rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-5 text-center"
          >
            <p className="text-base font-semibold">Delete this entry?</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {kgFormat.format(confirmDelete.weight_kg)} kg · {formatDate(confirmDelete.created_at)}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="h-10 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { deleteEntry(confirmDelete.id); setConfirmDelete(null); }}
                className="h-10 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {latest && <WeightChart entries={entries} />}
    </div>
  );
}
