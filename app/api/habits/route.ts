import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { nextDue, parseInterval, parseName, parseQuiet } from "@/lib/habits";

export async function GET() {
  const { data, error } = await supabaseAdmin.from("habits").select("*").order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ habits: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = parseName(body.name);
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
  const interval = parseInterval(body.interval_minutes);
  if (!interval.ok) return NextResponse.json({ error: interval.error }, { status: 400 });
  const quiet = parseQuiet(body.quiet_start, body.quiet_end);
  if (!quiet.ok) return NextResponse.json({ error: quiet.error }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("habits")
    .insert({
      name: name.value,
      interval_minutes: interval.value,
      ...quiet.value,
      next_due_at: nextDue(interval.value),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ habit: data }, { status: 201 });
}
