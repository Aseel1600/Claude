"use client";

/**
 * Root route loading — used when navigating to routes that don't have a more
 * specific `loading.tsx` (e.g. /login, /landing, /forgot-password, error
 * pages, etc.). Shows a full dashboard layout skeleton (sidebar + header +
 * content placeholders) so the page never appears blank while the segment
 * is being prepared.
 *
 * Dashboard child routes use the lighter <DashboardLoading> in
 * (dashboard)/dashboard/loading.tsx — Next.js App Router routes the
 * closest loading.tsx to the navigating segment, so dashboard pages
 * skip this full-layout shell.
 */

import { DashboardLayoutSkeleton } from "@/shared/components/SkeletonVariants";

export default function AppLoading() {
  return <DashboardLayoutSkeleton />;
}
