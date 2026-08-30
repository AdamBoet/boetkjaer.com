import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Same bucket as upload-media/route.ts and create_card.py's upload_media().
const BUCKET = "mandarin-media";

const TARGET_SOURCES = ["random_words", "idioms"] as const;
type TargetSource = (typeof TARGET_SOURCES)[number];

// Pending screenshots — not yet picked up by tonight's daily_refresh.py run
// — for the "X uploaded" indicator/popup on a deck-overview screen. Scoped
// by target_source so the random_words and idioms upload buttons each only
// see their own pending screenshots.
export async function GET(req: NextRequest) {
  const targetSource = req.nextUrl.searchParams.get("targetSource") || "random_words";
  const { data, error } = await supabaseAdmin
    .from("screenshot_queue")
    .select("id,image_url,created_at")
    .eq("status", "pending")
    .eq("target_source", targetSource)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ screenshots: data ?? [] });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data: row, error: fetchError } = await supabaseAdmin
    .from("screenshot_queue")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  if (row?.storage_path) {
    await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path]);
  }

  const { error: deleteError } = await supabaseAdmin.from("screenshot_queue").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const { filename, contentType, contentBase64, targetSource } = await req.json();
  if (!filename || !contentBase64) {
    return NextResponse.json({ error: "filename and contentBase64 are required" }, { status: 400 });
  }
  const resolvedTargetSource: TargetSource = TARGET_SOURCES.includes(targetSource) ? targetSource : "random_words";

  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  const path = `screenshots/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const buffer = Buffer.from(contentBase64, "base64");

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: contentType || "application/octet-stream", upsert: false });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

  const { error: dbError } = await supabaseAdmin
    .from("screenshot_queue")
    .insert({ storage_path: path, image_url: data.publicUrl, status: "pending", target_source: resolvedTargetSource });
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true, url: data.publicUrl });
}
