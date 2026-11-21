import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET() {
  const { data, error } = await supabaseAdmin.from("personal_info").select("*").order("position").order("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ fields: data });
}

export async function POST(req: NextRequest) {
  const { label } = await req.json();
  const name = typeof label === "string" ? label.trim() : "";
  if (!name || name.length > 60) return NextResponse.json({ error: "label must be 1–60 characters" }, { status: 400 });

  const { data: last } = await supabaseAdmin.from("personal_info").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabaseAdmin
    .from("personal_info")
    .insert({ label: name, position: (last?.position ?? 0) + 1 })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ field: data }, { status: 201 });
}
