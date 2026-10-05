# V21 failed four-row performance protocol

All four original1000-tick rows exited0 and retained990 measured ticks after ten warmup ticks. The exact comparison failed: tick p95 rose from10.746ms to15.880ms, beyond the original2ms allowance. Exact maximum improved49.204ms to34.396ms. The separate count-instrumented comparison passed its p95 and maximum checks and reduced ticks above40ms from8 to3. Those favorable rows do not replace the failed exact pair. Overall performance remains FAIL.

The package retains all four reports and complete logs, preregistration and authorization, executed runner and guardian wrapper, actual pause journal and lease, plus frozen benchmark dependencies. The count variant changes only the final statistics helper and its bytes are verified against that substitution. Original full source mappings remain in the native result and preregistration. AIc99be94a and hands8bd373c3 are historical V21 source, before R8 changes.

The before side switches to frozen legacy AI5293ddb on the same current engine and six-fronts map. It is an AI-only comparison, not an old master engine comparison. Startup costs are reported separately and excluded from the original numerical gates. The legacy zero startup field means the pre-loop branch was not executed. It is not proof of free initialization.

The benchmark runner itself records no signals. The separately authorized wrapper owns the pause and resume procedure; its unchanged native journal and guardian code are retained. No benchmark, signal or test was executed during packaging. The archive keeps the original failed result and every native row.
