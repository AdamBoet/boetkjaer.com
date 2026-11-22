import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Include/exclude an account from the sync.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { included } = await req.json();
  if (typeof included !== "boolean") return NextResponse.json({ error: "included must be true or false" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("bank_accounts").update({ included }).eq("id", id).select("id, included").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json({ account: data });
}
