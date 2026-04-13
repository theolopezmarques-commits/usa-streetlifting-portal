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

// GET /api/events/:id/judges — judges from registrations + comp_history, merged and deduplicated
router.get('/:id/judges', (req, res) => {
  const eventId = parseInt(req.params.id);
  const event = dbGet('SELECT name FROM events WHERE id = ?', [eventId]);
  if (!event) return res.json({ judges: [] });

  // From event_registrations
  const registered = dbAll(
    `SELECT u.id, u.name, u.state, u.avatar
     FROM event_registrations r
     JOIN users u ON u.id = r.user_id
     WHERE r.event_id = ?`,
    [eventId]
  );

  // From comp_history (admin-added or self-logged) — match by name (case-insensitive) OR date
  const fromHistory = dbAll(
    `SELECT DISTINCT u.id, u.name, u.state, u.avatar
     FROM comp_history ch
     JOIN users u ON u.id = ch.user_id
     WHERE LOWER(TRIM(ch.comp_name)) = LOWER(TRIM(?))
        OR ch.comp_date = (SELECT event_date FROM events WHERE id = ?)`,
    [event.name, eventId]
  );

  // Merge, deduplicate by user id
  const seen = new Set();
  const judges = [];
  for (const j of [...registered, ...fromHistory]) {
    if (!seen.has(j.id)) { seen.add(j.id); judges.push(j); }
  }
  judges.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ judges });
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
