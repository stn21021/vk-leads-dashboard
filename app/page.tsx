"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  RefreshCw, BarChart2, PenLine, CalendarDays, Calendar,
  Plus, Trash2, ChevronLeft, ChevronRight, Loader2, Check, X,
  TrendingUp, Sparkles, AlertTriangle, Target,
} from "lucide-react";
import {
  emptyCache, upsertLeads, loadCache, saveCache, DashboardCache, CachedLead, DialogSnapshot,
} from "@/app/lib/cache";
import { diffDialogs, chunkArray, ConversationMeta, LeadAnalysis, Dialog } from "@/app/lib/analyze-utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ProgressState { label: string; current: number; total: number }

interface GeneratedIdea {
  title: string; platform: string; format: string; hook: string; content: string;
}

interface DayPlan {
  day: number; title: string; platform: string; format: string;
  pain: string; hook: string; type: string;
}

interface CalendarEntry {
  id: string; title: string; platform?: string; format?: string;
  content?: string; scheduled_date?: string; status: string;
  pain?: string; hook?: string; created_at: string;
}

interface ForecastAction {
  priority: string; action: string; reason: string;
  platform: string; expectedResult: string;
}

interface ForecastData {
  conclusion: string; focusTopic: string; focusReason: string;
  actions: ForecastAction[]; risks: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const UNKNOWN_PAINS = ["неизвестно", "неизвестна", "не определена", "не определено", "нет данных", "unknown"];

function computeTopPains(leads: CachedLead[]) {
  const map = new Map<string, number>();
  for (const l of leads) {
    if (!l.mainPain) continue;
    if (UNKNOWN_PAINS.some(u => l.mainPain.toLowerCase().includes(u))) continue;
    map.set(l.mainPain, (map.get(l.mainPain) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([label, count]) => ({ label, count }));
}

function computeTopObjections(leads: CachedLead[]) {
  const map = new Map<string, number>();
  for (const l of leads) {
    for (const obj of l.objections || []) map.set(obj, (map.get(obj) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, count]) => ({ label, count }));
}

const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

function getCurrentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS_RU[parseInt(m) - 1]} ${y}`;
}

function getDaysInMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function getFirstDayOfMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const day = new Date(y, m - 1, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function padDay(ym: string, day: number) {
  return `${ym}-${String(day).padStart(2, "0")}`;
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text); } catch {
    if (text.trimStart().startsWith("<!")) { window.location.href = "/login"; throw new Error("Сессия истекла"); }
    throw new Error(`Ошибка сервера (${res.status})`);
  }
}

const PLATFORM_COLOR: Record<string, string> = {
  "ВКонтакте": "bg-blue-100 text-blue-700",
  "YouTube": "bg-red-100 text-red-700",
  "Instagram": "bg-purple-100 text-purple-700",
};

const TYPE_LABEL: Record<string, string> = {
  warm: "Прогрев", education: "Обучение", sales: "Продажи",
};

const PRIORITY_COLOR: Record<string, string> = {
  "высокий": "bg-orange-100 text-orange-700",
  "средний": "bg-blue-100 text-blue-700",
  "низкий": "bg-slate-100 text-slate-600",
};

// ─── Small components ──────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="d-stat-card">
      <p className="text-[10px] font-semibold uppercase tracking-[0.7px] mb-2" style={{ color: "var(--muted)" }}>{label}</p>
      <p className={`text-[40px] font-black leading-none tracking-[-2px] ${color}`}>{value}</p>
    </div>
  );
}

function PBar({ label, current, total }: ProgressState) {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 5;
  return (
    <div className="d-card p-4 mb-4">
      <div className="flex justify-between text-xs mb-2">
        <span className="text-slate-600">{label}</span>
        <span className="text-slate-400">{Math.round(pct)}%</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-slate-800 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Page() {
  const [activeTab, setActiveTab] = useState<"analysis" | "create" | "plan" | "calendar" | "forecast">("analysis");
  const [cache, setCache] = useState<DashboardCache>(emptyCache());
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Analysis extras
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [clusteredPains, setClusteredPains] = useState<{ label: string; count: number }[] | null>(null);
  const [reclustering, setReclustering] = useState(false);

  // Create tab
  const [topic, setTopic] = useState("");
  const [generatingCustom, setGeneratingCustom] = useState(false);
  const [customIdeas, setCustomIdeas] = useState<GeneratedIdea[]>([]);
  const [customError, setCustomError] = useState<string | null>(null);

  // Plan tab
  const [planMonth, setPlanMonth] = useState(getCurrentYM());
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [monthPlan, setMonthPlan] = useState<DayPlan[]>([]);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planPage, setPlanPage] = useState(0);

  // Calendar tab
  const [calMonth, setCalMonth] = useState(getCurrentYM());
  const [calEntries, setCalEntries] = useState<CalendarEntry[]>([]);
  const [loadingCal, setLoadingCal] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);

  // Forecast tab
  const [forecastData, setForecastData] = useState<ForecastData | null>(null);
  const [generatingForecast, setGeneratingForecast] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // Add-to-calendar modal
  const [addModal, setAddModal] = useState<{ item: Partial<CalendarEntry> } | null>(null);
  const [addDate, setAddDate] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addingToCalendar, setAddingToCalendar] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Load on mount
  useEffect(() => {
    async function init() {
      const c = loadCache();
      if (c && c.leads.length > 0) { setCache(c); return; }
      try {
        const [leadsRes, snapsRes] = await Promise.all([
          fetch("/api/db/leads"),
          fetch("/api/db/snapshots"),
        ]);
        const leadsData = await leadsRes.json();
        const snapsData = await snapsRes.json();
        const rows = (leadsData.leads as Record<string, unknown>[]) || [];
        if (!rows.length) return;
        const leads: CachedLead[] = rows.map(r => ({
          id: r.id as number,
          userName: r.user_name as string,
          messageCount: r.message_count as number,
          lastDate: r.last_date as string,
          status: r.status as "hot" | "warm" | "cold",
          summary: r.summary as string,
          mainPain: r.main_pain as string,
          interests: (r.interests as string[]) || [],
          objections: (r.objections as string[]) || [],
          nextStep: r.next_step as string,
          recommendedProduct: r.recommended_product as string,
          analyzedAt: r.analyzed_at as number || Date.now(),
        }));
        const snapshots = snapsData.snapshots as Record<number, DialogSnapshot> || {};
        const restored: DashboardCache = { version: 2, lastSyncAt: Date.now(), leads, insights: null, dialogSnapshots: snapshots };
        setCache(restored);
        saveCache(restored);
      } catch { /* silent */ }
    }
    init();
  }, []);

  useEffect(() => {
    if (activeTab === "calendar") loadCalendar();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const topPainsRaw = computeTopPains(cache.leads);
  const topPains = clusteredPains ?? topPainsRaw;
  const topObjections = computeTopObjections(cache.leads);
  const hot = cache.leads.filter(l => l.status === "hot").length;
  const warm = cache.leads.filter(l => l.status === "warm").length;
  const cold = cache.leads.filter(l => l.status === "cold").length;
  const unknownCount = cache.leads.filter(l => l.mainPain && UNKNOWN_PAINS.some(u => l.mainPain.toLowerCase().includes(u))).length;

  // ─── Sync 300 dialogs ──────────────────────────────────────────────────────

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const allMeta: ConversationMeta[] = [];
      for (let i = 0; i < 3; i++) {
        const offset = i * 100;
        setProgress({ label: `Сканируем диалоги ${offset + 1}–${offset + 100}…`, current: offset, total: 300 });
        const res = await fetch(`/api/fetch-dialogs?mode=scan&offset=${offset}`);
        const data = await safeJson(res);
        const meta = (data.meta as ConversationMeta[]) || [];
        allMeta.push(...meta);
        if (meta.length < 100) break;
      }

      setProgress({ label: "Проверяем новые диалоги…", current: 0, total: 1 });
      const snapsRes = await fetch("/api/db/snapshots");
      const snapsData = await safeJson(snapsRes);
      const snapshots = (snapsData.snapshots || {}) as Record<number, { messageCount: number; lastMessageTs: number; analyzedAt: number }>;

      const { newIds } = diffDialogs(allMeta, snapshots);

      if (newIds.length === 0) {
        setSyncMsg("Новых диалогов нет — все уже проанализированы ранее");
        setProgress(null);
        setSyncing(false);
        return;
      }

      setProgress({ label: `Загружаем ${newIds.length} новых диалогов…`, current: 0, total: newIds.length });
      const idChunks = chunkArray(newIds, 50);
      const allDialogs: Dialog[] = [];
      for (const chunk of idChunks) {
        const res = await fetch("/api/fetch-dialogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ peerIds: chunk }),
        });
        const data = await safeJson(res);
        allDialogs.push(...((data.dialogs as Dialog[]) || []));
      }

      const batches = chunkArray(allDialogs, 10);
      const allLeads: LeadAnalysis[] = [];
      for (let i = 0; i < batches.length; i++) {
        setProgress({
          label: `Анализируем диалоги (${Math.min((i + 1) * 10, allDialogs.length)} / ${allDialogs.length})…`,
          current: i * 10,
          total: allDialogs.length,
        });
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dialogs: batches[i] }),
        });
        const data = await safeJson(res);
        allLeads.push(...((data.leads as LeadAnalysis[]) || []));
      }

      setProgress({ label: "Сохраняем результаты…", current: 0, total: 1 });
      if (allLeads.length > 0) {
        await fetch("/api/db/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads: allLeads.map(l => ({ ...l, analyzedAt: Date.now() })) }),
        });
      }

      const newSnapshots: Record<number, DialogSnapshot> = {};
      for (const meta of allMeta.filter(m => newIds.includes(m.id))) {
        newSnapshots[meta.id] = { id: meta.id, messageCount: meta.messageCount, lastMessageTs: meta.lastMessageTs, analyzedAt: Date.now() };
      }
      if (Object.keys(newSnapshots).length > 0) {
        await fetch("/api/db/snapshots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshots: newSnapshots }),
        });
      }

      const newCachedLeads: CachedLead[] = allLeads.map(l => ({ ...l, analyzedAt: Date.now(), isNew: true }));
      const updatedCache: DashboardCache = {
        ...cache,
        version: 2,
        lastSyncAt: Date.now(),
        leads: upsertLeads(cache.leads, newCachedLeads),
        dialogSnapshots: { ...cache.dialogSnapshots, ...newSnapshots },
      };
      setCache(updatedCache);
      saveCache(updatedCache);
      setSyncMsg(`Готово: проанализировано ${allLeads.length} новых диалогов из ${newIds.length}`);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Ошибка синхронизации");
    } finally {
      setProgress(null);
      setSyncing(false);
    }
  }, [cache]);

  // ─── Recluster pains + AI summary ─────────────────────────────────────────

  const handleRecluster = useCallback(async () => {
    if (!cache.leads.length) return;
    setReclustering(true);
    setAiSummary(null);
    try {
      const res = await fetch("/api/recluster-pains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: cache.leads.map(l => ({
            id: l.id, summary: l.summary, mainPain: l.mainPain,
            interests: l.interests, status: l.status,
          })),
        }),
      });
      const data = await safeJson(res);
      if (data.error) throw new Error(data.error as string);
      if (data.pains) setClusteredPains(data.pains as { label: string; count: number }[]);
      if (data.summary) setAiSummary(data.summary as string);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Ошибка анализа болей");
    } finally {
      setReclustering(false);
    }
  }, [cache.leads]);

  // ─── Generate custom content ───────────────────────────────────────────────

  const handleGenerateCustom = useCallback(async () => {
    if (!topic.trim()) return;
    setGeneratingCustom(true);
    setCustomError(null);
    setCustomIdeas([]);
    try {
      const res = await fetch("/api/content-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, topPains, topObjections }),
      });
      const data = await safeJson(res);
      if (data.error) throw new Error(data.error as string);
      setCustomIdeas((data.ideas as GeneratedIdea[]) || []);
    } catch (e) {
      setCustomError(e instanceof Error ? e.message : "Ошибка генерации");
    } finally {
      setGeneratingCustom(false);
    }
  }, [topic, topPains, topObjections]);

  // ─── Generate content plan ─────────────────────────────────────────────────

  const handleGeneratePlan = useCallback(async () => {
    if (!topPains.length) { setPlanError("Нет данных о болях. Сначала запустите анализ."); return; }
    setGeneratingPlan(true);
    setPlanError(null);
    setMonthPlan([]);
    setPlanPage(0);
    try {
      const res = await fetch("/api/content-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: planMonth, topPains, topObjections }),
      });
      const data = await safeJson(res);
      if (data.error) throw new Error(data.error as string);
      setMonthPlan((data.plan as DayPlan[]) || []);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "Ошибка генерации плана");
    } finally {
      setGeneratingPlan(false);
    }
  }, [planMonth, topPains, topObjections]);

  // ─── Generate forecast ─────────────────────────────────────────────────────

  const handleGenerateForecast = useCallback(async () => {
    if (!cache.leads.length) { setForecastError("Нет данных. Сначала запустите анализ."); return; }
    setGeneratingForecast(true);
    setForecastError(null);
    setForecastData(null);
    try {
      const perfRes = await fetch("/api/db/content-performance");
      const perfData = await safeJson(perfRes);
      const res = await fetch("/api/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: cache.leads.map(l => ({ status: l.status, mainPain: l.mainPain, summary: l.summary })),
          topPains,
          topObjections,
          contentPerformance: perfData.items || [],
        }),
      });
      const data = await safeJson(res);
      if (data.error) throw new Error(data.error as string);
      setForecastData(data as unknown as ForecastData);
    } catch (e) {
      setForecastError(e instanceof Error ? e.message : "Ошибка генерации прогноза");
    } finally {
      setGeneratingForecast(false);
    }
  }, [cache.leads, topPains, topObjections]);

  // ─── Calendar CRUD ─────────────────────────────────────────────────────────

  const loadCalendar = useCallback(async () => {
    setLoadingCal(true);
    setCalError(null);
    try {
      const res = await fetch("/api/db/calendar");
      const data = await safeJson(res);
      if (data.error) throw new Error(data.error as string);
      setCalEntries((data.entries as CalendarEntry[]) || []);
    } catch (e) {
      setCalError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoadingCal(false);
    }
  }, []);

  const openAddModal = useCallback((item: Partial<CalendarEntry>, date = "") => {
    setAddModal({ item });
    setAddDate(date);
    setAddTitle(item.title || "");
    setAddError(null);
  }, []);

  const handleAddToCalendar = useCallback(async () => {
    const title = addModal?.item.title || addTitle;
    if (!title.trim() || !addDate) return;
    setAddingToCalendar(true);
    setAddError(null);
    try {
      const res = await fetch("/api/db/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...addModal?.item, title, scheduled_date: addDate, status: "idea" }),
      });
      const data = await safeJson(res);
      if (data.error) throw new Error(data.error as string);
      setAddModal(null);
      setAddDate("");
      setAddTitle("");
      // Reload calendar entries
      const calRes = await fetch("/api/db/calendar");
      const calData = await safeJson(calRes);
      setCalEntries((calData.entries as CalendarEntry[]) || []);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Ошибка сохранения. Убедитесь что таблица calendar_entries создана в Supabase.");
    } finally {
      setAddingToCalendar(false);
    }
  }, [addModal, addTitle, addDate]);

  const deleteEntry = useCallback(async (id: string) => {
    await fetch("/api/db/calendar", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setCalEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  const updateStatus = useCallback(async (id: string, status: string) => {
    await fetch("/api/db/calendar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, updates: { status } }),
    });
    setCalEntries(prev => prev.map(e => e.id === id ? { ...e, status } : e));
  }, []);

  // ─── Nav ───────────────────────────────────────────────────────────────────

  const NAV = [
    { id: "analysis" as const, label: "Анализ", icon: BarChart2 },
    { id: "create" as const, label: "Создать контент", icon: PenLine },
    { id: "plan" as const, label: "Контент-план", icon: CalendarDays },
    { id: "calendar" as const, label: "Календарь", icon: Calendar },
    { id: "forecast" as const, label: "Прогноз", icon: TrendingUp },
  ];

  const calMonthEntries = calEntries.filter(e => e.scheduled_date?.startsWith(calMonth));
  const todayStr = new Date().toISOString().slice(0, 10);
  const planPages = Math.ceil(monthPlan.length / 10);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="d-layout">
      {/* Sidebar */}
      <aside className="d-sidebar">
        <div className="d-brand">
          <p className="text-[13px] font-bold tracking-tight" style={{ color: "var(--text)" }}>Культура движения</p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>Контент-стратег</p>
        </div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)} className={`d-nav-item ${activeTab === id ? "active" : ""}`}>
            <Icon size={14} />
            {label}
          </button>
        ))}
      </aside>

      {/* Main */}
      <main className="d-main">

        {/* ── Analysis Tab ──────────────────────────────────────────────────── */}
        {activeTab === "analysis" && (
          <div>
            <div className="d-topbar">
              <div>
                <h1 className="text-[18px] font-bold tracking-tight">Анализ аудитории</h1>
                {cache.lastSyncAt > 0 && (
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>
                    Последний анализ: {new Date(cache.lastSyncAt).toLocaleString("ru-RU")}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {cache.leads.length > 0 && (
                  <button onClick={handleRecluster} disabled={reclustering} className="d-btn d-btn-secondary">
                    {reclustering ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    {reclustering ? "Анализируем…" : "Уточнить боли"}
                  </button>
                )}
                <button onClick={handleSync} disabled={syncing} className="d-btn d-btn-primary">
                  {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {syncing ? "Анализируем…" : "Запустить анализ"}
                </button>
              </div>
            </div>

            {progress && <PBar {...progress} />}

            {syncMsg && (
              <div className="d-card p-3 mb-4 text-[12px]" style={{ color: "var(--muted)" }}>{syncMsg}</div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <StatCard label="Всего диалогов" value={cache.leads.length} color="text-slate-800" />
              <StatCard label="Горячих" value={hot} color="text-orange-500" />
              <StatCard label="Тёплых" value={warm} color="text-blue-500" />
              <StatCard label="Холодных" value={cold} color="text-slate-400" />
            </div>

            {cache.leads.length === 0 ? (
              <div className="d-card p-12 text-center">
                <p className="text-[13px]" style={{ color: "var(--muted)" }}>
                  Нажмите «Запустить анализ» — система прочитает последние 300 диалогов VK,
                  новые проанализирует, уже прочитанные пропустит
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* AI Summary */}
                {aiSummary && (
                  <div className="d-summary-card">
                    <p className="text-[10px] font-bold uppercase tracking-[0.8px] mb-3 text-orange-400">Состояние аудитории</p>
                    <p className="text-[13px] leading-relaxed text-white/90">{aiSummary}</p>
                  </div>
                )}

                {!aiSummary && unknownCount > 0 && (
                  <div className="d-card p-4 flex items-center gap-3">
                    <AlertTriangle size={16} className="text-orange-400 shrink-0" />
                    <p className="text-[12px] flex-1" style={{ color: "var(--muted)" }}>
                      У {unknownCount} из {cache.leads.length} диалогов боль не определена. Нажмите «Уточнить боли» — ИИ проанализирует саммари и восстановит реальные боли.
                    </p>
                    <button onClick={handleRecluster} disabled={reclustering} className="d-btn d-btn-secondary shrink-0">
                      {reclustering ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      Уточнить
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="d-card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="d-section-title" style={{ marginBottom: 0 }}>Топ болей аудитории</p>
                      {clusteredPains && <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 font-semibold">AI уточнено</span>}
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={topPains} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                        <XAxis type="number" hide />
                        <YAxis
                          type="category" dataKey="label" width={148}
                          tick={{ fontSize: 11, fill: "#475569" }}
                          tickFormatter={s => s.length > 24 ? s.slice(0, 24) + "…" : s}
                        />
                        <Tooltip formatter={(v) => [`${v} чел.`, "Кол-во"]} />
                        <Bar dataKey="count" radius={4}>
                          {topPains.map((_, i) => (
                            <Cell key={i} fill={i === 0 ? "#f04e00" : i === 1 ? "#ff7a3d" : "#94a3b8"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="d-card p-5">
                    <p className="d-section-title">Топ возражений</p>
                    {topObjections.length === 0 ? (
                      <p className="text-[12px] mt-2" style={{ color: "var(--muted)" }}>Нет данных</p>
                    ) : (
                      <div className="space-y-3 mt-2">
                        {topObjections.map((obj, i) => (
                          <div key={i}>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span style={{ color: "var(--text)" }} className="truncate pr-2">{obj.label}</span>
                              <span className="font-semibold shrink-0" style={{ color: "var(--muted)" }}>{obj.count}</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-slate-600"
                                style={{ width: `${Math.min((obj.count / (topObjections[0]?.count || 1)) * 100, 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Create Content Tab ────────────────────────────────────────────── */}
        {activeTab === "create" && (
          <div>
            <div className="d-topbar">
              <h1 className="text-[18px] font-bold tracking-tight">Создать контент</h1>
            </div>

            <div className="d-card p-5 mb-5">
              <p className="d-section-title">Тема или запрос</p>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerateCustom(); }}
                placeholder="Например: боль в пояснице у людей с сидячей работой, как начать заниматься дома с нуля, почему обычный фитнес не помогает при грыже…"
                rows={3}
                className="w-full text-[13px] p-3 rounded-xl border resize-none focus:outline-none focus:ring-2 focus:ring-slate-200"
                style={{ borderColor: "var(--border-solid)", background: "var(--surface-solid)" }}
              />
              <div className="flex items-center justify-between mt-3">
                <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                  {topPains.length > 0 ? `Контекст: ${cache.leads.length} диалогов, ${topPains.length} болей` : "Для лучшего результата сначала запустите анализ"}
                </p>
                <button onClick={handleGenerateCustom} disabled={generatingCustom || !topic.trim()} className="d-btn d-btn-primary">
                  {generatingCustom ? <Loader2 size={13} className="animate-spin" /> : <PenLine size={13} />}
                  {generatingCustom ? "Генерируем…" : "Создать контент"}
                </button>
              </div>
            </div>

            {customError && <div className="d-card p-4 mb-4 text-[12px] text-red-600">{customError}</div>}

            <div className="space-y-4">
              {customIdeas.map((idea, i) => (
                <div key={i} className="d-card p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold leading-snug">{idea.title}</p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PLATFORM_COLOR[idea.platform] || "bg-slate-100 text-slate-600"}`}>{idea.platform}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{idea.format}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => openAddModal({ title: idea.title, platform: idea.platform, format: idea.format, content: idea.content, hook: idea.hook })}
                      className="d-btn d-btn-secondary shrink-0"
                    >
                      <Plus size={12} />
                      В календарь
                    </button>
                  </div>
                  <p className="text-[11px] font-medium mb-3" style={{ color: "var(--muted)" }}>Хук: {idea.hook}</p>
                  <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text)" }}>{idea.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Content Plan Tab ──────────────────────────────────────────────── */}
        {activeTab === "plan" && (
          <div>
            <div className="d-topbar">
              <h1 className="text-[18px] font-bold tracking-tight">Контент-план</h1>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="month"
                  value={planMonth}
                  onChange={e => { setPlanMonth(e.target.value); setMonthPlan([]); setPlanPage(0); }}
                  className="text-[12px] px-3 py-2 rounded-xl border focus:outline-none"
                  style={{ borderColor: "var(--border-solid)", background: "var(--surface-solid)" }}
                />
                <button onClick={handleGeneratePlan} disabled={generatingPlan} className="d-btn d-btn-primary">
                  {generatingPlan ? <Loader2 size={13} className="animate-spin" /> : <CalendarDays size={13} />}
                  {generatingPlan ? "Генерируем…" : "Создать план"}
                </button>
              </div>
            </div>

            {planError && <div className="d-card p-4 mb-4 text-[12px] text-red-600">{planError}</div>}

            {monthPlan.length === 0 && !generatingPlan && (
              <div className="d-card p-12 text-center">
                <p className="text-[13px]" style={{ color: "var(--muted)" }}>
                  {topPains.length === 0
                    ? "Сначала запустите анализ диалогов — он нужен для создания плана"
                    : "Нажмите «Создать план» для генерации контент-плана на месяц"}
                </p>
              </div>
            )}

            {monthPlan.length > 0 && (
              <>
                {/* Pagination */}
                <div className="flex gap-2 mb-4 flex-wrap">
                  {Array.from({ length: planPages }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPlanPage(i)}
                      className={`d-btn ${planPage === i ? "d-btn-primary" : "d-btn-secondary"}`}
                      style={{ fontSize: "11px", padding: "6px 12px" }}
                    >
                      {i * 10 + 1}–{Math.min((i + 1) * 10, monthPlan.length)} день
                    </button>
                  ))}
                </div>

                {/* Grid of cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {monthPlan.slice(planPage * 10, planPage * 10 + 10).map((item, i) => (
                    <div key={i} className="d-card p-4 flex flex-col gap-2 min-h-[220px]">
                      <div className="text-[32px] font-black leading-none" style={{ color: "var(--accent-orange)" }}>
                        {item.day}
                      </div>
                      <p className="text-[12px] font-semibold leading-snug flex-1">{item.title}</p>
                      <p className="text-[10px] line-clamp-2" style={{ color: "var(--muted)" }}>{item.pain}</p>
                      <div className="flex flex-wrap gap-1">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${PLATFORM_COLOR[item.platform] || "bg-slate-100 text-slate-600"}`}>{item.platform}</span>
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{item.format}</span>
                        {item.type && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-50 text-slate-500">{TYPE_LABEL[item.type] || item.type}</span>}
                      </div>
                      {item.hook && (
                        <p className="text-[10px] italic line-clamp-2" style={{ color: "var(--muted)" }}>{item.hook}</p>
                      )}
                      <button
                        onClick={() => openAddModal(
                          { title: item.title, platform: item.platform, format: item.format, pain: item.pain, hook: item.hook },
                          padDay(planMonth, item.day)
                        )}
                        className="d-btn d-btn-secondary mt-auto"
                        style={{ fontSize: "10px", padding: "5px 8px" }}
                      >
                        <Plus size={10} />
                        В календарь
                      </button>
                    </div>
                  ))}
                </div>

                {/* Bottom pagination */}
                {planPages > 1 && (
                  <div className="flex justify-center gap-2 mt-4">
                    <button onClick={() => setPlanPage(p => Math.max(0, p - 1))} disabled={planPage === 0} className="d-btn d-btn-secondary">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-[12px] flex items-center px-2" style={{ color: "var(--muted)" }}>
                      Страница {planPage + 1} из {planPages}
                    </span>
                    <button onClick={() => setPlanPage(p => Math.min(planPages - 1, p + 1))} disabled={planPage === planPages - 1} className="d-btn d-btn-secondary">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Calendar Tab ──────────────────────────────────────────────────── */}
        {activeTab === "calendar" && (
          <div>
            <div className="d-topbar">
              <div className="flex items-center gap-2">
                <button onClick={() => setCalMonth(shiftMonth(calMonth, -1))} className="d-btn d-btn-secondary" style={{ padding: "8px 10px" }}>
                  <ChevronLeft size={14} />
                </button>
                <h1 className="text-[18px] font-bold tracking-tight">{formatMonthLabel(calMonth)}</h1>
                <button onClick={() => setCalMonth(shiftMonth(calMonth, 1))} className="d-btn d-btn-secondary" style={{ padding: "8px 10px" }}>
                  <ChevronRight size={14} />
                </button>
              </div>
              <button onClick={() => openAddModal({})} className="d-btn d-btn-primary">
                <Plus size={13} />
                Добавить
              </button>
            </div>

            {calError && (
              <div className="d-card p-4 mb-4 text-[12px] text-red-600">
                {calError}
                {calError.includes("не существует") || calError.includes("does not exist") ? (
                  <p className="mt-1">Запустите SQL из инструкции для создания таблицы calendar_entries.</p>
                ) : null}
              </div>
            )}

            {loadingCal ? (
              <div className="d-card p-12 text-center">
                <Loader2 size={24} className="animate-spin mx-auto" style={{ color: "var(--muted)" }} />
              </div>
            ) : (
              <>
                <div className="d-card p-4 mb-4">
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(d => (
                      <div key={d} className="text-center text-[10px] font-semibold py-1" style={{ color: "var(--muted)" }}>{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: getFirstDayOfMonth(calMonth) }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}
                    {Array.from({ length: getDaysInMonth(calMonth) }).map((_, i) => {
                      const day = i + 1;
                      const dateStr = padDay(calMonth, day);
                      const dayEntries = calEntries.filter(e => e.scheduled_date === dateStr);
                      const isToday = dateStr === todayStr;
                      return (
                        <div
                          key={day}
                          className={`rounded-xl p-1.5 min-h-[60px] border cursor-pointer transition-colors ${isToday ? "border-orange-300 bg-orange-50" : "border-transparent hover:bg-slate-50"}`}
                          onClick={() => openAddModal({}, dateStr)}
                        >
                          <p className={`text-[11px] font-bold mb-1 ${isToday ? "text-orange-500" : ""}`} style={isToday ? {} : { color: "var(--muted)" }}>{day}</p>
                          <div className="space-y-0.5">
                            {dayEntries.slice(0, 2).map(e => (
                              <div
                                key={e.id}
                                onClick={ev => ev.stopPropagation()}
                                className={`text-[9px] leading-tight px-1.5 py-0.5 rounded-md truncate font-medium ${PLATFORM_COLOR[e.platform || ""] || "bg-slate-100 text-slate-600"}`}
                                title={e.title}
                              >
                                {e.title}
                              </div>
                            ))}
                            {dayEntries.length > 2 && (
                              <div className="text-[9px] px-1" style={{ color: "var(--muted)" }}>+{dayEntries.length - 2}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {calMonthEntries.length === 0 ? (
                  <div className="text-center py-8 text-[12px]" style={{ color: "var(--muted)" }}>
                    Нет записей на {formatMonthLabel(calMonth)}. Нажмите «Добавить» или используйте кнопки «В календарь».
                  </div>
                ) : (
                  <div className="space-y-2">
                    {calMonthEntries
                      .sort((a, b) => (a.scheduled_date || "").localeCompare(b.scheduled_date || ""))
                      .map(entry => (
                        <div key={entry.id} className="d-card p-4 flex items-center gap-3">
                          <div className="text-[20px] font-black w-8 text-center shrink-0" style={{ color: "var(--accent-orange)" }}>
                            {entry.scheduled_date ? parseInt(entry.scheduled_date.split("-")[2]) : "?"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold leading-snug">{entry.title}</p>
                            <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                              {entry.platform && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PLATFORM_COLOR[entry.platform] || "bg-slate-100 text-slate-600"}`}>{entry.platform}</span>}
                              {entry.format && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{entry.format}</span>}
                              <select
                                value={entry.status}
                                onChange={e => updateStatus(entry.id, e.target.value)}
                                onClick={e => e.stopPropagation()}
                                className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border-none outline-none cursor-pointer"
                              >
                                <option value="idea">Идея</option>
                                <option value="approved">Одобрено</option>
                                <option value="published">Опубликовано</option>
                              </select>
                            </div>
                            {entry.hook && <p className="text-[11px] mt-1.5 truncate" style={{ color: "var(--muted)" }}>Хук: {entry.hook}</p>}
                          </div>
                          <button onClick={() => deleteEntry(entry.id)} className="d-btn d-btn-secondary shrink-0" style={{ padding: "8px 10px", color: "#ef4444" }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Forecast Tab ──────────────────────────────────────────────────── */}
        {activeTab === "forecast" && (
          <div>
            <div className="d-topbar">
              <div>
                <h1 className="text-[18px] font-bold tracking-tight">Прогноз</h1>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>
                  Что делать на этой неделе чтобы превысить прошлую
                </p>
              </div>
              <button onClick={handleGenerateForecast} disabled={generatingForecast} className="d-btn d-btn-primary">
                {generatingForecast ? <Loader2 size={13} className="animate-spin" /> : <TrendingUp size={13} />}
                {generatingForecast ? "Анализируем…" : "Получить прогноз"}
              </button>
            </div>

            {forecastError && <div className="d-card p-4 mb-4 text-[12px] text-red-600">{forecastError}</div>}

            {!forecastData && !generatingForecast && (
              <div className="d-card p-12 text-center">
                <TrendingUp size={32} className="mx-auto mb-4" style={{ color: "var(--muted)" }} />
                <p className="text-[13px] font-semibold mb-2">Прогноз на неделю</p>
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                  {cache.leads.length === 0
                    ? "Сначала запустите анализ диалогов"
                    : `На основе ${cache.leads.length} диалогов, ${hot} горячих и ${warm} тёплых лидов, AI сформирует конкретный план действий`}
                </p>
              </div>
            )}

            {forecastData && (
              <div className="space-y-4">
                {/* Conclusion */}
                <div className="d-summary-card">
                  <p className="text-[10px] font-bold uppercase tracking-[0.8px] mb-3 text-orange-400">Общая картина</p>
                  <p className="text-[13px] leading-relaxed text-white/90">{forecastData.conclusion}</p>
                </div>

                {/* Focus */}
                <div className="d-card p-5 border-l-4" style={{ borderLeftColor: "var(--accent-orange)" }}>
                  <div className="flex items-start gap-3">
                    <Target size={18} className="text-orange-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.7px] mb-1" style={{ color: "var(--muted)" }}>Фокус недели</p>
                      <p className="text-[14px] font-bold">{forecastData.focusTopic}</p>
                      <p className="text-[12px] mt-1" style={{ color: "var(--muted)" }}>{forecastData.focusReason}</p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div>
                  <p className="d-section-title">Топ-{forecastData.actions?.length} действий на неделю</p>
                  <div className="space-y-3">
                    {forecastData.actions?.map((action, i) => (
                      <div key={i} className="d-card p-5">
                        <div className="flex items-start gap-3">
                          <div className="text-[22px] font-black w-7 text-center shrink-0" style={{ color: "var(--accent-orange)" }}>{i + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[action.priority] || "bg-slate-100 text-slate-600"}`}>
                                {action.priority}
                              </span>
                              {action.platform && (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PLATFORM_COLOR[action.platform] || "bg-slate-100 text-slate-600"}`}>
                                  {action.platform}
                                </span>
                              )}
                            </div>
                            <p className="text-[13px] font-semibold mb-1">{action.action}</p>
                            <p className="text-[12px] mb-2" style={{ color: "var(--muted)" }}>{action.reason}</p>
                            {action.expectedResult && (
                              <p className="text-[11px] font-medium text-green-600">→ {action.expectedResult}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Risks */}
                {forecastData.risks?.length > 0 && (
                  <div className="d-card p-5">
                    <p className="d-section-title">Риски</p>
                    <div className="space-y-2">
                      {forecastData.risks.map((risk, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <AlertTriangle size={13} className="text-orange-400 shrink-0 mt-0.5" />
                          <p className="text-[12px]" style={{ color: "var(--muted)" }}>{risk}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Add-to-Calendar Modal ──────────────────────────────────────────── */}
      {addModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="d-card p-6 w-full max-w-md" style={{ background: "var(--surface-solid)" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-bold">Добавить в календарь</h2>
              <button onClick={() => { setAddModal(null); setAddDate(""); setAddTitle(""); setAddError(null); }} style={{ color: "var(--muted)" }}>
                <X size={16} />
              </button>
            </div>

            {!addModal.item.title ? (
              <div className="mb-3">
                <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: "var(--muted)" }}>Название</label>
                <input
                  value={addTitle}
                  onChange={e => setAddTitle(e.target.value)}
                  placeholder="Заголовок контента"
                  className="w-full text-[13px] p-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-slate-200"
                  style={{ borderColor: "var(--border-solid)", background: "var(--surface-solid)" }}
                />
              </div>
            ) : (
              <p className="text-[12px] mb-4 line-clamp-2" style={{ color: "var(--muted)" }}>{addModal.item.title}</p>
            )}

            <div className="mb-4">
              <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: "var(--muted)" }}>Дата публикации</label>
              <input
                type="date"
                value={addDate}
                onChange={e => setAddDate(e.target.value)}
                className="w-full text-[13px] p-3 rounded-xl border focus:outline-none"
                style={{ borderColor: "var(--border-solid)", background: "var(--surface-solid)" }}
              />
            </div>

            {addError && <p className="text-[11px] text-red-600 mb-3">{addError}</p>}

            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAddModal(null); setAddDate(""); setAddTitle(""); setAddError(null); }} className="d-btn d-btn-secondary">Отмена</button>
              <button
                onClick={handleAddToCalendar}
                disabled={addingToCalendar || !addDate || !(addModal.item.title || addTitle.trim())}
                className="d-btn d-btn-primary"
              >
                {addingToCalendar ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
