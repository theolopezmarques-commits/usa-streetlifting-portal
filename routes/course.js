const express = require('express');
const { dbRun, dbGet, dbAll } = require('../db');
const router = express.Router();

function getAllQuestions() {
  const rows = dbAll('SELECT id, q, options, answer, type, answers FROM exam_questions ORDER BY id', []);
  return rows.map(r => ({
    id: r.id,
    q: r.q,
    options: JSON.parse(r.options),
    answer: r.answer,
    type: r.type || 'single',
    answers: r.answers ? JSON.parse(r.answers) : null,
  }));
}

// Question banks by exam_questions.id (answers stay server-side).
// Selected by ID, never by row position, so adding or removing a question
// cannot silently shift which questions a level asks.
const GENERAL_RULES_IDS  = [0, 1, 2, 3, 4, 5, 6, 7];
const RING_MU_SEED_IDS   = [8, 9, 10, 11, 12, 13, 14, 15];
const BAR_MU_SEED_IDS    = [16, 17, 18, 19, 20, 21];
const PULL_SEED_IDS      = [22, 23, 24, 25, 26, 27];
const DIP_SEED_IDS       = [28, 29, 30, 31, 32, 33];
const SQUAT_SEED_IDS     = [34, 35, 36, 37, 38, 39, 40];
// NOTE the hole at 41. An ambiguous squat question ("elbows resting on thighs")
// was deleted from the live database in 2026 and never replaced, so the safety
// block is 42-49, not 41-48. db.js seeds a fresh database with the same hole so
// that a rebuilt volume numbers these questions identically to production.
const SAFETY_COMP_IDS    = [42, 43, 44, 45, 46, 47, 48, 49];
const RING_MU_JUDGE_IDS  = [99, 100, 101, 102, 103];
const BAR_MU_JUDGE_IDS   = [104, 105, 106, 107, 108];
const PULL_JUDGE_IDS     = [109, 110, 111, 112, 113, 114];
// 125 is the dip SIDE JUDGE C question; it was added after 119 so it must be
// placed by hand here, otherwise ORDER BY id strands it after the squat block.
const DIP_JUDGE_IDS      = [115, 116, 125, 117, 118, 119];
const SQUAT_JUDGE_IDS    = [120, 121, 122, 123, 124];

// Level 0 is the Classic format certification: Pull and Dip only. Its course
// teaches Judging System, Pulls and Dips, so the exam must not ask muscle-up or
// squat questions — the muscle-up and squat seed and judge blocks are
// deliberately left out.
// Level 1 covers all four movements, so it uses every block.
const LEVEL_QUESTION_IDS = {
  0: [
    ...GENERAL_RULES_IDS,
    ...PULL_SEED_IDS,
    ...DIP_SEED_IDS,
    ...SAFETY_COMP_IDS,
    ...PULL_JUDGE_IDS,
    ...DIP_JUDGE_IDS,
  ],
  1: [
    ...GENERAL_RULES_IDS,
    ...RING_MU_SEED_IDS,
    ...BAR_MU_SEED_IDS,
    ...PULL_SEED_IDS,
    ...DIP_SEED_IDS,
    ...SQUAT_SEED_IDS,
    ...SAFETY_COMP_IDS,
    ...RING_MU_JUDGE_IDS,
    ...BAR_MU_JUDGE_IDS,
    ...PULL_JUDGE_IDS,
    ...DIP_JUDGE_IDS,
    ...SQUAT_JUDGE_IDS,
  ],
};
LEVEL_QUESTION_IDS[2] = LEVEL_QUESTION_IDS[1];

// The admin question editor groups by movement rather than by exam order, so it
// is defined here from the same id constants and served to the browser. It used
// to be a second hand-written copy of these ids in public/js/app.js.
const QUESTION_CATEGORIES = [
  { name: 'General Rules & Judging System', ids: GENERAL_RULES_IDS },
  { name: 'Safety & Competition Rules',     ids: SAFETY_COMP_IDS },
  { name: 'Ring Muscle-Up', ids: [...RING_MU_SEED_IDS, ...RING_MU_JUDGE_IDS] },
  { name: 'Bar Muscle-Up',  ids: [...BAR_MU_SEED_IDS,  ...BAR_MU_JUDGE_IDS] },
  { name: 'Pull-Ups',       ids: [...PULL_SEED_IDS,    ...PULL_JUDGE_IDS] },
  { name: 'Dips',           ids: [...DIP_SEED_IDS,     ...DIP_JUDGE_IDS] },
  { name: 'Squats',         ids: [...SQUAT_SEED_IDS,   ...SQUAT_JUDGE_IDS] },
];

// Whether a level also gets any question no block lists. Level 0 must never
// pick up strays: everything it does not list is muscle-up or squat content.
const LEVEL_APPEND_UNLISTED = { 0: false, 1: true, 2: true };

// Returns the ordered question list for a level. Both the GET and the POST
// handler go through this so the order the candidate answered in always matches
// the order the answers are graded in.
// Unknown IDs are skipped, and for the all-movement levels any question in the
// bank that no block lists is appended so a new question can never be dropped
// silently.
function getLevelQuestions(level) {
  const all = getAllQuestions();
  const ids = LEVEL_QUESTION_IDS[level];
  if (!ids) return all;
  const byId = new Map(all.map(q => [q.id, q]));
  const questions = ids.map(id => byId.get(id)).filter(Boolean);
  if (LEVEL_APPEND_UNLISTED[level]) {
    const listed = new Set(ids);
    all.forEach(q => { if (!listed.has(q.id)) questions.push(q); });
  }
  return questions;
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Strict level parser shared by every endpoint that takes a level, so the query
// string and the JSON body are validated identically. parseInt was too loose:
// it truncated, so '1.5', '1abc' and '01' all became level 1 on the GET while
// the POST rejected them, which left a candidate able to fetch an exam it could
// never submit.
function parseLevel(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : NaN;
  if (typeof raw !== 'string') return NaN;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return NaN;
  return Number(trimmed);
}

function hasPaidFor(userId, level) {
  const keyword = `Level ${level}`;
  const paid = !!dbGet(
    `SELECT id FROM payments WHERE user_id = ? AND status = 'paid' AND description LIKE ?`,
    [userId, `%${keyword}%`]
  );
  if (paid) return true;
  return !!dbGet(
    `SELECT id FROM course_access WHERE user_id = ? AND level = ?`,
    [userId, level]
  );
}

const VIDEO_COUNTS = { 0: 6, 1: 9, 2: 9 };

function getProgress(userId, level) {
  const videos = dbAll(
    `SELECT video_index FROM video_progress WHERE user_id = ? AND level = ?`,
    [userId, level]
  ).map(r => r.video_index);

  const total = VIDEO_COUNTS[level] || 4;

  const examRow = dbGet(
    `SELECT MAX(score) as best, COUNT(*) as attempts, MAX(passed) as passed
     FROM exam_attempts WHERE user_id = ? AND level = ?`,
    [userId, level]
  );

  const certRow = dbGet(
    `SELECT id, granted_at FROM certifications WHERE user_id = ? AND level = ?`,
    [userId, level]
  );

  return {
    videos_completed: videos,
    total_videos: total,
    all_videos_done: videos.length >= total,
    exam_passed: !!(examRow?.passed),
    exam_best_score: examRow?.best || 0,
    exam_attempts: examRow?.attempts || 0,
    certified: !!certRow,
    cert_granted_at: certRow?.granted_at || null,
  };
}

// ── GET /api/course/status ────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const userId = req.user.id;
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);
  const isAdmin = !!(user?.is_admin);

  const hasCert0 = !!dbGet('SELECT id FROM certifications WHERE user_id = ? AND level = 0', [userId]);
  const hasCert1 = !!dbGet('SELECT id FROM certifications WHERE user_id = ? AND level = 1', [userId]);

  const access0 = isAdmin || hasPaidFor(userId, 0) || hasCert0;
  const access1 = isAdmin || hasPaidFor(userId, 1) || hasCert1;

  const level3app = dbGet(`SELECT status FROM level3_applications WHERE user_id = ?`, [userId]);
  const level3cert = !!dbGet(`SELECT id FROM certifications WHERE user_id = ? AND level = 3`, [userId]);

  const prog0 = getProgress(userId, 0);
  const prog1 = getProgress(userId, 1);

  res.json({
    is_admin: isAdmin,
    access: { level0: access0, level1: access1 },
    progress: { level0: prog0, level1: prog1 },
    level3: {
      application_status: level3app?.status || null,
      certified: level3cert,
    },
    can_apply_level3: (prog0.certified || prog1.certified) && !level3app && !level3cert,
  });
});

// ── POST /api/course/video-complete ──────────────────────────────────────────
router.post('/video-complete', (req, res) => {
  const { videoIndex } = req.body;
  const level = parseLevel(req.body.level);
  if (![0, 1].includes(level)) return res.status(400).json({ error: 'Invalid level.' });
  const maxIndex = (VIDEO_COUNTS[level] || 4) - 1;
  if (typeof videoIndex !== 'number' || videoIndex < 0 || videoIndex > maxIndex) {
    return res.status(400).json({ error: 'Invalid videoIndex.' });
  }
  const userId = req.user.id;
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);

  // Verify access
  if (!user?.is_admin && !hasPaidFor(userId, level)) {
    return res.status(403).json({ error: 'No access to this course.' });
  }

  // Enforce sequential unlock — must have completed previous video first
  if (videoIndex > 0) {
    const prev = dbGet(
      `SELECT id FROM video_progress WHERE user_id = ? AND level = ? AND video_index = ?`,
      [userId, level, videoIndex - 1]
    );
    if (!prev && !user?.is_admin) {
      return res.status(403).json({ error: 'Complete the previous video first.' });
    }
  }

  dbRun(
    `INSERT OR IGNORE INTO video_progress (user_id, level, video_index) VALUES (?, ?, ?)`,
    [userId, level, videoIndex]
  );
  res.json({ success: true });
});

// ── POST /api/course/apply-level3 ────────────────────────────────────────────
router.post('/apply-level3', (req, res) => {
  const userId = req.user.id;
  const certified = dbGet(
    `SELECT id FROM certifications WHERE user_id = ? AND level IN (0, 1)`,
    [userId]
  );
  if (!certified) {
    return res.status(403).json({ error: 'You must hold a Level 0 or Level 1 certification first.' });
  }
  const existing = dbGet(`SELECT id, status FROM level3_applications WHERE user_id = ?`, [userId]);
  if (existing) {
    return res.status(409).json({ error: `Application already ${existing.status}.` });
  }
  dbRun(`INSERT INTO level3_applications (user_id) VALUES (?)`, [userId]);
  res.json({ success: true });
});

// ── GET /api/course/exam-questions?level=0 ────────────────────────────────────
// Returns questions WITHOUT correct answers
router.get('/exam-questions', (req, res) => {
  const level = parseLevel(req.query.level);
  if (![0, 1].includes(level)) return res.status(400).json({ error: 'Invalid level.' });

  const userId = req.user.id;
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);
  if (!user?.is_admin && !hasPaidFor(userId, level)) {
    return res.status(403).json({ error: 'No access to this course.' });
  }

  const levelQ = getLevelQuestions(level);
  const questions = levelQ.map((q, i) => ({
    index: i,
    question: q.q,
    options: q.options,
    type: q.type || 'single',
  }));

  res.json({ questions, total: questions.length, pass_threshold: 80 });
});

// ── POST /api/course/submit-exam ──────────────────────────────────────────────
// answers: array of selected option indices (0-3), one per question in order
router.post('/submit-exam', (req, res) => {
  const { answers } = req.body;
  const level = parseLevel(req.body.level);
  if (![0, 1].includes(level) || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'Invalid payload.' });
  }

  const userId = req.user.id;
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);
  if (!user?.is_admin && !hasPaidFor(userId, level)) {
    return res.status(403).json({ error: 'No access to this course.' });
  }

  const levelQ = getLevelQuestions(level);
  if (answers.length !== levelQ.length) {
    return res.status(400).json({ error: `Expected ${levelQ.length} answers.` });
  }

  let correct = 0;
  answers.forEach((ans, i) => {
    const q = levelQ[i];
    if (q.type === 'multi') {
      // A multi question with no stored key would otherwise match an empty
      // submission and hand every candidate a free point.
      if (!Array.isArray(q.answers) || q.answers.length === 0 || !Array.isArray(ans)) return;
      const selected = [...ans].sort((a, b) => a - b);
      const expected = [...q.answers].sort((a, b) => a - b);
      if (JSON.stringify(selected) === JSON.stringify(expected)) correct++;
    } else {
      if (ans === q.answer) correct++;
    }
  });

  const PASS_PCT = 80;
  const score   = Math.round((correct / levelQ.length) * 100);
  // Compared as integers so a displayed score rounded up from 79.5 cannot pass.
  const passed  = correct * 100 >= PASS_PCT * levelQ.length;

  dbRun(
    `INSERT INTO exam_attempts (user_id, level, score, passed) VALUES (?, ?, ?, ?)`,
    [userId, level, score, passed ? 1 : 0]
  );

  if (passed) {
    res.json({ passed: true, score, correct, total: levelQ.length });
  } else {
    // Never reveal correct answers on failure
    res.json({ passed: false, score, correct, total: levelQ.length });
  }
});

module.exports = router;
// Exported so the admin question editor can show real level membership instead
// of keeping its own copy of these lists, which is how they drifted apart.
module.exports.LEVEL_QUESTION_IDS = LEVEL_QUESTION_IDS;
module.exports.QUESTION_CATEGORIES = QUESTION_CATEGORIES;
