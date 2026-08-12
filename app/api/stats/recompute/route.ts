import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchReviewLogRows, type ReviewLogRow } from "@/lib/review-log";
import { aggregateReviewLog } from "@/lib/stats-aggregate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DECKS = ["all", "hanzi", "hsk3", "random_words", "idioms"] as const;

// The background job: recomputes every deck filter's aggregate from the
// full review_log in one pass and upserts the results into stats_cache.
// Triggered by a Vercel Cron (GET) and by the Statistics tab's manual
// "Refresh" button (POST) — same handler either way.
async function recompute() {
  const allRows = await fetchReviewLogRows();
  const byDeck = new Map<string, ReviewLogRow[]>();
  for (const deck of DECKS) byDeck.set(deck, deck === "all" ? allRows : allRows.filter((r) => r.source === deck));

  const computedAt = new Date().toISOString();
  const rows = DECKS.map((deck) => ({ deck, data: aggregateReviewLog(byDeck.get(deck)!), computed_at: computedAt }));

  const { error } = await supabaseAdmin.from("stats_cache").upsert(rows, { onConflict: "deck" });
  if (error) throw new Error(error.message);
  return computedAt;
}

export async function POST() {
  try {
    const computedAt = await recompute();
    return NextResponse.json({ ok: true, computedAt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to recompute stats" }, { status: 500 });
  }
}

export const GET = POST;
