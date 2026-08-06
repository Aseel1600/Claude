"use client";

/**
 * SkeletonVariants — composable page-level loading placeholders.
 *
 * Each variant mimics the visual weight of a real page region so users see
 * "this page is loading, here is roughly what shape" instead of a blank
 * white screen. All variants use the brand-tinted <Skeleton> shimmer, so
 * the loading state stays visually consistent across the app.
 *
 * Combine variants in a route's `loading.tsx`:
 *   <PageHeaderSkeleton />
 *   <FilterBarSkeleton />
 *   <CardGridSkeleton count={6} />
 */

import { CardSkeleton, Skeleton } from "./Loading";

/* -------------------------------------------------------------------------- */
/*  Page header: title + subtitle + right-side action button(s)               */
/* -------------------------------------------------------------------------- */
export function PageHeaderSkeleton({ withActions = true }: { withActions?: boolean }) {
  return (
    <div
      className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
      role="presentation"
    >
      <div className="space-y-2">
        <Skeleton className="h-8 w-48 sm:w-64" />
        <Skeleton className="h-4 w-72 sm:w-96" />
      </div>
      {withActions && (
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Filter bar: search input + 3-4 filter pills                                */
/* -------------------------------------------------------------------------- */
export function FilterBarSkeleton({ pills = 4 }: { pills?: number }) {
  return (
    <div
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      role="presentation"
    >
      <Skeleton className="h-9 w-full sm:max-w-sm rounded-md" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: pills }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-7 rounded-full"
            style={{ width: `${64 + (i % 3) * 24}px` }}
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Card grid: N cards in 1-2-3 column responsive grid                        */
/* -------------------------------------------------------------------------- */
export function CardGridSkeleton({
  count = 8,
  columns = 3,
}: {
  count?: number;
  columns?: 1 | 2 | 3 | 4;
}) {
  const gridClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  }[columns];
  return (
    <div className={`grid ${gridClass} gap-4`} role="presentation">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stat cards row: 4 number cards (KPI strip)                                 */
/* -------------------------------------------------------------------------- */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      role="presentation"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-6 rounded-xl border border-border bg-surface space-y-3"
          aria-hidden="true"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="size-9 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Table: header + N rows                                                    */
/* -------------------------------------------------------------------------- */
export function TableSkeleton({
  rows = 8,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  // Vary column widths so the table doesn't look mechanical.
  const colWidths = Array.from({ length: cols }, (_, i) => {
    const patterns = ["w-32", "w-24", "w-40", "w-20", "w-28", "w-36", "w-16"];
    return patterns[i % patterns.length];
  });
  return (
    <div
      className="rounded-xl border border-border bg-surface overflow-hidden"
      role="presentation"
    >
      {/* Header row */}
      <div className="flex gap-4 p-4 border-b border-border bg-surface/60">
        {colWidths.map((w, i) => (
          <Skeleton key={`h-${i}`} className={`h-3 ${w}`} />
        ))}
      </div>
      {/* Body rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex gap-4 p-4 border-b border-border last:border-b-0"
          aria-hidden="true"
        >
          {colWidths.map((w, c) => (
            <Skeleton
              key={`r-${r}-c-${c}`}
              className={`h-4 ${w}`}
              style={{ width: c === 0 ? "100%" : undefined, maxWidth: "12rem" }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chart: large chart area with legend                                       */
/* -------------------------------------------------------------------------- */
export function ChartSkeleton({ withLegend = true }: { withLegend?: boolean }) {
  return (
    <div
      className="rounded-xl border border-border bg-surface p-6 space-y-4"
      role="presentation"
    >
      {withLegend && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <div className="flex gap-3">
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="h-3 w-12 rounded-full" />
          </div>
        </div>
      )}
      {/* Chart area with subtle vertical bars to suggest a chart shape */}
      <div className="h-64 flex items-end gap-2" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => {
          const heights = [40, 60, 35, 75, 50, 85, 45, 70, 55, 90, 65, 80];
          return (
            <Skeleton
              key={i}
              className="flex-1 rounded-t-md"
              style={{ height: `${heights[i % heights.length]}%` }}
            />
          );
        })}
      </div>
      {/* X-axis baseline */}
      <div className="flex justify-between">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-2 w-8" />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Detail layout: left sidebar + right content panels                        */
/* -------------------------------------------------------------------------- */
export function DetailLayoutSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6" role="presentation">
      {/* Left sidebar */}
      <aside className="space-y-2">
        <Skeleton className="h-10 w-full rounded-md" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-md" />
        ))}
      </aside>
      {/* Right content */}
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 space-y-3">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" style={{ maxWidth: `${100 - i * 8}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Settings form: rows of label + input, plus action buttons                  */
/* -------------------------------------------------------------------------- */
export function SettingsFormSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="rounded-xl border border-border bg-surface p-6 space-y-5"
      role="presentation"
    >
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-3 w-48" style={{ width: "70%" }} />
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Full dashboard layout: sidebar + header + content.                         */
/*                                                                             */
/*  Used by the root `app/loading.tsx` (which lives OUTSIDE the dashboard     */
/*  layout, so the real Sidebar/Header aren't mounted yet). Inside the         */
/*  dashboard, child routes use the lighter <DashboardLoading> above.          */
/* -------------------------------------------------------------------------- */
export function DashboardLayoutSkeleton() {
  return (
    <div
      className="flex h-dvh w-full overflow-hidden bg-bg"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>

      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-[220px] shrink-0 border-r border-border bg-surface flex-col p-4 gap-3">
        <Skeleton className="h-8 w-32 rounded-md" />
        <div className="mt-2 space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="size-5 rounded" />
              <Skeleton className="h-4 flex-1" style={{ maxWidth: `${75 - (i % 4) * 10}%` }} />
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 sm:px-8 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="lg:hidden size-9 rounded-md" />
            <Skeleton className="h-6 w-40" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md hidden sm:block" />
          </div>
        </header>
        {/* Content area — same shape as <DashboardLoading> */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-10">
          <div className="max-w-[3840px] mx-auto w-full h-full flex flex-col gap-6">
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-48" />
            </div>
            <CardGridSkeleton count={6} columns={3} />
          </div>
        </div>
      </div>
    </div>
  );
}
