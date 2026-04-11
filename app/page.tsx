"use client";

import { useState, useEffect, useCallback } from "react";

const truncate = (s: string, n = 32) => s.length > n ? s.slice(0, n) + "…" : s;
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
  PlusCircle, Bell, X, BadgeCheck, XCircle, Calendar,
} from "lucide-react";
import { PipelineEntry } from "@/app/lib/pipeline";
import {
  emptyCache, upsertLeads, downloadCSV,
  CachedLead, Insights, DashboardCache, loadCache,
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
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
      <p className="text-sm text-slate-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
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
    <div className={`rounded-xl border ${cfg.bg} overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/50 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${cfg.dot} flex-shrink-0`} />
        <span className="font-medium text-slate-800 flex-1">{lead.userName}</span>
        {lead.isNew && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-2 py-0.5 font-medium">новый</span>}
        {lead.isUpdated && <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-200 rounded-full px-2 py-0.5 font-medium">обновлён</span>}
        <span className={`flex items-center gap-1 text-xs font-medium ${cfg.color} mr-2`}>
          <Icon size={13} />{cfg.label}
        </span>
        <span className="text-xs text-slate-400 mr-2">{lead.lastDate}</span>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-white/60 pt-3">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Саммари</p>
            <p className="text-sm text-slate-700">{lead.summary}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Главная боль</p>
            <p className="text-sm text-slate-700">{lead.mainPain}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Интересы</p>
            <div className="flex flex-wrap gap-1">
              {lead.interests.map((i, idx) => (
                <span key={idx} className="text-xs bg-white/70 border border-slate-200 rounded-full px-2 py-0.5 text-slate-600">{i}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Возражения</p>
            <div className="flex flex-wrap gap-1">
              {lead.objections.map((o, idx) => (
                <span key={idx} className="text-xs bg-red-50 border border-red-100 rounded-full px-2 py-0.5 text-red-600">{o}</span>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Следующий шаг</p>
            <p className="text-sm font-medium text-slate-800 bg-white/70 rounded-lg px-3 py-2 border border-slate-200">
              → {lead.nextStep}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Рекомендуемый продукт</p>
            <p className="text-sm text-slate-700">{lead.recommendedProduct}</p>
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
    <div className={`rounded-xl border ${cfg.bg} p-4`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Icon size={16} className={cfg.color} />
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap">{rec.leadsCount} лидов</span>
      </div>
      <p className="font-semibold text-slate-800 text-sm mb-1">{rec.title}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs bg-white/80 border border-slate-200 rounded px-2 py-0.5 text-slate-600">{rec.format}</span>
        <span className="text-xs text-slate-500">Боль: {rec.pain}</span>
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [cache, setCache] = useState<DashboardCache | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [badge, setBadge] = useState<SyncBadge | null>(null);
  const [activeTab, setActiveTab] = useState<"strategy" | "content" | "pipeline" | "tasks" | "leads">("strategy");
  const [activePainIndex, setActivePainIndex] = useState(0);
  const [refreshingStrategy, setRefreshingStrategy] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [search, setSearch] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showFullConfirm, setShowFullConfirm] = useState(false);

  // Pipeline state
  const [pipeline, setPipeline] = useState<PipelineEntry[]>([]);
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [modalLead, setModalLead] = useState<{ id: number; userName: string; product: string; pain: string; summary: string } | null>(null);
  const [modalForm, setModalForm] = useState({ stage: "agreed" as PipelineEntry["stage"], amount: "", followUpDate: "", note: "" });

  // Hydrate from Supabase on mount
  useEffect(() => {
    async function hydrate() {
      try {
        const [leadsRes, snapshotsRes, insightsRes, pipelineRes] = await Promise.all([
          fetch("/api/db/leads"),
          fetch("/api/db/snapshots"),
          fetch("/api/db/insights"),
          fetch("/api/db/pipeline"),
        ]);
        const [leadsData, snapshotsData, insightsData, pipelineData] = await Promise.all([
          leadsRes.json(), snapshotsRes.json(), insightsRes.json(), pipelineRes.json(),
        ]);

        // Map snake_case → camelCase from DB
        const leads: CachedLead[] = (leadsData.leads ?? []).map((r: {
          id: number; user_name: string; message_count: number; last_date: string;
          status: "hot" | "warm" | "cold"; summary: string; main_pain: string;
          interests: string[]; objections: string[]; next_step: string;
          recommended_product: string; analyzed_at: number;
        }) => ({
          id: r.id, userName: r.user_name, messageCount: r.message_count,
          lastDate: r.last_date, status: r.status, summary: r.summary,
          mainPain: r.main_pain, interests: r.interests ?? [],
          objections: r.objections ?? [], nextStep: r.next_step,
          recommendedProduct: r.recommended_product, analyzedAt: r.analyzed_at,
        }));

        setCache({
          version: 2,
          lastSyncAt: leads.length > 0 ? Date.now() : 0,
          leads,
          insights: insightsData.insights ?? null,
          dialogSnapshots: snapshotsData.snapshots ?? {},
        });
        setPipeline(pipelineData.entries ?? []);
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
          const hotSummaries = group.filter(l => l.status === "hot" && l.summary).slice(0, 3).map(l => l.summary);
          const summaries = hotSummaries.length > 0
            ? hotSummaries
            : group.filter(l => l.status === "warm" && l.summary).slice(0, 3).map(l => l.summary);
          return { pain, count: group.length, hot, warm, cold, topProduct, topInterests, summaries };
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
      let parsed: { platformContent?: unknown; objectionContent?: unknown; error?: string };
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
      if (parsed.platformContent) {
        const updatedInsights = {
          ...(cache.insights ?? { topPains: [], topQuestions: [], topObjections: [], contentRecommendations: [], summary: "" }),
          platformContent: parsed.platformContent,
          objectionContent: parsed.objectionContent ?? [],
        };
        setCache(prev => prev ? { ...prev, insights: updatedInsights as typeof prev.insights } : prev);
        setActivePainIndex(0);
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

      // Step 3: Fetch full history for new/changed only
      updateProgress({ step: 2, label: `Загрузка ${toFetch.length} диалогов...`, current: 0, total: toFetch.length });

      const fetchRes = await fetch("/api/fetch-dialogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peerIds: toFetch }),
      });
      const fetchData = await safeJson(fetchRes);
      if (fetchData.error) throw new Error(fetchData.error as string);

      const dialogs = (fetchData.dialogs as unknown[]) ?? [];

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
  const overdueCount = pipeline.filter(e => e.stage !== "closed" && e.followUpDate && e.followUpDate < today).length;
  const pipelinePotential = pipeline
    .filter(e => e.stage !== "closed")
    .reduce((sum, e) => sum + (parseFloat(e.amount.replace(/[^\d.]/g, "")) || 0), 0);

  const openPipelineModal = (lead: { id: number; userName: string; recommendedProduct: string; mainPain: string; summary: string }) => {
    setModalLead({ id: lead.id, userName: lead.userName, product: normalizeProduct(lead.recommendedProduct), pain: lead.mainPain, summary: lead.summary });
    setModalForm({ stage: "agreed", amount: "", followUpDate: "", note: "" });
    setShowPipelineModal(true);
  };

  const refreshPipeline = async () => {
    try {
      const res = await fetch("/api/db/pipeline");
      const data = await res.json();
      setPipeline(data.entries ?? []);
    } catch {}
  };

  const savePipelineModal = async () => {
    if (!modalLead) return;
    const entry: PipelineEntry = {
      leadId: modalLead.id, userName: modalLead.userName, product: modalLead.product,
      pain: modalLead.pain, summary: modalLead.summary,
      stage: modalForm.stage, note: modalForm.note,
      followUpDate: modalForm.followUpDate, amount: modalForm.amount,
      addedAt: Date.now(), updatedAt: Date.now(),
    };
    // Optimistic update
    setPipeline(prev => {
      const idx = prev.findIndex(e => e.leadId === entry.leadId);
      if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
      return [entry, ...prev];
    });
    setShowPipelineModal(false);
    await fetch("/api/db/pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry }) });
  };

  const movePipelineStage = async (leadId: number, stage: PipelineEntry["stage"], closedResult?: PipelineEntry["closedResult"]) => {
    const updates = { stage, ...(closedResult ? { closedResult } : {}) };
    setPipeline(prev => prev.map(e => e.leadId === leadId ? { ...e, ...updates } : e));
    await fetch("/api/db/pipeline", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, updates }) });
  };

  const deletePipelineEntry = async (leadId: number) => {
    setPipeline(prev => prev.filter(e => e.leadId !== leadId));
    await fetch("/api/db/pipeline", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId }) });
  };

  void refreshPipeline; // used indirectly via hydrate

  const lastSyncFormatted = cache?.lastSyncAt
    ? new Date(cache.lastSyncAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  const progressEta = (progress as (ProgressState & { eta?: number }) | null)?.eta;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Культура движения</h1>
            <p className="text-sm text-slate-500">Анализ диалогов ВКонтакте</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFullConfirm(true)}
              disabled={loading}
              className="flex items-center gap-2 border border-slate-200 hover:border-slate-300 disabled:opacity-40 text-slate-600 text-sm font-medium px-3 py-2 rounded-xl transition-colors"
              title="Пересчитать все диалоги заново"
            >
              <RotateCcw size={14} />
              <span className="hidden sm:inline">Пересчитать всё</span>
            </button>
            <button
              onClick={handleSmartRefresh}
              disabled={loading}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              {loading ? "Загрузка..." : "Обновить"}
            </button>
            <button
              onClick={async () => { await fetch("/api/auth/signout", { method: "POST" }); window.location.href = "/login"; }}
              className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 transition-colors"
              title="Выйти"
            >
              Выйти
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        {/* Sync status bar */}
        {(lastSyncFormatted || badge) && !loading && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            {lastSyncFormatted && (
              <span className="flex items-center gap-1.5">
                <CheckCircle size={14} className="text-green-500" />
                Последняя синхронизация: {lastSyncFormatted}
              </span>
            )}
            {badge && badge.newCount > 0 && (
              <span className="bg-green-100 text-green-700 border border-green-200 rounded-full px-2.5 py-0.5 text-xs font-medium">
                +{badge.newCount} новых
              </span>
            )}
            {badge && badge.updatedCount > 0 && (
              <span className="bg-yellow-100 text-yellow-700 border border-yellow-200 rounded-full px-2.5 py-0.5 text-xs font-medium">
                ~{badge.updatedCount} обновлено
              </span>
            )}
            {badge && badge.newCount === 0 && badge.updatedCount === 0 && (
              <span className="text-slate-400 text-xs">Новых диалогов нет</span>
            )}
            {total > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors ml-auto"
              >
                <Trash2 size={12} /> Очистить кеш
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
        )}

        {/* Loading progress */}
        {loading && (
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw size={16} className="animate-spin text-slate-500" />
              <p className="text-sm font-medium text-slate-700">Обновление данных...</p>
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

                  if (isDone) {
                    return (
                      <div key={step} className="flex items-center gap-2 text-sm text-green-600 py-1">
                        <CheckCircle size={14} />
                        <span>{label}</span>
                      </div>
                    );
                  }
                  if (isCurrent) {
                    const prog = progress.total > 0 ? progress.current / progress.total : 0;
                    return (
                      <div key={step} className="py-1">
                        <ProgressBar
                          progress={progress.total > 0 ? prog : 0.3}
                          label={label}
                          eta={progressEta}
                        />
                        {progress.total > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {progress.current} из {progress.total}
                            {progressEta !== undefined && progressEta > 0 ? ` · осталось ~${progressEta} сек` : ""}
                          </p>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={step} className="flex items-center gap-2 text-sm text-slate-400 py-1">
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-200 inline-block" />
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
            <MessageSquare size={48} className="mx-auto text-slate-300 mb-4" />
            <h2 className="text-xl font-semibold text-slate-600 mb-2">Нажмите «Обновить»</h2>
            <p className="text-slate-400 text-sm">Загрузим диалоги из ВКонтакте и проанализируем их</p>
          </div>
        )}

        {cache && !loading && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Всего лидов" value={total} color="text-slate-800" />
              <StatCard label="Горячих" value={hot} sub={total > 0 ? `${Math.round(hot / total * 100)}% базы` : ""} color="text-orange-500" />
              <StatCard label="Тёплых" value={warm} sub={total > 0 ? `${Math.round(warm / total * 100)}% базы` : ""} color="text-blue-500" />
              <StatCard label="Холодных" value={cold} sub={total > 0 ? `${Math.round(cold / total * 100)}% базы` : ""} color="text-slate-400" />
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-white rounded-xl border border-slate-100 p-1 w-fit">
              {(["strategy", "content", "pipeline", "tasks", "leads"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab === "strategy" ? "Стратегия"
                    : tab === "content" ? "Контент"
                    : tab === "pipeline" ? "Воронка"
                    : tab === "tasks" ? `Сообщения (${leads.filter(l => l.status !== "cold").length})`
                    : `Лиды (${total})`}
                  {tab === "pipeline" && overdueCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {overdueCount}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Strategy tab */}
            {activeTab === "strategy" && insights && (
              <div className="space-y-6">
                <div className="bg-slate-900 text-white rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb size={18} className="text-yellow-400" />
                    <p className="text-sm font-semibold text-slate-300">Стратегический вывод</p>
                  </div>
                  <p className="text-white/90 leading-relaxed">{insights.summary}</p>
                </div>

                <div>
                  <h2 className="text-lg font-bold text-slate-800 mb-3">Контент-план</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {insights.contentRecommendations.map((rec, i) => <ContentCard key={i} rec={rec} />)}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-4">Топ болей</h3>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={insights.topPains} layout="vertical" margin={{ left: 10, right: 20, top: 4, bottom: 4 }}>
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="label" width={200} tick={<YTick />} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                          {insights.topPains.map((_, i) => (
                            <Cell key={i} fill={i === 0 ? "#f97316" : i === 1 ? "#fb923c" : "#fdba74"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-4">Возражения</h3>
                    <div className="space-y-3">
                      {insights.topObjections.map((o, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-700">{o.label}</span>
                            <span className="text-slate-500 font-medium">{o.count}</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-red-400 rounded-full"
                              style={{ width: `${(o.count / (insights.topObjections[0]?.count || 1)) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm md:col-span-2">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <MessageSquare size={16} className="text-slate-400" /> Что спрашивают
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {insights.topQuestions.map((q, i) => (
                        <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                          <span className="text-sm text-slate-700">{q.label}</span>
                          <span className="text-sm font-bold text-slate-500 ml-2">{q.count}</span>
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
                      <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                        <h3 className="font-bold text-slate-800 mb-3">Вовлечённость (avg сообщений)</h3>
                        <div className="space-y-2">
                          {([["hot", "🔥", "text-orange-500"], ["warm", "🌤", "text-blue-500"], ["cold", "❄️", "text-slate-400"]] as const).map(([s, icon, cls]) => {
                            const avg = avgMsgsByStatus(s);
                            const maxAvg = Math.max(avgMsgsByStatus("hot"), avgMsgsByStatus("warm"), avgMsgsByStatus("cold"), 1);
                            return (
                              <div key={s}>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className={`font-medium ${cls}`}>{icon} {s === "hot" ? "Горячие" : s === "warm" ? "Тёплые" : "Холодные"}</span>
                                  <span className="text-slate-600 font-bold">{avg} сообщ.</span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${s === "hot" ? "bg-orange-400" : s === "warm" ? "bg-blue-400" : "bg-slate-300"}`}
                                    style={{ width: `${(avg / maxAvg) * 100}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                        <h3 className="font-bold text-slate-800 mb-3">Возражения</h3>
                        <div className="flex gap-4 mb-3">
                          <div className="flex-1 text-center">
                            <div className="text-2xl font-bold text-green-500">{noObjCount}</div>
                            <div className="text-xs text-slate-500 mt-0.5">без возражений</div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className="text-2xl font-bold text-red-400">{withObjCount}</div>
                            <div className="text-xs text-slate-500 mt-0.5">с возражениями</div>
                          </div>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                          <div className="h-full bg-green-400 rounded-l-full transition-all"
                            style={{ width: `${total > 0 ? (noObjCount / total) * 100 : 0}%` }} />
                          <div className="h-full bg-red-300 rounded-r-full transition-all"
                            style={{ width: `${total > 0 ? (withObjCount / total) * 100 : 0}%` }} />
                        </div>
                        <div className="text-xs text-slate-400 mt-1 text-right">
                          {total > 0 ? Math.round((noObjCount / total) * 100) : 0}% без возражений
                        </div>
                      </div>
                    </div>

                    {/* Топ интересов */}
                    {interestData.length > 0 && (
                      <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                        <h3 className="font-bold text-slate-800 mb-4">Топ интересов</h3>
                        <ResponsiveContainer width="100%" height={Math.max(160, interestData.length * 36)}>
                          <BarChart data={interestData} layout="vertical" margin={{ left: 10, right: 24, top: 2, bottom: 2 }}>
                            <XAxis type="number" tick={{ fontSize: 12 }} />
                            <YAxis type="category" dataKey="label" width={200} tick={<YTick />} />
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

            {activeTab === "strategy" && !insights && (
              <div className="text-center py-12 text-slate-400 text-sm">Нет данных для стратегии</div>
            )}

            {/* Content Strategy tab */}
            {activeTab === "content" && (() => {
              const platformContent = insights?.platformContent ?? [];
              const objectionContent = insights?.objectionContent ?? [];
              const activePain = platformContent[activePainIndex];

              if (!insights || platformContent.length === 0) {
                return (
                  <div className="text-center py-16">
                    <Lightbulb size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 font-medium mb-1">Нет данных контент-стратегии</p>
                    <p className="text-sm text-slate-400 mb-4">
                      {cache?.leads.length ? "Нажмите «Обновить стратегию» чтобы сгенерировать идеи" : "Сначала загрузите лидов через «Обновить данные»"}
                    </p>
                    {cache?.leads.length ? (
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
                <div className="space-y-6">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">Контент-стратегия по болям</h2>
                      <p className="text-sm text-slate-500 mt-0.5">Идеи для ВКонтакте, YouTube и Instagram на основе диалогов</p>
                    </div>
                    <button
                      onClick={handleRefreshStrategy}
                      disabled={refreshingStrategy}
                      className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={refreshingStrategy ? "animate-spin" : ""} />
                      {refreshingStrategy ? "Генерирую..." : "Обновить стратегию"}
                    </button>
                  </div>

                  {/* Pain selector pills */}
                  <div className="flex flex-wrap gap-2">
                    {platformContent.map((pc, i) => (
                      <button
                        key={i}
                        onClick={() => setActivePainIndex(i)}
                        className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                          activePainIndex === i
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                        }`}
                      >
                        {pc.pain}
                        <span className={`ml-2 text-xs ${activePainIndex === i ? "text-slate-300" : "text-slate-400"}`}>
                          {pc.leadsCount} лидов
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Platform columns */}
                  {activePain && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* VK */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold">VK</div>
                          <span className="font-semibold text-slate-800">ВКонтакте</span>
                        </div>
                        {activePain.vk.map((idea, i) => (
                          <div key={i} className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                            <span className="inline-block bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full mb-2">{idea.format}</span>
                            <p className="font-semibold text-slate-900 text-sm leading-snug mb-1">{idea.title}</p>
                            <p className="text-xs text-slate-500 italic">«{idea.hook}»</p>
                          </div>
                        ))}
                      </div>

                      {/* YouTube */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-7 h-7 rounded-lg bg-red-600 flex items-center justify-center text-white text-xs font-bold">▶</div>
                          <span className="font-semibold text-slate-800">YouTube</span>
                        </div>
                        {activePain.youtube.map((idea, i) => (
                          <div key={i} className="bg-red-50 border border-red-200 rounded-2xl p-4">
                            <span className="inline-block bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full mb-2">{idea.format}</span>
                            <p className="font-semibold text-slate-900 text-sm leading-snug mb-1">{idea.title}</p>
                            <p className="text-xs text-slate-500 italic">«{idea.hook}»</p>
                          </div>
                        ))}
                      </div>

                      {/* Instagram */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">In</div>
                          <span className="font-semibold text-slate-800">Instagram</span>
                        </div>
                        {activePain.instagram.map((idea, i) => (
                          <div key={i} className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
                            <span className="inline-block bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full mb-2">{idea.format}</span>
                            <p className="font-semibold text-slate-900 text-sm leading-snug mb-1">{idea.title}</p>
                            <p className="text-xs text-slate-500 italic">«{idea.hook}»</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Objection content */}
                  {objectionContent.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-slate-800 mb-3">Работа с возражениями в контенте</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {objectionContent.map((oc, i) => (
                          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                            <div className="flex items-start justify-between mb-2">
                              <span className="text-sm font-medium text-slate-700">«{oc.objection}»</span>
                              <span className="ml-2 shrink-0 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{oc.count} лидов</span>
                            </div>
                            <div className="flex items-center gap-1.5 mb-2">
                              <span className="text-xs text-slate-400">{oc.platform}</span>
                              <span className="text-slate-300">·</span>
                              <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">{oc.format}</span>
                            </div>
                            <p className="text-sm text-slate-600 leading-snug">{oc.contentIdea}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                          <div key={lead.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400 text-sm font-mono">{i + 1}.</span>
                                <span className="font-semibold text-slate-800">{lead.userName}</span>
                                <span className="text-xs text-slate-400">{lead.lastDate} · {lead.messageCount} сообщ.</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {lead.objections.length === 0 && (
                                  <span className="text-xs bg-green-50 text-green-600 border border-green-200 px-2 py-0.5 rounded-full font-medium">без возражений</span>
                                )}
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${cfg.pill}`}>{cfg.label}</span>
                              </div>
                            </div>

                            {/* Dosier body */}
                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">

                              {/* Контекст */}
                              <div className="md:col-span-2 bg-slate-50 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-400 mb-1 uppercase tracking-wide font-medium">Контекст диалога</div>
                                <div className="text-slate-700">{lead.summary}</div>
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
                                      <span key={ti} className="text-xs bg-white text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">{t}</span>
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
                                      <span key={oi} className="text-xs bg-white text-red-600 border border-red-200 px-2 py-0.5 rounded-full">{o}</span>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs text-green-700">Можно сразу переходить к офферу</div>
                                )}
                              </div>

                              {/* Следующий шаг + кнопка воронки */}
                              <div className="md:col-span-2 border-t border-slate-100 pt-3 flex items-center justify-between gap-2">
                                <div className="flex items-start gap-2 flex-1 min-w-0">
                                  <span className="text-slate-400 text-xs uppercase tracking-wide font-medium shrink-0 pt-0.5">Следующий шаг →</span>
                                  <span className="text-slate-800 font-medium text-sm">{lead.nextStep}</span>
                                </div>
                                <button
                                  onClick={() => openPipelineModal(lead)}
                                  className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                    pipeline.some(p => p.leadId === lead.id)
                                      ? "bg-indigo-100 text-indigo-700"
                                      : "bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                                  }`}
                                >
                                  <PlusCircle size={13} />
                                  {pipeline.some(p => p.leadId === lead.id) ? "В воронке" : "В воронку"}
                                </button>
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
            {activeTab === "pipeline" && (
              <div className="space-y-5">
                {/* Summary bar */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm text-center">
                    <div className="text-2xl font-bold text-indigo-600">{pipeline.filter(e => e.stage === "agreed").length}</div>
                    <div className="text-xs text-slate-500 mt-0.5">💰 Договорились</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm text-center">
                    <div className="text-2xl font-bold text-amber-500">{pipeline.filter(e => e.stage === "followup").length}</div>
                    <div className="text-xs text-slate-500 mt-0.5">🔔 Нужен дожим</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm text-center">
                    <div className="text-2xl font-bold text-slate-400">{pipeline.filter(e => e.stage === "closed").length}</div>
                    <div className="text-xs text-slate-500 mt-0.5">✅ Закрыто</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm text-center">
                    <div className="text-2xl font-bold text-green-600">{pipelinePotential > 0 ? pipelinePotential.toLocaleString("ru-RU") + " ₽" : "—"}</div>
                    <div className="text-xs text-slate-500 mt-0.5">Потенциал</div>
                  </div>
                </div>

                {pipeline.length === 0 && (
                  <div className="text-center py-16 text-slate-400 text-sm">
                    <Users size={32} className="mx-auto mb-3 opacity-30" />
                    Воронка пуста. Добавляйте лидов из таба «Сообщения».
                  </div>
                )}

                {/* Columns */}
                {(["agreed", "followup", "closed"] as const).map(stage => {
                  const group = pipeline.filter(e => e.stage === stage);
                  if (!group.length) return null;
                  const stageLabel = stage === "agreed" ? "💰 Договорился" : stage === "followup" ? "🔔 Нужен дожим" : "✅ Закрыто";
                  return (
                    <div key={stage}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-slate-700">{stageLabel}</span>
                        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{group.length}</span>
                      </div>
                      <div className="space-y-2">
                        {group.map(entry => {
                          const overdue = entry.followUpDate && entry.followUpDate < today && stage !== "closed";
                          return (
                            <div key={entry.leadId} className={`bg-white rounded-xl border shadow-sm p-4 ${overdue ? "border-red-300" : "border-slate-100"}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-semibold text-slate-800">{entry.userName}</div>
                                  <div className="text-xs text-slate-400 mt-0.5">{entry.product}{entry.amount ? ` · ${entry.amount} ₽` : ""}</div>
                                </div>
                                <button onClick={() => deletePipelineEntry(entry.leadId)} className="text-slate-300 hover:text-red-400 transition-colors shrink-0">
                                  <X size={14} />
                                </button>
                              </div>

                              {entry.pain && (
                                <div className="mt-2 text-xs text-orange-700 bg-orange-50 rounded px-2 py-1">{entry.pain}</div>
                              )}

                              {entry.followUpDate && (
                                <div className={`mt-2 flex items-center gap-1 text-xs font-medium ${overdue ? "text-red-500" : "text-slate-500"}`}>
                                  <Calendar size={11} />
                                  {new Date(entry.followUpDate + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                                  {overdue && " — ПРОСРОЧЕНО"}
                                </div>
                              )}

                              {entry.note && (
                                <div className="mt-2 text-xs text-slate-600 bg-slate-50 rounded px-2 py-1">📝 {entry.note}</div>
                              )}

                              {entry.closedResult && (
                                <div className={`mt-2 text-xs font-medium ${entry.closedResult === "paid" ? "text-green-600" : "text-slate-400"}`}>
                                  {entry.closedResult === "paid" ? "✓ Оплатил" : "✗ Отказался"}
                                </div>
                              )}

                              {stage !== "closed" && (
                                <div className="mt-3 flex gap-2 flex-wrap">
                                  {stage === "agreed" && (
                                    <button onClick={() => movePipelineStage(entry.leadId, "followup")}
                                      className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors">
                                      <Bell size={11} /> Нужен дожим
                                    </button>
                                  )}
                                  <button onClick={() => movePipelineStage(entry.leadId, "closed", "paid")}
                                    className="flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-lg hover:bg-green-100 transition-colors">
                                    <BadgeCheck size={11} /> Оплатил
                                  </button>
                                  <button onClick={() => movePipelineStage(entry.leadId, "closed", "refused")}
                                    className="flex items-center gap-1 text-xs bg-slate-50 text-slate-500 border border-slate-200 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors">
                                    <XCircle size={11} /> Отказался
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Leads tab */}
            {activeTab === "leads" && (
              <div className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-1">
                    {(["all", "hot", "warm", "cold"] as const).map(s => {
                      const cfg = s === "all" ? null : STATUS_CONFIG[s];
                      return (
                        <button
                          key={s}
                          onClick={() => setFilterStatus(s)}
                          className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                            filterStatus === s
                              ? "bg-slate-900 text-white border-slate-900"
                              : cfg
                              ? `${cfg.pill} hover:opacity-80`
                              : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          {s === "all" ? `Все (${total})` : `${cfg!.label} (${s === "hot" ? hot : s === "warm" ? warm : cold})`}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 flex-1 min-w-[160px] max-w-xs">
                    <Search size={14} className="text-slate-400 flex-shrink-0" />
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
                    className="flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 bg-white rounded-lg px-3 py-1.5 hover:border-slate-300 transition-colors ml-auto"
                  >
                    <Download size={13} /> Экспорт CSV
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
          </>
        )}
      </div>

      {/* Pipeline modal */}
      {showPipelineModal && modalLead && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">Добавить в воронку</h3>
              <button onClick={() => setShowPipelineModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-slate-400 mb-1">Клиент</div>
                <div className="text-sm font-medium text-slate-800">{modalLead.userName} — {modalLead.product}</div>
              </div>
              {modalLead.pain && (
                <div className="text-xs text-orange-700 bg-orange-50 rounded px-2 py-1">{modalLead.pain}</div>
              )}
              <div>
                <label className="text-xs text-slate-500 block mb-1">Стадия</label>
                <select value={modalForm.stage} onChange={e => setModalForm(f => ({ ...f, stage: e.target.value as PipelineEntry["stage"] }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400">
                  <option value="agreed">💰 Договорился — ждёт оплаты</option>
                  <option value="followup">🔔 Нужен дожим</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Сумма (₽)</label>
                <input type="text" placeholder="49900" value={modalForm.amount}
                  onChange={e => setModalForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Дата дожима</label>
                <input type="date" value={modalForm.followUpDate}
                  onChange={e => setModalForm(f => ({ ...f, followUpDate: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Заметка</label>
                <textarea rows={2} placeholder="Говорит, муж должен одобрить..." value={modalForm.note}
                  onChange={e => setModalForm(f => ({ ...f, note: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowPipelineModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50">
                Отмена
              </button>
              <button onClick={savePipelineModal}
                className="flex-1 bg-slate-900 text-white rounded-xl py-2 text-sm font-medium hover:bg-slate-700">
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear cache confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-slate-800 mb-2">Очистить кеш?</h3>
            <p className="text-sm text-slate-500 mb-4">Все сохранённые данные будут удалены. При следующем обновлении придётся анализировать всё заново.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowClearConfirm(false)} className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Отмена</button>
              <button
                onClick={() => { setCache(null); setBadge(null); setShowClearConfirm(false); }}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2 text-sm font-medium"
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
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-slate-800 mb-2">Пересчитать всё?</h3>
            <p className="text-sm text-slate-500 mb-4">Все диалоги будут загружены и проанализированы заново. Это займёт несколько минут и потратит Claude API кредиты.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowFullConfirm(false)} className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Отмена</button>
              <button onClick={handleFullRefresh} className="flex-1 bg-slate-900 hover:bg-slate-700 text-white rounded-xl py-2 text-sm font-medium">
                Пересчитать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
