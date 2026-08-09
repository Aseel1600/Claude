// API: /api/status?jobId=...
const queue = require("../../lib/queue");
const runway = require("../../lib/runway-mock");

module.exports = async (req, res) => {
  try {
    const jobId = req.query.jobId || req.body?.jobId;
    if (!jobId) return res.status(400).json({ error: "jobId required" });

    // Check in-memory queue status and runway
    const qStatus = queue.getStatus(jobId) || null;
    const rStatus = await runway.getStatus(jobId).catch(() => null);

    return res.json({ ok: true, jobId, queue: qStatus, runway: rStatus });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal_error" });
  }
};
