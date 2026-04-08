const express = require('express');
const { dbRun, dbGet, dbAll } = require('../db');
const router = express.Router();

const MAX_MSG_LEN = 500;
const VALID_ROOM_ID = /^[a-z0-9_-]{1,40}$/;

// Middleware: must be a certified judge (or admin)
function requireCertified(req, res, next) {
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  if (user?.is_admin) return next();
  const cert = dbGet('SELECT id FROM certifications WHERE user_id = ?', [req.user.id]);
  if (!cert) return res.status(403).json({ error: 'Chat is available to certified judges only.' });
  next();
}

function canAccessRoom(userId, roomId) {
  const room = dbGet('SELECT * FROM chat_rooms WHERE room_id = ?', [roomId]);
  if (!room) return false;
  const user = dbGet('SELECT state, is_admin FROM users WHERE id = ?', [userId]);
  if (user?.is_admin) return true;
  if (room.scope === 'all') return true;
  if (room.scope === 'admin') return false;
  // scope = state name
  return user?.state === room.scope;
}

// GET /api/chat/rooms
router.get('/rooms', requireCertified, (req, res) => {
  const user = dbGet('SELECT state, is_admin FROM users WHERE id = ?', [req.user.id]);
  const allRooms = dbAll('SELECT * FROM chat_rooms ORDER BY id ASC', []);
  const visible = allRooms.filter(r => {
    if (user?.is_admin) return true;
    if (r.scope === 'admin') return false;
    if (r.scope === 'all') return true;
    return user?.state === r.scope;
  });
  res.json({ rooms: visible });
});

// GET /api/chat/history?room=general
router.get('/history', requireCertified, (req, res) => {
  const room = req.query.room || 'general';
  if (!VALID_ROOM_ID.test(room)) return res.status(400).json({ error: 'Invalid room.' });
  if (!canAccessRoom(req.user.id, room)) return res.status(403).json({ error: 'No access to this room.' });

  const messages = dbAll(
    `SELECT m.id, m.content, m.created_at, m.room,
            u.id AS user_id, u.name, u.avatar, u.is_admin, u.state
     FROM messages m JOIN users u ON u.id = m.user_id
     WHERE m.room = ? ORDER BY m.id DESC LIMIT 100`,
    [room]
  ).reverse();
  res.json({ messages });
});

// GET /api/chat/messages?room=general&since=<id>
router.get('/messages', requireCertified, (req, res) => {
  const room = req.query.room || 'general';
  const since = parseInt(req.query.since) || 0;
  if (!VALID_ROOM_ID.test(room)) return res.status(400).json({ error: 'Invalid room.' });
  if (!canAccessRoom(req.user.id, room)) return res.status(403).json({ error: 'No access to this room.' });

  const messages = dbAll(
    `SELECT m.id, m.content, m.created_at, m.room,
            u.id AS user_id, u.name, u.avatar, u.is_admin, u.state
     FROM messages m JOIN users u ON u.id = m.user_id
     WHERE m.room = ? AND m.id > ? ORDER BY m.id ASC LIMIT 50`,
    [room, since]
  );
  res.json({ messages });
});

// POST /api/chat/send
router.post('/send', requireCertified, (req, res) => {
  const { content, room = 'general' } = req.body;
  if (!content || typeof content !== 'string' || !content.trim())
    return res.status(400).json({ error: 'Message cannot be empty.' });
  if (content.trim().length > MAX_MSG_LEN)
    return res.status(400).json({ error: `Max ${MAX_MSG_LEN} characters.` });
  if (!VALID_ROOM_ID.test(room)) return res.status(400).json({ error: 'Invalid room.' });
  if (!canAccessRoom(req.user.id, room)) return res.status(403).json({ error: 'No access to this room.' });

  const result = dbRun(
    'INSERT INTO messages (user_id, room, content) VALUES (?, ?, ?)',
    [req.user.id, room, content.trim()]
  );
  const msg = dbGet(
    `SELECT m.id, m.content, m.created_at, m.room,
            u.id AS user_id, u.name, u.avatar, u.is_admin, u.state
     FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`,
    [result.lastInsertRowid]
  );
  res.json({ message: msg });
});

// GET /api/chat/unread?since=<id> — count of new messages since last seen
router.get('/unread', requireCertified, (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const user = dbGet('SELECT state, is_admin FROM users WHERE id = ?', [req.user.id]);
  const allRooms = dbAll('SELECT * FROM chat_rooms ORDER BY id ASC', []);
  const visible = allRooms.filter(r => {
    if (user?.is_admin) return true;
    if (r.scope === 'admin') return false;
    if (r.scope === 'all') return true;
    return user?.state === r.scope;
  });
  let count = 0;
  for (const room of visible) {
    const row = dbGet(
      `SELECT COUNT(*) AS cnt FROM messages WHERE room = ? AND id > ? AND user_id != ?`,
      [room.room_id, since, req.user.id]
    );
    count += row?.cnt || 0;
  }
  res.json({ unread: count });
});

// DELETE /api/chat/messages/:id — admin only
router.delete('/messages/:id', (req, res) => {
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  if (!user?.is_admin) return res.status(403).json({ error: 'Admin only.' });
  dbRun('DELETE FROM messages WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── Admin room management ──────────────────────────────────────────────────────

// GET /api/chat/admin-rooms
router.get('/admin-rooms', (req, res) => {
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  if (!user?.is_admin) return res.status(403).json({ error: 'Admin only.' });
  const rooms = dbAll('SELECT * FROM chat_rooms ORDER BY id ASC', []);
  res.json({ rooms });
});

// POST /api/chat/admin-rooms — create room
router.post('/admin-rooms', (req, res) => {
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  if (!user?.is_admin) return res.status(403).json({ error: 'Admin only.' });
  const { room_id, label, scope } = req.body;
  if (!room_id || !label) return res.status(400).json({ error: 'room_id and label required.' });
  if (!VALID_ROOM_ID.test(room_id)) return res.status(400).json({ error: 'room_id must be lowercase letters, numbers, hyphens, underscores (max 40 chars).' });
  const existing = dbGet('SELECT id FROM chat_rooms WHERE room_id = ?', [room_id]);
  if (existing) return res.status(409).json({ error: 'A room with that ID already exists.' });
  dbRun('INSERT INTO chat_rooms (room_id, label, scope) VALUES (?, ?, ?)', [room_id, label.trim(), scope || 'all']);
  res.json({ success: true });
});

// DELETE /api/chat/admin-rooms/:roomId — delete room + all its messages
router.delete('/admin-rooms/:roomId', (req, res) => {
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  if (!user?.is_admin) return res.status(403).json({ error: 'Admin only.' });
  if (req.params.roomId === 'general') return res.status(400).json({ error: 'Cannot delete the General room.' });
  dbRun('DELETE FROM messages WHERE room = ?', [req.params.roomId]);
  dbRun('DELETE FROM chat_rooms WHERE room_id = ?', [req.params.roomId]);
  res.json({ success: true });
});

module.exports = router;
