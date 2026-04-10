import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PRODUCTS_CONTEXT, LeadAnalysis } from "@/app/lib/analyze-utils";

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(request: Request) {
  try {
    const { leads }: { leads: LeadAnalysis[] } = await request.json();

    if (!leads || leads.length === 0) {
      return NextResponse.json({ error: "Нет лидов для анализа" }, { status: 400 });
    }

    const leadsJson = JSON.stringify(
      leads.map(l => ({
        status: l.status,
        mainPain: l.mainPain,
        interests: l.interests,
        objections: l.objections,
        recommendedProduct: l.recommendedProduct,
      }))
    );

    const prompt = `${PRODUCTS_CONTEXT}

У нас ${leads.length} лидов. Вот их анализ:
${leadsJson}

Верни JSON строго в таком формате (без markdown, только JSON):
{
  "topPains": [
    {"label": "название боли", "count": число},
    {"label": "название боли", "count": число},
    {"label": "название боли", "count": число},
    {"label": "название боли", "count": число},
    {"label": "название боли", "count": число}
  ],
  "topQuestions": [
    {"label": "вопрос", "count": число},
    {"label": "вопрос", "count": число},
    {"label": "вопрос", "count": число},
    {"label": "вопрос", "count": число}
  ],
  "topObjections": [
    {"label": "возражение", "count": число},
    {"label": "возражение", "count": число},
    {"label": "возражение", "count": число}
  ],
  "contentRecommendations": [
    {
      "priority": "urgent",
      "title": "конкретная тема поста/видео",
      "format": "пост|видео|reels|карусель|сторис",
      "pain": "боль которую закрывает",
      "leadsCount": число лидов которым актуально
    },
    {
      "priority": "urgent",
      "title": "...",
      "format": "...",
      "pain": "...",
      "leadsCount": число
    },
    {
      "priority": "warm",
      "title": "...",
      "format": "...",
      "pain": "...",
      "leadsCount": число
    },
    {
      "priority": "warm",
      "title": "...",
      "format": "...",
      "pain": "...",
      "leadsCount": число
    },
    {
      "priority": "education",
      "title": "...",
      "format": "...",
      "pain": "...",
      "leadsCount": число
    }
  ],
  "summary": "стратегический вывод в 2-3 предложения: что сейчас важнее всего сделать с точки зрения контента и продаж"
}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0].type === "text" ? message.content[0].text : "{}";
    const insights = JSON.parse(content);

    return NextResponse.json({ insights });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка анализа инсайтов" },
      { status: 500 }
    );
  }
}
