import { NextRequest, NextResponse } from "next/server";
import { suggestSongs } from "@/lib/lrclib";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });
  if (q.length > 100) return NextResponse.json({ error: "Search is too long" }, { status: 400 });

  try {
    return NextResponse.json({ suggestions: await suggestSongs(q) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Suggestions failed" }, { status: 502 });
  }
}
