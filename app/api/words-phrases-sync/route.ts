import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Scheduling-only sync for words_phrases (Random words / 中文的谚语/成语),
// called from refreshFromAnki. Only ever sends note_id + stats columns, so
// an upsert here never touches the content fields (word/pinyin/meaning/...)
// that scripts/sync-words-phrases.mjs is responsible for.
export async function POST(req: NextRequest) {
  const { rows } = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ ok: true });

  const { error } = await supabaseAdmin.from("words_phrases").upsert(rows, { onConflict: "note_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
