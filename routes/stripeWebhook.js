const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { dbRun } = require('../db');

// POST /api/payment/webhook
// Stripe calls this automatically when a payment is completed.
// Must receive the raw body (not JSON-parsed) for signature verification.
module.exports = function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    // Webhook secret not configured yet — skip verification (dev only)
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature check');
    handleEvent(req.body.toString());
    return res.json({ received: true });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  handleEvent(null, event);
  res.json({ received: true });
};

function handleEvent(rawBody, event) {
  if (!event) {
    try { event = JSON.parse(rawBody); } catch { return; }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    if (userId && session.payment_status === 'paid') {
      dbRun(
        `UPDATE payments SET status = 'paid' WHERE user_id = ? AND venmo_note = ? AND status = 'pending'`,
        [userId, session.id]
      );
      console.log(`Payment confirmed for user ${userId} — session ${session.id}`);
    }
  }
}
