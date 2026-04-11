import { NextResponse } from "next/server";

/** Returns 403 response if the request is not from an admin, otherwise null. */
export function requireAdmin(request: Request): NextResponse | null {
  const role = (request as Request & { headers: Headers }).headers.get("x-user-role");
  if (role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  return null;
}
