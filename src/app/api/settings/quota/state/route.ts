/**
 * /api/settings/quota/state — Dashboard visibility endpoint for provider quota states.
 *
 * GET: Returns live quota states, reset timers, and aggregated usage analytics.
 * POST: Resets expired quota windows or purges a specific connection quota record.
 *
 * Part of: Quota-aware provider scheduling (Phase 2).
 */

import { NextResponse } from "next/server";
import { CORS_HEADERS, handleCorsOptions } from "@/shared/utils/cors";
import { getQuotaAnalyticsSummary } from "@/lib/quota/quotaAnalytics";
import { getActiveQuotaResetItems, resetExpiredQuotaWindows } from "@/lib/quota/quotaResetTimers";
import { getProviderQuota, clearProviderQuotaState } from "@/lib/quota/providerQuotaState";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function GET() {
  try {
    const analytics = getQuotaAnalyticsSummary();
    const resetTimers = getActiveQuotaResetItems();

    return NextResponse.json(
      {
        success: true,
        analytics,
        resetTimers,
        timestamp: new Date().toISOString(),
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, connectionId, model } = body as {
      action?: string;
      connectionId?: string;
      model?: string;
    };

    if (action === "reset_expired") {
      const resetCount = resetExpiredQuotaWindows();
      return NextResponse.json(
        { success: true, resetCount, message: `Reset ${resetCount} expired quota windows.` },
        { headers: CORS_HEADERS }
      );
    }

    if (action === "clear_connection" && connectionId && model) {
      clearProviderQuotaState(connectionId, model);
      return NextResponse.json(
        { success: true, message: `Cleared quota state for connection ${connectionId} (${model}).` },
        { headers: CORS_HEADERS }
      );
    }

    return NextResponse.json(
      { success: false, error: "Invalid action or missing parameters" },
      { status: 400, headers: CORS_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
