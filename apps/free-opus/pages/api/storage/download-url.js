// POST /api/storage/download-url { key }
const s3 = require("../../../../lib/storage-s3");

module.exports = async (req, res) => {
  try {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: "key required" });
    const presign = await s3.getSignedDownloadUrl(key);
    return res.json({ ok: true, presign });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal_error" });
  }
};
