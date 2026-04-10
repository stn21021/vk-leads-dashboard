"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Flame,
  Cloud,
  Snowflake,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  BookOpen,
  TrendingUp,
  MessageSquare,
  Users,
  Lightbulb,
} from "lucide-react";

interface Lead {
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

interface ContentRec {
  priority: "urgent" | "warm" | "education";
  title: string;
  format: string;
  pain: string;
  leadsCount: number;
}

interface Insights {
  topPains: { label: string; count: number }[];
  topQuestions: { label: string; count: number }[];
  topObjections: { label: string; count: number }[];
  contentRecommendations: ContentRec[];
  summary: string;
}

interface AnalysisResult {
  leads: Lead[];
  insights: Insights;
}

const STATUS_CONFIG = {
  hot: { label: "Горячий", icon: Flame, color: "text-orange-500", bg: "bg-orange-50 border-orange-200", dot: "bg-orange-500" },
  warm: { label: "Тёплый", icon: Cloud, color: "text-blue-500", bg: "bg-blue-50 border-blue-200", dot: "bg-blue-400" },
  cold: { label: "Холодный", icon: Snowflake, color: "text-slate-400", bg: "bg-slate-50 border-slate-200", dot: "bg-slate-400" },
};

const PRIORITY_CONFIG = {
  urgent: { label: "Срочно", icon: Zap, color: "text-orange-600", bg: "bg-orange-50 border-orange-200", badge: "bg-orange-100 text-orange-700" },
  warm: { label: "Прогрев", icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50 border-blue-200", badge: "bg-blue-100 text-blue-700" },
  education: { label: "Образование", icon: BookOpen, color: "text-violet-600", bg: "bg-violet-50 border-violet-200", badge: "bg-violet-100 text-violet-700" },
};

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
      <p className="text-sm text-slate-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[lead.status];
  const Icon = cfg.icon;

  return (
    <div className={`rounded-xl border ${cfg.bg} overflow-hidden transition-all`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/50 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${cfg.dot} flex-shrink-0`} />
        <span className="font-medium text-slate-800 flex-1">{lead.userName}</span>
        <span className={`flex items-center gap-1 text-xs font-medium ${cfg.color} mr-2`}>
          <Icon size={13} />
          {cfg.label}
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

function ContentCard({ rec }: { rec: ContentRec }) {
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
        <span className="text-xs bg-white/80 border border-slate-200 rounded px-2 py-0.5 text-slate-600">
          {rec.format}
        </span>
        <span className="text-xs text-slate-500">Боль: {rec.pain}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"strategy" | "leads">("strategy");

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchRes = await fetch("/api/fetch-dialogs");
      const fetchData = await fetchRes.json();
      if (fetchData.error) throw new Error(fetchData.error);
      if (!fetchData.dialogs?.length) throw new Error("Диалоги не найдены");

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dialogs: fetchData.dialogs }),
      });
      const analyzed = await analyzeRes.json();
      if (analyzed.error) throw new Error(analyzed.error);

      setData(analyzed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  };

  const hot = data?.leads.filter(l => l.status === "hot").length ?? 0;
  const warm = data?.leads.filter(l => l.status === "warm").length ?? 0;
  const cold = data?.leads.filter(l => l.status === "cold").length ?? 0;
  const total = data?.leads.length ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Sparta Amazonky</h1>
            <p className="text-sm text-slate-500">Анализ диалогов ВКонтакте</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            {loading ? "Загрузка..." : "Обновить данные"}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!data && !loading && !error && (
          <div className="text-center py-24">
            <MessageSquare size={48} className="mx-auto text-slate-300 mb-4" />
            <h2 className="text-xl font-semibold text-slate-600 mb-2">Нажмите «Обновить данные»</h2>
            <p className="text-slate-400 text-sm">Загрузим диалоги из ВКонтакте и проанализируем их</p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="text-center py-24">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-500 text-sm">Анализируем диалоги...</p>
            <p className="text-slate-400 text-xs mt-1">Это может занять 1-2 минуты</p>
          </div>
        )}

        {data && (
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
              <button
                onClick={() => setActiveTab("strategy")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "strategy" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
              >
                Стратегия
              </button>
              <button
                onClick={() => setActiveTab("leads")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "leads" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
              >
                Лиды ({total})
              </button>
            </div>

            {activeTab === "strategy" && (
              <div className="space-y-6">
                {/* AI Summary */}
                <div className="bg-slate-900 text-white rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb size={18} className="text-yellow-400" />
                    <p className="text-sm font-semibold text-slate-300">Стратегический вывод</p>
                  </div>
                  <p className="text-white/90 leading-relaxed">{data.insights.summary}</p>
                </div>

                {/* Content Recommendations */}
                <div>
                  <h2 className="text-lg font-bold text-slate-800 mb-3">Контент-план</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {data.insights.contentRecommendations.map((rec, i) => (
                      <ContentCard key={i} rec={rec} />
                    ))}
                  </div>
                </div>

                {/* Pains & Questions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Top Pains */}
                  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-4">Топ болей</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={data.insights.topPains} layout="vertical" margin={{ left: 0, right: 20 }}>
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                          {data.insights.topPains.map((_, i) => (
                            <Cell key={i} fill={i === 0 ? "#f97316" : i === 1 ? "#fb923c" : "#fdba74"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Top Objections */}
                  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-4">Возражения</h3>
                    <div className="space-y-3">
                      {data.insights.topObjections.map((o, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-700">{o.label}</span>
                            <span className="text-slate-500 font-medium">{o.count}</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-red-400 rounded-full"
                              style={{ width: `${(o.count / (data.insights.topObjections[0]?.count || 1)) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Top Questions */}
                  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm md:col-span-2">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <MessageSquare size={16} className="text-slate-400" /> Что спрашивают
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {data.insights.topQuestions.map((q, i) => (
                        <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                          <span className="text-sm text-slate-700">{q.label}</span>
                          <span className="text-sm font-bold text-slate-500 ml-2">{q.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "leads" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Users size={15} />
                  <span>{total} диалогов проанализировано</span>
                </div>
                {(["hot", "warm", "cold"] as const).map(status => {
                  const group = data.leads.filter(l => l.status === status);
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
    </div>
  );
}
