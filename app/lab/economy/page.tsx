import { supabaseAdmin } from "@/lib/supabase-server";
import { ensureMonthlyFixedTransactions } from "@/lib/economy";
import EconomyDashboard from "./EconomyDashboard";
import { type Transaction, type RecurringItem, type Category } from "./types";

export const dynamic = "force-dynamic";

export default async function EconomyPage() {
  await ensureMonthlyFixedTransactions();

  const { data: transactions } = await supabaseAdmin
    .from("economy_transactions")
    .select("*")
    .order("occurred_on", { ascending: false })
    .order("id", { ascending: false });

  const { data: recurringItems } = await supabaseAdmin
    .from("economy_recurring_items")
    .select("*")
    .order("created_at", { ascending: true });

  const { data: categories } = await supabaseAdmin
    .from("economy_categories")
    .select("*")
    .order("name", { ascending: true });

  return (
    <EconomyDashboard
      initialTransactions={(transactions ?? []) as Transaction[]}
      initialRecurring={(recurringItems ?? []) as RecurringItem[]}
      initialCategories={(categories ?? []) as Category[]}
    />
  );
}
