"use client";

/**
 * /dashboard/memory — four-layer memory management + distillation settings.
 *
 * Tabs are URL-driven (`?tab=l0|l1|l2|l3|settings`) so reload/share preserves
 * the active surface, plus a `lineage` query that scopes the table to a list
 * of ids when arriving from a cross-layer link. The clear-filter × chip
 * removes `lineage` from the URL.
 */

import { Suspense, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppleButton, AppleSurface } from "@/shared/components";
import MemoryConceptCard from "./components/MemoryConceptCard";
import L0Tab from "./components/layers/L0Tab";
import L1Tab from "./components/layers/L1Tab";
import L2Tab from "./components/layers/L2Tab";
import L3Tab from "./components/layers/L3Tab";
import DistillationSettingsTab from "./components/layers/DistillationSettingsTab";

const TAB_IDS = ["l0", "l1", "l2", "l3", "settings"] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABEL_KEY: Record<TabId, string> = {
  l0: "tabs.l0",
  l1: "tabs.l1",
  l2: "tabs.l2",
  l3: "tabs.l3",
  settings: "tabs.settings",
};

function parseLineageFilter(raw: string | null): string[] | null {
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

function MemoryPageContent() {
  const t = useTranslations("memory");
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get("tab") ?? "";
  const activeTab: TabId = (TAB_IDS as readonly string[]).includes(rawTab)
    ? (rawTab as TabId)
    : "l0";
  const lineage = useMemo(
    () => parseLineageFilter(searchParams.get("lineage")),
    [searchParams]
  );

  const setTab = useCallback(
    (tab: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      // Lineage only applies to the L0/L1/L2 surfaces; clear it on switching
      // to L3 or settings so the chip does not leak across tabs.
      if (tab !== "l0" && tab !== "l1" && tab !== "l2") {
        params.delete("lineage");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const clearLineage = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lineage");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  return (
    <div className="space-y-6">
      <MemoryConceptCard />

      <AppleSurface className="p-1.5 w-fit" role="tablist" aria-label={t("tabs.tablist")}>
        <div className="flex gap-1 flex-wrap">
          {TAB_IDS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              data-testid={`tab-${tab}`}
              onClick={() => setTab(tab)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                activeTab === tab
                ? "bg-primary text-white shadow-sm"
                : "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {t(TAB_LABEL_KEY[tab])}
            </button>
          ))}
        </div>
      </AppleSurface>

      {lineage && (activeTab === "l0" || activeTab === "l1" || activeTab === "l2") && (
        <AppleSurface
          className="p-3 flex items-center justify-between gap-3"
          data-testid="lineage-chip"
        >
          <span className="text-xs text-text-muted truncate">
            {t("common.lineage")}: {lineage.join(", ")}
          </span>
          <AppleButton
            size="sm"
            variant="tertiary"
            onClick={clearLineage}
            data-testid="clear-lineage"
          >
            {t("clearFilters")}
          </AppleButton>
        </AppleSurface>
      )}

      <div role="tabpanel" data-testid={`tabpanel-${activeTab}`}>
        {activeTab === "l0" && <L0Tab initialSessionId={lineage?.[0] ?? null} />}
        {activeTab === "l1" && <L1Tab lineageFilter={lineage} onClearLineage={clearLineage} />}
        {activeTab === "l2" && <L2Tab />}
        {activeTab === "l3" && <L3Tab />}
        {activeTab === "settings" && <DistillationSettingsTab />}
      </div>
    </div>
  );
}

export default function MemoryPage() {
  return (
    <Suspense fallback={<div className="h-64 flex items-center justify-center" />}>
      <MemoryPageContent />
    </Suspense>
  );
}