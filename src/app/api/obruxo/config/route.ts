import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getCombos, getSettingsRevision, updateSettings } from "@/lib/localDb";
import { logAuditEvent } from "@/lib/compliance";
import { normalizeBruxoRoutingConfig } from "@omniroute/open-sse/services/bruxoMasterRouter.ts";
import { getObruxoConfigPayload, validateObruxoConfigReferences } from "@/lib/obruxo/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    return NextResponse.json(await getObruxoConfigPayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[API ERROR] GET /api/obruxo/config:", error);
    return NextResponse.json({ error: "Failed to load Obruxo configuration" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
  const candidate = body.config ?? body;
  const config = normalizeBruxoRoutingConfig(candidate);
  if (!config) {
    return NextResponse.json(
      { error: "Invalid Obruxo configuration: enabled, routes or entryRoutes are required" },
      { status: 400 }
    );
  }

  const combos = await getCombos();
  const comboNames = new Set(
    combos.map((combo) => (typeof combo.name === "string" ? combo.name.trim() : "")).filter(Boolean)
  );
  const invalidReferences = validateObruxoConfigReferences(config, comboNames);
  if (invalidReferences.length > 0) {
    return NextResponse.json(
      { error: "Configuration references unknown combos", invalidReferences },
      { status: 400 }
    );
  }

  const expectedRevision =
    typeof body.expectedRevision === "number" && Number.isInteger(body.expectedRevision)
      ? body.expectedRevision
      : undefined;

  try {
    await updateSettings({ bruxoRouting: config }, { expectedRevision });
    const revision = await getSettingsRevision();
    logAuditEvent({
      action: "obruxo.config.update",
      actor: "dashboard",
      target: "bruxoRouting",
      resourceType: "obruxo",
      status: "success",
      details: {
        revision,
        entryModels: config.entryModels ?? [],
        levelFloors: config.levelFloors ?? {},
      },
    });
    return NextResponse.json(await getObruxoConfigPayload(), {
      headers: { "Cache-Control": "no-store", ETag: String(revision) },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "SettingsRevisionConflictError") {
      return NextResponse.json(
        {
          error: "Configuration changed in another session",
          code: "SETTINGS_REVISION_CONFLICT",
          currentRevision: await getSettingsRevision(),
        },
        { status: 409 }
      );
    }
    console.error("[API ERROR] PUT /api/obruxo/config:", error);
    return NextResponse.json({ error: "Failed to save Obruxo configuration" }, { status: 500 });
  }
}
