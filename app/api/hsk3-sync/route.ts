import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const { stats, words } = await req.json();

  const { error: statsError } = await supabaseAdmin
    .from("hsk3_stats")
    .upsert({ id: 1, ...stats });

  if (statsError) return NextResponse.json({ error: statsError.message }, { status: 500 });

  const batchSize = 1000;
  const batches = [];
  for (let i = 0; i < words.length; i += batchSize) batches.push(words.slice(i, i + batchSize));

  // Fire batches concurrently (a handful at a time) instead of one-by-one —
  // Supabase handles a few parallel requests fine, and this cuts wall time a lot.
  const concurrency = 4;
  for (let i = 0; i < batches.length; i += concurrency) {
    const results = await Promise.all(
      batches.slice(i, i + concurrency).map((batch) =>
        supabaseAdmin.from("hsk3_words").upsert(batch, { onConflict: "word" })
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
