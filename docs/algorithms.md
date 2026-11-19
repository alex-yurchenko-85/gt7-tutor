# Core algorithms

Calculations of `packages/core`. Read before a change to `packages/core/src`. The packet format is in `docs/protocol.md`.

## Rules of the core

- Pure TypeScript. No import from Node, NestJS, storage or audio. No clock read. Time is an argument (`receivedMonoMs`, `clockMs`, `nowMonoMs`).
- The same samples and configuration give the same decisions. `replayCoach` and the golden traces in `fixtures/golden/` use this.
- Units: m, m/s, ms, pedals 0 to 1. km/h only for spoken and shown values: `targetSpeedKph`, `target.roundDownKph`, and `comparableSize`. `kph(n)` in `DEFAULT_CONFIG` gives `n` km/h in m/s.
- Calibration values are in `DEFAULT_CONFIG` (`config.ts`). Fixed limits outside it:

| File | Limits |
| --- | --- |
| `packet-clock.ts` | `ENVELOPE_RISE` 0.02, `PACKET_STEP_MAX` 600, `CLOCK_WARMUP_PACKETS` 600 |
| `sequence.ts` | `DEFAULT_SEQUENCE_LIMITS`: reorder window 64, forward gap 600 |
| `cue-text.ts` | Target speeds 30 to 350 km/h, `MAX_SPOKEN_TURN` 10, `estimatedPhraseMs` |
| `match.ts` | Minimum travel for a travel direction: 0.05 m |
| `@gt7/contracts` | Cue offsets −500 to +1000 ms in steps of 100 ms, side cue distances 0.5 to 3 m, `WIDE_APEX_M` 2, `RECURRING_MIN_ATTEMPTS` 3 |

## Data flow

```text
datagram → SampleStream (decode, drop duplicates, packet time) → Sample
Sample → TrainingRun.step = AttemptTracker + Matcher + live gap + next cue + Coach
reference samples → analyseReference → path, events, corners, reference time
attempt samples + ReferenceAnalysis → buildReview → findDifferences → recurring → focusSentence
```

| Step | File |
| --- | --- |
| Decode | `decode.ts` |
| Packet order | `sequence.ts` |
| Packet time | `packet-clock.ts` |
| Game timer | `game-timer.ts` |
| Attempt start, pause, end | `attempts.ts` |
| Missed start | `missed-start.ts` |
| Reference path | `reference.ts` |
| Reference analysis | `reference-analysis.ts` |
| Demonstration range | `demo-range.ts` |
| Position on the reference | `match.ts` |
| Reference events | `cue-events.ts` |
| Corners | `corners.ts` |
| Voice decisions | `coach.ts`, `guidance.ts`, `coach-replay.ts` |
| Training step | `training-run.ts` |
| Live gap | `timing.ts` |
| Phrases and clip keys | `cue-text.ts` |
| Comparison | `compare.ts` |
| Differences, recurring | `findings.ts` |
| Turn of a position, time lost per turn | `turns.ts` |
| Focus sentence, brake reaction | `focus.ts` |
| Exercise status, medal | `progress.ts` |

## Packet time

`PacketClock` gives each sample `clockMs` from the packet ID and the arrival time. Arrivals come in bursts. About 5 % of packets arrive 0 to 3 ms after the previous packet. A late packet can be 60 to 80 ms late. The packet rate changes between about 59.2 and 59.9 per second.

| Step from the last packet ID | Added time |
| --- | --- |
| First packet | `clockMs` = arrival time |
| 1 to 600 ahead | `steps × 1000 / 60` + change of the envelope, never below 0 |
| Same, or up to 64 behind | 0 |
| Any other step | Arrival difference, not below 0. A new envelope starts. |

Envelope = arrival time − nominal time of the packet number. An earlier arrival moves the envelope to it at once. A later arrival moves it by 2 % of the difference (`ENVELOPE_RISE`).

A range read starts the clock 600 packets (`CLOCK_WARMUP_PACKETS`) before the first row (`clockWarmupStart`). These rows move the clock and the duplicate check. They give no sample. After 600 packets the envelope does not depend on the start row, so a range read gives the live times.

`clockOf(sample)` = `clockMs`, or `receivedMonoMs` when `clockMs` is absent.

| Time | Use |
| --- | --- |
| `clockMs` (measured) | Reference point times, review time series, time lost |
| `receivedMonoMs` (real time) | Silence, cue freshness, coach decisions, matcher extrapolation |
| Game timer | Attempt time, live gap, review gap |

## Continuity

Two samples in a row are broken when:

| Break | Rule |
| --- | --- |
| `silence` | More than 1000 ms between them |
| `car-changed` | Different car ID |
| `discontinuity` | Distance > `max(speed) × elapsed time + 20 m` |

`continuityBreak` checks all three. `positionBreak` checks `car-changed` and `discontinuity`. The attempt tracker and the demonstration range use `continuityBreak`. `buildReference` uses `positionBreak`.

A sample is driven when it is not paused and not loading. The player has control when `playerSession` is true and the sample is driven.

## Reference path

`buildReference(samples)`:

1. Reject a sample with a field that is not finite. Reject a range with a `positionBreak`.
2. Keep the driven samples. Remove repeated identical positions at both ends.
3. Sum the straight distances between samples: `lengthM`.
4. Resample to one point per metre, plus the end point. A point has `sM`, position, speed, throttle, brake, `timeMs` and `timerMs`.
5. `timeMs`: active packet time from the start (`clockOf`). Paused and loading time is not counted.
6. `timerMs`: the interpolated `gameTimerMs`, not relative to the first point.
7. Tangent of a point: direction from the previous point to the next point.

`pointAt(path, sM)` interpolates between two points. A reference never changes after `buildReference`.

## Reference analysis

`analyseReference(samples, config)` builds the path, the events (`buildCueEvents`) and the corners (`findCorners`) once and returns a `ReferenceAnalysis`. Its `timeMs` is the timer value of the last sample of the range. `Coach`, `TrainingRun`, `replayCoach`, `buildReview` and `focusSentence` take the analysis. No other code calls `buildCueEvents` or `findCorners` for a reference.

## Game timer watch

`GameTimerWatch` reads `gameTimerMs` and gives `started`, `finished`, `left-track` and `restart` with the `rawIndex` and the game time. It is active from `started` to one of the other events.

| Event | Rule |
| --- | --- |
| `started` | Watch not active. Session matches (below). Previous value 0. This value 1 to 50 ms (`gameTimer.startMaxMs`). |
| `left-track` | Value −1. Watch becomes inactive. |
| `restart` | Value 0. Watch becomes inactive. |
| `finished` | Sample not paused. Value did not increase for 3 newer packets in a row (`gameTimer.stillPackets`). A paused packet clears the count. Watch becomes inactive. |

- Session `player` needs `playerSession` true. Session `demonstration` needs it false. Only the demonstration range uses `demonstration`.
- While active, a packet ID equal to the last counted ID or up to 64 behind changes nothing (`isRepeatedPacket`).
- `finished` has the `rawIndex` of the first packet with the final value. Its game time is that value.
- After any event, the next start needs the full `started` rule.

## Attempt lifecycle

`AttemptTracker` states: `waiting`, `driving`, `paused`, `finished`. Each start takes a new generation. A cue of an older generation is never played.

Start: the tracker is not `driving` or `paused`, and the watch gives `started`. The event has reason `game-timer`. Its time is the sample time minus the timer value of the sample.

While `driving` or `paused`, the first true row applies:

| Condition | Event, reason |
| --- | --- |
| More than 1000 ms without a sample | `aborted`, `silence` |
| `playerSession` false | `aborted`, `player-session-ended` |
| Watch gives `left-track` or `restart` | `aborted`, `left-track` or `restart` |
| Break between samples | `aborted`, `car-changed` or `discontinuity` |
| `loading` true | `aborted`, `loading` |
| State `paused`, `paused` false | `resumed` |
| State `driving`, `paused` true | `paused` |
| Watch gives `finished` | `finished`, `game-timer` |

- An event has `atMonoMs` and `atClockMs`. Only `finished` has `gameTimeMs`: the final timer value.
- `finished` has the `rawIndex` and time of the first sample with the final value.
- `abortByUser` gives `aborted`, `manual`. Nothing else ends an attempt from outside.
- An abort for any reason other than the watch resets the watch.

**Live gap** (`gapToReferenceMs`) = `gameTimerMs` of the sample − `timerMs` of the matched reference point. Positive: slower. `null` when no attempt runs, no match exists, or the value is 0 or −1. A pause keeps the value.

**Review gap** = game time of the attempt − reference time.

## Missed start

`startMissed` is true when all are true:

1. A training is armed.
2. No attempt runs. A paused attempt runs.
3. `playerSession` is true.
4. The value increases, and the previous value is above 0.
5. The value is not the run of the last attempt. After an attempt ends, this stays false until the value is 0.

Condition 3 excludes the background scene. Condition 4 excludes a fixed value after the finish, a false jump from 0 and a pause. Condition 5 excludes the count after a −1.

## Demonstration range

A capture of a demonstration also holds the background before and after it. The demonstration runs the game timer with `playerSession` false.

**`demonstrationRuns(capture)`** gives the complete demonstration timer runs in order. The search starts at the first sample, then after each run. The function keeps a run when both checks pass:

- Scene change: a `continuityBreak` lies between the search start and the first sample of the run.
- Movement: the car moves more than 10 m in the run (`demoRange.minMovementM`).

**`cutToTimerRun(capture, range, session)`** cuts a range to the timer run inside it. The cut starts at the last sample with value 0 before the start. It ends at the `rawIndex` of `finished`. The first packet with the final value must lie inside the range. A timer that runs before the range does not count. The result has the game time of the run (`TimerRunRange.gameTimeMs`).

**`findDemoRangeCandidates(captures)`** needs two or more captures:

1. Collapse repeated samples with the same state: position within 0.05 m, speed within 0.1 m/s, pedals within 0.02, same gear and car.
2. Find pieces of at least 10 samples that the first capture shares with each other capture. Join pieces with a gap of at most 2 samples and no `continuityBreak`.
3. Keep runs that all captures share, at least 60 samples long. Remove a run when more than half of it in the first capture lies in a longer run.
4. Score each run: 2 for a break before its first sample, 1 for movement above 10 m.
5. Cut each run with `cutToTimerRun(…, 'demonstration')`. A run without a complete timer run in every capture keeps its uncut ranges and has `timed` false.
6. Eligible: both checks pass and `timed` is true. With three or more captures and exactly one eligible run, that run is not ambiguous. Else every run is ambiguous.
7. Order: timed first, then score, then samples in the first capture (more first), then earlier start.
8. Keep only the first of two runs with the same cut range in the first capture.

**Reference time** = the final timer value of the cut range. The first point has `timerMs` 0. A range without a timer run has no reference time.

**`matchesReference(capture, path)`** gives the raw range of the first run that follows the path, or `null`. Limits in `DEFAULT_CONFIG.demoRange`.

A sample follows the path when all are true:

- The matcher gives a match.
- Lateral and height difference ≤ 0.5 m.
- Speed difference ≤ 5 % of the reference speed + 0.5 m/s.

A sample that does not follow ends the run. A run passes when:

- It starts ≤ 1 m after the path start and ends ≤ 1 m before the path end.
- Median speed difference ≤ 1 % of the reference speed. Below 1 m/s the divisor is 1 m/s.
- 95th percentile of the lateral distance ≤ 0.2 m.
- Median throttle difference ≤ 0.05 and median brake difference ≤ 0.05.

## Matching the car to the reference

`Matcher.step(sample)` gives a `Match` or `null`:

1. Window: 0 to 20 m for the first sample. Then from 5 m behind the last match to `max(20 m, speed × elapsed + 10 m)` ahead.
2. Project the position on each one-metre segment of the window. The matcher clamps a projection up to 1 m past a segment end.
3. Keep candidates with lateral distance ≤ 8 m and height difference ≤ 3 m.
4. Travel direction: the last two positions (≥ 0.05 m apart), else the velocity. At 2 m/s or more, prefer candidates with the tangent within 45° of it.
5. Cost = `distance + 0.5 × |sM − expected sM|`. Expected `sM` = last match + `speed × elapsed`. The lowest cost wins.

| Field | Meaning |
| --- | --- |
| `sM` | Distance along the reference, m |
| `lateralM` | Side distance. Positive is right of the travel direction. |
| `heightM` | Height difference |
| `headingErrorDeg` | Travel direction against the tangent |
| `velocityErrorDeg` | Velocity against the tangent, `null` below 2 m/s |
| `trusted` | Heading check passed and ` | lateralM | ` ≤ 8 m |
| `reference` | Reference point at `sM` |

Guidance uses only trusted matches.

## Reference events

`buildCueEvents(path)`. A condition must hold for 3 points in a row.

| Event | Rule |
| --- | --- |
| `brake` | Brake > 0.10. Ends at ≤ 0.10. Zones closer than 5 m join. |
| `ease-off` | Throttle falls from ≥ 0.5 to ≤ 0.1, and no brake zone starts within 1000 ms |
| `throttle` | After a release or brake zone, throttle > 0.5 outside a brake zone |

- Key: `<kind>@<sM rounded>`, for example `brake@332`. Use `eventKey`, `eventKeyKind`, `eventKeyPlace` from `@gt7/contracts`.
- The builder drops a second event of the same kind (not brake) within 5 m.
- The builder drops an event in the last 20 m.

| Value | Rule |
| --- | --- |
| Target speed, brake | Speed at the end of the zone |
| Target speed, throttle | Reference speed 2 s later |
| Target rounding | Down to 5 km/h. Outside 30 to 350 km/h: no target. |
| `Hard brake` | Speed loss ≥ 16.67 m/s (60 km/h) |
| `Brake` | Loss ≥ 6.94 m/s (25 km/h) |
| `Light brake` | Smaller loss |
| `Big stop` before a brake | Entry ≥ 55.56 m/s (200 km/h) and loss ≥ 27.78 m/s (100 km/h) |
| `Full throttle` | Reference throttle reaches 0.95 within 2 s. Else `Throttle`. |

`cue-text.ts` makes all cue text and clip keys:

- Clip = phrase key, for example `hard-brake`. Follow clip of a brake with a target = `speed-<km/h>`, played only with `Speak target speeds`.
- Spoken text with targets on: `Hard brake. Eighty five`.
- `CUE_WORDS` in `@gt7/contracts` gives the shown words.
- `clipsOf(events, corners)` lists every clip of a reference. These are the event clips and follow clips, `Big stop` if any, `Tighter` if a corner exists, and `Voice check`. It adds the side cues, the guidance cues and the focus sentences up to turn 10.

## Corners

`findCorners(path, events)`:

1. Curvature at each metre: angle between the tangents 10 m before and after, divided by 20 m. The sign gives the direction.
2. Window: from each `brake` or `ease-off` to 40 m after the next `throttle`, or to the path end.
3. Apex: largest curvature in the window. Radius > 150 m there: no corner.
4. Turn-in: last point before the apex with curvature below one third of the apex curvature.
5. Number corners by apex order from 1.

`outsideM(corner, lateralM)` = `−insideSign × lateralM`. Positive: outside.

`turnZones(corners, lengthM)`: one zone per corner, from the turn-in to `apex + (apex − turn-in)`. It ends earlier at the next turn-in or the section end. Zones can overlap or be empty when turn-ins are out of apex order.

## Voice decisions

`TrainingRun.step(sample)` is the one training step, live and in `replayCoach`:

1. Give the sample to `AttemptTracker`.
2. On `started`: new generation, reset the matcher, guidance active. Return the start samples (timer 0 and start).
3. Compute `startMissed`.
4. If no attempt runs, stop. Match, gap and next cue are `null`.
5. Match the sample. Compute the live gap and the next cue that is not muted.
6. Give the sample to `Coach`. A new generation resets the coach on its first step.

`TrainingRun` expects unique samples in packet order. `Coach.step` gives at most one cue per sample. The coach gets `CoachSettings` (muted keys, targets on, offsets, side cue distance) once, at construction.

### Silence

The coach gives no cue when:

- The player has no control, or the sample is older than 150 ms.
- Guidance waits for a restart: the car passed the path end.
- The match is missing or not trusted. Guidance is then suspended.

### Due time

Time to an event: `(−v + √(v² + 2ad)) / a` for distance `d`, speed `v`, acceleration `a` > 0. With `a` = 0: `d / v`. `a` = speed change over the last 300 ms, never negative, 0 with less than 100 ms of data.

| Rule | Value |
| --- | --- |
| Cue due | time ≤ device delay + 500 ms + cue offset + sample period |
| `Big stop` due | time ≤ device delay + 2000 ms + offset of its brake + sample period |
| Sample period | Time since the last coach step, ≤ 100 ms. First step: 1000 / 60 ms. |
| Cue offset | −500 to +1000 ms, step 100 ms. Positive is earlier. |
| Too late | time < device delay |

`Big stop` is also too late in two cases. Its phrase cannot end before the lead of its brake. Or a brake or ease-off between the car and its brake becomes due before the phrase ends. It gets `cooldown` for 1500 ms after a last cue with priority ≥ 90.

### Targets and mutes

| Cue | Event kind | Place | Mute key |
| --- | --- | --- | --- |
| Brake, ease-off, throttle | `brake`, `ease-off`, `throttle` | The event | Event key |
| `Big stop` | `big-stop` | Its brake | Key of its brake |
| `Tighter` | `tighter` | Decision place | `tighter` |
| `Keep left`, `Keep right` | `keep-left`, `keep-right` | Decision place | `keep-left`, `keep-right` |
| `Guidance paused`, `Guidance resumed` | `guidance` | None | None |

- The coach checks mutes once, when it chooses the cue of a sample.
- A mute comes first: a muted candidate gets `muted` also when it is too late.
- A muted throttle event opens no window.

### Priority

| Cue | Priority |
| --- | --- |
| `Hard brake`, `Brake`, `Light brake` | 100 |
| `Big stop` | 95 |
| `Ease off` | 90 |
| `Keep left`, `Keep right`, `Tighter` | 50 |
| `Throttle`, `Full throttle` | 20 |
| `Guidance paused`, `Guidance resumed`, focus | 10 |

- The highest priority of a sample speaks. The others get `lower-priority`.
- For 1500 ms after a cue, equal or lower priority gets `cooldown`. Higher priority speaks.
- `makeCue` builds every cue: ID, priority, time to live `150 ms + device delay`.
- A position cue can follow a throttle cue inside the cooldown.

### Throttle window

A due throttle event opens a window. The cue speaks at the first sample, never after the point, where:

- No brake event lies between the car and `event + speed × 2 s`.
- The match is stable for 300 ms.
- The car is ≤ 1 m/s faster than the reference and ≤ 3 m to the side.
- Heading and velocity errors ≤ 10°, brake ≤ 0.05.
- `Full throttle` only: player throttle < 0.95.

### Missed braking and suspension

- Past a brake zone end > 4.17 m/s (15 km/h) faster than the reference: guidance suspends (`target-incompatible`). The coach cancels the throttle and ease-off cues up to the next brake.
- Guidance resumes after 1000 ms of trusted match past the cancelled section.
- `Guidance paused` speaks after 2000 ms of suspension. `Guidance resumed` speaks only after `Guidance paused`. Neither speaks when a brake or ease-off cue would fall inside it.
- A cue that became due during suspension never replays.

### Tighter

More than 2 m outside for ≥ 300 ms between turn-in and apex. Once per corner.

### Side cues

Distance from `CoachSettings`: off, or 0.5 to 3 m. Default `DEFAULT_SIDE_CUE_DISTANCE_M` 2 m.

- `|lateralM|` above the distance for 300 ms: `Keep left` for positive, `Keep right` for negative.
- Once per excursion. The car must return within the distance first. A side cue that loses to another cue or to cooldown does not repeat in that excursion.
- No side cue between turn-in and apex. The hold time continues, so the cue can speak after the apex.

## Comparison and differences

`buildReview(attempt, analysis)` puts attempt and reference on a 2 m grid: time, speed, throttle, brake, position, lateral distance. A gap > 10 m between matches stays empty. Attempt events use the reference event rules.

`findDifferences(review)`:

| Kind | Rule | Size |
| --- | --- | --- |
| `brake-early`, `brake-late` | Nearest attempt brake to a reference brake, within 60 m, > 8 m before or after | m |
| `slow-corner` | Lowest speed > 2.22 m/s (8 km/h) below the reference, from the brake point to 40 m after the zone or the next brake | m/s |
| `throttle-late` | Attempt throttle > 10 m after the reference throttle, within 60 m | m |
| `off-line` | > 1.5 m to one side for > 500 ms | largest distance, m |
| `wide-apex` | > 2 m outside at an apex | m |

An attempt brake more than 60 m from the reference brake is not matched. The finder then uses the nearest brake inside 60 m.

**`turnOf(corners, sM)`**: the last corner whose `zoneStartSM` (its opening `brake` or `ease-off`) is ≤ `sM`. Before turn 1: turn 1. No corners: `null`.

**`turnLosses(corners, lengthM, gridM, attemptT, referenceT)`**: per turn zone, gap at the last grid point with both times − gap at the first. Gap = attempt time − reference time. Fewer than two points: no value. Negative: time gained.

**`recurring(perAttempt, config)`**: empty with fewer than 3 attempts. A difference recurs in at least half of the attempts (`recurring.minShare` 0.5). Group by kind and event key, `off-line` by place within 20 m. Size: median. Sort by count, then place.

**`focusSentence(recurring, latest, corners)`**: the most frequent recurring difference, else the largest difference of the last attempt (`comparableSize`: 1 m/s counts as 3.6). No corner at its place (`cornerAt`): no sentence. Text: turn number and action from `FOCUS_ACTIONS`.

| Kind | Action |
| --- | --- |
| `brake-early` | `Brake later.` |
| `brake-late` | `Brake earlier.` |
| `slow-corner` | `Carry more speed.` |
| `throttle-late` | `Throttle earlier.` |
| `off-line` | `Stay on the line.` |
| `wide-apex` | `Tighter at the apex.` |

**`brakeReactions(samples, cues)`**: time from the clip start to the brake rise above 0.10. Brake above 0.10 at the clip start: the last rise before the clip. Else: the first rise after it. More than 3000 ms away: no value. Negative: braked before the cue.

## Exercise status

- `exerciseStatus`: no complete attempt → `ready` with an active reference, else `new`. Else the medal of the best game time against the targets, or `practising`.
- `nextMedal`: first of bronze, silver, gold with a target below the best time. Result: medal, target, gap in ms. `null` without a best time, or when the best time reaches every target.

## Test fixtures

Tests use `fixtures/`, never `data/`. `fixtures/manifest.json` names the source range of each file.

| Fixture | Content |
| --- | --- |
| `demo-a`, `demo-b`, `demo-c` | Demonstration of Autódromo de Interlagos, Circuit Experience sector 2, 16 082 ms. Test reference: `demo-a`, raw 457 to 1422, 818.17 m. One corner: apex 404 m, turn zone 346 to 462 m. `demo-c` also has a background timer run, raw 758 to 970. |
| `ce-clean` | Clean run, 17 071 ms, finish at raw 9476 |
| `ce-slow` | 18 824 ms, finish at raw 6621. Two brake zones before turn 1, about 216 to 300 m and 328 to 348 m. |
| `ce-pause` | 17 412 ms, pause raw 11651 to 12346, brakes early at turn 1 |
| `ce-off-track-reset`, `ce-off-track-end` | Value −1, then restart or session end |
| `b3-run`, `b1-run` | National B-3: final value 15 839 ms, screen 0:15.839. B-1, standing start: final value 20 366 ms, screen 0:20.352. |

The demo uses `demo-a` and the attempts `ce-clean`, `ce-slow`, `ce-pause`.

Golden traces: `fixtures/golden/ce-slow-cues.json` (defaults) and `ce-slow-cues-side-1m.json` (side cue distance 1 m). Rewrite only after a deliberate coach or clip change, and read the new trace first:

```sh
pnpm evaluate-coach --attempt ce-slow --reference demo-a --first 457 --last 1422 --out fixtures/golden/ce-slow-cues.json
pnpm evaluate-coach --attempt ce-slow --reference demo-a --first 457 --last 1422 --side-distance 1 --out fixtures/golden/ce-slow-cues-side-1m.json
```
