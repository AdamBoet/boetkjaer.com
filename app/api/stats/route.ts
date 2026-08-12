import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchReviewLogRows } from "@/lib/review-log";
import { aggregateReviewLog } from "@/lib/stats-aggregate";

export const dynamic = "force-dynamic";

const DECKS = ["all", "hanzi", "hsk3", "random_words", "idioms"];

// Serves the precomputed stats_cache row for a deck instead of re-crunching
// the full review_log on every Statistics tab visit. The background
// recompute job (/api/stats/recompute) keeps this fresh; the fallback below
// only fires the very first time a deck has no cached row yet, so the cache
// is self-seeding rather than requiring a manual first run.
export async function GET(req: NextRequest) {
  const deck = req.nextUrl.searchParams.get("deck") ?? "all";
  if (!DECKS.includes(deck)) return NextResponse.json({ error: "Unknown deck filter" }, { status: 400 });

  const { data: cached, error } = await supabaseAdmin.from("stats_cache").select("data, computed_at").eq("deck", deck).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (cached) return NextResponse.json({ data: cached.data, computedAt: cached.computed_at });

  try {
    const rows = await fetchReviewLogRows(deck === "all" ? {} : { source: deck });
    const data = aggregateReviewLog(rows);
    const computedAt = new Date().toISOString();
    await supabaseAdmin.from("stats_cache").upsert({ deck, data, computed_at: computedAt }, { onConflict: "deck" });
    return NextResponse.json({ data, computedAt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load stats" }, { status: 500 });
  }
}
