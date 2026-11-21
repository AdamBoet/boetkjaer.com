import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// On/off for a named notification (e.g. 'mandarin_nightly', read by
// daily_refresh.py; 'mandarin_watchdog', read by /api/pipeline-watchdog).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { enabled } = await req.json();
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("notification_toggles")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, label, enabled")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Setting not found" }, { status: 404 });
  return NextResponse.json({ toggle: data });
}
