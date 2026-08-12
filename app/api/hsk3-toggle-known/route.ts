import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const DEFAULT_FACTOR = 2500;

// Site-native replacement for what "Refresh from Anki" used to be the only
// way to do: adding an HSK word to your active study set (or pausing one).
// Previously `known` was derived entirely from whether the word existed as
// a note in the Anki "HSK 1-6 vocabulary" deck.
export async function POST(req: NextRequest) {
  const { word, known } = await req.json();
  if (typeof word !== "string" || typeof known !== "boolean") {
    return NextResponse.json({ error: "word (string) and known (boolean) are required" }, { status: 400 });
  }

  if (!known) {
    // Pausing — just drop it out of the active set. Scheduling history is
    // left alone so re-starting later resumes rather than resets.
    const { error } = await supabaseAdmin.from("hsk3_words").update({ known: false }).eq("word", word);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Starting to study it — only initialize fresh-card scheduling if it has
  // no review history yet (re-enabling a previously-paused word should
  // resume its existing progress, not wipe it).
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("hsk3_words")
    .select("reps")
    .eq("word", word)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: `Unknown word "${word}"` }, { status: 404 });

  const patch: Record<string, unknown> = { known: true };
  if (existing.reps == null) {
    Object.assign(patch, {
      interval: 0,
      reps: 0,
      lapses: 0,
      factor: DEFAULT_FACTOR,
      queue: 0,
      due: 0,
      type: 0,
      mod: Math.floor(Date.now() / 1000),
    });
  }

  const { error } = await supabaseAdmin.from("hsk3_words").update(patch).eq("word", word);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
