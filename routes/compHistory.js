const express = require('express');
const { dbRun, dbGet, dbAll } = require('../db');
const router = express.Router();

// GET /api/comp-history — own history
router.get('/', (req, res) => {
  const rows = dbAll(
    `SELECT id, comp_name, comp_date, location, role, created_at
     FROM comp_history WHERE user_id = ? ORDER BY comp_date DESC`,
    [req.user.id]
  );
  res.json({ history: rows });
});

// GET /api/comp-history/user/:id — public (for judge profile)
router.get('/user/:id', (req, res) => {
  const rows = dbAll(
    `SELECT comp_name, comp_date, location, role
     FROM comp_history WHERE user_id = ? ORDER BY comp_date DESC`,
    [req.params.id]
  );
  res.json({ history: rows });
});

// POST /api/comp-history — add entry
router.post('/', (req, res) => {
  const { comp_name, comp_date, location, role } = req.body;
  if (!comp_name || !comp_date) return res.status(400).json({ error: 'comp_name and comp_date required.' });
  if (typeof comp_name !== 'string' || comp_name.length > 100) return res.status(400).json({ error: 'Invalid comp name.' });
  dbRun(
    'INSERT INTO comp_history (user_id, comp_name, comp_date, location, role) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, comp_name.trim(), comp_date, location?.trim() || '', role?.trim() || 'Judge']
  );
  // Also increment comps_judged counter on user
  dbRun('UPDATE users SET comps_judged = comps_judged + 1 WHERE id = ?', [req.user.id]);
  res.json({ success: true });
});

// DELETE /api/comp-history/:id
router.delete('/:id', (req, res) => {
  const row = dbGet('SELECT user_id FROM comp_history WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your entry.' });
  dbRun('DELETE FROM comp_history WHERE id = ?', [req.params.id]);
  dbRun('UPDATE users SET comps_judged = MAX(0, comps_judged - 1) WHERE id = ?', [req.user.id]);
  res.json({ success: true });
});

module.exports = router;
