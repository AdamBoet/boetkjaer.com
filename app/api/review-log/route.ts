import { NextRequest, NextResponse } from "next/server";
import { fetchReviewLogRows } from "@/lib/review-log";

export const dynamic = "force-dynamic";

// Raw revlog rows, optionally scoped with `?since=<ISO timestamp>` so a
// caller that only needs recent history (e.g. today's studied-cards count)
// isn't forced to page through months of data. The Statistics tab's
// aggregate charts read from /api/stats (a precomputed cache) instead of
// this route now — this one remains for same-day lookups and as the source
// the cache itself is built from.
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since") ?? undefined;
  try {
    const rows = await fetchReviewLogRows({ since });
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load review history" }, { status: 500 });
  }
}
