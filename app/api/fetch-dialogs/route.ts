import { NextResponse } from "next/server";

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

export async function GET() {
  try {
    // Get list of conversations
    const convResponse = await vkRequest("messages.getConversations", {
      group_id: VK_GROUP_ID,
      count: 100,
      filter: "all",
    });

    const conversations = convResponse.items || [];
    const dialogs = [];

    for (const conv of conversations) {
      const peerId = conv.conversation?.peer?.id;
      if (!peerId) continue;

      // Get message history for each conversation
      const histResponse = await vkRequest("messages.getHistory", {
        group_id: VK_GROUP_ID,
        peer_id: peerId,
        count: 50,
      });

      const messages = histResponse.items || [];
      if (messages.length === 0) continue;

      // Get user info if peer is a user
      let userName = "Неизвестный";
      if (peerId > 0) {
        try {
          const usersResponse = await vkRequest("users.get", {
            user_ids: peerId,
            fields: "first_name,last_name",
          });
          if (usersResponse[0]) {
            userName = `${usersResponse[0].first_name} ${usersResponse[0].last_name}`;
          }
        } catch {}
      }

      // Build conversation text
      const text = messages
        .reverse()
        .map((m: { from_id: number; text: string }) => {
          const role = m.from_id > 0 ? `Клиент (${userName})` : "Менеджер";
          return `${role}: ${m.text}`;
        })
        .filter((line: string) => line.includes(": ") && !line.endsWith(": "))
        .join("\n");

      if (text.trim().length < 20) continue;

      dialogs.push({
        id: peerId,
        userName,
        messageCount: messages.length,
        lastDate: messages[0]?.date
          ? new Date(messages[0].date * 1000).toLocaleDateString("ru-RU")
          : "",
        text,
      });
    }

    return NextResponse.json({ dialogs, total: dialogs.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка VK API" },
      { status: 500 }
    );
  }
}
