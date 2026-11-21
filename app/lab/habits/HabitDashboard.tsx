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

  // In the home-screen app, the first tap on Add or Test asks iOS for
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
      setError(err instanceof Error ? err.message : "Test failed");
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
          <div key={h.id} className={`p-4 flex items-center gap-3 ${h.active ? "" : "opacity-50"}`}>
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{h.name}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {formatInterval(h.interval_minutes)}
                {h.quiet_start && h.quiet_end && ` · quiet ${h.quiet_start.slice(0, 5)}–${h.quiet_end.slice(0, 5)}`}
                {h.active ? ` · next ${formatNext(h.next_due_at)}` : " · paused"}
              </p>
            </div>
            <button onClick={() => testHabit(h.id)} disabled={testing === h.id} className={smallBtn}>
              {testing === h.id ? "…" : "Test"}
            </button>
            <button onClick={() => toggleActive(h)} className={smallBtn}>
              {h.active ? "Pause" : "Resume"}
            </button>
            <button onClick={() => setConfirmDelete(h)} className={`${smallBtn} hover:!text-red-500`}>
              Delete
            </button>
          </div>
        ))}
      </div>
      {notice && <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center">{notice}</p>}

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
