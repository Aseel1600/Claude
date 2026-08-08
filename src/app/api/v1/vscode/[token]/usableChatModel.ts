// Shared "is this catalog model usable as a VS Code chat model" filter.
//
// Historically this predicate was copy-pasted independently into every VS
// Code listing route (models, api/tags, api/show — both the token-prefixed
// and `raw` token variants). PR #7012 widened only the `models/route.ts`
// copy to accept Responses-API-format models (api_format "responses" /
// "openai-responses", or supported_endpoints containing "responses")
// alongside plain "chat-completions" models — the other 4 copies were left
// on the old, stricter filter, silently hiding OpenAI/Codex "responses"
// models from every Ollama-compatible listing endpoint (#7587).
//
// Centralizing the predicate here means a future widening only has to
// happen once.
//
// Two predicates live here, and the difference is combos:
//
//   isUsableChatModel        — rejects combos. Used by the Ollama-compatible
//                              listings (api/tags, api/show, and their `raw`
//                              variants), which answer model-name lookups; a
//                              combo has no single model behind it to resolve.
//   isUsableVscodeCatalogModel — admits combos. Used by the VS Code chat
//                              catalog (`models/route.ts`), which the editor
//                              extension syncs. A combo id accepts a chat
//                              completion exactly like a model id, and hiding
//                              it made a routing strategy the operator had
//                              already configured unreachable from the editor.
//
// The divergence is deliberate and covered by tests on both sides.

export type UsableChatModelCandidate = {
	owned_by?: string;
	parent?: string | null;
	type?: string;
	api_format?: string;
	supported_endpoints?: string[];
	output_modalities?: string[];
};

/**
 * A combo entry as the unified catalog emits it (`owned_by: "combo"`).
 *
 * Combos have no provider connection behind them, so any gate built from the
 * active connection list has to special-case them explicitly.
 */
export function isComboCatalogModel(model: UsableChatModelCandidate) {
	return typeof model.owned_by === "string" && model.owned_by.trim().toLowerCase() === "combo";
}

export const TEXT_GENERATION_API_FORMATS = new Set([
	"chat-completions",
	"responses",
	"openai-responses",
]);

function excludesChatAndResponsesEndpoints(model: UsableChatModelCandidate) {
	return (
		Array.isArray(model.supported_endpoints) &&
		model.supported_endpoints.length > 0 &&
		!model.supported_endpoints.includes("chat") &&
		!model.supported_endpoints.includes("responses")
	);
}

function excludesTextOutputModality(model: UsableChatModelCandidate) {
	return (
		Array.isArray(model.output_modalities) &&
		model.output_modalities.length > 0 &&
		!model.output_modalities.includes("text")
	);
}

export function isUsableChatModel(model: UsableChatModelCandidate) {
	if (isComboCatalogModel(model)) return false;
	if (typeof model.parent === "string" && model.parent.length > 0) return false;
	if (typeof model.type === "string" && model.type !== "chat") return false;
	if (
		typeof model.api_format === "string" &&
		!TEXT_GENERATION_API_FORMATS.has(model.api_format)
	) {
		return false;
	}
	if (excludesChatAndResponsesEndpoints(model)) return false;
	if (excludesTextOutputModality(model)) return false;

	return true;
}

/**
 * The VS Code chat catalog predicate — `isUsableChatModel` plus combos.
 *
 * Being a combo stops being an automatic rejection, but it is not a free pass:
 * the capability checks still apply, so a combo whose targets cannot emit text
 * stays out of a chat catalog just like a model that cannot.
 */
export function isUsableVscodeCatalogModel(model: UsableChatModelCandidate) {
	if (!isComboCatalogModel(model)) return isUsableChatModel(model);
	return isUsableChatModel({ ...model, owned_by: undefined });
}
