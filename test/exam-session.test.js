'use strict';

// Server-side exam sessions close the answer-oracle hole: POST /submit-exam
// used to grade whatever answer array a client posted against a freshly
// recomputed question list, leaked the exact `correct` count on failure, had
// no attempt limit, and never checked that the candidate had watched the
// course videos. This suite covers the fix:
//
//   - GET /exam-questions opens a session (question order shuffled per
//     session) and returns its session_id; POST /submit-exam requires that
//     session_id and grades against the session's own stored order.
//   - a session is single-use, scoped to the user and level it was opened
//     for, and expires.
//   - at most 3 graded attempts per level per rolling 24 hours (admins
//     exempt).
//   - both endpoints require all course videos to be marked complete first
//     (admins exempt).
//   - a failing submission reveals only { passed: false, total }.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { initTestDb, insertUser, mountApp, ROOT } = require('./helpers/boot');

let ctx;
let course;
const apps = []; // every mounted app, closed together in after()

before(async () => {
  ctx = await initTestDb('exam-session');
  course = require(path.join(ROOT, 'routes/course.js'));
});

after(() => {
  apps.forEach(a => a.close());
  ctx.cleanup();
});

function mountAs(userId, isAdmin = 0) {
  insertUser(ctx.db, { id: userId, isAdmin });
  const app = mountApp({ mountPath: '/api/course', routerPath: 'routes/course.js', userId });
  apps.push(app);
  return app;
}

// Grants course access (bypasses the payment gate) the same way an admin
// hand-granting access does.
function grantAccess(userId, level) {
  ctx.db.dbRun('INSERT INTO course_access (user_id, level) VALUES (?, ?)', [userId, level]);
}

// Marks well more than any level's video count as watched, so
// all_videos_done is true regardless of the exact VIDEO_COUNTS value in
// routes/course.js (not exported, and not this suite's concern to pin down).
function completeAllVideos(userId, level) {
  for (let i = 0; i < 20; i++) {
    ctx.db.dbRun(
      'INSERT OR IGNORE INTO video_progress (user_id, level, video_index) VALUES (?, ?, ?)',
      [userId, level, i]
    );
  }
}

function getExam(app, level) {
  return fetch(`${app.baseUrl}/api/course/exam-questions?level=${level}`)
    .then(r => r.json().then(body => ({ status: r.status, body })));
}

function submit(app, payload) {
  return fetch(`${app.baseUrl}/api/course/submit-exam`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(r => r.json().then(body => ({ status: r.status, body })));
}

// Builds the true answer key in the exact order a session's own GET served
// its questions in, by mapping question TEXT back to the underlying
// exam_questions row (ids are never exposed to the client).
function keyFor(questions) {
  const rows = ctx.db.dbAll('SELECT id, q, answer, type, answers FROM exam_questions', []);
  const byText = new Map(rows.map(r => [r.q, r]));
  return questions.map(q => {
    const r = byText.get(q.question);
    assert.notEqual(r, undefined, `no known question row for text: ${q.question}`);
    return r.type === 'multi' ? JSON.parse(r.answers) : r.answer;
  });
}

// Fully sets up a candidate (access + videos) and opens one exam session for
// them, returning the session id and its correct-answer key.
async function readyCandidate(userId, level) {
  const app = mountAs(userId, 0);
  grantAccess(userId, level);
  completeAllVideos(userId, level);
  const { body } = await getExam(app, level);
  return { app, sessionId: body.session_id, key: keyFor(body.questions) };
}

test('a submission with no session_id at all is rejected with 409, not silently graded', async () => {
  const { app, key } = await readyCandidate(100, 0);
  const before = ctx.db.dbGet('SELECT COUNT(*) AS n FROM exam_attempts', []).n;
  const { status, body } = await submit(app, { level: 0, answers: key });
  assert.equal(status, 409);
  assert.match(body.error, /restart/i);
  assert.equal(ctx.db.dbGet('SELECT COUNT(*) AS n FROM exam_attempts', []).n, before, 'no attempt row should be written');
});

test('a session can only be submitted once; the second submit gets 409', async () => {
  const { app, sessionId, key } = await readyCandidate(101, 0);
  const first = await submit(app, { level: 0, session_id: sessionId, answers: key });
  assert.equal(first.status, 200);

  const second = await submit(app, { level: 0, session_id: sessionId, answers: key });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already been submitted/i);
});

test("a session belonging to another user is rejected with 403", async () => {
  const owner = await readyCandidate(102, 0);
  // The other user must also clear the access/video gates, so the request
  // actually reaches the session-ownership check being tested here.
  const stranger = await readyCandidate(103, 0);

  const { status, body } = await submit(stranger.app, { level: 0, session_id: owner.sessionId, answers: owner.key });
  assert.equal(status, 403);
  assert.match(body.error, /does not belong to you/i);
});

test('a session opened for one level cannot be submitted against a different level (400)', async () => {
  const userId = 104;
  const app = mountAs(userId, 0);
  grantAccess(userId, 0);
  grantAccess(userId, 1);
  completeAllVideos(userId, 0);
  completeAllVideos(userId, 1);

  const { body: level0Session } = await getExam(app, 0);
  const key1 = keyFor(level0Session.questions); // wrong length for level 1, but level mismatch must fire first

  const { status, body } = await submit(app, { level: 1, session_id: level0Session.session_id, answers: key1 });
  assert.equal(status, 400);
  assert.match(body.error, /different level/i);
});

test('an expired session is rejected with 410', async () => {
  const { app, sessionId, key } = await readyCandidate(105, 0);
  // Force the session's clock back well past any possible expiry window
  // (max is 76 questions * 30s + 5 min grace, under an hour).
  ctx.db.dbRun(`UPDATE exam_sessions SET started_at = datetime('now', '-1 day') WHERE id = ?`, [sessionId]);

  const { status, body } = await submit(app, { level: 0, session_id: sessionId, answers: key });
  assert.equal(status, 410);
  assert.match(body.error, /expired/i);
});

test('the exam is locked behind course videos: 403 without all videos watched, 200 once they are', async () => {
  const userId = 106;
  const level = 0;
  const app = mountAs(userId, 0);
  grantAccess(userId, level);
  // No video_progress rows yet.

  const blocked = await getExam(app, level);
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /video/i);

  const blockedSubmit = await submit(app, { level, answers: [] });
  assert.equal(blockedSubmit.status, 403);
  assert.match(blockedSubmit.body.error, /video/i);

  completeAllVideos(userId, level);
  const unlocked = await getExam(app, level);
  assert.equal(unlocked.status, 200);
  assert.ok(unlocked.body.session_id);

  const key = keyFor(unlocked.body.questions);
  const passed = await submit(app, { level, session_id: unlocked.body.session_id, answers: key });
  assert.equal(passed.status, 200);
  assert.equal(passed.body.passed, true);
});

test('a failing submission reveals only { passed: false, total }, never correct or score', async () => {
  const { app, sessionId, key } = await readyCandidate(107, 0);
  const allWrong = key.map(v => (Array.isArray(v) ? [] : v === 0 ? 1 : 0));
  const { status, body } = await submit(app, { level: 0, session_id: sessionId, answers: allWrong });
  assert.equal(status, 200);
  assert.equal(body.passed, false);
  assert.deepEqual(Object.keys(body).sort(), ['passed', 'total']);

  // The real score is still recorded server-side for the admin screens.
  const row = ctx.db.dbGet('SELECT score, passed FROM exam_attempts WHERE user_id = ? ORDER BY id DESC LIMIT 1', [107]);
  assert.equal(row.passed, 0);
  assert.equal(row.score < 80, true);
});

test('a correct submission still scores 100 against a shuffled session order', async () => {
  const { app, sessionId, key } = await readyCandidate(108, 1);
  // key was built by mapping each returned question's TEXT back to its DB
  // row, so this proves grading follows the session's own stored order
  // rather than any fixed/canonical ordering.
  const { status, body } = await submit(app, { level: 1, session_id: sessionId, answers: key });
  assert.equal(status, 200);
  assert.equal(body.passed, true);
  assert.equal(body.score, 100);
  assert.equal(body.correct, key.length);
  assert.equal(body.total, key.length);
});

test('the attempt cap fires on the 4th submission in 24 hours; admins are exempt', async () => {
  const userId = 109;
  const level = 0;
  const app = mountAs(userId, 0);
  grantAccess(userId, level);
  completeAllVideos(userId, level);

  for (let i = 0; i < 3; i++) {
    const { body } = await getExam(app, level);
    const key = keyFor(body.questions);
    const res = await submit(app, { level, session_id: body.session_id, answers: key });
    assert.equal(res.status, 200, `attempt ${i + 1} should be graded normally`);
  }

  const fourthGet = await getExam(app, level);
  const fourthKey = keyFor(fourthGet.body.questions);
  const fourth = await submit(app, { level, session_id: fourthGet.body.session_id, answers: fourthKey });
  assert.equal(fourth.status, 429);
  assert.match(fourth.body.error, /3 exam attempts/i);

  // Admins are exempt from the cap.
  const adminId = 110;
  const adminApp = mountAs(adminId, 1);
  for (let i = 0; i < 4; i++) {
    const { body } = await getExam(adminApp, level);
    const key = keyFor(body.questions);
    const res = await submit(adminApp, { level, session_id: body.session_id, answers: key });
    assert.equal(res.status, 200, `admin attempt ${i + 1} should never be capped`);
  }
});
