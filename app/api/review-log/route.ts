import { NextRequest, NextResponse } from "next/server";
import { fetchReviewLogRows } from "@/lib/review-log";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// Raw revlog rows, optionally scoped with `?since=<ISO timestamp>` so a
// caller that only needs recent history (e.g. today's studied-cards count)
// isn't forced to page through months of data. The Statistics tab's
// aggregate charts read from /api/stats (a precomputed cache) instead of
// this route now — this one remains for same-day lookups and as the source
// the cache itself is built from.
//
// With `since`, also returns `seenBefore`: the "source:db_id" keys of any
// learn-phase (review_type 0) card in the window that already has a review
// from before `since`. A new card still in its learning steps across
// midnight keeps logging review_type 0 the next day, so without this the
// caller can't tell "introduced today" from "introduced yesterday, still
// learning" using only the windowed rows.
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since") ?? undefined;
  try {
    const rows = await fetchReviewLogRows({ since });
    if (!since) return NextResponse.json({ rows });

    const learnIds = [...new Set(rows.filter((r) => r.review_type === 0).map((r) => String(r.db_id)))];
    let seenBefore: string[] = [];
    if (learnIds.length > 0) {
      const learnKeys = new Set(rows.filter((r) => r.review_type === 0).map((r) => `${r.source}:${r.db_id}`));
      const { data, error } = await supabaseAdmin
        .from("review_log")
        .select("source, db_id")
        .lt("reviewed_at", since)
        .in("db_id", learnIds);
      if (error) throw new Error(error.message);
      seenBefore = [...new Set((data ?? []).map((r) => `${r.source}:${r.db_id}`))].filter((k) => learnKeys.has(k));
    }
    return NextResponse.json({ rows, seenBefore });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load review history" }, { status: 500 });
  }
}
