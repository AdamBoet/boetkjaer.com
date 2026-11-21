import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Turn a fixed-time daily reminder (e.g. 'weight') on/off or move it.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { enabled, at_time } = await req.json();
  const update: { enabled?: boolean; at_time?: string; updated_at: string } = { updated_at: new Date().toISOString() };

  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
    update.enabled = enabled;
  }
  if (at_time !== undefined) {
    if (typeof at_time !== "string" || !TIME_RE.test(at_time)) return NextResponse.json({ error: "time must be HH:MM" }, { status: 400 });
    update.at_time = at_time;
  }

  const { data, error } = await supabaseAdmin
    .from("daily_reminders")
    .update(update)
    .eq("id", id)
    .select("id, title, url, at_time, enabled")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  return NextResponse.json({ reminder: { ...data, at_time: data.at_time.slice(0, 5) } });
}
