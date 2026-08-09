// Simple auth stub: accepts email, returns a mock token. Replace with Clerk/Auth0 integration.
module.exports = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "email required" });

    // In production, create user in DB and issue session cookie / JWT
    const token = `mock-token-${Buffer.from(email).toString("hex")}`;
    res.status(200).json({ ok: true, token, email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  }
};
