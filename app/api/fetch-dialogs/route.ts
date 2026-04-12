import { NextResponse } from "next/server";
import { ConversationMeta } from "@/app/lib/analyze-utils";
import { requireAdmin } from "@/app/lib/auth-server";

export const maxDuration = 60;

const VK_API_VERSION = "5.131";
const VK_TOKEN = process.env.VK_TOKEN!;
const VK_GROUP_ID = process.env.VK_GROUP_ID!;

async function vkRequest(method: string, params: Record<string, string | number>) {
  const url = new URL(`https://api.vk.com/method/${method}`);
  url.searchParams.set("access_token", VK_TOKEN);
  url.searchParams.set("v", VK_API_VERSION);
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, String(val));
  }
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) throw new Error(data.error.error_msg);
  return data.response;
}

// GET /api/fetch-dialogs?mode=scan — fast metadata only (1 VK API call)
// GET /api/fetch-dialogs — full fetch of all dialogs (legacy, used for full refresh)
export async function GET(request: Request) {
  const deny = requireAdmin(request);
  if (deny) return deny;
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");

  try {
    const convResponse = await vkRequest("messages.getConversations", {
      group_id: VK_GROUP_ID,
      count: 100,
      filter: "all",
    });

    const conversations = convResponse.items || [];

    if (mode === "scan") {
      // Return lightweight metadata only — no history fetching
      const meta: ConversationMeta[] = conversations
        .map((conv: {
          conversation?: {
            peer?: { id?: number };
            last_message?: { date?: number };
            in_read?: number;
            out_read?: number;
          };
          last_message?: { date?: number };
        }) => {
          const peerId = conv.conversation?.peer?.id;
          if (!peerId) return null;
          // Use in_read + out_read as a proxy for message count
          const inRead = conv.conversation?.in_read ?? 0;
          const outRead = conv.conversation?.out_read ?? 0;
          const messageCount = Math.max(inRead, outRead);
          const lastTs = conv.conversation?.last_message?.date ?? conv.last_message?.date ?? 0;
          return { id: peerId, messageCount, lastMessageTs: lastTs };
        })
        .filter(Boolean) as ConversationMeta[];

      return NextResponse.json({ meta, total: meta.length });
    }

    // Full fetch — all dialogs with message history
    const dialogs = await fetchDialogsForPeers(
      conversations.map((c: { conversation?: { peer?: { id?: number } } }) => c.conversation?.peer?.id).filter(Boolean)
    );

    return NextResponse.json({ dialogs, total: dialogs.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка VK API" },
      { status: 500 }
    );
  }
}

// POST /api/fetch-dialogs { peerIds: number[] } — fetch history for specific dialogs only
export async function POST(request: Request) {
  const deny = requireAdmin(request);
  if (deny) return deny;
  try {
    const { peerIds }: { peerIds: number[] } = await request.json();
    if (!peerIds || peerIds.length === 0) {
      return NextResponse.json({ dialogs: [] });
    }

    const dialogs = await fetchDialogsForPeers(peerIds);
    return NextResponse.json({ dialogs, total: dialogs.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка VK API" },
      { status: 500 }
    );
  }
}

async function fetchDialogsForPeers(peerIds: number[]) {
  // 1. Fetch all histories in parallel
  const histResults = await Promise.all(
    peerIds.map(async (peerId) => {
      try {
        const histResponse = await vkRequest("messages.getHistory", {
          group_id: VK_GROUP_ID,
          peer_id: peerId,
          count: 50,
        });
        return { peerId, messages: histResponse.items || [] };
      } catch {
        return { peerId, messages: [] };
      }
    })
  );

  // 2. Fetch all user names in a single batch call
  const userPeerIds = histResults
    .filter(r => r.messages.length > 0 && r.peerId > 0)
    .map(r => r.peerId);

  const userNames: Record<number, string> = {};
  if (userPeerIds.length > 0) {
    try {
      const usersResponse = await vkRequest("users.get", {
        user_ids: userPeerIds.join(","),
        fields: "first_name,last_name",
      });
      for (const u of usersResponse) {
        userNames[u.id] = `${u.first_name} ${u.last_name}`;
      }
    } catch {}
  }

  // 3. Assemble dialogs
  const dialogs = [];
  for (const { peerId, messages } of histResults) {
    if (messages.length === 0) continue;
    const userName = userNames[peerId] ?? "Неизвестный";

    const text = messages
      .reverse()
      .map((m: { from_id: number; text: string }) => {
        const role = m.from_id > 0 ? `Клиент (${userName})` : "Менеджер";
        return `${role}: ${m.text}`;
      })
      .filter((line: string) => !line.endsWith(": "))
      .join("\n");

    if (text.trim().length < 20) continue;

    dialogs.push({
      id: peerId,
      userName,
      messageCount: messages.length,
      lastDate: messages[messages.length - 1]?.date
        ? new Date(messages[messages.length - 1].date * 1000).toLocaleDateString("ru-RU")
        : "",
      text,
    });
  }

  return dialogs;
}
