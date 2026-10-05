# Diagnostic native main-body preflight

The source snapshot copies all shared/client/server/tools code, maps, authored model assets, local dependencies and root JS/MJS/JSON files. Every copied byte was checked against ROOT immediately after copying, and the AI checkpoint is bc677b3d. No live source symlinks or ROOT writes are used.

Only the initial registered 90-child execFileSync block is removed in copied test.js. The removed executable lines are replaced with blank lines to preserve failure line numbers. All imports, initial tutorial/infantry/terrain tests, native main-body statements/assertions, server lifecycle, model checks and the final public-lobby/performance invocations remain unchanged. Exact original source, transformation diff, original hashes and excluded filenames are retained. Every assertion source row matches the original in order.

The run uses CPU4 and nice19, with no outer timeout. The original tail subprocess timeouts remain because their source is unchanged. native.log is the complete output. result.json records actual exit, duration and post-run source integrity when the process ends. This is a diagnostic preflight, never a registered full-suite pass or population acceptance claim.
