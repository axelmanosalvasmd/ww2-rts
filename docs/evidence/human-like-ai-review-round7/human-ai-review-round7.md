# Human-like AI review, round 7 (interim, not release approval)

Scope: read-only review of the frozen V16 Conquest Hard raw casefiles plus current planner and grader source. No campaign, suite, bench or browser run. Scratch scripts ran single-core on logical CPU 3 at nice 19 (`/tmp/r7-*.mjs`, `/tmp/r7-*.py`; extracts in `/tmp/r7-hard.json`, `/tmp/r7-hard2.json`). No ROOT file modified. Event, censor and raw scores untouched.

Current source hashes checked: `shared/ai.js` 76f02609, `shared/ai-commander.js` 19112a1e, `shared/sim.js` 7bc57ac1, `tools/ai-humanity.mjs` 7c80a300. V16 was frozen at checkpoint 3bac0c09, before the attended-guard, once-per-visit hesitation and unseen-hit fixes. Nothing below is a current-source pass claim.

Raw files: all 20 `conquest-hard-{1..20}.json` under `/tmp/human-ai-final-v16/raw-matches/conquest/`, matching `conquest-raw-manifest.json`. Extraction reproduced the readout exactly: 305 required rows (189 contacts, 111 answered; 116 damage, 77 answered).

## Verdict

The Hard reaction failure is mostly real gameplay, with two specific measurement defects that need a reviewed fix. Correcting both would not pass Hard. Policy is partly wrong (two narrow, evidenced endpoint gaps), gameplay is wrong (most censoring is genuine non-response), and the mutually-out-of-range contact population needs further evidence rather than an exemption.

Contact-only Kaplan-Meier median from the raw rows is 5.45 s. Answered contacts alone have a median of 0.85 s (p25 0.5 s). Linked answers break down as decision median 0.15 s (p75 1.95 s), queue wait 0.05 s, and motor to first completed input 0.35 s. The motor component alone is at the top of the Hard 0.3 to 0.45 s band (category d below).

## Finding 1 (highest impact, category c): real timely responses with uncredited purposes are censored forever

In 27 of the 78 unanswered Hard contacts, the planner attended that exact stimulus with non-camera physical inputs whose native `concern` is `stimulus:<creation id>`. The first such input came within 0.45 s in 6 cases and within 1.0 s in 11. The resulting commands include `support:dive`, `support:artillery` (2), `support:recon`, `ability` (6, one rejected), `attack` (4), `amove` (10) and `retreat` (7). Not all are useful (recon and some retreats target other actors), but some clearly are.

Exact proof, `conquest-hard-15.json` slot 0, creation `observed-screen:3174:50`:
- Public scene at 3174: own rifle 18 at (109, 63), heavy cover, 100% health, idle. Visible enemy tank 21 at (122.7, 90.7), idle, 30.9 m away. Tank range 35 m covers the rifle, and rifle damage against vehicles is ineffective. The rifle is correctly `required` (no fortified hold under a legal armor threat).
- Native inputs: `support-key` at 3182 (reactionStart 3174, concern `stimulus:observed-screen:3174:50`), `place-click` at 3191.
- Native command at 3191: `{"t":"support","kind":"dive","x":122.48,"z":90.39}`, accepted. That is an air strike centered 0.4 m from the threatening tank.
- Row `answer`: none. The event is end-censored at 21.3 s.

The cause is a predicate mismatch between planner and grader:
- The planner credits support strikes against a nearby hostile (`shared/ai-priority.js:38-43`) and `suppress`/`ap` abilities on the current target (`shared/ai-priority.js:51-55`). After such a command, the event counts as answered and drops out of `prioritizeVisit` (`shared/ai-priority.js:65-66`), so the planner never responds again.
- The grader credits only `smoke` support (`tools/ai-manual-response-policy.mjs:221`) and only grenade or satchel abilities (`tools/ai-manual-response-policy.mjs:213-219`). The adopted v2 doc defers wider support forms on purpose ("need separately reviewed public footprint predicates").

So the deferral is documented, not a coding slip. Its effect, though, is that a 0.40 s Hard-band response counts as never answered. The planner then never re-answers, which guarantees end censoring. The latest fixes do not touch either predicate.

Recommendation: do not credit these events retroactively in V16. Either (a) declare a reviewed public footprint predicate for damaging support (artillery, strafe, bombing, dive) and the `suppress`/`ap` abilities, using the same strict rules as smoke (actual accepted command, footprint over a visible hostile that legally threatens the affected actor, no visible friend inside the footprint), or (b) make the planner's `commandServesObservedEvent` no stricter than, and no looser than, the grader's purpose table, so the planner does not mark an event answered when the grader will not credit it. Option (b) is a gameplay change and must not add redundant clicks. Both need root and Julio review before any prospective campaign.

## Finding 2 (category b/c): a later neighboring contact created during the earlier response's motor sequence can never be answered

Exact proof, `conquest-hard-12.json` slot 1:
- Contact `observed-screen:3150:44` (enemy 18 at 131.6, 96.6) is required for idle rifle 14.
- Operation `operation:1:2213` is queued at 3152 with declared event `observed-screen:3150:44` and command `amove [[14,131.3,96.2]]`. Motor receipts: `select-click` 3153 to 3159, `attack-key` 3159 to 3161, `place-click` 3161 to 3169. The command is accepted at 3169.
- Contact `observed-screen:3162:45` (enemy 24 at 122.0, 101.5, 10.8 m from the first contact and 10.6 m from the amove destination) is created at 3162 during the `place-click`. Rifle 14 is still publicly idle, so the row is required with `manualUnits [14]`.
- No later operation can link to it. The operation declared at 3152 predates the creation, so the v2 rule correctly refuses a retrospective link. Once the amove lands at 3169, rifle 14 is no longer idle. `commandServesObservedEvent` then requires an idle armed actor within 45 m (`shared/ai-priority.js:21-24`) and will never relate a command to this contact. The row is end-censored at 21.9 s.

The same pattern appears in `conquest-hard-11.json` slot 1 `observed-screen:2126:23` (in-flight `operation:1:1417` amove for `observed-screen:2114:22`, ending 2132, destination 8 m from the contact) and in `conquest-hard-11.json` slot 2 `observed-screen:1134:21` (`operation:2:725` for `observed-screen:1126:20`, ending 1142, destination 12 m away).

Across Hard, 22 of the 78 unanswered contacts had an operation already queued and still physically incomplete at creation that included a manual actor. In 12 of those the destination lies within the 24 m event neighborhood. In 8, the in-flight operation was itself a linked response to an earlier screen event. A few in-flight rows have a null completion (abandoned motors) and should not count.

The doc states the principle ("An already-started protective key for an earlier cue can cover a later cue"), but exemption 3 is coded only for a retreat key covering screen-damage (`tools/ai-manual-response-policy.mjs:104-131`, specifically line 115). Contact rows have no in-flight analogue. This is a gap, not a license. A narrow candidate would be a creation-time `paid-response-in-flight` for screen-contact: an actual physically started (not merely queued) amove or attack whose native start receipt is active at creation, whose actual selection includes the actor, whose declared earlier cause independently recomputes as required, and whose public purpose geometry (`tools/ai-manual-response-policy.mjs:202-203`) also serves the new contact. Like the retreat case, it would give no reaction credit. As a diagnostic only, removing those 12 rows moves the contact-only KM from 5.45 s to 3.25 s, which is still far outside Hard. It must not be used as a substitute gate.

## Remaining population by category (Hard contacts)

(a) Real missing responses or inattention. Of the 78 unanswered contacts, 16 never saw another command to the manual actor, 35 saw the next command only after 5 s, and 51 had no planner input attending that stimulus. Example: `conquest-hard-18.json` slot 2 `observed-screen:3270:58`. Rifle 18 sits in heavy cover at (55, 61), and an enemy MG is 32 m away inside its 36 m range while the rifle's 28 m range cannot reach back. The planner spent the next inputs on other stimuli (3266:56, a retreat for 3274:59) and never returned before the end, 16.5 s later. That is triage, not a measurement artifact. Gameplay is wrong here. The latest attended-guard and hesitation fixes may change this, but only a final-source run can show it.

(b) Holds or automatic actions possibly still falsely required. In 106 of 189 required contacts (56%), the idle actor and the contact are mutually out of range, mostly 30 to 45 m; in 66 the enemy itself is idle. Under the adopted v2 rule ("an idle squad in the open ... does not qualify") these are correctly required. I found no evidence that justifies exempting them. Whether a Hard player must respond to a passive squad 40 m away is a target-definition question that needs human-log or reference evidence, not a scorer change. The answered ones in this bucket are fast (median 0.875 s), so their weight comes from censoring, not slow answers. The two specific measurement gaps that do qualify are Findings 1 and 2.

(c) First-action endpoint bugs: Findings 1 and 2. Separately, 36 contacts have the actor within its own weapon range but no clear public sightline. They are correctly not exempted as automatic combat.

(d) Irreducible motor cost. The median from link enqueue to first completed physical input is 0.35 s (p25 0.25 s), dominated by `select-click` duration. With the 0.2 s floor and a nonzero decision step, a Hard median of 0.45 s or less needs decisions of about 0.1 s or less on more than half of all required events, censored ones included. That is tight but not proven impossible. The Fitts and select parameters were reviewed earlier and should not be retuned to fit.

## Answers to the explicit questions

- Is policy wrong? Partly. Two narrow, evidenced gaps: uncredited damaging support and abilities (Finding 1), and no in-flight coverage for contacts (Finding 2). Both need reviewed predicates under the existing proof standard. No threshold or numeric change.
- Is gameplay wrong? Yes, for most censored rows: no response, very late response, or attention spent elsewhere. Planner and grader also disagree on what counts as an answer, and the planner stops pursuing events the grader still counts as open (Finding 1).
- Do targets need further evidence? Yes, for the mutually-out-of-range idle sighting population (56% of required Hard contacts) and the off-screen required population, which is still undeclared.

Unresolved goals still stand: a full-source pass, reaction, APM (Hard 57.834 against 80 to 120), the off-screen population, performance, final balance and browser checks, a final independent review, then PR merge. V16 numbers are historical and predate the latest guard, hesitation and unseen-hit fixes.
