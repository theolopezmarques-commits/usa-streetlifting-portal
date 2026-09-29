# Test suite

The first automated tests for this app. Uses only `node:test` and
`node:assert/strict` (both built into Node), no test framework dependency.

## Running

```
npm test
```

which runs:

```
node --test test/*.test.js
```

Note: `node --test test/` (pointing at the directory) did not discover the
files in this environment's Node build; the explicit glob does, so that is
what `npm test` uses. Run a single file directly with, for example:
`node --test test/exam-scope.test.js`.

## Files

- `helpers/boot.js` — shared bootstrap. Boots an isolated, encrypted sql.js
  database at a unique path under `os.tmpdir()`, seeds one or two stub
  users, and mounts a route file behind a stub-authenticated Express app
  (`req.user` is set directly, bypassing real login/JWT, the same way the
  hand-written verification scripts this suite was built from do it).
- `exam-scope.test.js` — regression tests for the Level 0 / Level 1
  exam-scope bug: Level 0 ("Classic format") must serve exactly the 40
  Pull-up/Dip questions and never muscle-up or squat content; Level 1 must
  serve the full 76-question bank with no drops or duplicates; no answer
  leakage; invalid `level` values are rejected. This file matters most —
  it is what pins the fix in place.
- `exam-grading.test.js` — scoring correctness for
  `POST /api/course/submit-exam`: the true answer key is built straight
  from the database (not hand-copied), multi-select grading is order
  -insensitive but exact-match (no subset/superset credit), the 80% pass
  threshold is exact at the boundary, wrong-length submissions are
  rejected without writing an attempt, and a failing submission never
  leaks the correct answers.
- `admin-questions.test.js` — `GET/PUT /api/admin/questions[/:id]`: the
  admin editor's Level 0 badges must agree with what `routes/course.js`
  actually serves, wide multi-select questions (7-8 options) are editable,
  out-of-range answers are rejected, and non-admins get 403.

## Database isolation

Every test file calls `initTestDb(tag)` from `helpers/boot.js`, which:

1. Points `DB_PATH` at a unique file under `os.tmpdir()` named with the
   test tag and the process pid, deleting any stale file at that path first.
2. Never touches this repo's real `streetlifting.db`, `database.db`, or any
   other `*.db` file in the repo — `DB_PATH` is always overridden before
   `db.js` is required.
3. Deletes its temp file again in an `after()` hook, so re-running the
   suite never sees leftover state.

`node --test` runs each matching file in its own child process, so setting
`process.env.DB_PATH` etc. per file is safe: nothing here is shared
between files, and `db.js`'s module-level singleton state (it captures
`DB_PATH` the first time it is required) never leaks across test files as
a result. Within a single test file, `initTestDb()` is called exactly once,
in a top-level `before()` hook, before any route file that requires `../db`
is required in that process.

All tests read and write only via relative counts (e.g. "the
`exam_attempts` row count went up by exactly one") rather than assuming
an absolute starting state, so the suite passes whether run once, run
repeatedly, or run out of order.

## Current-behaviour policy

These tests assert what the app actually does today, not what it
arguably should do. Where a test exposes behaviour that looks like a bug,
it is left asserting the current behaviour and marked with a
`// SUSPECTED BUG:` comment explaining the concern, rather than being
changed to assert the "fixed" behaviour or having the app code changed
to match. See `exam-scope.test.js` (`GET /exam-questions rejects invalid
levels`) for the one instance in this suite: `level=1.5` in the query
string is accepted as Level 1 instead of being rejected.
