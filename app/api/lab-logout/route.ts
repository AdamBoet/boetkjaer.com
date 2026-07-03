import { NextRequest, NextResponse } from "next/server";
import { LAB_SESSION_COOKIE } from "@/lib/lab-auth";

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete(LAB_SESSION_COOKIE);
  return res;
}
