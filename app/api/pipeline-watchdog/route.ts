import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The nightly mandarin-pipeline refresh (daily_refresh.py) runs locally on
// a Mac via launchd, not on Vercel — so if the Mac is off/asleep/dead at
// 4am, the job never starts, and it can't report its own failure (that
// would require the very process that failed to run). This is the
// independent, server-side check: it inspects the pipeline_runs heartbeat
// table (written by daily_refresh.py at the start/end of every run) and
// pushes a notification if the most recent run is missing or stuck.
// Triggered by a Vercel Cron (see vercel.json) at 04:00 UTC — 5am local
// during CET, 6am during CEST (Vercel crons are fixed UTC, no DST).
const STUCK_HOURS = 3;
const STALE_HOURS = 20;

async function checkHeartbeat() {
  const { data: rows, error } = await supabaseAdmin
    .from("pipeline_runs")
    .select("id, started_at, status")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);

  const last = rows?.[0];
  if (!last) {
    await sendPushToAll("Nightly refresh missing", "No refresh run has ever been recorded.");
    return "no_run_ever";
  }

  const hoursSinceStart = (Date.now() - new Date(last.started_at).getTime()) / (1000 * 60 * 60);

  if (last.status === "running" && hoursSinceStart > STUCK_HOURS) {
    await sendPushToAll(
      "Nightly refresh stuck",
      `Last run started ${Math.round(hoursSinceStart)}h ago and never finished — check the Mac.`
    );
    return "stuck";
  }

  if (hoursSinceStart > STALE_HOURS) {
    await sendPushToAll(
      "Nightly refresh missed",
      "No refresh has started today — the Mac may have been off, asleep, or lost network around 4am."
    );
    return "missed";
  }

  return "ok";
}

export async function POST() {
  try {
    const result = await checkHeartbeat();
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Watchdog check failed" }, { status: 500 });
  }
}

export const GET = POST;
