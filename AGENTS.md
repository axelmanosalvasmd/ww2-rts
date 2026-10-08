# Agent instructions

## Always update the changelog

Every change to the game must be recorded in `CHANGELOG.md` in the same commit as the change.

- Add a bullet under **Unreleased** at the top: what changed for players, in plain words.
- Include balance numbers when you tuned something (for example "faction wins 37/33/30% over 300 AI matches").
- Note bugs you fixed and anything you found but left for later.
- When a set of changes is committed as a slice, give it a dated heading with the commit hash, like the entries below it.

## Tests and CI serve the goal

Tests and CI exist to move the game where we want it to go, not to keep old behavior alive.

- When a deliberate change replaces a behavior, rewrite the tests that pinned the old behavior to check the new
  intended one, or delete them, in the same commit. Say which in CHANGELOG.md.
- Change CI when it stops measuring what matters.
- Add tests only when they protect an improvement or a goal: roughly one focused test per stated behavior.
  No versioned duplicates (v1/v2/v3) and no one-off proof scripts in the suite.
- A flaky test (unseeded randomness, wall-clock timing) gets made deterministic or removed. Never just retried.

## Running the suite

`node test.js` splits itself into processes and takes about 2 minutes. Every check has a name (`test-check.js`):

- `WW2_TEST_ONLY=crossing node test.js` runs only checks or child files whose name contains the text.
- `WW2_TEST_SLOW=1 node test.js` adds the full-length proofs (CI runs them nightly).
- A failed check is reported and the run goes on; the summary lists every failure.
- New test files: wrap each case in `check(name, fn)`, or add the file to the child list in `test.js`. Room tests
  send through `sendsReadBy` (`test-socket.js`) and wait for the snapshot of the tick they stepped, never a fixed sleep.

## Asking the AI a question fast

Do not answer an AI behaviour question with whole matches when a small scene will do. A drill (`drills/*.js`, format in
`drills/drill.js`) places a few units on a small map, runs a script on the server's AI schedule and returns a measure;
`node tools/drill.mjs drills/<name>.js --seeds 200` runs it across seeds in seconds, and tests can assert it. Keep
whole-match runs (`tools/ai-balance.mjs`, `tools/ai-human-report.mjs`) for balance and strength, at 60 matches.

## Other rules

- Never use em dashes, in code comments, docs, commit messages or chat. Use a period, comma, colon or parentheses.
- Run `node test.js` before committing; it must pass.
- `DESIGN.md` holds the design decisions and the balance log. Keep it in sync with gameplay changes.
- More than one agent session may work in this folder. Stage specific files (not whole folders) and check
  `git status` for changes that aren't yours before committing.
