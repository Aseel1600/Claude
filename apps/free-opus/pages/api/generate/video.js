// API: /api/generate/video
const providers = require("../../../../lib/providers");
const queue = require("../../../../lib/queue");
const rateLimit = require("../../../../lib/rateLimit");

module.exports = async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (!rateLimit.allow(ip)) return res.status(429).json({ error: "rate_limited" });

    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    // Create a runway job (mock) and enqueue it for background processing
    const job = await providers.runway.createJob({ prompt });
    queue.enqueue(job);

    return res.json({ ok: true, jobId: job.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal_error" });
  }
};
