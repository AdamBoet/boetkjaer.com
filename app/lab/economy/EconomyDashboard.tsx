"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { type Transaction, type RecurringItem, type Category, type EntryType } from "./types";

const numberFormat = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmt(amount: number) {
  return `${numberFormat.format(amount)} kr`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatShortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function currentMonthKeyNow() {
  return todayISO().slice(0, 7);
}

function shiftMonthKey(monthKey: string, delta: number) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyLabel(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function toneClass(type: EntryType) {
  return type === "expense" ? "text-red-500 dark:text-red-400" : "text-emerald-700 dark:text-emerald-500";
}

const CATEGORY_COLOR_CLASSES = [
  "text-[#2a78d6] dark:text-[#3987e5]",
  "text-[#1baf7a] dark:text-[#199e70]",
  "text-[#eda100] dark:text-[#c98500]",
  "text-[#008300] dark:text-[#008300]",
  "text-[#4a3aa7] dark:text-[#9085e9]",
  "text-[#e34948] dark:text-[#e66767]",
];
const OTHER_COLOR_CLASS = "text-zinc-400 dark:text-zinc-500";
const MAX_DONUT_SLICES = 6;

type DonutSegment = { name: string; value: number; pct: number; colorClass: string };

function CategoryDonut({ segments, centerLabel }: { segments: DonutSegment[]; centerLabel: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);

  if (segments.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <p className="text-sm text-zinc-400 dark:text-zinc-500">No spending logged yet.</p>
      </div>
    );
  }

  const r = 40;
  const circumference = 2 * Math.PI * r;
  const gap = 2.5;
  let cumulative = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
      <div className="relative w-32 h-32 shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {segments.map(seg => {
            const segLen = total > 0 ? (seg.value / total) * circumference : 0;
            const dash = Math.max(segLen - gap, 0);
            const offset = -cumulative;
            cumulative += segLen;
            return (
              <circle
                key={seg.name}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth="14"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={offset}
                className={seg.colorClass}
              >
                <title>{`${seg.name}: ${fmt(seg.value)} (${seg.pct}%)`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Spending</span>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{centerLabel}</span>
        </div>
      </div>
      <div className="w-full sm:w-80 sm:shrink-0 space-y-1.5">
        {segments.map(seg => (
          <div key={seg.name} className="flex items-center gap-2 text-xs">
            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 bg-current ${seg.colorClass}`} />
            <span className="flex-1 min-w-0 truncate text-zinc-600 dark:text-zinc-300">{seg.name}</span>
            <span className="shrink-0 whitespace-nowrap text-zinc-400 dark:text-zinc-500 tabular-nums">
              {fmt(seg.value)} · {seg.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function sortByName<T extends { name: string }>(list: T[]) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function TypeToggle({ value, onChange }: { value: EntryType; onChange: (t: EntryType) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(value === "expense" ? "income" : "expense")}
      className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden text-sm"
    >
      <span
        className={`px-3 py-1.5 transition-colors ${
          value === "expense" ? "bg-red-400 text-white" : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        Expense
      </span>
      <span
        className={`px-3 py-1.5 transition-colors ${
          value === "income" ? "bg-emerald-700 text-white" : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        Income
      </span>
    </button>
  );
}

function AmountInput({
  value,
  onChange,
  placeholder,
  dense = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  dense?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
          dense ? "pl-2 pr-7 py-1" : "pl-3 pr-8 py-1.5"
        }`}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 dark:text-zinc-500">
        kr
      </span>
    </div>
  );
}

export default function EconomyDashboard({
  initialTransactions,
  initialRecurring,
  initialCategories,
}: {
  initialTransactions: Transaction[];
  initialRecurring: RecurringItem[];
  initialCategories: Category[];
}) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [recurring, setRecurring] = useState(initialRecurring);
  const [categories, setCategories] = useState(initialCategories);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKeyNow());

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  const [txCategory, setTxCategory] = useState(
    initialCategories.find(c => c.name === "Groceries")?.name ?? initialCategories[0]?.name ?? ""
  );
  const [txAmount, setTxAmount] = useState("");
  const [txMerchant, setTxMerchant] = useState("");
  const [txType, setTxType] = useState<EntryType>("expense");
  const [txSubmitting, setTxSubmitting] = useState(false);

  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [editTxCategory, setEditTxCategory] = useState("");
  const [editTxAmount, setEditTxAmount] = useState("");
  const [editTxMerchant, setEditTxMerchant] = useState("");
  const [editTxType, setEditTxType] = useState<EntryType>("expense");
  const [editTxSubmitting, setEditTxSubmitting] = useState(false);

  useEffect(() => {
    if (!txCategory && categories.length > 0) {
      setTxCategory(categories[0].name);
    }
  }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const [recName, setRecName] = useState("");
  const [recAmount, setRecAmount] = useState("");
  const [recType, setRecType] = useState<EntryType>("expense");
  const [recCategory, setRecCategory] = useState("");
  const [recSubmitting, setRecSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [catName, setCatName] = useState("");
  const [catSubmitting, setCatSubmitting] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");
  const [editCategorySubmitting, setEditCategorySubmitting] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const sortedRecurring = [...recurring].sort((a, b) =>
    a.type !== b.type ? (a.type === "expense" ? -1 : 1) : b.amount - a.amount
  );

  const currentMonthTransactions = transactions.filter(t => t.occurred_on.startsWith(selectedMonth));
  const currentMonthLabel = monthKeyLabel(selectedMonth);
  const isCurrentMonth = selectedMonth === currentMonthKeyNow();
  const sortedCurrentMonthTransactions = [...currentMonthTransactions].sort((a, b) =>
    a.occurred_on === b.occurred_on ? b.id - a.id : b.occurred_on.localeCompare(a.occurred_on)
  );

  const totalSpending = currentMonthTransactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const totalEarnings = currentMonthTransactions.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const net = totalEarnings - totalSpending;

  function categoryOf(t: Transaction): string {
    if (t.recurring_item_id != null) {
      const item = recurring.find(r => r.id === t.recurring_item_id);
      return item?.category?.trim() || "Uncategorized";
    }
    return t.description;
  }

  const categoryTotals = new Map<string, number>();
  currentMonthTransactions
    .filter(t => t.type === "expense")
    .forEach(t => {
      const cat = categoryOf(t);
      categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + t.amount);
    });

  const sortedCategoryEntries = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);
  const topCategoryEntries = sortedCategoryEntries.slice(0, MAX_DONUT_SLICES);
  const otherCategoryTotal = sortedCategoryEntries.slice(MAX_DONUT_SLICES).reduce((s, [, v]) => s + v, 0);

  const donutSegments: DonutSegment[] = topCategoryEntries.map(([name, value], i) => ({
    name,
    value,
    pct: totalSpending > 0 ? Math.round((value / totalSpending) * 100) : 0,
    colorClass: CATEGORY_COLOR_CLASSES[i],
  }));
  if (otherCategoryTotal > 0) {
    donutSegments.push({
      name: "Other",
      value: otherCategoryTotal,
      pct: totalSpending > 0 ? Math.round((otherCategoryTotal / totalSpending) * 100) : 0,
      colorClass: OTHER_COLOR_CLASS,
    });
  }

  function sortTransactions(list: Transaction[]) {
    return [...list].sort((a, b) =>
      a.occurred_on === b.occurred_on ? b.id - a.id : b.occurred_on.localeCompare(a.occurred_on)
    );
  }

  async function addTransaction(e: FormEvent) {
    e.preventDefault();
    const amount = parseFloat(txAmount);
    if (!txCategory || !Number.isFinite(amount) || amount <= 0) {
      setError("Choose a category and enter a positive amount");
      return;
    }
    setTxSubmitting(true);
    try {
      const res = await fetch("/api/economy/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: txCategory,
          merchant: txMerchant.trim() || null,
          amount,
          type: txType,
          occurred_on: todayISO(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add transaction");
      setTransactions(prev => sortTransactions([...prev, data.transaction]));
      setTxAmount("");
      setTxMerchant("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add transaction");
    } finally {
      setTxSubmitting(false);
    }
  }

  async function deleteTransaction(id: number) {
    const prev = transactions;
    setTransactions(prev.filter(t => t.id !== id));
    const res = await fetch(`/api/economy/transactions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setTransactions(prev);
      setError("Failed to delete transaction");
    }
  }

  function startEditTx(t: Transaction) {
    setEditingTxId(t.id);
    setEditTxCategory(t.description);
    setEditTxAmount(String(t.amount));
    setEditTxMerchant(t.merchant ?? "");
    setEditTxType(t.type);
  }

  async function saveEditTx(id: number) {
    const amount = parseFloat(editTxAmount);
    if (!editTxCategory || !Number.isFinite(amount) || amount <= 0) {
      setError("Choose a category and enter a positive amount");
      return;
    }
    setEditTxSubmitting(true);
    try {
      const res = await fetch(`/api/economy/transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: editTxCategory,
          merchant: editTxMerchant.trim() || null,
          amount,
          type: editTxType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update transaction");
      setTransactions(prev => sortTransactions(prev.map(t => (t.id === id ? data.transaction : t))));
      setEditingTxId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update transaction");
    } finally {
      setEditTxSubmitting(false);
    }
  }

  async function addRecurring(e: FormEvent) {
    e.preventDefault();
    const amount = parseFloat(recAmount);
    if (!recName.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError("Enter a name and a positive amount");
      return;
    }
    setRecSubmitting(true);
    try {
      const res = await fetch("/api/economy/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: recName.trim(), amount, type: recType, category: recCategory || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add item");
      setRecurring(prev => [...prev, data.item]);
      if (data.transactions?.length) {
        setTransactions(prev => sortTransactions([...prev, ...data.transactions]));
      }
      setRecName("");
      setRecAmount("");
      setShowAddRecurring(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item");
    } finally {
      setRecSubmitting(false);
    }
  }

  function startEdit(item: RecurringItem) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditAmount(String(item.amount));
    setEditCategory(item.category ?? "");
  }

  async function saveEdit(id: number) {
    const amount = parseFloat(editAmount);
    if (!editName.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError("Enter a name and a positive amount");
      return;
    }
    setEditSubmitting(true);
    try {
      const res = await fetch(`/api/economy/recurring/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), amount, category: editCategory || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update item");
      setRecurring(prev => prev.map(r => (r.id === id ? data.item : r)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update item");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function deleteRecurring(id: number) {
    const prev = recurring;
    setRecurring(prev.filter(r => r.id !== id));
    const res = await fetch(`/api/economy/recurring/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setRecurring(prev);
      setError("Failed to delete item");
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (!catName.trim()) {
      setError("Enter a category name");
      return;
    }
    setCatSubmitting(true);
    try {
      const res = await fetch("/api/economy/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: catName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add category");
      setCategories(prev => sortByName([...prev, data.category]));
      setCatName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add category");
    } finally {
      setCatSubmitting(false);
    }
  }

  function startEditCategory(cat: Category) {
    setEditingCategoryId(cat.id);
    setEditCategoryName(cat.name);
  }

  async function saveEditCategory(id: number) {
    if (!editCategoryName.trim()) {
      setError("Enter a category name");
      return;
    }
    setEditCategorySubmitting(true);
    try {
      const res = await fetch(`/api/economy/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editCategoryName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update category");
      setCategories(prev => sortByName(prev.map(c => (c.id === id ? data.category : c))));
      setEditingCategoryId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update category");
    } finally {
      setEditCategorySubmitting(false);
    }
  }

  async function deleteCategory(id: number) {
    const prev = categories;
    setCategories(prev.filter(c => c.id !== id));
    const res = await fetch(`/api/economy/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setCategories(prev);
      setError("Failed to delete category");
    }
  }

  return (
    <div className="max-w-5xl flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Economy</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSelectedMonth(m => shiftMonthKey(m, -1))}
            aria-label="Previous month"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300 w-32 text-center">
            {currentMonthLabel}
          </span>
          <button
            type="button"
            onClick={() => setSelectedMonth(m => shiftMonthKey(m, 1))}
            disabled={isCurrentMonth}
            aria-label="Next month"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            ›
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-sm px-4 py-2">
          {error}
        </div>
      )}

      <div className="order-2 sm:order-1 grid grid-cols-1 sm:grid-cols-[1fr_1.3fr] gap-3">
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6">
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">Net</p>
          <p className={`text-5xl font-bold ${net < 0 ? "text-red-500 dark:text-red-400" : "text-emerald-700 dark:text-emerald-500"}`}>
            {fmt(net)}
          </p>
          <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Total earnings</span>
              <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-500">{fmt(totalEarnings)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Total spending</span>
              <span className="font-medium tabular-nums text-red-500 dark:text-red-400">{fmt(totalSpending)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6 flex flex-col">
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-3">Spending by category</p>
          <CategoryDonut segments={donutSegments} centerLabel={fmt(totalSpending)} />
        </div>
      </div>

      <section className="order-1 sm:order-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Add entry</h2>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              title="Settings"
              aria-label="Settings"
              className="p-1.5 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <GearIcon />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg py-1 z-20">
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(true);
                    setShowAddRecurring(false);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Fixed payments
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCategoriesOpen(true);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Categories
                </button>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={addTransaction} className="flex flex-wrap items-end gap-2">
          <div className="w-24">
            <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">Amount</label>
            <AmountInput value={txAmount} onChange={setTxAmount} />
          </div>
          <div className="flex-1 min-w-[8rem]">
            <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">Category</label>
            {categories.length === 0 ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500 py-1.5">Add a category in settings first</p>
            ) : (
              <select
                value={txCategory}
                onChange={e => setTxCategory(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-1.5 text-sm"
              >
                {categories.map(c => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex-1 min-w-[8rem]">
            <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">Merchant (optional)</label>
            <input
              type="text"
              value={txMerchant}
              onChange={e => setTxMerchant(e.target.value)}
              placeholder="Netto, Jacob, ..."
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-1.5 text-sm"
            />
          </div>
          <TypeToggle value={txType} onChange={setTxType} />
          <button
            type="submit"
            disabled={txSubmitting || categories.length === 0}
            className="rounded-lg px-3 py-1.5 text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {txSubmitting ? "Adding…" : "Add"}
          </button>
        </form>
      </section>

      <section className="order-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6 space-y-4">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Transactions</h2>

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {sortedCurrentMonthTransactions.length === 0 && (
            <p className="text-sm text-zinc-400 dark:text-zinc-500 py-3">No transactions logged yet.</p>
          )}
          {sortedCurrentMonthTransactions.map(t =>
            editingTxId === t.id ? (
              <div key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <select
                  value={editTxCategory}
                  onChange={e => setEditTxCategory(e.target.value)}
                  className="flex-1 min-w-[7rem] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1 text-sm"
                >
                  {categories.map(c => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="w-24">
                  <AmountInput value={editTxAmount} onChange={setEditTxAmount} dense />
                </div>
                <input
                  type="text"
                  value={editTxMerchant}
                  onChange={e => setEditTxMerchant(e.target.value)}
                  placeholder="Merchant"
                  className="flex-1 min-w-[6rem] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1 text-sm"
                />
                <TypeToggle value={editTxType} onChange={setEditTxType} />
                <button
                  onClick={() => saveEditTx(t.id)}
                  disabled={editTxSubmitting}
                  className="text-xs font-medium text-emerald-700 dark:text-emerald-500 hover:opacity-80 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingTxId(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div key={t.id} className="flex items-center gap-3 py-2.5">
                <span className="w-16 text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                  {formatShortDate(t.occurred_on)}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm text-zinc-700 dark:text-zinc-300">
                  {t.description}
                  {t.merchant && <span className="text-zinc-400 dark:text-zinc-500"> · {t.merchant}</span>}
                </span>
                <span className={`text-sm font-medium tabular-nums ${toneClass(t.type)}`}>
                  {t.type === "expense" ? "−" : "+"}
                  {fmt(t.amount)}
                </span>
                <button
                  onClick={() => startEditTx(t)}
                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  Edit
                </button>
                <button onClick={() => deleteTransaction(t.id)} className="text-xs text-zinc-400 hover:text-red-500">
                  ×
                </button>
              </div>
            )
          )}
        </div>
      </section>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSettingsOpen(false)} />
          <div className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Fixed monthly payments</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close"
                className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 text-lg leading-none transition-colors"
              >
                ×
              </button>
            </div>

            {showAddRecurring ? (
              <form onSubmit={addRecurring} className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[8rem]">
                  <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">Name</label>
                  <input
                    value={recName}
                    onChange={e => setRecName(e.target.value)}
                    placeholder="Netflix"
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="w-24">
                  <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">Amount</label>
                  <AmountInput value={recAmount} onChange={setRecAmount} placeholder="84.5" />
                </div>
                <div className="w-32">
                  <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">Category</label>
                  <select
                    value={recCategory}
                    onChange={e => setRecCategory(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-1.5 text-sm"
                  >
                    <option value="">None</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <TypeToggle value={recType} onChange={setRecType} />
                <button
                  type="submit"
                  disabled={recSubmitting}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {recSubmitting ? "Adding…" : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddRecurring(false)}
                  className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddRecurring(true)}
                className="text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              >
                + Add fixed payment
              </button>
            )}

            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {recurring.length === 0 && (
                <p className="text-sm text-zinc-400 dark:text-zinc-500 py-3">No fixed items yet.</p>
              )}
              {sortedRecurring.map(item => (
                <div key={item.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  {editingId === item.id ? (
                    <>
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1 text-sm"
                      />
                      <div className="w-24">
                        <AmountInput value={editAmount} onChange={setEditAmount} dense />
                      </div>
                      <select
                        value={editCategory}
                        onChange={e => setEditCategory(e.target.value)}
                        className="w-28 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1 text-sm"
                      >
                        <option value="">None</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => saveEdit(item.id)}
                        disabled={editSubmitting}
                        className="text-xs font-medium text-emerald-700 dark:text-emerald-500 hover:opacity-80 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 min-w-0 truncate text-sm text-zinc-700 dark:text-zinc-300">
                        {item.name}
                        {item.category && (
                          <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{item.category}</span>
                        )}
                      </span>
                      <span className={`text-sm font-medium tabular-nums ${toneClass(item.type)}`}>
                        {item.type === "expense" ? "−" : "+"}
                        {fmt(item.amount)}
                      </span>
                      <button
                        onClick={() => startEdit(item)}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        Edit
                      </button>
                      <button onClick={() => deleteRecurring(item.id)} className="text-xs text-zinc-400 hover:text-red-500">
                        ×
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {categoriesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCategoriesOpen(false)} />
          <div className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Categories</h2>
              <button
                type="button"
                onClick={() => setCategoriesOpen(false)}
                aria-label="Close"
                className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 text-lg leading-none transition-colors"
              >
                ×
              </button>
            </div>

            <form onSubmit={addCategory} className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[8rem]">
                <label className="block text-xs text-zinc-400 dark:text-zinc-500 mb-1">Name</label>
                <input
                  value={catName}
                  onChange={e => setCatName(e.target.value)}
                  placeholder="Groceries"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-1.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={catSubmitting}
                className="rounded-lg px-3 py-1.5 text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {catSubmitting ? "Adding…" : "Add"}
              </button>
            </form>

            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {categories.length === 0 && (
                <p className="text-sm text-zinc-400 dark:text-zinc-500 py-3">No categories yet.</p>
              )}
              {categories.map(cat => (
                <div key={cat.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  {editingCategoryId === cat.id ? (
                    <>
                      <input
                        value={editCategoryName}
                        onChange={e => setEditCategoryName(e.target.value)}
                        className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() => saveEditCategory(cat.id)}
                        disabled={editCategorySubmitting}
                        className="text-xs font-medium text-emerald-700 dark:text-emerald-500 hover:opacity-80 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingCategoryId(null)}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 min-w-0 truncate text-sm text-zinc-700 dark:text-zinc-300">{cat.name}</span>
                      <button
                        onClick={() => startEditCategory(cat)}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        Edit
                      </button>
                      <button onClick={() => deleteCategory(cat.id)} className="text-xs text-zinc-400 hover:text-red-500">
                        ×
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
