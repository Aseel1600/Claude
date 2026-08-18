function getHeaderValue(
  headers: Record<string, unknown> | Headers | null | undefined,
  name: string
) {
  if (!headers || typeof headers !== "object") return "";
  const lowerName = name.toLowerCase();

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? "";
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    return Array.isArray(value) ? value.join(",") : String(value ?? "");
  }
  return "";
}

export function isAgentBridgeInternalRequest(
  headers: Headers | Record<string, unknown> | null | undefined
): boolean {
  return getHeaderValue(headers, "x-omniroute-source").toLowerCase() === "agent-bridge";
}
