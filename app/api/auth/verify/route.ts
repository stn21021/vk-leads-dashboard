import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { token } = await request.json();

  if (!token || token !== process.env.MANAGER_TOKEN) {
    return NextResponse.json({ error: "Неверный код доступа" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", "verified", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
  return response;
}
