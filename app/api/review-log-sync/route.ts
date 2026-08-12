import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const { rows } = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

  const batchSize = 1000;
  const batches: unknown[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize));

  // A full revlog pull can be tens of thousands of rows on first sync —
  // batch + a little concurrency keeps this from being one giant request.
  const concurrency = 4;
  for (let i = 0; i < batches.length; i += concurrency) {
    const results = await Promise.all(
      batches.slice(i, i + concurrency).map((batch) =>
        supabaseAdmin.from("review_log").upsert(batch, { onConflict: "source,db_id,review_id", ignoreDuplicates: true })
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: rows.length });
}

// Undoing a grade on the site needs to remove the review it just logged,
// not just revert the card's scheduling — otherwise the Statistics charts
// keep counting a review that was un-done.
export async function DELETE(req: NextRequest) {
  const { source, db_id, review_id } = await req.json();
  const { error } = await supabaseAdmin
    .from("review_log")
    .delete()
    .match({ source, db_id, review_id });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
