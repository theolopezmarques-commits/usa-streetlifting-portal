'use strict';

// Coverage for the admin question editor: GET /api/admin/questions (level
// badges must agree with what routes/course.js actually serves) and
// PUT /api/admin/questions/:id (validation, including the wide multi-select
// judge questions with up to 8 options that used to be rejected), plus the
// admin-only guard on both endpoints.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { initTestDb, insertUser, mountApp, ROOT } = require('./helpers/boot');

let ctx;
let course;
let adminApp;
let userApp;

before(async () => {
  ctx = await initTestDb('admin-questions');
  insertUser(ctx.db, { id: 1, isAdmin: 1 });
  insertUser(ctx.db, { id: 2, isAdmin: 0 });
  course = require(path.join(ROOT, 'routes/course.js'));
  adminApp = mountApp({ mountPath: '/api/admin', routerPath: 'routes/admin.js', userId: 1 });
  userApp = mountApp({ mountPath: '/api/admin', routerPath: 'routes/admin.js', userId: 2 });
});

after(() => {
  adminApp.close();
  userApp.close();
  ctx.cleanup();
});

function getQuestions() {
  return fetch(`${adminApp.baseUrl}/api/admin/questions`).then(r => r.json());
}

function putQuestion(id, payload) {
  return fetch(`${adminApp.baseUrl}/api/admin/questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(r => r.json().then(json => ({ status: r.status, body: json })));
}

test('GET /api/admin/questions returns all 76 questions, each with a levels array; exactly 40 are badged Level 0', async () => {
  const { questions } = await getQuestions();
  assert.equal(questions.length, 76);
  assert.ok(questions.every(q => Array.isArray(q.levels)));

  const l0 = questions.filter(q => q.levels.includes(0));
  assert.equal(l0.length, 40);

  const l0Ids = l0.map(q => q.id).sort((a, b) => a - b);
  const expectedIds = [...course.LEVEL_QUESTION_IDS[0]].sort((a, b) => a - b);
  assert.deepEqual(l0Ids, expectedIds, 'admin badges must agree with what course.js actually serves for Level 0');
});

test('no muscle-up or squat question is badged into Level 0, except the documented barbell-drop exception', async () => {
  const { questions } = await getQuestions();
  const re = /muscle.?up|squat/i;
  const offenders = questions.filter(q => re.test(q.q) && q.levels.includes(0) && !/Dropping the barbell/.test(q.q));
  assert.deepEqual(offenders.map(q => q.id), []);
});

// Regression: id 49 existed in the database but no exam block and no admin
// category listed it, so it was appended to the end of every Level 1 exam and
// was invisible and uneditable in the admin screen. Nothing may be orphaned.
test('every question belongs to an admin category and to at least one level', async () => {
  const { questions, categories } = await getQuestions();
  assert.ok(Array.isArray(categories) && categories.length > 0, 'categories must be served');
  const grouped = new Set(categories.flatMap(c => c.ids));
  const uncategorised = questions.filter(q => !grouped.has(q.id)).map(q => q.id);
  assert.deepEqual(uncategorised, [], 'every question must appear in a category');
  const levelless = questions.filter(q => !Array.isArray(q.levels) || q.levels.length === 0).map(q => q.id);
  assert.deepEqual(levelless, [], 'every question must belong to at least one level');
  // and no category may reference an id that does not exist
  const have = new Set(questions.map(q => q.id));
  const dangling = [...grouped].filter(id => !have.has(id));
  assert.deepEqual(dangling, [], 'no category may list a non-existent question id');
});

test('PUT accepts a valid edit on a wide multi question with a correct-answer index above 3', async () => {
  const { questions } = await getQuestions();
  const q99 = questions.find(q => q.id === 99);
  assert.ok(q99, 'expected seeded question id 99');
  assert.ok(q99.options.length >= 7, 'expected id 99 to have 7 or 8 options');

  const { status, body } = await putQuestion(99, {
    q: q99.q,
    options: q99.options,
    type: 'multi',
    answers: [0, 3, 4, 5, 6], // index 4/5/6 are above the old 4-option ceiling
  });
  assert.equal(status, 200);
  assert.equal(body.success, true);
});

test('PUT rejects an out-of-range multi answer index', async () => {
  const { status, body } = await putQuestion(99, {
    q: 'placeholder question text',
    options: ['a', 'b', 'c'],
    type: 'multi',
    answers: [99],
  });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('PUT rejects a single-type answer index >= options.length', async () => {
  const { questions } = await getQuestions();
  const single = questions.find(q => q.type === 'single');
  assert.ok(single, 'expected at least one single-type question');

  const { status, body } = await putQuestion(single.id, {
    q: single.q,
    options: single.options,
    type: 'single',
    answer: single.options.length, // one past the last valid index
  });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('a non-admin user gets 403 from GET /api/admin/questions', async () => {
  const r = await fetch(`${userApp.baseUrl}/api/admin/questions`);
  assert.equal(r.status, 403);
});

test('a non-admin user gets 403 from PUT /api/admin/questions/:id', async () => {
  const r = await fetch(`${userApp.baseUrl}/api/admin/questions/99`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'x', options: ['a', 'b'], type: 'single', answer: 0 }),
  });
  assert.equal(r.status, 403);
});
