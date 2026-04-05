const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');
const { sendEmail, announcementEmail } = require('../email');

const router = express.Router();

// Admin-only middleware
function requireAdmin(req, res, next) {
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'Access denied.' });
  next();
}

// GET /api/admin/users — all users with their latest payment + cert status
router.get('/users', requireAdmin, (req, res) => {
  const users = dbAll(
    `SELECT u.id, u.name, u.email, u.state, u.phone, u.experience, u.instagram, u.position, u.comps_judged, u.show_in_directory, u.created_at,
            p.description AS cert_level,
            p.status      AS payment_status,
            p.amount_cents,
            p.created_at  AS payment_date
     FROM users u
     LEFT JOIN (
       SELECT user_id, description, status, amount_cents, created_at
       FROM payments
       WHERE id IN (
         SELECT COALESCE(
           (SELECT id FROM payments p2 WHERE p2.user_id = p1.user_id AND p2.status = 'paid' ORDER BY p2.id DESC LIMIT 1),
           (SELECT id FROM payments p2 WHERE p2.user_id = p1.user_id ORDER BY p2.id DESC LIMIT 1)
         )
         FROM (SELECT DISTINCT user_id FROM payments) p1
       )
     ) p ON p.user_id = u.id
     WHERE u.is_admin = 0
     ORDER BY u.created_at DESC`,
    []
  );

  // Attach certifications for each user
  const usersWithCerts = users.map(u => {
    const certs = dbAll(
      `SELECT level, granted_at FROM certifications WHERE user_id = ? ORDER BY level`,
      [u.id]
    );
    return { ...u, certifications: certs };
  });

  res.json({ users: usersWithCerts });
});

// POST /api/admin/grant-certification — mark oral exam passed for a user (level 0 or 1)
router.post('/grant-certification', requireAdmin, (req, res) => {
  const { userId, level } = req.body;
  if (!userId || ![0, 1, 2].includes(level)) {
    return res.status(400).json({ error: 'userId and level (0, 1, or 2) required.' });
  }
  try {
    dbRun(
      `INSERT OR REPLACE INTO certifications (user_id, level, granted_by) VALUES (?, ?, ?)`,
      [userId, level, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not grant certification.' });
  }
});

// POST /api/admin/revoke-certification
router.post('/revoke-certification', requireAdmin, (req, res) => {
  const { userId, level } = req.body;
  if (!userId || level === undefined) {
    return res.status(400).json({ error: 'userId and level required.' });
  }
  dbRun(`DELETE FROM certifications WHERE user_id = ? AND level = ?`, [userId, level]);
  res.json({ success: true });
});

// POST /api/admin/grant-level3 — directly grant Level 3 without application
router.post('/grant-level3', requireAdmin, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required.' });
  try {
    dbRun(
      `INSERT OR REPLACE INTO certifications (user_id, level, granted_by) VALUES (?, 3, ?)`,
      [userId, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not grant Level 3.' });
  }
});

// GET /api/admin/level3-applications
router.get('/level3-applications', requireAdmin, (req, res) => {
  const apps = dbAll(
    `SELECT a.id, a.user_id, a.status, a.applied_at, u.name, u.email, u.state
     FROM level3_applications a
     JOIN users u ON u.id = a.user_id
     ORDER BY a.applied_at DESC`,
    []
  );
  res.json({ applications: apps });
});

// POST /api/admin/review-level3
router.post('/review-level3', requireAdmin, (req, res) => {
  const { userId, decision } = req.body; // decision: 'approved' | 'rejected'
  if (!userId || !['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'userId and decision (approved/rejected) required.' });
  }
  dbRun(
    `UPDATE level3_applications SET status = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE user_id = ?`,
    [decision, req.user.id, userId]
  );
  if (decision === 'approved') {
    dbRun(
      `INSERT OR REPLACE INTO certifications (user_id, level, granted_by) VALUES (?, 3, ?)`,
      [userId, req.user.id]
    );
  }
  res.json({ success: true });
});

// GET /api/admin/user-detail/:id — full progress for one user
router.get('/user-detail/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;
  const user = dbGet('SELECT id, name, email, state FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const payments = dbAll(
    `SELECT description, status, amount_cents, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
  const certifications = dbAll(
    `SELECT level, granted_at FROM certifications WHERE user_id = ?`,
    [userId]
  );
  const videos = dbAll(
    `SELECT level, video_index FROM video_progress WHERE user_id = ? ORDER BY level, video_index`,
    [userId]
  );
  const exams = dbAll(
    `SELECT level, score, passed, created_at FROM exam_attempts WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
  const level3app = dbGet(`SELECT status, applied_at FROM level3_applications WHERE user_id = ?`, [userId]);
  const courseAccess = dbAll(`SELECT level FROM course_access WHERE user_id = ?`, [userId]).map(r => r.level);

  res.json({ user, payments, certifications, videos, exams, level3app, courseAccess });
});

// POST /api/admin/grant-course-access
router.post('/grant-course-access', requireAdmin, (req, res) => {
  const { userId, level } = req.body;
  if (!userId || ![0, 1, 2].includes(level)) return res.status(400).json({ error: 'userId and level (0, 1, or 2) required.' });
  dbRun(`INSERT OR IGNORE INTO course_access (user_id, level, granted_by) VALUES (?, ?, ?)`, [userId, level, req.user.id]);
  res.json({ success: true });
});

// POST /api/admin/revoke-course-access
router.post('/revoke-course-access', requireAdmin, (req, res) => {
  const { userId, level } = req.body;
  if (!userId || level === undefined) return res.status(400).json({ error: 'userId and level required.' });
  dbRun(`DELETE FROM course_access WHERE user_id = ? AND level = ?`, [userId, level]);
  res.json({ success: true });
});

// POST /api/admin/update-judge — update judge profile fields
router.post('/update-judge', requireAdmin, (req, res) => {
  const { userId, position, instagram, comps_judged, show_in_directory } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required.' });
  dbRun(
    `UPDATE users SET position = ?, instagram = ?, comps_judged = ?, show_in_directory = ? WHERE id = ?`,
    [position || null, instagram || null, parseInt(comps_judged) || 0, show_in_directory ? 1 : 0, userId]
  );
  res.json({ success: true });
});

// POST /api/admin/announce — send email to targeted judges
// target: 'all' | 'state' | 'manual'
// state: required if target === 'state'
// userIds: required if target === 'manual' (array of user IDs)
router.post('/announce', requireAdmin, async (req, res) => {
  const { subject, body, target, state, userIds } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body required.' });
  if (!['all', 'state', 'manual'].includes(target)) return res.status(400).json({ error: 'target must be all, state, or manual.' });

  let judges = [];

  if (target === 'all') {
    judges = dbAll(
      `SELECT DISTINCT u.name, u.email FROM users u
       JOIN certifications c ON c.user_id = u.id
       WHERE u.email_verified = 1`,
      []
    );
  } else if (target === 'state') {
    if (!state) return res.status(400).json({ error: 'state required.' });
    judges = dbAll(
      `SELECT DISTINCT u.name, u.email FROM users u
       JOIN certifications c ON c.user_id = u.id
       WHERE u.email_verified = 1 AND u.state = ?`,
      [state]
    );
  } else if (target === 'manual') {
    if (!Array.isArray(userIds) || userIds.length === 0) return res.status(400).json({ error: 'userIds array required.' });
    const placeholders = userIds.map(() => '?').join(',');
    judges = dbAll(
      `SELECT u.name, u.email FROM users u WHERE u.id IN (${placeholders}) AND u.email_verified = 1`,
      userIds
    );
  }

  let sent = 0;
  for (const j of judges) {
    await sendEmail({
      to: j.email,
      subject,
      html: announcementEmail(j.name, subject, body),
    });
    sent++;
  }
  res.json({ success: true, sent });
});

// ── Event management ──────────────────────────────────────────────────────────

// GET /api/admin/events
router.get('/events', requireAdmin, (req, res) => {
  const events = dbAll(
    `SELECT e.*, (SELECT COUNT(*) FROM event_registrations WHERE event_id = e.id) AS judge_count
     FROM events e ORDER BY e.event_date DESC`,
    []
  );
  res.json({ events });
});

// POST /api/admin/events
router.post('/events', requireAdmin, (req, res) => {
  const { name, event_date, location, description } = req.body;
  if (!name || !event_date || !location) return res.status(400).json({ error: 'name, event_date and location required.' });
  const result = dbRun(
    `INSERT INTO events (name, event_date, location, description) VALUES (?, ?, ?, ?)`,
    [name, event_date, location, description || '']
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/admin/events/:id
router.put('/events/:id', requireAdmin, (req, res) => {
  const { name, event_date, location, description } = req.body;
  if (!name || !event_date || !location) return res.status(400).json({ error: 'name, event_date and location required.' });
  const result = dbRun(
    `UPDATE events SET name = ?, event_date = ?, location = ?, description = ? WHERE id = ?`,
    [name, event_date, location, description || '', req.params.id]
  );
  if (result.changes === 0) return res.status(404).json({ error: 'Event not found.' });
  res.json({ success: true });
});

// DELETE /api/admin/events/:id
router.delete('/events/:id', requireAdmin, (req, res) => {
  dbRun('DELETE FROM event_registrations WHERE event_id = ?', [req.params.id]);
  dbRun('DELETE FROM events WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// GET /api/admin/events/:id/judges — list of judges registered for an event
router.get('/events/:id/judges', requireAdmin, (req, res) => {
  const judges = dbAll(
    `SELECT u.name, u.email, u.state,
            GROUP_CONCAT(c.level) AS cert_levels
     FROM event_registrations r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN certifications c ON c.user_id = u.id
     WHERE r.event_id = ?
     GROUP BY u.id`,
    [req.params.id]
  );
  res.json({ judges });
});

// GET /api/admin/settings
router.get('/settings', requireAdmin, (req, res) => {
  const judges = dbGet(`SELECT value FROM settings WHERE key = 'certified_judges'`);
  const comps  = dbGet(`SELECT value FROM settings WHERE key = 'competitions_judged'`);
  const states = dbGet(`SELECT value FROM settings WHERE key = 'states_covered'`);
  res.json({ certified_judges: judges?.value, competitions_judged: comps?.value, states_covered: states?.value });
});

// POST /api/admin/settings
router.post('/settings', requireAdmin, (req, res) => {
  const { certified_judges, competitions_judged, states_covered } = req.body;
  if (certified_judges !== undefined) {
    dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('certified_judges', ?)`, [String(parseInt(certified_judges))]);
  }
  if (competitions_judged !== undefined) {
    dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('competitions_judged', ?)`, [String(parseInt(competitions_judged))]);
  }
  if (states_covered !== undefined) {
    dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('states_covered', ?)`, [String(parseInt(states_covered))]);
  }
  res.json({ success: true });
});

// GET /api/admin/analytics
router.get('/analytics', requireAdmin, (req, res) => {
  // Signups per month (last 12 months)
  const signups = dbAll(
    `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
     FROM users WHERE is_admin = 0
     GROUP BY month ORDER BY month DESC LIMIT 12`,
    []
  ).reverse();

  // Certs granted per month (last 12 months)
  const certs = dbAll(
    `SELECT strftime('%Y-%m', granted_at) AS month, COUNT(*) AS count
     FROM certifications
     GROUP BY month ORDER BY month DESC LIMIT 12`,
    []
  ).reverse();

  // Totals
  const totalUsers = dbGet('SELECT COUNT(*) AS cnt FROM users WHERE is_admin = 0', [])?.cnt || 0;
  const totalCerts = dbGet('SELECT COUNT(*) AS cnt FROM certifications', [])?.cnt || 0;
  const totalRevenue = dbGet(`SELECT SUM(amount_cents) AS total FROM payments WHERE status = 'paid'`, [])?.total || 0;

  res.json({ signups, certs, totalUsers, totalCerts, totalRevenue });
});

// GET /api/admin/export-csv
router.get('/export-csv', requireAdmin, (req, res) => {
  const users = dbAll(
    `SELECT u.id, u.name, u.email, u.state, u.phone, u.position, u.instagram,
            u.comps_judged, u.created_at, u.email_verified,
            GROUP_CONCAT(c.level ORDER BY c.level) AS cert_levels,
            MAX(c.granted_at) AS last_cert_date
     FROM users u
     LEFT JOIN certifications c ON c.user_id = u.id
     WHERE u.is_admin = 0
     GROUP BY u.id
     ORDER BY u.name`,
    []
  );

  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ['ID','Name','Email','State','Phone','Position','Instagram','Comps Judged','Cert Levels','Last Cert Date','Joined','Email Verified'];
  const rows = users.map(u => [
    u.id, u.name, u.email, u.state, u.phone, u.position, u.instagram,
    u.comps_judged, u.cert_levels, u.last_cert_date, u.created_at, u.email_verified ? 'Yes' : 'No'
  ].map(escape).join(','));

  const csv = [header.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="usasl-judges.csv"');
  res.send(csv);
});

// DELETE /api/admin/users/:id — permanently delete a user and all their data
router.delete('/users/:id', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Invalid user ID.' });
  // Prevent admin from deleting themselves
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  const user = dbGet('SELECT id, is_admin FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.is_admin) return res.status(400).json({ error: 'Cannot delete admin accounts.' });

  dbRun('DELETE FROM video_progress WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM exam_attempts WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM certifications WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM payments WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM level3_applications WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM email_verifications WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM event_registrations WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM course_access WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM login_attempts WHERE email = (SELECT email FROM users WHERE id = ?)', [userId]);
  dbRun('DELETE FROM comp_history WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM messages WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM users WHERE id = ?', [userId]);

  res.json({ success: true });
});

// GET /api/admin/expiring-certs
router.get('/expiring-certs', requireAdmin, (req, res) => {
  const rows = dbAll(
    `SELECT u.name, u.email, u.state, c.level, c.granted_at,
            date(c.granted_at, '+1 year') AS expires_at,
            CAST((julianday(date(c.granted_at, '+1 year')) - julianday('now')) AS INTEGER) AS days_left
     FROM certifications c
     JOIN users u ON u.id = c.user_id
     WHERE u.email_verified = 1
       AND days_left <= 90
     ORDER BY days_left ASC`,
    []
  );
  res.json({ certs: rows });
});

// POST /api/admin/sync-payments
router.post('/sync-payments', requireAdmin, async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
  const levelMap = { cert_level_0: 0, cert_level_1: 1 };
  const results = [];
  let fixed = 0;

  // Step 1: fix pending payments that Stripe shows as paid
  const pending = dbAll(
    `SELECT p.id, p.user_id, p.venmo_note, p.description, u.name, u.email
     FROM payments p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'pending' AND p.venmo_note LIKE 'cs_%'`, []
  );

  for (const p of pending) {
    try {
      const session = await stripe.checkout.sessions.retrieve(p.venmo_note);
      if (session.payment_status === 'paid') {
        dbRun(`UPDATE payments SET status = 'paid' WHERE id = ?`, [p.id]);
        const optionId = session.metadata?.option_id;
        const level = levelMap[optionId];
        if (level !== undefined) {
          dbRun(`INSERT OR IGNORE INTO course_access (user_id, level, granted_by) VALUES (?, ?, NULL)`, [p.user_id, level]);
          if (level === 1) dbRun(`INSERT OR IGNORE INTO course_access (user_id, level, granted_by) VALUES (?, 0, NULL)`, [p.user_id]);
        }
        results.push(`FIXED: ${p.name} (${p.email}) — ${p.description} — level granted: ${level ?? 'unknown option '+optionId}`);
        fixed++;
      } else {
        results.push(`STILL PENDING: ${p.name} — ${p.description} — stripe status: ${session.payment_status}`);
      }
    } catch (err) {
      results.push(`ERROR checking payment #${p.id} for ${p.name}: ${err.message}`);
    }
  }

  // Step 2: fix paid payments that never got course_access
  const paidNoAccess = dbAll(
    `SELECT p.user_id, p.description, u.name, u.email
     FROM payments p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'paid'
       AND p.venmo_note LIKE 'cs_%'
       AND NOT EXISTS (SELECT 1 FROM course_access ca WHERE ca.user_id = p.user_id)`, []
  );

  for (const p of paidNoAccess) {
    const levelMatch = p.description.match(/Level (\d)/i);
    const level = levelMatch ? parseInt(levelMatch[1]) : null;
    if (level !== null && level <= 1) {
      dbRun(`INSERT OR IGNORE INTO course_access (user_id, level, granted_by) VALUES (?, ?, NULL)`, [p.user_id, level]);
      if (level === 1) dbRun(`INSERT OR IGNORE INTO course_access (user_id, level, granted_by) VALUES (?, 0, NULL)`, [p.user_id]);
      results.push(`ACCESS FIXED: ${p.name} (${p.email}) already paid — granted Level ${level}`);
      fixed++;
    }
  }

  if (results.length === 0) results.push('No pending payments found in DB.');
  res.json({ fixed, total: pending.length, results });
});

// GET /api/admin/user-payments?q=xxx
router.get('/user-payments', requireAdmin, (req, res) => {
  const q = (req.query.q || req.query.email || '').trim().toLowerCase();
  if (!q) return res.status(400).json({ error: 'Search term required.' });
  const users = dbAll(
    `SELECT id, name, email FROM users WHERE LOWER(email) LIKE ? OR LOWER(name) LIKE ?`,
    [`%${q}%`, `%${q}%`]
  );
  if (users.length === 0) return res.status(404).json({ error: `No user found matching "${q}".` });
  const user = users[0];
  const payments = dbAll('SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC', [user.id]);
  const access = dbAll('SELECT * FROM course_access WHERE user_id = ?', [user.id]);
  res.json({ user, payments, access });
});

// POST /api/admin/force-grant
router.post('/force-grant', requireAdmin, (req, res) => {
  const { userId, level, paymentId } = req.body;
  if (paymentId) {
    dbRun(`UPDATE payments SET status = 'paid' WHERE id = ?`, [paymentId]);
  }
  dbRun(`INSERT OR IGNORE INTO course_access (user_id, level, granted_by) VALUES (?, ?, ?)`, [userId, level, req.user.id]);
  if (level === 1) {
    dbRun(`INSERT OR IGNORE INTO course_access (user_id, level, granted_by) VALUES (?, 0, ?)`, [userId, req.user.id]);
  }
  const user = dbGet('SELECT name FROM users WHERE id = ?', [userId]);
  res.json({ ok: true, message: `Granted Level ${level} access to ${user?.name}` });
});

module.exports = router;
