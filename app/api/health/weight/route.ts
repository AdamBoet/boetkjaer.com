import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("health_weight_entries")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entries: data });
}

export async function POST(req: NextRequest) {
  const { weight_kg } = await req.json();
  const weight = Number(weight_kg);

  if (!Number.isFinite(weight) || weight <= 0 || weight >= 500) {
    return NextResponse.json({ error: "weight_kg must be a number between 0 and 500" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("health_weight_entries")
    .insert({ weight_kg: Math.round(weight * 10) / 10 })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entry: data }, { status: 201 });
}
