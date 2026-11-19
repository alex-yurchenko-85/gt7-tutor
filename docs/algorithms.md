# Core algorithms

This document describes the calculations of `packages/core`.
It covers the reference, the match of the car to the reference, the attempt, the voice and the differences.
Read it before you change a file in `packages/core/src`. The protocol is in `docs/protocol.md`.

Rules of the core:

- It is pure TypeScript. It imports nothing from Node, NestJS, storage or audio, and it reads no clock. Time enters as an argument (`receivedMonoMs`, `clockMs`, `nowMonoMs`).
- The same samples and the same configuration give the same decisions. `replayCoach` and the golden traces in `fixtures/golden/` depend on this.
- Units: metres, m/s, milliseconds, pedals 0 to 1. km/h only on the screen and in speech. `DEFAULT_CONFIG` writes a speed threshold with `kph(n)`, which gives `n` km/h in m/s (`n / 3.6`). The target speed of an event (`targetSpeedKph`) and its step (`target.roundDownKph`) stay in km/h, because they are spoken values. `comparableSize` converts m/s to km/h to compare the sizes of differences (section Comparison and differences).
- The calibration thresholds are in `DEFAULT_CONFIG` (`packages/core/src/config.ts`). They are calibration values, not physical limits. Some fixed limits are not in `DEFAULT_CONFIG`:
  - `packet-clock.ts`: the packet clock and its warm-up (`ENVELOPE_RISE`, `PACKET_STEP_MAX`, `CLOCK_WARMUP_PACKETS`).
  - `sequence.ts`: the duplicate window and the discontinuity step (`DEFAULT_SEQUENCE_LIMITS`).
  - `cue-text.ts`: the range of target speeds (30 to 350 km/h), the last turn with a focus clip (`MAX_SPOKEN_TURN`) and the estimate of a phrase duration (`estimatedPhraseMs`).
  - `match.ts`: the minimum travel that gives a travel direction (0.05 m).
  - `@gt7/contracts`: the range of the timing offsets, the side cue distances, the wide apex distance and the minimum number of attempts for a recurring difference. `DEFAULT_CONFIG` takes the last two values from there.

## Data flow

```text
datagram → SampleStream (decode, drop duplicates, packet time) → Sample
Sample → AttemptTracker → started, paused, resumed, finished, aborted
Sample → Matcher(reference) → Match (sM, lateralM, trusted)
reference samples → analyseReference → path, events, corners, reference time
Sample + Match → Coach → Cue or a suppressed decision
TrainingRun.step(sample) = AttemptTracker + Matcher + live gap + next cue + Coach, live and in replay
attempt samples + reference → buildReview → findDifferences → recurring → focusSentence
```

| Step | File |
| --- | --- |
| Decode a datagram | `decode.ts` |
| Packet order | `sequence.ts` |
| Attempt start, pause and end | `attempts.ts` |
| Live gap | `timing.ts` |
| Reference path | `reference.ts` |
| Reference analysis (path, events, corners, reference time) | `reference-analysis.ts` |
| Demonstration range in a capture | `demo-range.ts` |
| Position on the reference | `match.ts` |
| Reference events (brake, ease off, throttle) | `cue-events.ts` |
| Corners and apexes | `corners.ts` |
| Voice decisions | `coach.ts`, `guidance.ts`, `coach-replay.ts` |
| One training step, live and in replay | `training-run.ts` |
| Phrases and clip keys | `cue-text.ts` |
| Comparison of an attempt with the reference | `compare.ts` |
| Differences and recurring differences | `findings.ts` |
| Turn of a position and time lost per turn | `turns.ts` |
| Packet time (`clockMs`) | `packet-clock.ts` |
| Focus sentence and brake reaction | `focus.ts` |
| Exercise status and medal | `progress.ts` |
| Vector helpers | `geometry.ts` |

## Packet time

The arrival time of a packet (`receivedMonoMs`) has network bursts: a packet can arrive late, and the packets after it then arrive almost together. On the home network about 5 % of the packets arrive 0 to 3 ms after the packet before them. A late packet can be 60 to 80 ms late. The packet ID increases by 1 per packet, but the packet rate is not constant: in one capture it changed between about 59.2 and 59.9 packets per second.

`PacketClock` (`packet-clock.ts`) gives each sample a packet time `clockMs`:

1. The first packet gets its arrival time.
2. A packet that is 1 to 600 IDs after the last one adds `steps × 1000 / 60` ms, plus the change of the arrival envelope. The envelope is the arrival time minus the nominal time of the packet number. A packet that arrives earlier than the envelope moves the envelope to its arrival at once, because a packet cannot arrive before it is sent. A later packet moves the envelope by 2 % of the difference (`ENVELOPE_RISE`). So a late packet changes the time very little, and a slower or faster packet rate moves the time with the computer clock. The time never goes back: one packet adds at least 0 ms. This applies when the first packet of a run arrived late and the next packet moves the envelope down.
3. The same ID, or an ID up to 64 behind, adds nothing.
4. Any other step adds the arrival difference (not below 0) and starts a new envelope.

`SampleStream` (`packages/capture/src/sample-stream.ts`) applies the clock to each sample that is not a duplicate, live and when the server reads a file (`docs/protocol.md`, Packet ID and sequence). Live, the server counts `clockMs` from the first packet of a capture. When it reads a range of a capture file (`readSamples`), it starts the clock 600 packets (`CLOCK_WARMUP_PACKETS`, 10 s) before the first row of the range (`clockWarmupStart`). The rows before the first row of the range only move the clock and the duplicate check of the stream (`warmupFrom`). They give no sample. The storage cleanup keeps these 600 rows before each range. After 600 packets the envelope does not depend on where the clock started, so the times inside the range are the same as live, also after a cleanup. Measured times use `clockMs`: the time of the reference points and the time series of a review. The time of an attempt is the game time (section Attempt lifecycle, Stored time). The live gap uses the game timer on both sides. Real-time rules use `receivedMonoMs`: silence, the freshness of cues, the decisions of the coach, the extrapolation of the matcher and the demonstration countdown. `clockOf(sample)` gives `clockMs`, or `receivedMonoMs` when a sample has no `clockMs`.

## Continuity

Two samples in a row are **broken** when one of these is true:

| Break | Rule |
| --- | --- |
| `silence` | More than 1000 ms between the samples |
| `car-changed` | The car ID differs |
| `discontinuity` | The distance between the positions is more than `max(speed) × elapsed time + 20 m` |

`continuityBreak` checks all three breaks. `positionBreak` checks only `car-changed` and `discontinuity`.

- The attempt tracker and the demonstration-range finder use `continuityBreak`. For them, a silence is a break.
- `buildReference` uses `positionBreak`. In a reference range, a silence is not a break. The path joins the samples before and after the silence.

A sample is **driven** when it is not paused and not loading. The player **has control** when `playerSession` is true and the sample is driven.

## Reference path

`buildReference(samples, startKind)` turns a reviewed range of a capture into a path.

1. Reject a sample with a field that is not finite. Reject a range with a `car-changed` or `discontinuity` break (`positionBreak`). A silence does not reject a range.
2. Keep the driven samples. Remove repeated identical positions at both ends.
3. Add up the straight distances between the samples. The total is the length `lengthM`.
4. Resample to one point per metre of travel, plus the end point. Each point has `sM` (distance from the start), position, speed, throttle, brake, `timeMs` and `timerMs`.
5. `timeMs` is active time from the start, in packet time (`clockOf`): paused and loading time is not counted. It is a measured time.
6. `timerMs` is the game timer of the samples (`gameTimerMs`), interpolated like the other values. It is not relative to the first point.
7. The tangent of a point is the direction from the point before it to the point after it.

`pointAt(path, sM)` interpolates between two points. `startKind` is `flying` or `standing`. The attempt tracker does not use `startKind`.
A reference is never changed after it is built. Each exercise keeps a history of references with one active reference.

## Reference analysis

`analyseReference(samples, startKind, config)` builds the path (`buildReference`), the events (`buildCueEvents`) and the corners (`findCorners`) of a reference range one time. It gives them in one `ReferenceAnalysis` with the reference time `timeMs`. In the analysis of the samples, `timeMs` is the timer value of the last sample of the range.

`Coach`, `TrainingRun`, `replayCoach` and `buildReview` take the `ReferenceAnalysis`. The focus sentence takes its corners. No other code calls `buildCueEvents` or `findCorners` for a reference.

The server keeps the analysis of each reference in memory (`ReferencesService.analysisOf`). The key is the reference ID. A reference does not change, so the analysis does not change. The server keeps the 8 references that it used last. The cues, corners, path and clips of a reference and the reviews and the training use this analysis. A failed analysis is not kept.

## Demonstration range

A capture of a demonstration also holds the background before and after it.
The demonstration is the same in every run and the background is not, so three captures give its place.

`findDemoRangeCandidates(captures, startCues)`:

1. Collapse repeated samples with the same physical state (position within 0.05 m, speed within 0.1 m/s, pedals within 0.02, same gear and car).
2. Find the pieces that the first capture shares with each other capture, at least 10 samples long. Join pieces that follow each other with a gap of at most 2 samples and no break between them (`continuityBreak`).
3. Keep the runs that all captures share, at least 60 samples long. If more than half of a run in the first capture is also in a longer run, remove the shorter run.
4. Describe each run with three checks. It starts 0 to 5 s after the START cue of its capture. A break comes before its first sample (`continuityBreak`, section Continuity), for example a position jump. It moves more than 10 m.
5. Cut each run to the run of the demonstration timer inside it (`cutToTimerRun(capture, range, 'demonstration')`). A `GameTimerWatch` with the session `demonstration` reads the run from its first sample. The cut starts at the last sample with the value 0 before the start, as the stored first sample of an attempt. The cut ends at the `rawIndex` of the `finished` event: the first packet with the final value. The watch can read packets after the end of the run to see that the value stays the same. But the first packet with the final value must be inside the run. A timer that runs before the run starts, for example a background timer, does not count. The evidence gives the game time of each cut, or says that a capture has no complete timer run.
6. A run that passes all three checks and has a complete timer run in every capture is eligible. With three or more captures and exactly one eligible run, that run is not ambiguous. In every other case the user must choose. A run without a complete timer run keeps its uncut ranges and has `timed` false.
7. Order: timed runs first. Then the score of the checks in step 4: 4 for the START cue, 2 for the break before the run, 1 for the movement. So a run that passes only the START cue check comes before a run that passes only the other two checks. Then the number of samples in the first capture, more first. Then the earlier start in the first capture. The proposals API (`POST /api/exercises/:id/reference-proposals`) gives only timed runs. Without a timed run it gives an empty list.
8. After the cut, two runs can have the same range in the first capture: their uncut ranges are different, but they hold the same timer run. Only the first of these runs in the order of step 7 stays. The reference comes from the range in the first capture, so the other run gives the same reference. Without this step, the same range shows twice. If both runs are eligible, step 6 also marks them as ambiguous.

The reference time is the run of the demonstration timer: the final timer value of the reference range. The server stores it with the reference (`references.timer_ms`). For a cut range, it is the game time of the timer run (`TimerRunRange.gameTimeMs`). For an attempt as a reference, it is the game time of the attempt (`game_ms`). `ReferenceAnalysis.timeMs` of the server gives the stored value. The reference time is not the timer of the last point of the path, because `buildReference` removes held positions at the end of the range, and the timer can continue there. A reference row without a stored value gets it on its first read: the server takes `timeMs` of the analysis of the samples, stores it and then uses it. The cut range starts at the timer value 0, so the first point has `timerMs` 0. For `demo-a` the reference time is 16 082 ms. The packet time of the same path is 16 100 ms. `AttemptReview.referenceTimeMs` and `ReferenceTrace.timeMs` give the reference time. A reference range without a timer run has no valid reference time. The code has no other source for it.

Every reference range is cut to a timer run before the server stores it:

- **Range set by hand** (`POST /api/references`): the server cuts the range to the run of the demonstration timer, with the same rules as step 5. It stores the cut range, not the requested range. For `demo-a`, the range 300 to 1700 is stored as 457 to 1422. If the range has no complete timer run, the server refuses it: HTTP 400 with `{ code: 'no-timer-run', reason }`. It stores no reference.
- **Attempt as a reference** (`POST /api/attempts/:id/promote`): the attempt must be complete and have a game time (`game_ms`). Otherwise the server refuses it: HTTP 409 with `{ code: 'no-game-time', reason }`. The server cuts the attempt range to the run of the player timer (session `player`). The stored attempt range ends 3 packets after the finish, so the cut ends at the first packet with the final value. The reference time of the new reference is the game time of the attempt. For the `ce-clean` attempt it is 17 071 ms.

`matchesReference(capture, path)` checks that a later capture holds the same demonstration. It gives the raw range of the first run that passes, or `null`. The limits are in `DEFAULT_CONFIG.demoRange`.

1. A **run** is a sequence of samples in a row that follow the path. A sample follows the path when all of these are true:
   - The matcher gives a match.
   - The lateral distance is at most 0.5 m, and the height difference is at most 0.5 m.
   - The speed difference is at most 5 % of the reference speed plus 0.5 m/s.
2. A sample that does not follow the path ends the run. If the run does not pass, the matcher starts again.
3. A run passes when all of these are true:
   - It starts at most 1 m after the start of the path, and it ends at most 1 m before the end of the path.
   - The median speed difference is at most 1 % of the reference speed. Below a reference speed of 1 m/s, the check divides the difference by 1 m/s.
   - The 95th percentile of the lateral distance is at most 0.2 m.
   - The median throttle difference is at most 0.05, and the median brake difference is at most 0.05.

The server uses this check in `POST /api/references/:id/check`. A change of the game version sets `needs_check` on each reference of an older version. When the check passes, the server clears `needs_check` of the reference.

## Matching the car to the reference

`Matcher.step(sample)` gives a `Match` or `null`.

1. **Search window.** For the first sample: 0 to 20 m of the path. After that: from 5 m behind the last match to `max(20 m, speed × elapsed time + 10 m)` ahead.
2. **Candidates.** Project the position on each one-metre segment in the window. A projection up to 1 m beyond a segment end is accepted and clamped.
3. **Near.** Keep the candidates with a lateral distance of at most 8 m and a height difference of at most 3 m.
4. **Heading.** The travel direction comes from the last two positions (at least 0.05 m apart), or from the velocity. At 2 m/s or more, prefer the candidates whose path tangent is within 45° of the travel direction.
5. **Cost.** `distance + 0.5 × |sM − expected sM|`, where the expected `sM` is the last match plus `speed × elapsed time`. The lowest cost wins.

Fields of a `Match`:

| Field | Meaning |
| --- | --- |
| `sM` | Distance along the reference, metres |
| `lateralM` | Distance to the side of the reference. Positive is to the right of the travel direction. |
| `heightM` | Height difference |
| `headingErrorDeg` | Angle between the travel direction and the path tangent |
| `velocityErrorDeg` | Angle between the velocity and the path tangent, or `null` below 2 m/s |
| `trusted` | The heading check passed and ` | lateralM | ` is at most 8 m |
| `reference` | The reference point at `sM` |

Guidance uses a match only when it is trusted.

## Attempt lifecycle

`AttemptTracker` has four states: `waiting`, `driving`, `paused`, `finished`. Each start gives a new **generation** number. A cue of an older generation is never played.

The game timer starts and finishes an attempt. The tracker gives each sample to a `GameTimerWatch` (section Game timer below). The position of the car does not start or finish an attempt.

An attempt event has the arrival time (`atMonoMs`) and the packet time (`atClockMs`). The event `finished` also has the game time (`gameTimeMs`). The other events have `gameTimeMs` `null`.

**Start:** the tracker is not driving or paused, and the watch gives `started`. The event `started` has the reason `game-timer` and the `rawIndex` of the sample. Its time is the time of the sample minus the timer value of the sample. So the start is the moment when the timer was 0. A training that starts while the game timer runs waits for the next start of the timer.

**While driving or paused,** in this order:

| Condition | Result |
| --- | --- |
| More than 1000 ms without a sample | `aborted`, reason `silence` |
| `playerSession` is false | `aborted`, reason `player-session-ended` |
| The watch gives `left-track` (the timer is −1) | `aborted`, reason `left-track` |
| The watch gives `restart` (the timer falls to 0) | `aborted`, reason `restart` |
| A break between the samples | `aborted`, reason `car-changed` or `discontinuity` |
| `loading` is true | `aborted`, reason `loading` |
| `paused` becomes true | `paused` |
| `paused` becomes false | `resumed` |
| The watch gives `finished` | `finished`, reason `game-timer` |

The event `finished` has the `rawIndex` of the first sample with the final timer value. Its time is the time of that sample, not the time of the later sample on which the watch reports the finish. Its `gameTimeMs` is the final timer value.

The server stores the raw range of a finished attempt up to the sample on which the watch reports the finish. So the range holds the still packets.

Only the game timer starts and finishes an attempt. The user has no action that starts or finishes an attempt. The user can only stop the training: Stop in Drive sends `POST /api/training/disarm`. If an attempt runs, the server then calls `abortByUser`, and the attempt gets the reason `manual`. There is no other manual action. When the tracker ends an attempt for another reason than the watch, it resets the watch. The watch then needs a new start of the timer.

**Stored time:** `attempts.game_ms` is the `gameTimeMs` of the live `finished` event. It is the time of a complete attempt (`AttemptSummary.timeMs`). The best time of an exercise (`bestMs`), the gap to the best time, the best time of a day and the medal from the targets use it. The gap to the reference and the gap to the next medal use the game time. An aborted attempt has no stored time: `game_ms` is `null` and `AttemptSummary.timeMs` is `null`. There is no manual official time. The database check `attempts_game_time_check` requires `game_ms` for a complete attempt and no `game_ms` for an aborted attempt.

**Live gap** (`gapToReferenceMs`): the game timer of the running attempt minus the demonstration timer at the matched position. The attempt side is the game timer of the current sample (`gameTimerMs`). The reference side is `timerMs` of the reference point of the match (`match.reference`, which the matcher gets with `pointAt`). A positive gap means that the attempt is slower than the reference at this position. The server sends the gap as `gapMs` in the live state. During a pause the game timer and the position do not change, so the gap keeps its value from before the pause. The gap is `null` when no attempt runs, when the matcher gives no position, or when the timer is 0 or -1. On `ce-pause` with the `demo-a` reference, the gap has a value up to packet 13306. That packet has the final timer value 17 412 ms, and its gap is 1330 ms. The still packets 13307 and 13308 come after the end of the reference path. The matcher gives no position for them, so their gap is `null`. The attempt ends at packet 13309, and the gap stays `null`. The reference time is 16 082 ms. So the last live gap is the Review gap.

**Review gap:** the game time of a complete attempt (`AttemptSummary.timeMs`) minus the reference time (`AttemptReview.referenceTimeMs`). Both are game times. On `ce-pause` with the `demo-a` reference, the Review gap is 17 412 − 16 082 = 1330 ms. The time lost by distance and the time lost per turn use measured times on both sides. These are the time series `t` of the attempt and of the reference in the review.

**Does the voice help?** The web compares the median game time (`timeMs`) of complete baseline attempts with the median game time of complete guided attempts. It uses only the attempts of the active reference. An attempt without a game time does not count.

### Game timer

`GameTimerWatch` reads `gameTimerMs` of each sample. It gives the events `started`, `finished`, `left-track` and `restart`. Each event has the `rawIndex` and the game time in ms. The watch is active from `started` until one of the other three events.

**Started:** the watch is not active. The sample has `playerSession`. The previous sample had the value 0. This sample has a value from 1 to 50 ms (`gameTimer.startMaxMs`). A jump to a larger value is not a start.

**Repeated packets:** while the watch is active, a sample with the same packet ID as the last counted one, or up to 64 IDs behind it, changes nothing. Any other packet ID counts as newer, also after a wrap of the 32-bit counter or a large drop. `SequenceTracker` uses the same rule (`isRepeatedPacket`).

**Left track:** the value is -1. The watch becomes inactive.

**Restart:** the value is 0. The watch becomes inactive.

**Finished:** the sample is not paused. The value did not increase for 3 packets in a row (`gameTimer.stillPackets`). Each of these packets is a newer packet, as in the rule above. The event has the `rawIndex` of the first packet with the final value. Its game time is that value. The watch becomes inactive. A packet with `paused` set clears the count of still packets.

After an event, the watch needs the full start rule again. `docs/protocol.md`, Game timer, gives the facts.

**Session:** the default session `player` needs `playerSession` for a start. The session `demonstration` needs `playerSession` false. Only the demonstration-range finder uses it. The attempt tracker always uses `player`.

## Reference events

`buildCueEvents(path)` reads the pedals of the reference and gives the events that the voice can speak.
A condition must hold for three points in a row.

| Event | Rule |
| --- | --- |
| `brake` | Brake above 0.10. The zone ends when the brake is at or below 0.10. Zones closer than 5 m are joined. |
| `ease-off` | Throttle was 0.5 or more and falls to 0.1 or less, and no brake zone starts within 1000 ms |
| `throttle` | After a release or a brake zone, throttle above 0.5 outside a brake zone |

- The key of an event is `<kind>@<sM rounded>`, for example `brake@332`. Mutes and timing offsets use this key. `eventKey`, `eventKeyKind` and `eventKeyPlace` in `packages/contracts` make and read keys. The server and the web use these functions or the stored columns, and do not split a key themselves.
- Two events of the same kind (not brake) closer than 5 m: the second is dropped.
- An event in the last 20 m of the path is dropped.

**Target speed.** For a brake: the speed at the end of the zone. For a throttle: the reference speed 2 s later. The value is rounded down to 5 km/h. Supported values are 30 to 350 km/h. Outside this range there is no target.

**Phrase of a brake.** The speed loss is the entry speed minus the speed at the end of the zone.

| Loss | Phrase |
| --- | --- |
| 16.67 m/s (60 km/h) or more | `Hard brake` |
| 6.94 m/s (25 km/h) or more | `Brake` |
| Less | `Light brake` |

**Big stop.** A brake with an entry speed of 55.56 m/s (200 km/h) or more and a loss of 27.78 m/s (100 km/h) or more also gets the warning `Big stop` before it.

**Phrase of a throttle.** `Full throttle` when the reference throttle reaches 0.95 within 2 s after the event. In other cases, `Throttle`.

**Text and clips of an event.** `cue-text.ts` composes all cue text and all clip keys. The server and the browser use these values and do not make their own.

- The clip of an event is its phrase key, for example `hard-brake`. The text is the phrase, for example `Hard brake`.
- The follow clip of a brake with a target is `speed-<km/h>`, for example `speed-85`. The voice speaks it after the action clip only when `Speak target speeds` is on.
- The spoken phrase adds the target in words when `Speak target speeds` is on, for example `Hard brake. Eighty five`.
- The words of the fixed cues (`CUE_WORDS`) are in `@gt7/contracts`, so that the Drive screen shows the same words that the voice speaks.

**Clips of a reference.** `clipsOf(path, events, corners)` gives each clip that a training on the reference can play: the clip and the follow clip of each event, `Big stop` if a brake is a big stop, `Tighter` if the reference has a corner, the side cues, the guidance cues, the focus sentences of each turn up to turn ten, the countdown and `Voice check`. The browser loads this list before a guided training (`GET /api/references/:id/clips`).

## Corners

`findCorners(path, events)` (called only by `analyseReference`):

1. **Curvature.** At each metre, take the tangents 10 m before and 10 m after. The angle between them divided by 20 m is the curvature. The sign of the angle is the turn direction.
2. **Window.** Each `brake` or `ease-off` opens a window. It ends 40 m after the next `throttle`, or at the end of the path.
3. **Apex.** The point of the largest curvature in the window. A window whose radius at that point is more than 150 m is not a corner.
4. **Turn-in.** The last point before the apex where the curvature is below one third of the apex curvature.
5. Corners are numbered in order of their apex, from 1.

`outsideM(corner, lateralM) = −insideSign × lateralM`. A positive value means that the car is on the outside of the corner.

## Voice decisions

`Coach.step(input)` runs once per sample and gives at most one cue. The coach gets the settings of the exercise once, when it is made (`CoachSettings`: muted keys, speak targets, timing offsets, side cue distance). Each step gives only the sample, the match, the time, the generation, the device delay and the phrase durations.

`TrainingRun` (`training-run.ts`) is the one training step. The live training (`TrainingSession` on the server) and `replayCoach` both use it, so the two cannot give different decisions. `TrainingRun.step(sample)` does these steps in this sequence:

1. It gives the sample to the `AttemptTracker`.
2. On `started`, it takes a new generation (`nextGeneration`), resets the matcher and sets guidance to active. It gives the start samples: the sample before the start (timer 0) and the start sample.
3. If no attempt runs (state not `driving` or `paused`), it stops. The match, the gap and the next cue are then `null`.
4. It matches the sample, and it calculates the live gap and the next cue that is not muted.
5. In a guided training, it gives the sample to the coach. A new generation resets the coach on its first step. No other call resets the coach.

`TrainingRun` expects unique samples in packet order. `SampleStream` removes the repeated packets before the step, live and in the evaluation tool (`readSamples`). `TrainingSession` only adds the effects: it sends the cue, cancels old generations, records the cue rows and gives the ended attempt to storage. `replayCoach` folds the steps of a capture into a trace. The evaluation tool and the golden traces use it.

### When the coach is silent

- The player has no control, or the sample is older than 150 ms.
- Guidance waits for a restart (the car passed the end of the path).
- The match is missing or not trusted. Guidance is then suspended.

### Time to an event

`time = (−v + √(v² + 2·a·d)) / a` for a distance `d`, a speed `v` and an acceleration `a` above 0.
When the acceleration is 0, `time = d / v`.
The acceleration is the speed change over the last 300 ms and is never negative. With less than 100 ms of speeds, the acceleration is 0.

### When a cue is due

The coach decides a cue when the time to its event is at most `device delay + 500 ms + offset of this cue + sample period`.
The sample period is the time since the previous step of the coach, at most 100 ms. On the first step it is 1000 / 60 ms.
The 500 ms is the reaction time: the first word starts 500 ms before the point.
The offset is the per-cue setting of the exercise, −500 to +1000 ms in steps of 100 ms. A positive value is earlier.
`Big stop` is due at `device delay + 2000 ms + offset of its brake + sample period`.

A cue is **too late** when the time to its event is less than the device delay. `Big stop` has three more checks:

- It is too late when its phrase would not finish before the lead of its brake.
- It is too late when a brake or ease-off event between the car and its brake becomes due before the end of the `Big stop` phrase. An event between them that becomes due later does not stop `Big stop`.
- It gets `cooldown` for 1500 ms after a cue with a priority of 90 or more, when that cue is the last cue of the coach. A brake, `Big stop` and `Ease off` have a priority of 90 or more.

### Targets and the mute check

Each candidate and each suppressed decision has a target: the event kind, the voice, the place `sM` and the mute key.

| Cue | Event kind | Place | Mute key |
| --- | --- | --- | --- |
| Brake, ease-off, throttle | `brake`, `ease-off`, `throttle` | The event | The event key |
| `Big stop` | `big-stop` | Its brake | The key of its brake |
| `Tighter` | `tighter` | Where the cue is decided | `tighter` |
| `Keep left`, `Keep right` | `keep-left`, `keep-right` | Where the cue is decided | `keep-left`, `keep-right` |
| `Guidance paused`, `Guidance resumed` | `guidance` | None | None |

- The coach checks mutes at one point, when it chooses the cue of a sample. A candidate is muted when it has a mute key and that key is in the muted keys.
- A mute comes before every other reason: a muted candidate gets `muted` also when it is too late.
- A muted throttle event opens no window.
- The server stores the event kind and the place of each cue event (`event_kind`, `s_m`). `kind` stays the voice of a spoken cue and the event kind of a suppressed decision. The focus cue has the event kind `focus` and no place.

### Priority and cooldown

| Cue | Priority |
| --- | --- |
| Brake (`Hard brake`, `Brake`, `Light brake`) | 100 |
| `Big stop` | 95 |
| `Ease off` | 90 |
| Position (`Keep left`, `Keep right`, `Tighter`) | 50 |
| Throttle (`Throttle`, `Full throttle`) | 20 |
| System (`Guidance paused`, `Guidance resumed`, focus) | 10 |
| Countdown | 101 |

- Of the candidates of one sample, the highest priority speaks. The others get `lower-priority`.
- For 1500 ms after a cue, a candidate with the same or a lower priority gets `cooldown`. A higher priority speaks at once.
- One factory (`makeCue` in `packages/core`) builds every cue, also the focus cue and the countdown cues. It sets the id, the priority from the kind, and the time to live.
- Each cue has a time to live of `150 ms + device delay`, but a countdown cue has 800 ms. The browser drops a cue that arrives later, and a cue of an older generation.
- Known limit: a position cue has a higher priority than a throttle cue, so it can follow a throttle cue inside the cooldown.

### Throttle cues

A throttle event opens a window when it becomes due. The cue speaks at the first sample where all of these are true, and never after the point:

- No brake event lies between the car and `event + speed × 2 s`.
- The match is stable for the last 300 ms.
- The car is at most 1 m/s faster than the reference and at most 3 m to the side.
- The heading and velocity errors are at most 10°, and the brake is at most 0.05.
- For `Full throttle`: the player's throttle is below 0.95.

### Missed braking

When the car passes the end of a brake zone more than 4.17 m/s (15 km/h) faster than the reference, guidance is suspended (`target-incompatible`). The throttle and ease-off cues up to the next brake are cancelled.

### Suspended guidance

- Guidance resumes after 1000 ms of a trusted match beyond the cancelled section.
- `Guidance paused` is spoken only after 2000 ms of suspension, and `Guidance resumed` only if the pause was spoken. Neither phrase is spoken when a brake or ease-off cue would come during it.
- A cue that became due during the suspension is never replayed.

### Tighter

The voice says `Tighter` when the car stays more than 2 m on the outside for a hold time of 300 ms or more.
This applies between the turn-in point and the apex of a corner.
The voice says it once per corner.
The mute key is `tighter`.

### Side cues

`Keep left` and `Keep right` use the setting `Side cue distance` of the exercise (`Off`, or 0.5 m to 3 m). The default is `DEFAULT_SIDE_CUE_DISTANCE_M`, 2 m.

- When `|lateralM|` is above the distance on the same side for 300 ms, a cue is decided.
- A positive `lateralM` (car to the right of the reference) gives `Keep left`. A negative one gives `Keep right`.
- Once per excursion: the car must come back within the distance before the next side cue. A side cue that loses to another cue or to the cooldown is not repeated in that excursion.
- Between the turn-in point and the apex the side cue does not speak. The excursion timer continues, so the cue can speak once after the apex.
- The mute keys are `keep-left` and `keep-right`.

### Recording countdown

A demonstration capture with a wait of `d` seconds before the START cue gets a spoken countdown. The server decides it, not the coach.

- The voice says `Three`, `Two` and `One` at `d − 3`, `d − 2` and `d − 1` seconds after the capture starts, and `Start` at `d` seconds. It is silent before.
- A count that falls before the capture start is not spoken. With `d = 2` the voice says `Two`, `One`, `Start`.
- Each count is a cue of the kind `countdown` with the event key `countdown-<capture id>-<count>` (3, 2, 1, 0 for `Start`). It goes only to the voice device of the profile.
- The priority is 101, above every training cue. The time to live is 800 ms.
- The four counts share one new generation. The server takes it from the same counter as the training generations, so the browser never drops a count as old.
- When the capture stops, the counts that are not spoken yet are cancelled.
- A capture without a wait, and a capture of another purpose, has no countdown.
- The Drive screen does not show a countdown cue.

### Snapshot

Training takes the muted keys, the timing offsets, `Speak target speeds` and the side cue distance at arm time. A change of the exercise during an armed session has no effect until the next arm.

## Comparison and differences

`buildReview(attempt, analysis)` puts the attempt and the reference on one grid of 2 m along the path: time, speed, throttle, brake, position and lateral distance. A gap of more than 10 m between two matches stays empty. The attempt's own events are detected with the same rules as the reference events.

`findDifferences(review)` gives the differences. A difference is not called a mistake.

| Kind | Rule | Size |
| --- | --- | --- |
| `brake-early`, `brake-late` | The attempt's brake nearest to a reference brake (within 60 m) is more than 8 m before or after it | metres |
| `slow-corner` | The lowest speed in the zone is more than 2.22 m/s (8 km/h) below the reference. The zone starts at the brake point and ends 40 m after the brake zone, or before the next brake. | m/s (unit `m/s`). The screen shows km/h. |
| `throttle-late` | The attempt's throttle is more than 10 m after the reference throttle (within 60 m) | metres |
| `off-line` | More than 1.5 m to one side for more than 500 ms | largest distance, metres |
| `wide-apex` | More than 2 m on the outside at the apex of a corner | metres |

**Turn of a position.** `turnOf(corners, sM)` gives the number of the last corner whose zone starts at or before `sM`. A position before the zone of turn 1 belongs to turn 1. Without corners the result is `null`. Each difference gets the turn of its position.

**Time lost per turn.** `turnLosses(corners, lengthM, gridM, attemptT, referenceT)` splits the section into one zone per turn. The zone of turn 1 starts at 0 m. The zone of each other turn starts at its zone start. A zone ends at the zone start of the next turn, or at the end of the section. The gap at a grid point is the attempt time minus the reference time. The time lost in a zone is the gap at the last grid point that has both times, minus the gap at the first such point. Both ends of the zone are included. A zone with fewer than two such points has no value. Without corners the list is empty. A negative value is time gained.

**Recurring.** With at least three complete attempts, a difference is recurring when it occurs in at least half of them. The code groups differences that have an event key by kind and key. It groups `off-line` differences by place, within 20 m. The size is the median.

**Focus sentence.** After an attempt the voice names one difference: the most frequent recurring difference, or else the largest difference of the last attempt. To compare sizes of different units, `comparableSize` counts 1 m/s as 3.6, so 1 km/h counts as 1 m. The largest difference of an attempt summary uses the same rule. The sentence is the corner number and an action, for example `Turn two. Tighter at the apex.` Up to turn ten has a clip.

**Brake reaction.** The reaction to a played brake cue is the time from the start of the clip to the moment the brake rises above 0.10. The limit is 3000 ms. A negative value means that the player braked before the cue.

## Exercise status

`exerciseStatus`: with no complete attempt the status is `ready` (an active reference exists) or `new`. Else the medal that the best game time reaches against the targets of the exercise, or `practising`.

## Thresholds

The full list is `DEFAULT_CONFIG`. These values appear most often in this document.

| Setting | Value |
| --- | --- |
| Freshness of a sample | 150 ms |
| Silence gap | 1000 ms |
| Trusted lateral distance, height, heading | 8 m, 3 m, 45° at 2 m/s or more |
| Matcher search | 5 m back, `max(20 m, speed × time + 10 m)` ahead |
| Discontinuity margin | 20 m |
| Cue lead | Device delay + 500 ms |
| Cue time to live | 150 ms + device delay |
| Cooldown | 1500 ms |
| Big stop | Entry 55.56 m/s (200 km/h), loss 27.78 m/s (100 km/h), lead 2000 ms |
| Target speed step | 5 km/h, rounded down |
| Side cue hold, default distance | 300 ms, 2 m |
| Wide apex and `Tighter` | 2 m, hold 300 ms |
| Review grid | 2 m |

## Test fixtures

Tests use `fixtures/`, never `data/`. `fixtures/manifest.json` names the source range of each file.

| Fixture | Content |
| --- | --- |
| `demo-a`, `demo-b`, `demo-c` | Three captures of the same demonstration of Autódromo de Interlagos, Circuit Experience sector 2, with waits of 5, 10 and 15 s. The demonstration timer runs 16 082 ms. The reference of the tests is `demo-a`, raw 457 to 1422 (the cut to the demonstration timer): 966 samples, 818.17 m, one corner with the apex at 404 m. |
| `ce-clean` | A clean run of the same sector: start 8452, finish 17 071 ms at 9476, screen 0:17.071 (bronze). The stored attempt range is 8451 to 9479. |
| `ce-slow` | A run of the same sector, too slow for the game: start 5492, finish 18 824 ms at 6621. It brakes late at the first corner. The stored attempt range is 5491 to 6624. |
| `ce-pause` | A run with a pause of 696 samples (raw 11651 to 12346): start 11565, finish 17 412 ms at 13306. It brakes early at the first corner. |
| `ce-off-track-reset`, `ce-off-track-end` | Runs that leave the track (value -1), then restart or end the session |
| `b3-run`, `b1-run` | National B licence tests B-3 (15 839 ms) and B-1 (standing start, 20 366 ms) |

The demo uses `demo-a` and the attempts `ce-clean`, `ce-slow` and `ce-pause`. The demo exercise gets the medal targets of the sector from the seed: gold 16.400 s, silver 16.700 s, bronze 17.800 s. The catalogue has no targets for it.

Golden traces: `fixtures/golden/ce-slow-cues.json` (default settings) and `fixtures/golden/ce-slow-cues-side-1m.json` (side cue distance 1 m).
Rewrite them only after a deliberate coach or clip change, and read the new trace first:

```sh
pnpm evaluate-coach --attempt ce-slow --reference demo-a --first 457 --last 1422 --out fixtures/golden/ce-slow-cues.json
pnpm evaluate-coach --attempt ce-slow --reference demo-a --first 457 --last 1422 --side-distance 1 --out fixtures/golden/ce-slow-cues-side-1m.json
```
