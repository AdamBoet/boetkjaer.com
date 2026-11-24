import { supabaseAdmin } from "@/lib/supabase-server";
import Link from "next/link";
import { cardDueDiff } from "./hanzi/card-utils";
import { type HanziCard } from "./hanzi/CharacterGrid";
import { fetchMandarinData } from "./hanzi/fetch-mandarin-data";

export const dynamic = "force-dynamic";

const numberFormat = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kgFormat = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const card = "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-none p-6";

function CardHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</span>
      <span className="text-xs text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 transition-colors">View →</span>
    </div>
  );
}

function formatInterval(minutes: number) {
  if (minutes % 1440 === 0) return minutes === 1440 ? "every day" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} h`;
  return `every ${minutes} min`;
}

export default async function Overview() {
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const twoWeeksAgo = new Date(today.getTime() - 14 * 86400_000).toISOString();

  const [mandarin, { data: economyTransactions }, { data: weights }, { data: habits }] = await Promise.all([
    fetchMandarinData(),
    supabaseAdmin.from("economy_transactions").select("type, amount, description").gte("occurred_on", monthStart),
    supabaseAdmin.from("health_weight_entries").select("weight_kg, created_at").gte("created_at", twoWeeksAgo).order("created_at", { ascending: false }),
    supabaseAdmin.from("habits").select("id, name, interval_minutes, active").order("created_at"),
  ]);

  // Mandarin: same "due" as the Mandarin page's deck menu — review cards due
  // today or overdue, across all four decks (before its per-session caps).
  type Reviewable = { reps?: number | null; mod?: number | null; interval?: number | null };
  const isDue = (c: Reviewable) => {
    if ((c.reps ?? 0) <= 0) return false;
    const diff = cardDueDiff(c as HanziCard);
    return diff !== null && diff <= 0;
  };
  const hsk3Known = Object.values(mandarin.hsk3Coverage.levels).flat().filter(w => w.known);
  const dueToday = [...mandarin.cards, ...hsk3Known, ...mandarin.wordsPhrases].filter(c => isDue(c as Reviewable)).length;
  const hanziKnown = mandarin.cards.filter(c => (c.reps ?? 0) > 0).length;

  // Same rules as the Economy page: Business and own-account transfers are
  // left out of earnings/spending; Business's leftover still counts in Net.
  const monthTx = (economyTransactions ?? []).map(t => ({ ...t, amount: Number(t.amount) }));
  const personal = monthTx.filter(t => t.description !== "Business" && t.description !== "Transfer");
  const totalSpending = personal.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const totalEarnings = personal.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const businessNet = monthTx
    .filter(t => t.description === "Business")
    .reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);
  const net = totalEarnings - totalSpending + businessNet;

  // Weight: latest entry, the last 7 days' average (today included) vs the 7 days before.
  const weightRows = (weights ?? []).map(w => ({ kg: Number(w.weight_kg), at: new Date(w.created_at) }));
  const weekStart = new Date(today);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400_000);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const latestWeight = weightRows[0] ?? null;
  const thisWeekAvg = avg(weightRows.filter(w => w.at >= weekStart).map(w => w.kg));
  const lastWeekAvg = avg(weightRows.filter(w => w.at >= lastWeekStart && w.at < weekStart).map(w => w.kg));
  const weekChange = thisWeekAvg != null && lastWeekAvg != null ? thisWeekAvg - lastWeekAvg : null;
  const weighedToday = latestWeight != null && latestWeight.at.toDateString() === today.toDateString();

  const habitList = habits ?? [];

  const year = today.getFullYear();

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500">{year}</p>
      </div>

      <Link href="/lab/hanzi" className={`group block ${card}`}>
        <CardHeader title="Mandarin" />
        <div className="grid grid-cols-2 divide-x divide-zinc-100 dark:divide-zinc-800">
          <div className="text-center px-2">
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">Due today</p>
            <p className={`text-5xl font-bold tabular-nums ${dueToday > 0 ? "text-red-500 dark:text-red-400" : "text-emerald-700 dark:text-emerald-500"}`}>
              {dueToday.toLocaleString("da-DK")}
            </p>
          </div>
          <div className="text-center px-2">
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">汉字 known</p>
            <p className="text-5xl font-bold tabular-nums">{hanziKnown.toLocaleString("da-DK")}</p>
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/lab/economy" className={`group block ${card}`}>
          <CardHeader title="Economy" />
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1 text-center">
            Net · {today.toLocaleDateString("en-GB", { month: "long" })}
          </p>
          <p className={`text-4xl font-bold text-center tabular-nums ${net < 0 ? "text-red-500 dark:text-red-400" : "text-emerald-700 dark:text-emerald-500"}`}>
            {numberFormat.format(net)} kr
          </p>
          <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Total earnings</span>
              <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-500">{numberFormat.format(totalEarnings)} kr</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Total spending</span>
              <span className="font-medium tabular-nums text-red-500 dark:text-red-400">{numberFormat.format(totalSpending)} kr</span>
            </div>
          </div>
        </Link>

        <Link href="/lab/weight" className={`group block ${card}`}>
          <CardHeader title="Weight" />
          {latestWeight ? (
            <>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1 text-center">{weighedToday ? "Today" : "Latest"}</p>
              <p className="text-4xl font-bold text-center tabular-nums">{kgFormat.format(latestWeight.kg)} kg</p>
              <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">7-day average</span>
                  <span className="font-medium tabular-nums">{thisWeekAvg != null ? `${kgFormat.format(thisWeekAvg)} kg` : "—"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">vs previous 7 days</span>
                  <span className="font-medium tabular-nums">
                    {weekChange != null ? `${weekChange > 0 ? "+" : weekChange < 0 ? "−" : "±"}${kgFormat.format(Math.abs(weekChange))} kg` : "—"}
                  </span>
                </div>
              </div>
              {!weighedToday && <p className="mt-3 text-xs text-amber-600 dark:text-amber-500 text-center">Not tracked today yet</p>}
            </>
          ) : (
            <p className="text-sm text-zinc-400 dark:text-zinc-500 text-center py-6">No weight logged in the last two weeks</p>
          )}
        </Link>

        <Link href="/lab/habits" className={`group block ${card} md:col-span-2`}>
          <CardHeader title="Habits" />
          {habitList.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">No habits yet</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {habitList.map(h => (
                <div key={h.id} className="flex items-center gap-3 py-2">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${h.active ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"}`} />
                  <span className={`flex-1 min-w-0 truncate text-sm ${h.active ? "" : "text-zinc-400 dark:text-zinc-500"}`}>{h.name}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                    {h.active ? formatInterval(h.interval_minutes) : "notifications off"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Link>
      </div>
    </div>
  );
}
