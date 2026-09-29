'use strict';

// Shared test bootstrap for the exam / admin route suites.
//
// `node --test` runs each *.test.js file in its own child process, so it is
// safe for every test file to set DB_ENCRYPTION_KEY / DB_PATH / etc. itself
// via initTestDb() without colliding with any other test file. db.js is a
// module-level singleton (it captures DB_PATH the first time it is
// required), so initTestDb() MUST be called, and must finish, before any
// route file that transitively requires '../db' is required in that
// process. Call it first thing inside a top-level `before()` hook and only
// require route files afterwards (see the *.test.js files for the pattern).

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Boots one isolated, encrypted sql.js database at a unique temp path for
// this process. Deletes any stale file at that path first and returns a
// cleanup() that deletes it again, so a crashed previous run can never leak
// into this one and this run never leaks into the next.
async function initTestDb(tag) {
  const dbPath = path.join(os.tmpdir(), `usasl-test-${tag}-${process.pid}.db`);
  removeIfExists(dbPath);

  process.env.DB_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.DB_PATH = dbPath;
  process.env.RESEND_API_KEY = 're_test';
  process.env.JWT_SECRET = 'x'.repeat(40);

  const db = require(path.join(ROOT, 'db.js'));
  await db.initDb();

  return {
    db,
    dbPath,
    cleanup() {
      removeIfExists(dbPath);
    },
  };
}

// Inserts (or replaces) a minimal user row. Columns match db.js's users
// table: (id, name, email, password, phone, state, experience, is_admin,
// created_at) — only the columns the routes under test actually read are
// filled in here.
function insertUser(db, { id, isAdmin = 0, email }) {
  db.dbRun(
    'INSERT OR REPLACE INTO users (id, name, email, password, is_admin) VALUES (?, ?, ?, ?, ?)',
    [id, `Test User ${id}`, email || `test-${id}@example.com`, 'p', isAdmin ? 1 : 0]
  );
}

// Mounts one router behind a stub-authenticated Express app (auth
// middleware/JWT is bypassed entirely: req.user is set directly, the same
// pattern used by the working reference harnesses this suite was built
// from) and starts it on an ephemeral port.
function mountApp({ mountPath, routerPath, userId }) {
  const express = require(path.join(ROOT, 'node_modules', 'express'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use(mountPath, require(path.join(ROOT, routerPath)));

  const server = app.listen(0);
  const port = server.address().port;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close() {
      server.close();
    },
  };
}

module.exports = { ROOT, initTestDb, insertUser, mountApp, removeIfExists };
