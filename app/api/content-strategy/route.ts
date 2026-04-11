import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PRODUCTS_CONTEXT } from "@/app/lib/analyze-utils";

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(request: Request) {
  try {
    const { topPains, topObjections } = await request.json() as {
      topPains: { label: string; count: number }[];
      topObjections: { label: string; count: number }[];
    };

    if (!topPains?.length) {
      return NextResponse.json({ error: "Нет данных о болях" }, { status: 400 });
    }

    const painsText = topPains.slice(0, 4).map((p, i) => `${i + 1}. "${p.label}" — ${p.count} чел.`).join("\n");
    const objectionsText = (topObjections ?? []).slice(0, 3).map((o, i) => `${i + 1}. "${o.label}" — ${o.count} чел.`).join("\n");

    const prompt = `${PRODUCTS_CONTEXT}

Топ боли клиентов фитнес-школы Культура движения:
${painsText}

Топ возражения:
${objectionsText || "(нет данных)"}

Платформы для публикаций: ВКонтакте, YouTube, Instagram.

Для каждой боли придумай конкретные идеи контента — цепляющие заголовки и хуки (первая фраза) на каждой платформе.
Хуки должны быть короткими (до 10 слов), разговорными, бить точно в боль.

Верни JSON строго без markdown, без пояснений:
{
  "platformContent": [
    {
      "pain": "боль точно из списка",
      "leadsCount": число,
      "vk": [
        {"format": "Клип", "title": "заголовок видео", "hook": "первая фраза"},
        {"format": "Пост", "title": "заголовок поста", "hook": "первое предложение"}
      ],
      "youtube": [
        {"format": "Shorts", "title": "заголовок Shorts", "hook": "первая фраза"},
        {"format": "Видео", "title": "заголовок видео", "hook": "первая фраза"}
      ],
      "instagram": [
        {"format": "Reels", "title": "заголовок Reels", "hook": "первая фраза"},
        {"format": "Карусель", "title": "заголовок карусели", "hook": "текст первого слайда"}
      ]
    }
  ],
  "objectionContent": [
    {
      "objection": "возражение точно из списка",
      "count": число,
      "platform": "YouTube",
      "format": "Видео",
      "contentIdea": "конкретная идея контента которая закрывает это возражение"
    }
  ]
}`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
    const content = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const result = JSON.parse(content);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка генерации контент-стратегии" },
      { status: 500 }
    );
  }
}
