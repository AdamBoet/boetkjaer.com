import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, LAB_SESSION_COOKIE } from "@/lib/lab-auth";

export function proxy(req: NextRequest) {
  const token = req.cookies.get(LAB_SESSION_COOKIE)?.value;

  if (verifySessionToken(token)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/lab/:path*", "/api/economy/:path*"],
};
