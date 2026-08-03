import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const TABLES = {
  hanzi: { table: "hanzi_cards", pk: "note_id" },
  hsk3: { table: "hsk3_words", pk: "word" },
  wp: { table: "words_phrases", pk: "note_id" },
} as const;

export async function POST(req: NextRequest) {
  const { source, id, updates } = await req.json();
  const config = TABLES[source as keyof typeof TABLES];
  if (!config) return NextResponse.json({ error: `Unknown source "${source}"` }, { status: 400 });

  const { error } = await supabaseAdmin.from(config.table).update(updates).eq(config.pk, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
