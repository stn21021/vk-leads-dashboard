// Client-side only — do not import in server components or API routes

export interface DialogSnapshot {
  id: number;
  messageCount: number;
  lastMessageTs: number;
  analyzedAt: number;
}

export interface CachedLead {
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
  analyzedAt: number;
  isNew?: boolean;
  isUpdated?: boolean;
}

export interface ContentRec {
  priority: "urgent" | "warm" | "education";
  title: string;
  format: string;
  pain: string;
  leadsCount: number;
}

export interface ContentIdea {
  priority: "urgent" | "warm" | "education";
  platform: "ВКонтакте" | "YouTube" | "Instagram";
  title: string;
  format: string;
  pain: string;
  hook: string;
  leadsCount: number;
}

export interface Insights {
  topPains: { label: string; count: number }[];
  topQuestions: { label: string; count: number }[];
  topObjections: { label: string; count: number }[];
  contentRecommendations: ContentRec[];
  contentIdeas: ContentIdea[];
  summary: string;
}

export interface DashboardCache {
  version: 2;
  lastSyncAt: number;
  leads: CachedLead[];
  insights: Insights | null;
  dialogSnapshots: Record<number, DialogSnapshot>;
}

const CACHE_KEY = "vk_dashboard_cache";
const CACHE_VERSION = 2;

export function loadCache(): DashboardCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardCache;
    if (parsed.version !== CACHE_VERSION) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCache(cache: DashboardCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage quota exceeded — silently ignore
  }
}

export function clearCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

export function emptyCache(): DashboardCache {
  return {
    version: 2,
    lastSyncAt: 0,
    leads: [],
    insights: null,
    dialogSnapshots: {},
  };
}

export function upsertLeads(
  existing: CachedLead[],
  incoming: CachedLead[]
): CachedLead[] {
  const map = new Map<number, CachedLead>(existing.map(l => [l.id, l]));
  for (const lead of incoming) {
    map.set(lead.id, lead);
  }
  // Sort: hot first, then warm, then cold
  const order = { hot: 0, warm: 1, cold: 2 };
  return Array.from(map.values()).sort(
    (a, b) => order[a.status] - order[b.status]
  );
}

export function exportToCSV(leads: CachedLead[]): string {
  const headers = [
    "Имя",
    "Статус",
    "Главная боль",
    "Саммари",
    "Следующий шаг",
    "Продукт",
    "Сообщений",
    "Дата",
    "Проанализирован",
  ];

  const rows = leads.map(l => [
    l.userName,
    l.status === "hot" ? "Горячий" : l.status === "warm" ? "Тёплый" : "Холодный",
    l.mainPain,
    l.summary,
    l.nextStep,
    l.recommendedProduct,
    l.messageCount,
    l.lastDate,
    new Date(l.analyzedAt).toLocaleDateString("ru-RU"),
  ]);

  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  return [headers, ...rows].map(row => row.map(escape).join(",")).join("\n");
}

export function downloadCSV(leads: CachedLead[]): void {
  const csv = exportToCSV(leads);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
