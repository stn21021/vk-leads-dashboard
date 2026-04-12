import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PRODUCTS_CONTEXT, Dialog, LeadAnalysis } from "@/app/lib/analyze-utils";

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function analyzeOne(dialog: Dialog): Promise<LeadAnalysis> {
  const prompt = `${PRODUCTS_CONTEXT}

ДИАЛОГ (${dialog.userName}, ${dialog.messageCount} сообщений, последнее сообщение: ${dialog.lastDate}):
${dialog.text}

Проанализируй этот диалог и верни JSON строго в таком формате (без markdown, только JSON):
{
  "status": "hot|warm|cold",
  "summary": "краткое саммари диалога в 1-2 предложения",
  "mainPain": "главная боль/проблема клиента",
  "interests": ["интерес 1", "интерес 2"],
  "objections": ["возражение 1"],
  "nextStep": "конкретное следующее действие менеджера",
  "recommendedProduct": "название продукта который лучше всего подойдёт",
  "paymentDate": "YYYY-MM-DD или null — дата планируемой оплаты, вычисли от ${dialog.lastDate}",
  "paymentNote": "краткая суть обещания клиента, или null"
}

Критерии статуса:
- hot: готов купить, спрашивает про оплату/старт, высокий интерес
- warm: интересуется, задаёт вопросы, но не готов сразу
- cold: пассивный интерес, много сомнений, не отвечает или просит подумать

Критерии paymentDate (ставь ТОЛЬКО если все условия выполнены):
- клиент явно сказал "оплачу", "куплю", "переведу", "запишусь" И назвал конкретный срок ("через неделю", "в пятницу", "с зарплаты 15-го")
- ИЛИ клиент попросил реквизиты / ссылку на оплату
- Если срок нечёткий или обещание неуверенное — null`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
  const content = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const analysis = JSON.parse(content);

  return {
    id: dialog.id,
    userName: dialog.userName,
    messageCount: dialog.messageCount,
    lastDate: dialog.lastDate,
    ...analysis,
  };
}

export async function POST(request: Request) {
  try {
    const { dialogs }: { dialogs: Dialog[] } = await request.json();

    if (!dialogs || dialogs.length === 0) {
      return NextResponse.json({ leads: [] });
    }

    // Process dialogs in parallel (all at once — client controls batch size)
    const results = await Promise.allSettled(dialogs.map(analyzeOne));

    const leads: LeadAnalysis[] = results.map((result, i) => {
      if (result.status === "fulfilled") return result.value;
      return {
        id: dialogs[i].id,
        userName: dialogs[i].userName,
        messageCount: dialogs[i].messageCount,
        lastDate: dialogs[i].lastDate,
        status: "cold" as const,
        summary: "Не удалось проанализировать диалог",
        mainPain: "Неизвестно",
        interests: [],
        objections: [],
        nextStep: "Проверить диалог вручную",
        recommendedProduct: "Неизвестно",
      };
    });

    return NextResponse.json({ leads });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка анализа" },
      { status: 500 }
    );
  }
}
