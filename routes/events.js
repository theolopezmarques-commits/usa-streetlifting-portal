const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');
const { sendEmail, eventConfirmEmail } = require('../email');

const router = express.Router();

// GET /api/events — public list of upcoming events
router.get('/', (req, res) => {
  const events = dbAll(
    `SELECT e.id, e.name, e.event_date, e.location, e.description,
            (SELECT COUNT(*) FROM event_registrations WHERE event_id = e.id) AS judge_count
     FROM events e
     ORDER BY e.event_date ASC`,
    []
  );
  res.json({ events });
});

// GET /api/events/my — events the current user registered for
router.get('/my', (req, res) => {
  const rows = dbAll(
    `SELECT e.id, e.name, e.event_date, e.location, e.description
     FROM events e
     JOIN event_registrations r ON r.event_id = e.id
     WHERE r.user_id = ?
     ORDER BY e.event_date ASC`,
    [req.user.id]
  );
  res.json({ events: rows });
});

// POST /api/events/:id/register — judge signs up for an event
router.post('/:id/register', async (req, res) => {
  const eventId = parseInt(req.params.id);
  const event = dbGet('SELECT * FROM events WHERE id = ?', [eventId]);
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  // Must have at least one certification
  const cert = dbGet('SELECT id FROM certifications WHERE user_id = ?', [req.user.id]);
  if (!cert) return res.status(403).json({ error: 'You must be a certified judge to register for events.' });

  try {
    dbRun('INSERT OR IGNORE INTO event_registrations (event_id, user_id) VALUES (?, ?)', [eventId, req.user.id]);
    const user = dbGet('SELECT name, email FROM users WHERE id = ?', [req.user.id]);
    await sendEmail({
      to: user.email,
      subject: `Event Registration: ${event.name}`,
      html: eventConfirmEmail(user.name, event.name, event.event_date, event.location),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not register.' });
  }
});

// POST /api/events/:id/unregister
router.post('/:id/unregister', (req, res) => {
  dbRun('DELETE FROM event_registrations WHERE event_id = ? AND user_id = ?', [parseInt(req.params.id), req.user.id]);
  res.json({ success: true });
});

module.exports = router;
