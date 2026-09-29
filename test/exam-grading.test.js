'use strict';

// Grading correctness for POST /api/course/submit-exam: scoring, the 80%
// pass threshold, multi-select semantics, answer-leakage, and that exactly
// one exam_attempts row is written per graded submission.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { initTestDb, insertUser, mountApp, ROOT } = require('./helpers/boot');

let ctx;
let course;
let exam;
let byId; // id -> raw exam_questions row (answer, type, answers as stored)

before(async () => {
  ctx = await initTestDb('exam-grading');
  insertUser(ctx.db, { id: 1, isAdmin: 1 }); // admin bypasses the payment gate
  course = require(path.join(ROOT, 'routes/course.js'));
  exam = mountApp({ mountPath: '/api/course', routerPath: 'routes/course.js', userId: 1 });

  const rows = ctx.db.dbAll('SELECT id, answer, type, answers FROM exam_questions', []);
  byId = new Map(rows.map(r => [r.id, r]));
});

after(() => {
  exam.close();
  ctx.cleanup();
});

function post(body) {
  return fetch(`${exam.baseUrl}/api/course/submit-exam`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json().then(json => ({ status: r.status, body: json })));
}

// Builds the true answer key in the exact order the exam is served in
// (course.LEVEL_QUESTION_IDS[level], not raw id order — the dip judge block
// is intentionally out of id order, see exam-scope.test.js).
function buildKey(level) {
  return course.LEVEL_QUESTION_IDS[level].map(id => {
    const r = byId.get(id);
    return r.type === 'multi' ? JSON.parse(r.answers) : r.answer;
  });
}

function attemptCount() {
  return ctx.db.dbGet('SELECT COUNT(*) AS n FROM exam_attempts', []).n;
}

test('a fully correct Level 0 submission scores 100 and passes', async () => {
  const key = buildKey(0);
  const { status, body } = await post({ level: 0, answers: key });
  assert.equal(status, 200);
  assert.equal(body.passed, true);
  assert.equal(body.score, 100);
  assert.equal(body.correct, key.length);
  assert.equal(body.total, key.length);
});

test('multi-select grading is order-insensitive', async () => {
  const key = buildKey(0);
  const reversed = key.map(a => (Array.isArray(a) ? [...a].reverse() : a));
  const { body } = await post({ level: 0, answers: reversed });
  assert.equal(body.score, 100);
  assert.equal(body.passed, true);
});

test('multi-select is exact-match: a subset or a superset of the correct answer is wrong', async () => {
  const ids0 = course.LEVEL_QUESTION_IDS[0];
  const idx = ids0.indexOf(109); // seeded multi question, correct answers [2,3,4]
  const key = buildKey(0);
  assert.ok(idx !== -1 && Array.isArray(key[idx]) && key[idx].length >= 2, 'expected multi question id 109 with >=2 correct answers in Level 0');

  const subset = key.slice();
  subset[idx] = key[idx].slice(0, key[idx].length - 1);
  const subsetRes = await post({ level: 0, answers: subset });
  assert.equal(subsetRes.body.correct, key.length - 1, 'a subset of the correct multi answer must not score a point');

  const optionsRow = ctx.db.dbGet('SELECT options FROM exam_questions WHERE id = 109', []);
  const numOptions = JSON.parse(optionsRow.options).length;
  const extraOption = Array.from({ length: numOptions }, (_, i) => i).find(i => !key[idx].includes(i));
  assert.notEqual(extraOption, undefined, 'expected an option index not already part of the correct answer');

  const superset = key.slice();
  superset[idx] = [...key[idx], extraOption];
  const supersetRes = await post({ level: 0, answers: superset });
  assert.equal(supersetRes.body.correct, key.length - 1, 'a superset of the correct multi answer must not score a point');
});

function answersWithNCorrect(level, n) {
  const key = buildKey(level);
  return key.map((v, i) => {
    if (i < n) return v;
    return Array.isArray(v) ? [] : v === 0 ? 1 : 0; // guaranteed wrong
  });
}

test('the 80% pass boundary is exact for Level 0 (40 questions): 32 passes, 31 fails', async () => {
  const pass = await post({ level: 0, answers: answersWithNCorrect(0, 32) });
  assert.equal(pass.body.correct, 32);
  assert.equal(pass.body.score, 80);
  assert.equal(pass.body.passed, true);

  const fail = await post({ level: 0, answers: answersWithNCorrect(0, 31) });
  assert.equal(fail.body.correct, 31);
  assert.equal(fail.body.score, 78);
  assert.equal(fail.body.passed, false);
});

test('the 80% pass boundary is exact for Level 1 (76 questions): 61 passes, 60 fails', async () => {
  const pass = await post({ level: 1, answers: answersWithNCorrect(1, 61) });
  assert.equal(pass.body.correct, 61);
  assert.equal(pass.body.score, Math.round((61 / 76) * 100));
  assert.equal(pass.body.passed, true);

  const fail = await post({ level: 1, answers: answersWithNCorrect(1, 60) });
  assert.equal(fail.body.correct, 60);
  assert.equal(fail.body.score, Math.round((60 / 76) * 100));
  assert.equal(fail.body.passed, false);
});

test('a wrong-length answers array is rejected and writes no exam_attempts row', async () => {
  const before = attemptCount();
  const { status } = await post({ level: 0, answers: new Array(5).fill(0) });
  assert.equal(status, 400);
  assert.equal(attemptCount(), before);
});

test('a failing submission does not leak correct answers in the response body', async () => {
  const key = buildKey(0);
  const allWrong = key.map(v => (Array.isArray(v) ? [] : v === 0 ? 1 : 0));
  const { body } = await post({ level: 0, answers: allWrong });
  assert.equal(body.passed, false);
  assert.deepEqual(Object.keys(body).sort(), ['correct', 'passed', 'score', 'total']);
});

test('every graded submission writes exactly one exam_attempts row with the right level, score, and passed flag', async () => {
  const before = attemptCount();
  const key = buildKey(1);
  const { body } = await post({ level: 1, answers: key });
  assert.equal(attemptCount(), before + 1);

  const row = ctx.db.dbGet('SELECT level, score, passed FROM exam_attempts ORDER BY id DESC LIMIT 1', []);
  assert.equal(row.level, 1);
  assert.equal(row.score, body.score);
  assert.equal(row.passed, body.passed ? 1 : 0);
});
