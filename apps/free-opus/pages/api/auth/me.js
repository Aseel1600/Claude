// Simple auth/me stub: returns mocked user from token
module.exports = async (req, res) => {
  try {
    const auth = req.headers.authorization || req.query.token || req.body?.token;
    if (!auth) return res.status(401).json({ error: "unauthenticated" });
    // token format: mock-token-<hex-email>
    const parts = auth.split("-");
    const hex = parts.slice(2).join("-");
    let email = "unknown";
    try { email = Buffer.from(hex, "hex").toString(); } catch (e) {}
    return res.json({ ok: true, email, tenantId: "mock-tenant-1" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  }
};
