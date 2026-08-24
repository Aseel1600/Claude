"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Input from "@/shared/components/Input";
import Select from "@/shared/components/Select";
import SegmentedControl from "@/shared/components/SegmentedControl";
import Toggle from "@/shared/components/Toggle";
import { useLiveDashboard } from "@/hooks/useLiveDashboard";

const TYPES = ["coder", "analyser", "reviewer", "agentic", "tools"] as const;
const LEVELS = ["mid", "high", "xhigh", "max"] as const;
const MODES = [
  { value: "bruxo", label: "BRUXO", icon: "auto_awesome" },
  { value: "obruxo-free", label: "BRUXO-FREE", icon: "bolt" },
  { value: "bruxo-max", label: "BRUXO-MAX", icon: "workspace_premium" },
];
const VIEWS = [
  { value: "overview", label: "Visão geral", icon: "dashboard" },
  { value: "matrix", label: "Matriz", icon: "account_tree" },
  { value: "analytics", label: "Analytics", icon: "monitoring" },
];

type JsonRecord = Record<string, any>;

interface ObruxoConfig {
  enabled: boolean;
  entryModels: string[];
  fallbackCategory?: string;
  maxFallbackLevel?: string;
  routes: JsonRecord;
  entryRoutes?: JsonRecord;
  levelFloors?: JsonRecord;
}

interface ObruxoCombo {
  id: string;
  name: string;
  description?: string;
  strategy: string;
  isActive: boolean;
  contextLength: number;
  models: Array<{
    id: string;
    model: string;
    provider: string;
    label: string;
    weight: number;
    enabled: boolean;
  }>;
  metrics: {
    totalRequests: number;
    totalSuccesses: number;
    totalFailures: number;
    totalFallbacks: number;
    avgLatencyMs: number;
    successRate: number;
    lastUsedAt: string | null;
  };
}

interface ConfigResponse {
  enabled: boolean;
  config: ObruxoConfig | null;
  combos: ObruxoCombo[];
  revision: number;
  generatedAt: string;
}

interface AnalyticsResponse {
  generatedAt: string;
  range: string;
  totals: {
    requests: number;
    executionCalls: number;
    successes: number;
    errors: number;
    successRate: number;
    fallbacks: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    estimatedCostUsd: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  byType: GroupRow[];
  byLevel: GroupRow[];
  byMode: GroupRow[];
  byCombo: GroupRow[];
  byModel: GroupRow[];
  anomalies: Anomaly[];
  recent: RecentRow[];
}

interface GroupRow {
  name: string;
  count: number;
  success: number;
  errors: number;
  tokens: number;
  cost: number;
  successRate: number;
  share: number;
  avgLatencyMs?: number;
}

interface Anomaly {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
}

interface RecentRow {
  timestamp: string;
  requestedModel: string;
  mode: string;
  type: string;
  level: string;
  complexity: string | null;
  score: number | null;
  combo: string | null;
  model: string | null;
  provider: string | null;
  status: string;
  fallbackCount: number;
  inputTokens: number;
  outputTokens: number;
}

type ViewName = "overview" | "matrix" | "analytics";

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits }).format(value || 0);
}

function formatCost(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "nunca";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return formatNumber(value);
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function modeRoutes(config: ObruxoConfig, mode: string) {
  if (mode === "bruxo") return config.routes || {};
  return config.entryRoutes?.[mode] || {};
}

function routeFor(config: ObruxoConfig, mode: string, type: string, level: string) {
  return modeRoutes(config, mode)?.[type]?.[level] || "";
}

function setRoute(config: ObruxoConfig, mode: string, type: string, level: string, value: string) {
  const next = clone(config);
  if (mode === "bruxo") {
    next.routes = { ...(next.routes || {}) };
    next.routes[type] = { ...(next.routes[type] || {}), [level]: value };
  } else {
    next.entryRoutes = { ...(next.entryRoutes || {}) };
    next.entryRoutes[mode] = { ...(next.entryRoutes[mode] || {}) };
    next.entryRoutes[mode][type] = { ...(next.entryRoutes[mode][type] || {}), [level]: value };
  }
  return next;
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <Card className={`border-l-4 ${tone}`} padding="sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-text-main">{value}</p>
          <p className="mt-1 text-xs text-text-muted">{detail}</p>
        </div>
        <span className="material-symbols-outlined text-[22px] text-text-muted" aria-hidden="true">
          {icon}
        </span>
      </div>
    </Card>
  );
}

function BarList({
  rows,
  emptyLabel = "Sem dados no período",
}: {
  rows: GroupRow[];
  emptyLabel?: string;
}) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-text-muted">{emptyLabel}</p>;
  const colors = ["bg-cyan-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-violet-500"];
  return (
    <div className="space-y-4">
      {rows.slice(0, 6).map((row, index) => (
        <div key={row.name} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium text-text-main">{row.name}</span>
            <span className="shrink-0 text-xs text-text-muted">
              {formatNumber(row.count)} · {formatPercent(row.share)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className={`h-full rounded-full ${colors[index % colors.length]} transition-all`}
              style={{ width: `${Math.max(2, row.share * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const variant =
    normalized === "200" || normalized === "ok"
      ? "success"
      : normalized === "routed"
        ? "info"
        : "error";
  return (
    <Badge variant={variant} size="sm" dot>
      {status}
    </Badge>
  );
}

export default function ObruxoDashboardClient() {
  const [view, setView] = useState<ViewName>("overview");
  const [configData, setConfigData] = useState<ConfigResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [draft, setDraft] = useState<ObruxoConfig | null>(null);
  const [selectedMode, setSelectedMode] = useState("bruxo");
  const [range, setRange] = useState("24h");
  const [filterType, setFilterType] = useState("");
  const [filterLevel, setFilterLevel] = useState("");
  const [filterMode, setFilterMode] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [simulationText, setSimulationText] = useState(
    "Analise esta tarefa e indique a melhor estrategia de implementacao."
  );
  const [simulationModel, setSimulationModel] = useState("obruxo");
  const [simulation, setSimulation] = useState<JsonRecord | null>(null);
  const [liveRefresh, setLiveRefresh] = useState(0);
  const liveRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshAnalytics = useCallback(
    async (silent = true) => {
      if (!silent) setAnalyticsLoading(true);
      try {
        const params = new URLSearchParams({ range });
        if (filterType) params.set("type", filterType);
        if (filterLevel) params.set("level", filterLevel);
        if (filterMode) params.set("mode", filterMode);
        const response = await fetch(`/api/obruxo/analytics?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Não foi possível carregar as métricas do Obruxo.");
        setAnalytics((await response.json()) as AnalyticsResponse);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Falha ao carregar analytics.");
      } finally {
        setAnalyticsLoading(false);
      }
    },
    [filterLevel, filterMode, filterType, range]
  );

  const refreshConfig = useCallback(async (silent = true) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/obruxo/config", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar a configuração do Obruxo.");
      const payload = (await response.json()) as ConfigResponse;
      setConfigData(payload);
      setDraft(payload.config ? clone(payload.config) : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar configuração.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setError(null);
    await Promise.all([refreshConfig(false), refreshAnalytics(false)]);
  }, [refreshAnalytics, refreshConfig]);

  const onLiveEvent = useCallback(() => setLiveRefresh((value) => value + 1), []);
  const { connection } = useLiveDashboard({
    channels: ["requests", "combo"],
    onEvent: onLiveEvent,
  });

  useEffect(() => {
    void refreshAll();
    const timer = setInterval(() => void refreshAnalytics(), 15_000);
    return () => clearInterval(timer);
  }, [refreshAll, refreshAnalytics]);

  useEffect(() => {
    if (liveRefresh === 0) return;
    if (liveRefreshTimer.current) clearTimeout(liveRefreshTimer.current);
    liveRefreshTimer.current = setTimeout(() => void refreshAnalytics(), 1200);
    return () => {
      if (liveRefreshTimer.current) clearTimeout(liveRefreshTimer.current);
    };
  }, [liveRefresh, refreshAnalytics]);

  const dirty = useMemo(
    () => JSON.stringify(configData?.config) !== JSON.stringify(draft),
    [configData?.config, draft]
  );
  const comboOptions = useMemo(
    () =>
      (configData?.combos || [])
        .filter((combo) => combo.isActive)
        .map((combo) => ({ value: combo.name, label: combo.name })),
    [configData?.combos]
  );
  const totals = analytics?.totals;

  const saveConfig = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/obruxo/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: draft, expectedRevision: configData?.revision }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao salvar configuração.");
      setConfigData(payload as ConfigResponse);
      setDraft(payload.config ? clone(payload.config) : null);
      setNotice("Configuração aplicada. As próximas requisições já usarão as novas regras.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar configuração.");
    } finally {
      setSaving(false);
    }
  };

  const simulate = async () => {
    setSimulating(true);
    setError(null);
    try {
      const response = await fetch("/api/obruxo/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: simulationModel, text: simulationText }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao simular rota.");
      setSimulation(payload.decision || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao simular rota.");
    } finally {
      setSimulating(false);
    }
  };

  const updateDraftRoute = (type: string, level: string, value: string) => {
    if (!draft) return;
    setDraft(setRoute(draft, selectedMode, type, level, value));
  };

  const updateFloor = (key: string, value: string) => {
    if (!draft) return;
    const next = clone(draft);
    next.levelFloors = { ...(next.levelFloors || {}), [key]: value };
    setDraft(next);
  };

  if (loading && !configData) {
    return (
      <div className="flex min-h-[420px] items-center justify-center text-sm text-text-muted">
        <span className="material-symbols-outlined mr-2 animate-spin">progress_activity</span>
        Carregando Obruxo...
      </div>
    );
  }

  if (!configData?.config || !draft) {
    return (
      <Card title="Obruxo indisponível" icon="warning">
        <p className="text-sm text-text-muted">
          A configuração do roteador ainda não está provisionada.
        </p>
        <Button className="mt-4" icon="refresh" onClick={() => void refreshAll()}>
          Tentar novamente
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-4 border-b border-border pb-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <span className="material-symbols-outlined text-[26px]">auto_awesome</span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-text-main">Obruxo</h1>
              <Badge variant={draft.enabled ? "success" : "warning"} dot>
                {draft.enabled ? "ativo" : "pausado"}
              </Badge>
              <Badge variant={connection.isConnected ? "info" : "warning"} dot>
                {connection.isConnected ? "live" : "polling"}
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-text-muted">
              Controle autoral de tipos, níveis, combos e decisões de roteamento.
            </p>
            <p className="mt-2 text-xs text-text-muted">
              Atualizado {formatDate(configData.generatedAt)} · revisão {configData.revision}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon="refresh" onClick={() => void refreshAll()}>
            Atualizar
          </Button>
          <Button
            variant={dirty ? "primary" : "secondary"}
            icon="save"
            loading={saving}
            disabled={!dirty}
            onClick={() => void saveConfig()}
          >
            Salvar alterações
          </Button>
        </div>
      </header>

      {(error || notice) && (
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${error ? "border-red-500/30 bg-red-500/5 text-red-600" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700"}`}
          role="status"
        >
          <span className="material-symbols-outlined text-[19px]">
            {error ? "error" : "check_circle"}
          </span>
          <span className="flex-1">{error || notice}</span>
          <button
            className="text-current opacity-70 hover:opacity-100"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
            aria-label="Fechar mensagem"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      <SegmentedControl
        options={VIEWS}
        value={view}
        onChange={(value) => setView(value as ViewName)}
        aria-label="Área do painel Obruxo"
      />

      {view === "overview" && (
        <OverviewView
          analytics={analytics}
          totals={totals}
          simulationText={simulationText}
          setSimulationText={setSimulationText}
          simulationModel={simulationModel}
          setSimulationModel={setSimulationModel}
          simulate={simulate}
          simulating={simulating}
          simulation={simulation}
        />
      )}

      {view === "matrix" && (
        <MatrixView
          draft={draft}
          combos={configData.combos}
          selectedMode={selectedMode}
          setSelectedMode={setSelectedMode}
          updateDraftRoute={updateDraftRoute}
          updateFloor={updateFloor}
          setEnabled={(enabled) =>
            setDraft((current) => (current ? { ...current, enabled } : current))
          }
          comboOptions={comboOptions}
        />
      )}

      {view === "analytics" && (
        <AnalyticsView
          analytics={analytics}
          loading={analyticsLoading}
          range={range}
          setRange={setRange}
          filterType={filterType}
          setFilterType={setFilterType}
          filterLevel={filterLevel}
          setFilterLevel={setFilterLevel}
          filterMode={filterMode}
          setFilterMode={setFilterMode}
        />
      )}
    </div>
  );
}

function OverviewView({
  analytics,
  totals,
  simulationText,
  setSimulationText,
  simulationModel,
  setSimulationModel,
  simulate,
  simulating,
  simulation,
}: {
  analytics: AnalyticsResponse | null;
  totals?: AnalyticsResponse["totals"];
  simulationText: string;
  setSimulationText: (value: string) => void;
  simulationModel: string;
  setSimulationModel: (value: string) => void;
  simulate: () => void;
  simulating: boolean;
  simulation: JsonRecord | null;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon="bolt"
          label="Decisões"
          value={formatNumber(totals?.requests || 0)}
          detail="últimas 24 horas"
          tone="border-l-cyan-500"
        />
        <MetricCard
          icon="payments"
          label="Custo estimado"
          value={formatCost(totals?.estimatedCostUsd || 0)}
          detail={`${formatTokens(totals?.inputTokens || 0)} tokens de entrada`}
          tone="border-l-emerald-500"
        />
        <MetricCard
          icon="speed"
          label="Latência média"
          value={`${formatNumber(totals?.avgLatencyMs || 0)} ms`}
          detail={`p95 ${formatNumber(totals?.p95LatencyMs || 0)} ms`}
          tone="border-l-amber-500"
        />
        <MetricCard
          icon="verified"
          label="Sucesso"
          value={formatPercent(totals?.successRate || 0)}
          detail={`${formatNumber(totals?.fallbacks || 0)} fallbacks`}
          tone="border-l-violet-500"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card
          title="Distribuição operacional"
          subtitle="Onde o roteador está concentrando decisões"
          icon="bar_chart"
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-text-main">Tipos</h4>
                <span className="text-xs text-text-muted">mais usados</span>
              </div>
              <BarList rows={analytics?.byType || []} />
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-text-main">Níveis</h4>
                <span className="text-xs text-text-muted">dificuldade</span>
              </div>
              <BarList rows={analytics?.byLevel || []} />
            </div>
          </div>
        </Card>
        <SimulationCard
          simulationText={simulationText}
          setSimulationText={setSimulationText}
          simulationModel={simulationModel}
          setSimulationModel={setSimulationModel}
          simulate={simulate}
          simulating={simulating}
          simulation={simulation}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card
          title="Modelos mais chamados"
          subtitle="Execuções reais nos combos Obruxo"
          icon="model_training"
        >
          <BarList rows={analytics?.byModel || []} />
        </Card>
        <Card
          title="Sinais importantes"
          subtitle="Indicadores para revisão da matriz"
          icon="notifications_active"
        >
          <AnomalyList anomalies={analytics?.anomalies || []} />
        </Card>
      </div>

      <RecentRequests rows={analytics?.recent || []} />
    </div>
  );
}

function SimulationCard({
  simulationText,
  setSimulationText,
  simulationModel,
  setSimulationModel,
  simulate,
  simulating,
  simulation,
}: {
  simulationText: string;
  setSimulationText: (value: string) => void;
  simulationModel: string;
  setSimulationModel: (value: string) => void;
  simulate: () => void;
  simulating: boolean;
  simulation: JsonRecord | null;
}) {
  return (
    <Card
      title="Simulador de rota"
      subtitle="Teste a classificação sem chamar um provider"
      icon="science"
    >
      <div className="space-y-3">
        <Select
          label="Entrada"
          value={simulationModel}
          onChange={(event) => setSimulationModel(event.target.value)}
          options={[
            { value: "obruxo", label: "BRUXO automático" },
            { value: "obruxo-free", label: "BRUXO-FREE" },
            { value: "bruxo-max", label: "BRUXO-MAX" },
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-main" htmlFor="obruxo-simulation-text">
            Mensagem
          </label>
          <textarea
            id="obruxo-simulation-text"
            value={simulationText}
            onChange={(event) => setSimulationText(event.target.value)}
            rows={3}
            className="w-full resize-y rounded-control border border-black/10 bg-white px-3 py-2 text-sm text-text-main shadow-inner outline-none transition focus:border-accent/50 focus:ring-1 focus:ring-accent/30 dark:border-white/10 dark:bg-white/5"
          />
        </div>
        <Button icon="play_arrow" loading={simulating} onClick={() => simulate()}>
          Simular decisão
        </Button>
        {simulation && <SimulationResult decision={simulation} />}
      </div>
    </Card>
  );
}

function SimulationResult({ decision }: { decision: JsonRecord }) {
  return (
    <div className="mt-2 rounded-lg border border-border bg-black/[0.02] p-3 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="primary">{decision.category || "sem categoria"}</Badge>
        <Badge variant="info">{String(decision.level || "-").toUpperCase()}</Badge>
        <span className="text-xs text-text-muted">{decision.resolvedCombo || "sem combo"}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-muted">
        <span>
          complexity <strong className="text-text-main">{decision.complexity || "-"}</strong>
        </span>
        <span>
          score <strong className="text-text-main">{decision.score ?? "-"}</strong>
        </span>
        <span>
          tokens{" "}
          <strong className="text-text-main">
            {formatTokens(Number(decision.inputTokens || 0))}
          </strong>
        </span>
        <span>
          fallback{" "}
          <strong className="text-text-main">{decision.fallbackApplied ? "sim" : "não"}</strong>
        </span>
      </div>
      {Array.isArray(decision.signals) && decision.signals.length > 0 && (
        <p className="mt-3 border-t border-border pt-2 text-xs text-text-muted">
          Sinais: {decision.signals.join(", ")}
        </p>
      )}
    </div>
  );
}

function MatrixView({
  draft,
  combos,
  selectedMode,
  setSelectedMode,
  updateDraftRoute,
  updateFloor,
  setEnabled,
  comboOptions,
}: {
  draft: ObruxoConfig;
  combos: ObruxoCombo[];
  selectedMode: string;
  setSelectedMode: (value: string) => void;
  updateDraftRoute: (type: string, level: string, value: string) => void;
  updateFloor: (key: string, value: string) => void;
  setEnabled: (value: boolean) => void;
  comboOptions: Array<{ value: string; label: string }>;
}) {
  const routeConfig = modeRoutes(draft, selectedMode);
  return (
    <div className="space-y-6">
      <Card
        title="Matriz de roteamento"
        subtitle="Cada célula representa o destino efetivo do nível selecionado"
        icon="account_tree"
        action={
          <Badge
            variant={
              selectedMode === "bruxo-max"
                ? "warning"
                : selectedMode === "obruxo-free"
                  ? "success"
                  : "primary"
            }
          >
            {selectedMode.toUpperCase()}
          </Badge>
        }
      >
        <div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl text-sm text-text-muted">
            Edite a matriz por modo. O modo BRUXO-MAX permanece isolado e aponta para os combos
            premium.
          </div>
          <SegmentedControl
            options={MODES}
            value={selectedMode}
            onChange={setSelectedMode}
            size="sm"
            aria-label="Modo de roteamento"
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-[850px] w-full text-left text-sm">
            <thead className="bg-black/[0.03] dark:bg-white/[0.04]">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Tipo
                </th>
                {LEVELS.map((level) => (
                  <th
                    key={level}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                  >
                    {level}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TYPES.map((type) => (
                <tr key={type} className="border-t border-border">
                  <th className="px-4 py-4 align-top font-semibold text-text-main">
                    {titleCase(type)}
                    <span className="mt-1 block text-xs font-normal text-text-muted">
                      {type === "tools" ? "capacidade" : "semântica"}
                    </span>
                  </th>
                  {LEVELS.map((level) => {
                    const value = routeFor(draft, selectedMode, type, level);
                    const combo = combos.find((item) => item.name === value);
                    return (
                      <td key={level} className="px-3 py-3 align-top">
                        <select
                          aria-label={`${type} ${level}`}
                          value={value}
                          onChange={(event) => updateDraftRoute(type, level, event.target.value)}
                          className="w-full min-w-[150px] rounded-control border border-black/10 bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 dark:border-white/10"
                        >
                          <option value="">Sem rota</option>
                          {comboOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {combo && (
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
                            <span
                              className={`size-1.5 rounded-full ${combo.isActive ? "bg-emerald-500" : "bg-amber-500"}`}
                            />
                            {combo.strategy} · {combo.models.length} modelos
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Políticas de elevação"
        subtitle="Floors podem promover uma decisão, nunca reduzir o nível calculado"
        icon="tune"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {["largeContext", "multiTask", "criticalRisk", "tools"].map((key) => (
            <Select
              key={key}
              label={
                key === "largeContext"
                  ? "Contexto grande"
                  : key === "multiTask"
                    ? "Multi-tarefa"
                    : key === "criticalRisk"
                      ? "Risco crítico"
                      : "Tools"
              }
              hint={
                key === "tools"
                  ? "Filtro de capacidade; não é nível semântico."
                  : "Nível mínimo aplicado pelo sinal."
              }
              value={draft.levelFloors?.[key] || "xhigh"}
              onChange={(event) => updateFloor(key, event.target.value)}
              options={LEVELS.map((level) => ({ value: level, label: level.toUpperCase() }))}
            />
          ))}
        </div>
        <div className="mt-5 grid gap-4 border-t border-border pt-4 md:grid-cols-2">
          <Toggle
            checked={draft.enabled}
            label="Roteador Obruxo ativo"
            description="Aplica a matriz às entradas configuradas."
            onChange={setEnabled}
          />
          <div className="rounded-lg border border-border bg-black/[0.02] p-3 text-xs text-text-muted dark:bg-white/[0.03]">
            <strong className="text-text-main">Entrada automática:</strong>{" "}
            {draft.entryModels?.join(", ") || "nenhuma"}
          </div>
        </div>
      </Card>
    </div>
  );
}

function AnalyticsView({
  analytics,
  loading,
  range,
  setRange,
  filterType,
  setFilterType,
  filterLevel,
  setFilterLevel,
  filterMode,
  setFilterMode,
}: {
  analytics: AnalyticsResponse | null;
  loading: boolean;
  range: string;
  setRange: (value: string) => void;
  filterType: string;
  setFilterType: (value: string) => void;
  filterLevel: string;
  setFilterLevel: (value: string) => void;
  filterMode: string;
  setFilterMode: (value: string) => void;
}) {
  return (
    <div className="space-y-6">
      <Card
        title="Analytics do Obruxo"
        subtitle="Decisão do roteador e execução real dos providers"
        icon="monitoring"
        action={
          loading ? (
            <Badge variant="info" dot>
              atualizando
            </Badge>
          ) : (
            <Badge variant="success" dot>
              atualizado
            </Badge>
          )
        }
      >
        <div className="grid gap-3 border-b border-border pb-5 md:grid-cols-2 xl:grid-cols-4">
          <Select
            label="Período"
            value={range}
            onChange={(event) => setRange(event.target.value)}
            options={[
              { value: "24h", label: "Últimas 24 horas" },
              { value: "7d", label: "Últimos 7 dias" },
              { value: "30d", label: "Últimos 30 dias" },
              { value: "90d", label: "Últimos 90 dias" },
              { value: "all", label: "Todo o histórico" },
            ]}
          />
          <Select
            label="Tipo"
            value={filterType}
            onChange={(event) => setFilterType(event.target.value)}
            placeholder="Todos os tipos"
            options={[
              { value: "coder", label: "Coder" },
              { value: "analyser", label: "Analyser" },
              { value: "reviewer", label: "Reviewer" },
              { value: "agentic", label: "Agentic" },
              { value: "tools", label: "Tools" },
            ]}
          />
          <Select
            label="Nível"
            value={filterLevel}
            onChange={(event) => setFilterLevel(event.target.value)}
            placeholder="Todos os níveis"
            options={LEVELS.map((level) => ({ value: level, label: level.toUpperCase() }))}
          />
          <Select
            label="Modo"
            value={filterMode}
            onChange={(event) => setFilterMode(event.target.value)}
            placeholder="Todos os modos"
            options={[
              { value: "obruxo", label: "BRUXO" },
              { value: "obruxo-free", label: "BRUXO-FREE" },
              { value: "bruxo-max", label: "BRUXO-MAX" },
            ]}
          />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            icon="bolt"
            label="Decisões"
            value={formatNumber(analytics?.totals.requests || 0)}
            detail={`${formatNumber(analytics?.totals.executionCalls || 0)} execuções`}
            tone="border-l-cyan-500"
          />
          <MetricCard
            icon="payments"
            label="Custo"
            value={formatCost(analytics?.totals.estimatedCostUsd || 0)}
            detail="estimado"
            tone="border-l-emerald-500"
          />
          <MetricCard
            icon="token"
            label="Tokens"
            value={formatTokens(
              (analytics?.totals.inputTokens || 0) + (analytics?.totals.outputTokens || 0)
            )}
            detail={`${formatTokens(analytics?.totals.cacheReadTokens || 0)} cache read`}
            tone="border-l-violet-500"
          />
          <MetricCard
            icon="speed"
            label="p95"
            value={`${formatNumber(analytics?.totals.p95LatencyMs || 0)} ms`}
            detail={`média ${formatNumber(analytics?.totals.avgLatencyMs || 0)} ms`}
            tone="border-l-amber-500"
          />
          <MetricCard
            icon="error"
            label="Falhas"
            value={formatNumber(analytics?.totals.errors || 0)}
            detail={`${formatNumber(analytics?.totals.fallbacks || 0)} fallbacks`}
            tone="border-l-rose-500"
          />
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Tipos" icon="category">
          <BarList rows={analytics?.byType || []} />
        </Card>
        <Card title="Níveis" icon="stairs">
          <BarList rows={analytics?.byLevel || []} />
        </Card>
        <Card title="Modos" icon="hub">
          <BarList rows={analytics?.byMode || []} />
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card
          title="Modelos mais chamados"
          subtitle="Contagem de execuções reais"
          icon="model_training"
        >
          <RankedTable rows={analytics?.byModel || []} model />
        </Card>
        <Card title="Alertas" subtitle="Sinais que merecem revisão" icon="notifications_active">
          <AnomalyList anomalies={analytics?.anomalies || []} />
        </Card>
      </div>
      <RecentRequests rows={analytics?.recent || []} />
    </div>
  );
}

function RankedTable({ rows, model = false }: { rows: GroupRow[]; model?: boolean }) {
  if (!rows.length)
    return <p className="py-8 text-center text-sm text-text-muted">Sem execuções no período.</p>;
  return (
    <div className="divide-y divide-border">
      {rows.slice(0, 10).map((row, index) => (
        <div key={row.name} className="flex items-center gap-3 py-3">
          <span className="w-5 text-xs font-semibold text-text-muted">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-main">{row.name}</p>
            <p className="text-xs text-text-muted">
              {formatTokens(row.tokens)} tokens
              {model && row.avgLatencyMs ? ` · ${formatNumber(row.avgLatencyMs)} ms` : ""}
            </p>
          </div>
          <span className="text-sm font-semibold text-text-main">{formatNumber(row.count)}</span>
        </div>
      ))}
    </div>
  );
}

function AnomalyList({ anomalies }: { anomalies: Anomaly[] }) {
  if (!anomalies.length)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-emerald-600">
        <span className="material-symbols-outlined text-[19px]">check_circle</span>Nenhum alerta no
        período.
      </div>
    );
  return (
    <div className="space-y-2">
      {anomalies.map((item) => (
        <div
          key={item.code}
          className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${item.severity === "error" ? "border-red-500/20 bg-red-500/5 text-red-600" : item.severity === "warning" ? "border-amber-500/20 bg-amber-500/5 text-amber-700" : "border-cyan-500/20 bg-cyan-500/5 text-cyan-700"}`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {item.severity === "error" ? "error" : item.severity === "warning" ? "warning" : "info"}
          </span>
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}

function RecentRequests({ rows }: { rows: RecentRow[] }) {
  return (
    <Card
      title="Decisões recentes"
      subtitle="A decisão registrada pelo Obruxo antes da execução"
      icon="receipt_long"
    >
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-text-muted">
              <th className="px-2 py-2">Hora</th>
              <th className="px-2 py-2">Tipo</th>
              <th className="px-2 py-2">Nível</th>
              <th className="px-2 py-2">Combo</th>
              <th className="px-2 py-2">Modelo</th>
              <th className="px-2 py-2">Tokens</th>
              <th className="px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.slice(0, 15).map((row, index) => (
                <tr
                  key={`${row.timestamp}-${index}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-2 py-2.5 text-text-muted">{formatDate(row.timestamp)}</td>
                  <td className="px-2 py-2.5 font-medium text-text-main">{row.type}</td>
                  <td className="px-2 py-2.5">
                    <Badge
                      variant={
                        row.level === "max"
                          ? "warning"
                          : row.level === "xhigh"
                            ? "primary"
                            : "default"
                      }
                      size="sm"
                    >
                      {row.level.toUpperCase()}
                    </Badge>
                  </td>
                  <td
                    className="max-w-[180px] truncate px-2 py-2.5 text-text-muted"
                    title={row.combo || ""}
                  >
                    {row.combo || "-"}
                  </td>
                  <td
                    className="max-w-[230px] truncate px-2 py-2.5 text-text-main"
                    title={row.model || ""}
                  >
                    {row.model || "aguardando execução"}
                  </td>
                  <td className="px-2 py-2.5 text-text-muted">{formatTokens(row.inputTokens)}</td>
                  <td className="px-2 py-2.5">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-text-muted">
                  Nenhuma decisão registrada no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
