import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Same bucket as upload-media/route.ts and create_card.py's upload_media().
const BUCKET = "mandarin-media";

export async function POST(req: NextRequest) {
  const { filename, contentType, contentBase64 } = await req.json();
  if (!filename || !contentBase64) {
    return NextResponse.json({ error: "filename and contentBase64 are required" }, { status: 400 });
  }

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
    .insert({ storage_path: path, image_url: data.publicUrl, status: "pending" });
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true, url: data.publicUrl });
}
