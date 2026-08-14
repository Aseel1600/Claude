import { CORS_HEADERS } from "../utils/cors.ts";
/**
 * OCR Handler
 *
 * Handles POST /v1/ocr (Mistral OCR API format).
 */

import {
  getOcrProvider,
  getOcrTransformation,
  parseOcrModel,
  OCR_PROVIDERS,
} from "../config/ocrRegistry.ts";
import { errorResponse } from "../utils/error.ts";
import { attachOmniRouteMetaHeaders } from "@/domain/omnirouteResponseMeta";
import { generateRequestId } from "@/shared/utils/requestId";

const OCR_POLL_MAX_ATTEMPTS = 30;
const OCR_POLL_INTERVAL_MS = 1000;

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Handle OCR request
 *
 * Dispatches to the per-provider transformation (see `open-sse/config/ocrRegistry.ts`)
 * to build the upstream request, then (for async providers like Azure Document
 * Intelligence) polls the returned operation URL until it succeeds or fails,
 * before normalizing the response into the Mistral OCR shape.
 *
 * @param {Object} options
 * @param {Object} options.body - JSON body { model, document }
 * @param {Object} options.credentials - Provider credentials { apiKey, accessToken, baseUrl }
 * @param {Function} [options.fetchImpl] - DI hook for tests; defaults to global fetch
 * @param {Function} [options.sleepImpl] - DI hook for tests; defaults to a real setTimeout-based sleep
 * @returns {Response}
 */
/** @returns {Promise<unknown>} */
export async function handleOcr({
  body,
  credentials,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
}) {
  const startTime = Date.now();
  if (!body.document) {
    return errorResponse(400, "document is required");
  }

  // Default to latest OCR model
  const model = body.model || "mistral-ocr-latest";
  const { provider: providerId, model: modelId } = parseOcrModel(model);
  const providerConfig = providerId ? getOcrProvider(providerId) : null;

  if (!providerConfig) {
    return errorResponse(
      400,
      `No OCR provider found for model "${model}". Available: ${Object.keys(OCR_PROVIDERS).join(", ")}`
    );
  }

  const token = credentials?.apiKey || credentials?.accessToken;
  if (!token) {
    return errorResponse(401, `No credentials for OCR provider: ${providerId}`);
  }

  const baseUrl = credentials?.baseUrl || providerConfig.baseUrl;
  if (!baseUrl) {
    return errorResponse(400, `No base URL configured for OCR provider: ${providerId}`);
  }

  try {
    const transformation = getOcrTransformation(providerId);
    const { url, init } = transformation.buildRequest({ baseUrl, token, body, modelId });
    const res = await fetchImpl(url, init);

    if (!res.ok) {
      const errText = await res.text();
      return new Response(errText, {
        status: res.status,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    const pollUrl = transformation.pollUrl?.(res) ?? null;
    let data: unknown;
    if (pollUrl) {
      const authHeader = buildAuthHeader(providerConfig.authHeader, token);
      data = await pollOcrOperation({ pollUrl, authHeader, fetchImpl, sleepImpl });
      if (data instanceof Response) return data;
    } else {
      data = await res.json();
    }

    const parsed = transformation.parseResponse(data);
    const headers = new Headers({ ...CORS_HEADERS, "Content-Type": "application/json" });
    attachOmniRouteMetaHeaders(headers, {
      provider: providerId,
      model: modelId,
      costUsd: 0,
      latencyMs: Date.now() - startTime,
      requestId: generateRequestId(),
    });
    return new Response(JSON.stringify(parsed), { status: 200, headers });
  } catch (err) {
    console.error("[OCR]", err);
    return errorResponse(500, "OCR request failed");
  }
}

/**
 * Build the same auth header used for the initial upstream request, so the
 * poll GET (e.g. Azure Document Intelligence's Operation-Location) authenticates
 * identically.
 */
function buildAuthHeader(authHeader: string, token: string): Record<string, string> {
  if (authHeader === "bearer") {
    return { Authorization: `Bearer ${token}` };
  }
  return { [authHeader]: token };
}

/**
 * Poll an async OCR operation (Azure Document Intelligence) until it succeeds or fails.
 *
 * @returns {Promise<unknown|Response>} the parsed JSON body on success, or an error Response
 */
async function pollOcrOperation({ pollUrl, authHeader, fetchImpl, sleepImpl }) {
  for (let attempt = 0; attempt < OCR_POLL_MAX_ATTEMPTS; attempt++) {
    await sleepImpl(OCR_POLL_INTERVAL_MS);
    const pollRes = await fetchImpl(pollUrl, {
      method: "GET",
      headers: authHeader,
    });
    if (!pollRes.ok) {
      console.error("[OCR] poll error", pollRes.status);
      return errorResponse(502, "OCR analysis failed");
    }
    const json = await pollRes.json();
    if (json.status === "succeeded") {
      return json;
    }
    if (json.status === "failed") {
      return errorResponse(502, "OCR analysis failed");
    }
  }
  return errorResponse(504, "OCR analysis timed out");
}
