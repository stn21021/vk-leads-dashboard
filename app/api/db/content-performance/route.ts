import { NextResponse } from "next/server";
import { supabase } from "@/app/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("content_performance")
    .select("*")
    .order("published_date", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json();

  const row = {
    title: body.title,
    platform: body.platform ?? null,
    format: body.format ?? null,
    published_date: body.published_date ?? null,
    pain: body.pain ?? null,
    views: body.views ?? 0,
    likes: body.likes ?? 0,
    comments: body.comments ?? 0,
    saves: body.saves ?? 0,
    reach: body.reach ?? 0,
    new_leads: body.new_leads ?? 0,
    notes: body.notes ?? null,
  };

  const { data, error } = await supabase.from("content_performance").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function PATCH(request: Request) {
  const { id, updates } = await request.json() as { id: string; updates: Record<string, unknown> };
  const { error } = await supabase.from("content_performance").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { id } = await request.json() as { id: string };
  const { error } = await supabase.from("content_performance").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
