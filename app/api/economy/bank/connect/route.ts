import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { eb, BANK_REDIRECT_URL } from "@/lib/enable-banking";

const ALLOWED = new Set(["Danske Bank", "Revolut"]);
const CONSENT_DAYS = 180; // max both banks allow

// Starts the bank login: returns the bank's authorisation URL. The state is
// kept in a short-lived cookie and checked again in the callback.
export async function POST(req: NextRequest) {
  const { aspsp } = await req.json();
  if (!ALLOWED.has(aspsp)) return NextResponse.json({ error: "Unknown bank" }, { status: 400 });

  const state = crypto.randomBytes(16).toString("hex");
  try {
    const res = await eb<{ url: string }>("/auth", {
      method: "POST",
      body: {
        access: { valid_until: new Date(Date.now() + CONSENT_DAYS * 86400_000).toISOString() },
        aspsp: { name: aspsp, country: "DK" },
        state,
        redirect_url: BANK_REDIRECT_URL,
        psu_type: "personal",
      },
    });
    const out = NextResponse.json({ url: res.url });
    out.cookies.set("eb_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/api/economy/bank" });
    return out;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not start bank login" }, { status: 502 });
  }
}
