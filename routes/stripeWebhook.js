const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const { dbRun } = require('../db');

// POST /api/payment/webhook
// Stripe calls this automatically when a payment is completed.
// Must receive the raw body (not JSON-parsed) for signature verification.
module.exports = function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('STRIPE_WEBHOOK_SECRET not set in production — rejecting webhook');
      return res.status(400).send('Webhook configuration error.');
    }
    // Dev only: skip verification (never deploy without STRIPE_WEBHOOK_SECRET)
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature check (dev only)');
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
    const userId   = session.metadata?.user_id;
    const optionId = session.metadata?.option_id; // e.g. 'cert_level_0' or 'cert_level_1'

    if (userId && session.payment_status === 'paid') {
      // Mark payment as paid
      dbRun(
        `UPDATE payments SET status = 'paid' WHERE user_id = ? AND venmo_note = ? AND status = 'pending'`,
        [userId, session.id]
      );

      // Grant course access for the purchased level
      const levelMap = { cert_level_0: 0, cert_level_1: 1 };
      const level = levelMap[optionId];
      if (level !== undefined) {
        dbRun(
          `INSERT OR IGNORE INTO course_access (user_id, level, granted_by) VALUES (?, ?, NULL)`,
          [userId, level]
        );
        // Level 1 includes Level 0 content — grant level 0 access too
        if (level === 1) {
          dbRun(
            `INSERT OR IGNORE INTO course_access (user_id, level, granted_by) VALUES (?, 0, NULL)`,
            [userId]
          );
        }
        console.log(`Course access granted: user ${userId} → Level ${level} (option: ${optionId})`);
      }

      console.log(`Payment confirmed for user ${userId} — session ${session.id}`);
    }
  }
}
