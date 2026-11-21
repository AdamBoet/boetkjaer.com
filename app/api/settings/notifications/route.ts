import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Everything that can push to the phone, for the Settings notification
// center: fixed-time daily reminders, each habit's on/off switch, and the
// Mandarin app's notifications (notification_toggles).
export async function GET() {
  const [daily, habits, toggles] = await Promise.all([
    supabaseAdmin.from("daily_reminders").select("id, title, url, at_time, enabled").order("id"),
    supabaseAdmin.from("habits").select("id, name, interval_minutes, active").order("created_at"),
    supabaseAdmin.from("notification_toggles").select("id, label, enabled").order("position"),
  ]);
  const error = daily.error ?? habits.error ?? toggles.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    daily: (daily.data ?? []).map(r => ({ ...r, at_time: r.at_time.slice(0, 5) })),
    habits: habits.data ?? [],
    mandarin: toggles.data ?? [],
  });
}
