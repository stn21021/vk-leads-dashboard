import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const PRODUCTS_CONTEXT = `
Ты — аналитик для фитнес-школы Sparta Amazonky. Анализируешь диалоги потенциальных клиентов из ВКонтакте.

ПРОДУКТЫ КОМПАНИИ:

1. МАГИЯ ТЕЛА (флагман, 49 900 руб / рассрочка 4158 руб×12)
   - Программа трансформации тела: 3 месяца, 4 модуля параллельно, 24 тренировки
   - Дома, без зала, 20-60 мин/день, любой уровень
   - Модули: Силовой (24 тренировки) + Мобильность/зарядки + Пилатес/восстановление + Скилл-тренировки
   - Месяц 1: Фундамент (кор, осанка, тонус) | Месяц 2: Развитие (сила, новые паттерны) | Месяц 3: Трансформация
   - Закрывает боли: скованность тела, боль в спине/шее/суставах, травмы, усталость, сидячая работа, хочется быть в форме
   - Включает: видеоуроки на Getcourse, чат с ОС, созвон с тренером, поддержка в Telegram, группа или индивидуально

2. ПРЫЖКИ (6 990 руб/мес или 14 990 руб/3 мес, 3 ступени)
   - Ступень 1 (Новички): фундамент, стабилизация, координация, ОФП
   - Ступень 2 (Любители): взрывная сила, техника прыжка, силовая выносливость
   - Ступень 3 (Профи): сложные прыжки, зал, работа на спортивный результат
   - Для спортсменов, тренеров, любителей фитнеса

3. СИЛА МОБИЛЬНОСТИ (6 990 руб самостоятельный / 13 990 руб базовый)
   - 1 месяц, 16 тренировок в записи, дома, 45 мин/день
   - Автор: Кирилл Романчак, научная база (Платонов В.Н.)
   - Базовый тариф: чат + блоки "Стойка на руках", "Шпагат/тазовое дно", "Осанка"
   - Результаты: гибкость, осанка, снижение болей, энергия, меньше травм
`;

interface Dialog {
  id: number;
  userName: string;
  messageCount: number;
  lastDate: string;
  text: string;
}

interface LeadAnalysis {
  id: number;
  userName: string;
  messageCount: number;
  lastDate: string;
  status: "hot" | "warm" | "cold";
  summary: string;
  mainPain: string;
  interests: string[];
  objections: string[];
  nextStep: string;
  recommendedProduct: string;
}

interface AnalysisResult {
  leads: LeadAnalysis[];
  insights: {
    topPains: { label: string; count: number }[];
    topQuestions: { label: string; count: number }[];
    topObjections: { label: string; count: number }[];
    contentRecommendations: {
      priority: "urgent" | "warm" | "education";
      title: string;
      format: string;
      pain: string;
      leadsCount: number;
    }[];
    summary: string;
  };
}

export async function POST(request: Request) {
  try {
    const { dialogs }: { dialogs: Dialog[] } = await request.json();

    if (!dialogs || dialogs.length === 0) {
      return NextResponse.json({ error: "Нет диалогов для анализа" }, { status: 400 });
    }

    // Analyze each dialog individually
    const leads: LeadAnalysis[] = [];

    for (const dialog of dialogs) {
      const prompt = `${PRODUCTS_CONTEXT}

ДИАЛОГ (${dialog.userName}, ${dialog.messageCount} сообщений):
${dialog.text}

Проанализируй этот диалог и верни JSON строго в таком формате (без markdown, только JSON):
{
  "status": "hot|warm|cold",
  "summary": "краткое саммари диалога в 1-2 предложения",
  "mainPain": "главная боль/проблема клиента",
  "interests": ["интерес 1", "интерес 2"],
  "objections": ["возражение 1"],
  "nextStep": "конкретное следующее действие менеджера",
  "recommendedProduct": "название продукта который лучше всего подойдёт"
}

Критерии статуса:
- hot: готов купить, спрашивает про оплату/старт, высокий интерес
- warm: интересуется, задаёт вопросы, но не готов сразу
- cold: пассивный интерес, много сомнений, не отвечает или просит подумать`;

      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      });

      try {
        const content = message.content[0].type === "text" ? message.content[0].text : "{}";
        const analysis = JSON.parse(content);
        leads.push({
          id: dialog.id,
          userName: dialog.userName,
          messageCount: dialog.messageCount,
          lastDate: dialog.lastDate,
          ...analysis,
        });
      } catch {
        leads.push({
          id: dialog.id,
          userName: dialog.userName,
          messageCount: dialog.messageCount,
          lastDate: dialog.lastDate,
          status: "cold",
          summary: "Не удалось проанализировать диалог",
          mainPain: "Неизвестно",
          interests: [],
          objections: [],
          nextStep: "Проверить диалог вручную",
          recommendedProduct: "Неизвестно",
        });
      }
    }

    // Generate strategic insights based on all leads
    const leadsJson = JSON.stringify(leads.map(l => ({
      status: l.status,
      mainPain: l.mainPain,
      interests: l.interests,
      objections: l.objections,
      recommendedProduct: l.recommendedProduct,
    })));

    const insightsPrompt = `${PRODUCTS_CONTEXT}

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

    const insightsMessage = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: insightsPrompt }],
    });

    const insightsContent = insightsMessage.content[0].type === "text"
      ? insightsMessage.content[0].text
      : "{}";

    const insights = JSON.parse(insightsContent);

    const result: AnalysisResult = { leads, insights };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка анализа" },
      { status: 500 }
    );
  }
}
