import { supabaseAdmin } from "@/lib/supabase-server";

function firstOfMonthISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function ensureMonthlyFixedTransactions() {
  const occurredOn = firstOfMonthISO();

  const [{ data: items }, { data: existing }] = await Promise.all([
    supabaseAdmin.from("economy_recurring_items").select("*"),
    supabaseAdmin
      .from("economy_transactions")
      .select("recurring_item_id")
      .eq("occurred_on", occurredOn)
      .not("recurring_item_id", "is", null),
  ]);
  if (!items || items.length === 0) return [];

  const already = new Set((existing ?? []).map(e => e.recurring_item_id));
  const missing = items.filter(item => !already.has(item.id));
  if (missing.length === 0) return [];

  const { data: inserted } = await supabaseAdmin
    .from("economy_transactions")
    .insert(
      missing.map(item => ({
        description: item.name,
        amount: item.amount,
        type: item.type,
        occurred_on: occurredOn,
        recurring_item_id: item.id,
      }))
    )
    .select();

  return inserted ?? [];
}
