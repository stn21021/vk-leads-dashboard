import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PRODUCTS_CONTEXT } from "@/app/lib/analyze-utils";
import { requireAdmin } from "@/app/lib/auth-server";

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(request: Request) {
  const deny = requireAdmin(request);
  if (deny) return deny;

  try {
    const { topic, topPains, topObjections } = await request.json() as {
      topic: string;
      topPains?: { label: string; count: number }[];
      topObjections?: { label: string; count: number }[];
    };

    if (!topic?.trim()) {
      return NextResponse.json({ error: "Тема не указана" }, { status: 400 });
    }

    const painsText = topPains?.length
      ? `РЕАЛЬНЫЕ БОЛИ АУДИТОРИИ:\n${topPains.slice(0, 5).map((p, i) => `${i + 1}. ${p.label} (${p.count} чел.)`).join("\n")}\n`
      : "";

    const objText = topObjections?.length
      ? `ВОЗРАЖЕНИЯ:\n${topObjections.slice(0, 3).map((o, i) => `${i + 1}. ${o.label} (${o.count} чел.)`).join("\n")}\n`
      : "";

    const prompt = `${PRODUCTS_CONTEXT}

Ты — контент-стратег фитнес-школы Культура движения.

${painsText}${objText}
ЗАПРОС: ${topic}

Создай 6 единиц контента на эту тему. Каждая — конкретная и заточенная под реальные боли аудитории.

ПРАВИЛА:
- Заголовок называет конкретную ситуацию, не общую тему
- Не "Как улучшить осанку" — а "Сидишь весь день и к вечеру спина не разгибается?"
- Текст/сценарий минимум 150 слов, практичный и полезный
- Чередуй платформы и форматы

Верни JSON строго без markdown:
{
  "ideas": [
    {
      "title": "заголовок",
      "platform": "ВКонтакте",
      "format": "Клип",
      "hook": "первая фраза до 15 слов",
      "content": "полный текст поста или подробный сценарий видео"
    }
  ]
}`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const result = JSON.parse(text);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка генерации" },
      { status: 500 }
    );
  }
}
