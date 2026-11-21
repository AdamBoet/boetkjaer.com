import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { label, value, secret } = await req.json();
  const update: { label?: string; value?: string; secret?: boolean } = {};

  if (label !== undefined) {
    const name = typeof label === "string" ? label.trim() : "";
    if (!name || name.length > 60) return NextResponse.json({ error: "label must be 1–60 characters" }, { status: 400 });
    update.label = name;
  }
  if (value !== undefined) {
    if (typeof value !== "string" || value.length > 500) return NextResponse.json({ error: "value must be at most 500 characters" }, { status: 400 });
    update.value = value.trim();
  }
  if (secret !== undefined) {
    if (typeof secret !== "boolean") return NextResponse.json({ error: "secret must be true or false" }, { status: 400 });
    update.secret = secret;
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const { data, error } = await supabaseAdmin.from("personal_info").update(update).eq("id", id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "This field no longer exists" }, { status: 404 });
  return NextResponse.json({ field: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await supabaseAdmin.from("personal_info").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
