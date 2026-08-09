// Stripe customer creation stub. If STRIPE_SECRET_KEY is set, integrate with stripe SDK.
module.exports = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "email required" });
    if (process.env.STRIPE_SECRET_KEY) {
      // TODO: integrate with stripe-node
      return res.json({ ok: true, id: "stripe-customer-id-placeholder" });
    }
    // Mock response
    return res.json({ ok: true, id: `mock-customer-${Buffer.from(email).toString("hex")}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  }
};
