"use client";

/**
 * DistillationSettingsTab — choose the model used to distill L0 → L1.
 *
 * Effective values are resolved per the source-layer order:
 *   perKey → global → env → auto
 * Each layer may carry a JSON hint returned by the API, or an env value
 * surfaced via the fallback hint. PUT/DELETE support `self` or `global`
 * scope, and `global` is only offered when the management context flag
 * (canSetGlobal) is true.
 *
 * The status card surfaces running/recent-error states plus the DLQ list with
 * retry. Model picker dropdown calls /api/synced-available-models?provider=.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AppleButton,
  AppleCard,
  AppleField,
  AppleSelect,
  AppleStatusDot,
  AppleSurface,
} from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import {
  deleteJson,
  putJson,
  useDistillationModel,
  useProviderModels,
  type SourceLayer,
} from "../../hooks/useMemoryLayersApi";

const LAYER_LABEL_KEY: Record<SourceLayer, string> = {
  perKey: "sourceLayerPerKey",
  global: "sourceLayerGlobal",
  env: "sourceLayerEnv",
  auto: "sourceLayerAuto",
};

type Scope = "self" | "global";

export default function DistillationSettingsTab() {
  const t = useTranslations("memory");
  const tDist = useTranslations("memory.distillation");
  const tCommon = useTranslations("memory.common");
  const notify = useNotificationStore();
  const dist = useDistillationModel();
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [scope, setScope] = useState<Scope>("self");
  const [busy, setBusy] = useState<boolean>(false);
  const [dlq, setDlq] = useState<Array<{ id: string; error?: string; createdAt?: string }>>([]);
  const [status, setStatus] = useState<{
    running: boolean;
    lastError?: string | null;
  } | null>(null);

  const providerModels = useProviderModels(provider || null);

  const fallback = dist.data?.fallbackHint ?? null;

  useEffect(() => {
    const eff = dist.data?.effective;
    if (eff?.provider && !provider) setProvider(eff.provider);
    if (eff?.model && !model) setModel(eff.model);
  }, [dist.data?.effective, model, provider]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory/distillation-status", { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setStatus(data ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory/distillation-dlq", { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setDlq(Array.isArray((data as { items?: unknown[] })?.items) ? (data as { items: Array<{ id: string; error?: string; createdAt?: string }> }).items : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleApply = async () => {
    setBusy(true);
    const ok = await putJson("/api/memory/distillation-model", {
      scope,
      provider,
      model,
    });
    setBusy(false);
    if (ok == null) {
      notify.error(tDist("saveFailed"));
      return;
    }
    notify.success(tDist("saved"));
    dist.reload();
  };

  const handleRemove = async () => {
    setBusy(true);
    const ok = await deleteJson(
      `/api/memory/distillation-model?scope=${encodeURIComponent(scope)}`
    );
    setBusy(false);
    if (ok == null) {
      notify.error(tDist("removeFailed"));
      return;
    }
    notify.success(tDist("removed"));
    dist.reload();
  };

  const retryDlq = async (id: string) => {
    const ok = await putJson(`/api/memory/distillation-dlq/${encodeURIComponent(id)}/retry`, {});
    if (ok == null) {
      notify.error(tCommon("regenerateFailed"));
      return;
    }
    notify.success(tDist("dlqRetry"));
    setDlq((prev) => prev.filter((row) => row.id !== id));
  };

  const effectiveBadge = useMemo(() => {
    if (!dist.data) return "—";
    const layerKey = LAYER_LABEL_KEY[dist.data.source];
    return tDist(layerKey);
  }, [dist.data, tDist]);

  return (
    <div className="space-y-6">
      <AppleSurface className="p-4 sm:p-5">
        <h2 className="text-base font-semibold text-text-main">{tDist("title")}</h2>
        <p className="text-xs text-text-muted mt-1 max-w-xl">{tDist("description")}</p>
      </AppleSurface>

      {/* Effective resolution */}
      <AppleCard data-testid="distillation-effective" className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5">
            <p className="text-xs text-text-muted">{tDist("effective")}</p>
            <p
              className="text-base font-medium text-text-main"
              data-testid="distillation-effective-value"
            >
              {dist.data?.effective.provider && dist.data?.effective.model
                ? `${dist.data.effective.provider} / ${dist.data.effective.model}`
                : (fallback?.provider && fallback?.model
                  ? `${fallback.provider} / ${fallback.model}`
                  : tDist("fallbackHint", { value: process.env.NEXT_PUBLIC_DISTILLATION_MODEL ?? "—" }))}
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-full bg-primary/15 text-primary"
            data-testid="distillation-source-layer"
            data-source-layer={dist.data?.source ?? "auto"}
          >
            {tDist("sourceLayer")}: {effectiveBadge}
          </span>
        </div>
        {fallback && (
          <p className="text-xs text-text-muted" data-testid="distillation-fallback">
            {tDist("fallbackHint", {
              value: `${fallback.provider ?? "?"} / ${fallback.model ?? "?"}`,
            })}
          </p>
        )}
      </AppleCard>

      {/* Override */}
      <AppleCard data-testid="distillation-override" className="space-y-3">
        <div>
          <p className="text-sm font-medium text-text-main">{tDist("override")}</p>
          <p className="text-xs text-text-muted">{tDist("overrideDesc")}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <AppleField id="dist-scope" label={tDist("scope")}>
            <AppleSelect
              id="dist-scope"
              data-testid="distillation-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
            >
              <option value="self">{tDist("scopeSelf")}</option>
              <option value="global" disabled={!dist.canSetGlobal}>
                {tDist("scopeGlobal")}
              </option>
            </AppleSelect>
          </AppleField>
          <AppleField id="dist-provider" label={tDist("provider")}>
            <AppleSelect
              id="dist-provider"
              data-testid="distillation-provider"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel("");
              }}
            >
              <option value="">{tDist("selectProvider")}</option>
              {(dist.data?.canSetGlobal && scope === "global"
                ? ["openai", "anthropic", "google"]
                : ["openai", "anthropic", "google", "auto"]
              ).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </AppleSelect>
          </AppleField>
          <AppleField id="dist-model" label={tDist("model")}>
            <AppleSelect
              id="dist-model"
              data-testid="distillation-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!provider || providerModels.isLoading}
            >
              <option value="">{tDist("selectModel")}</option>
              {(providerModels.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.id}
                </option>
              ))}
            </AppleSelect>
            {providerModels.error && (
              <p className="text-[11px] text-red-500 mt-1">{tDist("loadModelsFailed")}</p>
            )}
            {providerModels.isLoading && (
              <p className="text-[11px] text-text-muted mt-1">{tCommon("loading")}</p>
            )}
            {!providerModels.isLoading &&
              !providerModels.error &&
              (providerModels.data?.length ?? 0) === 0 &&
              provider && (
              <p className="text-[11px] text-text-muted mt-1">{tDist("noModels")}</p>
            )}
          </AppleField>
        </div>
        {!dist.canSetGlobal && scope === "global" && (
          <p className="text-xs text-amber-500" data-testid="distillation-global-unavailable">
            {tDist("globalUnavailable")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <AppleButton
            variant="primary"
            loading={busy}
            disabled={!provider || !model}
            onClick={handleApply}
            data-testid="distillation-apply"
          >
            {tDist("apply")}
          </AppleButton>
          <AppleButton
            variant="tertiary"
            loading={busy}
            onClick={handleRemove}
            data-testid="distillation-remove"
          >
            {tDist("remove")}
          </AppleButton>
        </div>
      </AppleCard>

      {/* Status + DLQ */}
      <AppleCard data-testid="distillation-status" className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <AppleStatusDot variant={status?.running ? "success" : "muted"} />
            <span className="text-sm font-medium text-text-main">
              {status?.running ? tDist("running") : tDist("stopped")}
            </span>
          </div>
          {status?.lastError && (
            <p
              className="text-xs text-red-500"
              data-testid="distillation-recent-error"
            >
              {tDist("recentError")}: {status.lastError}
            </p>
          )}
          {!status?.lastError && (
            <p className="text-xs text-text-muted">{tDist("noRecentError")}</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-text-muted">{tDist("dlqTitle")}</p>
          {dlq.length === 0 ? (
            <p className="text-xs text-text-muted" data-testid="distillation-dlq-empty">
              {tDist("dlqEmpty")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {dlq.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface/40 px-3 py-2"
                  data-testid={`distillation-dlq-${row.id}`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs font-mono text-text-muted truncate">{row.id}</p>
                    {row.error && <p className="text-[11px] text-red-500 truncate">{row.error}</p>}
                  </div>
                  <AppleButton
                    size="sm"
                    variant="tertiary"
                    onClick={() => retryDlq(row.id)}
                    data-testid={`distillation-dlq-retry-${row.id}`}
                  >
                    {tDist("dlqRetry")}
                  </AppleButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AppleCard>
    </div>
  );
}