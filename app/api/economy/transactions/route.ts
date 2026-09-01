import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const { description, merchant, amount, type, occurred_on } = await req.json();

  if (typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (type !== "expense" && type !== "income") {
    return NextResponse.json({ error: "type must be 'expense' or 'income'" }, { status: 400 });
  }
  if (typeof occurred_on !== "string" || Number.isNaN(Date.parse(occurred_on))) {
    return NextResponse.json({ error: "occurred_on must be a valid date" }, { status: 400 });
  }
  if (merchant != null && typeof merchant !== "string") {
    return NextResponse.json({ error: "merchant must be a string or null" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("economy_transactions")
    .insert({ description: description.trim(), merchant: merchant?.trim() || null, amount, type, occurred_on })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ transaction: data }, { status: 201 });
}
