import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, LAB_SESSION_COOKIE } from "@/lib/lab-auth";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (username !== process.env.LAB_AUTH_USER || password !== process.env.LAB_AUTH_PASSWORD) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(LAB_SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
