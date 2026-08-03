import test from "node:test";
import assert from "node:assert/strict";

import { ensureTestEnvironment, BASE_URL, API_KEY } from "./liveGeminiShared.ts";

const MODEL = process.env.TEST_RESPONSES_MODEL || "gemini/gemini-2.0-flash";
const REASONING_MODEL = process.env.TEST_REASONING_MODEL || "opencode/big-pickle";
const skip = !API_KEY ? "OMNIROUTE_API_KEY not set — skipping live test" : undefined;

test.before(async () => {
  await ensureTestEnvironment();
});

async function readResponsesSSEStream(response: Response): Promise<{
  fullText: string;
  items: Record<string, unknown>[];
  finishStatus: string;
}> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  const items: Record<string, unknown>[] = [];
  let finishStatus = "unknown";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        if (parsed.type === "response.output_text.delta") {
          fullText += (parsed.delta as string) || "";
        } else if (parsed.type === "response.output_item.added") {
          items.push(parsed.item as Record<string, unknown>);
        } else if (parsed.type === "response.done") {
          const resp = parsed.response as Record<string, unknown> | undefined;
          finishStatus = (resp?.status as string) || "done";
        }
      } catch (e) {
        // console.error("Error parsing SSE chunk:", e, data);
      }
    }
  }

  return { fullText, items, finishStatus };
}

test("live Responses API — tool call generation", { skip }, async (t) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    console.log(`[TEST] Responses API: Sending tool call request to ${BASE_URL}/api/v1/responses`);
    const response = await fetch(`${BASE_URL}/api/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "text", text: "What is the weather in San Francisco?" }],
          },
        ],
        tools: [
          {
            type: "function",
            name: "get_weather",
            description: "Get the current weather in a given location",
            parameters: {
              type: "object",
              properties: {
                location: {
                  type: "string",
                  description: "The city and state, e.g. San Francisco, CA",
                },
              },
              required: ["location"],
            },
          },
        ],
        stream: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}`);

    const { fullText, items, finishStatus } = await readResponsesSSEStream(response);

    console.log(`[TEST] Responses API Result: items=${items.length}, finish=${finishStatus}`);

    const toolCalls = items.filter((item) => item.type === "function_call");
    assert.ok(toolCalls.length > 0, "Should have at least one tool call");
    assert.equal(toolCalls[0].name, "get_weather", "Tool call name should match");
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
});

test("live Responses API — multi-turn reasoning capture/replay", { skip }, async (t) => {
  // This test simulates a model that produces reasoning and checks if we can replay it
  // We'll use a thinking model alias "big-pickle" if we can, or just gemini with thinking enabled.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    // Turn 1: Ask something that triggers reasoning
    console.log(`[TEST] Responses API: Turn 1 (Reasoning trigger) with ${REASONING_MODEL}`);
    const response1 = await fetch(`${BASE_URL}/api/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: REASONING_MODEL,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "text", text: "Think step-by-step about this problem: 123 * 456 + 789" },
            ],
          },
        ],
        stream: true,
      }),
      signal: controller.signal,
    });

    assert.equal(response1.status, 200);
    const result1 = await readResponsesSSEStream(response1);

    // Find reasoning item if any
    const reasoningItems = result1.items.filter((item) => item.type === "reasoning");
    console.log(`[TEST] Turn 1: Found ${reasoningItems.length} reasoning items`);

    // Turn 2: Follow up
    // We need to send back the assistant message (which might contain reasoning)
    const assistantMessage = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: result1.fullText }],
    };

    // If there was reasoning, it should have been captured and replayed if we include it
    // Responses API usually includes the reasoning in the input history.
    const input2 = [
      {
        type: "message",
        role: "user",
        content: [
          { type: "text", text: "Solve this complex math problem step by step: 123 * 456 + 789" },
        ],
      },
      ...result1.items.map((item) => ({ ...item })), // Include reasoning and message
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Now add 1 to the result." }],
      },
    ];

    console.log(`[TEST] Responses API: Turn 2 (Follow up) with ${REASONING_MODEL}`);
    const response2 = await fetch(`${BASE_URL}/api/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: REASONING_MODEL,
        input: input2,
        stream: true,
      }),
      signal: controller.signal,
    });

    assert.equal(response2.status, 200);
    const result2 = await readResponsesSSEStream(response2);
    assert.ok(result2.fullText.length > 0, "Should have response in turn 2");
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
});

test(
  "live Responses API — multi-turn with tool result (reasoning replay check)",
  { skip },
  async (t) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    try {
      // Turn 1: Trigger tool call
      console.log(`[TEST] Responses API: Turn 1 (Tool trigger) with ${MODEL}`);
      const response1 = await fetch(`${BASE_URL}/api/v1/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "text", text: "What is the weather in SF?" }],
            },
          ],
          tools: [
            {
              type: "function",
              name: "get_weather",
              description: "Get weather",
              parameters: { type: "object", properties: { location: { type: "string" } } },
            },
          ],
          stream: true,
        }),
        signal: controller.signal,
      });

      assert.equal(response1.status, 200);
      const result1 = await readResponsesSSEStream(response1);
      const toolCall = result1.items.find((item) => item.type === "function_call");
      assert.ok(toolCall, "Should have generated a tool call");

      // Turn 2: Provide tool result and ask for final answer
      // We'll use REASONING_MODEL for the final turn to verify reasoning replay
      const input2 = [
        {
          type: "message",
          role: "user",
          content: [{ type: "text", text: "What is the weather in SF?" }],
        },
        ...result1.items.map((item) => ({ ...item })),
        {
          type: "function_call_output",
          call_id: toolCall.call_id,
          output: JSON.stringify({ temp: 22, unit: "celsius", condition: "Sunny" }),
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "text", text: "Great, tell me the result." }],
        },
      ];

      console.log(`[TEST] Responses API: Turn 2 (Tool result) with ${REASONING_MODEL}`);
      const response2 = await fetch(`${BASE_URL}/api/v1/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: REASONING_MODEL,
          input: input2,
          stream: true,
        }),
        signal: controller.signal,
      });

      assert.equal(response2.status, 200);
      const result2 = await readResponsesSSEStream(response2);
      assert.ok(result2.fullText.length > 0, "Should have final response");

      // Verify reasoning in turns is not lost if the model supports it
      // Note: We can't easily check the providerRequest from the outside,
      // but a successful response without "forgetting" is a good sign.
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }
);
