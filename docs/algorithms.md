# Core algorithms

This document describes the calculations of `packages/core`.
It covers the reference, the match of the car to the reference, the attempt, the voice and the differences.
Read it before you change a file in `packages/core/src`. The protocol is in `docs/protocol.md`.

Rules of the core:

- It is pure TypeScript. It imports nothing from Node, NestJS, storage or audio, and it reads no clock. Time enters as an argument (`receivedMonoMs`, `nowMonoMs`).
- The same samples and the same configuration give the same decisions. `replayCoach` and the golden traces in `fixtures/golden/` depend on this.
- Units: metres, m/s, milliseconds, pedals 0 to 1. km/h only on the screen and in speech.
- Every threshold is in `DEFAULT_CONFIG` (`packages/core/src/config.ts`). The values are calibration values from one exercise, not physical limits.

## Data flow

```text
datagram → decode → Sample
Sample → AttemptTracker → started, paused, resumed, finished, aborted
Sample → Matcher(reference) → Match (sM, lateralM, trusted)
Sample + Match → Coach → Cue or a suppressed decision
attempt samples + reference → buildReview → findDifferences → recurring → focusSentence
```

| Step | File |
| --- | --- |
| Decode a datagram | `decode.ts` |
| Packet order | `sequence.ts` |
| Attempt start, pause and end | `attempts.ts` |
| Measured attempt time | `timing.ts` |
| Reference path | `reference.ts` |
| Demonstration range in a capture | `demo-range.ts` |
| Position on the reference | `match.ts` |
| Reference events (brake, ease off, throttle) | `cue-events.ts` |
| Corners and apexes | `corners.ts` |
| Voice decisions | `coach.ts`, `guidance.ts`, `coach-replay.ts` |
| Phrases and clip keys | `cue-text.ts` |
| Comparison of an attempt with the reference | `compare.ts` |
| Differences and recurring differences | `findings.ts` |
| Focus sentence and brake reaction | `focus.ts` |
| Exercise status and medal | `progress.ts` |
| Vector helpers and gates | `geometry.ts` |

## Geometry

- A **gate** is a position and a unit direction of travel (`tangent`).
- `gateOffset(gate, point)` gives `along` (distance along the tangent, negative before the gate), `lateral` (horizontal distance from the gate line) and `height` (vertical distance).
- A **crossing** happens between two samples when `along` goes from below 0 to 0 or more. The crossing point is interpolated. It counts only when it lies within 8 m of the gate position sideways and within 3 m in height.
- The crossing time is interpolated between the two samples. If the samples are more than 100 ms apart, the time of the second sample is used.

## Continuity

Two samples in a row are **broken** when one of these is true:

| Break | Rule |
| --- | --- |
| `silence` | More than 1000 ms between the samples |
| `car-changed` | The car ID differs |
| `discontinuity` | The distance between the positions is more than `max(speed) × elapsed time + 20 m` |

A sample is **driven** when it is not paused and not loading. The player **has control** when `playerSession` is true and the sample is driven.

## Reference path

`buildReference(samples, startKind)` turns a reviewed range of a capture into a path.

1. Reject a sample with a field that is not finite, and a range with a break.
2. Keep the driven samples. Remove repeated identical positions at both ends.
3. Add up the straight distances between the samples. The total is the length `lengthM`.
4. Resample to one point per metre of travel, plus the end point. Each point has `sM` (distance from the start), position, speed, throttle, brake and `timeMs`.
5. `timeMs` is active time from the start: paused and loading time is not counted.
6. The tangent of a point is the direction from the point before it to the point after it.
7. The start gate and the end gate are the first and the last point with their tangents.

`pointAt(path, sM)` interpolates between two points. `startKind` is `flying` (the car crosses the start gate at speed) or `standing`.
A reference is never changed after it is built. Each exercise keeps a history of references with one active reference.

## Demonstration range

A capture of a demonstration also holds the background before and after it.
The demonstration is the same in every run and the background is not, so three captures give its place.

`findDemoRangeCandidates(captures, startCues)`:

1. Collapse repeated samples with the same physical state (position within 0.05 m, speed within 0.1 m/s, pedals within 0.02, same gear and car).
2. Find the pieces that the first capture shares with each other capture, at least 10 samples long. Join pieces that follow each other with a gap of at most 2 samples.
3. Keep the runs that all captures share, at least 60 samples long.
4. Describe each run with three checks. It starts 0 to 5 s after the START cue of its capture. A position jump comes before it. It moves more than 10 m.
5. A run that passes all three checks is eligible. With three or more captures and exactly one eligible run, that run is not ambiguous. In every other case the user must choose.

`matchesReference(capture, path)` checks that a later capture holds the same demonstration. All of these must be true:

- The run covers the whole path.
- The median speed difference is at most 1 %.
- The 95th percentile of the lateral distance is at most 0.2 m.
- The median pedal difference is at most 0.05.

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

**Start, flying:** the previous sample and the current sample both have player control, there is no break, and the car crosses the start gate.

**Start, standing:** the car is slower than 0.5 m/s inside the start area, which is 3 m around the start gate. Then it moves at 0.5 m/s or more for three samples in a row. The first of these samples is the start.

**While driving or paused,** in this order:

| Condition | Result |
| --- | --- |
| More than 1000 ms without a sample | `aborted`, reason `silence` |
| `playerSession` is false | `aborted`, reason `player-session-ended` |
| A break between the samples | `aborted`, reason `car-changed` or `discontinuity` |
| `loading` is true | `aborted`, reason `loading` |
| `paused` becomes true | `paused` |
| `paused` becomes false | `resumed` |
| The car crosses the end gate | `finished`, reason `end-gate` |

A manual action can also start, finish or abort an attempt.

**Measured time** (`measureAttemptMs`): the time of the `finished` event minus the time of the `started` event minus the paused time. It is a measured time, not the official time of the game.

## Reference events

`buildCueEvents(path)` reads the pedals of the reference and gives the events that the voice can speak.
A condition must hold for three points in a row.

| Event | Rule |
| --- | --- |
| `brake` | Brake above 0.10. The zone ends when the brake is at or below 0.10. Zones closer than 5 m are joined. |
| `ease-off` | Throttle was 0.5 or more and falls to 0.1 or less, and no brake zone starts within 1000 ms |
| `throttle` | After a release or a brake zone, throttle above 0.5 outside a brake zone |

- The key of an event is `<kind>@<sM rounded>`, for example `brake@332`. Mutes and timing offsets use this key.
- Two events of the same kind (not brake) closer than 5 m: the second is dropped.
- An event in the last 20 m of the path is dropped.

**Target speed.** For a brake: the speed at the end of the zone. For a throttle: the reference speed 2 s later. The value is rounded down to 5 km/h. Supported values are 30 to 350 km/h. Outside this range there is no target.

**Phrase of a brake.** The speed loss is the entry speed minus the speed at the end of the zone.

| Loss | Phrase |
| --- | --- |
| 60 km/h or more | `Hard brake` |
| 25 km/h or more | `Brake` |
| Less | `Light brake` |

**Big stop.** A brake with an entry speed of 200 km/h or more and a loss of 100 km/h or more also gets the warning `Big stop` before it.

**Phrase of a throttle.** `Full throttle` when the reference throttle reaches 0.95 within 2 s after the event. In other cases, `Throttle`.

## Corners

`findCorners(path, events)`:

1. **Curvature.** At each metre, take the tangents 10 m before and 10 m after. The angle between them divided by 20 m is the curvature. The sign of the angle is the turn direction.
2. **Window.** Each `brake` or `ease-off` opens a window. It ends 40 m after the next `throttle`, or at the end of the path.
3. **Apex.** The point of the largest curvature in the window. A window whose radius at that point is more than 150 m is not a corner.
4. **Turn-in.** The last point before the apex where the curvature is below one third of the apex curvature.
5. Corners are numbered in order of their apex, from 1.

`outsideM(corner, lateralM) = −insideSign × lateralM`. A positive value means that the car is on the outside of the corner.

## Voice decisions

`Coach.step(input)` runs once per sample and gives at most one cue. `replayCoach` runs the tracker, the matcher and the coach over a capture. The evaluation tool and the golden traces use it.

### When the coach is silent

- The player has no control, or the sample is older than 150 ms.
- Guidance waits for a restart (the car passed the end of the path).
- The match is missing or not trusted. Guidance is then suspended.

### Time to an event

`time = (−v + √(v² + 2·a·d)) / a` for a distance `d`, a speed `v` and an acceleration `a` above 0.
When the acceleration is 0, `time = d / v`.
The acceleration is the speed change over the last 300 ms and is never negative.

### When a cue is due

A cue is decided when the time to its event is at most `device delay + 500 ms + offset of this cue`.
The 500 ms is the reaction time: the first word starts 500 ms before the point.
The offset is the per-cue setting of the exercise, −500 to +1000 ms in steps of 100 ms. A positive value is earlier.
`Big stop` is due at `device delay + 2000 ms + offset of its brake`.

A cue is **too late** when less time than the device delay is left. `Big stop` is also too late when its phrase would not finish before the lead of the brake. It is also too late when another brake or ease-off cue lies in between.

### Priority and cooldown

| Cue | Priority |
| --- | --- |
| Brake (`Hard brake`, `Brake`, `Light brake`) | 100 |
| `Big stop` | 95 |
| `Ease off` | 90 |
| Position (`Keep left`, `Keep right`, `Tighter`) | 50 |
| Throttle (`Throttle`, `Full throttle`) | 20 |
| System (`Guidance paused`, `Guidance resumed`) | 10 |

- Of the candidates of one sample, the highest priority speaks. The others get `lower-priority`.
- For 1500 ms after a cue, a candidate with the same or a lower priority gets `cooldown`. A higher priority speaks at once.
- Each cue has a time to live of `150 ms + device delay`. The browser drops a cue that arrives later, and a cue of an older generation.
- Known limit: a position cue has a higher priority than a throttle cue, so it can follow a throttle cue inside the cooldown.

### Throttle cues

A throttle event opens a window when it becomes due. The cue speaks at the first sample where all of these are true, and never after the point:

- No brake event lies between the car and `event + speed × 2 s`.
- The match is stable for the last 300 ms.
- The car is at most 1 m/s faster than the reference and at most 3 m to the side.
- The heading and velocity errors are at most 10°, and the brake is at most 0.05.
- For `Full throttle`: the player's throttle is below 0.95.

### Missed braking

When the car passes the end of a brake zone more than 15 km/h faster than the reference, guidance is suspended (`target-incompatible`). The throttle and ease-off cues up to the next brake are cancelled.

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

### Snapshot

Training takes the muted keys, the timing offsets, `Speak target speeds` and the side cue distance at arm time. A change of the exercise during an armed session has no effect until the next arm.

## Comparison and differences

`buildReview(attempt, path)` puts the attempt and the reference on one grid of 2 m along the path: time, speed, throttle, brake, position and lateral distance. A gap of more than 10 m between two matches stays empty. The attempt's own events are detected with the same rules as the reference events.

`findDifferences(review)` gives the differences. A difference is not called a mistake.

| Kind | Rule | Size |
| --- | --- | --- |
| `brake-early`, `brake-late` | The attempt's brake nearest to a reference brake (within 60 m) is more than 8 m before or after it | metres |
| `slow-corner` | The lowest speed from the brake point to 40 m after the zone end is more than 8 km/h below the reference | km/h |
| `throttle-late` | The attempt's throttle is more than 10 m after the reference throttle (within 60 m) | metres |
| `off-line` | More than 1.5 m to one side for more than 500 ms | largest distance, metres |
| `wide-apex` | More than 2 m on the outside at the apex of a corner | metres |

**Recurring.** With at least three complete attempts, a difference is recurring when it occurs in at least half of them. The code groups differences that have an event key by kind and key. It groups `off-line` differences by place, within 20 m. The size is the median.

**Focus sentence.** After an attempt the voice names one difference: the most frequent recurring difference, or else the largest difference of the last attempt. The sentence is the corner number and an action, for example `Turn two. Tighter at the apex.` Up to turn ten has a clip.

**Brake reaction.** The reaction to a played brake cue is the time from the start of the clip to the moment the brake rises above 0.10. The limit is 3000 ms. A negative value means that the player braked before the cue.

## Exercise status

`exerciseStatus`: a manual medal wins. With no complete attempt the status is `ready` (an active reference exists) or `new`. Else the medal that the best measured time reaches against the targets of the exercise, or `practising`.

## Thresholds

The full list is `DEFAULT_CONFIG`. These values appear most often in this document.

| Setting | Value |
| --- | --- |
| Freshness of a sample | 150 ms |
| Silence gap | 1000 ms |
| Trusted lateral distance, height, heading | 8 m, 3 m, 45° at 2 m/s or more |
| Matcher search | 5 m back, `max(20 m, speed × time + 10 m)` ahead |
| Gate half-width, height tolerance | 8 m, 3 m |
| Discontinuity margin | 20 m |
| Start area, moving speed, samples | 3 m, 0.5 m/s, 3 |
| Cue lead | Device delay + 500 ms |
| Cue time to live | 150 ms + device delay |
| Cooldown | 1500 ms |
| Big stop | Entry 200 km/h, loss 100 km/h, lead 2000 ms |
| Target speed step | 5 km/h, rounded down |
| Side cue hold, default distance | 300 ms, 2 m |
| Wide apex and `Tighter` | 2 m, hold 300 ms |
| Review grid | 2 m |

## Test fixtures

Tests use `fixtures/`, never `data/`. `fixtures/manifest.json` names the source range of each file.

| Fixture | Content |
| --- | --- |
| `demo-wait05`, `demo-wait10`, `demo-wait15` | Three captures of the same Yangwang demonstration. The reference of the tests is `demo-wait05`, raw 352 to 1897: 1546 samples, 1092.65 m. |
| `player-run` | A player's attempt, raw 1162 to 2786, about 27.1 s, then the automatic replay. Car ID 3602. |
| `player-pause` | A player's attempt with a pause of 539 samples and no finish |
| `h3-wide-apex`, `h3-wide-finish` | Attempts with a wide line, used by the demo and by tests |

Golden traces: `fixtures/golden/player-run-cues.json` (default settings) and `fixtures/golden/player-run-cues-side-1m.json` (side cue distance 1 m).
Rewrite them only after a deliberate coach or clip change, and read the new trace first:

```sh
pnpm evaluate-coach --attempt player-run --reference demo-wait05 --first 352 --last 1897 --out fixtures/golden/player-run-cues.json
pnpm evaluate-coach --attempt player-run --reference demo-wait05 --first 352 --last 1897 --side-distance 1 --out fixtures/golden/player-run-cues-side-1m.json
```
