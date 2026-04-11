import { NextResponse } from "next/server";

// Simple in-memory rate limiter: max 5 attempts per IP per minute
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  if (entry.count >= 5) return true;
  entry.count++;
  return false;
}

export async function POST(request: Request) {
  // Rate limiting by IP
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Слишком много попыток. Подождите минуту." },
      { status: 429 }
    );
  }

  const { token } = await request.json();

  const isAdmin = token && token === process.env.MANAGER_TOKEN;
  const isManager = token && token === process.env.MANAGER_READONLY_TOKEN;

  if (!isAdmin && !isManager) {
    return NextResponse.json({ error: "Неверный код доступа" }, { status: 401 });
  }

  const role = isAdmin ? "admin" : "manager";
  const cookieOpts = {
    httpOnly: true, // both cookies httpOnly — role never readable by JS
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  };

  const response = NextResponse.json({ ok: true, role });
  response.cookies.set("session", "verified", cookieOpts);
  response.cookies.set("role", role, cookieOpts);
  return response;
}
