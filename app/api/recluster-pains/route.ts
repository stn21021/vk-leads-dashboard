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
    const { leads } = await request.json() as {
      leads: { id: number; summary: string; mainPain: string; interests: string[]; status: string }[];
    };

    if (!leads?.length) {
      return NextResponse.json({ error: "Нет данных" }, { status: 400 });
    }

    // Build text of all summaries
    const summariesText = leads
      .filter(l => l.summary && l.summary.length > 10)
      .slice(0, 200)
      .map((l, i) => `[${i + 1}] (${l.status}) ${l.summary}`)
      .join("\n");

    const prompt = `${PRODUCTS_CONTEXT}

Ты — аналитик данных. Тебе дано ${leads.length} саммари диалогов с потенциальными клиентами фитнес-школы Культура движения.

САММАРИ ДИАЛОГОВ:
${summariesText}

ЗАДАЧА 1 — Топ болей:
Прочитай все саммари и выяви 8-10 РЕАЛЬНЫХ болей, которые встречаются в этих текстах.
- Называй боль конкретно: не "проблемы со спиной", а "боль в пояснице при длительном сидении"
- Считай количество людей с каждой болью (приблизительно)
- Объединяй похожие боли под одним названием
- НЕ пиши "Неизвестно" или "Не определена" — если боль непонятна, пропусти

ЗАДАЧА 2 — Состояние аудитории:
Напиши честный аналитический вывод в 4-5 предложениях:
- Кто эти люди, что их объединяет
- Главные запросы прямо сейчас
- Насколько они готовы к покупке
- Что им мешает

Верни JSON строго без markdown:
{
  "pains": [
    { "label": "конкретное описание боли", "count": число }
  ],
  "summary": "4-5 предложений о состоянии аудитории"
}`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const result = JSON.parse(text);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка анализа" },
      { status: 500 }
    );
  }
}
