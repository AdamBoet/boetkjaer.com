import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { UNCATEGORIZED } from "@/lib/bank-sync";

// "Always use this category for <merchant>": saves the rule and applies it
// to that merchant's existing uncategorised bank transactions.
export async function POST(req: NextRequest) {
  const { merchant, category } = await req.json();
  if (typeof merchant !== "string" || !merchant.trim() || typeof category !== "string" || !category.trim()) {
    return NextResponse.json({ error: "merchant and category are required" }, { status: 400 });
  }
  const m = merchant.trim();
  const { error } = await supabaseAdmin.from("economy_category_rules").upsert({ merchant: m, category: category.trim() }, { onConflict: "merchant" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("economy_transactions")
    .update({ description: category.trim() })
    .ilike("merchant", m.replace(/[%_\\]/g, c => `\\${c}`))
    .eq("description", UNCATEGORIZED)
    .not("bank_account_id", "is", null)
    .select("*");
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ updated: updated ?? [] });
}
