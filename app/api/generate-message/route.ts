import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PRODUCTS_CONTEXT } from "@/app/lib/analyze-utils";

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(request: Request) {
  try {
    const { lead, mode } = await request.json();

    const firstName = lead.userName.split(" ")[0];

    const prompt = mode === "resurrect"
      ? `${PRODUCTS_CONTEXT}

Ты — менеджер по продажам фитнес-школы Культура движения. Напиши реанимационное сообщение в ВКонтакте — человек проявлял интерес, но перестал отвечать. Нужно мягко вернуть его в диалог.

ДАННЫЕ О КЛИЕНТЕ:
- Имя: ${firstName}
- Главная боль: ${lead.mainPain}
- Интересы: ${lead.interests?.join(", ") || "не указаны"}
- Возражения: ${lead.objections?.length ? lead.objections.join(", ") : "нет"}
- Рекомендованный продукт: ${lead.recommendedProduct}
- Контекст последнего диалога: ${lead.summary}

ТРЕБОВАНИЯ:
- Обращайся только по имени (${firstName})
- 2-4 предложения — коротко, без давления
- Не напоминай что они не отвечали, не извиняйся за напоминание
- Зайди через боль или ситуацию из контекста — покажи что помнишь о них
- Лёгкий вопрос в конце, который легко ответить (да/нет или 1-2 слова)
- Живой тон, как от знакомого человека, не как рассылка
- Без восклицательных знаков, без эмодзи

Верни только текст сообщения, без кавычек и пояснений.`
      : `${PRODUCTS_CONTEXT}

Ты — менеджер по продажам фитнес-школы Культура движения. Напиши сообщение в ВКонтакте для конкретного клиента.

ДАННЫЕ О КЛИЕНТЕ:
- Имя: ${firstName}
- Статус: ${lead.status === "hot" ? "горячий (готов купить)" : "тёплый (интересуется)"}
- Главная боль: ${lead.mainPain}
- Интересы: ${lead.interests?.join(", ") || "не указаны"}
- Возражения: ${lead.objections?.length ? lead.objections.join(", ") : "нет"}
- Рекомендованный продукт: ${lead.recommendedProduct}
- Контекст диалога: ${lead.summary}

ТРЕБОВАНИЯ К СООБЩЕНИЮ:
- Обращайся по имени (только имя, без фамилии)
- 3-5 предложений, не длиннее
- Начни с признания их боли или ситуации — не с рекламы
- Плавно выйди на конкретный продукт как решение
- Если есть возражения — мягко закрой одно из них
- Живой язык, без канцелярщины, без восклицательных знаков через слово
- Заверши призывом к действию (задать вопрос, записаться, узнать детали)

Верни только текст сообщения, без кавычек и пояснений.`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    return NextResponse.json({ message: text });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка генерации" },
      { status: 500 }
    );
  }
}
