"use client";

import { useCallback, useEffect, useState } from "react";
import { type HabitRow } from "@/lib/habits";
import { enablePush, isStandalone, pushSupported } from "@/lib/push-client";

type Unit = "min" | "h" | "d";
const UNIT_MINUTES: Record<Unit, number> = { min: 1, h: 60, d: 1440 };

const card = "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none";
const input =
  "h-10 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-500";
const smallBtn =
  "rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40";

function formatInterval(minutes: number) {
  if (minutes % 1440 === 0) return minutes === 1440 ? "every day" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} h`;
  return `every ${minutes} min`;
}

// 120 -> { amount: "2", unit: "h" }, for prefilling the edit form.
function splitInterval(minutes: number): { amount: string; unit: Unit } {
  if (minutes % 1440 === 0) return { amount: String(minutes / 1440), unit: "d" };
  if (minutes % 60 === 0) return { amount: String(minutes / 60), unit: "h" };
  return { amount: String(minutes), unit: "min" };
}

type EditState = {
  habit: HabitRow;
  name: string;
  amount: string;
  unit: Unit;
  useQuiet: boolean;
  quietStart: string;
  quietEnd: string;
};

function formatNext(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString("en-GB", sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function HabitDashboard({ initialHabits, loadError }: { initialHabits: HabitRow[]; loadError: string | null }) {
  const [habits, setHabits] = useState(initialHabits);
  const [error, setError] = useState<string | null>(loadError);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<Unit>("h");
  const [useQuiet, setUseQuiet] = useState(true);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<HabitRow | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/habits", { cache: "no-store" });
      if (res.ok) setHabits((await res.json()).habits);
    } catch {
      // Offline: keep what we have.
    }
  }, []);

  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  // In the home-screen app, the first tap on Add or Send test asks iOS for
  // notification permission (it only allows asking from a tap).
  async function askForNotificationsOnce() {
    if (!pushSupported() || !isStandalone() || Notification.permission !== "default") return;
    try {
      await enablePush();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't enable notifications");
    }
  }

  async function addHabit(e: React.FormEvent) {
    e.preventDefault();
    await askForNotificationsOnce();
    const interval = Math.round(Number(amount.replace(",", ".")) * UNIT_MINUTES[unit]);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          interval_minutes: interval,
          quiet_start: useQuiet ? quietStart : "",
          quiet_end: useQuiet ? quietEnd : "",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setHabits(prev => [...prev, json.habit]);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(habit: HabitRow) {
    const res = await fetch(`/api/habits/${habit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !habit.active }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Failed to update");
      if (res.status === 404) reload();
      return;
    }
    setHabits(prev => prev.map(h => (h.id === habit.id ? json.habit : h)));
  }

  async function deleteHabit(id: number) {
    const prev = habits;
    setHabits(habits.filter(h => h.id !== id));
    setConfirmDelete(null);
    const res = await fetch(`/api/habits/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setHabits(prev);
      setError("Failed to delete");
    }
  }

  useEffect(() => {
    if (!editing && !confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmDelete) setConfirmDelete(null);
      else setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, confirmDelete]);

  function startEdit(habit: HabitRow) {
    setEditError(null);
    setNotice(null);
    setEditing({
      habit,
      name: habit.name,
      ...splitInterval(habit.interval_minutes),
      useQuiet: !!habit.quiet_start,
      quietStart: habit.quiet_start?.slice(0, 5) ?? "22:00",
      quietEnd: habit.quiet_end?.slice(0, 5) ?? "08:00",
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const interval = Math.round(Number(editing.amount.replace(",", ".")) * UNIT_MINUTES[editing.unit]);
    const body: Record<string, unknown> = {
      name: editing.name,
      quiet_start: editing.useQuiet ? editing.quietStart : "",
      quiet_end: editing.useQuiet ? editing.quietEnd : "",
    };
    // Only send the interval when it changed: a new interval restarts the countdown.
    if (interval !== editing.habit.interval_minutes) body.interval_minutes = interval;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/habits/${editing.habit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status === 404) {
        setEditing(null);
        reload();
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setHabits(prev => prev.map(h => (h.id === json.habit.id ? json.habit : h)));
      setEditing(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setEditSaving(false);
    }
  }

  async function testHabit(id: number) {
    setTesting(id);
    setNotice(null);
    await askForNotificationsOnce();
    try {
      const res = await fetch(`/api/habits/${id}/test`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Test failed");
      setNotice(json.sent ? `Sent to ${json.sent} device${json.sent === 1 ? "" : "s"}` : "No phone gets habit notifications yet. Open Habits in the Bøtkjær Labs home-screen app and tap Test there.");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="hidden md:block">
        <h1 className="text-2xl font-bold tracking-tight">Habit Helper</h1>
      </div>

      <form onSubmit={addHabit} className={`${card} p-6 space-y-4`}>
        <h2 className="text-base font-semibold">New habit</h2>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Drink water"
          maxLength={100}
          className={`${input} w-full`}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Remind me every</span>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
            inputMode="decimal"
            className={`${input} w-16 text-center tabular-nums`}
          />
          <select value={unit} onChange={e => setUnit(e.target.value as Unit)} className={input}>
            <option value="min">minutes</option>
            <option value="h">hours</option>
            <option value="d">days</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <input type="checkbox" checked={useQuiet} onChange={e => setUseQuiet(e.target.checked)} />
            Quiet hours
          </label>
          {useQuiet && (
            <>
              <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} className={input} />
              <span className="text-zinc-400">to</span>
              <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} className={input} />
            </>
          )}
        </div>
        <button
          type="submit"
          disabled={saving || !name.trim() || !amount}
          className="h-10 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white px-6 text-sm font-medium disabled:opacity-40 transition-opacity"
        >
          {saving ? "Saving…" : "Add habit"}
        </button>
        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
      </form>

      <div className={`${card} divide-y divide-zinc-100 dark:divide-zinc-800`}>
        {habits.length === 0 && <p className="p-6 text-sm text-zinc-400 dark:text-zinc-500 text-center">No habits yet.</p>}
        {habits.map(h => (
          <div key={h.id} className="p-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className={`font-medium truncate ${h.active ? "" : "text-zinc-400 dark:text-zinc-500"}`}>{h.name}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {formatInterval(h.interval_minutes)}
                {h.quiet_start && h.quiet_end && ` · quiet ${h.quiet_start.slice(0, 5)}–${h.quiet_end.slice(0, 5)}`}
                {h.active ? ` · next ${formatNext(h.next_due_at)}` : " · notifications off"}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={h.active}
              aria-label={`Notifications for ${h.name}`}
              title={h.active ? "Notifications on" : "Notifications off"}
              onClick={() => toggleActive(h)}
              className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={h.active ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}>
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                {!h.active && <line x1="3" y1="3" x2="21" y2="21" />}
              </svg>
              <span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${h.active ? "bg-blue-900 dark:bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${h.active ? "translate-x-4" : ""}`} />
              </span>
            </button>
            <button onClick={() => startEdit(h)} className={smallBtn}>
              Edit
            </button>
            <button onClick={() => setConfirmDelete(h)} className={`${smallBtn} hover:!text-red-500`}>
              Delete
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditing(null)} />
          <form
            onSubmit={saveEdit}
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${editing.habit.name}`}
            className={`${card} relative w-full max-w-md p-5 space-y-4 shadow-xl`}
          >
            <h2 className="text-base font-semibold">Edit habit</h2>
            <input
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              maxLength={100}
              className={`${input} w-full`}
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Remind me every</span>
              <input
                value={editing.amount}
                onChange={e => setEditing({ ...editing, amount: e.target.value.replace(/[^0-9.,]/g, "") })}
                inputMode="decimal"
                className={`${input} w-16 text-center tabular-nums`}
              />
              <select value={editing.unit} onChange={e => setEditing({ ...editing, unit: e.target.value as Unit })} className={input}>
                <option value="min">minutes</option>
                <option value="h">hours</option>
                <option value="d">days</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                <input type="checkbox" checked={editing.useQuiet} onChange={e => setEditing({ ...editing, useQuiet: e.target.checked })} />
                Quiet hours
              </label>
              {editing.useQuiet && (
                <>
                  <input type="time" value={editing.quietStart} onChange={e => setEditing({ ...editing, quietStart: e.target.value })} className={input} />
                  <span className="text-zinc-400">to</span>
                  <input type="time" value={editing.quietEnd} onChange={e => setEditing({ ...editing, quietEnd: e.target.value })} className={input} />
                </>
              )}
            </div>
            {editError && <p className="text-sm text-red-500 dark:text-red-400">{editError}</p>}
            {notice && <p className="text-sm text-zinc-500 dark:text-zinc-400">{notice}</p>}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => testHabit(editing.habit.id)}
                disabled={testing === editing.habit.id}
                className={`${smallBtn} border border-zinc-200 dark:border-zinc-700`}
              >
                {testing === editing.habit.id ? "Sending…" : "Send test notification"}
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing(null)} className={smallBtn}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSaving || !editing.name.trim() || !editing.amount}
                  className="rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white px-4 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  {editSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDelete(null)} />
          <div role="dialog" aria-modal="true" className={`${card} relative w-full max-w-sm p-5 space-y-3 shadow-xl`}>
            <p className="font-medium">Delete &ldquo;{confirmDelete.name}&rdquo;?</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Its reminders stop right away.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setConfirmDelete(null)} className={smallBtn}>
                Cancel
              </button>
              <button
                onClick={() => deleteHabit(confirmDelete.id)}
                className="rounded-lg bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 text-sm font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
