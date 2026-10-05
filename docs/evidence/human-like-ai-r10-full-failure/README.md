# R10 full-suite failure

The literal `node test.js` run exits one naturally at 2026-10-05T03:54:10.610954+00:00, after starting at 2026-10-05T03:49:33.768137+00:00. Its `test-world-teams.js` subprocess reaches the existing 180000 ms deadline and receives SIGTERM. This is not a full-suite pass: the registered 102-child suite stops in its sixth child, before most AI modules.

All 684 held runtime files match through ten valid checks. HEAD, dependency/runtime bindings and the immutable archive remain unchanged. The suite ran on CPU 4 without an outer timeout. This preserves the original failure; it does not establish why the World teams child exceeded its limit. Earlier same-fixture R8 and R9 logs report successful AI sections of 53.992 and 49.601 seconds, respectively, but those section durations are not the entire child runtime.

The bundle retains the native log, exit, predeclaration, before/after inventories, checks, completion, runner and relevant exact frozen source. `original-source-bindings.json` records physical original paths and hashes. Root independently compares every archived member byte for byte with its original, then checks the resulting archive digest. No assertions or deadlines were changed to obtain a pass.

After this run, the session switched to a restricted sandbox. A direct reproduction exits immediately with `listen EPERM` for 127.0.0.1. GitHub network access is also unavailable. That new restriction prevents reproduction and publication; it is separate from the earlier timeout, whose cause is still unproven.
