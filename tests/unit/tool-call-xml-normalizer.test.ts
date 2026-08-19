/**
 * Regression test for the tencent/hy3:free XML-encoded tool-call arguments
 * (probed 2026-08-19 against prod funnel `squrvq.tail0bec0f.ts.net`):
 *
 * The upstream OpenAI-compatible gateway (nous-research → Tencent hy3) emits
 * `tool_calls[].function.arguments` as an XML wrapper instead of JSON whenever
 * a tool call is forced via `tool_choice` (named or `required`). Verified
 * deterministic: XML 5/5 with forced tool_choice, clean JSON 10/10 with
 * `tool_choice: "auto"`. Raw XML echoed in the continuation turn returns 400
 * from upstream; JSON-normalized arguments return 200/200.
 *
 * Before the fix, `translateResponse()` returned the chunk as-is for the
 * OpenAI→OpenAI passthrough (`open-sse/translator/index.ts:716-722`), so the
 * raw XML string flowed verbatim to clients in both non-streaming JSON and
 * streaming SSE, breaking any client that JSON.parses `function.arguments`.
 *
 * The fix: `normalizeXmlToolCallArgs()` detects the XML wrapper and converts
 * it to a JSON object string; it returns null for valid JSON or anything that
 * does not match, so non-matching providers are untouched.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeXmlToolCallArgs } from "../../open-sse/utils/toolCallXmlNormalizer.ts";

const SINGLE_ARG_XML = `<tool_calls:6124c78e>
<tool_call:6124c78e>health_check<tool_sep:6124c78e>
<arg_key:6124c78e>status</arg_key:6124c78e>
<arg_value:6124c78e>ok</arg_value:6124c78e>
</tool_call:6124c78e>
</tool_calls:6124c78e>`;

const MULTI_ARG_XML = `<tool_calls:6124c78e>
<tool_call:6124c78e>health_check<tool_sep:6124c78e>
<arg_key:6124c78e>status</arg_key:6124c78e>
<arg_value:6124c78e>ok</arg_value:6124c78e>
<arg_key:6124c78e>mode</arg_key:6124c78e>
<arg_value:6124c78e>deep</arg_value:6124c78e>
</tool_call:6124c78e>
</tool_calls:6124c78e>`;

const OTHER_TAG_XML = `<tool_calls:9a1b2c3d>
<tool_call:9a1b2c3d>health_check<tool_sep:9a1b2c3d>
<arg_key:9a1b2c3d>status</arg_key:9a1b2c3d>
<arg_value:9a1b2c3d>ok</arg_value:9a1b2c3d>
</tool_call:9a1b2c3d>
</tool_calls:9a1b2c3d>`;

test("normalizeXmlToolCallArgs converts single-arg XML to JSON object", () => {
  const result = normalizeXmlToolCallArgs(SINGLE_ARG_XML);
  assert.ok(result, "expected a normalized JSON string");
  assert.deepEqual(JSON.parse(result as string), { status: "ok" });
});

test("normalizeXmlToolCallArgs converts multi-arg XML to JSON object preserving order", () => {
  const result = normalizeXmlToolCallArgs(MULTI_ARG_XML);
  assert.ok(result, "expected a normalized JSON string");
  assert.deepEqual(JSON.parse(result as string), { status: "ok", mode: "deep" });
});

test("normalizeXmlToolCallArgs tolerates a different tag constant", () => {
  const result = normalizeXmlToolCallArgs(OTHER_TAG_XML);
  assert.ok(result, "expected a normalized JSON string");
  assert.deepEqual(JSON.parse(result as string), { status: "ok" });
});

test("normalizeXmlToolCallArgs handles a model preamble before the wrapper", () => {
  const withPreamble = `I'll call the health_check tool with status "ok".<tool_calls:6124c78e>\n<tool_call:6124c78e>health_check<tool_sep:6124c78e>\n<arg_key:6124c78e>status</arg_key:6124c78e>\n<arg_value:6124c78e>ok</arg_value:6124c78e>\n</tool_call:6124c78e>\n</tool_calls:6124c78e>`;
  const result = normalizeXmlToolCallArgs(withPreamble);
  assert.ok(result, "expected a normalized JSON string");
  assert.deepEqual(JSON.parse(result as string), { status: "ok" });
});

test("normalizeXmlToolCallArgs leaves already-valid JSON untouched (null)", () => {
  const args = JSON.stringify({ status: "ok" });
  assert.equal(normalizeXmlToolCallArgs(args), null);
});

test("normalizeXmlToolCallArgs leaves plain-text args untouched (null)", () => {
  assert.equal(normalizeXmlToolCallArgs("hello world"), null);
  assert.equal(normalizeXmlToolCallArgs(""), null);
  assert.equal(normalizeXmlToolCallArgs("   "), null);
  assert.equal(normalizeXmlToolCallArgs('{"partial'), null);
});

test("normalizeXmlToolCallArgs leaves XML that is not a tool_calls wrapper untouched", () => {
  assert.equal(normalizeXmlToolCallArgs("<foo>bar</foo>"), null);
  assert.equal(normalizeXmlToolCallArgs("<tool_call>no_args</tool_call>"), null);
});
