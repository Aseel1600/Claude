import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getObruxoAnalytics } from "@/lib/obruxo/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json(await getObruxoAnalytics(searchParams), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[API ERROR] GET /api/obruxo/analytics:", error);
    return NextResponse.json({ error: "Failed to load Obruxo analytics" }, { status: 500 });
  }
}
