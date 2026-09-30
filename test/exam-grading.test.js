'use strict';

// Grading correctness for POST /api/course/submit-exam: scoring, the 80%
// pass threshold, multi-select semantics, answer-leakage, and that exactly
// one exam_attempts row is written per graded submission.
//
// Every submission now goes through a server-side exam session
// (GET /exam-questions opens one, POST /submit-exam consumes it), and the
// question order that session serves is shuffled per call. So every test
// here opens its own fresh session and builds its answer key by mapping the
// returned question TEXT back to the underlying exam_questions row, instead
// of assuming any fixed order, the same thing a real client has to do.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { initTestDb, insertUser, mountApp, ROOT } = require('./helpers/boot');

let ctx;
let course;
let exam;
let idByText; // question text -> id
let rowById;  // id -> raw exam_questions row (answer, type, answers as stored)

before(async () => {
  ctx = await initTestDb('exam-grading');
  insertUser(ctx.db, { id: 1, isAdmin: 1 }); // admin bypasses payment + video gates
  course = require(path.join(ROOT, 'routes/course.js'));
  exam = mountApp({ mountPath: '/api/course', routerPath: 'routes/course.js', userId: 1 });

  const rows = ctx.db.dbAll('SELECT id, q, answer, type, answers FROM exam_questions', []);
  rowById = new Map(rows.map(r => [r.id, r]));
  idByText = new Map(rows.map(r => [r.q, r.id]));
  assert.equal(idByText.size, rows.length, 'question text must be unique so it can be mapped back to an id');
});

after(() => {
  exam.close();
  ctx.cleanup();
});

async function getExam(level) {
  const r = await fetch(`${exam.baseUrl}/api/course/exam-questions?level=${level}`);
  return { status: r.status, body: await r.json() };
}

function post(body) {
  return fetch(`${exam.baseUrl}/api/course/submit-exam`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json().then(json => ({ status: r.status, body: json })));
}

// Builds the true answer key in the exact order a session's own GET served
// its questions in (session.questions[i].question -> id -> stored answer).
function keyFor(questions) {
  return questions.map(q => {
    const id = idByText.get(q.question);
    assert.notEqual(id, undefined, `no known question id for text: ${q.question}`);
    const r = rowById.get(id);
    return r.type === 'multi' ? JSON.parse(r.answers) : r.answer;
  });
}

// Opens a fresh session for level and returns its session_id plus the
// correct-answer key for the order it was served in. Every call is a new
// session (sessions are single-use), which is exactly what is wanted here:
// each test gets its own session to submit against.
async function freshSession(level) {
  const { body } = await getExam(level);
  return { sessionId: body.session_id, key: keyFor(body.questions), questions: body.questions };
}

function attemptCount() {
  return ctx.db.dbGet('SELECT COUNT(*) AS n FROM exam_attempts', []).n;
}

test('a fully correct Level 0 submission scores 100 and passes', async () => {
  const { sessionId, key } = await freshSession(0);
  const { status, body } = await post({ level: 0, session_id: sessionId, answers: key });
  assert.equal(status, 200);
  assert.equal(body.passed, true);
  assert.equal(body.score, 100);
  assert.equal(body.correct, key.length);
  assert.equal(body.total, key.length);
});

test('multi-select grading is order-insensitive', async () => {
  const { sessionId, key } = await freshSession(0);
  const reversed = key.map(a => (Array.isArray(a) ? [...a].reverse() : a));
  const { body } = await post({ level: 0, session_id: sessionId, answers: reversed });
  assert.equal(body.score, 100);
  assert.equal(body.passed, true);
});

test('multi-select is exact-match: a subset or a superset of the correct answer is wrong', async () => {
  // Seeded multi question id 109, correct answers [2,3,4]. Its position
  // within a session's served order varies because the order is shuffled per
  // session, so it is located by mapping question text back to id each time.
  const optionsRow = ctx.db.dbGet('SELECT options FROM exam_questions WHERE id = 109', []);
  const numOptions = JSON.parse(optionsRow.options).length;

  {
    const { sessionId, key, questions } = await freshSession(0);
    const idx = questions.findIndex(q => idByText.get(q.question) === 109);
    assert.ok(idx !== -1 && Array.isArray(key[idx]) && key[idx].length >= 2, 'expected multi question id 109 with >=2 correct answers in Level 0');
    const subset = key.slice();
    subset[idx] = key[idx].slice(0, key[idx].length - 1);
    const subsetRes = await post({ level: 0, session_id: sessionId, answers: subset });
    assert.equal(subsetRes.body.correct, key.length - 1, 'a subset of the correct multi answer must not score a point');
  }

  {
    const { sessionId, key, questions } = await freshSession(0);
    const idx = questions.findIndex(q => idByText.get(q.question) === 109);
    const extraOption = Array.from({ length: numOptions }, (_, i) => i).find(i => !key[idx].includes(i));
    assert.notEqual(extraOption, undefined, 'expected an option index not already part of the correct answer');
    const superset = key.slice();
    superset[idx] = [...key[idx], extraOption];
    const supersetRes = await post({ level: 0, session_id: sessionId, answers: superset });
    assert.equal(supersetRes.body.correct, key.length - 1, 'a superset of the correct multi answer must not score a point');
  }
});

function answersWithNCorrect(key, n) {
  return key.map((v, i) => {
    if (i < n) return v;
    return Array.isArray(v) ? [] : v === 0 ? 1 : 0; // guaranteed wrong
  });
}

test('the 80% pass boundary is exact for Level 0 (40 questions): 32 passes, 31 fails', async () => {
  const passAttempt = await freshSession(0);
  const pass = await post({ level: 0, session_id: passAttempt.sessionId, answers: answersWithNCorrect(passAttempt.key, 32) });
  assert.equal(pass.body.correct, 32);
  assert.equal(pass.body.score, 80);
  assert.equal(pass.body.passed, true);

  const failAttempt = await freshSession(0);
  const fail = await post({ level: 0, session_id: failAttempt.sessionId, answers: answersWithNCorrect(failAttempt.key, 31) });
  assert.equal(fail.body.total, 40);
  assert.equal(fail.body.passed, false);
  assert.deepEqual(Object.keys(fail.body).sort(), ['passed', 'total']);
});

test('the 80% pass boundary is exact for Level 1 (76 questions): 61 passes, 60 fails', async () => {
  const passAttempt = await freshSession(1);
  const pass = await post({ level: 1, session_id: passAttempt.sessionId, answers: answersWithNCorrect(passAttempt.key, 61) });
  assert.equal(pass.body.correct, 61);
  assert.equal(pass.body.score, Math.round((61 / 76) * 100));
  assert.equal(pass.body.passed, true);

  const failAttempt = await freshSession(1);
  const fail = await post({ level: 1, session_id: failAttempt.sessionId, answers: answersWithNCorrect(failAttempt.key, 60) });
  assert.equal(fail.body.total, 76);
  assert.equal(fail.body.passed, false);
});

test('a wrong-length answers array is rejected and writes no exam_attempts row', async () => {
  const before = attemptCount();
  const { sessionId } = await freshSession(0);
  const { status } = await post({ level: 0, session_id: sessionId, answers: new Array(5).fill(0) });
  assert.equal(status, 400);
  assert.equal(attemptCount(), before);
});

test('a failing submission does not leak correct answers, correct count, or score in the response body', async () => {
  const { sessionId, key } = await freshSession(0);
  const allWrong = key.map(v => (Array.isArray(v) ? [] : v === 0 ? 1 : 0));
  const { body } = await post({ level: 0, session_id: sessionId, answers: allWrong });
  assert.equal(body.passed, false);
  assert.deepEqual(Object.keys(body).sort(), ['passed', 'total']);
});

test('every graded submission writes exactly one exam_attempts row with the right level, score, and passed flag', async () => {
  const before = attemptCount();
  const { sessionId, key } = await freshSession(1);
  const { body } = await post({ level: 1, session_id: sessionId, answers: key });
  assert.equal(attemptCount(), before + 1);

  const row = ctx.db.dbGet('SELECT level, score, passed FROM exam_attempts ORDER BY id DESC LIMIT 1', []);
  assert.equal(row.level, 1);
  assert.equal(row.score, body.score);
  assert.equal(row.passed, body.passed ? 1 : 0);
});
