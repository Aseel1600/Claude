// API: /api/generate/video
const runway = require("../../../../lib/runway-mock");
const queue = require("../../../../lib/queue");

module.exports = async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    // Create a runway job (mock) and enqueue it for background processing
    const job = await runway.createJob({ prompt });
    queue.enqueue(job);

    return res.json({ ok: true, jobId: job.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal_error" });
  }
};
