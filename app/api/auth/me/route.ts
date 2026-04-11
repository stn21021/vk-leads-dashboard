import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const role = request.cookies.get("role")?.value ?? "manager";
  return NextResponse.json({ role });
}
