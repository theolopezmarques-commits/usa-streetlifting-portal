const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'streetlifting.db');
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

  // Password reset tokens
  db.run(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      token      TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
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

  // Exam questions (editable via admin dashboard)
  db.run(`
    CREATE TABLE IF NOT EXISTS exam_questions (
      id      INTEGER PRIMARY KEY,
      q       TEXT    NOT NULL,
      options TEXT    NOT NULL,
      answer  INTEGER NOT NULL
    )
  `);
  try { db.run("ALTER TABLE exam_questions ADD COLUMN type TEXT NOT NULL DEFAULT 'single'"); } catch {}
  try { db.run('ALTER TABLE exam_questions ADD COLUMN answers TEXT'); } catch {}

  const _qCount = db.exec('SELECT COUNT(*) FROM exam_questions');
  const _isEmpty = !_qCount.length || _qCount[0].values[0][0] === 0;
  if (_isEmpty) {
    const _SEED = [
      { q: 'How many judges are positioned on the platform during a lift?', options: ['1','2','3','4'], answer: 2 },
      { q: 'Where are the three judges positioned?', options: ['All in front','One front, two sides','Two front, one side','One side, two back'], answer: 1 },
      { q: 'A lift is considered valid when:', options: ['At least one judge gives thumbs up','Majority vote is reached','All three judges mark it valid (with exceptions)','Head judge approves'], answer: 2 },
      { q: 'Which lifts have judging exceptions requiring fewer than three judges for depth?', options: ['Pull-ups and muscle-ups','Dips and squats','Pull-ups and squats','Muscle-ups and dips'], answer: 1 },
      { q: 'What signal indicates a valid lift?', options: ['Green card','Verbal "Good"','Thumbs up','Arm raised'], answer: 2 },
      { q: 'What signal indicates an invalid lift?', options: ['Thumbs down','Red light','Waving flag','Verbal "No rep"'], answer: 2 },
      { q: 'Are external recordings allowed on the platform?', options: ['Yes','Only by athletes','Only by coaches','No'], answer: 3 },
      { q: 'In case of doubt, judges may request:', options: ['Athlete replay','Crowd decision','Official video review','Coach appeal'], answer: 2 },
      { q: 'What grip is permitted on ring muscle-ups?', options: ['Overhand only','False grip','Mixed grip','Hook grip'], answer: 1 },
      { q: 'What is the required start position for a ring muscle-up?', options: ['Bent elbows','Dead-hang with elbows locked','Partial hang','Swinging start'], answer: 1 },
      { q: 'How long does an athlete have to stabilize before "Box!" is called?', options: ['3 seconds','4 seconds','5 seconds','10 seconds'], answer: 2 },
      { q: 'A valid ring muscle-up requires:', options: ['Chest above rings','Chin above rings','Transition above rings with elbows locked','Hands above shoulders'], answer: 2 },
      { q: 'Passing over the rings one arm at a time is called:', options: ['Kipping','Chicken wing','Loss of control','False grip'], answer: 1 },
      { q: 'Excessive leg drive during the lift is:', options: ['Allowed','Minor fault','No-rep (kipping/kicking)','Warning only'], answer: 2 },
      { q: 'Failure to fully lock elbows at the top results in:', options: ['Warning','Restart','Lockout no-rep','Yellow card'], answer: 2 },
      { q: 'Which judge is primarily responsible for chicken wing calls?', options: ['Front judge','Side judges','Head judge','Spotter'], answer: 0 },
      { q: 'Is a semi-false grip allowed on bar muscle-ups?', options: ['No','Yes','Only for women','Only under 60 kg'], answer: 1 },
      { q: 'What invalidates a bar muscle-up due to grip?', options: ['Mixed grip','Thumb over bar','Wrists or forearms touching the bar','Overhand grip'], answer: 2 },
      { q: 'Bent arms at the start of a bar muscle-up result in:', options: ['Restart','Warning','No-rep','Valid if controlled'], answer: 2 },
      { q: 'A valid bar muscle-up requires:', options: ['Chest above bar','Chin above bar','Elbows locked at 180° above bar','Shoulder height above bar'], answer: 2 },
      { q: 'Losing control after clearing the bar results in:', options: ['Valid rep','Restart','No-rep','Judge discretion'], answer: 2 },
      { q: 'Getting over the bar one elbow at a time is called:', options: ['False grip','Chicken wing','Lockout error','Downward motion'], answer: 1 },
      { q: 'What is the correct start position for pull-ups?', options: ['Slight bend in elbows','Full dead-hang with elbows locked','Chin at bar','Bent knees only'], answer: 1 },
      { q: 'A valid pull-up requires:', options: ['Chest touching bar','Chin clearly above bar','Nose above bar','Eyes above bar'], answer: 1 },
      { q: 'Kipping is:', options: ['Always allowed','Allowed if minor and no advantage','Never allowed','Only allowed in classic format'], answer: 1 },
      { q: 'Starting in scapular depression then quickly elevating after "Start!" is:', options: ['Valid technique','Stretch-shortening cycle no-rep','Loss of control','Warning'], answer: 1 },
      { q: 'Returning to dead-hang is required:', options: ['Before "Start!"','After chin clears bar','After rep before "Box!"','Not required'], answer: 2 },
      { q: "Ignoring a judge's command results in:", options: ['Restart','Warning','Missed signal no-rep','Disqualification'], answer: 2 },
      { q: 'What is the correct start position for dips?', options: ['Bent arms','Arms locked, hips extended','Knees bent deeply','Partial support'], answer: 1 },
      { q: 'How deep must the athlete descend in a dip?', options: ['Elbows at 90°','Shoulder below elbow line','Chest below bars','Head below bars'], answer: 1 },
      { q: 'Belt line must be:', options: ['Above handles','Level with dip handles','Below knees','Hidden by clothing'], answer: 1 },
      { q: 'Clothing that hides depth results in:', options: ['Warning','Valid rep','No-rep','Restart'], answer: 2 },
      { q: 'Excessive arching or touching the box before "Box!" is:', options: ['Allowed','Loss of control no-rep','Warning only','Minor fault'], answer: 1 },
      { q: 'Using hips or legs for momentum is:', options: ['Always allowed','Allowed if no advantage','Automatic no-rep','Disqualification'], answer: 1 },
      { q: 'When does the squat attempt begin?', options: ['Athlete unracks','Judge says "Platform ready"','Judge commands "Squat!"','Athlete bends knees'], answer: 2 },
      { q: 'Squat depth is valid when:', options: ['Thigh is parallel','Hip crease below knee line','Knees pass toes','Bar touches shoulders'], answer: 1 },
      { q: 'Clothing that hides the hip crease results in:', options: ['Warning','Valid rep','No-rep','Restart'], answer: 2 },
      { q: 'Failing to lock knees at the top is:', options: ['Warning','Restart','No-rep','Disqualification'], answer: 2 },
      { q: 'Double bouncing at the bottom is:', options: ['Allowed','Minor fault','Downward motion no-rep','Restart'], answer: 2 },
      { q: 'Stepping sideways during the squat is:', options: ['Allowed','Illegal foot movement no-rep','Warning','Valid if controlled'], answer: 1 },
      { q: 'Spotters touching the bar before the final command results in:', options: ['Valid rep','Warning','No-rep','Automatic disqualification'], answer: 2 },
      { q: 'Resting elbows on thighs during a squat is:', options: ['Allowed','Allowed if light','Support no-rep','Warning only'], answer: 2 },
      { q: 'Dropping the barbell intentionally results in:', options: ['Warning','Restart','Immediate disqualification + 2-year ban','No-rep only'], answer: 2 },
      { q: 'How many attempts does an athlete have per lift?', options: ['1','2','3','Unlimited'], answer: 2 },
      { q: 'If an athlete has zero valid reps in one lift:', options: ['Lowest score recorded','Lift skipped','Disqualified from competition','Warning issued'], answer: 2 },
      { q: 'How many valid reps are required per lift to stay in competition?', options: ['0','1','2','3'], answer: 1 },
      { q: 'Standard format includes:', options: ['Pull-up and dip only','Muscle-up only','All four lifts','Squat only'], answer: 2 },
      { q: 'Classic format includes:', options: ['All lifts','Muscle-up and squat','Pull-up and dip','Squat only'], answer: 2 },
      { q: 'Judge decisions are:', options: ['Reviewable by coaches','Reviewable by audience','Final and unequivocal','Advisory only'], answer: 2 },
      { q: 'The primary goal of judging is to ensure:', options: ['Fast competitions','Athlete enjoyment','Fair and consistent results','Record-breaking lifts'], answer: 2 },
    ];
    _SEED.forEach((q, i) => {
      db.run('INSERT INTO exam_questions (id, q, options, answer) VALUES (?, ?, ?, ?)',
        [i, q.q, JSON.stringify(q.options), q.answer]);
    });
  }

  // Seed judge-responsibility and card-color questions (indices 50-74); INSERT OR IGNORE so safe on re-run
  const _JUDGE_Q = [
    // Ring Muscle Up (50-54)
    { id: 50, q: 'For a ring muscle-up, what is the front judge responsible for? (Select all that apply)', options: ['Detecting a chicken wing (one ring at a time)','Giving "Go!" and "Box!" signals','Equipment check and start position','Verifying arm lockout at the top'], type: 'multi', answers: [0,1,2] },
    { id: 51, q: 'For a ring muscle-up, what are the side judges (B & C) responsible for? (Select all that apply)', options: ['Verifying arm lockout (full elbow extension)','Detecting kipping or excessive leg drive','Detecting chicken wing','Checking for downward motion during the concentric phase'], type: 'multi', answers: [0,1,3] },
    { id: 52, q: 'What card color is shown for a chicken wing in a ring muscle-up?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 0 },
    { id: 53, q: 'What card color is shown for kipping/kicking in a ring muscle-up?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 2 },
    { id: 54, q: 'What card color is shown for incomplete lockout (elbows not fully extended at top) in a ring muscle-up?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 3 },
    // Bar Muscle Up (55-59)
    { id: 55, q: 'For a bar muscle-up, what is the front judge responsible for? (Select all that apply)', options: ['Detecting a chicken wing (one elbow at a time)','Giving "Go!" and "Box!" signals','Equipment check and start position','Verifying arm lockout at the top'], type: 'multi', answers: [0,1,2] },
    { id: 56, q: 'For a bar muscle-up, what are the side judges (B & C) responsible for? (Select all that apply)', options: ['Full arm lockout (180° elbow extension)','Kipping or excessive leg drive','Grip violation (wrist or forearm touching bar)','Chicken wing detection'], type: 'multi', answers: [0,1,2] },
    { id: 57, q: 'What card color is shown for a chicken wing in a bar muscle-up?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 0 },
    { id: 58, q: 'What card color is shown for kipping/kicking in a bar muscle-up?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 2 },
    { id: 59, q: 'What card color is shown for a grip violation (wrist/forearm touching bar) in a bar muscle-up?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 3 },
    // Pull (60-64)
    { id: 60, q: 'For a pull (pull-up/chin-up), what is the front judge responsible for? (Select all that apply)', options: ['Giving "Go!" and "Box!" signals','Equipment check and start position','Verifying chin height above the bar','Detecting kipping or kicking'], type: 'multi', answers: [0,1] },
    { id: 61, q: 'For a pull, what are the side judges (B & C) responsible for? (Select all that apply)', options: ['Verifying chin is clearly above the bar','Detecting kipping or excessive leg drive','Giving the start signal','Checking for a full dead-hang start position'], type: 'multi', answers: [0,1,3] },
    { id: 62, q: 'What card color is shown for invalid chin height in a pull?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 0 },
    { id: 63, q: 'What card color is shown for kicking/kipping in a pull?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 2 },
    { id: 64, q: 'What card color is shown for downward motion before chin clears the bar in a pull?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 3 },
    // Dip (65-69)
    { id: 65, q: 'For a dip, what is the front judge responsible for? (Select all that apply)', options: ['Giving "Go!" and "Box!" signals','Equipment check and start position','Verifying shoulder depth below the elbow line','Detecting kipping or leg drive'], type: 'multi', answers: [0,1] },
    { id: 66, q: 'For a dip, what are the side judges (B & C) responsible for? (Select all that apply)', options: ['Verifying shoulder depth below the elbow line','Detecting kipping or loss of control','Giving the start signal','Checking full arm extension at start and finish'], type: 'multi', answers: [0,1,3] },
    { id: 67, q: 'What card color is shown for invalid depth (shoulder not below elbow line) in a dip?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 0 },
    { id: 68, q: 'What card color is shown for kipping/kicking in a dip?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 2 },
    { id: 69, q: 'What card color is shown for downward motion in a dip?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 3 },
    // Squat (70-74)
    { id: 70, q: 'For a squat, what is the front judge responsible for? (Select all that apply)', options: ['Giving "Squat!" and "Rack!" commands','Equipment check and start position','Verifying hip crease depth below knee line','Detecting illegal foot movement'], type: 'multi', answers: [0,1] },
    { id: 71, q: 'For a squat, what are the side judges (B & C) responsible for? (Select all that apply)', options: ['Verifying hip crease depth below knee line','Detecting downward motion or double bounce','Giving the "Squat!" command','Checking for illegal foot movement'], type: 'multi', answers: [0,1,3] },
    { id: 72, q: 'What card color is shown for invalid depth (hip crease not below knee line) in a squat?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 0 },
    { id: 73, q: 'What card color is shown for support (elbows resting on thighs) in a squat?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 2 },
    { id: 74, q: 'What card color is shown for contact by a spotter during a squat?', options: ['Red','Black','Yellow','Blue'], type: 'single', answer: 3 },
  ];
  _JUDGE_Q.forEach(q => {
    db.run(
      'INSERT OR IGNORE INTO exam_questions (id, q, options, type, answers, answer) VALUES (?, ?, ?, ?, ?, ?)',
      [q.id, q.q, JSON.stringify(q.options), q.type,
       q.type === 'multi' ? JSON.stringify(q.answers) : null,
       q.type === 'single' ? q.answer : -1]
    );
  });

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
