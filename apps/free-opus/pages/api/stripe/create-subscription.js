// Stripe subscription stub
module.exports = async (req, res) => {
  try {
    const { customerId, priceId } = req.body || {};
    if (!customerId || !priceId) return res.status(400).json({ error: "customerId and priceId required" });
    if (process.env.STRIPE_SECRET_KEY) {
      // TODO: integrate with Stripe
      return res.json({ ok: true, subscriptionId: "stripe-sub-placeholder" });
    }
    return res.json({ ok: true, subscriptionId: `mock-sub-${customerId}-${priceId}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  }
};
