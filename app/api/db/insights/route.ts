import { NextResponse } from "next/server";
import { supabase } from "@/app/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("insights")
    .select("data")
    .eq("id", 1)
    .single();

  if (error || !data) return NextResponse.json({ insights: null });
  return NextResponse.json({ insights: data.data });
}

export async function POST(request: Request) {
  const { insights } = await request.json();
  if (!insights) return NextResponse.json({ ok: true });

  const { error } = await supabase
    .from("insights")
    .upsert({ id: 1, data: insights, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
