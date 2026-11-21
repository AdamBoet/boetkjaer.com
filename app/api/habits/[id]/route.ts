import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { nextDue, parseInterval, parseName, parseQuiet } from "@/lib/habits";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { error } = await supabaseAdmin.from("habits").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = parseName(body.name);
    if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
    update.name = name.value;
  }
  if (body.quiet_start !== undefined || body.quiet_end !== undefined) {
    const quiet = parseQuiet(body.quiet_start, body.quiet_end);
    if (!quiet.ok) return NextResponse.json({ error: quiet.error }, { status: 400 });
    Object.assign(update, quiet.value);
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return NextResponse.json({ error: "active must be true or false" }, { status: 400 });
    update.active = body.active;
  }

  // A new interval, or switching back on, restarts the countdown from now.
  let rearm: number | null = null;
  if (body.interval_minutes !== undefined) {
    const interval = parseInterval(body.interval_minutes);
    if (!interval.ok) return NextResponse.json({ error: interval.error }, { status: 400 });
    update.interval_minutes = interval.value;
    rearm = interval.value;
  }
  if (body.active === true && rearm == null) {
    const { data: current } = await supabaseAdmin.from("habits").select("interval_minutes").eq("id", id).maybeSingle();
    if (current) rearm = current.interval_minutes;
  }
  if (rearm != null) update.next_due_at = nextDue(rearm);

  if (!Object.keys(update).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const { data, error } = await supabaseAdmin.from("habits").update(update).eq("id", id).select().maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "This habit no longer exists" }, { status: 404 });

  return NextResponse.json({ habit: data });
}
