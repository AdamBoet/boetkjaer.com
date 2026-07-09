import { NextRequest, NextResponse } from "next/server";
import { LAB_SESSION_COOKIE } from "@/lib/lab-auth";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.delete(LAB_SESSION_COOKIE);
  return res;
}
