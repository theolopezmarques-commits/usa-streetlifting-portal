const express = require('express');
const { dbRun, dbGet, dbAll } = require('../db');
const router = express.Router();

// ── Question bank (answers never sent to client) ──────────────────────────────
const ALL_QUESTIONS = [
  // GENERAL RULES & JUDGING SYSTEM (0-7)
  { q: 'How many judges are positioned on the platform during a lift?', options: ['1','2','3','4'], answer: 2 },
  { q: 'Where are the three judges positioned?', options: ['All in front','One front, two sides','Two front, one side','One side, two back'], answer: 1 },
  { q: 'A lift is considered valid when:', options: ['At least one judge gives thumbs up','Majority vote is reached','All three judges mark it valid (with exceptions)','Head judge approves'], answer: 2 },
  { q: 'Which lifts have judging exceptions requiring fewer than three judges for depth?', options: ['Pull-ups and muscle-ups','Dips and squats','Pull-ups and squats','Muscle-ups and dips'], answer: 1 },
  { q: 'What signal indicates a valid lift?', options: ['Green card','Verbal "Good"','Thumbs up','Arm raised'], answer: 2 },
  { q: 'What signal indicates an invalid lift?', options: ['Thumbs down','Red light','Waving flag','Verbal "No rep"'], answer: 2 },
  { q: 'Are external recordings allowed on the platform?', options: ['Yes','Only by athletes','Only by coaches','No'], answer: 3 },
  { q: 'In case of doubt, judges may request:', options: ['Athlete replay','Crowd decision','Official video review','Coach appeal'], answer: 2 },
  // RING MUSCLE-UP (8-15)
  { q: 'What grip is permitted on ring muscle-ups?', options: ['Overhand only','False grip','Mixed grip','Hook grip'], answer: 1 },
  { q: 'What is the required start position for a ring muscle-up?', options: ['Bent elbows','Dead-hang with elbows locked','Partial hang','Swinging start'], answer: 1 },
  { q: 'How long does an athlete have to stabilize before "Box!" is called?', options: ['3 seconds','4 seconds','5 seconds','10 seconds'], answer: 2 },
  { q: 'A valid ring muscle-up requires:', options: ['Chest above rings','Chin above rings','Transition above rings with elbows locked','Hands above shoulders'], answer: 2 },
  { q: 'Passing over the rings one arm at a time is called:', options: ['Kipping','Chicken wing','Loss of control','False grip'], answer: 1 },
  { q: 'Excessive leg drive during the lift is:', options: ['Allowed','Minor fault','No-rep (kipping/kicking)','Warning only'], answer: 2 },
  { q: 'Failure to fully lock elbows at the top results in:', options: ['Warning','Restart','Lockout no-rep','Yellow card'], answer: 2 },
  { q: 'Which judge is primarily responsible for chicken wing calls?', options: ['Front judge','Side judges','Head judge','Spotter'], answer: 0 },
  // BAR MUSCLE-UP (16-21)
  { q: 'Is a semi-false grip allowed on bar muscle-ups?', options: ['No','Yes','Only for women','Only under 60 kg'], answer: 1 },
  { q: 'What invalidates a bar muscle-up due to grip?', options: ['Mixed grip','Thumb over bar','Wrists or forearms touching the bar','Overhand grip'], answer: 2 },
  { q: 'Bent arms at the start of a bar muscle-up result in:', options: ['Restart','Warning','No-rep','Valid if controlled'], answer: 2 },
  { q: 'A valid bar muscle-up requires:', options: ['Chest above bar','Chin above bar','Elbows locked at 180° above bar','Shoulder height above bar'], answer: 2 },
  { q: 'Losing control after clearing the bar results in:', options: ['Valid rep','Restart','No-rep','Judge discretion'], answer: 2 },
  { q: 'Getting over the bar one elbow at a time is called:', options: ['False grip','Chicken wing','Lockout error','Downward motion'], answer: 1 },
  // PULL-UPS (22-27)
  { q: 'What is the correct start position for pull-ups?', options: ['Slight bend in elbows','Full dead-hang with elbows locked','Chin at bar','Bent knees only'], answer: 1 },
  { q: 'A valid pull-up requires:', options: ['Chest touching bar','Chin clearly above bar','Nose above bar','Eyes above bar'], answer: 1 },
  { q: 'Kipping is:', options: ['Always allowed','Allowed if minor and no advantage','Never allowed','Only allowed in classic format'], answer: 1 },
  { q: 'Starting in scapular depression then quickly elevating after "Start!" is:', options: ['Valid technique','Stretch-shortening cycle no-rep','Loss of control','Warning'], answer: 1 },
  { q: 'Returning to dead-hang is required:', options: ['Before "Start!"','After chin clears bar','After rep before "Box!"','Not required'], answer: 2 },
  { q: 'Ignoring a judge\'s command results in:', options: ['Restart','Warning','Missed signal no-rep','Disqualification'], answer: 2 },
  // DIPS (28-33)
  { q: 'What is the correct start position for dips?', options: ['Bent arms','Arms locked, hips extended','Knees bent deeply','Partial support'], answer: 1 },
  { q: 'How deep must the athlete descend in a dip?', options: ['Elbows at 90°','Shoulder below elbow line','Chest below bars','Head below bars'], answer: 1 },
  { q: 'Belt line must be:', options: ['Above handles','Level with dip handles','Below knees','Hidden by clothing'], answer: 1 },
  { q: 'Clothing that hides depth results in:', options: ['Warning','Valid rep','No-rep','Restart'], answer: 2 },
  { q: 'Excessive arching or touching the box before "Box!" is:', options: ['Allowed','Loss of control no-rep','Warning only','Minor fault'], answer: 1 },
  { q: 'Using hips or legs for momentum is:', options: ['Always allowed','Allowed if no advantage','Automatic no-rep','Disqualification'], answer: 1 },
  // SQUATS (34-40)
  { q: 'When does the squat attempt begin?', options: ['Athlete unracks','Judge says "Platform ready"','Judge commands "Squat!"','Athlete bends knees'], answer: 2 },
  { q: 'Squat depth is valid when:', options: ['Thigh is parallel','Hip crease below knee line','Knees pass toes','Bar touches shoulders'], answer: 1 },
  { q: 'Clothing that hides the hip crease results in:', options: ['Warning','Valid rep','No-rep','Restart'], answer: 2 },
  { q: 'Failing to lock knees at the top is:', options: ['Warning','Restart','No-rep','Disqualification'], answer: 2 },
  { q: 'Double bouncing at the bottom is:', options: ['Allowed','Minor fault','Downward motion no-rep','Restart'], answer: 2 },
  { q: 'Stepping sideways during the squat is:', options: ['Allowed','Illegal foot movement no-rep','Warning','Valid if controlled'], answer: 1 },
  { q: 'Spotters touching the bar before the final command results in:', options: ['Valid rep','Warning','No-rep','Automatic disqualification'], answer: 2 },
  // SAFETY & DISCIPLINE (41-49)
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
  const hasCert2 = !!dbGet('SELECT id FROM certifications WHERE user_id = ? AND level = 2', [userId]);

  const access0 = isAdmin || hasPaidFor(userId, 0) || hasCert0;
  const access1 = isAdmin || hasPaidFor(userId, 1) || hasCert1;
  const access2 = isAdmin || hasPaidFor(userId, 2) || hasCert2;

  const level3app = dbGet(`SELECT status FROM level3_applications WHERE user_id = ?`, [userId]);
  const level3cert = !!dbGet(`SELECT id FROM certifications WHERE user_id = ? AND level = 3`, [userId]);

  const prog0 = getProgress(userId, 0);
  const prog1 = getProgress(userId, 1);
  const prog2 = getProgress(userId, 2);

  res.json({
    is_admin: isAdmin,
    access: { level0: access0, level1: access1, level2: access2 },
    progress: { level0: prog0, level1: prog1, level2: prog2 },
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
  const maxIndex = (VIDEO_COUNTS[level] || 4) - 1;
  if (typeof level !== 'number' || typeof videoIndex !== 'number' || videoIndex < 0 || videoIndex > maxIndex) {
    return res.status(400).json({ error: 'Invalid level or videoIndex.' });
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
  if (![0, 1, 2].includes(level)) return res.status(400).json({ error: 'Invalid level.' });

  const userId = req.user.id;
  const user = dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);
  if (!user?.is_admin && !hasPaidFor(userId, level)) {
    return res.status(403).json({ error: 'No access to this course.' });
  }

  const indices = LEVEL_QUESTION_INDICES[level] || [];
  const questions = indices.map((qi, i) => ({
    index: i,
    question: ALL_QUESTIONS[qi].q,
    options: ALL_QUESTIONS[qi].options,
  }));

  res.json({ questions, total: questions.length, pass_threshold: 80 });
});

// ── POST /api/course/submit-exam ──────────────────────────────────────────────
// answers: array of selected option indices (0-3), one per question in order
router.post('/submit-exam', (req, res) => {
  const { level, answers } = req.body;
  if (![0, 1, 2].includes(level) || !Array.isArray(answers)) {
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

  let correct = 0;
  answers.forEach((ans, i) => {
    if (ans === ALL_QUESTIONS[indices[i]].answer) correct++;
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
