import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const BUCKET = "mandarin-media";

// Only sources that actually get a manual picture-upload UI — HSK vocab
// pictures come from Anki's own SentenceImage field, not a website upload.
const TABLES = {
  hanzi: { table: "hanzi_cards", pk: "note_id" },
  random_words: { table: "words_phrases", pk: "note_id" },
  idioms: { table: "words_phrases", pk: "note_id" },
} as const;

export async function POST(req: NextRequest) {
  const { source, id, filename, contentType, contentBase64 } = await req.json();
  const config = TABLES[source as keyof typeof TABLES];
  if (!config) return NextResponse.json({ error: `Unknown source "${source}"` }, { status: 400 });
  if (!filename || !contentBase64) {
    return NextResponse.json({ error: "filename and contentBase64 are required" }, { status: 400 });
  }

  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  // Storage keys must be ASCII — bust any stale cache on replacement with a
  // timestamp rather than reusing a fixed name.
  const path = `edits/${source}-${id}-${Date.now()}${ext}`;
  const buffer = Buffer.from(contentBase64, "base64");

  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { contentType: contentType || "application/octet-stream", upsert: true });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

  const { error: dbError } = await supabaseAdmin.from(config.table).update({ picture_url: data.publicUrl }).eq(config.pk, id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ url: data.publicUrl });
}
