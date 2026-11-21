"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";

// Settings button for the sidebar and mobile menu, plus its window:
// personal info, the notification center (every push the phone can get)
// and general options (light/dark, log out). The window is portalled to
// <body>: the desktop sidebar has a CSS transform (slide animation), which
// would otherwise trap a position:fixed window inside the sidebar.

type Field = { id: number; label: string; value: string; secret: boolean };
type Daily = { id: string; title: string; url: string; at_time: string; enabled: boolean };
type HabitSwitch = { id: number; name: string; interval_minutes: number; active: boolean };
type Toggle = { id: string; label: string; enabled: boolean };
type Tab = "personal" | "notifications" | "general";

const input =
  "h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-500";
const subtle =
  "rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors";

// Habit Helper listens for this to refresh its list after a switch changes here.
export const HABITS_CHANGED_EVENT = "habits-changed";

function Switch({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? "bg-blue-900 dark:bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

function formatInterval(minutes: number) {
  if (minutes % 1440 === 0) return minutes === 1440 ? "every day" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} h`;
  return `every ${minutes} min`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json as T;
}

function PersonalTab({ setError }: { setError: (e: string | null) => void }) {
  const [fields, setFields] = useState<Field[] | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [newLabel, setNewLabel] = useState("");
  const [removing, setRemoving] = useState<number | null>(null);

  useEffect(() => {
    api<{ fields: Field[] }>("/api/settings/personal")
      .then(j => setFields(j.fields))
      .catch(e => setError(e.message));
  }, [setError]);

  async function saveValue(field: Field, value: string) {
    if (value.trim() === field.value) return;
    try {
      const { field: updated } = await api<{ field: Field }>(`/api/settings/personal/${field.id}`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      });
      setFields(prev => prev?.map(f => (f.id === updated.id ? updated : f)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    try {
      const { field } = await api<{ field: Field }>("/api/settings/personal", { method: "POST", body: JSON.stringify({ label: newLabel }) });
      setFields(prev => [...(prev ?? []), field]);
      setNewLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    }
  }

  async function removeField(id: number) {
    try {
      await api(`/api/settings/personal/${id}`, { method: "DELETE" });
      setFields(prev => prev?.filter(f => f.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setRemoving(null);
    }
  }

  if (!fields) return <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-3">
      {fields.map(f => {
        const masked = f.secret && !revealed.has(f.id);
        return (
          <div key={f.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor={`pi-${f.id}`} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {f.label}
              </label>
              <div className="flex items-center">
                {f.secret && (
                  <button
                    type="button"
                    className={subtle}
                    onClick={() =>
                      setRevealed(prev => {
                        const next = new Set(prev);
                        if (next.has(f.id)) next.delete(f.id);
                        else next.add(f.id);
                        return next;
                      })
                    }
                  >
                    {masked ? "Show" : "Hide"}
                  </button>
                )}
                {removing === f.id ? (
                  <>
                    <button type="button" className={`${subtle} !text-red-500`} onClick={() => removeField(f.id)}>
                      Confirm
                    </button>
                    <button type="button" className={subtle} onClick={() => setRemoving(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className={subtle} onClick={() => setRemoving(f.id)} aria-label={`Remove ${f.label}`}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            {masked ? (
              <button
                type="button"
                onClick={() => setRevealed(prev => new Set(prev).add(f.id))}
                className={`${input} w-full text-left text-zinc-400 tracking-widest`}
              >
                {f.value ? "••••••-••••" : "—"}
              </button>
            ) : (
              <input
                id={`pi-${f.id}`}
                defaultValue={f.value}
                maxLength={500}
                onBlur={e => saveValue(f, e.target.value)}
                onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className={`${input} w-full`}
              />
            )}
          </div>
        );
      })}
      <form onSubmit={addField} className="flex gap-2 pt-2">
        <input value={newLabel} onChange={e => setNewLabel(e.target.value)} maxLength={60} className={`${input} flex-1`} />
        <button type="submit" disabled={!newLabel.trim()} className={`${subtle} border border-zinc-200 dark:border-zinc-700 disabled:opacity-40`}>
          Add
        </button>
      </form>
    </div>
  );
}

function NotificationsTab({ setError }: { setError: (e: string | null) => void }) {
  const [daily, setDaily] = useState<Daily[] | null>(null);
  const [habits, setHabits] = useState<HabitSwitch[]>([]);
  const [mandarin, setMandarin] = useState<Toggle[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ daily: Daily[]; habits: HabitSwitch[]; mandarin: Toggle[] }>("/api/settings/notifications")
      .then(j => {
        setDaily(j.daily);
        setHabits(j.habits);
        setMandarin(j.mandarin);
      })
      .catch(e => setError(e.message));
  }, [setError]);

  useEffect(load, [load]);

  async function patchDaily(r: Daily, patch: Partial<Pick<Daily, "enabled" | "at_time">>) {
    setBusy(`d${r.id}`);
    try {
      const { reminder } = await api<{ reminder: Daily }>(`/api/settings/daily-reminders/${r.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setDaily(prev => prev?.map(d => (d.id === reminder.id ? reminder : d)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  async function flip(t: Toggle) {
    setBusy(`t${t.id}`);
    try {
      const { toggle } = await api<{ toggle: Toggle }>(`/api/settings/notification-toggles/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !t.enabled }),
      });
      setMandarin(prev => prev.map(x => (x.id === toggle.id ? toggle : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  async function toggleHabit(h: HabitSwitch) {
    setBusy(`h${h.id}`);
    try {
      const { habit } = await api<{ habit: HabitSwitch }>(`/api/habits/${h.id}`, { method: "PATCH", body: JSON.stringify({ active: !h.active }) });
      setHabits(prev => prev.map(x => (x.id === habit.id ? { ...x, active: habit.active } : x)));
      window.dispatchEvent(new Event(HABITS_CHANGED_EVENT));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      load();
    } finally {
      setBusy(null);
    }
  }

  if (!daily) return <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>;

  const group = "rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800";
  const row = "flex items-center gap-3 px-4 py-3";
  const heading = "px-1 mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400";

  return (
    <div className="space-y-6">
      <section>
        <h4 className={heading}>Daily</h4>
        <div className={group}>
          {daily.map(r => (
            <div key={r.id} className={row}>
              <p className={`flex-1 min-w-0 text-sm truncate ${r.enabled ? "" : "text-zinc-400 dark:text-zinc-500"}`}>
                {r.title.replace(/^\S+\s/, "")}
              </p>
              <input
                type="time"
                step={300}
                defaultValue={r.at_time}
                disabled={!r.enabled}
                aria-label={`Time for ${r.title}`}
                onBlur={e => e.target.value && e.target.value !== r.at_time && patchDaily(r, { at_time: e.target.value })}
                className="h-8 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-blue-900/30 disabled:opacity-40 [&::-webkit-calendar-picker-indicator]:hidden"
              />
              <Switch on={r.enabled} label={r.title} disabled={busy === `d${r.id}`} onClick={() => patchDaily(r, { enabled: !r.enabled })} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className={heading}>Habits</h4>
        <div className={group}>
          {habits.length === 0 && <p className={`${row} text-sm text-zinc-400 dark:text-zinc-500`}>No habits yet</p>}
          {habits.map(h => (
            <div key={h.id} className={row}>
              <p className={`flex-1 min-w-0 text-sm truncate ${h.active ? "" : "text-zinc-400 dark:text-zinc-500"}`}>{h.name}</p>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 whitespace-nowrap">{formatInterval(h.interval_minutes)}</span>
              <Switch on={h.active} label={`Notifications for ${h.name}`} disabled={busy === `h${h.id}`} onClick={() => toggleHabit(h)} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className={heading}>Mandarin · 暴实验室 app</h4>
        <div className={group}>
          {mandarin.map(t => (
            <div key={t.id} className={row}>
              <p className={`flex-1 min-w-0 text-sm truncate ${t.enabled ? "" : "text-zinc-400 dark:text-zinc-500"}`}>{t.label}</p>
              <Switch on={t.enabled} label={t.label} disabled={busy === `t${t.id}`} onClick={() => flip(t)} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function GeneralTab() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Dark mode</p>
        <Switch on={dark} label="Dark mode" onClick={() => setTheme(dark ? "light" : "dark")} />
      </div>
      <form action="/api/lab-logout" method="POST">
        <button
          type="submit"
          className="w-full h-10 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          Log out
        </button>
      </form>
    </div>
  );
}

export default function SettingsButton({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("personal");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "personal", label: "Personal" },
    { id: "notifications", label: "Notifications" },
    { id: "general", label: "General" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={className}
      >
        <span className="text-base w-5 text-center">⚙&#xFE0E;</span>
        Settings
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="relative w-full max-w-2xl h-[min(85vh,640px)] flex flex-col sm:flex-row overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl text-zinc-900 dark:text-zinc-100"
          >
            {/* Tabs: a column on the left; a row on top on narrow phones. */}
            <nav className="shrink-0 sm:w-44 border-b sm:border-b-0 sm:border-r border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 p-3 sm:p-4">
              <h2 className="hidden sm:block text-base font-semibold px-2 mb-4">Settings</h2>
              <div className="flex sm:flex-col gap-1 pr-10 sm:pr-0">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setError(null);
                      setTab(t.id);
                    }}
                    className={`rounded-lg px-3 py-2 text-sm text-left transition-colors ${
                      tab === t.id
                        ? "bg-white dark:bg-zinc-800 shadow-sm font-medium"
                        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </nav>
            <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
              <h3 className="text-base font-semibold mb-4 hidden sm:block">{tabs.find(t => t.id === tab)?.label}</h3>
              {tab === "personal" && <PersonalTab setError={setError} />}
              {tab === "notifications" && <NotificationsTab setError={setError} />}
              {tab === "general" && <GeneralTab />}
              {error && <p className="mt-3 text-sm text-red-500 dark:text-red-400">{error}</p>}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute top-3 right-3 rounded-lg p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
