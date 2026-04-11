import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const session = request.cookies.get("session")?.value;
  const role = request.cookies.get("role")?.value;

  if (session !== "verified") {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Pass role to API routes via header so they can enforce permissions
  const res = NextResponse.next();
  res.headers.set("x-user-role", role ?? "manager");
  return res;
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
