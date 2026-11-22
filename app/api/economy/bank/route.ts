import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Linked accounts and their connection status for the Economy page.
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("bank_accounts")
    .select("id, iban, name, currency, aspsp_name, included, last_synced_at, last_error, connection:bank_connections(valid_until)")
    .order("aspsp_name")
    .order("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data });
}
