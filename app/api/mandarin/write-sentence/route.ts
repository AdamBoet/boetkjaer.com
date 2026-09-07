import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// Companion to sentences-due — the Claude scheduled task calls this once
// per generated sentence. Only writes the text fields + a "text generated"
// timestamp; pinyin/audio/"audio generated" stay untouched here and get
// filled in by daily_refresh.py's next local run (see the
// sentence-audio-generated-at migration for why these are tracked
// separately).
export async function POST(req: NextRequest) {
  const { table, key, sentence, translation } = await req.json();

  if (table !== "hsk3_words" && table !== "words_phrases") {
    return NextResponse.json({ error: "table must be 'hsk3_words' or 'words_phrases'" }, { status: 400 });
  }
  if (typeof sentence !== "string" || !sentence.trim()) {
    return NextResponse.json({ error: "sentence is required" }, { status: 400 });
  }
  if (typeof translation !== "string" || !translation.trim()) {
    return NextResponse.json({ error: "translation is required" }, { status: 400 });
  }
  if (key == null) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const isHsk3 = table === "hsk3_words";
  const patch = isHsk3
    ? { sentence, sentence_meaning: translation, sentence_generated_at: now }
    : { example: sentence, example_meaning: translation, example_generated_at: now };
  const pk = isHsk3 ? "word" : "note_id";
  const pkValue = isHsk3 ? key : Number(key);

  const { error } = await supabaseAdmin.from(table).update(patch).eq(pk, pkValue);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
