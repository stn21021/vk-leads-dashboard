import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PRODUCTS_CONTEXT } from "@/app/lib/analyze-utils";
import { requireAdmin } from "@/app/lib/auth-server";

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(request: Request) {
  const deny = requireAdmin(request);
  if (deny) return deny;
  try {
    const { topPains, topObjections } = await request.json() as {
      topPains: {
        pain: string; count: number; hot: number; warm: number; cold: number;
        topProduct: string; topInterests: string[];
      }[];
      topObjections: { objection: string; count: number; hot: number }[];
    };

    if (!topPains?.length) {
      return NextResponse.json({ error: "Нет данных о болях" }, { status: 400 });
    }

    const painsText = topPains.map((p, i) => {
      const lines = [
        `${i + 1}. "${p.pain}" — ${p.count} чел. (горячих: ${p.hot}, тёплых: ${p.warm})`,
        p.topProduct ? `   Закрывает продукт: ${p.topProduct}` : "",
        p.topInterests?.length ? `   Интересы: ${p.topInterests.join(", ")}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    }).join("\n\n");

    const objectionsText = (topObjections ?? []).map((o, i) =>
      `${i + 1}. "${o.objection}" — ${o.count} чел. (горячих: ${o.hot})`
    ).join("\n");

    const prompt = `${PRODUCTS_CONTEXT}

Ты — контент-стратег фитнес-школы Культура движения. У тебя есть реальные данные из переписок с потенциальными клиентами.

РЕАЛЬНЫЕ БОЛИ КЛИЕНТОВ (из диалогов):
${painsText}

ВОЗРАЖЕНИЯ:
${objectionsText || "(нет данных)"}

Создай 12 конкретных идей для контента. Каждая идея — это готовый заголовок для поста/видео который человек увидит в ленте и скажет "это про меня".

РАСПРЕДЕЛЕНИЕ:
- 4 идеи с priority "urgent" — для самых горячих болей, призывают к действию сейчас
- 4 идеи с priority "warm" — прогрев, демонстрация результатов, сравнения
- 4 идеи с priority "education" — обучающий контент, мифы, объяснения

ПЛАТФОРМЫ — равномерно распредели по 4 идеи на каждую:
- "ВКонтакте" — Клип или Пост
- "YouTube" — Shorts или Видео
- "Instagram" — Reels или Карусель

ПРАВИЛА для заголовков:
- Называй конкретную ситуацию, не общую тему
- НЕ "Как улучшить осанку" — а "Сидишь весь день — и к вечеру спина горбится сама собой?"
- НЕ "Тренировки дома" — а "20 минут утром — и тело перестало болеть к обеду"
- Для urgent — добавляй срочность или конкретный результат
- Для education — разбивай мифы или объясняй механизм

Верни JSON строго без markdown:
{
  "contentIdeas": [
    {
      "priority": "urgent",
      "platform": "ВКонтакте",
      "title": "конкретный заголовок",
      "format": "Клип",
      "pain": "боль из списка которую закрывает",
      "hook": "первая фраза/хук до 12 слов",
      "leadsCount": число лидов с этой болью
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
