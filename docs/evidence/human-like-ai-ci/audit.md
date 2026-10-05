# AI rebuild CI audit and workflow proposal

Status: ready for root review. The only proposed repository change is `.github/workflows/tests.yml`. No runtime, `test.js`, package, lockfile or documentation file was edited for this task. No PR, commit, workflow dispatch or remote write was made.

Patch: `/tmp/human-ai-ci-workflow.patch`. Candidate: `/tmp/human-ai-ci-proposal/.github/workflows/tests.yml`. `git apply --check` passes.

## Observed GitHub results

The most recent 11 inspected runs of `Game regression checks` succeeded. The latest master run [37184589775](https://github.com/axelmanosalvasmd/ww2-rts/actions/runs/37184589775), source `a3564a6a7bcd733900953b57854ba2d5bd885147`, ran `node test.js` from 07:02:31 to 07:18:55 UTC on October 4, 2026 (16 minutes 24 seconds). `node test-world.js` then passed. Its logs show Ubuntu 24.04, runner 2.337.0 and Node 24.21.0.

An earlier [failed run 37154315183](https://github.com/axelmanosalvasmd/ww2-rts/actions/runs/37154315183) failed a genuine World construction assertion in `test-world-acceptance.js:269`: building progress was 0.853333 rather than 1 after the old deadline. It exited with status 1 after about three minutes. This was an assertion failure, not an Actions or child-process timeout. Later runs succeed. Neither those old successful runs nor that old failure certify the current local AI rebuild.

Saved evidence: `/tmp/human-ai-ci-runs.json`, `/tmp/human-ai-ci-latest-master.log`, `/tmp/human-ai-ci-observed-failure.log`. Branch-protection lookup returned HTTP404 and repository rulesets returned an empty list. The proposal preserves the existing `game-tests` job/check identity and workflow triggers.

## Capacity and compatibility

The frozen local V13 full run passed in 25 minutes 31 seconds with 601 unchanged source files. The V14 run failed the bridge assertion after 26 minutes 49 seconds with all 611 files unchanged. These are local run durations, not GitHub measurements. They establish that the rebuilt suite has little margin under the current 30-minute job deadline, even though no rebuild-specific GitHub timeout has been observed.

This repository is public. GitHub currently documents standard `ubuntu-latest` runners as four CPUs and 16 GB RAM; the existing native suite runs child processes sequentially, so CPU count does not turn it into four-way test execution. No paid runner, matrix split, extra parallel test load, heap tuning or performance waiver is proposed. [GitHub runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Node 24 remains unchanged. The current local process and latest successful GitHub run both use 24.21.0. The existing pinned setup-node action officially supports major-version specifications and requires runner 2.327.1 or newer for its Node 24 action runtime; the observed runner is newer. No dependency upgrade or lockfile change is needed. [Official setup-node documentation](https://github.com/actions/setup-node).

## Exact workflow changes

Raise the job deadline from 30 to 60 minutes and give `node test.js` its own 55-minute ceiling. That leaves time for post-test source verification and a bounded artifact upload after a test-step timeout. The maximum is a CI wall-clock limit; no simulation deadline or test assertion changes. [GitHub job and step timeout syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes).

Set `shell: bash` explicitly so GitHub supplies `-eo pipefail`. Run the same `node test.js` and `node test-world.js` commands through `tee`, saving both stdout and stderr while preserving assertion exit failures. The dependency command remains exactly `npm ci --ignore-scripts --no-audit --no-fund`. [GitHub shell semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell).

Record the checked-out HEAD, actual Node/npm versions, OS, visible CPU count and RAM. Hash every tracked source before tests and again afterward; a changed source fails verification and retains a diff. Tracked directory symlinks and dangling symlinks are hashed as link targets rather than followed. This matters because the repository actually tracks symlinks to skill directories.

Save logs, runtime data and source manifests with the official `actions/upload-artifact` v7.0.1 action pinned to commit `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`. Its release, tag commit and action definition were checked directly. Upload runs with `always()`, has a three-minute limit and retains proof for 14 days. Missing proof is an error. A hard job cancellation, runner loss or upload outage can still prevent collection; the proposal does not claim those events preserve artifacts. [Official artifact action](https://github.com/actions/upload-artifact/releases/tag/v7.0.1), [artifact storage documentation](https://docs.github.com/en/actions/tutorials/store-and-share-data).

## Runner and gate audit

The final current `test.js` registration audit finds 66 child tests, no nonexistent registered files, and no missing `test-engine-ai*.js`, `test-world-observation.js` or test that calls `think`. Root registered the pending public-start, opening-saving and purchase-receipt tests during this audit. The existing 180000ms per-child timeout remains unchanged. No observed current child timeout justifies changing it.

The package's `npm test` still runs `node test.js`. The workflow continues to run that full suite and the separate world-rendering checks. No heavy native test is dropped, rerouted into an optional job, marked continue-on-error or replaced by an abbreviated smoke test. Original gameplay gates and assertions remain intact. Numeric campaign and browser acceptance still need their own actual proofs; this workflow proposal does not declare them satisfied.

Registration evidence: `/tmp/human-ai-ci-registration-audit.json`.

## Verification

`actionlint` 1.7.12 validates the proposed workflow with exit 0. The validator was downloaded from the official release and its checksum verified. The patch applies cleanly in a dry run.

The exact proposed Bash wrapper passes a success fixture and preserves exit 1 for a deliberate Node assertion failure, while retaining stdout and stderr in the log. The proposed source-verification commands pass unchanged fixtures, fail a real tracked-file mutation, handle actual directory/dangling symlinks and fail a changed symlink target. Runtime/source capture executes successfully against the actual repository. The actual `node test-world.js` also passes through the proposed logging wrapper on Node 24.21.0.

Evidence and executable validation: `/tmp/human-ai-ci-validation/proof.json` and `/tmp/human-ai-ci-validation/verify.py`. These checks validate CI behavior; the deliberate tiny fixtures are not a replacement for the full game suite. The revised workflow has not executed remotely, and this task did not rerun the full suite while runtime work remained active.
