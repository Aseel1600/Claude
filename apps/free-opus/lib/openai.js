// Minimal OpenAI wrapper. If OPENAI_API_KEY is not set, returns a mock completion.
const fetch = require("node-fetch");

async function complete(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // Mock response for demo
    return { model: "mock-openai", text: `MOCK: Generated content for prompt:\n${prompt}` };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${txt}`);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content || JSON.stringify(json);
  return { model: json.model || "openai", text };
}

module.exports = { complete };
