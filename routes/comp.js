const express = require('express');
const { dbRun, dbGet, dbAll } = require('../db');
const router = express.Router();

const LIFTS = ['muscle_up', 'pull_up', 'dip', 'squat'];

// ── SSE broadcaster (set by server.js) ───────────────────────────────────────
let _broadcast = () => {};
router.setBroadcast = fn => { _broadcast = fn; };

// ── Helpers ───────────────────────────────────────────────────────────────────
function isAdmin(userId) {
  const u = dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);
  return !!u?.is_admin;
}

function hasAccess(userId, compId, role) {
  if (isAdmin(userId)) return true;
  const a = dbGet('SELECT role FROM comp_access WHERE user_id = ? AND comp_id = ?', [userId, compId]);
  if (!a) return false;
  if (role === 'any') return true;
  return a.role === role;
}

function getCompOrFail(res, compId) {
  const comp = dbGet('SELECT * FROM competitions WHERE id = ?', [compId]);
  if (!comp) { res.status(404).json({ error: 'Competition not found.' }); return null; }
  return comp;
}

function getFullState(compId) {
  const comp = dbGet('SELECT * FROM competitions WHERE id = ?', [compId]);
  if (!comp) return null;
  const athletes = dbAll('SELECT * FROM comp_athletes WHERE comp_id = ? ORDER BY flight, weight_class, name', [compId]);
  const attempts = dbAll('SELECT * FROM comp_attempts WHERE comp_id = ?', [compId]);
  return { comp, athletes, attempts };
}

function getCurrentAthlete(comp) {
  if (comp.status !== 'active') return null;
  const athletes = dbAll(
    'SELECT a.*, at.declared_weight, at.result FROM comp_athletes a ' +
    'LEFT JOIN comp_attempts at ON at.athlete_id = a.id AND at.lift = ? AND at.attempt_num = ? ' +
    'WHERE a.comp_id = ? AND a.flight = ? ' +
    'ORDER BY COALESCE(at.declared_weight, 9999) ASC, a.id ASC',
    [comp.cur_lift, comp.cur_attempt, comp.comp_id || comp.id, comp.cur_flight]
  );
  return athletes.find(a => a.result === null || a.result === undefined) || null;
}

function broadcastState(compId) {
  const state = getFullState(compId);
  if (state) _broadcast(compId, { type: 'state', ...state });
}

// ── List competitions ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const userId = req.user.id;
  let comps;
  if (isAdmin(userId)) {
    comps = dbAll('SELECT c.*, u.name as creator FROM competitions c JOIN users u ON u.id = c.created_by ORDER BY c.created_at DESC', []);
  } else {
    comps = dbAll(
      'SELECT c.*, u.name as creator, ca.role FROM competitions c ' +
      'JOIN users u ON u.id = c.created_by ' +
      'JOIN comp_access ca ON ca.comp_id = c.id AND ca.user_id = ? ' +
      'ORDER BY c.created_at DESC',
      [userId]
    );
  }
  res.json({ comps });
});

// ── Create competition (admin only) ──────────────────────────────────────────
router.post('/', (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: 'Admin only.' });
  const { name, date, location } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required.' });
  const result = dbRun(
    'INSERT INTO competitions (name, date, location, created_by) VALUES (?, ?, ?, ?)',
    [name.trim(), date || null, location?.trim() || null, req.user.id]
  );
  res.json({ id: result.lastInsertRowid });
});

// ── Get full competition data ─────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  if (!hasAccess(req.user.id, comp.id, 'any')) return res.status(403).json({ error: 'No access.' });
  res.json(getFullState(comp.id));
});

// ── Grant access ──────────────────────────────────────────────────────────────
router.post('/:id/access', (req, res) => {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: 'Admin only.' });
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  const { email, role } = req.body;
  if (!['director', 'judge'].includes(role)) return res.status(400).json({ error: 'Role must be director or judge.' });
  const user = dbGet('SELECT id FROM users WHERE email = ?', [email?.toLowerCase().trim()]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  dbRun('INSERT OR REPLACE INTO comp_access (user_id, comp_id, role) VALUES (?, ?, ?)', [user.id, comp.id, role]);
  res.json({ ok: true });
});

// ── Add athlete ───────────────────────────────────────────────────────────────
router.post('/:id/athletes', (req, res) => {
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  if (!hasAccess(req.user.id, comp.id, 'director')) return res.status(403).json({ error: 'Director access required.' });
  const { name, weight_class, gender, flight, body_weight, records, bio } = req.body;
  if (!name || !weight_class) return res.status(400).json({ error: 'Name and weight class required.' });
  const result = dbRun(
    'INSERT INTO comp_athletes (comp_id, name, weight_class, gender, flight, body_weight, records, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [comp.id, name.trim(), weight_class, gender || 'M', flight || 'A', body_weight || null, records?.trim() || null, bio?.trim() || null]
  );
  res.json({ id: result.lastInsertRowid });
});

// ── Update athlete ────────────────────────────────────────────────────────────
router.put('/:id/athletes/:aid', (req, res) => {
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  if (!hasAccess(req.user.id, comp.id, 'director')) return res.status(403).json({ error: 'Director access required.' });
  const { name, weight_class, gender, flight, body_weight, records, bio, photo_url } = req.body;
  dbRun(
    'UPDATE comp_athletes SET name=?, weight_class=?, gender=?, flight=?, body_weight=?, records=?, bio=?, photo_url=? WHERE id=? AND comp_id=?',
    [name, weight_class, gender, flight, body_weight || null, records || null, bio || null, photo_url || null, req.params.aid, comp.id]
  );
  res.json({ ok: true });
});

// ── Delete athlete ────────────────────────────────────────────────────────────
router.delete('/:id/athletes/:aid', (req, res) => {
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  if (!hasAccess(req.user.id, comp.id, 'director')) return res.status(403).json({ error: 'Director access required.' });
  dbRun('DELETE FROM comp_attempts WHERE athlete_id = ? AND comp_id = ?', [req.params.aid, comp.id]);
  dbRun('DELETE FROM comp_athletes WHERE id = ? AND comp_id = ?', [req.params.aid, comp.id]);
  res.json({ ok: true });
});

// ── Save declared weights for a round ────────────────────────────────────────
// Body: { lift, attempt_num, weights: [{athlete_id, weight}] }
router.put('/:id/weights', (req, res) => {
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  if (!hasAccess(req.user.id, comp.id, 'director')) return res.status(403).json({ error: 'Director access required.' });
  const { lift, attempt_num, weights } = req.body;
  if (!LIFTS.includes(lift) || ![1,2,3].includes(attempt_num)) return res.status(400).json({ error: 'Invalid lift or attempt.' });
  for (const { athlete_id, weight } of weights) {
    dbRun(
      'INSERT INTO comp_attempts (comp_id, athlete_id, lift, attempt_num, declared_weight) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(athlete_id, lift, attempt_num) DO UPDATE SET declared_weight = excluded.declared_weight',
      [comp.id, athlete_id, lift, attempt_num, weight]
    );
  }
  broadcastState(comp.id);
  res.json({ ok: true });
});

// ── Activate competition ──────────────────────────────────────────────────────
router.post('/:id/activate', (req, res) => {
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  if (!hasAccess(req.user.id, comp.id, 'director')) return res.status(403).json({ error: 'Director access required.' });
  dbRun('UPDATE competitions SET status = ? WHERE id = ?', ['active', comp.id]);
  broadcastState(comp.id);
  res.json({ ok: true });
});

// ── Update state (flight / lift / attempt) ────────────────────────────────────
router.put('/:id/state', (req, res) => {
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  if (!hasAccess(req.user.id, comp.id, 'director')) return res.status(403).json({ error: 'Director access required.' });
  const { cur_flight, cur_lift, cur_attempt } = req.body;
  const updates = [];
  const vals = [];
  if (cur_flight !== undefined) { updates.push('cur_flight = ?'); vals.push(cur_flight); }
  if (cur_lift !== undefined) { updates.push('cur_lift = ?'); vals.push(cur_lift); }
  if (cur_attempt !== undefined) { updates.push('cur_attempt = ?'); vals.push(cur_attempt); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  vals.push(comp.id);
  dbRun(`UPDATE competitions SET ${updates.join(', ')} WHERE id = ?`, vals);
  broadcastState(comp.id);
  res.json({ ok: true });
});

// ── Submit judge result ───────────────────────────────────────────────────────
// Body: { athlete_id, lift, attempt_num, result: 1|0 }
router.post('/:id/result', (req, res) => {
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  if (!hasAccess(req.user.id, comp.id, 'any')) return res.status(403).json({ error: 'No access.' });
  const { athlete_id, lift, attempt_num, result } = req.body;
  if (![0, 1].includes(result)) return res.status(400).json({ error: 'Result must be 0 or 1.' });
  dbRun(
    'INSERT INTO comp_attempts (comp_id, athlete_id, lift, attempt_num, result, judged_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\')) ' +
    'ON CONFLICT(athlete_id, lift, attempt_num) DO UPDATE SET result = excluded.result, judged_at = excluded.judged_at',
    [comp.id, athlete_id, lift, attempt_num, result]
  );
  broadcastState(comp.id);
  res.json({ ok: true });
});

// ── Finish competition ────────────────────────────────────────────────────────
router.post('/:id/finish', (req, res) => {
  const comp = getCompOrFail(res, req.params.id);
  if (!comp) return;
  if (!hasAccess(req.user.id, comp.id, 'director')) return res.status(403).json({ error: 'Director access required.' });
  dbRun('UPDATE competitions SET status = ? WHERE id = ?', ['finished', comp.id]);
  broadcastState(comp.id);
  res.json({ ok: true });
});

// ── Public state (no auth) ────────────────────────────────────────────────────
router.get('/:id/public', (req, res) => {
  const comp = dbGet('SELECT * FROM competitions WHERE id = ?', [req.params.id]);
  if (!comp) return res.status(404).json({ error: 'Not found.' });
  const state = getFullState(comp.id);
  res.json(state);
});

// ── SSE stream (no auth, for TV) ──────────────────────────────────────────────
router.get('/:id/stream', (req, res) => {
  const compId = String(req.params.id);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Send initial state immediately
  const state = getFullState(compId);
  if (state) res.write(`data: ${JSON.stringify({ type: 'state', ...state })}\n\n`);

  // Register this client
  router._sseAdd(compId, res);

  // Heartbeat every 25s to keep connection alive
  const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch {} }, 25000);

  req.on('close', () => {
    clearInterval(hb);
    router._sseRemove(compId, res);
  });
});

// SSE client registry (managed by server.js)
const _clients = new Map();
router._sseAdd = (compId, res) => {
  if (!_clients.has(compId)) _clients.set(compId, new Set());
  _clients.get(compId).add(res);
};
router._sseRemove = (compId, res) => {
  _clients.get(compId)?.delete(res);
};
router._broadcast = (compId, data) => {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  _clients.get(String(compId))?.forEach(r => { try { r.write(msg); } catch {} });
};

// Wire internal broadcaster to SSE
_broadcast = router._broadcast;

module.exports = router;
