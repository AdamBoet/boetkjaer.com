import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendPushToAll } from "@/lib/push";
import { inQuietHours, localParts, nextDue, quietEndAfter, type HabitRow } from "@/lib/habits";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Called every 5 minutes by a Supabase pg_cron job (see
// data/habits-migration.sql), not by Vercel Cron, which only runs daily on
// Hobby. Not behind the lab login (proxy.ts), so it's guarded by a shared
// secret header instead. Sends one push per due habit and moves its
// next_due_at forward; a habit that comes due during its quiet hours is
// pushed back to when they end, without a notification.
//
// It also sends the enabled fixed-time reminders in daily_reminders (e.g.
// the Weight page's morning reminder) at their Copenhagen wall-clock time.
// The cron fires at :00, :05, ..., so exactly one run lands in each
// reminder's 5-minute window.
async function sendDailyReminders(now: Date) {
  const { data, error } = await supabaseAdmin.from("daily_reminders").select("id, title, url, at_time").eq("enabled", true);
  if (error) throw new Error(error.message);
  const p = localParts(now);
  const t = p.h * 60 + p.mi;
  const sent: string[] = [];
  for (const r of data ?? []) {
    const [h, m] = r.at_time.split(":").map(Number);
    const at = h * 60 + m;
    if (t >= at && t < at + 5) {
      await sendPushToAll(r.title, "", { url: r.url, app: "general" });
      sent.push(r.id);
    }
  }
  return sent;
}

export async function POST(req: NextRequest) {
  const secret = process.env.HABIT_TICK_SECRET;
  if (!secret || req.headers.get("x-habit-tick-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const { data, error } = await supabaseAdmin
    .from("habits")
    .select("*")
    .eq("active", true)
    .lte("next_due_at", now.toISOString());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { id: number; action: "sent" | "quiet" }[] = [];
  for (const habit of (data ?? []) as HabitRow[]) {
    if (inQuietHours(habit, now)) {
      await supabaseAdmin.from("habits").update({ next_due_at: quietEndAfter(habit, now).toISOString() }).eq("id", habit.id);
      results.push({ id: habit.id, action: "quiet" });
      continue;
    }
    // Advance first, so a push failure can't make the habit fire on every tick.
    await supabaseAdmin.from("habits").update({ next_due_at: nextDue(habit.interval_minutes, now) }).eq("id", habit.id);
    await sendPushToAll(`⏰ ${habit.name}`, "", { url: "/lab/habits", app: "general" });
    results.push({ id: habit.id, action: "sent" });
  }

  const daily = await sendDailyReminders(now);

  return NextResponse.json({ ok: true, results, daily });
}

export const GET = POST;
