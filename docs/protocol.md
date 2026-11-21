# GT7 telemetry protocol

Telemetry that Gran Turismo 7 on PS5 sends, and how GT7 Tutor receives, times and stores it (Reception in GT7 Tutor). The calculations on the samples are in `docs/algorithms.md`.

Sources: transport, formats, key, nonce constants and byte layout follow gt7-datalogger (MIT, `THIRD_PARTY_NOTICES.md`). Flag meanings and the behaviour of 0x15C come from own PS5 captures. The game does not document either.

## Transport

| Item | Value |
| --- | --- |
| Protocol | UDP over IPv4 |
| Receive port (computer) | 33740 |
| Heartbeat port (console) | 33739 |
| Heartbeat payload | One ASCII letter: the packet format that the console sends |
| Heartbeat period | 1000 ms, first heartbeat at once after the bind |
| Packet rate | About 60 per second (59.2 to 59.94 Hz) |

- The console sends packets only while it receives heartbeats.
- One program at a time can bind port 33740.
- Packets arrive in bursts. About 5 % of packets arrive 0 to 3 ms after the packet before them. A late packet can be 60 to 80 ms late.

## Packet formats

| Letter | Length | Nonce constant | Content |
| --- | --- | --- | --- |
| `A` | 296 bytes (0x128) | `0xDEADBEAF` | Base fields |
| `B` | 316 bytes (0x13C) | `0xDEADBEEF` | `A` and motion fields |
| `~` | 344 bytes (0x158) | `0x55FABB4F` | `B` and powertrain fields |
| `C` | 368 bytes (0x170) | `0xDEADBEEF` | `~` and wheel fields |

Each format starts with the complete smaller format.

## Decryption

1. Key: the first 32 bytes of the ASCII text `Simulator Interface Packet GT7 ver 0.0`.
2. `iv`: u32 at 0x40 of the encrypted packet.
3. Nonce, 8 bytes: bytes 0 to 3 are `iv XOR constant`, bytes 4 to 7 are `iv`, both little-endian.
4. Decrypt the whole packet with Salsa20.
5. The u32 at 0x00 of the decrypted packet is `0x47375330`.

## Byte layout

Little-endian.

### Base fields (296 bytes)

| Offset | Type | Content |
| --- | --- | --- |
| 0x00 | u32 | Magic `0x47375330` |
| 0x04 | 3 × f32 | Position x, y, z, m. y is the height. |
| 0x10 | 3 × f32 | Velocity x, y, z, m/s |
| 0x1C | 3 × f32 | Rotation (orientation x, y, z) |
| 0x28 | f32 | Orientation relative to north (w) |
| 0x2C | 3 × f32 | Angular velocity x, y, z |
| 0x38 | f32 | Body height |
| 0x3C | f32 | Engine speed, rpm |
| 0x40 | u32 | `iv`, not encrypted |
| 0x44 | f32 | Fuel level |
| 0x48 | f32 | Fuel capacity |
| 0x4C | f32 | Speed, m/s |
| 0x50 | f32 | Boost pressure, bar + 1 |
| 0x54 | f32 | Oil pressure |
| 0x58 | f32 | Water temperature |
| 0x5C | f32 | Oil temperature |
| 0x60 | 4 × f32 | Tyre temperature FL, FR, RL, RR |
| 0x70 | u32 | Packet ID |
| 0x74 | i16 | Current lap. −1, 0 and positive values occur. |
| 0x76 | i16 | Laps in the race |
| 0x78 | i32 | Best lap time, ms |
| 0x7C | i32 | Last lap time, ms |
| 0x80 | i32 | Time of day, ms. Not a race clock, see Race. |
| 0x84 | i16 | Race position |
| 0x86 | i16 | Number of cars |
| 0x88 | u16 | Lower rpm alert |
| 0x8A | u16 | Upper rpm alert |
| 0x8C | i16 | Calculated maximum speed |
| 0x8E | u16 | Flags, see Flags |
| 0x90 | u8 | Low 4 bits: current gear. High 4 bits: suggested gear. |
| 0x91 | u8 | Throttle, 0 to 255 |
| 0x92 | u8 | Brake, 0 to 255 |
| 0x93 | u8 | Padding |
| 0x94 | 4 × f32 | Road plane: three components and a distance |
| 0xA4 | 4 × f32 | Wheel rotation speed per wheel |
| 0xB4 | 4 × f32 | Tyre radius per wheel |
| 0xC4 | 4 × f32 | Suspension height per wheel |
| 0xD4 | 8 × f32 | Reserved |
| 0xF4 | f32 | Clutch pedal |
| 0xF8 | f32 | Clutch engagement |
| 0xFC | f32 | Engine speed after the clutch, rpm |
| 0x100 | f32 | Top speed of the transmission |
| 0x104 | 8 × f32 | Gear ratios |
| 0x124 | i32 | Car ID |

### Format `B` adds (316 bytes)

| Offset | Type | Content |
| --- | --- | --- |
| 0x128 | f32 | Steering input, rad. Full lock ±π. A positive value turns to the left. |
| 0x12C | f32 | Filler |
| 0x130 | f32 | Sway |
| 0x134 | f32 | Heave |
| 0x138 | f32 | Surge |

### Format `~` adds (344 bytes)

| Offset | Type | Content |
| --- | --- | --- |
| 0x13C | u8 | Filtered throttle |
| 0x13D | u8 | Filtered brake |
| 0x13E | u8 | Powertrain flags |
| 0x13F | u8 | Energy recovery available, 0 or not 0 |
| 0x140 | 4 × f32 | Torque vectors |
| 0x150 | f32 | Energy recovery |
| 0x154 | f32 | Normalised engine torque |

### Format `C` adds (368 bytes)

| Offset | Type | Content |
| --- | --- | --- |
| 0x158 | 4 × ASCII | Surface under FL, FR, RL, RR: `T` tarmac, `C` kerb, `G` grass, `S` probably sand. Other letters can occur. |
| 0x15C | i32 | Current lap time, ms. In licence tests and Circuit Experience: the game timer, see Game timer. In a race: see Race. −1 stays −1. |
| 0x160 | f32 | Left front wheel angle, rad. About 0.63 at full left lock. |
| 0x164 | f32 | Right front wheel angle, rad. Sign as the steering input. |
| 0x168 | f32 | Wheelbase, m |
| 0x16C | 4 × ASCII | Car category |

## Game timer

0x15C in licence tests and Circuit Experience. The lap times 0x78 and 0x7C stay −1 there. Bit 0 is bit 0 of the flags (0x8E).

| Situation | Value of 0x15C | Bit 0 |
| --- | --- | --- |
| Start | Steps from 0 to about 16 ms in one packet. Flying start: when the game gives control, at the same position in every run. Standing start: at the start signal, car at rest. | set |
| Running | Increases per packet in steps of about 16.7 ms | set |
| Finish | Stops. Stays fixed on the result screen until a restart or exit. A test that ends with a stop: stops when the car is at rest. | set |
| Final value | The official time of the game, or at most one packet from it | set |
| Pause (bit 1 is 1) | Fixed. Continues from the same value after the pause. | set |
| Run ended by the game before the finish | 0 | false |
| Car leaves the track | −1 in one packet. The count continues before and after it. Then the game resets the car or ends the session. | set |
| Run slower than the limit of the game | Stops at the finish | set |
| Restart | 0, with a position jump | set |
| After the result screen | Some packets give the final value directly after 0 (false jump) | set |
| Background scene | Counts from 0 | false |
| Demonstration | Counts from 0 between the player's start and finish positions, then stops | false |

A start is a step from 0 to a small value, never a jump to a large value.

## Race

This section is about a race by laps with a rolling start. The facts come from two races with 20 cars each:

- A race of 5 laps on High Speed Ring with the Lexus RC F Gr.4.
- A race of 7 laps with the BAC Mono '16 (car ID 3409 by the catalogue).

### Packet facts seen

| Moment | Facts |
| --- | --- |
| Menu before the race | Bit 0 false. Lap, laps in the race, race position and number of cars are −1. 0x124 gives the car of the menu, not the race car. |
| Race loads | Position jump with the loading bit. Lap 0, laps in the race 0. 0x124 changes to the race car. |
| Scene before the grid | Bit 0 false, lap 0, laps in the race 0. Race position and number of cars stay −1. About 7 s. |
| Grid | Bit 0 becomes true. Laps in the race goes from 0 to the lap count of the race. Race position goes from −1 to 1, then to the start position. Number of cars goes from −1 to the number of cars. A second position jump with the loading bit, for 0.3 s. |
| Rolling start run-up | About 6 s. Bit 0 true, lap 0, 0x15C 0. Time of day is fixed. The car moves at 80 to 131 km/h. |
| Start line | 0x15C steps from 0 to 16. Two packets later the lap goes from 0 to 1. |
| Lap line | The lap increases by 1. In the same packet 0x7C gets the time of the lap, and 0x78 gets it too if it is the best lap. |
| Finish | The lap becomes laps in the race + 1. See Finish. |

- In the packet where the lap increases, 0x15C still holds the old value (83 600 in one capture). 0x7C already holds the time of the lap (83 585).
- In the next packet 0x15C goes to a small value (31) with no 0 between.
- 0x7C can be up to one packet below the last 0x15C value of the lap.
- The lap line is at the same place in each lap.
- Race position (0x84) changes during the race. It gives a position history.
- Time of day (0x80) follows the time multiplier of the race. It is not a race clock. In the race of 5 laps it ran at race speed. In the race of 7 laps it ran at 25 times the race speed.
- For 0x78 and 0x7C, the game counts each lap from line to line. This is also true for a lap into the pit lane and a lap out of it.
- Fuel stays 100 in the race of 5 laps. In the race of 7 laps the car uses about 30 units per lap.

### Pit stop

The two pit stops of the race of 7 laps have the same order.

| Phase | Facts |
| --- | --- |
| Pit entry | The car slows to 80 km/h. Then position and speed are fixed for 23.8 s. The speed is below 0.1 m/s, not exactly 0. Bit 3 (0x8) is false. 0x15C runs. The race position gets worse. |
| Cut to the pit box | One packet with the loading bit and a position jump of 206 m. In this packet the lap increases and 0x7C gets the time of the lap. 0x15C resets in the next packet. The game counts the lap line at the cut. |
| In the box | The car rolls to the box and stops. One packet has the loading bit with no position jump. Fuel increases by about 10 units per second up to 100 (38 to 100 in 6.2 s, 11 to 100 in 8.9 s). Bit 3 is false. |
| Pit exit | A third packet with the loading bit and a jump of 205 m. The car leaves at 80 km/h with player control. |

- A lap into the pit lane and a lap out of it have a shorter driven path than a full lap. In the race of 7 laps: about 5 900 m against 6 165 m.
- The driven line of these laps has a hole at the pit lane.

### Pause

- Bit 1 is set (15.7 s in the race of 7 laps).
- 0x15C, time of day, position and speed are fixed.
- Packets continue, and the packet ID increases.
- The time of that lap in 0x7C does not include the pause.

### Off the track

- 0x15C does not give −1 in a race. In licence tests it does.
- Surface letters in a race: `T`, `C`, `G` and `S`.
- In the race of 7 laps, 22 moments have one or more wheels on `G` or `S`. Some moments have all four wheels off. In the hardest moment the speed goes down to 2 km/h.
- The same places come again. One place has off-track moments in six of the seven laps.

### Finish

- The lap goes from laps in the race to laps in the race + 1.
- 0x7C gets the time of the last lap.
- 0x15C stops at that time and stays.
- Bit 0 stays true.
- In the next packet the throttle goes to 0. The game drives the car.
- After the finish: lap is laps in the race + 1, race position is the final position, 0x15C is fixed, and the car still moves.

### Sessions that are not a race

- In licence tests and Circuit Experience, laps in the race (0x76) is 1 while bit 0 is true. The number of cars (0x86) is 1 or 4 in one run.

### Not seen in a capture

- A standing start.
- A restart.
- An exit to the menu during a race.
- A session without a lap count: a race by time, a time trial, free practice.
- The replay after a race.
- A penalty or an invalid lap.
- A tyre change with wear.
- Rain.
- A lap line in the pit lane.

## Flags

u16 at 0x8E.

| Bit | Value | Meaning |
| --- | --- | --- |
| 0 | 0x0001 | Player session |
| 1 | 0x0002 | Paused |
| 2 | 0x0004 | Loading or scene preparation |

- Bit 0 is set while the game drives the car to the start line. No bit changes when the game gives control.
- Bit 0 is false in every demonstration, preview and background packet. It becomes true shortly before loading ends.
- 0x8, 0x80, 0x100 and 0x400 change during driving. 0x20: full throttle at the rev limiter. 0x800: the car pulls away at low speed.

## Packet facts

- Packets arrive in menus, pause, loading, the background scene and the automatic replay.
- After a demonstration stops, the packet ID increases while position, speed and pedals stay fixed. The fixed speed can be above 0.
- A background car drives the same coordinates before the player starts.
- A demonstration has no flag. It is the same in every run, sample by sample. The background is not.
- A scene change is a position jump of hundreds of metres in one packet.
- In licence tests and Circuit Experience, background packets have positive lap values.
- Before a race, the menu gives lap −1 and the scene before the grid gives lap 0. Bit 0 is false in both.
- No field names the exercise. 0x124 gives the car.
- No field gives the track edges.

## Coordinates

- Position in metres. x and z: the ground plane. y: the height.
- Velocity in m/s, speed (0x4C) in m/s.

## Reception in GT7 Tutor

How GT7 Tutor receives, checks, times and stores the packets. The calculations on the samples are in `docs/algorithms.md`.

### Receive

The UDP source (`packages/capture/src/udp-source.ts`, `CAPTURE_CONFIG.udp`) binds port 33740. It sends the heartbeat `C` to port 33739 after the bind and then every 1000 ms. It drops a datagram from any address other than the console address of Setup.

### Decode

`decode(payload)` in `decode.ts`:

1. Accept only 368 bytes (format `C`). Any other length: `unsupported-format`.
2. Decrypt with the constant of `C` (`packetNonce`). A magic that is not `0x47375330`: `decrypt`.
3. Read the fields below. A position, velocity or speed that is not finite: `invalid-fields`.

| Offset | `Sample` field |
| --- | --- |
| 0x04, 0x10 | `position`, `velocity` |
| 0x44 | `fuel` |
| 0x4C | `speedMps` |
| 0x70 | `packetId` |
| 0x74, 0x76 | `lap`, `lapsInRace` |
| 0x78, 0x7C | `bestLapMs`, `lastLapMs` |
| 0x84, 0x86 | `racePosition`, `carsInRace` |
| 0x8E | `flags`, and bits 0, 1, 2 as `playerSession`, `paused`, `loading` |
| 0x90 | `gear`: the low 4 bits |
| 0x91, 0x92 | `throttle`, `brake`: value / 255 |
| 0x124 | `carId` |
| 0x158 | `surface`: four letters |
| 0x15C | `gameTimerMs` |

### Packet order

`SequenceTracker` (`packages/core/src/sequence.ts`), 32-bit wrapping ID, `DEFAULT_SEQUENCE_LIMITS`:

| ID compared with the last ID | Result |
| --- | --- |
| Same, or 1 to 64 behind | Duplicate, dropped |
| More than 600 ahead, or more than 64 behind | Discontinuity, kept |
| 1 to 600 ahead | Kept. Lost packets = difference − 1. |

`SampleStream` (`packages/capture/src/sample-stream.ts`) makes samples, live and from a file (`readSamples`). Per datagram:

1. Decode. A failure gives no sample.
2. Drop a duplicate.
3. Set the packet time (`PacketClock`, see Packet time).
4. Give no sample for a row before `warmupFrom`. These rows move the sequence check and the clock only.

One `SampleStream` per capture. It never resets its `SequenceTracker`. A duplicate keeps its `rawIndex` in the file.

### Packet time

`PacketClock` gives each sample `clockMs` from the packet ID and the arrival time. Arrival times are not even (see Transport).

| Step from the last packet ID | Added time |
| --- | --- |
| First packet | `clockMs` = arrival time |
| 1 to 600 ahead | `steps × 1000 / 60` + change of the envelope, never below 0 |
| Same, or 1 to 63 behind | 0 |
| Any other step | Arrival difference, not below 0. A new envelope starts. |

Envelope = arrival time − nominal time of the packet number. An earlier arrival moves the envelope to it at once. A later arrival moves it by 2 % of the difference (`ENVELOPE_RISE`).

A range read starts the clock 600 packets (`CLOCK_WARMUP_PACKETS`) before the first row (`clockWarmupStart`). These rows move the clock and the duplicate check. They give no sample. After 600 packets, the envelope does not depend on the start row.

### Raw capture file

`.ndjson`, one JSON object per datagram. The file holds the encrypted payload and is the source of truth.

| Field | Content |
| --- | --- |
| `schemaVersion` | 1 |
| `captureId` | ID of the capture |
| `rawIndex` | Datagram number from 0. A dropped datagram keeps its number. |
| `receivedMonoMs` | Arrival time, monotonic clock, ms |
| `receivedUnixMs` | Arrival time, wall clock, ms |
| `peerIp` | Console address. `0.0.0.0` in fixtures. |
| `payloadBase64` | Encrypted datagram |

- A file is never edited. A range is `first` to `last` `rawIndex`, both inclusive.
- A range read skips rows before `clockWarmupStart(first)` by `rawIndex` without a full parse, then parses to `last`.
- The sample cache cuts a range from a cached full read only in one case. The clock warm-up must start at or before the first sample of the file.
- The writer queue is 8 MiB (`CAPTURE_CONFIG.rawQueueBytes`). A full queue or a failed write marks the capture incomplete. The live path continues.
- `RawWriter.append` returns the `rawIndex` also for a datagram that it does not write.
- A broken line stops the reader, except the last line.
- Size: about 680 bytes per row, about 150 MB per hour.

Code: `packages/capture/src/raw-file.ts`, `read-samples.ts`, `sample-stream.ts`.
