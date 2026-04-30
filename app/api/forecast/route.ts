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
    const { leads, topPains, topObjections, contentPerformance, weeklySummary } = await request.json() as {
      leads: { status: string; mainPain: string; summary: string }[];
      topPains: { label: string; count: number }[];
      topObjections: { label: string; count: number }[];
      contentPerformance?: { title: string; platform: string; views: number; likes: number; new_leads: number; published_date: string }[];
      weeklySummary?: string;
    };

    const hot = leads.filter(l => l.status === "hot").length;
    const warm = leads.filter(l => l.status === "warm").length;
    const cold = leads.filter(l => l.status === "cold").length;

    const painsText = topPains.slice(0, 6).map((p, i) => `${i + 1}. ${p.label} — ${p.count} чел.`).join("\n");
    const objText = topObjections.slice(0, 4).map((o, i) => `${i + 1}. ${o.label} — ${o.count} чел.`).join("\n");

    const perfText = contentPerformance?.length
      ? `\nРЕЗУЛЬТАТЫ ПОСЛЕДНЕГО КОНТЕНТА:\n${contentPerformance.slice(0, 5).map(c =>
          `- "${c.title}" (${c.platform}): ${c.views} просмотров, ${c.likes} лайков, ${c.new_leads} новых лидов`
        ).join("\n")}`
      : "";

    const weeklyText = weeklySummary ? `\nСОСТОЯНИЕ ПРОШЛОЙ НЕДЕЛИ:\n${weeklySummary}` : "";

    const prompt = `${PRODUCTS_CONTEXT}

Ты — стратегический советник фитнес-школы Культура движения. Твоя задача — дать прогноз, который поможет превысить результаты прошлой недели.

ТЕКУЩИЕ ДАННЫЕ:
- Всего диалогов: ${leads.length}
- Горячих: ${hot} | Тёплых: ${warm} | Холодных: ${cold}

АКТУАЛЬНЫЕ БОЛИ АУДИТОРИИ:
${painsText}

ВОЗРАЖЕНИЯ:
${objText || "(нет данных)"}
${perfText}${weeklyText}

ЗАДАЧА — дай прогноз на следующую неделю:

1. ОБЩИЙ ВЫВОД (2-3 предложения): что сейчас происходит с аудиторией и почему именно сейчас важно действовать
2. ТОП-5 ДЕЙСТВИЙ: конкретные шаги по контенту с объяснением почему они дадут результат выше прошлой недели
3. ФОКУС НЕДЕЛИ: одна главная тема/боль, на которую нужно сделать ставку на этой неделе
4. РИСКИ: что может помешать росту и как избежать

Верни JSON строго без markdown:
{
  "conclusion": "2-3 предложения о текущей ситуации",
  "focusTopic": "главная тема недели — одна фраза",
  "focusReason": "почему именно эта тема сейчас",
  "actions": [
    {
      "priority": "высокий",
      "action": "конкретное действие",
      "reason": "почему это сработает",
      "platform": "ВКонтакте / YouTube / Instagram / Все",
      "expectedResult": "ожидаемый результат"
    }
  ],
  "risks": ["риск 1", "риск 2"]
}`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const result = JSON.parse(text);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка прогноза" },
      { status: 500 }
    );
  }
}
