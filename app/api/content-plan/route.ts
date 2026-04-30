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
    const { month, topPains, topObjections } = await request.json() as {
      month: string; // YYYY-MM
      topPains: { label: string; count: number }[];
      topObjections: { label: string; count: number }[];
    };

    if (!topPains?.length) {
      return NextResponse.json(
        { error: "Нет данных о болях аудитории. Сначала запустите анализ диалогов." },
        { status: 400 }
      );
    }

    const [year, monthNum] = month.split("-").map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();

    const painsText = topPains.slice(0, 6).map((p, i) => `${i + 1}. ${p.label} (${p.count} чел.)`).join("\n");
    const objText = topObjections?.slice(0, 4).map((o, i) => `${i + 1}. ${o.label}`).join("\n") || "(нет данных)";

    const prompt = `${PRODUCTS_CONTEXT}

Ты — контент-стратег фитнес-школы Культура движения.

РЕАЛЬНЫЕ БОЛИ АУДИТОРИИ:
${painsText}

ВОЗРАЖЕНИЯ:
${objText}

Создай контент-план на ${daysInMonth} дней (${month}).

ПРАВИЛА:
- Публикация каждый день (${daysInMonth} записей)
- Чередуй платформы: ВКонтакте, YouTube, Instagram
- Чередуй форматы: Клип, Пост, Reels, Shorts, Карусель, Видео
- Чередуй типы: 40% warm (прогрев/боль), 30% education (обучение), 30% sales (продажи)
- Заголовки конкретные, про реальные боли — не общие фразы

Верни JSON строго без markdown:
{
  "plan": [
    {
      "day": 1,
      "title": "конкретный заголовок",
      "platform": "ВКонтакте",
      "format": "Клип",
      "pain": "какую боль закрывает",
      "hook": "хук до 12 слов",
      "type": "warm"
    }
  ]
}`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 6000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const result = JSON.parse(text);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка генерации плана" },
      { status: 500 }
    );
  }
}
