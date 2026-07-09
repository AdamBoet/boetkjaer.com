import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { ensureMonthlyFixedTransactions } from "@/lib/economy";

export async function POST(req: NextRequest) {
  const { name, amount, type, category } = await req.json();

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (type !== "expense" && type !== "income") {
    return NextResponse.json({ error: "type must be 'expense' or 'income'" }, { status: 400 });
  }
  if (category !== null && typeof category !== "string") {
    return NextResponse.json({ error: "category must be a string or null" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("economy_recurring_items")
    .insert({ name: name.trim(), amount, type, category: category?.trim() || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const newTransactions = await ensureMonthlyFixedTransactions();

  return NextResponse.json({ item: data, transactions: newTransactions }, { status: 201 });
}
