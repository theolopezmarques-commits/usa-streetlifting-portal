const express = require('express');
const { dbRun, dbGet, dbAll } = require('../db');
const router = express.Router();

function getAllQuestions() {
  const rows = dbAll('SELECT id, q, options, answer FROM exam_questions ORDER BY id', []);
  return rows.map(r => ({ q: r.q, options: JSON.parse(r.options), answer: r.answer }));
}

// Question indices per level (answers kept server-side)
const LEVEL_QUESTION_INDICES = {
  0: [0,1,2,3,4,5,6,7, 22,23,24,25,26,27, 28,29,30,31,32,33, 41,42,43,44,45,46,47,48,49],
  1: Array.from({ length: 50 }, (_, i) => i),
};
LEVEL_QUESTION_INDICES[2] = LEVEL_QUESTION_INDICES[1];

// ── helpers ──────────────────────────────────────────────────────────────────

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
  const { level, videoIndex } = req.body;
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
  const level = parseInt(req.query.level);
  if (![0, 1].includes(level)) return res.status(400).json({ error: 'Invalid level.' });

  const userId = req.user.id;
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);
  if (!user?.is_admin && !hasPaidFor(userId, level)) {
    return res.status(403).json({ error: 'No access to this course.' });
  }

  const indices = LEVEL_QUESTION_INDICES[level] || [];
  const allQ = getAllQuestions();
  const questions = indices.map((qi, i) => ({
    index: i,
    question: allQ[qi].q,
    options: allQ[qi].options,
  }));

  res.json({ questions, total: questions.length, pass_threshold: 80 });
});

// ── POST /api/course/submit-exam ──────────────────────────────────────────────
// answers: array of selected option indices (0-3), one per question in order
router.post('/submit-exam', (req, res) => {
  const { level, answers } = req.body;
  if (![0, 1].includes(level) || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'Invalid payload.' });
  }

  const userId = req.user.id;
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);
  if (!user?.is_admin && !hasPaidFor(userId, level)) {
    return res.status(403).json({ error: 'No access to this course.' });
  }

  const indices = LEVEL_QUESTION_INDICES[level] || [];
  if (answers.length !== indices.length) {
    return res.status(400).json({ error: `Expected ${indices.length} answers.` });
  }

  const allQ = getAllQuestions();
  let correct = 0;
  answers.forEach((ans, i) => {
    if (ans === allQ[indices[i]].answer) correct++;
  });

  const score   = Math.round((correct / indices.length) * 100);
  const passed  = score >= 80;

  dbRun(
    `INSERT INTO exam_attempts (user_id, level, score, passed) VALUES (?, ?, ?, ?)`,
    [userId, level, score, passed ? 1 : 0]
  );

  if (passed) {
    res.json({ passed: true, score, correct, total: indices.length });
  } else {
    // Never reveal correct answers on failure
    res.json({ passed: false, score, correct, total: indices.length });
  }
});

module.exports = router;
