'use strict';

// Level 1 purchase grants Level 1 only; one-shot migration removes the old
// auto-granted Level 0 access.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { initTestDb, insertUser, mountApp, ROOT } = require('./helpers/boot');

let ctx;
const apps = {};
const L1 = 'USA Streetlifting Level 1 Judge Certification';
const L0 = 'USA Streetlifting Level 0 Judge Certification';

function pay(uid, desc) {
  ctx.db.dbRun(`INSERT INTO payments (user_id, amount_cents, description, status) VALUES (?, 100, ?, 'paid')`, [uid, desc]);
}
function access(uid, level, by = null) {
  ctx.db.dbRun('INSERT INTO course_access (user_id, level, granted_by) VALUES (?, ?, ?)', [uid, level, by]);
}
function seedLegacy(uid) {
  insertUser(ctx.db, { id: uid });
  pay(uid, L1);
  access(uid, 1);
  access(uid, 0);
  for (let i = 0; i <= 5; i++) {
    ctx.db.dbRun('INSERT INTO video_progress (user_id, level, video_index) VALUES (?, 0, ?)', [uid, i]);
  }
}
async function get(uid, p) {
  const r = await fetch(`${apps[uid].baseUrl}${p}`);
  return { status: r.status, body: await r.json() };
}

before(async () => {
  ctx = await initTestDb('course-access');
  insertUser(ctx.db, { id: 1 });
  insertUser(ctx.db, { id: 2 });
  pay(1, L1); access(1, 1);
  pay(2, L0); access(2, 0);

  seedLegacy(10); // A
  seedLegacy(11); // B: has level 0 cert
  ctx.db.dbRun('INSERT INTO certifications (user_id, level) VALUES (11, 0)');
  seedLegacy(12); // C: also paid Level 0
  pay(12, L0);
  insertUser(ctx.db, { id: 13 }); // D: admin-granted level 0
  access(13, 0, 99); access(13, 1);

  for (const uid of [1, 2, 10]) {
    apps[uid] = mountApp({ mountPath: '/api/course', routerPath: 'routes/course.js', userId: uid });
  }
});

after(() => {
  Object.values(apps).forEach(a => a.close());
  ctx.cleanup();
});

test('Level 1 purchase gives level1 only', async () => {
  const { body } = await get(1, '/api/course/status');
  assert.equal(body.access.level1, true);
  assert.equal(body.access.level0, false);
});

test('Level 0 purchase gives level0 only', async () => {
  const { body } = await get(2, '/api/course/status');
  assert.equal(body.access.level0, true);
  assert.equal(body.access.level1, false);
});

test('migration removes only auto-granted level 0 and carries videos over', async () => {
  ctx.db.dbRun(`DELETE FROM settings WHERE key = 'level1_only_access_v1'`);
  const n = ctx.db.applyLevel1OnlyAccessFix();
  assert.equal(n, 1);

  const has0 = uid => !!ctx.db.dbGet('SELECT id FROM course_access WHERE user_id = ? AND level = 0', [uid]);
  assert.equal(has0(10), false);
  assert.equal(has0(11), true);
  assert.equal(has0(12), true);
  assert.equal(has0(13), true);
  assert.equal(!!ctx.db.dbGet('SELECT id FROM course_access WHERE user_id = 10 AND level = 1'), true);

  const l1 = ctx.db.dbAll('SELECT video_index FROM video_progress WHERE user_id = 10 AND level = 1', [])
    .map(r => r.video_index).sort((a, b) => a - b);
  assert.deepEqual(l1, [0, 1, 2, 5, 6]);
  const l0 = ctx.db.dbAll('SELECT video_index FROM video_progress WHERE user_id = 10 AND level = 0', []);
  assert.equal(l0.length, 6);
  assert.equal(ctx.db.dbAll('SELECT id FROM video_progress WHERE user_id = 11 AND level = 1', []).length, 0);

  assert.equal(ctx.db.applyLevel1OnlyAccessFix(), 0);
});

test('after migration user A cannot fetch level 0 exam', async () => {
  const r = await get(10, '/api/course/exam-questions?level=0');
  assert.equal(r.status, 403);
});
