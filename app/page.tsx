"use client";

import { useState, useEffect, useCallback } from "react";

const truncate = (s: string, n = 18) => s.length > n ? s.slice(0, n) + "…" : s;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YTick = ({ x, y, payload }: any) => (
  <text x={x - 4} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#475569">
    <title>{payload.value}</title>
    {truncate(payload.value)}
  </text>
);
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Flame, Cloud, Snowflake, RefreshCw, ChevronDown, ChevronUp,
  Zap, BookOpen, TrendingUp, MessageSquare, Users, Lightbulb,
  Download, Search, RotateCcw, Trash2, CheckCircle,
  X,
} from "lucide-react";
import {
  emptyCache, upsertLeads, downloadCSV,
  CachedLead, Insights, DashboardCache, loadCache, ContentIdea,
} from "@/app/lib/cache";
import { diffDialogs, chunkArray, ConversationMeta, LeadAnalysis } from "@/app/lib/analyze-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncBadge { newCount: number; updatedCount: number }

interface ProgressState {
  step: number;
  totalSteps: number;
  label: string;
  current: number;
  total: number;
  startedAt: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  hot:  { label: "Горячий",  icon: Flame,     color: "text-orange-500", bg: "bg-orange-50 border-orange-200",  dot: "bg-orange-500",  pill: "bg-orange-100 text-orange-700 border-orange-200" },
  warm: { label: "Тёплый",   icon: Cloud,     color: "text-blue-500",   bg: "bg-blue-50 border-blue-200",      dot: "bg-blue-400",    pill: "bg-blue-100 text-blue-700 border-blue-200" },
  cold: { label: "Холодный", icon: Snowflake, color: "text-slate-400",  bg: "bg-slate-50 border-slate-200",    dot: "bg-slate-400",   pill: "bg-slate-100 text-slate-600 border-slate-200" },
};

const PRIORITY_CONFIG = {
  urgent:    { label: "Срочно",      icon: Zap,       color: "text-orange-600", bg: "bg-orange-50 border-orange-200",  badge: "bg-orange-100 text-orange-700" },
  warm:      { label: "Прогрев",     icon: TrendingUp, color: "text-blue-600",  bg: "bg-blue-50 border-blue-200",      badge: "bg-blue-100 text-blue-700" },
  education: { label: "Образование", icon: BookOpen,  color: "text-violet-600", bg: "bg-violet-50 border-violet-200",  badge: "bg-violet-100 text-violet-700" },
};

const BATCH_SIZE = 3; // smaller batches = less wasted work if one fails

// Safe JSON parse — handles Vercel timeout plain-text responses
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // If the response is HTML, it's likely a redirect to the login page (session expired)
    if (text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html")) {
      window.location.href = "/login";
      throw new Error("Сессия истекла. Перенаправляем на страницу входа...");
    }
    throw new Error(
      res.status === 504 || res.status === 502
        ? "Превышено время ожидания сервера. Попробуйте ещё раз — часть данных уже сохранена."
        : `Ошибка сервера (${res.status}): ${text.slice(0, 80)}`
    );
  }
}

// ─── Small components ─────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="d-stat-card">
      <p className="text-[10px] font-semibold uppercase tracking-[0.7px] mb-2.5" style={{ color: "var(--muted)" }}>{label}</p>
      <p className={`text-[40px] sm:text-[44px] font-black leading-none tracking-[-2.5px] ${color}`}>{value}</p>
      {sub && <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

function ProgressBar({ progress, label, eta }: { progress: number; label: string; eta?: number }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-600">{label}</span>
        <span className="text-slate-400">
          {eta !== undefined && eta > 0 ? `~${eta} сек` : `${Math.round(progress * 100)}%`}
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-slate-800 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(progress * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}

function LeadCard({ lead }: { lead: CachedLead }) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[lead.status];
  const Icon = cfg.icon;
  return (
    <div className="d-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 text-left transition-colors"
        style={{ background: "transparent" }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.02)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        <span className={`w-2 h-2 rounded-full ${cfg.dot} flex-shrink-0`} />
        <span className="font-medium flex-1 text-sm" style={{ color: "var(--text)" }}>{lead.userName}</span>
        {lead.isNew && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-2 py-0.5 font-medium">новый</span>}
        {lead.isUpdated && <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-200 rounded-full px-2 py-0.5 font-medium">обновлён</span>}
        <span className={`flex items-center gap-1 text-xs font-medium ${cfg.color} mr-2`}>
          <Icon size={13} />{cfg.label}
        </span>
        <span className="text-xs mr-2" style={{ color: "var(--muted-light)" }}>{lead.lastDate}</span>
        {open ? <ChevronUp size={16} style={{ color: "var(--muted-light)" }} /> : <ChevronDown size={16} style={{ color: "var(--muted-light)" }} />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Саммари</p>
            <p className="text-sm" style={{ color: "var(--text)" }}>{lead.summary}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Главная боль</p>
            <p className="text-sm" style={{ color: "var(--text)" }}>{lead.mainPain}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Интересы</p>
            <div className="flex flex-wrap gap-1">
              {lead.interests.map((i, idx) => (
                <span key={idx} className="text-xs rounded-full px-2 py-0.5" style={{ background: "var(--surface-solid)", border: "1px solid var(--border-solid)", color: "var(--text)" }}>{i}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Возражения</p>
            <div className="flex flex-wrap gap-1">
              {lead.objections.map((o, idx) => (
                <span key={idx} className="text-xs bg-red-50 border border-red-100 rounded-full px-2 py-0.5 text-red-600">{o}</span>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Следующий шаг</p>
            <p className="text-sm font-medium rounded-lg px-3 py-2" style={{ background: "var(--surface-solid)", border: "1px solid var(--border-solid)", color: "var(--text)" }}>
              → {lead.nextStep}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Рекомендуемый продукт</p>
            <p className="text-sm" style={{ color: "var(--text)" }}>{lead.recommendedProduct}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ContentCard({ rec }: { rec: Insights["contentRecommendations"][0] }) {
  const cfg = PRIORITY_CONFIG[rec.priority];
  const Icon = cfg.icon;
  return (
    <div className="d-card p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Icon size={16} className={cfg.color} />
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap">{rec.leadsCount} лидов</span>
      </div>
      <p className="font-semibold text-sm mb-1" style={{ color: "var(--text)" }}>{rec.title}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs rounded px-2 py-0.5" style={{ background: "var(--surface-solid)", border: "1px solid var(--border-solid)", color: "var(--text)" }}>{rec.format}</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>Боль: {rec.pain}</span>
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [cache, setCache] = useState<DashboardCache | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [badge, setBadge] = useState<SyncBadge | null>(null);
  const [activeTab, setActiveTab] = useState<"strategy" | "content" | "tasks" | "leads" | "payments">("strategy");
  const [paymentForm, setPaymentForm] = useState<{ leadId: number; date: string; note: string } | null>(null);
  const [activePainIndex, setActivePainIndex] = useState(0);
  const [refreshingStrategy, setRefreshingStrategy] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [search, setSearch] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showFullConfirm, setShowFullConfirm] = useState(false);
  const [segmentGenerating, setSegmentGenerating] = useState<string | null>(null);
  const [segmentIdeas, setSegmentIdeas] = useState<Record<string, ContentIdea[]>>({});


  // Fetch role from server — cookie is httpOnly so we can't read it from JS
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => setIsAdmin(d.role === "admin")).catch(() => {});
  }, []);

  // Hydrate from Supabase on mount
  useEffect(() => {
    async function hydrate() {
      try {
        const [leadsRes, snapshotsRes, insightsRes] = await Promise.all([
          fetch("/api/db/leads"),
          fetch("/api/db/snapshots"),
          fetch("/api/db/insights"),
        ]);
        const [leadsData, snapshotsData, insightsData] = await Promise.all([
          leadsRes.json(), snapshotsRes.json(), insightsRes.json(),
        ]);

        // Map snake_case → camelCase from DB
        const leads: CachedLead[] = (leadsData.leads ?? []).map((r: {
          id: number; user_name: string; message_count: number; last_date: string;
          status: "hot" | "warm" | "cold"; summary: string; main_pain: string;
          interests: string[]; objections: string[]; next_step: string;
          recommended_product: string; analyzed_at: number;
          payment_date?: string | null; payment_note?: string | null; payment_status?: string | null;
        }) => ({
          id: r.id, userName: r.user_name, messageCount: r.message_count,
          lastDate: r.last_date, status: r.status, summary: r.summary,
          mainPain: r.main_pain, interests: r.interests ?? [],
          objections: r.objections ?? [], nextStep: r.next_step,
          recommendedProduct: r.recommended_product, analyzedAt: r.analyzed_at,
          paymentDate: r.payment_date ?? null,
          paymentNote: r.payment_note ?? null,
          paymentStatus: (r.payment_status as CachedLead["paymentStatus"]) ?? null,
        }));

        setCache({
          version: 2,
          lastSyncAt: leads.length > 0 ? Date.now() : 0,
          leads,
          insights: insightsData.insights ?? null,
          dialogSnapshots: snapshotsData.snapshots ?? {},
        });
      } catch {}
    }
    hydrate();
  }, []);

  const updateProgress = useCallback((update: Partial<ProgressState>) => {
    setProgress(prev => prev ? { ...prev, ...update } : null);
  }, []);

  // Save leads + snapshots + insights to Supabase (fire-and-forget, errors non-fatal)
  const saveToDb = useCallback(async (c: DashboardCache) => {
    try {
      await Promise.all([
        fetch("/api/db/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leads: c.leads }) }),
        fetch("/api/db/snapshots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshots: c.dialogSnapshots }) }),
        c.insights && fetch("/api/db/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ insights: c.insights }) }),
      ]);
    } catch {}
  }, []);

  // ── Refresh strategy only (no VK sync) ─────────────────────────────────────
  const handleRefreshStrategy = useCallback(async () => {
    if (!cache?.leads.length) return;
    setRefreshingStrategy(true);
    setError(null);
    try {
      // Aggregate pains with rich context: status breakdown, interests, summaries
      const painGroups: Record<string, CachedLead[]> = {};
      const objMap: Record<string, number> = {};
      for (const l of cache.leads) {
        if (l.mainPain) {
          if (!painGroups[l.mainPain]) painGroups[l.mainPain] = [];
          painGroups[l.mainPain].push(l);
        }
        for (const o of l.objections ?? []) objMap[o] = (objMap[o] ?? 0) + 1;
      }
      const topPains = Object.entries(painGroups)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 4)
        .map(([pain, group]) => {
          const hot = group.filter(l => l.status === "hot").length;
          const warm = group.filter(l => l.status === "warm").length;
          const cold = group.filter(l => l.status === "cold").length;
          const productFreq: Record<string, number> = {};
          for (const l of group) {
            if (l.recommendedProduct) productFreq[l.recommendedProduct] = (productFreq[l.recommendedProduct] ?? 0) + 1;
          }
          const topProduct = Object.entries(productFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
          const interestFreq: Record<string, number> = {};
          for (const l of group) {
            for (const i of l.interests ?? []) {
              const key = i.toLowerCase();
              interestFreq[key] = (interestFreq[key] ?? 0) + 1;
            }
          }
          const topInterests = Object.entries(interestFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i]) => i);
          return { pain, count: group.length, hot, warm, cold, topProduct, topInterests };
        });
      const topObjections = Object.entries(objMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([objection, count]) => {
          const hot = cache.leads.filter(l => l.objections?.includes(objection) && l.status === "hot").length;
          return { objection, count, hot };
        });

      const res = await fetch("/api/content-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topPains, topObjections }),
      });
      const text = await res.text();
      let parsed: { contentIdeas?: unknown; error?: string };
      try {
        parsed = JSON.parse(text);
      } catch {
        setError(`Парсинг упал. Ответ сервера: ${text.slice(0, 200)}`);
        setRefreshingStrategy(false);
        return;
      }
      if (parsed.error) {
        setError(parsed.error as string);
        setRefreshingStrategy(false);
        return;
      }
      if (parsed.contentIdeas) {
        const updatedInsights = {
          ...(cache.insights ?? { topPains: [], topQuestions: [], topObjections: [], contentRecommendations: [], contentIdeas: [], summary: "" }),
          contentIdeas: parsed.contentIdeas,
        };
        setCache(prev => prev ? { ...prev, insights: updatedInsights as typeof prev.insights } : prev);
        await fetch("/api/db/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ insights: updatedInsights }),
        });
      } else {
        setError("AI не вернул данные контент-стратегии. Попробуйте ещё раз.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    }
    setRefreshingStrategy(false);
  }, [cache]);

  // ── Smart refresh (incremental) ──────────────────────────────────────────────
  const handleSmartRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBadge(null);
    const now = Date.now();

    try {
      // Step 1: Scan VK for conversation metadata
      setProgress({ step: 1, totalSteps: 3, label: "Сканирование диалогов ВКонтакте...", current: 0, total: 0, startedAt: now });

      const scanRes = await fetch("/api/fetch-dialogs?mode=scan");
      const scanData = await safeJson(scanRes);
      if (scanData.error) throw new Error(scanData.error as string);

      const meta: ConversationMeta[] = (scanData.meta as ConversationMeta[]) ?? [];
      const currentCache = cache ?? emptyCache();

      // Step 2: Diff against cache
      const { newIds, changedIds } = diffDialogs(meta, currentCache.dialogSnapshots);
      const toFetch = [...newIds, ...changedIds];

      if (toFetch.length === 0) {
        // Nothing changed — serve from cache immediately
        setCache(currentCache);
        setBadge({ newCount: 0, updatedCount: 0 });
        setProgress(null);
        setLoading(false);
        return;
      }

      // Step 3: Fetch full history for new/changed only — in batches of 10 to avoid timeout
      updateProgress({ step: 2, label: `Загрузка ${toFetch.length} диалогов...`, current: 0, total: toFetch.length });

      const FETCH_BATCH = 10;
      const fetchBatches = chunkArray(toFetch as Parameters<typeof chunkArray>[0], FETCH_BATCH);
      const dialogs: unknown[] = [];
      let fetchedCount = 0;

      for (const fetchBatch of fetchBatches) {
        const fetchRes = await fetch("/api/fetch-dialogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ peerIds: fetchBatch }),
        });
        const fetchData = await safeJson(fetchRes);
        if (fetchData.error) throw new Error(fetchData.error as string);
        dialogs.push(...((fetchData.dialogs as unknown[]) ?? []));
        fetchedCount += (fetchBatch as unknown[]).length;
        updateProgress({ step: 2, label: `Загрузка диалогов (${fetchedCount} из ${toFetch.length})...`, current: fetchedCount, total: toFetch.length });
      }

      // Step 4: Analyze in batches — save to cache after EACH batch so no work is lost
      const batches = chunkArray(dialogs as Parameters<typeof chunkArray>[0], BATCH_SIZE);
      const newLeads: LeadAnalysis[] = [];
      let processed = 0;
      const analysisStart = Date.now();
      const workingSnapshots = { ...currentCache.dialogSnapshots };

      updateProgress({ step: 3, label: `Анализ Claude (0 из ${dialogs.length})...`, current: 0, total: dialogs.length, startedAt: analysisStart });

      for (const batch of batches) {
        const analyzeRes = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dialogs: batch }),
        });
        const analyzeData = await safeJson(analyzeRes);
        const batchLeads = (analyzeData.leads as LeadAnalysis[]) ?? [];
        newLeads.push(...batchLeads);

        // ✅ Save partial results immediately — money not wasted on failure
        const partialCachedLeads: CachedLead[] = batchLeads.map(l => ({
          ...l,
          analyzedAt: Date.now(),
          isNew: newIds.includes(l.id),
          isUpdated: changedIds.includes(l.id),
        }));
        const partialMerged = upsertLeads(currentCache.leads, [
          ...newLeads.slice(0, -batchLeads.length).map(l => ({
            ...l, analyzedAt: Date.now(),
            isNew: newIds.includes(l.id), isUpdated: changedIds.includes(l.id),
          })),
          ...partialCachedLeads,
        ]);
        for (const m of meta) {
          if (batchLeads.some(l => l.id === m.id)) {
            workingSnapshots[m.id] = { id: m.id, messageCount: m.messageCount, lastMessageTs: m.lastMessageTs, analyzedAt: Date.now() };
          }
        }
        const partialCache: DashboardCache = {
          version: 2, lastSyncAt: Date.now(),
          leads: partialMerged, insights: currentCache.insights,
          dialogSnapshots: workingSnapshots,
        };
        saveToDb(partialCache);
        setCache(partialCache);

        processed += (batch as unknown[]).length;
        const elapsed = (Date.now() - analysisStart) / 1000;
        const rate = elapsed / processed;
        const remaining = Math.max(0, Math.round(rate * (dialogs.length - processed)));
        setProgress(prev => prev ? { ...prev, label: `Анализ Claude (${processed} из ${dialogs.length})...`, current: processed, total: dialogs.length, eta: remaining } as ProgressState & { eta: number } : null);
      }

      // Step 5: Final merge
      const cachedLeadsWithFlags: CachedLead[] = newLeads.map(l => ({
        ...l, analyzedAt: Date.now(),
        isNew: newIds.includes(l.id), isUpdated: changedIds.includes(l.id),
      }));
      const mergedLeads = upsertLeads(currentCache.leads, cachedLeadsWithFlags);

      // Step 6: Re-run insights with full merged dataset
      updateProgress({ step: 3, label: "Формируем стратегические инсайты...", current: dialogs.length, total: dialogs.length });

      const insightsRes = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: mergedLeads }),
      });
      const insightsData = await safeJson(insightsRes);
      if (insightsData.error) throw new Error(insightsData.error as string);

      // Step 7: Update snapshots
      const newSnapshots = { ...currentCache.dialogSnapshots };
      for (const m of meta) {
        if (toFetch.includes(m.id)) {
          newSnapshots[m.id] = { id: m.id, messageCount: m.messageCount, lastMessageTs: m.lastMessageTs, analyzedAt: Date.now() };
        }
      }

      // Step 8: Save final state
      const newCache: DashboardCache = {
        version: 2, lastSyncAt: Date.now(),
        leads: mergedLeads,
        insights: insightsData.insights as Insights,
        dialogSnapshots: newSnapshots,
      };

      saveToDb(newCache);
      setCache(newCache);
      setBadge({ newCount: newIds.length, updatedCount: changedIds.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [updateProgress]);

  // ── Full refresh ─────────────────────────────────────────────────────────────
  const handleFullRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBadge(null);
    setShowFullConfirm(false);
    const now = Date.now();

    try {
      setProgress({ step: 1, totalSteps: 3, label: "Загрузка всех диалогов ВКонтакте...", current: 0, total: 0, startedAt: now });

      const fetchRes = await fetch("/api/fetch-dialogs");
      const fetchData = await safeJson(fetchRes);
      if (fetchData.error) throw new Error(fetchData.error as string);
      const dialogs = (fetchData.dialogs as unknown[]) ?? [];

      const batches = chunkArray(dialogs as Parameters<typeof chunkArray>[0], BATCH_SIZE);
      const allLeads: LeadAnalysis[] = [];
      let processed = 0;
      const analysisStart = Date.now();

      updateProgress({ step: 2, label: `Анализ Claude (0 из ${dialogs.length})...`, current: 0, total: dialogs.length, startedAt: analysisStart });

      for (const batch of batches) {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dialogs: batch }),
        });
        const data = await safeJson(res);
        if (data.leads) allLeads.push(...(data.leads as LeadAnalysis[]));

        // ✅ Save partial results after each batch
        const partialLeads: CachedLead[] = allLeads.map(l => ({ ...l, analyzedAt: Date.now() }));
        const partialSnapshots: DashboardCache["dialogSnapshots"] = {};
        for (const l of partialLeads) {
          partialSnapshots[l.id] = { id: l.id, messageCount: l.messageCount, lastMessageTs: 0, analyzedAt: Date.now() };
        }
        const partialCache: DashboardCache = {
          version: 2, lastSyncAt: Date.now(),
          leads: partialLeads, insights: null,
          dialogSnapshots: partialSnapshots,
        };
        saveToDb(partialCache);
        setCache(partialCache);

        processed += (batch as unknown[]).length;
        const elapsed = (Date.now() - analysisStart) / 1000;
        const rate = elapsed / processed;
        const remaining = Math.max(0, Math.round(rate * (dialogs.length - processed)));
        setProgress(prev => prev ? { ...prev, label: `Анализ Claude (${processed} из ${dialogs.length})...`, current: processed, total: dialogs.length, eta: remaining } as ProgressState & { eta: number } : null);
      }

      updateProgress({ step: 3, label: "Формируем стратегические инсайты...", current: dialogs.length, total: dialogs.length });

      const insightsRes = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: allLeads }),
      });
      const insightsData = await safeJson(insightsRes);
      if (insightsData.error) throw new Error(insightsData.error as string);

      const cachedLeads: CachedLead[] = allLeads.map(l => ({ ...l, analyzedAt: Date.now() }));
      const newSnapshots: DashboardCache["dialogSnapshots"] = {};
      for (const l of allLeads) {
        newSnapshots[l.id] = { id: l.id, messageCount: l.messageCount, lastMessageTs: 0, analyzedAt: Date.now() };
      }

      const newCache: DashboardCache = {
        version: 2,
        lastSyncAt: Date.now(),
        leads: cachedLeads,
        insights: insightsData.insights as Insights,
        dialogSnapshots: newSnapshots,
      };

      saveToDb(newCache);
      setCache(newCache);
      setBadge({ newCount: dialogs.length, updatedCount: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [updateProgress]);

  // ── Derived data ─────────────────────────────────────────────────────────────
  const leads = cache?.leads ?? [];
  const insights = cache?.insights ?? null;

  const filteredLeads = leads.filter(l => {
    if (filterStatus !== "all" && l.status !== filterStatus) return false;
    if (search && !l.userName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const hot = leads.filter(l => l.status === "hot").length;
  const warm = leads.filter(l => l.status === "warm").length;
  const cold = leads.filter(l => l.status === "cold").length;
  const total = leads.length;

  const normalizeProduct = (raw: string): string => {
    const s = (raw || "").toLowerCase();
    if (s.includes("магия") || (s.includes("тела") && !s.includes("мобильн"))) return "Магия Тела";
    if (s.includes("прыжк")) return "Прыжки";
    if (s.includes("мобильн") || s.includes("сила мобильн")) return "Сила Мобильности";
    return "Неизвестно";
  };

  const productData = Object.entries(
    leads.reduce((acc, l) => {
      const p = normalizeProduct(l.recommendedProduct);
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).filter(d => d.label !== "Неизвестно" || d.count > 0);

  const avgMsgsByStatus = (status: string) => {
    const filtered = leads.filter(l => l.status === status);
    if (!filtered.length) return 0;
    return Math.round(filtered.reduce((s, l) => s + l.messageCount, 0) / filtered.length);
  };

  const noObjCount = leads.filter(l => l.objections.length === 0).length;
  const withObjCount = leads.length - noObjCount;

  const interestData = Object.entries(
    leads.flatMap(l => l.interests).reduce((acc, raw) => {
      if (!raw) return acc;
      // normalize: trim + lowercase first char to merge case variants
      const key = raw.trim().charAt(0).toLowerCase() + raw.trim().slice(1);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  const today = new Date().toISOString().slice(0, 10);
  const lastSyncFormatted = cache?.lastSyncAt
    ? new Date(cache.lastSyncAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  const progressEta = (progress as (ProgressState & { eta?: number }) | null)?.eta;

  const pendingPaymentsCount = leads.filter(l => l.paymentDate && (!l.paymentStatus || l.paymentStatus === "pending" || l.paymentStatus === "contacted")).length;

  const NAV_ITEMS = [
    { id: "strategy" as const, label: "Стратегия",  icon: "◈", badge: undefined as number | undefined, badgeOrange: false },
    { id: "content"  as const, label: "Контент",    icon: "✦", badge: undefined as number | undefined, badgeOrange: false },
    { id: "tasks"    as const, label: "Сообщения",  icon: "✉", badge: leads.filter(l => l.status !== "cold").length || undefined, badgeOrange: false },
    { id: "leads"    as const, label: "Лиды",       icon: "◉", badge: total || undefined, badgeOrange: false },
    { id: "payments" as const, label: "Платежи",    icon: "💳", badge: pendingPaymentsCount || undefined, badgeOrange: true },
  ];

  const PAGE_TITLES: Record<typeof activeTab, string> = {
    strategy: "Стратегия",
    content: "Контент-план",
    tasks: "Сообщения",
    leads: "Лиды",
    payments: "Платежи",
  };

  return (
    <>
    <div className="d-layout">

      {/* ── SIDEBAR ──────────────────────────────────────────── */}
      <aside className="d-sidebar">
        <div className="d-brand">
          <p className="text-[13px] font-bold leading-tight" style={{ color: "var(--text)" }}>Культура движения</p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>VK Analytics</p>
        </div>

        <span className="d-nav-section">Аналитика</span>
        {NAV_ITEMS.slice(0, 2).map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)} className={`d-nav-item ${activeTab === item.id ? "active" : ""}`}>
            <span className="text-[14px]">{item.icon}</span>
            {item.label}
          </button>
        ))}

        <span className="d-nav-section">Работа</span>
        {NAV_ITEMS.slice(2).map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)} className={`d-nav-item ${activeTab === item.id ? "active" : ""}`}>
            <span className="text-[14px]">{item.icon}</span>
            {item.label}
            {item.badge ? (
              <span className="d-nav-badge" style={{ background: item.badgeOrange ? "var(--accent-orange)" : "var(--text)", color: "#fff" }}>
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}

        <div className="d-sidebar-bottom">
          {lastSyncFormatted && (
            <div className="px-2 mb-3">
              <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--muted)" }}>
                <CheckCircle size={10} className="text-green-500 flex-shrink-0" />
                {lastSyncFormatted}
              </div>
              {badge && badge.newCount > 0 && (
                <div className="text-[10px] mt-1 font-medium text-green-600">+{badge.newCount} новых · ~{badge.updatedCount} обновлено</div>
              )}
            </div>
          )}
          {total > 0 && (
            <button onClick={() => setShowClearConfirm(true)} className="d-nav-item text-[11px]" style={{ color: "var(--muted)" }}>
              <Trash2 size={13} /> Очистить кеш
            </button>
          )}
          <button
            onClick={async () => { await fetch("/api/auth/signout", { method: "POST" }); window.location.href = "/login"; }}
            className="d-nav-item text-[11px]" style={{ color: "var(--muted)" }}
          >
            <X size={13} /> Выйти
          </button>
        </div>
      </aside>

      {/* ── MAIN ─────────────────────────────────────────────── */}
      <main className="d-main">

        {/* Top bar */}
        <div className="d-topbar">
          <div>
            <h1 className="text-[20px] font-extrabold tracking-[-0.5px]" style={{ color: "var(--text)" }}>{PAGE_TITLES[activeTab]}</h1>
            {lastSyncFormatted && (
              <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: "var(--muted)" }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500"></span>
                Обновлено {lastSyncFormatted}
              </p>
            )}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowFullConfirm(true)} disabled={loading} className="d-btn d-btn-secondary">
                <RotateCcw size={13} />
                <span className="hidden sm:inline">Пересчитать</span>
              </button>
              <button onClick={handleSmartRefresh} disabled={loading} className="d-btn d-btn-primary">
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                {loading ? "Загрузка..." : "Обновить"}
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl p-4 mb-5 text-sm" style={{ background: "#fff0f0", border: "1px solid #fecaca", color: "#dc2626" }}>{error}</div>
        )}

        {/* Loading progress */}
        {loading && (
          <div className="d-card p-6 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw size={15} className="animate-spin" style={{ color: "var(--muted)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Обновление данных...</p>
            </div>
            {progress && (
              <div className="space-y-1">
                {[1, 2, 3].map(step => {
                  const isDone = step < progress.step;
                  const isCurrent = step === progress.step;
                  const label = step === 1
                    ? (progress.step > 1 ? "✓ Сканирование завершено" : progress.label)
                    : step === 2
                    ? (progress.step > 2 ? "✓ Диалоги загружены" : isCurrent ? progress.label : "Загрузка диалогов...")
                    : isCurrent ? progress.label : "Анализ и инсайты...";
                  if (isDone) return (
                    <div key={step} className="flex items-center gap-2 text-sm text-green-600 py-1">
                      <CheckCircle size={13} /><span>{label}</span>
                    </div>
                  );
                  if (isCurrent) {
                    const prog = progress.total > 0 ? progress.current / progress.total : 0;
                    return (
                      <div key={step} className="py-1">
                        <ProgressBar progress={progress.total > 0 ? prog : 0.3} label={label} eta={progressEta} />
                        {progress.total > 0 && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                            {progress.current} из {progress.total}
                            {progressEta !== undefined && progressEta > 0 ? ` · ~${progressEta} сек` : ""}
                          </p>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={step} className="flex items-center gap-2 text-sm py-1" style={{ color: "var(--muted)" }}>
                      <span className="w-3 h-3 rounded-full border-2 inline-block" style={{ borderColor: "var(--border-solid)" }} />
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!cache && !loading && !error && (
          <div className="text-center py-24">
            <MessageSquare size={44} className="mx-auto mb-4" style={{ color: "var(--muted-light)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--muted)" }}>Нажмите «Обновить»</h2>
            <p className="text-sm" style={{ color: "var(--muted-light)" }}>Загрузим диалоги из ВКонтакте и проанализируем их</p>
          </div>
        )}

        {cache && !loading && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatCard label="Всего лидов" value={total} color="text-slate-800" />
              <StatCard label="Горячих" value={hot} sub={total > 0 ? `${Math.round(hot / total * 100)}% базы` : ""} color="text-orange-500" />
              <StatCard label="Тёплых" value={warm} sub={total > 0 ? `${Math.round(warm / total * 100)}% базы` : ""} color="text-blue-500" />
              <StatCard label="Холодных" value={cold} sub={total > 0 ? `${Math.round(cold / total * 100)}% базы` : ""} color="text-slate-400" />
            </div>

            {/* Strategy tab */}
            {activeTab === "strategy" && insights && (
              <div className="space-y-5">
                <div className="d-summary-card text-white">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb size={16} className="text-yellow-400" />
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>✦ Стратегический вывод</p>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.82)" }}>{insights.summary}</p>
                </div>

                <div>
                  <p className="d-section-title">Контент-план</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {insights.contentRecommendations.map((rec, i) => <ContentCard key={i} rec={rec} />)}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="d-card p-5">
                    <div className="d-panel-header"><span className="d-panel-title">Топ болей</span></div>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={insights.topPains} layout="vertical" margin={{ left: 10, right: 20, top: 4, bottom: 4 }}>
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="label" width={130} tick={<YTick />} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                          {insights.topPains.map((_, i) => (
                            <Cell key={i} fill={i === 0 ? "#f97316" : i === 1 ? "#fb923c" : "#fdba74"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="d-card p-5">
                    <div className="d-panel-header"><span className="d-panel-title">Возражения</span></div>
                    <div className="space-y-3">
                      {insights.topObjections.map((o, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span style={{ color: "var(--text)" }}>{o.label}</span>
                            <span className="font-medium" style={{ color: "var(--muted)" }}>{o.count}</span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border-solid)" }}>
                            <div
                              className="h-full bg-red-400 rounded-full"
                              style={{ width: `${(o.count / (insights.topObjections[0]?.count || 1)) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="d-card p-5 md:col-span-2">
                    <div className="d-panel-header">
                      <span className="d-panel-title flex items-center gap-2">
                        <MessageSquare size={14} style={{ color: "var(--muted)" }} /> Что спрашивают
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {insights.topQuestions.map((q, i) => (
                        <div key={i} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "rgba(0,0,0,0.03)" }}>
                          <span className="text-sm" style={{ color: "var(--text)" }}>{q.label}</span>
                          <span className="text-sm font-bold ml-2" style={{ color: "var(--muted)" }}>{q.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Метрики — вовлечённость и возражения */}
                {leads.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Вовлечённость + возражения */}
                    <div className="space-y-4">
                      <div className="d-card p-5">
                        <div className="d-panel-header"><span className="d-panel-title">Вовлечённость (avg сообщений)</span></div>
                        <div className="space-y-2">
                          {([["hot", "🔥", "text-orange-500"], ["warm", "🌤", "text-blue-500"], ["cold", "❄️", "text-slate-400"]] as const).map(([s, icon, cls]) => {
                            const avg = avgMsgsByStatus(s);
                            const maxAvg = Math.max(avgMsgsByStatus("hot"), avgMsgsByStatus("warm"), avgMsgsByStatus("cold"), 1);
                            return (
                              <div key={s}>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className={`font-medium ${cls}`}>{icon} {s === "hot" ? "Горячие" : s === "warm" ? "Тёплые" : "Холодные"}</span>
                                  <span className="font-bold" style={{ color: "var(--text)" }}>{avg} сообщ.</span>
                                </div>
                                <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border-solid)" }}>
                                  <div className={`h-full rounded-full ${s === "hot" ? "bg-orange-400" : s === "warm" ? "bg-blue-400" : "bg-slate-300"}`}
                                    style={{ width: `${(avg / maxAvg) * 100}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="d-card p-5">
                        <div className="d-panel-header"><span className="d-panel-title">Возражения</span></div>
                        <div className="flex gap-4 mb-3">
                          <div className="flex-1 text-center">
                            <div className="text-2xl font-bold text-green-500">{noObjCount}</div>
                            <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>без возражений</div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className="text-2xl font-bold text-red-400">{withObjCount}</div>
                            <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>с возражениями</div>
                          </div>
                        </div>
                        <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: "var(--border-solid)" }}>
                          <div className="h-full bg-green-400 rounded-l-full transition-all"
                            style={{ width: `${total > 0 ? (noObjCount / total) * 100 : 0}%` }} />
                          <div className="h-full bg-red-300 rounded-r-full transition-all"
                            style={{ width: `${total > 0 ? (withObjCount / total) * 100 : 0}%` }} />
                        </div>
                        <div className="text-xs mt-1 text-right" style={{ color: "var(--muted-light)" }}>
                          {total > 0 ? Math.round((noObjCount / total) * 100) : 0}% без возражений
                        </div>
                      </div>
                    </div>

                    {/* Топ интересов */}
                    {interestData.length > 0 && (
                      <div className="d-card p-5">
                        <div className="d-panel-header"><span className="d-panel-title">Топ интересов</span></div>
                        <ResponsiveContainer width="100%" height={Math.max(160, interestData.length * 36)}>
                          <BarChart data={interestData} layout="vertical" margin={{ left: 10, right: 24, top: 2, bottom: 2 }}>
                            <XAxis type="number" tick={{ fontSize: 12 }} />
                            <YAxis type="category" dataKey="label" width={130} tick={<YTick />} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                              {interestData.map((_, i) => (
                                <Cell key={i} fill={i === 0 ? "#10b981" : i === 1 ? "#34d399" : "#6ee7b7"} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Сегменты аудитории */}
            {activeTab === "strategy" && leads.length > 0 && (() => {
              // Группируем лидов по mainPain
              const segmentMap: Record<string, CachedLead[]> = {};
              for (const l of leads) {
                if (l.mainPain) {
                  if (!segmentMap[l.mainPain]) segmentMap[l.mainPain] = [];
                  segmentMap[l.mainPain].push(l);
                }
              }
              const segments = Object.entries(segmentMap)
                .sort((a, b) => b[1].length - a[1].length)
                .slice(0, 6)
                .map(([pain, group]) => {
                  const hot = group.filter(l => l.status === "hot").length;
                  const warm = group.filter(l => l.status === "warm").length;
                  const cold = group.length - hot - warm;
                  const interestFreq: Record<string, number> = {};
                  for (const l of group) {
                    for (const i of l.interests ?? []) {
                      const key = i.toLowerCase();
                      interestFreq[key] = (interestFreq[key] ?? 0) + 1;
                    }
                  }
                  const topInterests = Object.entries(interestFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i]) => i);
                  const productFreq: Record<string, number> = {};
                  for (const l of group) {
                    if (l.recommendedProduct) productFreq[l.recommendedProduct] = (productFreq[l.recommendedProduct] ?? 0) + 1;
                  }
                  const topProduct = Object.entries(productFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
                  return { pain, count: group.length, hot, warm, cold, topInterests, topProduct, leads: group };
                });

              const handleSegmentContent = async (seg: typeof segments[0]) => {
                setSegmentGenerating(seg.pain);
                try {
                  const topPains = [{
                    pain: seg.pain,
                    count: seg.count,
                    hot: seg.hot,
                    warm: seg.warm,
                    cold: seg.cold,
                    topProduct: seg.topProduct,
                    topInterests: seg.topInterests,
                  }];
                  const objMap: Record<string, number> = {};
                  for (const l of seg.leads) {
                    for (const o of l.objections ?? []) objMap[o] = (objMap[o] ?? 0) + 1;
                  }
                  const topObjections = Object.entries(objMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([objection, count]) => {
                    const hot = seg.leads.filter(l => l.objections?.includes(objection) && l.status === "hot").length;
                    return { objection, count, hot };
                  });
                  const res = await fetch("/api/content-strategy", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ topPains, topObjections }),
                  });
                  const data = await res.json();
                  if (data.contentIdeas) {
                    setSegmentIdeas(prev => ({ ...prev, [seg.pain]: data.contentIdeas }));
                  }
                } catch {}
                setSegmentGenerating(null);
              };

              return (
                <div className="space-y-4">
                  <h2 className="text-[14px] font-bold" style={{ color: "var(--text)" }}>Сегменты аудитории</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {segments.map(seg => {
                      const isGenerating = segmentGenerating === seg.pain;
                      const ideas = segmentIdeas[seg.pain];
                      return (
                        <div key={seg.pain} className="d-card overflow-hidden">
                          <div className="p-4">
                            {/* Название сегмента */}
                            <p className="font-semibold text-slate-800 text-sm leading-snug mb-2">{seg.pain}</p>

                            {/* Счётчики статусов */}
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-xs font-medium text-slate-500">{seg.count} лидов</span>
                              {seg.hot > 0 && <span className="text-xs bg-orange-100 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5 font-medium">🔥 {seg.hot}</span>}
                              {seg.warm > 0 && <span className="text-xs bg-blue-100 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 font-medium">🌤 {seg.warm}</span>}
                              {seg.cold > 0 && <span className="text-xs bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-2 py-0.5 font-medium">❄️ {seg.cold}</span>}
                            </div>

                            {/* Интересы */}
                            {seg.topInterests.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-3">
                                {seg.topInterests.map((i, idx) => (
                                  <span key={idx} className="text-xs rounded-full px-2 py-0.5" style={{ background: "rgba(0,0,0,0.04)", border: "1px solid var(--border)", color: "var(--muted)" }}>{i}</span>
                                ))}
                              </div>
                            )}

                            {/* Продукт */}
                            {seg.topProduct && (
                              <p className="text-xs text-slate-400 mb-3">Продукт: <span className="text-slate-600 font-medium">{normalizeProduct(seg.topProduct)}</span></p>
                            )}

                            {/* Кнопка */}
                            {isAdmin && (
                              <button
                                onClick={() => handleSegmentContent(seg)}
                                disabled={!!segmentGenerating}
                                className="d-btn d-btn-secondary w-full justify-center text-xs disabled:opacity-50"
                              >
                                <Lightbulb size={12} className={isGenerating ? "animate-pulse text-yellow-500" : ""} />
                                {isGenerating ? "Генерирую..." : ideas ? "Обновить контент" : "Создать контент"}
                              </button>
                            )}
                          </div>

                          {/* Сгенерированные идеи */}
                          {ideas && ideas.length > 0 && (
                            <div className="p-3 space-y-2" style={{ borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.02)" }}>
                              {ideas.slice(0, 3).map((idea, i) => {
                                const cfg = PRIORITY_CONFIG[idea.priority];
                                const Icon = cfg.icon;
                                return (
                                  <div key={i} className="rounded-lg p-3" style={{ background: "var(--surface-solid)", border: "1px solid var(--border)" }}>
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <Icon size={12} className={cfg.color} />
                                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                                      <span className="text-xs text-slate-400 ml-auto">{idea.platform}</span>
                                    </div>
                                    <p className="text-xs font-medium text-slate-800 leading-snug">{idea.title}</p>
                                    {idea.hook && <p className="text-xs text-slate-400 italic mt-1">«{idea.hook}»</p>}
                                  </div>
                                );
                              })}
                              {ideas.length > 3 && (
                                <p className="text-xs text-slate-400 text-center">+ ещё {ideas.length - 3} идей во вкладке «Контент»</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {activeTab === "strategy" && !insights && (
              <div className="text-center py-12 text-slate-400 text-sm">Нет данных для стратегии</div>
            )}

            {/* Content Strategy tab */}
            {activeTab === "content" && (() => {
              const contentIdeas = insights?.contentIdeas ?? [];
              const PLATFORM_FILTER = ["Все", "ВКонтакте", "YouTube", "Instagram"] as const;
              type PlatformFilter = typeof PLATFORM_FILTER[number];
              const platformFilter = (activePainIndex === 0 ? "Все" : activePainIndex === 1 ? "ВКонтакте" : activePainIndex === 2 ? "YouTube" : "Instagram") as PlatformFilter;
              const filtered = platformFilter === "Все" ? contentIdeas : contentIdeas.filter(c => c.platform === platformFilter);

              const PLATFORM_STYLE: Record<string, { badge: string; dot: string }> = {
                "ВКонтакте": { badge: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
                "YouTube":   { badge: "bg-red-100 text-red-700",  dot: "bg-red-500" },
                "Instagram": { badge: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
              };

              if (!insights || contentIdeas.length === 0) {
                return (
                  <div className="text-center py-16">
                    <Lightbulb size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 font-medium mb-1">Нет данных контент-плана</p>
                    <p className="text-sm text-slate-400 mb-4">
                      {cache?.leads.length ? "Нажмите «Обновить стратегию» чтобы сгенерировать идеи" : "Сначала загрузите лидов через «Обновить данные»"}
                    </p>
                    {cache?.leads.length && isAdmin ? (
                      <button
                        onClick={handleRefreshStrategy}
                        disabled={refreshingStrategy}
                        className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                      >
                        <RefreshCw size={14} className={refreshingStrategy ? "animate-spin" : ""} />
                        {refreshingStrategy ? "Генерирую..." : "Обновить стратегию"}
                      </button>
                    ) : null}
                  </div>
                );
              }

              return (
                <div className="space-y-5">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-[16px] font-bold" style={{ color: "var(--text)" }}>Контент-план</h2>
                      <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>{contentIdeas.length} идей на основе реальных болей клиентов</p>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={handleRefreshStrategy}
                        disabled={refreshingStrategy}
                        className="d-btn d-btn-secondary disabled:opacity-50"
                      >
                        <RefreshCw size={13} className={refreshingStrategy ? "animate-spin" : ""} />
                        {refreshingStrategy ? "Генерирую..." : "Обновить"}
                      </button>
                    )}
                  </div>

                  {/* Platform filter */}
                  <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 scrollbar-hide">
                  <div className="flex gap-2 w-max sm:w-auto">
                    {PLATFORM_FILTER.map((p, i) => (
                      <button
                        key={p}
                        onClick={() => setActivePainIndex(i)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${activePainIndex === i ? "d-btn-primary" : ""}`}
                        style={activePainIndex !== i ? { background: "var(--surface-solid)", color: "var(--muted)", border: "1px solid var(--border-solid)" } : {}}
                      >
                        {p}
                        {p !== "Все" && (
                          <span className="ml-1.5 text-xs opacity-60">{contentIdeas.filter(c => c.platform === p).length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  </div>

                  {/* Cards grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((idea, i) => {
                      const cfg = PRIORITY_CONFIG[idea.priority];
                      const Icon = cfg.icon;
                      const ps = PLATFORM_STYLE[idea.platform] ?? { badge: "bg-slate-100 text-slate-600", dot: "bg-slate-400" };
                      return (
                        <div key={i} className="d-card p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5">
                              <Icon size={14} className={cfg.color} />
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                            </div>
                            <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">{idea.leadsCount} лидов</span>
                          </div>
                          <p className="font-semibold text-sm leading-snug mb-2" style={{ color: "var(--text)" }}>{idea.title}</p>
                          {idea.hook && <p className="text-xs italic mb-3" style={{ color: "var(--muted)" }}>«{idea.hook}»</p>}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ps.badge}`}>{idea.platform}</span>
                            <span className="text-xs rounded px-2 py-0.5" style={{ background: "var(--surface-solid)", border: "1px solid var(--border-solid)", color: "var(--text)" }}>{idea.format}</span>
                            <span className="text-xs truncate" style={{ color: "var(--muted)" }}>Боль: {idea.pain}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Tasks tab */}
            {activeTab === "tasks" && (
              <div className="space-y-3">
                {leads.length === 0 && (
                  <div className="text-center py-12 text-slate-400 text-sm">Нет данных. Запустите обновление.</div>
                )}
                {(["hot", "warm"] as const).map(status => {
                  const group = leads
                    .filter(l => l.status === status)
                    .sort((a, b) => a.objections.length - b.objections.length);
                  if (!group.length) return null;
                  const cfg = STATUS_CONFIG[status];
                  const CfgIcon = cfg.icon;
                  return (
                    <div key={status}>
                      <div className={`flex items-center gap-2 mb-2 mt-4 ${cfg.color}`}>
                        <CfgIcon size={16} />
                        <span className="font-semibold">{cfg.label} — {group.length} лидов</span>
                      </div>
                      <div className="space-y-2">
                        {group.map((lead, i) => (
                          <div key={lead.id} className="d-card overflow-hidden">
                            {/* Header */}
                            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-slate-400 text-sm font-mono shrink-0">{i + 1}.</span>
                                  <span className="font-semibold text-slate-800 truncate">{lead.userName}</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {lead.objections.length === 0 && (
                                    <span className="hidden sm:inline text-xs bg-green-50 text-green-600 border border-green-200 px-2 py-0.5 rounded-full font-medium">без возражений</span>
                                  )}
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${cfg.pill}`}>{cfg.label}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-1 pl-6">
                                <span className="text-xs text-slate-400">{lead.lastDate} · {lead.messageCount} сообщ.</span>
                                {lead.objections.length === 0 && (
                                  <span className="sm:hidden text-xs bg-green-50 text-green-600 border border-green-200 px-2 py-0.5 rounded-full font-medium">без возражений</span>
                                )}
                              </div>
                            </div>

                            {/* Dosier body */}
                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">

                              {/* Контекст */}
                              <div className="md:col-span-2 rounded-lg px-3 py-2" style={{ background: "rgba(0,0,0,0.03)" }}>
                                <div className="text-xs mb-1 uppercase tracking-wide font-medium" style={{ color: "var(--muted-light)" }}>Контекст диалога</div>
                                <div style={{ color: "var(--text)" }}>{lead.summary}</div>
                              </div>

                              {/* Боль */}
                              <div className="bg-orange-50 rounded-lg px-3 py-2">
                                <div className="text-xs text-orange-400 mb-1 uppercase tracking-wide font-medium">Главная боль</div>
                                <div className="text-orange-800 font-medium">{lead.mainPain}</div>
                              </div>

                              {/* Продукт */}
                              <div className="bg-blue-50 rounded-lg px-3 py-2">
                                <div className="text-xs text-blue-400 mb-1 uppercase tracking-wide font-medium">Предложить продукт</div>
                                <div className="text-blue-800 font-bold">{normalizeProduct(lead.recommendedProduct)}</div>
                              </div>

                              {/* Интересы */}
                              {lead.interests.length > 0 && (
                                <div className="bg-emerald-50 rounded-lg px-3 py-2">
                                  <div className="text-xs text-emerald-500 mb-1.5 uppercase tracking-wide font-medium">Интересы</div>
                                  <div className="flex flex-wrap gap-1">
                                    {lead.interests.map((t, ti) => (
                                      <span key={ti} className="text-xs text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full" style={{ background: "var(--surface-solid)" }}>{t}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Возражения */}
                              <div className={`rounded-lg px-3 py-2 ${lead.objections.length ? "bg-red-50" : "bg-green-50"}`}>
                                <div className={`text-xs mb-1.5 uppercase tracking-wide font-medium ${lead.objections.length ? "text-red-400" : "text-green-500"}`}>
                                  {lead.objections.length ? "Возражения — отработать" : "Возражений нет"}
                                </div>
                                {lead.objections.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {lead.objections.map((o, oi) => (
                                      <span key={oi} className="text-xs text-red-600 border border-red-200 px-2 py-0.5 rounded-full" style={{ background: "var(--surface-solid)" }}>{o}</span>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs text-green-700">Можно сразу переходить к офферу</div>
                                )}
                              </div>

                              {/* Следующий шаг + добавить платёж */}
                              <div className="md:col-span-2 pt-3 flex flex-wrap items-center justify-between gap-2" style={{ borderTop: "1px solid var(--border)" }}>
                                <div className="flex items-start gap-2 flex-1 min-w-0">
                                  <span className="text-slate-400 text-xs uppercase tracking-wide font-medium shrink-0 pt-0.5">Следующий шаг →</span>
                                  <span className="text-slate-800 font-medium text-sm">{lead.nextStep}</span>
                                </div>
                                {lead.paymentDate ? (
                                  <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded-lg font-medium shrink-0">
                                    💳 Платёж {new Date(lead.paymentDate).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => setPaymentForm({ leadId: lead.id, date: "", note: "" })}
                                    className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 hover:border-slate-300 px-2 py-1 rounded-lg transition-colors shrink-0"
                                  >
                                    + Дата платежа
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pipeline tab */}
            {/* Leads tab */}
            {activeTab === "leads" && (
              <div className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-1">
                    {(["all", "hot", "warm", "cold"] as const).map(s => {
                      const cfg = s === "all" ? null : STATUS_CONFIG[s];
                      return (
                        <button
                          key={s}
                          onClick={() => setFilterStatus(s)}
                          className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                            filterStatus === s ? "d-btn-primary" : cfg ? `${cfg.pill} hover:opacity-80` : ""
                          }`}
                          style={filterStatus !== s && !cfg ? { background: "var(--surface-solid)", color: "var(--text)", border: "1px solid var(--border-solid)" } : {}}
                        >
                          {s === "all" ? `Все (${total})` : `${cfg!.label} (${s === "hot" ? hot : s === "warm" ? warm : cold})`}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 flex-1 min-w-[140px]" style={{ background: "var(--surface-solid)", border: "1px solid var(--border-solid)" }}>
                    <Search size={14} style={{ color: "var(--muted-light)" }} className="flex-shrink-0" />
                    <input
                      type="text"
                      placeholder="Поиск по имени..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="text-sm text-slate-700 outline-none w-full bg-transparent placeholder:text-slate-400"
                    />
                  </div>

                  <button
                    onClick={() => downloadCSV(leads)}
                    className="d-btn d-btn-secondary text-xs shrink-0"
                  >
                    <Download size={13} /> <span className="hidden sm:inline">Экспорт</span> CSV
                  </button>
                </div>

                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Users size={15} />
                  <span>{filteredLeads.length} лидов{filterStatus !== "all" || search ? " (фильтр)" : ""}</span>
                </div>

                {filteredLeads.length === 0 && (
                  <div className="text-center py-12 text-slate-400 text-sm">Нет лидов по выбранным фильтрам</div>
                )}

                {(["hot", "warm", "cold"] as const).map(status => {
                  const group = filteredLeads.filter(l => l.status === status);
                  if (!group.length) return null;
                  const cfg = STATUS_CONFIG[status];
                  const Icon = cfg.icon;
                  return (
                    <div key={status}>
                      <div className={`flex items-center gap-2 mb-2 mt-4 ${cfg.color}`}>
                        <Icon size={15} />
                        <span className="text-sm font-semibold">{cfg.label} — {group.length}</span>
                      </div>
                      <div className="space-y-2">
                        {group.map(lead => <LeadCard key={lead.id} lead={lead} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Payments tab */}
            {activeTab === "payments" && (() => {
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
              const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);

              const withPayment = leads.filter(l => l.paymentDate && l.paymentStatus !== "paid" && l.paymentStatus !== "cancelled");
              const overdue = withPayment.filter(l => new Date(l.paymentDate!) < today);
              const todayTomorrow = withPayment.filter(l => { const d = new Date(l.paymentDate!); return d >= today && d <= tomorrow; });
              const thisWeek = withPayment.filter(l => { const d = new Date(l.paymentDate!); return d > tomorrow && d <= weekEnd; });
              const later = withPayment.filter(l => new Date(l.paymentDate!) > weekEnd);

              const updatePaymentStatus = async (leadId: number, status: CachedLead["paymentStatus"]) => {
                setCache(prev => prev ? {
                  ...prev,
                  leads: prev.leads.map(l => l.id === leadId ? { ...l, paymentStatus: status } : l),
                } : prev);
                await fetch("/api/db/leads", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: leadId, paymentStatus: status }),
                });
              };

              const formatDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

              const PaymentCard = ({ lead, urgent }: { lead: CachedLead; urgent?: boolean }) => (
                <div className="d-card overflow-hidden" style={urgent ? { borderColor: "#f97316" } : {}}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-slate-800 text-sm">{lead.userName}</span>
                          {lead.paymentStatus === "contacted" && (
                            <span className="text-xs bg-blue-100 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">написали</span>
                          )}
                        </div>
                        <a
                          href={`https://vk.com/id${lead.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
                        >
                          vk.com/id{lead.id} ↗
                        </a>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-bold ${urgent ? "text-orange-600" : "text-slate-700"}`}>
                          {formatDate(lead.paymentDate!)}
                        </div>
                        <div className="text-xs text-slate-400">{normalizeProduct(lead.recommendedProduct)}</div>
                      </div>
                    </div>

                    {lead.paymentNote && (
                      <p className="text-xs italic rounded-lg px-3 py-2 mb-3" style={{ color: "var(--muted)", background: "rgba(0,0,0,0.03)" }}>«{lead.paymentNote}»</p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => updatePaymentStatus(lead.id, lead.paymentStatus === "contacted" ? "pending" : "contacted")}
                        className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-colors ${
                          lead.paymentStatus === "contacted"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {lead.paymentStatus === "contacted" ? "✓ Написали" : "Написать"}
                      </button>
                      <button
                        onClick={() => updatePaymentStatus(lead.id, "paid")}
                        className="flex-1 text-xs py-1.5 rounded-lg border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 font-medium transition-colors"
                      >
                        💚 Оплатил
                      </button>
                      <button
                        onClick={() => updatePaymentStatus(lead.id, "cancelled")}
                        className="text-xs py-1.5 px-3 rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors"
                        title="Не дождались"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              );

              if (withPayment.length === 0) {
                return (
                  <div className="text-center py-16">
                    <p className="text-slate-400 text-sm mb-1">Нет предстоящих платежей</p>
                    <p className="text-xs text-slate-300">После синхронизации диалогов Claude автоматически найдёт клиентов с обещанием оплаты</p>
                  </div>
                );
              }

              return (
                <div className="space-y-6">
                  {overdue.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        <h3 className="font-semibold text-red-600 text-sm">Просрочено — {overdue.length}</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {overdue.map(l => <PaymentCard key={l.id} lead={l} urgent />)}
                      </div>
                    </div>
                  )}
                  {todayTomorrow.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-2 h-2 rounded-full bg-orange-500" />
                        <h3 className="font-semibold text-orange-600 text-sm">Сегодня–завтра — {todayTomorrow.length}</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {todayTomorrow.map(l => <PaymentCard key={l.id} lead={l} urgent />)}
                      </div>
                    </div>
                  )}
                  {thisWeek.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-2 h-2 rounded-full bg-yellow-400" />
                        <h3 className="font-semibold text-slate-700 text-sm">На этой неделе — {thisWeek.length}</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {thisWeek.map(l => <PaymentCard key={l.id} lead={l} />)}
                      </div>
                    </div>
                  )}
                  {later.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-2 h-2 rounded-full bg-slate-300" />
                        <h3 className="font-semibold text-slate-500 text-sm">Позже — {later.length}</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {later.map(l => <PaymentCard key={l.id} lead={l} />)}
                      </div>
                    </div>
                  )}

                  {/* Архив оплаченных */}
                  {leads.filter(l => l.paymentStatus === "paid" || l.paymentStatus === "cancelled").length > 0 && (
                    <details className="group">
                      <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">
                        Архив ({leads.filter(l => l.paymentStatus === "paid" || l.paymentStatus === "cancelled").length})
                      </summary>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                        {leads.filter(l => l.paymentStatus === "paid" || l.paymentStatus === "cancelled").map(l => (
                          <div key={l.id} className="d-card p-4 opacity-60">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-slate-600">{l.userName}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${l.paymentStatus === "paid" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                                {l.paymentStatus === "paid" ? "Оплатил" : "Отменён"}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 mt-1">{normalizeProduct(l.recommendedProduct)} · {l.paymentDate ? formatDate(l.paymentDate) : ""}</div>
                            <button
                              onClick={() => updatePaymentStatus(l.id, null)}
                              className="text-xs text-slate-400 hover:text-slate-600 mt-2 transition-colors"
                            >
                              ↩ Вернуть в активные
                            </button>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </main>
    </div>

      {/* Payment form modal */}
      {paymentForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="d-card p-6 max-w-sm w-full" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <h3 className="font-bold mb-4" style={{ color: "var(--text)" }}>Добавить дату платежа</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 font-medium mb-1 block">Дата платежа</label>
                <input
                  type="date"
                  value={paymentForm.date}
                  onChange={e => setPaymentForm(prev => prev ? { ...prev, date: e.target.value } : prev)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-slate-400 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 font-medium mb-1 block">Комментарий (необязательно)</label>
                <input
                  type="text"
                  placeholder="например: оплатит с зарплаты"
                  value={paymentForm.note}
                  onChange={e => setPaymentForm(prev => prev ? { ...prev, note: e.target.value } : prev)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-slate-400 transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setPaymentForm(null)} className="d-btn d-btn-secondary flex-1">Отмена</button>
              <button
                disabled={!paymentForm.date}
                onClick={async () => {
                  if (!paymentForm.date) return;
                  const { leadId, date, note } = paymentForm;
                  setCache(prev => prev ? {
                    ...prev,
                    leads: prev.leads.map(l => l.id === leadId ? { ...l, paymentDate: date, paymentNote: note || null, paymentStatus: "pending" } : l),
                  } : prev);
                  setPaymentForm(null);
                  await fetch("/api/db/leads", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: leadId, paymentDate: date, paymentNote: note || null, paymentStatus: "pending" }),
                  });
                }}
                className="d-btn d-btn-primary flex-1"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear cache confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="d-card p-6 max-w-sm w-full" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <h3 className="font-bold mb-2" style={{ color: "var(--text)" }}>Очистить кеш?</h3>
            <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>Все сохранённые данные будут удалены. При следующем обновлении придётся анализировать всё заново.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowClearConfirm(false)} className="d-btn d-btn-secondary flex-1">Отмена</button>
              <button
                onClick={() => { setCache(null); setBadge(null); setShowClearConfirm(false); }}
                className="d-btn flex-1 bg-red-500 hover:bg-red-600 text-white"
              >
                Очистить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full refresh confirmation */}
      {showFullConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="d-card p-6 max-w-sm w-full" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <h3 className="font-bold mb-2" style={{ color: "var(--text)" }}>Пересчитать всё?</h3>
            <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>Все диалоги будут загружены и проанализированы заново. Это займёт несколько минут и потратит Claude API кредиты.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowFullConfirm(false)} className="d-btn d-btn-secondary flex-1">Отмена</button>
              <button onClick={handleFullRefresh} className="d-btn d-btn-primary flex-1">
                Пересчитать
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
