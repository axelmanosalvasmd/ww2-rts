# Human-like RTS input: evidence and initial design values

Opened and checked 2026-10-04. The literature supports a camera-limited perception/action loop, input serialization, skill-dependent latency and a speed/accuracy tradeoff. It does **not** establish Easy/Normal/Hard distributions for Three Crossroads or Company of Heroes. The difficulty values below remain explicit design proposals from [the project brief](../human-like-ai-spec.md#difficulty-as-skill-not-cheats), pending opt-in human recordings.

## Primary findings

### RTS perception/action cycles

[Thompson, Blair, Chen and Henrey (2013), PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0075129), Materials and Methods, studied 3,360 StarCraft II players across seven skill levels. A perception/action cycle is a stable point of view containing an action. Their first-action latency is measured **after a point-of-view change**, not after match start. Hotkey selections are excluded from their cycle-action measure. About 87% of recorded time was inside these cycles; approximately 230 ms was their camera-fixation detection threshold, not a reaction floor. First-action latency predicted expertise, with its importance changing across skill levels. The paper does not supply the brief's opening delays or difficulty medians.

Implementation inference: track concern arrival, time until the first meaningful action, actions per visit and dwell time. Repeated inputs inside a practiced sequence should not each repay the entire deliberation delay. Camera arrival and event onset are different clocks. A scheduled action is not automatically a reaction to a new event.

### AlphaStar's interface and constraints

[Vinyals et al. (2019), Nature](https://www.nature.com/articles/s41586-019-1724-z); [opened author PDF, Methods pp. 11-12 and Extended Data Tables](https://storage.googleapis.com/deepmind-media/research/alphastar/AlphaStar_unformatted.pdf). AlphaStar limited execution to **22 non-duplicate agent actions per five-second window**. That is 264 actions/minute by arithmetic, not a directly comparable human APM score. Evaluation added about **110 ms** of observation-processing/execution latency, plus agent-requested waits until the next observation averaging **370 ms**, sometimes seconds. This is not a fixed 200 ms reaction delay.

The camera covered **32x20 StarCraft game units**. Some off-camera enemy attributes were hidden, and some target actions required the camera. Arbitrary unit-set selection still existed, and targeting used a **256x256** location grid inside and outside the camera. The paper acknowledges these differences from human controls. Its constraints were negotiated experimental conditions, not universal human limits.

Implementation inference: enforce attention and motor constraints together. An APM cap alone permits simultaneous map-wide precision. Use this game's human camera and selection interface; do not copy StarCraft spatial dimensions or treat AlphaStar's limit as a difficulty prescription.

### Simple and choice reactions

[Woods et al. (2015), simple reaction study](https://pmc.ncbi.nlm.nih.gov/articles/PMC4374455/), Abstract: mean visual simple reaction latency was **231 ms**, or **213 ms** after correcting hardware delay, in the first experiment with **1,469 adults**. This is one known response to a stimulus in a controlled task. It is a mean, not a median, universal lower bound, mouse-travel time or RTS tactical decision time.

[Woods et al. (2015), visual choice task](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2015.00193/full), Table 2: mean choice latency was **550 ms** overall in Experiment 1 and **472 ms** for its **18-24-year** group. Participants discriminated letter color/shape and selected one of two mouse buttons. The [opened corrigendum](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2015.00350/full) corrects a Figure 7 axis label; it does not change Table 2. These task-specific means cannot validate the game's skill-tier medians.

Implementation inference: distinguish a practiced response, a choice among alternatives, camera switching and pointer movement. Keep the total event-to-command delay measurable rather than calling every component “reaction.”

### Pointer movement and error

[Fitts (1954), original paper reprinted by APA in 1992, opened PDF](https://www.cs.princeton.edu/courses/archive/fall08/cos436/FittsJEP1954.pdf), Table 1 and discussion, varied movement amplitude and target width in reciprocal stylus tapping. Narrower/farther targets required more time; accuracy also depended on the task condition. These data concern physical tapping, not a modern RTS mouse. They establish a relation, not universal mouse coefficients or game-coordinate scatter.

[MacKenzie (1992), author's research paper and reanalysis](https://www.yorku.ca/mack/hci1992.html), Equation 10 and section 3.4, supports `MT = a + b * log2(D/W + 1)`. `D` and `W` must share units, preferably screen pixels here. The effective width relation **`We = 4.133 * endpoint SD`** corresponds to a normal-distribution convention with **96%** inside that effective width, not a requirement that players miss **4%** of clicks. Fitts' law predicts movement time; it does not uniquely specify a two-dimensional endpoint distribution.

Implementation inference: choose initial mouse coefficients and an endpoint-noise model openly as design parameters, then fit them from recordings. Convert the noisy screen click back to terrain before client formation/snapping. Unit-target clicks should retain the same target snapping as the client. Do not claim a hand-tuned Gaussian scatter is “measured Fitts error.”

### Slower tactics RTS and Company of Heroes APM

[Wang, Hou and Sun, Using Simple Design Features to Recapture the Essence of Real-Time Strategy Games, author institution record](https://scholar.nycu.edu.tw/en/publications/using-simple-design-features-to-recapture-the-essence-of-real-tim/) ([paper DOI](https://doi.org/10.1109/TG.2021.3128753)): the opened primary institutional abstract describes recording controls in three versions of the authors' experimental RTS. Company of Heroes is a keyword. The abstract does not publish a Company of Heroes player APM distribution. The full paper was not available from the opened record, so it is not used as quantitative evidence.

Searches for Company of Heroes action-rate studies and replay measurements found community claims but no opened primary dataset establishing novice, average or expert APM ranges with a matching input definition. This is a research gap, not proof that no such dataset exists. Do not state that “CoH players average 40-70 APM” or use an unsourced StarCraft-to-CoH scaling factor. Local recordings of this game are the relevant calibration source.

## Review of every proposed difficulty value

**D** is the authored [difficulty proposal](../human-like-ai-spec.md#difficulty-as-skill-not-cheats). **T**, **A**, **S**, **C**, **F** and **M** are the opened primary sources above. Each cell cites its numerical origin and a relevant research anchor. An anchor supports the model or measurement definition; it does **not** establish that cell's bounds. All cells remain authored game design values. No source supplies the game's skill tiers.

| Measure | Easy | Normal | Hard | Numeric justification and required validation |
|---|---|---|---|---|
| On-screen event to first non-camera input answering it, median | 0.9-1.4 s [D], [S], [C] | 0.5-0.8 s [D], [S], [C] | 0.3-0.45 s [D], [S], [C], [T] | Authored ordering: Easy allows a slower considered response, Normal targets choice-like pacing, Hard targets practiced responses. Laboratory means do not validate these median bounds. Measure the whole observable interval, including attention, deliberation and the first motor response. Report contact and damage events separately. |
| Off-screen alerted event to first answering input, median (camera input allowed) | 3-6 s [D], [T], [A] | 1.5-3 s [D], [T], [A] | 0.8-1.6 s [D], [T], [A] | Authored ordering gives slower levels longer attention-switch delays. Camera research supports the mechanism, not the seconds. Test alert creation to the first causal physical input, plus subsequent command latency. An exploratory minimap contact is a separate population. |
| Average physical-input APM over 60 s windows [D] | 20-35 [D], [A] | 40-70 [D], [A] | 80-120 [D], [A] | Authored workload levels, with no measured CoH conversion. Validate useful input throughput over the full required campaign, including quiet windows. Merely enforcing the upper cap does not satisfy the lower target; dummy clicks or unnecessary group binds cannot justify compliance. |
| Peak physical-input APM over 10 s windows [D] | at most 60 [D], [A] | at most 120 [D], [A] | at most 200 [D], [A] | Authored burst caps. The primary precedent supports an enforced action economy, not these cap values. Check every tick-aligned sliding window, not only fixed windows that can miss a burst. |
| First accepted nonpurchase gameplay order after match start | 4-8 s [D], [T] | 3-6 s [D], [T] | 2-4 s [D], [T] | Authored opening pacing, not measured first-action latency. Test the complete opening, selection and order sequence; an internal opening timer is insufficient. Report first command and first buy separately. The client's skippable intro is not a compulsory human delay. |
| Decision noise | high [D], [T] | medium [D], [T] | low [D], [T] | Authored qualitative skill ordering. The RTS study supports skill differences, not softmax temperatures. Declare numerical implementation parameters separately; test stable commitment, plausible choices and opening variety rather than assuming larger random errors resemble novices. |
| Concerns it can juggle | 1-2 [D], [T] | 2-3 [D], [T] | 3-4 [D], [T] | Authored retained-concern counts, not empirical human memory spans or simultaneous attention. Validate remembered competing concerns, displacement/revisit behavior and neglected work while only one concern receives attention. Increasing an urgency cap alone does not implement these counts. |

The meaning of “reaction” must be fixed before a new campaign. The on-screen row concerns the first causal **non-camera physical input**, which may be selection or a key before a command. The off-screen row explicitly permits a camera response. Attempted and accepted commands are later endpoints reported independently. This distinction resolves the brief's underspecified on-screen endpoint; it does not change any numerical bound or excuse failed gates. If the acceptance contract instead requires completed commands, apply the same bounds to that endpoint and mark failures as failures.

The first-order row follows the current tool's nonpurchase order population, which excludes `buy`, `stance` and `recover`. A first buy is a different output. Freeze both definitions with the campaign rather than selecting whichever endpoint passes afterward.

[D]: ../human-like-ai-spec.md#difficulty-as-skill-not-cheats
[T]: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0075129
[A]: https://storage.googleapis.com/deepmind-media/research/alphastar/AlphaStar_unformatted.pdf
[S]: https://pmc.ncbi.nlm.nih.gov/articles/PMC4374455/
[C]: https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2015.00193/full
[F]: https://www.cs.princeton.edu/courses/archive/fall08/cos436/FittsJEP1954.pdf
[M]: https://www.yorku.ca/mack/hci1992.html

The global **0.2 s** new-event reaction floor is a design rule from [D], consistent in scale with [S]'s task mean but not a physiological bound. Apply it only to causal responses to newly observed information. Prepared motor inputs may follow faster without reacting to a fresh event.

The ban on orders more than one screen apart within **0.25 s** is a locality design rule from [D], not a measured camera-switch minimum. The **one command per seat per tick** rule is an engineering invariant from [the hands brief](../human-like-ai-spec.md#phase-4-act-the-hands), not a physiological rate. At this game's **20 Hz**, a tick is **50 ms** (`shared/sim.js:22`); this invariant alone allows unrealistic rates. Keep it alongside the slower input budget and camera checks.

The handover look of at least **1.5 s** is also an authored rule from [the hands brief](../human-like-ai-spec.md#phase-4-act-the-hands), not an RTS takeover measurement. The current hands implement a takeover opening gate in `shared/ai-hands.js` `createHands()`; verify elapsed time from the actual handover, not the next planning invocation.

## Internal timing and observable reaction

### Historical double-counting diagnosis and its correction

The source inspected after review round 1, before the timing-budget correction, used three serial stages for a newly attended fight: the commander's `deliberateUntil`, the hands' full `reactionDelay()`, and completion of the first motor input. For that historical combat path, minimum deliberation was approximately **0.50/0.30/0.25 s** for Easy/Normal/Hard: round the **8/5/4 tick** lower values times the combat multiplier **1.2**, then divide by **20 Hz**. Adding the full hands delays of **0.90/0.50/0.30 s** gave **1.40/0.80/0.55 s** before motor completion. These were implementation lower bounds, not human measurements or revised acceptance targets. The archived V8 diagnosis must not be read as current behavior.

Current `reactionDelay(hands, context, tick, motorTicks)` in `shared/ai-hands.js` treats its range as a target for the **complete first input**. It subtracts elapsed time since the causal event and the first motor duration before adding any remaining wait. `advanceHands()` prepares that motor duration before calculating the wait. Deliberation and motor travel therefore consume one response budget. Slow attention, long gestures and backlog still finish late; the correction does not shorten physical movement to force compliance. The commander's emergency path waits for an initial decision interval before queuing work (`shared/ai-commander.js` `runCommander()`), so response attribution and the selected first gesture still matter.

The original completed-input bounds remain the gates. A sampled internal delay inside those bounds cannot establish that the observable median passes. Report elapsed event-to-completion time and failures directly, with contact, damage, key responses and pointer responses distinguished. A practiced response to an already selected squad can complete earlier than choosing and clicking another squad. This allows a fast path without claiming every tactical response is a simple reaction.

### What Thompson's actual supplement establishes

I downloaded and inspected the publisher's **[Figure S1 EPS](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0075129.s001&type=supplementary)** and **[Materials S1 DOC](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0075129.s017&type=supplementary)**, including rendering the EPS. The [article's S1 caption][T] gives **719.94 ms mean and 217.3 ms SD**. Materials S1 defines each player's PAC action-latency variable as their mean time to the first action within a PAC. The caption consequently summarizes player-level mean latencies across the sample; it is neither a pooled median of individual reactions nor a skilled-player median.

Figure S1 separates leagues. Its professional panel is visibly shifted toward shorter latencies than lower leagues, with values below and above the Hard interval. It does not print an exact professional median, and reading one from histogram bins would imply unsupported precision. The pooled mean and SD cannot establish that an authored **0.3-0.45 s [D]** median for a different task is impossible. They also cannot confirm that range.

The clocks and endpoints differ. Thompson starts a PAC at camera fixation onset and uses the first recorded game action, excluding hotkey selects from PAC variables. Materials S1 describes timestamped replay commands and excludes screen movements from actions. It does not timestamp the start of mouse travel or a finger movement. This game's on-screen event occurs within the current view, and its first causal non-camera physical input may be a completed selection before any command. Attention may already be on the fight, or may be elsewhere. These are related measures of performance, but they are not interchangeable stimuli or endpoints.

The Woods studies likewise measure the registered button response, without an aimed pointer movement. Their simple and choice means do not prove a lower bound for practiced RTS players or a median for this mixed event population. Conversely, a laboratory mean cannot justify calling a choice plus arbitrary pointer travel a measured fast reaction. Fitts' law supplies a movement-time relation, not a constant to add to every reaction. Whether mental preparation overlaps movement is task dependent; the current budget is an authored scheduling model requiring local validation.

This corrects the scientific inference in the immutable round 2 review: the pooled Thompson statistic does **not** prove the Hard completion target impossible. The target remains an optimistic authored requirement, not a published human norm. Keep the original RT bands and completion endpoints while repairing causal attribution, decision paths and useful throughput. Record motor onset as a secondary endpoint if useful, but do not relabel it as completed input or use it to pass the existing gate. None of the opened sources establishes this game's event-to-motor-onset bands. No additional numeric target is adopted here.

APM floors also remain unchanged. The lack of a matching Company of Heroes dataset does not justify reducing an authored workload target while useful scouting, production or combat work remains undone. A future calibration must use opted-in human records with equivalent event eligibility, inputs and campaign conditions, rather than the current bot's output.

### Other motor parameters are also authored

The current code's key-duration ranges are **0.15-0.25 s** Easy, **0.10-0.18 s** Normal and **0.075-0.13 s** Hard (`shared/ai-hands.js:9-11`). These are designer choices, not measurements of RTS keystrokes from [S] or [C]. The pointer `(a, b)` pairs are **(0.12 s, 0.11 s/bit)** Easy, **(0.09 s, 0.085 s/bit)** Normal and **(0.07 s, 0.065 s/bit)** Hard at the same source. [F] and [M] justify the relation and fitting method, not these coefficients. The endpoint-noise multipliers **1.8/1.0/0.6** and decision-noise settings **1.0/0.5/0.2** are authored too. Their numerical origin is `HUMAN_SKILLS`, not a paper. Fit pointer coefficients from actual screen distances, widths and observed movement durations; validate miss and correction rates without assuming these multipliers have empirical meaning.

## Measurement definitions and calibration

Count a physical input as a click, completed box selection, keystroke/group recall, camera jump or continuous pan gesture. Record command count separately: human dispatch can turn one mixed-selection click into several network commands (`client/orders.js` `dispatch()`). Document continuous pan segmentation so “camera moves count” does not turn the sampling rate into APM. Idle camera-beat samples are not motor inputs. Rejected or ineffective command clicks remain attempted inputs.

Include quiet periods and the opening in APM. For a window with `n` physical inputs and length `w` seconds, input APM is `60*n/w`. The current tool uses full non-overlapping minute windows for average workload and ten-second windows sliding each simulation tick for bursts (`tools/ai-humanity.mjs` `windows()`). State that definition when comparing reports. Exclude deliberate game pause time consistently for humans and AI; do not discard slow or silent gameplay windows.

An on-screen stimulus exists when a hostile unit first enters the screen tier or an own on-screen unit loses health. Stamp its screen status and signal-arrival tick at event creation, not later when attention picks it. The current perception layer records `screen-contact` and `screen-damage` independently of selected concerns (`shared/ai-perception.js` `perceive()`). Damage episodes and additional heavy-loss events have explicit emission rules; record these rules because they determine the event population. A camera move that reveals an enemy creates a screen-arrival stimulus at that arrival, not an on-screen event backdated to its earlier minimap dot.

For every stimulus retain event creation, original simulation/observation tick where available, concern arrival, first causal non-camera input, first attempted command and first accepted command. On-screen first response excludes camera inputs even if a camera adjustment occurs next. Off-screen alerts may count their first causal camera input. A queued buy or unrelated movement does not answer a combat stimulus merely because it happens afterward. Minimap contacts remain exploratory and separate. Ordinary human recorder logs without an independently recorded stimulus population cannot fit reaction distributions.

Keep the entire event population, including stimuli that never get attention, age out of the concern queue or cause no valid order. At recording end an unanswered event has a **right-censored delay**: the only known fact is that no response occurred during the elapsed observation period. Report answered and unanswered counts, answer fraction and censored durations by event type, plus completed-response medians. Do not insert zero, silently drop unanswered events or treat a timeout as a completed response. A completed-response median is conditional on answering; it cannot by itself establish prompt responses to all events. If a stimulus deliberately needs no action, record that adjudication separately using a rule chosen before inspecting results.

The current `reactionMetrics()` reports censored durations and first-action, attempted-command and accepted-command endpoints separately (`tools/ai-humanity.mjs:52-93`). Preserve that separation in results. Compare only reports with matching measurement versions and emission rules. Never compare the old “on-screen” minimap/camera metric directly to the revised stimulus metric.

Record opening families from purchases, group objectives and persona rather than counting mouse jitter as variety. Keep rules, seeds and modes fixed between baseline and replacement. Validate every authored table row over the original required campaigns, then fit timing from opted-in local human logs with equivalent stimulus and input definitions. Matching a median alone is insufficient when reaction tails, unanswered events, wasted clicks or neglected production differ.
