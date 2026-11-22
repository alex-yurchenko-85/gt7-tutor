# Algorithms

The calculations that GT7 Tutor makes from the telemetry. Each section names a task and its solution:

- **Task**: what the calculation gives and for what.
- **Input**: the values that it reads.
- **Method**: the steps and the formulas.
- **Output**: what it gives.
- **Parameters**: the values of `DEFAULT_CONFIG` (`packages/core/src/config.ts`) and the fixed limits.

The input of every calculation is a list of samples. `docs/protocol.md` gives the packet fields, how GT7 Tutor receives the packets, the packet order and the packet time `clockMs`.

## Common rules

- The calculations are in `packages/core`: pure TypeScript, no clock read. Time is an argument (`receivedMonoMs`, `clockMs`, `nowMonoMs`). The same samples and configuration give the same result. `replayCoach` and the golden traces (`docs/fixtures.md`) use this.
- Units: m, m/s, ms, pedals 0 to 1. km/h only for spoken and shown values: `targetSpeedKph`, `target.roundDownKph` and `comparableSize`. `kph(n)` gives `n` km/h in m/s.
- Right of a direction of travel `t`: `(−t.z, 0, t.x)`. A positive lateral distance is to the right.
- `clockOf(sample)` = `clockMs`, or `receivedMonoMs` when `clockMs` is absent.

| Time | Use |
| --- | --- |
| `clockMs` (measured) | Reference point times, review time series, time lost |
| `receivedMonoMs` (real time) | Silence, cue freshness, coach decisions, matcher extrapolation |
| Game timer (`gameTimerMs`) | Attempt time, live gap, review gap |

A sample is **driven** when it is not paused and not loading. The player **has control** when `playerSession` is true and the sample is driven.

Two samples in a row have a **break** when:

| Break | Rule |
| --- | --- |
| `silence` | More than 1000 ms between them |
| `car-changed` | Different car ID |
| `discontinuity` | Distance > `max(speed) × elapsed time + 20 m` |

`continuityBreak` checks all three. `positionBreak` checks `car-changed` and `discontinuity`.

Fixed limits outside `DEFAULT_CONFIG`:

| File | Limits |
| --- | --- |
| `cue-text.ts` | Target speeds 30 to 350 km/h, `estimatedPhraseMs`: 200 ms + 220 ms per word |
| `match.ts` | Minimum travel for a travel direction: 0.05 m |
| `@gt7/contracts` | Cue offsets −500 to +1000 ms in steps of 100 ms, side cue distances 0.5 to 3 m, `WIDE_APEX_M` 2, `RECURRING_MIN_ATTEMPTS` 3, `MAX_SPOKEN_TURN` 10 |

## 1. Start and finish of an attempt

**Task.** Find the start, the finish and the end of an attempt in licence tests and Circuit Experience. Give its official time.

**Input.** `gameTimerMs` (0x15C), `playerSession`, `paused`, `loading`, the packet ID, the breaks. The behaviour of 0x15C: `docs/protocol.md`, Game timer.

**Method: game timer watch.** `GameTimerWatch` gives `started`, `finished`, `left-track` and `restart` with the `rawIndex` and the game time. It is active from `started` to one of the other events.

| Event | Rule |
| --- | --- |
| `started` | Watch not active. Session matches (below). Previous value 0. This value 1 to 50 ms. |
| `left-track` | Value −1. The watch becomes inactive. |
| `restart` | Value 0. The watch becomes inactive. |
| `finished` | Sample not paused. The value did not increase for 3 newer packets in a row. A paused packet clears the count. The watch becomes inactive. |

- Session `player` needs `playerSession` true. Session `demonstration` needs it false. Only the demonstration range uses `demonstration`.
- While active, a packet ID equal to the last counted ID or up to 64 behind changes nothing (`isRepeatedPacket`).
- `finished` has the `rawIndex` of the first packet with the final value. Its game time is that value.
- After any event, the next start needs the full `started` rule.

**Method: attempt tracker.** `AttemptTracker` has the states `waiting`, `driving`, `paused` and `finished`. Each start takes a new generation. A cue of an older generation is never played.

Start: the tracker is not `driving` or `paused`, and the watch gives `started`. The event has the reason `game-timer`. Its time is the sample time minus the timer value of the sample.

While `driving` or `paused`, the first true row applies:

| Condition | Event, reason |
| --- | --- |
| More than 1000 ms without a sample | `aborted`, `silence` |
| `playerSession` false | `aborted`, `player-session-ended` |
| The watch gives `left-track` or `restart` | `aborted`, `left-track` or `restart` |
| Break between samples | `aborted`, `car-changed` or `discontinuity` |
| `loading` true | `aborted`, `loading` |
| State `paused`, `paused` false | `resumed` |
| State `driving`, `paused` true | `paused` |
| The watch gives `finished` | `finished`, `game-timer` |

- An event has `atMonoMs` and `atClockMs`. Only `finished` has `gameTimeMs`: the final timer value.
- `finished` has the `rawIndex` and the time of the first sample with the final value.
- `abortByUser` gives `aborted`, `manual`. Nothing else ends an attempt from outside.
- An abort for any reason other than the watch resets the watch.

**Method: missed start.** `startMissed` is true when all are true:

1. A training is armed.
2. No attempt runs. A paused attempt runs.
3. `playerSession` is true.
4. The value increases, and the previous value is above 0.
5. The value is not the run of the last attempt. After an attempt ends, this stays false until the value is 0.

Condition 3 excludes the background scene. Condition 4 excludes a fixed value after the finish, a false jump from 0 and a pause. Condition 5 excludes the count after a −1.

**Output.** Attempt events with times and generations. The attempt time is the final value of the game timer. `startMissed` for the prompt on the Drive stage.

**Parameters.** `gameTimer.startMaxMs` 50, `gameTimer.stillPackets` 3, `silenceGapMs` 1000.

## 2. Reference line from the demonstration

**Task.** Find the demonstration of the game in a capture. Make from it the reference line and the reference time.

**Input.** One or more captures of the same demonstration: positions, speed, pedals, the game timer with `playerSession` false.

**Method: demonstration runs.** A capture of a demonstration also holds the background before and after it.

`demonstrationRuns(capture)` gives the complete demonstration timer runs in order. The search starts at the first sample, then after each run. It keeps a run when both checks pass:

- Scene change: a `continuityBreak` lies between the search start and the first sample of the run.
- Movement: the car moves more than 10 m in the run.

`cutToTimerRun(capture, range, session)` cuts a range to the timer run inside it. The cut starts at the last sample with value 0 before the start. It ends at the `rawIndex` of `finished`. The first packet with the final value must lie inside the range. A timer that runs before the range does not count. The result has the game time of the run (`TimerRunRange.gameTimeMs`).

**Method: range from several captures.** `findDemoRangeCandidates(captures)` needs two or more captures:

1. Collapse repeated samples with the same state: position within 0.05 m, speed within 0.1 m/s, pedals within 0.02, same gear and car.
2. Find pieces of at least 10 samples that the first capture shares with each other capture. Join pieces with a gap of at most 2 samples and no `continuityBreak`.
3. Keep runs that all captures share, at least 60 samples long. Remove a run when more than half of it in the first capture lies in a longer run.
4. Score each run: 2 for a break before its first sample, 1 for movement above 10 m.
5. Cut each run with `cutToTimerRun(…, 'demonstration')`. A run without a complete timer run in every capture keeps its uncut ranges and has `timed` false.
6. Eligible: both checks pass and `timed` is true. With three or more captures and exactly one eligible run, that run is not ambiguous. Else every run is ambiguous.
7. Order: timed first, then score, then samples in the first capture (more first), then earlier start.
8. Keep only the first of two runs with the same cut range in the first capture.

**Method: reference path.** `buildReference(samples)`:

1. Reject a sample with a field that is not finite. Reject a range with a `positionBreak`.
2. Keep the driven samples. Remove repeated identical positions at both ends.
3. Sum the straight distances between samples: `lengthM`.
4. Resample to one point per metre, plus the end point. A point has `sM`, position, speed, throttle, brake, `timeMs` and `timerMs`.
5. `timeMs`: active packet time from the start (`clockOf`). Paused and loading time is not counted.
6. `timerMs`: the interpolated `gameTimerMs`, not relative to the first point.
7. Tangent of a point: the direction from the previous point to the next point.

`pointAt(path, sM)` interpolates between two points. A reference never changes after `buildReference`. `nearestSM(path, position)` gives the `sM` of the nearest path point. It scans all points and keeps no state. Use it for one place, not for a driven line.

**Method: check that a capture follows a path.** `matchesReference(capture, path)` gives the raw range of the first run that follows the path, or `null`. A sample follows the path when all are true:

- The matcher (section 3) gives a match.
- Lateral and height difference ≤ 0.5 m.
- Speed difference ≤ 5 % of the reference speed + 0.5 m/s.

A sample that does not follow ends the run. A run passes when:

- It starts ≤ 1 m after the path start and ends ≤ 1 m before the path end.
- Median speed difference ≤ 1 % of the reference speed. Below 1 m/s the divisor is 1 m/s.
- 95th percentile of the lateral distance ≤ 0.2 m.
- Median throttle difference ≤ 0.05 and median brake difference ≤ 0.05.

**Output.** `ReferenceAnalysis`: the path, the events and the corners (section 4) and the reference time. The reference time is the final timer value of the cut range. The first point has `timerMs` 0. A range without a timer run has no reference time.

`analyseReference(samples, config)` builds the path and returns `analysisOf(path, timeMs, config)`. `timeMs` is the timer value of the last sample of the range. `analysisOf` adds the events (`buildCueEvents`) and the corners (`findCorners`) to a path. `compareLaps` (section 8) also calls `analysisOf`. No other code calls `buildCueEvents` or `findCorners` for a reference.

**Parameters.** `demoRange`: `positionToleranceM` 0.05, `speedToleranceMps` 0.1, `pedalTolerance` 0.02, `minPieceSamples` 10, `maxGapSamples` 2, `minRunSamples` 60, `minMovementM` 10, `confirmMaxLateralM` 0.5, `followSpeedRatio` 0.05, `followSpeedBaseMps` 0.5, `confirmMaxSpeedRatio` 0.01, `confirmMaxLateralP95M` 0.2, `confirmMaxMedianPedal` 0.05. `discontinuityMarginM` 20.

## 3. The car on the reference line

**Task.** For each sample, find the place of the car on the reference line: the distance along the line and the side distance from it. Every other calculation of an attempt and a lap uses this place.

**Input.** Position, velocity, speed and time of the sample. The path.

**Method.** `Matcher.step(sample)` gives a `Match` or `null`:

1. Window: 0 to 20 m for the first sample. Then from 5 m behind the last match to `max(20 m, speed × elapsed + 10 m)` ahead. `startSM` (the third constructor argument) moves the first window: from 5 m behind `startSM` to 20 m after it. Exercises do not use `startSM`.
2. Project the position on each one-metre segment of the window. A projection can be up to 1 m past a segment end. The matcher clamps it to the segment.
3. Keep candidates with lateral distance ≤ 8 m and height difference ≤ 3 m.
4. Travel direction: the last two positions (≥ 0.05 m apart), else the velocity. At 2 m/s or more, prefer candidates with the tangent within 45° of it.
5. Cost = `distance + 0.5 × |sM − expected sM|`. Expected `sM` = last match + `speed × elapsed`. The lowest cost wins.

**Output.**

| Field | Meaning |
| --- | --- |
| `sM` | Distance along the reference, m |
| `lateralM` | Side distance. Positive is right of the travel direction. |
| `heightM` | Height difference |
| `headingErrorDeg` | Travel direction against the tangent |
| `velocityErrorDeg` | Velocity against the tangent, `null` below 2 m/s |
| `trusted` | The heading check passed and `|lateralM|` ≤ 8 m |
| `reference` | The reference point at `sM` |

Guidance uses only trusted matches.

**Parameters.** `match`: `lateralM` 8, `searchLateralM` 8, `heightM` 3, `headingDeg` 45, `headingMinSpeedMps` 2, `searchBackM` 5, `searchForwardMinM` 20, `searchForwardMarginM` 10, `progressWeight` 0.5, `sectionEndToleranceM` 1.

## 4. Events and turns of the reference

**Task.** Find on the reference line the places where the driver brakes, lifts off and opens the throttle, and the turns. The voice cues and the differences use these places.

**Input.** The path: speed, throttle and brake per metre.

**Method: events.** `buildCueEvents(path)`. A condition must hold for 3 points in a row.

| Event | Rule |
| --- | --- |
| `brake` | Brake > 0.10. It ends at ≤ 0.10. Zones closer than 5 m join. |
| `ease-off` | Throttle falls from ≥ 0.5 to ≤ 0.1, and no brake zone starts within 1000 ms |
| `throttle` | After a release or a brake zone, throttle > 0.5 outside a brake zone |

- Key: `<kind>@<sM rounded>`, for example `brake@332`. `eventKey`, `eventKeyKind` and `eventKeyPlace` in `@gt7/contracts` read and write it.
- The builder drops a second event of the same kind (not brake) within 5 m.
- The builder drops an event in the last 20 m.

| Value | Rule |
| --- | --- |
| Lowest speed, brake | Lowest reference speed from the brake point to 40 m after the end of the zone. It stops at the next brake zone. The difference `slow-corner` uses the same range. |
| Target speed, brake | The lowest speed |
| Target speed, throttle | Reference speed 2 s later |
| Target rounding | Down to 5 km/h. Outside 30 to 350 km/h: no target. |
| Loss, brake | Entry speed − lowest speed. Share = loss / entry speed. |
| `Hard brake` | Share ≥ 0.40 |
| `Brake` | Share ≥ 0.15 |
| `Light brake` | A smaller share |
| `Big brake ahead` before a brake | Entry ≥ 200 km/h and loss ≥ 100 km/h |
| `Lift off` | Every `ease-off` event |
| `Full throttle` | Reference throttle reaches 0.95 within 2 s. Else `Throttle on`. |

**Method: turns.** `findCorners(path, events)`:

1. Curvature at each metre: the angle between the tangents 10 m before and after, divided by 20 m. The sign gives the direction.
2. Window: from each `brake` or `ease-off` to 40 m after the next `throttle`, or to the path end.
3. Apex: the largest curvature in the window. Radius > 150 m there: no corner.
4. Turn-in: the last point before the apex with a curvature below one third of the apex curvature.
5. Sort the corners by apex. A corner with a turn-in at or before the last apex of the previous corner joins the previous corner. The last apex is the largest apex of all the corners that joined. The joined corner keeps the sharpest apex, the earliest turn-in and the earliest opening.
6. Number the corners by apex order from 1.

`outsideM(corner, lateralM)` = `−insideSign × lateralM`. Positive: outside.

`turnZones(corners, lengthM)`: one zone per corner, from the turn-in to `apex + (apex − turn-in)`. It ends earlier at the next turn-in or the section end.

`turnOf(corners, sM)`: the last corner whose `zoneStartSM` (its opening `brake` or `ease-off`) is ≤ `sM`. Before turn 1: turn 1. No corners: `null`.

**Output.** The events with their keys, voice kinds and targets. The corners with turn-in, apex, inside side and zone.

**Parameters.** `events`: `consecutiveSamples` 3, `brakeOn` 0.1, `liftFrom` 0.5, `liftTo` 0.1, `throttleOn` 0.5, `mergeWithinM` 5, `liftBrakeWindowMs` 1000, `endMarginM` 20. `findings.cornerExtensionM` 40. `target`: `roundDownKph` 5, `throttleLookAheadMs` 2000. `voice`: `hardBrakeShare` 0.4, `brakeShare` 0.15, `fullThrottle` 0.95, `bigStopEntryMps` 200 km/h, `bigStopLossMps` 100 km/h. `corners`: `curvatureSpanM` 10, `maxRadiusM` 150, `turnInShare` 1/3, `apexAfterThrottleM` 40.

## 5. Voice cues

**Task.** Decide during an attempt which cue the voice says and when. A cue must end before the place that it names.

**Input.** The samples of the attempt, the match (section 3), the events and corners (section 4). `CoachSettings`: muted keys, targets on or off, cue offsets, side cue distance, device delay.

**Method: training step.** `TrainingRun.step(sample)` is the one training step, live and in `replayCoach`:

1. Give the sample to `AttemptTracker` (section 1).
2. On `started`: new generation, reset the matcher, guidance active. Return the start samples (timer 0 and start).
3. Compute `startMissed`.
4. If no attempt runs, stop. Match, gap and next cue are `null`.
5. Match the sample. Compute the live gap (section 6) and the next cue that is not muted.
6. Give the sample to `Coach`. A new generation resets the coach on its first step.

`TrainingRun` expects unique samples in packet order. `Coach.step` gives at most one cue per sample. The coach gets `CoachSettings` once, at construction.

**Method: silence.** The coach gives no cue when:

- The player has no control, or the sample is older than 150 ms.
- Guidance waits for a restart: the car passed the path end.
- The match is missing or not trusted. Guidance is then suspended.

**Method: due time.** Time to an event at distance `d`, speed `v`, acceleration `a` > 0:

```text
t = (−v + √(v² + 2ad)) / a
```

With `a` = 0: `t = d / v`. `a` = the speed change over the last 300 ms, never negative, 0 with less than 100 ms of data.

| Rule | Value |
| --- | --- |
| Cue due | `t` ≤ device delay + 500 ms + cue offset + sample period |
| `Big brake ahead` due | `t` ≤ device delay + 2000 ms + offset of its brake + sample period |
| Sample period | Time since the last coach step, ≤ 100 ms. First step: 1000 / 60 ms. |
| Cue offset | −500 to +1000 ms, step 100 ms. Positive is earlier. |
| Too late | `t` < device delay |

`Big brake ahead` is also too late in two cases. Its phrase cannot end before the lead of its brake. Or a brake or ease-off between the car and its brake becomes due before the phrase ends. It gets `cooldown` for 1500 ms after a last cue with priority ≥ 90.

**Method: mutes.**

| Cue | Event kind | Place | Mute key |
| --- | --- | --- | --- |
| Brake, ease-off, throttle | `brake`, `ease-off`, `throttle` | The event | Event key |
| `Big brake ahead` | `big-stop` | Its brake | Key of its brake |
| `Closer to apex` | `tighter` | Decision place | `tighter` |
| `More left`, `More right` | `keep-left`, `keep-right` | Decision place | `keep-left`, `keep-right` |
| `Guidance paused`, `Guidance resumed` | `guidance` | None | None |

- The coach checks mutes once, when it chooses the cue of a sample.
- A mute comes first: a muted candidate gets `muted` also when it is too late.
- A muted throttle event opens no window.

**Method: priority.**

| Cue | Priority |
| --- | --- |
| `Hard brake`, `Brake`, `Light brake` | 100 |
| `Big brake ahead` | 95 |
| `Lift off` | 90 |
| `More left`, `More right`, `Closer to apex` | 50 |
| `Throttle on`, `Full throttle` | 20 |
| `Guidance paused`, `Guidance resumed`, focus | 10 |

- The highest priority of a sample speaks. The others get `lower-priority`.
- For 1500 ms after a cue, an equal or lower priority gets `cooldown`. A higher priority speaks.
- `makeCue` builds every cue: ID, priority, time to live `150 ms + device delay`.
- A position cue can follow a throttle cue inside the cooldown.

**Method: throttle window.** A due throttle event opens a window. The cue speaks at the first sample, never after the point, where:

- No brake event lies between the car and `event + speed × 2 s`.
- The match is stable for 300 ms.
- The car is ≤ 1 m/s faster than the reference and ≤ 3 m to the side.
- Heading and velocity errors ≤ 10°, brake ≤ 0.05.
- `Full throttle` only: player throttle < 0.95.

**Method: missed braking.**

- Past a brake zone end more than 15 km/h faster than the reference: guidance suspends (`target-incompatible`). The coach cancels the throttle and ease-off cues up to the next brake.
- Guidance resumes after 1000 ms of trusted match past the cancelled section.
- `Guidance paused` speaks after 2000 ms of suspension. `Guidance resumed` speaks only after `Guidance paused`. Neither speaks when a brake or ease-off cue would fall inside it.
- A cue that became due during suspension never replays.

**Method: closer to apex.** More than 2 m outside for ≥ 300 ms between turn-in and apex. Once per corner.

**Method: side cues.** The distance comes from `CoachSettings`: off, or 0.5 to 3 m. Default `DEFAULT_SIDE_CUE_DISTANCE_M` 2 m.

- `|lateralM|` above the distance for 300 ms: `More left` for positive, `More right` for negative.
- Once per excursion. The car must return within the distance first. A side cue that loses to another cue or to cooldown does not repeat in that excursion.
- No side cue between turn-in and apex. The hold time continues, so the cue can speak after the apex.

**Method: texts and clips.** `cue-text.ts` makes the clip keys. The texts come from the voice pack, `packages/contracts/locales/<lang>/voice.json`. Core, the server and the API carry clip keys, not text.

- Clip = phrase key, for example `hard-brake`. The voice pack key is `voice.<clip>`, for example `voice.hard-brake`. The keys keep the kind names: `ease-off` says `Lift off`, `big-stop` says `Big brake ahead`, `tighter` says `Closer to apex`, `keep-left` and `keep-right` say `More left` and `More right`.
- The follow clip of a brake with a target is `speed-<km/h>`. It plays only with `Speak target speeds`. The voice pack gives the words of each speed: `voice.speed-30` to `voice.speed-350`.
- A focus clip is `focus-<kind>-<turn>`, up to turn 10. Its text is `voice.focus` with the turn (`voice.turn-1` to `voice.turn-10`) and the action (`voice.focus-action.<kind>`). Above turn 10, the focus has no clip, and the screen shows the turn with `voice.turn` and digits.
- `eventClips(event, speakTargets)` gives the clips of a cue row: the clip, then the follow clip if targets are on. The next cue of the live state has its clip. The focus of an attempt has its kind, its turn and its clip.
- The web makes the shown text from the voice pack. A brake with a target shows `voice.brake-with-target`, with the speed words after the action.
- The Drive stage shows the words of `drive.cue.<kind>` from the message pack.
- `clipText(pack, clip)` gives the spoken text of a clip. `estimatedPhraseMs(pack, clip)` gives the phrase time when the voice manifest has no duration for the clip.
- `clipsOf(events, corners)` lists every clip of a reference:
  - the event clips and the follow clips.
  - `Big brake ahead` if any, `Closer to apex` if a corner exists.
  - the side cues, the guidance cues and `Voice check`.
  - the focus sentences up to turn 10.

**Output.** At most one cue per sample, with its generation, priority and time to live. A suppressed candidate has its reason: `muted`, `lower-priority`, `cooldown` or too late.

**Parameters.** `freshnessMs` 150. `cue`: `leadReactionMs` 500, `ttlBaseMs` 150, `cooldownMs` 1500, the priorities above. `voice.bigStopLeadMs` 2000. `coach`: `defaultPeriodMs` 1000 / 60, `maxPeriodMs` 100, `accelerationWindowMs` 300, `minAccelerationSpanMs` 100. `acceleration`: `maxOverspeedMps` 1, `maxLateralM` 3, `maxHeadingErrorDeg` 10, `maxBrake` 0.05, `stableHoldMs` 300. `incompatibleOverspeedMps` 15 km/h, `guidanceResumeMs` 1000, `guidanceAnnounceAfterMs` 2000. `corners`: `wideApexM` 2, `tighterHoldMs` 300. `position.holdMs` 300.

## 6. Live gap

**Task.** Show during an attempt how much the car is behind the reference or in front of it.

**Input.** `gameTimerMs` of the sample, the match (section 3).

**Method.** Gap = `gameTimerMs` of the sample − `timerMs` of the matched reference point.

**Output.** The gap in ms. Positive: slower. `null` when no attempt runs, no match exists, or the value is 0 or −1. A pause keeps the value.

## 7. Attempt against the reference

**Task.** After an attempt, show where it differs from the reference and how much time each turn lost. Show the differences that come again and one focus for the next attempt.

**Input.** The samples of the attempt, `ReferenceAnalysis` (section 2), the earlier attempts of the exercise.

**Method: one grid.** `buildReview(attempt, analysis)` matches each sample (section 3) and puts the attempt and the reference on a 2 m grid: time, speed, throttle, brake, position, lateral distance. A gap > 10 m between matches stays empty. Attempt events use the reference event rules (section 4).

**Method: differences.** `findDifferences(review)`:

| Kind | Rule | Size |
| --- | --- | --- |
| `brake-early`, `brake-late` | The nearest attempt brake to a reference brake, within 60 m, more than 8 m before or after | m |
| `slow-corner` | Lowest speed more than 8 km/h below the reference, from the brake point to 40 m after the zone or the next brake | m/s |
| `throttle-late` | Attempt throttle more than 10 m after the reference throttle, within 60 m | m |
| `off-line` | More than 1.5 m to one side for more than 500 ms | largest distance, m |
| `wide-apex` | More than 2 m outside at an apex | m |

An attempt brake more than 60 m from the reference brake is not matched. The finder then uses the nearest brake inside 60 m.

**Method: time lost per turn.** `turnLosses(corners, lengthM, gridM, attemptT, referenceT)`: per turn zone (section 4), the gap at the last grid point with both times − the gap at the first. Gap = attempt time − reference time. Fewer than two points: no value. Negative: time gained.

**Method: recurring differences.** `recurring(perAttempt, config)`: empty with fewer than 3 attempts. A difference recurs in at least half of the attempts. Group by kind and event key, `off-line` by place within 20 m. Size: the median. Sort by count, then place.

**Method: focus.** `focusSentence(recurring, latest, corners)`: the most frequent recurring difference, else the largest difference of the last attempt. `comparableSize` makes 1 m/s count as 3.6. No corner at its place (`cornerAt`): no sentence. Text: the turn number and the action from `FOCUS_ACTIONS`.

| Kind | Action |
| --- | --- |
| `brake-early` | `Brake later.` |
| `brake-late` | `Brake earlier.` |
| `slow-corner` | `Carry more speed.` |
| `throttle-late` | `Throttle earlier.` |
| `off-line` | `Stay on the line.` |
| `wide-apex` | `Closer to the apex.` |

**Method: brake reaction.** `brakeReactions(samples, cues)`: the time from the clip start to the brake rise above 0.10. Brake above 0.10 at the clip start: the last rise before the clip. Else: the first rise after it. More than 3000 ms away: no value. Negative: braked before the cue.

**Method: review gap.** Game time of the attempt − reference time.

**Output.** The grid series, the differences with their turns, the time lost per turn, the recurring differences, the focus sentence, the brake reactions, the review gap.

**Parameters.** `reviewGridM` 2, `reviewMaxBridgeM` 10. `findings`: `eventWindowM` 60, `brakeM` 8, `slowCornerMps` 8 km/h, `throttleLateM` 10, `offLineM` 1.5, `offLineMs` 500, `cornerExtensionM` 40. `corners.wideApexM` 2. `recurring`: `minAttempts` 3, `minShare` 0.5, `placeWithinM` 20. `brakeReaction`: `onThreshold` 0.1, `windowMs` 3000.

## 8. Race

**Task.** Find a race by laps in the telemetry. Split it into laps and pit stops. Find the off-track moments and the places where they come again. Compare two laps of the race.

**Input.** The race facts of the telemetry: lap, laps in the race, race position, last lap time, fuel, surface letters, the loading bit (`docs/protocol.md`, Race).

### 8.1 Race watch

`RaceWatch.push(sample)` gives the events of one race. Time comes from `receivedMonoMs`.

| State | Next state, event | Rule |
| --- | --- | --- |
| `waiting` | `grid`, event `grid` | `playerSession`, laps in the race ≥ 2, lap 0 |
| `waiting` | `running`, event `join` | `playerSession`, laps in the race ≥ 2, lap 1 to the laps in the race. The event has the lap that runs. |
| `grid` | `running`, event `start` | The lap becomes 1 or more |
| `running` | `running`, event `lap` | The lap increases. The event has the old lap and `lastLapMs` of the sample. |
| `running` | `finished`, events `lap` and `finish` | The new lap is above the laps in the race |
| `grid`, `running` | `ended`, event `ended` | `playerSession` false for more than 1000 ms: `session-left`. The lap goes down with `playerSession` true: `lap-counter-down`. |

- `finished` and `ended` are final.
- A sample with `playerSession` false counts only for the session-loss timer.
- The loading packets of a pit stop keep `playerSession` true. They do not end the race.
- A `join` starts the watch during a race. The lap that runs and the laps before it are not recorded. The `lap` event of the lap that runs still comes. After that, `finish` and `ended` work as after a grid.
- A sample after the finish (lap above the laps in the race) does not join.
- `firstRecordedLap`: 1 after a grid, the lap after the join lap after a join, `null` before.
- A session with laps in the race below 2 is not a race.
- `unsupported` is true after 5000 ms of `playerSession` with laps in the race below 2 and lap 0 or more. It becomes false at the first sample that does not match.
- The watch moves only when samples come.

### 8.2 End of a recording

The race recorder of the server feeds a `RaceWatch` while a race recording runs:

- After `finish`, the recorder keeps the capture open for 2000 ms.
- After `ended`, the recorder ends the race at once.
- In `grid` or `running`, the recorder ends the race after 10 000 ms without a packet.
- In `waiting`, the recorder does not end the recording without packets.
- A grid that ends before `start`, or a join that ends before its first lap line, does not end the recording. The recorder starts a new watch.
- At the end, the recorder stops the capture and runs `analyseRace` on all its samples. When the result is `null`, it removes the capture and its raw file.
- When the server stops on a signal, the recorder stores the complete laps as a race that is not finished. A stop in the 2000 ms after `finish` stores the whole race. In `waiting`, it stores no race and removes the capture. The recorder waits for the save for at most 10 000 ms (`SHUTDOWN_SAVE_WAIT_MS`). After that time, or after a failed save, it marks the capture `interrupted`.
- The start time of a stored race is the time of the first sample of the race range.

### 8.3 Fuel estimate

The live state shows the number of laps that the fuel is sufficient for:

1. The fuel use of a lap = the fuel at its first sample − the fuel at its last sample.
2. Only recorded laps count. An in-lap and an out-lap do not count.
3. Estimate = fuel / mean fuel use of these laps.
4. `null` before the first of these laps, or when the mean fuel use is below 0.5 per lap. The value is not stored.

### 8.4 Race range and laps

`raceRange(samples)` runs a `RaceWatch`. The range starts at the `grid` or the `join` event. It ends at the last sample at most 2000 ms after `finish`, at the `ended` sample, or at the last sample. Without a grid or a join: `null`. A grid that ends before `start` is not a race. A join that ends before its first lap line is not a race. In both cases a new watch waits for the next grid or join.

`analyseRace(samples)` cuts the samples to this range first. Then two sessions with equal lap numbers never mix. Without a complete lap: `null`.

`splitLaps(samples)` counts only samples with `playerSession` and lap 1 or more:

- Lap n: from the first sample of lap n to the last sample before lap n + 1. A lap without a later lap is not complete and is not in the result.
- A lap is in the result only when the samples hold its first lap line. Then the last `playerSession` sample before its first sample has lap n − 1 or 0. The lap that runs at a join is not in the result. The laps keep the numbers of the game.
- Lap time: `lastLapMs` of the first sample of lap n + 1.
- Positions and fuel: first and last sample of the lap. Top speed: the highest speed of the lap.
- A fuel value that is not finite takes the last finite value before it. Values that are not finite at the start take the first finite value.

### 8.5 Pit stop

A pit stop follows lap n when the first sample of lap n + 1 has the loading bit (the cut to the pit box). Lap n is the in-lap (`pitIn`). Lap n + 1 is the out-lap (`pitOut`).

| Value | Rule |
| --- | --- |
| Stop | First sample of the end part of lap n with speed ≤ 0.1 m/s. Without such a part: the cut. |
| Exit | First sample of lap n + 1 after its first sample with the loading bit and a `discontinuity`. The loading packet in the box has no jump and is not the exit. Without it (a lost packet): the first `discontinuity`. Without a jump: no pit stop entry. `pitIn` and `pitOut` stay. |
| Time | Clock steps from the stop to the exit. A step with a paused sample at either end is not counted. |
| Fuel | `fuelBefore`: fuel at the stop. `fuelAfter`: highest fuel of lap n + 1 up to the exit. |

- A lost cut packet at the lap change: the pit stop is not found. The lap times do not change.
- A pit stop is in the result only when its in-lap is in the result. An out-lap after a join in its in-lap still has `pitOut`. Its exit follows the exit rule above.
- `pitLaneOf` gives the stop and the exit of a lap for both cases. `drivenLap(samples, lap, pitStops)` gives the samples of a lap without the pit lane: an in-lap ends before the stop, an out-lap starts at the exit.
- `lapPath(samples, lap, pitStops)` builds the path of `drivenLap` with `buildReference` (section 2). When `buildReference` fails: `null`.

### 8.6 Race values

| Value | Rule |
| --- | --- |
| `firstLap` | Number of the first lap in the result |
| `complete` | `firstLap` is 1, and the number of complete laps equals the laps in the race |
| `raceMs` | Sum of the recorded lap times |
| `bestLap` | Recorded lap with the smallest time and no pit in and no pit out. Lap 1 counts. When each lap has a pit in or a pit out: the recorded lap with the smallest time. |
| `referenceLap` | Fastest closed lap that has a path. Without one: the fastest lap with a path. Without any path: the fastest lap. |
| `lapLengthM` | Length of the path of the reference lap. When the reference lap is not closed: the length of the longest lap path. Without any path: `null`. |
| `startPosition` | Race position of the last lap-0 sample before lap 1. The first grid sample gives 1. Without a lap-0 sample: the first lap-1 sample. After a join: the first sample of the first recorded lap. |
| `finishPosition` | Race position of the first sample after the last complete lap |
| `position` | One step per change of the race position |
| `fuel` | One point per 2000 ms and a last point at the end |

A **closed lap** (`isClosedLap`) starts and ends at the lap line: it is not lap 1, not an in-lap and not an out-lap. Lap 1 starts on the grid.

**Race time** of a sample = the sum of the earlier recorded lap times + `gameTimerMs` of the lap. The first sample of a lap gives 0 for its lap part: its 0x15C holds the time of the lap before. Race time 0 is the first recorded lap line.

**Distance on the race time.** `raceDistances(samples, analysis)` gives the distance that the car drove from the lap line of its lap. The distance is 0 at the first sample of each recorded lap. Each next sample of the lap adds the horizontal distance (`x`, `z`) from the sample before it. On an out-lap, the pit lane counts. There is one point per 250 ms, one at the start of each lap and one at its end. The finish sample after the last lap gives no point.

**Values at a race time `t`** (the cursor of the position chart):

- Lap: the lap whose time range holds `t`. The end of the race belongs to the last lap.
- Distance: linear interpolation of the distance points of that lap.
- Position: the last position step at or before `t`. At the time of a change, the position before the change is also given.
- Fuel: linear interpolation of the fuel points.

### 8.7 Off-track moments

`findOffTrack(samples, laps, pitStops, path)`:

- A wheel is off on a surface letter that is not `T` or `C`.
- A moment is a run of samples with 2 or more wheels off. Two runs of one lap less than 1000 ms apart are one moment. Runs that start in two laps do not join.
- A moment belongs to the lap of its first sample, also when it crosses the lap line. Only samples inside a lap range count.
- Samples from the stop to the exit of a pit stop give no moment. The box samples of an out-lap give no moment.
- `wheels`: the largest count. `durationMs`: clock steps without a paused sample. `speedInMps`: the speed of the first sample. `speedMinMps`: the lowest speed.
- `sM`: `nearestSM` of the first position on the path of the reference lap. Without a path: `null`.

### 8.8 Recurring places

`recurringPlaces(moments, lengthM)`:

1. Sort the moments with a distance by `sM`.
2. Chain each moment to the one before it when they are less than 80 m apart. A chain has no span limit.
3. `lengthM` is `lapLengthM` when the reference lap is closed, else `null`. With a length, the distance goes the shorter way round the lap. The last chain and the first chain join when they are less than 80 m apart over the lap line. Then `fromSM` is above `toSM`.
4. Keep a chain with moments of 3 or more different laps.
5. `sM`: the median distance of the chain. `x`, `z`: the moment nearest to it. `allWheels`: the number of laps with a four-wheel moment. `largestLossMps`: the largest `speedInMps − speedMinMps`.
6. Labels `A`, `B`, … by the number of laps, largest first. For an equal number: the smaller `sM` first.

### 8.9 A lap against a lap

`compareLaps(samples, analysis, lap, withLap)` uses the lap `withLap` in the place of the reference. Its `ReferenceAnalysis` is `analysisOf` (section 2) of the path of `lapPath` and the lap time. `buildReview` (section 7) puts the samples of `lap` on the 2 m grid. `findDifferences` and `turnLosses` give the differences and the time lost per turn. All distances are metres from the start of the path of `withLap`: the lap line, or the pit exit when `withLap` is an out-lap.

- `null` when a lap number is not in the analysis, when the two numbers are equal, or when `lapPath` of `withLap` is `null`.
- An in-lap stops before the stop of its pit stop.
- An out-lap starts at the first sample, from the exit on, that is within 20 m of the path. The matcher gets `startSM` = `nearestSM` of that sample.
- A part without a match stays a gap, for example the pit lane.
- When `lap` or `withLap` is an out-lap, the attempt time moves by one value for all cells. At the last matched cell, the time lost is then `lapMs − withMs`, the difference of the two lap times of the game. The curve starts at the pit exit with the time in the pit lane. It is a loss when `lap` is the out-lap and a gain when `withLap` is the out-lap.
- One lap is an out-lap and the other lap is an in-lap: the attempt time moves. The time lost is then 0 at the first matched cell.
- An in-lap against a lap without a pit stop does not move. Its curve starts at 0 at the lap line and stops at the pit entry.
- The move does not change the time lost per turn.

Two laps of a race use larger limits (`raceCompareConfig(config)`). The race functions `compareLaps`, `goldenLap`, `lapsSpeed` and `offTrackView` use them. No other code reads them.

| Value | Exercise | Race |
| --- | --- | --- |
| `match.lateralM`, `match.searchLateralM` | 8 m | 20 m (`race.matchLateralM`) |
| `match.heightM` | 3 m | 6 m (`race.matchHeightM`) |
| `findings.eventWindowM` | 60 m | 120 m (`race.eventWindowM`) |
| `findings.offLineM` | 1.5 m | 5 m (`race.offLineM`) |
| `findings.brakeM` | 8 m | 15 m (`race.brakeM`) |
| `findings.throttleLateM` | 10 m | 30 m (`race.throttleLateM`) |
| `findings.slowCornerMps` | 8 km/h | 10 km/h (`race.slowCornerMps`) |

### 8.10 Golden lap

**Task.** Find the fastest lap that one driver can drive from parts of the clean laps of one race. Two parts join only when the speed and the side position agree at the join.

**Input.** The samples of the race, `RaceAnalysis` and the race limits of 8.9.

**Method.**

1. A clean lap is not the first lap of the race (`analysis.firstLap`, or lap 1), not an in-lap and not an out-lap. A lap without a time for each sector is open, and it is not clean. A sector of a clean lap is not usable when an off-track moment of that lap starts in the sector (`sM` of 8.7).
2. The line is the path of the reference lap (`lapPath`). The turns are the corners of `analysisOf` of that path.
3. Each turn has one sector. The lap line is the first and the last boundary. The range for the boundary between turn N and turn N + 1 starts at the zone end of turn N (`turnZones`). It stops at the zone start of turn N + 1 (`zoneStartSM`). The method looks at each whole metre of the range. At each metre, it calculates the standard deviation of the speed over the clean laps. The boundary is the first metre with the smallest value. When that range is shorter than 4 m, the range goes from the apex of turn N to the apex of turn N + 1. A metre without a speed for each clean lap is not a candidate. Without a candidate, the boundary is the middle of the range. A path without a corner gives one sector without a turn.
4. A `Matcher` puts each sample of a clean lap on the line. Paused samples and loading samples get no match. Each match gives `sM`, the side position (`lateralM`), the speed and the race position. The first match goes to 0 m when its `sM` is more than half of the path length.
5. Each packet ID step adds 1000 / 60 ms to the time from the first sample of the lap. A step counts 0 when one of the two samples has the pause flag. A step also counts 0 when the position does not change. The lap ends at the first sample of the next lap.
6. A boundary value is the linear interpolation between two matches at the first crossing of the boundary `sM`. Two matches with 50 m or more between them give no crossing. At the lap line, the end of a lap takes the first match of the next lap when the next lap is clean. Otherwise, the end takes the speed of the first sample of the next lap. It takes the side position of the last match.
7. Two sectors of the same lap always join. Two sectors of different laps join when the speed difference at the boundary is not more than `goldenJoinMps` and the side difference is not more than `goldenJoinSideM`.
8. The chain is the shortest path over the sectors and the clean laps (dynamic programming). The method calculates one chain for each lap of the first sector. A chain is valid only when its last sector joins its first sector at the lap line. The golden lap is the valid chain with the smallest sum of sector times.
9. A straight is the range from the zone end of turn N to the zone start of turn N + 1, at least 100 m long. For each clean lap, the method finds the match with the top speed on the straight. A slipstream hint is a top speed more than `goldenSlipstreamMps` above the median of the clean laps. The race position at that match must not be 1. The hint goes to the sector of that match.

**Output.** `GoldenLap` with one of four states:

- `ok`: the best clean lap and its time of the game, the golden time, the source laps, the clean laps and one row per sector. A row has the turn, the range in metres, the source lap and its sector time. It also has the best sector time and its lap, the median, the spread (median − best) and the count of usable laps. The last fields are `bestJoins` and `slipstream`. `bestJoins` is false when the best sector time is not in the golden lap. `slipstream` is true when the source lap of the sector has a slipstream hint in that sector.
- `too-few`: fewer clean laps than `goldenMinLaps`. The output gives the clean laps and the reason for each other lap (`first`, `pit` or `open`).
- `gap`: a sector has no usable lap. The output gives the clean laps and the turn of that sector.
- `no-chain`: no valid chain. The output gives the clean laps.

**Parameters.** `race`: `goldenMinLaps` 3, `goldenJoinMps` 5 km/h, `goldenJoinSideM` 1.5 m, `goldenSlipstreamMps` 3 km/h. Fixed values: the narrow range 4 m, the crossing step 50 m, the straight 100 m.

### 8.11 Speed of all laps and the off-track view

`lapsSpeed(samples, analysis)` uses the reference lap in the place of the reference. It gives the speed series of each lap on the 2 m grid and the turn zones. In-laps and out-laps follow the rules of 8.9. Without a path of the reference lap: `null`.

`offTrackView(samples, analysis)` gives the line (`x`, `z`), the height (`y` − the lowest `y` of the path) and the speed of the reference lap on the 2 m grid. For each pit stop it gives the pit lane of two laps. In-lap: from `nearestSM` of the stop to the lap end. Out-lap: from 0 to the `startSM` of the out-lap. Without a path of the reference lap: `null`.

### 8.12 Track candidates

`trackCandidates(lapLengthM, circuits)` gives the circuits with a length within 60 m of the lap length, nearest first. The packet does not name the track (`docs/protocol.md`).

**Output.** `RaceAnalysis`: the range, the laps, the pit stops, the race values, the off-track moments and the recurring places. On request: the comparison of two laps, the golden lap, the speed of all laps, the off-track view and the distances.

**Parameters.** `race`: `minLaps` 2, `sessionLostMs` 1000, `unsupportedAfterMs` 5000, `afterFinishMs` 2000, `silenceEndMs` 10 000, `pitStoppedMps` 0.1, `fuelStepMs` 2000, `distanceStepMs` 250, `offTrackMinWheels` 2, `offTrackJoinMs` 1000, `recurringWithinM` 80, `recurringLaps` 3, `trackWithinM` 60, and the compare limits above. Minimum fuel use for the estimate: 0.5 per lap.

## 9. Exercise status and medal

**Task.** Give the status of an exercise and the next medal to drive for.

**Input.** The number of complete attempts, the best game time, the targets of the medals, the active reference.

**Method.**

- `exerciseStatus`: no complete attempt → `ready` with an active reference, else `new`. Else the medal of the best game time against the targets, or `practising`.
- `nextMedal`: the first of bronze, silver, gold with a target below the best time.

**Output.** The status. The next medal with its target and the gap in ms, or `null` without a best time or when the best time reaches every target.
