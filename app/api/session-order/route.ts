import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Each deck's review order for the day, saved the first time the deck is
// opened that day so leaving mid-session and coming back (on any device)
// resumes the same order instead of re-interleaving the remaining cards.

export async function GET(req: NextRequest) {
  const day = req.nextUrl.searchParams.get("day");
  if (!day) return NextResponse.json({ error: "Missing day" }, { status: 400 });

  const { data, error } = await supabaseAdmin.from("review_session_order").select("deck, card_ids").eq("day", day);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orders: Record<string, string[]> = {};
  for (const row of data ?? []) orders[row.deck] = row.card_ids;
  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  const { deck, day, card_ids } = await req.json();
  if (!deck || !day || !Array.isArray(card_ids)) {
    return NextResponse.json({ error: "Expected deck, day and card_ids" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("review_session_order")
    .upsert({ deck, day, card_ids, updated_at: new Date().toISOString() }, { onConflict: "deck" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
