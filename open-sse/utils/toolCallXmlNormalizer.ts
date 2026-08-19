/**
 * Defensive normalizer for XML-encoded tool-call arguments on the OpenAI-format
 * passthrough response path.
 *
 * Background (probed 2026-08-19): some OpenAI-compatible upstream gateways
 * (e.g. nous-research → Tencent hy3) emit `tool_calls[].function.arguments` as
 * an XML wrapper instead of JSON whenever a tool call is forced via
 * `tool_choice` (named or `required`):
 *
 *   <tool_calls:6124c78e>
 *   <tool_call:6124c78e>health_check<tool_sep:6124c78e>
 *   <arg_key:6124c78e>status</arg_key:6124c78e>
 *   <arg_value:6124c78e>ok</arg_value:6124c78e>
 *   </tool_call:6124c78e>
 *   </tool_calls:6124c78e>
 *
 * Clients that JSON.parse `function.arguments` break on this. This normalizer
 * converts the wrapper to a JSON object string, keyed by the `arg_key` values in
 * document order. It is intentionally provider-agnostic and only activates on
 * the exact wrapper pattern; valid JSON, plain text, and unrelated XML pass
 * through untouched (returns null → caller leaves the string as-is).
 *
 * The tag constant (`6124c78e`) varies per upstream — the regex captures it
 * rather than hard-coding it.
 */

const XML_ESCAPE_RE = /&(amp|lt|gt|quot|apos|#\d+);/g;

const TOOL_CALLS_OPEN = "<tool_calls:";
const TOOL_CALL_OPEN = "<tool_call:";
const TOOL_SEP = "<tool_sep:";
const ARG_KEY_OPEN = "<arg_key:";
const ARG_VALUE_OPEN = "<arg_value:";

function decodeXmlEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(XML_ESCAPE_RE, (m) => {
    switch (m) {
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      default: {
        const num = /#(\d+);/.exec(m);
        if (num) {
          const code = Number(num[1]);
          return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : m;
        }
        return m;
      }
    }
  });
}

/**
 * Normalize an XML tool-call wrapper into a JSON object string, or return null
 * when the input is already valid JSON / does not match the wrapper pattern.
 */
export function normalizeXmlToolCallArgs(args: unknown): string | null {
  if (typeof args !== "string") return null;
  const trimmed = args.trim();
  if (!trimmed) return null;

  // Already-valid JSON → leave untouched.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return null;
    } catch {
      // fall through — maybe it is XML despite the leading brace
    }
  }

  // Must contain a <tool_calls:...> wrapper (tolerant of the hex tag constant).
  // The wrapper may be preceded by a model preamble emitted inside `arguments`
  // (observed with tencent/hy3:free streaming), so search for the marker rather
  // than anchoring at the string start.
  const wrapperStart = trimmed.indexOf(TOOL_CALLS_OPEN);
  if (wrapperStart < 0) return null;
  const wrapperPart = trimmed.slice(wrapperStart);
  const tag = /^<tool_calls:([0-9a-fA-F]{1,64})>/.exec(wrapperPart)?.[1];
  if (!tag) return null;

  // Extract the tool name + the args block.
  const bodyRe = new RegExp(
    `^<tool_calls:${tag}>\\s*<tool_call:${tag}>([\\s\\S]*?)<tool_sep:${tag}>\\s*([\\s\\S]*?)</tool_call:${tag}>\\s*</tool_calls:${tag}>\\s*`
  );
  const bodyMatch = bodyRe.exec(wrapperPart);
  if (!bodyMatch) return null;
  const toolName = decodeXmlEntities(bodyMatch[1].trim());
  if (!toolName) return null;

  // Parse repeated arg_key/arg_value pairs.
  const pairs: string[] = [];
  const pairRe = new RegExp(
    `<arg_key:${tag}>([\\s\\S]*?)</arg_key:${tag}>\\s*<arg_value:${tag}>([\\s\\S]*?)</arg_value:${tag}>`,
    "g"
  );
  let pairMatch: RegExpExecArray | null;
  while ((pairMatch = pairRe.exec(bodyMatch[2])) !== null) {
    const key = decodeXmlEntities(pairMatch[1].trim());
    const value = decodeXmlEntities(pairMatch[2].trim());
    if (!key) continue;
    pairs.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  }

  if (pairs.length === 0) return null;

  return `{${pairs.join(",")}}`;
}

/**
 * Normalize XML-encoded tool-call arguments in a full OpenAI-format response
 * body (non-streaming). Mutates the body in place: for every
 * `choices[].message.tool_calls[].function.arguments` that matches the XML
 * wrapper pattern, the string is replaced with the JSON-object equivalent.
 * Bodies without the pattern are left untouched (returns false).
 */
export function normalizeOpenAIBodyToolCallArgs(body: unknown): {
  changed: boolean;
  body: unknown;
} {
  const responseBody = body as {
    choices?: Array<{
      message?: { tool_calls?: Array<{ function?: { arguments?: unknown } }> };
    }>;
  } | null;
  if (!responseBody || !Array.isArray(responseBody.choices)) {
    return { changed: false, body };
  }

  let changed = false;
  for (const choice of responseBody.choices) {
    const toolCalls = choice?.message?.tool_calls;
    if (!Array.isArray(toolCalls)) continue;
    for (const toolCall of toolCalls) {
      const args = toolCall?.function?.arguments;
      const normalized = normalizeXmlToolCallArgs(args);
      if (normalized !== null && toolCall.function) {
        toolCall.function.arguments = normalized;
        changed = true;
      }
    }
  }
  return { changed, body };
}
