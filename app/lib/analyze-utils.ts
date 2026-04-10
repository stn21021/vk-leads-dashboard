export const PRODUCTS_CONTEXT = `
Ты — аналитик для фитнес-школы Sparta Amazonky. Анализируешь диалоги потенциальных клиентов из ВКонтакте.

ПРОДУКТЫ КОМПАНИИ:

1. МАГИЯ ТЕЛА (флагман, 49 900 руб / рассрочка 4158 руб×12)
   - Программа трансформации тела: 3 месяца, 4 модуля параллельно, 24 тренировки
   - Дома, без зала, 20-60 мин/день, любой уровень, результат с первой недели
   - Модули: Силовой (24 тренировки) + Мобильность/зарядки (6 зарядок, новые каждые 2 нед) + Пилатес/восстановление (8 уроков) + Скилл-тренировки (24 комбинации)
   - Месяц 1: Фундамент (кор, осанка, тонус) | Месяц 2: Развитие (сила, новые паттерны) | Месяц 3: Трансформация (сложные комбинации, полный контроль)
   - Закрывает боли: скованность тела, боль в спине/шее/суставах, травмы, усталость, сидячая работа, хочется быть в форме
   - Уникальность vs обычный фитнес: движения во всех плоскостях (не одноплоскостные), мозг включается на 100%, новые зарядки каждые 2 нед, тело как единая система, боль уходит через движение
   - Включает: видеоуроки на Getcourse, чат с ОС (видео-отчёт), созвон с тренером, поддержка в Telegram, группа или индивидуально
   - Доступ 9 месяцев, 2 тренера в чате

2. ПРЫЖКИ (6 990 руб/мес или 14 990 руб/3 мес, 3 ступени)
   - Ступень 1 (Новички): фундамент, стабилизация, координация, ОФП, простые прыжки, связки/сухожилия
   - Ступень 2 (Любители, от 2 лет опыта): взрывная сила, техника прыжка, силовая выносливость
   - Ступень 3 (Профи/спортсмены): сложные прыжки с барьерами/в яму/с высоты, зал, работа на спортивный результат
   - Автор: Кирилл Романчак. "Прыжки — это для ВСЕГО!"

3. СИЛА МОБИЛЬНОСТИ (6 990 руб самостоятельный / 13 990 руб базовый)
   - 1 месяц, 16 тренировок в записи, дома, 45 мин/день, доступ 2 месяца
   - Автор: Кирилл Романчак, научная база (Платонов В.Н.), классика балета и гимнастики
   - Самостоятельный: 16 тренировок + лекция по мобильности (без чата)
   - Базовый: + чат + блоки "Стойка на руках", "Шпагат/тазовое дно" (Мастер спорта по гимнастике), "Осанка"
   - Результаты: гибкость, осанка, снижение болей, энергия, меньше травм
`;

export interface Dialog {
  id: number;
  userName: string;
  messageCount: number;
  lastDate: string;
  text: string;
}

export interface LeadAnalysis {
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

export interface ConversationMeta {
  id: number;
  messageCount: number;
  lastMessageTs: number;
}

export interface DiffResult {
  newIds: number[];
  changedIds: number[];
  unchangedIds: number[];
}

export function diffDialogs(
  scanResults: ConversationMeta[],
  snapshots: Record<number, { messageCount: number; lastMessageTs: number }>
): DiffResult {
  const newIds: number[] = [];
  const changedIds: number[] = [];
  const unchangedIds: number[] = [];

  for (const meta of scanResults) {
    const cached = snapshots[meta.id];
    if (!cached) {
      newIds.push(meta.id);
    } else if (
      cached.messageCount !== meta.messageCount ||
      cached.lastMessageTs !== meta.lastMessageTs
    ) {
      changedIds.push(meta.id);
    } else {
      unchangedIds.push(meta.id);
    }
  }

  return { newIds, changedIds, unchangedIds };
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
