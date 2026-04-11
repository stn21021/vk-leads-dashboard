import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PRODUCTS_CONTEXT } from "@/app/lib/analyze-utils";

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(request: Request) {
  try {
    const { topPains, topObjections } = await request.json() as {
      topPains: {
        pain: string; count: number; hot: number; warm: number; cold: number;
        topProduct: string; topInterests: string[]; summaries: string[];
      }[];
      topObjections: { objection: string; count: number; hot: number }[];
    };

    if (!topPains?.length) {
      return NextResponse.json({ error: "Нет данных о болях" }, { status: 400 });
    }

    const painsText = topPains.map((p, i) => {
      const lines = [
        `${i + 1}. "${p.pain}" — ${p.count} чел. (горячих: ${p.hot}, тёплых: ${p.warm}, холодных: ${p.cold})`,
        p.topProduct ? `   Продукт: ${p.topProduct}` : "",
        p.topInterests?.length ? `   Интересы людей с этой болью: ${p.topInterests.join(", ")}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    }).join("\n\n");

    const objectionsText = (topObjections ?? []).map((o, i) =>
      `${i + 1}. "${o.objection}" — ${o.count} чел. (горячих с этим возражением: ${o.hot})`
    ).join("\n");

    const prompt = `${PRODUCTS_CONTEXT}

Ты создаёшь контент-план для фитнес-школы Культура движения на основе реальных данных из переписок с клиентами.

Топ боли клиентов:
${painsText}

Топ возражения:
${objectionsText || "(нет данных)"}

Платформы: ВКонтакте, YouTube, Instagram.

ТВОЯ ЗАДАЧА — создать контент, который заставляет человека сказать "это про меня!".

ПРАВИЛА:
- Хук пишется словами самого клиента — бери формулировки из "Реальные ситуации"
- Заголовок называет конкретную ситуацию, НЕ общую тему
- НЕ пиши: "Почему болит спина?" — пиши: "Сидишь 8 часов и к вечеру не разогнуться?"
- НЕ пиши: "Тренировки дома" — пиши: "20 минут утром — и тело перестало болеть"
- Фокус на горячих лидах — они готовы к покупке, не теряй их
- Хук — до 10 слов, разговорный, бьёт в конкретную боль

Верни JSON строго без markdown, без пояснений:
{
  "platformContent": [
    {
      "pain": "боль точно из списка",
      "leadsCount": число,
      "vk": [
        {"format": "Клип", "title": "конкретный заголовок ситуацией", "hook": "фраза словами клиента"},
        {"format": "Пост", "title": "конкретный заголовок", "hook": "первое предложение поста"}
      ],
      "youtube": [
        {"format": "Shorts", "title": "конкретный заголовок", "hook": "первая фраза"},
        {"format": "Видео", "title": "конкретный заголовок", "hook": "первая фраза"}
      ],
      "instagram": [
        {"format": "Reels", "title": "конкретный заголовок", "hook": "первая фраза"},
        {"format": "Карусель", "title": "конкретный заголовок", "hook": "текст первого слайда"}
      ]
    }
  ],
  "objectionContent": [
    {
      "objection": "возражение точно из списка",
      "count": число,
      "platform": "YouTube",
      "format": "Видео",
      "contentIdea": "конкретная идея как через контент закрыть это возражение — кейс, доказательство, история"
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
