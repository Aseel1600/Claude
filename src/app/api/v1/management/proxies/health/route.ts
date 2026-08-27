
import { createErrorResponseFromUnknown } from "@/lib/api/errorResponse";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getProxyHealthStats } from "@/lib/db/proxies";

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const hours = Number(searchParams.get("hours") || 24);
    const items = await getProxyHealthStats({ hours });
    return Response.json({ items, total: items.length, windowHours: hours });
  } catch (error) {
    return createErrorResponseFromUnknown(error, "Failed to load proxy health stats");
  }
}
