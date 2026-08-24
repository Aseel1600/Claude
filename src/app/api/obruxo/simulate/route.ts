import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getSettings } from "@/lib/localDb";
import {
  normalizeBruxoRoutingConfig,
  resolveBruxoRoute,
} from "@omniroute/open-sse/services/bruxoMasterRouter.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
  const requestBody =
    input.body && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : {
          model: typeof input.model === "string" ? input.model : "obruxo",
          messages: [
            {
              role: "user",
              content: typeof input.text === "string" ? input.text : "",
            },
          ],
        };
  const model =
    typeof input.model === "string" ? input.model : String(requestBody.model ?? "obruxo");
  const headers =
    input.headers && typeof input.headers === "object"
      ? (input.headers as Record<string, string>)
      : undefined;
  const settings = await getSettings();
  const config = normalizeBruxoRoutingConfig(settings.bruxoRouting);
  const decision = resolveBruxoRoute(model, requestBody, config, headers);

  return NextResponse.json({
    model,
    decision,
    generatedAt: new Date().toISOString(),
  });
}
