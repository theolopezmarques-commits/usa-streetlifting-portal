const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const { dbRun, dbAll, dbGet } = require('../db');

const router = express.Router();

const PAYMENT_OPTIONS = [
  { id: 'cert_level_0', label: 'Level 0 – Entry Judge Certification',        amountCents: 50, description: 'USA Streetlifting Level 0 Judge Certification' },
  { id: 'cert_level_1', label: 'Level 1 – Foundational Judge Certification', amountCents: 3900, description: 'USA Streetlifting Level 1 Judge Certification' },
];

// GET /api/payment/options — used by frontend to render the level cards
router.get('/options', (_req, res) => {
  res.json({
    options: PAYMENT_OPTIONS.map(o => ({
      id: o.id,
      label: o.label,
      amount: `$${(o.amountCents / 100).toFixed(2)}`,
      amountCents: o.amountCents,
    })),
  });
});

// POST /api/payment/create-checkout — creates a Stripe Checkout Session
router.post('/create-checkout', async (req, res) => {
  const { optionId } = req.body;

  if (!optionId || typeof optionId !== 'string') {
    return res.status(400).json({ error: 'optionId is required.' });
  }
  const option = PAYMENT_OPTIONS.find(o => o.id === optionId);
  if (!option) {
    return res.status(400).json({ error: 'Invalid payment option.' });
  }

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

  try {
    const successUrl = `${baseUrl}/?payment=success`;
    const cancelUrl = `${baseUrl}/?payment=cancelled`;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: option.label,
            description: option.description,
          },
          unit_amount: option.amountCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata: {
        user_id:     String(req.user.id),
        option_id:   optionId,
        description: option.description,
      },
    });

    // Save a pending record so the admin panel shows it immediately
    dbRun(
      'INSERT INTO payments (user_id, amount_cents, description, status, venmo_note) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, option.amountCents, option.description, 'pending', session.id]
    );

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message, JSON.stringify(err?.raw || {}));
    res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

// GET /api/payment/verify-session?session_id=xxx
// Called when Stripe redirects back on success — confirms payment and marks as paid
router.get('/verify-session', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'session_id is required.' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed.' });
    }

    const userId = session.metadata?.user_id;
    if (!userId || String(req.user.id) !== userId) {
      return res.status(403).json({ error: 'Session does not belong to this user.' });
    }

    // Mark as paid in DB
    dbRun(
      `UPDATE payments SET status = 'paid' WHERE user_id = ? AND venmo_note = ? AND status = 'pending'`,
      [req.user.id, session_id]
    );

    res.json({ success: true, description: session.metadata?.description });
  } catch (err) {
    console.error('Stripe verify error:', err.message);
    res.status(500).json({ error: 'Could not verify payment.' });
  }
});

// GET /api/payment/history
router.get('/history', (req, res) => {
  const payments = dbAll(
    'SELECT id, amount_cents, description, status, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({
    payments: payments.map(p => ({
      id: p.id,
      amount: `$${(p.amount_cents / 100).toFixed(2)}`,
      description: p.description,
      status: p.status,
      date: p.created_at,
    })),
  });
});

module.exports = router;
