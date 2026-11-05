import { NextRequest, NextResponse } from "next/server";
import { findSong, getSong } from "@/lib/lrclib";
import { supabaseAdmin } from "@/lib/supabase-server";

const COLUMNS = "id, title, artist, lyrics";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("songs")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ songs: data });
}

// Takes an LRCLIB id (a full search result) or a title and artist (a
// suggestion) and fetches the lyrics here, so what gets stored always went
// through the same cleaning and conversion.
export async function POST(req: NextRequest) {
  const { lrclibId, title, artist, durationSeconds } = await req.json();
  const hasId = Number.isSafeInteger(lrclibId) && lrclibId > 0;
  const hasName = typeof title === "string" && !!title && typeof artist === "string" && !!artist;
  if (!hasId && !hasName) {
    return NextResponse.json({ error: "lrclibId, or title and artist, are required" }, { status: 400 });
  }

  let song;
  try {
    song = hasId
      ? await getSong(lrclibId)
      : await findSong({
          title,
          artist,
          durationSeconds: typeof durationSeconds === "number" ? durationSeconds : null,
        });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lookup failed" }, { status: 502 });
  }
  if (!song) return NextResponse.json({ error: "No lyrics found for this song" }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from("songs")
    .upsert(
      {
        lrclib_id: song.lrclibId,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration_seconds: song.durationSeconds,
        lyrics: song.lyrics,
        synced_lyrics: song.syncedLyrics,
      },
      { onConflict: "lrclib_id" },
    )
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ song: data });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  const { error } = await supabaseAdmin.from("songs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
