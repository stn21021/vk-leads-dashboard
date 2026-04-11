import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { token } = await request.json();

  const isAdmin = token && token === process.env.MANAGER_TOKEN;
  const isManager = token && token === process.env.MANAGER_READONLY_TOKEN;

  if (!isAdmin && !isManager) {
    return NextResponse.json({ error: "Неверный код доступа" }, { status: 401 });
  }

  const role = isAdmin ? "admin" : "manager";
  const response = NextResponse.json({ ok: true });

  // httpOnly session cookie — security, not readable by JS
  response.cookies.set("session", "verified", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  // Non-httpOnly role cookie — readable by JS for UI rendering
  response.cookies.set("role", role, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  return response;
}
