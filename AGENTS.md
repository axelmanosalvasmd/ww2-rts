# Agent instructions

## Always update the changelog

Every change to the game must be recorded in `CHANGELOG.md` in the same commit as the change.

- Add a bullet under **Unreleased** at the top: what changed for players, in plain words.
- Include balance numbers when you tuned something (for example "faction wins 37/33/30% over 300 AI matches").
- Note bugs you fixed and anything you found but left for later.
- When a set of changes is committed as a slice, give it a dated heading with the commit hash, like the entries below it.

## Other rules

- Never use em dashes, in code comments, docs, commit messages or chat. Use a period, comma, colon or parentheses.
- Run `node test.js` before committing; it must pass.
- `DESIGN.md` holds the design decisions and the balance log. Keep it in sync with gameplay changes.
- More than one agent session may work in this folder. Stage specific files (not whole folders) and check
  `git status` for changes that aren't yours before committing.
