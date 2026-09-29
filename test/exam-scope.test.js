'use strict';

// Regression tests for the Level 0 / Level 1 exam-scope bug: Level 0
// ("Classic format") must only ever be asked Pull-up and Dip questions
// (40 total), never muscle-up or squat content, while Level 1 covers all
// four movements (76 total). These tests matter most in this suite because
// they pin down the exact behaviour the fix must not regress.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { initTestDb, insertUser, mountApp, ROOT } = require('./helpers/boot');

// Out-of-scope content for Level 0: muscle-up and squat technique/judging.
const OUT_OF_SCOPE_RE = /muscle.?up|\bring\b|squat/i;
// SAFETY_COMP_IDS id 42 ("Dropping the barbell intentionally results in:").
// There is no id 41: a squat question was deleted there and the hole is
// permanent, which db.js reproduces when seeding a fresh database.
// lives in the general safety/competition block that Level 0 deliberately
// includes. It does not currently match OUT_OF_SCOPE_RE (it mentions
// "barbell", not "ring"/"squat"/"muscle-up"), but the task spec calls it out
// as a documented, allowed exception, so it is carved out by text here
// rather than assumed impossible, in case question wording changes.
const EXEMPT_QUESTION_TEXT = 'Dropping the barbell intentionally results in:';

let ctx;
let course;
let exam;
let idByText;

before(async () => {
  ctx = await initTestDb('exam-scope');
  insertUser(ctx.db, { id: 1, isAdmin: 1 }); // admin bypasses the payment gate
  course = require(path.join(ROOT, 'routes/course.js'));
  exam = mountApp({ mountPath: '/api/course', routerPath: 'routes/course.js', userId: 1 });

  const rows = ctx.db.dbAll('SELECT id, q FROM exam_questions', []);
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

function idsFor(questions) {
  return questions.map(q => {
    const id = idByText.get(q.question);
    assert.notEqual(id, undefined, `no known question id for text: ${q.question}`);
    return id;
  });
}

function findContiguous(arr, sub) {
  for (let i = 0; i + sub.length <= arr.length; i++) {
    if (sub.every((v, j) => arr[i + j] === v)) return i;
  }
  return -1;
}

test('level 0 has exactly 40 questions, level 1 has exactly 76', async () => {
  const l0 = await getExam(0);
  const l1 = await getExam(1);
  assert.equal(l0.status, 200);
  assert.equal(l1.status, 200);
  assert.equal(l0.body.total, 40);
  assert.equal(l0.body.questions.length, 40);
  assert.equal(l1.body.total, 76);
  assert.equal(l1.body.questions.length, 76);
  assert.equal(l0.body.pass_threshold, 80);
  assert.equal(l1.body.pass_threshold, 80);
});

test('no level 0 question is muscle-up, ring, or squat content, except the documented barbell-drop exception', async () => {
  const { body } = await getExam(0);
  const offenders = body.questions.filter(
    q => OUT_OF_SCOPE_RE.test(q.question) && q.question !== EXEMPT_QUESTION_TEXT
  );
  assert.deepEqual(offenders.map(q => q.question), []);
});

test("level 0's served question set equals LEVEL_QUESTION_IDS[0] exactly", async () => {
  const { body } = await getExam(0);
  const servedIds = idsFor(body.questions).sort((a, b) => a - b);
  const expectedIds = [...course.LEVEL_QUESTION_IDS[0]].sort((a, b) => a - b);
  assert.deepEqual(servedIds, expectedIds);
});

test('level 0 never includes the muscle-up or squat judge blocks (ids 99-108, 120-124)', async () => {
  const { body } = await getExam(0);
  const servedIds = new Set(idsFor(body.questions));
  const forbidden = [
    ...Array.from({ length: 108 - 99 + 1 }, (_, i) => 99 + i),
    ...Array.from({ length: 124 - 120 + 1 }, (_, i) => 120 + i),
  ];
  const leaked = forbidden.filter(id => servedIds.has(id));
  assert.deepEqual(leaked, []);
});

test("level 1's served question set is the whole bank: ids 0-40, 42-49 and 99-125, no duplicates, no omissions", async () => {
  const { body } = await getExam(1);
  const servedIds = idsFor(body.questions);
  assert.equal(new Set(servedIds).size, servedIds.length, 'no duplicate ids served');

  const expected = [
    // 0-40 then 42-49: id 41 is a permanent hole, see the note at the top.
    ...Array.from({ length: 41 }, (_, i) => i),
    ...Array.from({ length: 8 }, (_, i) => i + 42),
    ...Array.from({ length: 27 }, (_, i) => 99 + i), // 99-125
  ];
  assert.deepEqual([...servedIds].sort((a, b) => a - b), expected.sort((a, b) => a - b));
});

test('the response never leaks answer, answers, or id keys', async () => {
  for (const level of [0, 1]) {
    const { body } = await getExam(level);
    for (const q of body.questions) {
      const keys = Object.keys(q).sort();
      assert.deepEqual(keys, ['index', 'options', 'question', 'type']);
    }
  }
});

test("level 1's dip judge block (115,116,125,117,118,119) is contiguous and in that exact order, and id 125 is not last", async () => {
  const { body } = await getExam(1);
  const servedIds = idsFor(body.questions);
  const dipJudgeBlock = [115, 116, 125, 117, 118, 119];
  const start = findContiguous(servedIds, dipJudgeBlock);
  assert.notEqual(start, -1, `expected ${JSON.stringify(dipJudgeBlock)} to appear contiguously and in order`);
  assert.notEqual(servedIds[servedIds.length - 1], 125, 'id 125 must not be the last question in the exam');
});

test('GET is stable across repeated calls, and POST agrees with GET on how many answers are required', async () => {
  for (const level of [0, 1]) {
    const first = await getExam(level);
    const second = await getExam(level);
    assert.deepEqual(first.body, second.body, `level ${level} GET response must be stable across repeated calls`);

    const postRes = await fetch(`${exam.baseUrl}/api/course/submit-exam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, answers: [] }),
    });
    assert.equal(postRes.status, 400);
    const postBody = await postRes.json();
    assert.match(postBody.error, new RegExp(`Expected ${first.body.total} answers`));
  }
});

test('GET /exam-questions rejects invalid levels', async () => {
  for (const lvl of [2, 3, -1, 'abc']) {
    const r = await fetch(`${exam.baseUrl}/api/course/exam-questions?level=${encodeURIComponent(lvl)}`);
    assert.equal(r.status, 400, `level=${lvl} should be rejected`);
  }
  // "null" case: no level provided at all.
  const rMissing = await fetch(`${exam.baseUrl}/api/course/exam-questions`);
  assert.equal(rMissing.status, 400);

  // Regression: the level used to be read with parseInt, which truncated, so
  // '1.5', '1abc' and '0.9' all became a valid level on the GET while the POST
  // rejected them. Both now go through the same strict parseLevel.
  for (const bad of ['1.5', '0.9', '1abc', '1e0', ' ', '+1.0']) {
    const r = await fetch(`${exam.baseUrl}/api/course/exam-questions?level=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, `level=${bad} should be rejected`);
  }
  // Plain integer strings still work, including a zero-padded one.
  for (const [good, total] of [['0', 40], ['1', 76], ['01', 76]]) {
    const r = await fetch(`${exam.baseUrl}/api/course/exam-questions?level=${good}`);
    assert.equal(r.status, 200, `level=${good} should be accepted`);
    assert.equal((await r.json()).total, total);
  }
});

test('POST /submit-exam rejects invalid levels', async () => {
  for (const lvl of [2, 3, -1, 'abc', 1.5, null]) {
    const r = await fetch(`${exam.baseUrl}/api/course/submit-exam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: lvl, answers: [] }),
    });
    assert.equal(r.status, 400, `level=${JSON.stringify(lvl)} should be rejected`);
  }
});
