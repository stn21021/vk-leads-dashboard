import { NextResponse } from "next/server";
import { supabase } from "@/app/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("status", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data ?? [] });
}

export async function POST(request: Request) {
  const { leads } = await request.json();
  if (!leads || leads.length === 0) return NextResponse.json({ ok: true });

  // Map camelCase → snake_case for Supabase
  const rows = leads.map((l: {
    id: number; userName: string; messageCount: number; lastDate: string;
    status: string; summary: string; mainPain: string; interests: string[];
    objections: string[]; nextStep: string; recommendedProduct: string; analyzedAt: number;
    paymentDate?: string | null; paymentNote?: string | null; paymentStatus?: string | null;
  }) => ({
    id: l.id,
    user_name: l.userName,
    message_count: l.messageCount,
    last_date: l.lastDate,
    status: l.status,
    summary: l.summary,
    main_pain: l.mainPain,
    interests: l.interests,
    objections: l.objections,
    next_step: l.nextStep,
    recommended_product: l.recommendedProduct,
    analyzed_at: l.analyzedAt,
    payment_date: l.paymentDate ?? null,
    payment_note: l.paymentNote ?? null,
    payment_status: l.paymentStatus ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("leads").upsert(rows, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PATCH — обновить статус платежа или дату вручную для одного лида
export async function PATCH(request: Request) {
  const body = await request.json() as {
    id: number;
    paymentStatus?: string | null;
    paymentDate?: string | null;
    paymentNote?: string | null;
  };

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("paymentStatus" in body) update.payment_status = body.paymentStatus ?? null;
  if ("paymentDate" in body) update.payment_date = body.paymentDate ?? null;
  if ("paymentNote" in body) update.payment_note = body.paymentNote ?? null;

  const { error } = await supabase.from("leads").update(update).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
