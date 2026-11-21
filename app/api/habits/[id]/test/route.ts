import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendPushToAll } from "@/lib/push";

// Sends the habit's reminder right now, without touching its schedule.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: habit, error } = await supabaseAdmin.from("habits").select("name").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!habit) return NextResponse.json({ error: "This habit no longer exists" }, { status: 404 });

  try {
    const sent = await sendPushToAll(`⏰ ${habit.name}`, "Test reminder from Habit Helper", { url: "/lab/habits", app: "general" });
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Push failed" }, { status: 500 });
  }
}
