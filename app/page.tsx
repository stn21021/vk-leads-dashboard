"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  RefreshCw, BarChart2, PenLine, CalendarDays, Calendar,
  Plus, Trash2, ChevronLeft, ChevronRight, Loader2, Check, X,
} from "lucide-react";
import {
  emptyCache, upsertLeads, loadCache, saveCache, DashboardCache, CachedLead,
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function computeTopPains(leads: CachedLead[]) {
  const map = new Map<string, number>();
  for (const l of leads) {
    if (l.mainPain) map.set(l.mainPain, (map.get(l.mainPain) || 0) + 1);
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
  const [activeTab, setActiveTab] = useState<"analysis" | "create" | "plan" | "calendar">("analysis");
  const [cache, setCache] = useState<DashboardCache>(emptyCache());
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

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

  // Calendar tab
  const [calMonth, setCalMonth] = useState(getCurrentYM());
  const [calEntries, setCalEntries] = useState<CalendarEntry[]>([]);
  const [loadingCal, setLoadingCal] = useState(false);

  // Add-to-calendar modal
  const [addModal, setAddModal] = useState<{ item: Partial<CalendarEntry> } | null>(null);
  const [addDate, setAddDate] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addingToCalendar, setAddingToCalendar] = useState(false);

  useEffect(() => {
    const c = loadCache();
    if (c) setCache(c);
  }, []);

  useEffect(() => {
    if (activeTab === "calendar") loadCalendar();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const topPains = computeTopPains(cache.leads);
  const topObjections = computeTopObjections(cache.leads);
  const hot = cache.leads.filter(l => l.status === "hot").length;
  const warm = cache.leads.filter(l => l.status === "warm").length;
  const cold = cache.leads.filter(l => l.status === "cold").length;

  // ─── Sync 300 dialogs ──────────────────────────────────────────────────────

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      // 1. Scan 3 × 100 metadata
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

      // 2. Load snapshots from Supabase
      setProgress({ label: "Проверяем новые диалоги…", current: 0, total: 1 });
      const snapsRes = await fetch("/api/db/snapshots");
      const snapsData = await safeJson(snapsRes);
      const snapshots = (snapsData.snapshots || {}) as Record<number, { messageCount: number; lastMessageTs: number; analyzedAt: number }>;

      // 3. Diff — only NEW (never analyzed before)
      const { newIds } = diffDialogs(allMeta, snapshots);

      if (newIds.length === 0) {
        setSyncMsg("Новых диалогов нет — все уже проанализированы ранее");
        setProgress(null);
        setSyncing(false);
        return;
      }

      // 4. Fetch full history for new dialogs
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

      // 5. Analyze in batches of 10
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

      // 6. Save leads to Supabase
      setProgress({ label: "Сохраняем результаты…", current: 0, total: 1 });
      if (allLeads.length > 0) {
        await fetch("/api/db/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads: allLeads.map(l => ({ ...l, analyzedAt: Date.now() })) }),
        });
      }

      // 7. Save snapshots for new dialogs
      const newSnapshots: Record<number, { messageCount: number; lastMessageTs: number; analyzedAt: number }> = {};
      for (const meta of allMeta.filter(m => newIds.includes(m.id))) {
        newSnapshots[meta.id] = { messageCount: meta.messageCount, lastMessageTs: meta.lastMessageTs, analyzedAt: Date.now() };
      }
      if (Object.keys(newSnapshots).length > 0) {
        await fetch("/api/db/snapshots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshots: newSnapshots }),
        });
      }

      // 8. Update local cache
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

  // ─── Calendar CRUD ─────────────────────────────────────────────────────────

  const loadCalendar = useCallback(async () => {
    setLoadingCal(true);
    try {
      const res = await fetch("/api/db/calendar");
      const data = await safeJson(res);
      setCalEntries((data.entries as CalendarEntry[]) || []);
    } catch { /* silent */ } finally {
      setLoadingCal(false);
    }
  }, []);

  const openAddModal = useCallback((item: Partial<CalendarEntry>, date = "") => {
    setAddModal({ item });
    setAddDate(date);
    setAddTitle(item.title || "");
  }, []);

  const handleAddToCalendar = useCallback(async () => {
    const title = addModal?.item.title || addTitle;
    if (!title.trim() || !addDate) return;
    setAddingToCalendar(true);
    try {
      await fetch("/api/db/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...addModal?.item, title, scheduled_date: addDate, status: "idea" }),
      });
      setAddModal(null);
      setAddDate("");
      setAddTitle("");
      if (activeTab === "calendar") await loadCalendar();
    } catch { /* silent */ } finally {
      setAddingToCalendar(false);
    }
  }, [addModal, addTitle, addDate, activeTab, loadCalendar]);

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
  ];

  // ─── Calendar grid ─────────────────────────────────────────────────────────

  const calMonthEntries = calEntries.filter(e => e.scheduled_date?.startsWith(calMonth));
  const todayStr = new Date().toISOString().slice(0, 10);

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
              <button onClick={handleSync} disabled={syncing} className="d-btn d-btn-primary">
                {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {syncing ? "Анализируем…" : "Запустить анализ"}
              </button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="d-card p-5">
                  <p className="d-section-title">Топ болей аудитории</p>
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
                  onChange={e => setPlanMonth(e.target.value)}
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

            <div className="space-y-2">
              {monthPlan.map((item, i) => (
                <div key={i} className="d-card p-4 flex items-center gap-4">
                  <div className="text-[22px] font-black leading-none w-8 text-center shrink-0" style={{ color: "var(--accent-orange)" }}>
                    {item.day}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold leading-snug">{item.title}</p>
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--muted)" }}>{item.pain}</p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PLATFORM_COLOR[item.platform] || "bg-slate-100 text-slate-600"}`}>{item.platform}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{item.format}</span>
                      {item.type && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-500">{TYPE_LABEL[item.type] || item.type}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => openAddModal(
                      { title: item.title, platform: item.platform, format: item.format, pain: item.pain, hook: item.hook },
                      padDay(planMonth, item.day)
                    )}
                    className="d-btn d-btn-secondary shrink-0"
                  >
                    <Plus size={12} />
                    В календарь
                  </button>
                </div>
              ))}
            </div>
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

            {loadingCal ? (
              <div className="d-card p-12 text-center">
                <Loader2 size={24} className="animate-spin mx-auto" style={{ color: "var(--muted)" }} />
              </div>
            ) : (
              <>
                {/* Calendar grid */}
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

                {/* List view */}
                {calMonthEntries.length === 0 ? (
                  <div className="text-center py-8 text-[12px]" style={{ color: "var(--muted)" }}>
                    Нет записей на {formatMonthLabel(calMonth)}. Нажмите «Добавить» или используйте кнопки «В календарь» в других разделах.
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
      </main>

      {/* ── Add-to-Calendar Modal ──────────────────────────────────────────── */}
      {addModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="d-card p-6 w-full max-w-md" style={{ background: "var(--surface-solid)" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-bold">Добавить в календарь</h2>
              <button onClick={() => { setAddModal(null); setAddDate(""); setAddTitle(""); }} style={{ color: "var(--muted)" }}>
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

            <div className="mb-5">
              <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: "var(--muted)" }}>Дата публикации</label>
              <input
                type="date"
                value={addDate}
                onChange={e => setAddDate(e.target.value)}
                className="w-full text-[13px] p-3 rounded-xl border focus:outline-none"
                style={{ borderColor: "var(--border-solid)", background: "var(--surface-solid)" }}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAddModal(null); setAddDate(""); setAddTitle(""); }} className="d-btn d-btn-secondary">Отмена</button>
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
