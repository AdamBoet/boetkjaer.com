import { NextRequest, NextResponse } from "next/server";

export function proxy(req: NextRequest) {
  const expected =
    "Basic " +
    Buffer.from(`${process.env.LAB_AUTH_USER}:${process.env.LAB_AUTH_PASSWORD}`).toString("base64");

  if (req.headers.get("authorization") === expected) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="lab"' },
  });
}

export const config = {
  matcher: ["/lab/:path*"],
};
