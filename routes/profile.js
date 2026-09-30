const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { dbRun, dbGet } = require('../db');

const AVATAR_DIR = process.env.DB_PATH
  ? path.join(path.dirname(process.env.DB_PATH), 'avatars')
  : path.join(__dirname, '../public/avatars');

// The served extension must come from the mimetype multer accepted, never from the
// attacker-supplied filename, or an upload named "evil.html" with a spoofed
// Content-Type can end up served back as text/html from our own origin.
const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = MIME_EXTENSIONS[file.mimetype];
    if (!ext) return cb(new Error('Only JPEG, PNG, or WebP images allowed.'));
    cb(null, `user_${req.user.id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, or WebP images allowed.'));
  },
});

// Confirms the uploaded bytes actually are the image type multer accepted, since the
// mimetype itself is just a client-supplied header and can be spoofed.
function magicBytesMatchMimetype(filePath, mimetype) {
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(12);
  fs.readSync(fd, header, 0, 12, 0);
  fs.closeSync(fd);

  if (mimetype === 'image/jpeg') {
    return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return PNG_SIG.every((byte, i) => header[i] === byte);
  }
  if (mimetype === 'image/webp') {
    return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 12;

// -------- Get full profile --------
router.get('/', (req, res) => {
  const user = dbGet(
    'SELECT id, name, email, state, experience, phone, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

// -------- Update profile --------
router.put('/', (req, res) => {
  const { name, phone, state, experience } = req.body;

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Name must be 2-100 characters.' });
    }
  }
  if (phone !== undefined && phone !== '') {
    if (typeof phone !== 'string' || phone.trim().length > 20) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }
  }
  if (state !== undefined && typeof state !== 'string') {
    return res.status(400).json({ error: 'Invalid state.' });
  }
  if (state !== undefined && typeof state === 'string' && state.length > 100) {
    return res.status(400).json({ error: 'State must be under 100 characters.' });
  }
  if (experience !== undefined && typeof experience === 'string' && experience.length > 500) {
    return res.status(400).json({ error: 'Experience must be under 500 characters.' });
  }

  const current = dbGet('SELECT name FROM users WHERE id = ?', [req.user.id]);
  if (!current) return res.status(404).json({ error: 'User not found.' });

  dbRun(
    'UPDATE users SET name = ?, phone = ?, state = ?, experience = ? WHERE id = ?',
    [
      name !== undefined ? name.trim() : current.name,
      phone !== undefined ? phone.trim() : null,
      state !== undefined ? state.trim() : null,
      experience !== undefined ? experience.trim() : null,
      req.user.id,
    ]
  );

  // Issue a fresh JWT with updated name
  const updatedName = name !== undefined ? name.trim() : current.name;
  const token = jwt.sign(
    { id: req.user.id, email: req.user.email, name: updatedName },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ message: 'Profile updated.', user: { id: req.user.id, name: updatedName, email: req.user.email } });
});

// -------- Upload avatar --------
router.post('/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  if (!magicBytesMatchMimetype(req.file.path, req.file.mimetype)) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'File content does not match the declared image type.' });
  }

  // A previous avatar with a different extension (e.g. user_2.png before, user_2.webp
  // now) would otherwise stay on disk and remain servable alongside the new one.
  try {
    for (const existing of fs.readdirSync(AVATAR_DIR)) {
      if (existing !== req.file.filename && existing.startsWith(`user_${req.user.id}.`)) {
        fs.unlinkSync(path.join(AVATAR_DIR, existing));
      }
    }
  } catch {}

  const avatarPath = `/avatars/${req.file.filename}`;
  dbRun('UPDATE users SET avatar = ? WHERE id = ?', [avatarPath, req.user.id]);
  res.json({ avatar: avatarPath });
});

// -------- Change password --------
router.put('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required.' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    return res.status(400).json({ error: 'New password must be 8-128 characters.' });
  }

  const user = dbGet('SELECT password FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  dbRun('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);

  res.json({ message: 'Password changed successfully.' });
});

// -------- Delete account --------
router.delete('/', async (req, res) => {
  const userId = req.user.id;

  // Prevent admin from deleting their own account
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.is_admin) return res.status(403).json({ error: 'Admin accounts cannot be deleted.' });

  // Delete all related data
  dbRun('DELETE FROM video_progress WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM exam_attempts WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM certifications WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM payments WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM level3_applications WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM email_verifications WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM event_registrations WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM course_access WHERE user_id = ?', [userId]);
  dbRun('DELETE FROM login_attempts WHERE email = (SELECT email FROM users WHERE id = ?)', [userId]);
  dbRun('DELETE FROM users WHERE id = ?', [userId]);

  res.clearCookie('token');
  res.json({ success: true });
});

module.exports = router;
