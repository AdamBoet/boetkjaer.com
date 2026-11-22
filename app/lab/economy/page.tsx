import { supabaseAdmin } from "@/lib/supabase-server";
import { ensureMonthlyFixedTransactions } from "@/lib/economy";
import EconomyDashboard from "./EconomyDashboard";
import { type Transaction, type RecurringItem, type Category } from "./types";

export const dynamic = "force-dynamic";

export default async function EconomyPage() {
  // Only fixed items marked "expected until the bank payment arrives" (e.g.
  // SU) create a placeholder transaction; see lib/economy.ts.
  const [, { data: recurringItems }, { data: categories }] = await Promise.all([
    ensureMonthlyFixedTransactions(),
    supabaseAdmin.from("economy_recurring_items").select("*").order("created_at", { ascending: true }),
    supabaseAdmin.from("economy_categories").select("*").order("name", { ascending: true }),
  ]);

  const { data: transactions } = await supabaseAdmin
    .from("economy_transactions")
    .select("*")
    .order("occurred_on", { ascending: false })
    .order("id", { ascending: false });

  return (
    <EconomyDashboard
      initialTransactions={(transactions ?? []) as Transaction[]}
      initialRecurring={(recurringItems ?? []) as RecurringItem[]}
      initialCategories={(categories ?? []) as Category[]}
    />
  );
}
