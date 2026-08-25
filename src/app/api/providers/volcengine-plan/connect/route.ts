import { NextResponse } from "next/server";
import { z } from "zod";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { bindVolcenginePlansFromConsoleCredentials } from "@/lib/providers/volcenginePlanBinding";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";

// All fields optional: a bare POST (no body) legitimately triggers the manual
// headful login flow, so an empty object must validate. Zod still rejects
// wrong-typed fields (e.g. a non-string phone) per Hard Rule #7 / t06 gate.
const connectBodySchema = z.object({
  timeout: z.number().optional(),
  phone: z.string().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireManagementAuth(request);
  if (auth) return auth;

  const rawBody = await request.json().catch(() => ({}));
  const validation = validateBody(connectBodySchema, rawBody);
  if (isValidationFailure(validation)) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const body = validation.data;
  const timeout = body.timeout;

  // Auto flow: phone present → start a session-based headless phone/SMS login.
  if (typeof body.phone === "string" && body.phone.trim()) {
    try {
      const { volcengineConsoleAutoLoginService } =
        await import("@omniroute/open-sse/services/volcengineConsoleAutoLogin.ts");
      const started = await volcengineConsoleAutoLoginService.startLogin(body.phone, { timeout });
      if (!started.ok) {
        return NextResponse.json({ success: false, error: started.error }, { status: 400 });
      }
      return NextResponse.json({ success: true, session: started.session });
    } catch (error) {
      const message = sanitizeErrorMessage(error instanceof Error ? error.message : error);
      return NextResponse.json(
        { success: false, error: `Volcano auto login failed to start: ${message}` },
        { status: 500 }
      );
    }
  }

  // Legacy manual flow: headful browser login on the server machine.
  try {
    const { inAppLoginService } = await import("@omniroute/open-sse/services/inAppLoginService.ts");
    const login = await inAppLoginService.startLogin("volcengine-console", { timeout });
    if (!login.success || !login.credentials) {
      return NextResponse.json(
        { success: false, error: login.error || "Volcano console login failed" },
        { status: 400 }
      );
    }

    const binding = await bindVolcenginePlansFromConsoleCredentials(login.credentials);
    return NextResponse.json({ success: true, binding });
  } catch (error) {
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, error: `Volcano account binding failed: ${message}` },
      { status: 500 }
    );
  }
}
