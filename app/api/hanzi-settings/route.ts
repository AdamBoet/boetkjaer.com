import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Session-limit settings (new cards/day, max reviews/session) per deck —
// kept in Supabase (not just localStorage) so they're the same on every
// device instead of drifting between phone and desktop.
export async function GET() {
  const { data, error } = await supabaseAdmin.from("hanzi_settings").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byDeck: Record<string, { new_cards: number | null; max_reviews: number | null }> = {};
  for (const row of data ?? []) {
    byDeck[row.deck] = { new_cards: row.new_cards, max_reviews: row.max_reviews };
  }
  return NextResponse.json(byDeck);
}

export async function POST(req: NextRequest) {
  const { deck, newCards, maxReviews } = await req.json();
  if (!deck) return NextResponse.json({ error: "Missing deck" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("hanzi_settings")
    .upsert({ deck, new_cards: newCards, max_reviews: maxReviews }, { onConflict: "deck" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
