import { FORMATS } from "../../translator/formats.ts";

type Tool = Record<string, unknown>;

export function normalizeOpenAICompatibleTools(
  tools: Tool[],
  sourceFormat: string
): { tools: Tool[]; dropped: number } {
  const before = tools.length;
  const normalized = tools
    .filter((tool) =>
      !tool.type || tool.type === "function" || !!tool.function || !!tool.name
    )
    .map((tool) => {
      // Responses custom tools carry free-form input. Preserve their native shape so
      // the Responses translator can produce the required { input: string } schema.
      if (
        !tool.type ||
        tool.type === "function" ||
        tool.function ||
        (sourceFormat === FORMATS.OPENAI_RESPONSES && tool.type === "custom")
      ) {
        return tool;
      }

      return {
        type: "function",
        function: {
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          ...(tool.parameters !== undefined || tool.input_schema !== undefined
            ? { parameters: tool.parameters ?? tool.input_schema ?? {} }
            : {}),
          ...(tool.strict === undefined ? {} : { strict: tool.strict }),
        },
      };
    });

  return { tools: normalized, dropped: before - normalized.length };
}
