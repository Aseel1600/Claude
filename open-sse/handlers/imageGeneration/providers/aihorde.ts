import { saveCallLog } from "@/lib/usageDb";
import { sleep } from "../../../utils/sleep.ts";
import { sanitizeErrorMessage } from "../../../utils/error.ts";
import {
  AI_HORDE_ANONYMOUS_KEY,
  AI_HORDE_API_BASE,
  AI_HORDE_CLIENT_AGENT,
  aiHordeImageCatalog,
} from "../../../services/aihordeImageCatalog.ts";
import {
  extractHordeSourceB64,
  mapHordeGenerateRequest,
  stripHordeModelPrefix,
} from "./aihordeMapRequest.ts";

const GENERATE_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 1_000;

function hordeHeaders(apiKey: string): Record<string, string> {
  return {
    apikey: apiKey,
    "Client-Agent": AI_HORDE_CLIENT_AGENT,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function hordeMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapUpstreamStatus(status: number): number {
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 429 ||
    status === 503
  ) {
    return status;
  }
  return 502;
}

function resolveHordeApiKey(credentials: { apiKey?: unknown } | null | undefined): string {
  const raw = credentials?.apiKey;
  return typeof raw === "string" && raw.trim() ? raw.trim() : AI_HORDE_ANONYMOUS_KEY;
}

async function cancelHordeJob(jobId: string, apiKey: string): Promise<void> {
  try {
    await fetch(`${AI_HORDE_API_BASE}/v2/generate/status/${jobId}`, {
      method: "DELETE",
      headers: hordeHeaders(apiKey),
    });
  } catch {
    // Best-effort cancel after timeout or client disconnect.
  }
}

async function fetchHordeImageBytes(img: string): Promise<string> {
  const value = img.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const response = await fetch(value);
    if (!response.ok) {
      throw new Error(`Horde R2 download failed (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error("Horde R2 download returned an empty image");
    return buffer.toString("base64");
  }
  return value;
}

export async function handleAiHordeImageGeneration({
  model,
  provider,
  body,
  credentials,
  log,
  signal = null,
}: {
  model: string;
  provider: string;
  providerConfig?: { baseUrl?: string };
  body: Record<string, unknown>;
  credentials?: { apiKey?: unknown } | null;
  log?: {
    info: (scope: string, message: string) => void;
    error: (scope: string, message: string) => void;
  } | null;
  signal?: AbortSignal | null;
}) {
  const startTime = Date.now();
  const hordeModel = stripHordeModelPrefix(model);
  const prompt = typeof body.prompt === "string" ? body.prompt : String(body.prompt ?? "");
  const apiKey = resolveHordeApiKey(credentials);
  const logRequestBody = {
    model: hordeModel,
    prompt: prompt.slice(0, 200),
    size: body.size || "1024x1024",
    n: body.n || 1,
  };

  if (log) {
    log.info("IMAGE", `${provider}/${hordeModel} (aihorde) | prompt: "${prompt.slice(0, 60)}..."`);
  }

  try {
    await aiHordeImageCatalog.ensureFresh();
    if (aiHordeImageCatalog.hasSnapshot() && !aiHordeImageCatalog.isServed(hordeModel)) {
      const error = `No Horde workers are currently serving ${hordeModel}`;
      saveCallLog({
        method: "POST",
        path: "/v1/images/generations",
        status: 400,
        model: `${provider}/${hordeModel}`,
        provider,
        duration: Date.now() - startTime,
        error,
        requestBody: logRequestBody,
      }).catch(() => {});
      return { success: false, status: 400, error };
    }

    const sourceImage = extractHordeSourceB64(body);
    const payload = mapHordeGenerateRequest(body, { sourceImage });
    const submit = await fetch(`${AI_HORDE_API_BASE}/v2/generate/async`, {
      method: "POST",
      headers: hordeHeaders(apiKey),
      body: JSON.stringify(payload),
      signal: signal ?? undefined,
    });
    const submitBody = await safeJson(submit);
    if (submit.status !== 200 && submit.status !== 202) {
      const error = hordeMessage(submitBody, `Horde submit failed (${submit.status})`);
      saveCallLog({
        method: "POST",
        path: "/v1/images/generations",
        status: mapUpstreamStatus(submit.status),
        model: `${provider}/${hordeModel}`,
        provider,
        duration: Date.now() - startTime,
        error,
        requestBody: logRequestBody,
      }).catch(() => {});
      return { success: false, status: mapUpstreamStatus(submit.status), error };
    }
    const jobId =
      submitBody && typeof submitBody === "object" ? (submitBody as { id?: unknown }).id : null;
    if (typeof jobId !== "string" || !jobId) {
      return { success: false, status: 502, error: "Horde submit did not return a job id" };
    }

    const deadline = Date.now() + GENERATE_TIMEOUT_MS;
    let completed = false;
    try {
      while (true) {
        if (signal?.aborted) throw new Error("Horde image generation cancelled");
        if (Date.now() >= deadline) {
          throw Object.assign(new Error("Horde image generation timed out"), { status: 504 });
        }
        await sleep(POLL_INTERVAL_MS);
        const checkRes = await fetch(`${AI_HORDE_API_BASE}/v2/generate/check/${jobId}`, {
          headers: hordeHeaders(apiKey),
          signal: signal ?? undefined,
        });
        const check = await safeJson(checkRes);
        if (!checkRes.ok || !check || typeof check !== "object") {
          throw Object.assign(
            new Error(hordeMessage(check, `Horde check failed (${checkRes.status})`)),
            { status: mapUpstreamStatus(checkRes.status) }
          );
        }
        const checkObj = check as Record<string, unknown>;
        if (checkObj.faulted) throw new Error("Horde marked the job as faulted");
        if (checkObj.is_possible === false) {
          throw Object.assign(new Error("No Horde workers can currently fulfill this request"), {
            status: 503,
          });
        }
        if (!checkObj.done) continue;

        const statusRes = await fetch(`${AI_HORDE_API_BASE}/v2/generate/status/${jobId}`, {
          headers: hordeHeaders(apiKey),
          signal: signal ?? undefined,
        });
        const status = await safeJson(statusRes);
        if (!statusRes.ok || !status || typeof status !== "object") {
          throw Object.assign(
            new Error(hordeMessage(status, `Horde status failed (${statusRes.status})`)),
            { status: mapUpstreamStatus(statusRes.status) }
          );
        }
        const generations = (status as { generations?: unknown }).generations;
        if (!Array.isArray(generations) || generations.length === 0) {
          throw new Error("Horde status contained no generations");
        }
        const images: Array<{ b64_json: string; revised_prompt: string }> = [];
        for (const item of generations) {
          if (!item || typeof item !== "object") continue;
          const img = (item as { img?: unknown }).img;
          if (typeof img !== "string" || !img) continue;
          images.push({ b64_json: await fetchHordeImageBytes(img), revised_prompt: prompt });
        }
        if (images.length === 0) throw new Error("Horde status contained no image payloads");
        completed = true;
        saveCallLog({
          method: "POST",
          path: "/v1/images/generations",
          status: 200,
          model: `${provider}/${hordeModel}`,
          provider,
          duration: Date.now() - startTime,
          requestBody: logRequestBody,
          responseBody: { images_count: images.length },
        }).catch(() => {});
        return {
          success: true,
          data: { created: Math.floor(Date.now() / 1000), data: images },
        };
      }
    } finally {
      if (!completed) await cancelHordeJob(jobId, apiKey);
    }
  } catch (err) {
    const status =
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 502;
    const raw = err instanceof Error ? err.message : "Horde image generation failed";
    const error = sanitizeErrorMessage(raw);
    if (log) log.error("IMAGE", `aihorde error: ${String(error).slice(0, 200)}`);
    saveCallLog({
      method: "POST",
      path: "/v1/images/generations",
      status,
      model: `${provider}/${hordeModel}`,
      provider,
      duration: Date.now() - startTime,
      error: String(error).slice(0, 500),
      requestBody: logRequestBody,
    }).catch(() => {});
    return { success: false, status, error };
  }
}
