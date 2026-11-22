import { supabaseAdmin } from "@/lib/supabase-server";

// Fixed monthly items marked expected_until_bank (e.g. SU) are added on the
// 1st as the expected payment, so the month's numbers include them before
// the money arrives. When the real payment is imported from the bank, the
// placeholder is removed (removeMatchedPlaceholders) and not re-added.
// Other fixed items are only a list now: the bank feed brings the real
// payments, so auto-adding them would count them twice.

const MATCH_TOLERANCE = 0.02; // bank amount within 2% of the fixed amount

function firstOfMonthISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function nextMonthISO(first: string) {
  const [y, m] = first.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function matches(fixedAmount: number, bankAmount: number) {
  return Math.abs(bankAmount - fixedAmount) <= fixedAmount * MATCH_TOLERANCE;
}

export async function ensureMonthlyFixedTransactions() {
  const occurredOn = firstOfMonthISO();

  const [{ data: items }, { data: existing }, { data: bank }] = await Promise.all([
    supabaseAdmin.from("economy_recurring_items").select("*").eq("expected_until_bank", true),
    supabaseAdmin
      .from("economy_transactions")
      .select("recurring_item_id")
      .gte("occurred_on", occurredOn)
      .lt("occurred_on", nextMonthISO(occurredOn))
      .not("recurring_item_id", "is", null),
    supabaseAdmin
      .from("economy_transactions")
      .select("amount, type")
      .gte("occurred_on", occurredOn)
      .lt("occurred_on", nextMonthISO(occurredOn))
      .not("bank_account_id", "is", null),
  ]);
  if (!items || items.length === 0) return [];

  const already = new Set((existing ?? []).map(e => e.recurring_item_id));
  const missing = items.filter(
    item =>
      !already.has(item.id) &&
      // the real payment already arrived this month: no placeholder needed
      !(bank ?? []).some(b => b.type === item.type && matches(Number(item.amount), Number(b.amount)))
  );
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

// After a bank sync: drop expected-payment placeholders whose real payment
// has now been imported in the same month.
export async function removeMatchedPlaceholders() {
  const { data: items } = await supabaseAdmin.from("economy_recurring_items").select("id").eq("expected_until_bank", true);
  const ids = (items ?? []).map(i => i.id);
  if (!ids.length) return 0;

  const { data: placeholders } = await supabaseAdmin
    .from("economy_transactions")
    .select("id, amount, type, occurred_on")
    .in("recurring_item_id", ids)
    .is("bank_account_id", null);

  let removed = 0;
  for (const p of placeholders ?? []) {
    const month = p.occurred_on.slice(0, 7) + "-01";
    const { data: bank } = await supabaseAdmin
      .from("economy_transactions")
      .select("amount")
      .eq("type", p.type)
      .not("bank_account_id", "is", null)
      .gte("occurred_on", month)
      .lt("occurred_on", nextMonthISO(month));
    if ((bank ?? []).some(b => matches(Number(p.amount), Number(b.amount)))) {
      await supabaseAdmin.from("economy_transactions").delete().eq("id", p.id);
      removed++;
    }
  }
  return removed;
}
