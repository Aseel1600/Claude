import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearxngResponse } from "../../open-sse/handlers/search.ts";

test("normalizeSearxngResponse returns results and totalResults for valid payload", () => {
  const payload = {
    results: [
      { title: "Test", url: "http://example.com", content: "Snippet" },
      { title: "Test 2", url: "http://example2.com", snippet: "Snippet 2" },
    ],
  };

  const result = normalizeSearxngResponse(payload, "test", "web");

  assert.deepEqual(result.results.length, 2);
  assert.equal(result.totalResults, 2);
  assert.equal(result.results[0].title, "Test");
  assert.equal(result.results[0].url, "http://example.com");
  assert.equal(result.results[0].snippet, "Snippet");
});

test("normalizeSearxngResponse throws error for non-object payload", () => {
  assert.throws(() => normalizeSearxngResponse(null, "test", "web"), /Malformed SearXNG payload/);
  assert.throws(
    () => normalizeSearxngResponse("string", "test", "web"),
    /Malformed SearXNG payload/
  );
  assert.throws(() => normalizeSearxngResponse([], "test", "web"), /Malformed SearXNG payload/);
});

test("normalizeSearxngResponse preserves valid empty array", () => {
  const result = normalizeSearxngResponse({ results: [] }, "test", "web");
  assert.deepEqual(result.results, []);
  assert.equal(result.totalResults, 0);
});
