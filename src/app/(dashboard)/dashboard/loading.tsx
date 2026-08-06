"use client";

/**
 * Dashboard route loading — covers all (dashboard)/dashboard/** routes.
 *
 * Next.js App Router routes the closest `loading.tsx` as the Suspense
 * fallback for that segment. By placing a single, generic skeleton here
 * we cover ~116 dashboard sub-routes with one file; pages that need a
 * domain-specific skeleton (analytics charts, settings forms, detail
 * layouts) override this with their own `loading.tsx` in that segment.
 *
 * Visual language: brand-tinted shimmer (see <Skeleton> in
 * shared/components/Loading.tsx) + burgundy + rose-gold from the
 * OmniRoute design system. Generic enough to feel right for any
 * dashboard page, distinctive enough to not look like a system default.
 */

import {
  CardGridSkeleton,
  FilterBarSkeleton,
  PageHeaderSkeleton,
} from "@/shared/components/SkeletonVariants";

export default function DashboardLoading() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading dashboard…</span>
      <PageHeaderSkeleton />
      <FilterBarSkeleton pills={4} />
      <CardGridSkeleton count={6} columns={3} />
    </div>
  );
}
