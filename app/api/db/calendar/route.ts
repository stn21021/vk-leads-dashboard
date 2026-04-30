import { NextResponse } from "next/server";
import { supabase } from "@/app/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("calendar_entries")
    .select("*")
    .order("scheduled_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json();

  const row = {
    title: body.title,
    platform: body.platform ?? null,
    format: body.format ?? null,
    content: body.content ?? null,
    scheduled_date: body.scheduled_date ?? null,
    status: body.status ?? "idea",
    pain: body.pain ?? null,
    hook: body.hook ?? null,
  };

  const { data, error } = await supabase.from("calendar_entries").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

export async function PATCH(request: Request) {
  const { id, updates } = await request.json() as {
    id: string;
    updates: Record<string, unknown>;
  };

  const { error } = await supabase.from("calendar_entries").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { id } = await request.json() as { id: string };

  const { error } = await supabase.from("calendar_entries").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
