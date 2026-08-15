import { NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { probeVideoRuntime } from "@/lib/guardrails/videoBridgeRuntime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  const status = await probeVideoRuntime();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
