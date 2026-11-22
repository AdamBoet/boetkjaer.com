"use client";

import { useCallback, useEffect, useState } from "react";

// Bank connection card on the Economy page: connect Danske Bank / Revolut
// (Enable Banking login), per-account include switch, sync status and
// "Sync now". Transactions are imported by lib/bank-sync.ts.

type Account = {
  id: number;
  iban: string;
  name: string | null;
  currency: string | null;
  aspsp_name: string;
  included: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  connection: { valid_until: string } | null;
};

const BANKS = ["Danske Bank", "Revolut"] as const;

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function daysLeft(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000);
}

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-blue-900 dark:bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

export default function BankPanel() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/economy/bank", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setAccounts(json.accounts);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Failed to load", error: true });
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    load();
    // Result of the bank redirect (/api/economy/bank/callback).
    const q = new URLSearchParams(window.location.search);
    if (q.get("bank") === "connected") setMessage({ text: `Connected — imported ${q.get("imported") ?? 0} transactions` });
    if (q.get("bank_error")) setMessage({ text: q.get("bank_error")!, error: true });
    if (q.has("bank") || q.has("bank_error")) window.history.replaceState(null, "", window.location.pathname);
  }, [load]);

  async function connect(aspsp: string) {
    setBusy(aspsp);
    setMessage(null);
    try {
      const res = await fetch("/api/economy/bank/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspsp }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start bank login");
      window.location.href = json.url;
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Could not start bank login", error: true });
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    setMessage(null);
    try {
      const res = await fetch("/api/economy/bank/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      const results = json.results as { imported: number; error?: string }[];
      const imported = results.reduce((s, r) => s + r.imported, 0);
      const failed = results.filter(r => r.error);
      if (imported > 0) {
        window.location.reload();
        return;
      }
      setMessage(failed.length ? { text: failed[0].error!, error: true } : { text: "Up to date — no new transactions" });
      load();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Sync failed", error: true });
    } finally {
      setBusy(null);
    }
  }

  async function toggle(a: Account) {
    setAccounts(prev => prev?.map(x => (x.id === a.id ? { ...x, included: !a.included } : x)) ?? null);
    const res = await fetch(`/api/economy/bank/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ included: !a.included }),
    });
    if (!res.ok) {
      setMessage({ text: "Failed to update account", error: true });
      load();
    }
  }

  const connectedBanks = new Set(
    (accounts ?? []).filter(a => a.connection && daysLeft(a.connection.valid_until) > 0).map(a => a.aspsp_name)
  );

  return (
    <section className="order-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Bank accounts</h2>
        {!!accounts?.length && (
          <button
            type="button"
            onClick={syncNow}
            disabled={!!busy}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>

      {accounts === null && <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>}

      {!!accounts?.length && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
          {accounts.map(a => {
            const left = a.connection ? daysLeft(a.connection.valid_until) : 0;
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${a.included ? "" : "text-zinc-400 dark:text-zinc-500"}`}>
                    {a.aspsp_name}
                    {a.name && <span className="text-zinc-400 dark:text-zinc-500"> · {a.name}</span>}
                    <span className="text-zinc-400 dark:text-zinc-500"> · …{a.iban.slice(-4)}</span>
                  </p>
                  <p className={`text-xs ${a.last_error || left <= 7 ? "text-amber-600 dark:text-amber-500" : "text-zinc-400 dark:text-zinc-500"}`}>
                    {a.last_error
                      ? a.last_error
                      : left <= 0
                        ? "Access expired — reconnect"
                        : `${a.last_synced_at ? `Synced ${ago(a.last_synced_at)}` : "Not synced yet"} · access ${left} d left`}
                  </p>
                </div>
                <Switch on={a.included} label={`Import ${a.aspsp_name} …${a.iban.slice(-4)}`} onClick={() => toggle(a)} />
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {BANKS.map(b => (
          <button
            key={b}
            type="button"
            onClick={() => connect(b)}
            disabled={!!busy}
            className="rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {busy === b ? "Opening…" : `${connectedBanks.has(b) ? "Reconnect" : "Connect"} ${b}`}
          </button>
        ))}
      </div>

      {message && <p className={`text-sm ${message.error ? "text-red-500 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>{message.text}</p>}
    </section>
  );
}
