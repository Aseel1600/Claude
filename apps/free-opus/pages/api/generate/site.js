// API: /api/generate/site
const providers = require("../../../../lib/providers");
const rateLimit = require("../../../../lib/rateLimit");

module.exports = async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (!rateLimit.allow(ip)) return res.status(429).json({ error: "rate_limited" });

    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    // Use OpenAI wrapper to generate site spec (mocked if no key)
    const completion = await providers.openai.complete(`Generate a Jamstack Next.js site from this prompt:\n${prompt}`);

    // TODO: create file tree, push to GitHub/Git provider, and return deployment link
    return res.json({ ok: true, prompt, completion });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal_error" });
  }
};
