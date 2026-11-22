import { NextResponse } from "next/server";
import { syncBankAccounts } from "@/lib/bank-sync";

export const maxDuration = 60;

// "Sync now" on the Economy page. Banks allow only a few reads per day.
export async function POST() {
  try {
    const results = await syncBankAccounts();
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
