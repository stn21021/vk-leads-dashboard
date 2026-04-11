import { NextResponse } from "next/server";
import { supabase } from "@/app/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("pipeline_entries")
    .select("*")
    .order("added_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = (data ?? []).map((r: {
    lead_id: number; user_name: string; product: string; pain: string; summary: string;
    stage: string; closed_result?: string; note: string; follow_up_date: string;
    amount: string; added_at: number; updated_at: number;
  }) => ({
    leadId: r.lead_id,
    userName: r.user_name,
    product: r.product,
    pain: r.pain,
    summary: r.summary,
    stage: r.stage,
    closedResult: r.closed_result,
    note: r.note,
    followUpDate: r.follow_up_date,
    amount: r.amount,
    addedAt: r.added_at,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const { entry } = await request.json();

  const row = {
    lead_id: entry.leadId,
    user_name: entry.userName,
    product: entry.product,
    pain: entry.pain,
    summary: entry.summary,
    stage: entry.stage,
    closed_result: entry.closedResult ?? null,
    note: entry.note,
    follow_up_date: entry.followUpDate,
    amount: entry.amount,
    added_at: entry.addedAt,
    updated_at: entry.updatedAt,
  };

  const { error } = await supabase
    .from("pipeline_entries")
    .upsert(row, { onConflict: "lead_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const { leadId, updates } = await request.json();

  const row: Record<string, unknown> = { updated_at: Date.now() };
  if (updates.stage !== undefined) row.stage = updates.stage;
  if (updates.closedResult !== undefined) row.closed_result = updates.closedResult;
  if (updates.note !== undefined) row.note = updates.note;
  if (updates.followUpDate !== undefined) row.follow_up_date = updates.followUpDate;
  if (updates.amount !== undefined) row.amount = updates.amount;

  const { error } = await supabase
    .from("pipeline_entries")
    .update(row)
    .eq("lead_id", leadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { leadId } = await request.json();

  const { error } = await supabase
    .from("pipeline_entries")
    .delete()
    .eq("lead_id", leadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
