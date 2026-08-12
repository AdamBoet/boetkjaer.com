import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const { stats, cards } = await req.json();

  const { error: statsError } = await supabaseAdmin
    .from("anki_stats")
    .upsert({ id: 1, ...stats });

  if (statsError) return NextResponse.json({ error: statsError.message }, { status: 500 });

  const { error: cardsError } = await supabaseAdmin
    .from("hanzi_cards")
    .upsert(cards);

  if (cardsError) return NextResponse.json({ error: cardsError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
