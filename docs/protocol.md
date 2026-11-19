# GT7 telemetry protocol

Telemetry of Gran Turismo 7 on PS5 and how GT7 Tutor reads it.
Read before a change to `packages/core/src/decode.ts` or `packages/capture`.

Sources: transport, formats, key, nonce constants and byte layout follow gt7-datalogger (MIT, `THIRD_PARTY_NOTICES.md`). Flag meanings and the behaviour of 0x15C come from own PS5 captures (committed parts in `fixtures/`). The game does not document either.

## Transport

| Item | Value |
| --- | --- |
| Protocol | UDP over IPv4 |
| Receive port (computer) | 33740 |
| Heartbeat port (console) | 33739 |
| Heartbeat payload | One ASCII letter, the packet format. GT7 Tutor sends `C`. |
| Heartbeat period | 1000 ms, first heartbeat at once after the bind |
| Packet rate | About 60 per second (59.2 to 59.94 Hz) |

- The console sends packets only while it receives heartbeats.
- One program at a time can bind port 33740.
- The receiver drops a datagram from any address other than the configured console address.

Code: `packages/capture/src/udp-source.ts`, `CAPTURE_CONFIG.udp` in `packages/capture/src/config.ts`.

## Packet formats

| Letter | Length | Nonce constant | Content |
| --- | --- | --- | --- |
| `A` | 296 bytes (0x128) | `0xDEADBEAF` | Base fields |
| `B` | 316 bytes (0x13C) | `0xDEADBEEF` | `A` and motion fields |
| `~` | 344 bytes (0x158) | `0x55FABB4F` | `B` and powertrain fields |
| `C` | 368 bytes (0x170) | `0xDEADBEEF` | `~` and wheel fields |

Each format starts with the complete smaller format.
The decoder accepts only 368 bytes and has only the constant of `C` (`packetNonce`). Any other length gives `unsupported-format`.

## Decryption

1. Key: the first 32 bytes of the ASCII text `Simulator Interface Packet GT7 ver 0.0`.
2. `iv`: u32 at 0x40 of the encrypted packet.
3. Nonce, 8 bytes: bytes 0 to 3 are `iv XOR constant`, bytes 4 to 7 are `iv`, both little-endian.
4. Decrypt the whole packet with Salsa20.
5. The u32 at 0x00 must be `0x47375330`. Else the result is `decrypt`.

A packet with a position, velocity or speed that is not finite gives `invalid-fields`.

## Byte layout

Little-endian. `Sample field` is the field of `Sample` (`packages/contracts/src/telemetry.ts`). An empty cell: the decoder does not read the field.

### Base fields (296 bytes)

| Offset | Type | Content | Sample field |
| --- | --- | --- | --- |
| 0x00 | u32 | Magic `0x47375330` | checked, not stored |
| 0x04 | 3 × f32 | Position x, y, z, m. y is the height. | `position` |
| 0x10 | 3 × f32 | Velocity x, y, z, m/s | `velocity` |
| 0x1C | 3 × f32 | Rotation (orientation x, y, z) | |
| 0x28 | f32 | Orientation relative to north (w) | |
| 0x2C | 3 × f32 | Angular velocity x, y, z | |
| 0x38 | f32 | Body height | |
| 0x3C | f32 | Engine speed, rpm | |
| 0x40 | u32 | `iv`, not encrypted | decryption only |
| 0x44 | f32 | Fuel level | |
| 0x48 | f32 | Fuel capacity | |
| 0x4C | f32 | Speed, m/s | `speedMps` |
| 0x50 | f32 | Boost pressure, bar + 1 | |
| 0x54 | f32 | Oil pressure | |
| 0x58 | f32 | Water temperature | |
| 0x5C | f32 | Oil temperature | |
| 0x60 | 4 × f32 | Tyre temperature FL, FR, RL, RR | |
| 0x70 | u32 | Packet ID | `packetId` |
| 0x74 | i16 | Current lap. −1, 0 and positive values occur. | `lap` |
| 0x76 | i16 | Laps in the race | |
| 0x78 | i32 | Best lap time, ms | |
| 0x7C | i32 | Last lap time, ms | |
| 0x80 | i32 | Time of day, ms | |
| 0x84 | i16 | Race position | |
| 0x86 | i16 | Number of cars | |
| 0x88 | u16 | Lower rpm alert | |
| 0x8A | u16 | Upper rpm alert | |
| 0x8C | i16 | Calculated maximum speed | |
| 0x8E | u16 | Flags, see Flags | `flags`, `playerSession`, `paused`, `loading` |
| 0x90 | u8 | Low 4 bits: current gear. High 4 bits: suggested gear. | `gear` (low 4 bits) |
| 0x91 | u8 | Throttle, 0 to 255 | `throttle` = value / 255 |
| 0x92 | u8 | Brake, 0 to 255 | `brake` = value / 255 |
| 0x93 | u8 | Padding | |
| 0x94 | 4 × f32 | Road plane: three components and a distance | |
| 0xA4 | 4 × f32 | Wheel rotation speed per wheel | |
| 0xB4 | 4 × f32 | Tyre radius per wheel | |
| 0xC4 | 4 × f32 | Suspension height per wheel | |
| 0xD4 | 8 × f32 | Reserved | |
| 0xF4 | f32 | Clutch pedal | |
| 0xF8 | f32 | Clutch engagement | |
| 0xFC | f32 | Engine speed after the clutch, rpm | |
| 0x100 | f32 | Top speed of the transmission | |
| 0x104 | 8 × f32 | Gear ratios | |
| 0x124 | i32 | Car ID | `carId` |

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

| Offset | Type | Content | Sample field |
| --- | --- | --- | --- |
| 0x158 | 4 × ASCII | Surface under FL, FR, RL, RR: `T` tarmac, `C` kerb, `G` grass, other letters occur | |
| 0x15C | i32 | Current lap time, ms. In licence tests and Circuit Experience: the game timer, see Game timer. −1 stays −1. | `gameTimerMs` |
| 0x160 | f32 | Left front wheel angle, rad. About 0.63 at full left lock. | |
| 0x164 | f32 | Right front wheel angle, rad. Sign as the steering input. | |
| 0x168 | f32 | Wheelbase, m | |
| 0x16C | 4 × ASCII | Car category | |

The raw file keeps all fields.

## Game timer

0x15C in licence tests and Circuit Experience. The lap times 0x78 and 0x7C stay −1 there. Bit 0 is the flag `playerSession`.

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

## Flags

u16 at 0x8E.

| Bit | Value | Meaning | Sample field |
| --- | --- | --- | --- |
| 0 | 0x0001 | Player session | `playerSession` |
| 1 | 0x0002 | Paused | `paused` |
| 2 | 0x0004 | Loading or scene preparation | `loading` |

- `hasPlayerControl` = `playerSession && !paused && !loading`.
- Bit 0 is set while the game drives the car to the start line. No bit changes when the game gives control.
- Bit 0 is false in every demonstration, preview and background packet. It becomes true shortly before loading ends.
- 0x8, 0x80, 0x100 and 0x400 change during driving. 0x20: full throttle at the rev limiter. 0x800: the car pulls away at low speed. The code ignores these bits.

## Packet facts

- Packets arrive in menus, pause, loading, the background scene and the automatic replay.
- After a demonstration stops, the packet ID increases while position, speed and pedals stay fixed. The fixed speed can be above 0.
- A background car drives the same coordinates before the player starts.
- A demonstration has no flag. It is the same in every run, sample by sample. The background is not.
- A scene change is a position jump of hundreds of metres in one packet.
- Background packets have positive lap values.
- No field names the exercise. 0x124 gives the car.
- No field gives the track edges.

## Coordinates and units

- Position in metres. x and z: ground plane. y: height.
- Right of a direction of travel `t`: `(−t.z, 0, t.x)`. A positive lateral distance is to the right.
- Core units: m, m/s, ms. Pedals 0 to 1. `KPH_PER_MPS` = 3.6.

## Packet ID and sequence

`SequenceTracker` (`packages/core/src/sequence.ts`), 32-bit wrapping ID, `DEFAULT_SEQUENCE_LIMITS`:

| ID compared with the last ID | Result |
| --- | --- |
| Same, or 1 to 64 behind | Duplicate, dropped |
| More than 600 ahead, or more than 64 behind | Discontinuity, kept |
| 1 to 600 ahead | Kept. Lost packets = difference − 1. |

`SampleStream` (`packages/capture/src/sample-stream.ts`) makes samples, live and from a file (`readSamples`). Per datagram:

1. Decode. A failure gives no sample.
2. Drop a duplicate.
3. Set the packet time (`PacketClock`, `docs/algorithms.md`).

One `SampleStream` per capture. It never resets its `SequenceTracker`. A duplicate keeps its `rawIndex` in the file.

## Raw capture file

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
