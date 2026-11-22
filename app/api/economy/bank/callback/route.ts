import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { eb, accountIban, type EbSession } from "@/lib/enable-banking";
import { syncBankAccounts } from "@/lib/bank-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/lab/economy", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: "eb_state", path: "/api/economy/bank" });
  return res;
}

// The bank redirects here after login. Exchanges the code for a session,
// stores the connection and its accounts, and runs the first sync. New
// accounts start importing from the 1st of the current month.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(req, { bank_error: q.get("error_description") || q.get("error")! });
  const code = q.get("code");
  if (!code) return back(req, { bank_error: "No authorisation code returned" });
  if (!q.get("state") || q.get("state") !== req.cookies.get("eb_state")?.value) {
    return back(req, { bank_error: "Login session expired or mismatched — try again" });
  }

  try {
    const session = await eb<EbSession>("/sessions", { method: "POST", body: { code } });

    const { data: conn, error: connErr } = await supabaseAdmin
      .from("bank_connections")
      .insert({
        aspsp_name: session.aspsp?.name ?? "Bank",
        aspsp_country: session.aspsp?.country ?? "DK",
        session_id: session.session_id,
        valid_until: session.access.valid_until,
      })
      .select("id")
      .single();
    if (connErr) throw new Error(connErr.message);

    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const ibans = session.accounts.map(accountIban);
    const { data: existing } = await supabaseAdmin.from("bank_accounts").select("id, iban").in("iban", ibans);
    const known = new Map((existing ?? []).map(a => [a.iban, a.id]));

    for (const a of session.accounts) {
      const iban = accountIban(a);
      const fields = {
        uid: a.uid,
        connection_id: conn.id,
        name: a.name || a.product || a.details || null,
        currency: a.currency ?? null,
        aspsp_name: session.aspsp?.name ?? "Bank",
        last_error: null,
      };
      const id = known.get(iban);
      if (id) await supabaseAdmin.from("bank_accounts").update(fields).eq("id", id);
      else await supabaseAdmin.from("bank_accounts").insert({ ...fields, iban, sync_from: firstOfMonth });
    }

    const results = await syncBankAccounts();
    const imported = results.reduce((s, r) => s + r.imported, 0);
    return back(req, { bank: "connected", imported: String(imported) });
  } catch (e) {
    return back(req, { bank_error: e instanceof Error ? e.message : "Bank connection failed" });
  }
}
