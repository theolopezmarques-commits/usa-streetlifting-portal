const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const crypto = require('crypto');
const { dbRun, dbGet } = require('../db');
const { sendEmail, verificationEmail, welcomeEmail } = require('../email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = '7d';

const MAX_FAILED_ATTEMPTS = 5;
const MAX_FAILED_ATTEMPTS_IP = 15;
const LOCKOUT_MINUTES = 15;

function recordAttempt(email, ip, success) {
  dbRun(
    'INSERT INTO login_attempts (email, success, ip) VALUES (?, ?, ?)',
    [email.toLowerCase().trim(), success ? 1 : 0, ip]
  );
}

function isLockedOut(email, ip) {
  const cutoff = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString();
  const byEmail = dbGet(
    'SELECT COUNT(*) AS cnt FROM login_attempts WHERE email = ? AND success = 0 AND attempted_at > ?',
    [email.toLowerCase().trim(), cutoff]
  );
  const byIp = dbGet(
    'SELECT COUNT(*) AS cnt FROM login_attempts WHERE ip = ? AND success = 0 AND attempted_at > ?',
    [ip, cutoff]
  );
  return (byEmail?.cnt ?? 0) >= MAX_FAILED_ATTEMPTS || (byIp?.cnt ?? 0) >= MAX_FAILED_ATTEMPTS_IP;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// -------- Register --------
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, state, experience } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required.' });
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100)
      return res.status(400).json({ error: 'Name must be 2-100 characters.' });
    if (!validator.isEmail(email))
      return res.status(400).json({ error: 'Invalid email address.' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 128)
      return res.status(400).json({ error: 'Password must be 8-128 characters.' });
    if (state !== undefined && typeof state === 'string' && state.length > 100)
      return res.status(400).json({ error: 'State must be under 100 characters.' });
    if (experience !== undefined && typeof experience === 'string' && experience.length > 500)
      return res.status(400).json({ error: 'Experience must be under 500 characters.' });

    const existing = dbGet('SELECT id, email_verified FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) {
      if (!existing.email_verified) {
        const token = generateToken();
        const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
        dbRun(`INSERT OR REPLACE INTO email_verifications (user_id, code, expires_at) VALUES (?, ?, ?)`,
          [existing.id, token, expires]);
        const link = `${process.env.BASE_URL}/?verify=${token}`;
        console.log(`[DEV] Verify link for ${email}: ${link}`);
        await sendEmail({
          to: email.toLowerCase().trim(),
          subject: 'Verify your USASL Judge Portal account',
          html: verificationEmail(name.trim(), link),
        });
        return res.status(200).json({ pending_verification: true });
      }
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const result = dbRun(
      'INSERT INTO users (name, email, password, state, experience, email_verified) VALUES (?, ?, ?, ?, ?, 0)',
      [name.trim(), email.toLowerCase().trim(), hashedPassword, state ? state.trim() : null, experience ? experience.trim() : null]
    );
    const userId = result.lastInsertRowid;

    const token = generateToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    dbRun(`INSERT OR REPLACE INTO email_verifications (user_id, code, expires_at) VALUES (?, ?, ?)`,
      [userId, token, expires]);
    const link = `${process.env.BASE_URL}/?verify=${token}`;
    console.log(`[DEV] Verify link for ${email}: ${link}`);
    await sendEmail({
      to: email.toLowerCase().trim(),
      subject: 'Verify your USASL Judge Portal account',
      html: verificationEmail(name.trim(), link),
    });

    res.status(201).json({ pending_verification: true });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// -------- Verify email (token from link) --------
router.get('/verify-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required.' });

  const row = dbGet(`SELECT * FROM email_verifications WHERE code = ?`, [token]);
  if (!row) return res.status(400).json({ error: 'Invalid or already used verification link.' });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Link expired. Please register again.' });

  dbRun(`UPDATE users SET email_verified = 1 WHERE id = ?`, [row.user_id]);
  dbRun(`DELETE FROM email_verifications WHERE user_id = ?`, [row.user_id]);

  const user = dbGet('SELECT id, name, email, is_admin FROM users WHERE id = ?', [row.user_id]);
  const jwtToken = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

  res.cookie('token', jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ message: 'Email verified.', user: { id: user.id, name: user.name, email: user.email, is_admin: user.is_admin } });
});

// -------- Login --------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const clientIp = req.ip;
    if (isLockedOut(email, clientIp))
      return res.status(429).json({ error: 'Too many failed attempts. Please try again later.' });

    const user = dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      recordAttempt(email, clientIp, false);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      recordAttempt(email, clientIp, false);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Block unverified users
    if (!user.email_verified) {
      // Re-send verification link
      const token = generateToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      dbRun(`INSERT OR REPLACE INTO email_verifications (user_id, code, expires_at) VALUES (?, ?, ?)`,
        [user.id, token, expires]);
      const link = `${process.env.BASE_URL}/?verify=${token}`;
      console.log(`[DEV] Verify link for ${user.email}: ${link}`);
      await sendEmail({
        to: user.email,
        subject: 'Verify your USASL Judge Portal account',
        html: verificationEmail(user.name, link),
      });
      return res.status(403).json({ pending_verification: true, error: 'Please verify your email first. A new link has been sent.' });
    }

    recordAttempt(email, clientIp, true);

    // Send welcome email on first ever login
    if (!user.welcome_sent) {
      dbRun('UPDATE users SET welcome_sent = 1 WHERE id = ?', [user.id]);
      sendEmail({
        to: user.email,
        subject: 'Welcome to the USASL Judge Portal!',
        html: welcomeEmail(user.name),
      }).catch(() => {});
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ message: 'Logged in.', user: { id: user.id, name: user.name, email: user.email, is_admin: user.is_admin } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// -------- Logout --------
router.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out.' });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });
  const user = dbGet('SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
  // Always respond ok to avoid user enumeration
  if (!user) return res.json({ ok: true });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  dbRun('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
  dbRun('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)', [user.id, token, expires]);

  const baseUrl = process.env.BASE_URL || 'https://usastreetliftingjudging.org';
  const link = `${baseUrl}/?reset_token=${token}`;

  await sendEmail({
    to: user.email,
    subject: 'Reset your USASL Judge Portal password',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0a0a;padding:32px;border-radius:8px;color:#f0f0f0;">
        <img src="https://usastreetlifting.org/wp-content/uploads/2024/08/cropped-USA-Streetlifting-Transparent-File-PNG-1.png" alt="USA Streetlifting" style="height:48px;margin-bottom:24px;">
        <h2 style="color:#c0392b;">Reset your password</h2>
        <p>Hi ${user.name},</p>
        <p>Click below to reset your password. This link expires in <strong>1 hour</strong>.</p>
        <div style="text-align:center;padding:24px 0;">
          <a href="${link}" style="display:inline-block;padding:14px 32px;background:#c0392b;color:#fff;border-radius:6px;text-decoration:none;font-size:1rem;font-weight:bold;">Reset Password</a>
        </div>
        <p style="color:#888;font-size:.85rem;">If you didn't request this, ignore this email — your password won't change.</p>
        <p style="color:#555;font-size:.75rem;word-break:break-all;">Or copy: ${link}</p>
      </div>`
  });
  res.json({ ok: true });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const row = dbGet(
      `SELECT pr.user_id, pr.expires_at, pr.used FROM password_resets pr WHERE pr.token = ?`,
      [token]
    );
    if (!row) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    if (row.used) return res.status(400).json({ error: 'This reset link has already been used.' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Reset link has expired.' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    dbRun('UPDATE users SET password = ? WHERE id = ?', [hash, row.user_id]);
    dbRun('UPDATE password_resets SET used = 1 WHERE token = ?', [token]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
