import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { error } = await supabaseAdmin.from("health_weight_entries").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { weight_kg, created_at } = await req.json();
  const update: { weight_kg?: number; created_at?: string } = {};

  if (weight_kg !== undefined) {
    const weight = Number(weight_kg);
    if (!Number.isFinite(weight) || weight <= 0 || weight >= 500) {
      return NextResponse.json({ error: "weight_kg must be a number between 0 and 500" }, { status: 400 });
    }
    update.weight_kg = Math.round(weight * 10) / 10;
  }
  if (created_at !== undefined) {
    const t = new Date(created_at);
    if (typeof created_at !== "string" || Number.isNaN(t.getTime())) {
      return NextResponse.json({ error: "created_at must be a valid timestamp" }, { status: 400 });
    }
    update.created_at = t.toISOString();
  }
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("health_weight_entries")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "This entry no longer exists" }, { status: 404 });

  return NextResponse.json({ entry: data });
}
