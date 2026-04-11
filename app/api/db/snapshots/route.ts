import { NextResponse } from "next/server";
import { supabase } from "@/app/lib/supabase";

export async function GET() {
  const { data, error } = await supabase.from("dialog_snapshots").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Convert array → Record<id, snapshot>
  const snapshots: Record<number, { messageCount: number; lastMessageTs: number; analyzedAt: number }> = {};
  for (const row of data ?? []) {
    snapshots[row.id] = {
      messageCount: row.message_count,
      lastMessageTs: row.last_message_ts,
      analyzedAt: row.analyzed_at,
    };
  }
  return NextResponse.json({ snapshots });
}

export async function POST(request: Request) {
  const { snapshots } = await request.json();
  if (!snapshots) return NextResponse.json({ ok: true });

  const rows = Object.entries(snapshots).map(([id, s]) => {
    const snap = s as { messageCount: number; lastMessageTs: number; analyzedAt: number };
    return {
      id: Number(id),
      message_count: snap.messageCount,
      last_message_ts: snap.lastMessageTs,
      analyzed_at: snap.analyzedAt,
    };
  });

  if (rows.length === 0) return NextResponse.json({ ok: true });
  const { error } = await supabase.from("dialog_snapshots").upsert(rows, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
