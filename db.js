const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'streetlifting.db');
const ALGO = 'aes-256-gcm';
let db;
let dbReady;

function getEncryptionKey() {
  const hex = process.env.DB_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('DB_ENCRYPTION_KEY must be a 32-byte hex string (64 chars).');
  }
  return Buffer.from(hex, 'hex');
}

function encryptBuffer(plain) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv (16) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptBuffer(data) {
  const key = getEncryptionKey();
  const iv = data.subarray(0, 16);
  const tag = data.subarray(16, 32);
  const ciphertext = data.subarray(32);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function ensureDb() {
  if (!dbReady) throw new Error('Database not initialised. Call initDb() first.');
  return db;
}

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const raw = fs.readFileSync(DB_PATH);
    // Try decrypting; fall back to plain for migration from unencrypted DB
    let buf;
    try {
      buf = decryptBuffer(raw);
    } catch {
      console.warn('DB file not encrypted – migrating to encrypted storage.');
      buf = raw;
    }
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      email       TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      phone       TEXT,
      state       TEXT,
      experience  TEXT,
      is_admin    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add is_admin to existing tables that predate this column
  try { db.run('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN instagram TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN position TEXT'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN comps_judged INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.run('ALTER TABLE users ADD COLUMN show_in_directory INTEGER NOT NULL DEFAULT 1'); } catch {}

  // Always ensure the director account has admin rights
  db.run(`UPDATE users SET is_admin = 1 WHERE email = 'usastreetlifting.judging@gmail.com'`);

  // Course: track which videos a user has fully watched
  db.run(`
    CREATE TABLE IF NOT EXISTS video_progress (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      level       INTEGER NOT NULL,
      video_index INTEGER NOT NULL,
      completed_at TEXT   NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, level, video_index),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Course: exam attempts — answers never returned to client on failure
  db.run(`
    CREATE TABLE IF NOT EXISTS exam_attempts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      level      INTEGER NOT NULL,
      score      INTEGER NOT NULL,
      passed     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Certifications granted by admin after oral exam
  db.run(`
    CREATE TABLE IF NOT EXISTS certifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      level      INTEGER NOT NULL,
      granted_at TEXT    NOT NULL DEFAULT (datetime('now')),
      granted_by INTEGER,
      UNIQUE(user_id, level),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Level 3 applications
  db.run(`
    CREATE TABLE IF NOT EXISTS level3_applications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL UNIQUE,
      status      TEXT    NOT NULL DEFAULT 'pending',
      applied_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      amount_cents    INTEGER NOT NULL,
      description     TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending',
      venmo_note      TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Key-value settings store (competitions_judged, states_covered, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('certified_judges', '7')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('competitions_judged', '14')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('states_covered', '6')`);

  // Email verification codes for new signups
  db.run(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL UNIQUE,
      code       TEXT    NOT NULL,
      expires_at TEXT    NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  // Add email_verified column to users if missing
  try { db.run('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0'); } catch {}
  // Mark existing users (admin + anyone already in the system) as verified
  db.run(`UPDATE users SET email_verified = 1 WHERE email_verified = 0`);

  // Competition events
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      event_date  TEXT    NOT NULL,
      location    TEXT    NOT NULL,
      description TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Judge registrations for events
  db.run(`
    CREATE TABLE IF NOT EXISTS event_registrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id   INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event_id, user_id),
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (user_id)  REFERENCES users(id)
    )
  `);

  // Admin-granted course access (bypass payment)
  db.run(`
    CREATE TABLE IF NOT EXISTS course_access (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      level      INTEGER NOT NULL,
      granted_by INTEGER,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, level),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Login-attempt tracking for brute-force protection
  db.run(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT    NOT NULL,
      success    INTEGER NOT NULL DEFAULT 0,
      ip         TEXT,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Competition history per judge
  db.run(`
    CREATE TABLE IF NOT EXISTS comp_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      comp_name  TEXT NOT NULL,
      comp_date  TEXT NOT NULL,
      location   TEXT,
      role       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Admin-managed chat rooms
  db.run(`
    CREATE TABLE IF NOT EXISTS chat_rooms (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id    TEXT NOT NULL UNIQUE,
      label      TEXT NOT NULL,
      scope      TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Default rooms
  db.run(`INSERT OR IGNORE INTO chat_rooms (room_id, label, scope) VALUES ('general', '🌎 General', 'all')`);

  // Group chat messages
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      room       TEXT NOT NULL DEFAULT 'general',
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  try { db.run(`ALTER TABLE messages ADD COLUMN room TEXT NOT NULL DEFAULT 'general'`); } catch {}

  // welcome_sent flag
  try { db.run('ALTER TABLE users ADD COLUMN welcome_sent INTEGER NOT NULL DEFAULT 0'); } catch {}

  // Security indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  db.run('CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, attempted_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempted_at)');

  dbReady = true;
  saveDb();
  console.log('Database initialised (encrypted at rest).');
}

function saveDb() {
  if (!db) return;
  const plain = Buffer.from(db.export());
  const encrypted = encryptBuffer(plain);
  fs.writeFileSync(DB_PATH, encrypted);
}

// Helper: run INSERT/UPDATE/DELETE and return { lastInsertRowid, changes }
function dbRun(sql, params = []) {
  const conn = ensureDb();
  conn.run(sql, params);
  const result = conn.exec('SELECT last_insert_rowid() AS id, changes() AS changes');
  saveDb();
  const row = result[0]?.values[0];
  return { lastInsertRowid: row ? row[0] : 0, changes: row ? row[1] : 0 };
}

// Helper: get one row
function dbGet(sql, params = []) {
  const conn = ensureDb();
  const stmt = conn.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    row = {};
    cols.forEach((c, i) => { row[c] = vals[i]; });
  }
  stmt.free();
  return row;
}

// Helper: get all rows
function dbAll(sql, params = []) {
  const conn = ensureDb();
  const stmt = conn.prepare(sql);
  stmt.bind(params);
  const cols = stmt.getColumnNames();
  const rows = [];
  while (stmt.step()) {
    const vals = stmt.get();
    const row = {};
    cols.forEach((c, i) => { row[c] = vals[i]; });
    rows.push(row);
  }
  stmt.free();
  return rows;
}

module.exports = { initDb, dbRun, dbGet, dbAll };
