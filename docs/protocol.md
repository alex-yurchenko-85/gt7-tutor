# GT7 telemetry protocol

This document describes the telemetry that Gran Turismo 7 sends from a PS5 and how GT7 Tutor reads it.
Read this document before you change `packages/core/src/decode.ts` or `packages/capture`.

The byte layout comes from the open description of gt7-datalogger (MIT, see `THIRD_PARTY_NOTICES.md`).

## Transport

| Item | Value |
| --- | --- |
| Protocol | UDP over IPv4 on the home network |
| Receive port on the computer | 33740 |
| Heartbeat port on the console | 33739 |
| Heartbeat payload | One ASCII letter that selects the packet format |
| Heartbeat period | 1000 ms. The first heartbeat goes out at once after the bind. |
| Packet rate | About 60 packets per second (59.2 to 59.94 Hz) |
| Packet order | The packet ID increases by 1. |

The console sends packets only while it receives heartbeats.
Only one program can bind port 33740 at a time.
The receiver drops a datagram that does not come from the configured console address.

Code: `packages/capture/src/udp-source.ts`. Settings: `DEFAULT_CONFIG.udp` in `packages/core/src/config.ts`.

## Packet formats

| Heartbeat letter | Packet length | Nonce constant | Content |
| --- | --- | --- | --- |
| `A` | 296 bytes (0x128) | `0xDEADBEAF` | Base packet |
| `B` | 316 bytes (0x13C) | `0xDEADBEEF` | Base packet and motion fields |
| `~` | 344 bytes (0x158) | `0x55FABB4F` | Format `B` and powertrain fields |
| `C` | 368 bytes (0x170) | `0xDEADBEEF` | Format `~` and wheel fields |

Each larger packet starts with the complete smaller packet.
The application asks only for `C` and decodes only 368-byte packets. It rejects every other length with `unsupported-format`.

## Decryption

Each packet is encrypted with Salsa20.

1. Key: the first 32 bytes of the ASCII text `Simulator Interface Packet GT7 ver 0.0`.
2. Read `iv`, an unsigned 32-bit little-endian integer, from offset `0x40` of the encrypted packet.
3. Build the 8-byte nonce: bytes 0 to 3 are `iv XOR constant` (little-endian), bytes 4 to 7 are `iv` (little-endian). The constant depends on the packet length, see the table above.
4. Decrypt the whole packet with Salsa20, the key and the nonce.
5. Read the unsigned 32-bit little-endian integer at offset `0x00`. It must be `0x47375330`. If not, the result is `decrypt`.

A packet that is encrypted for one format does not decrypt with the constant of another format.
After decryption, the decoder rejects a packet with a position, velocity or speed that is not finite (`invalid-fields`).

## Byte layout

All values are little-endian. `f32` is a 32-bit float. `i16`, `u16`, `i32`, `u32` and `u8` are integers.
The column `Sample field` names the field of the `Sample` type in `packages/contracts/src/telemetry.ts`. An empty cell means that the decoder does not read the field.

### Base fields (first 296 bytes)

| Offset | Type | Content | Sample field |
| --- | --- | --- | --- |
| 0x00 | u32 | Magic value `0x47375330` | checked, not stored |
| 0x04 | 3 × f32 | Position x, y, z in metres. y is the height. | `position` |
| 0x10 | 3 × f32 | Velocity x, y, z in m/s | `velocity` |
| 0x1C | 3 × f32 | Rotation (orientation x, y, z) | |
| 0x28 | f32 | Orientation relative to north (orientation w) | |
| 0x2C | 3 × f32 | Angular velocity x, y, z | |
| 0x38 | f32 | Body height | |
| 0x3C | f32 | Engine speed, rpm | |
| 0x40 | u32 | `iv` for the nonce. Not encrypted content. | used for decryption |
| 0x44 | f32 | Fuel level | |
| 0x48 | f32 | Fuel capacity | |
| 0x4C | f32 | Speed in m/s | `speedMps` |
| 0x50 | f32 | Boost pressure, bar + 1 | |
| 0x54 | f32 | Oil pressure | |
| 0x58 | f32 | Water temperature | |
| 0x5C | f32 | Oil temperature | |
| 0x60 | 4 × f32 | Tyre temperature: front left, front right, rear left, rear right | |
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
| 0x8E | u16 | Flags, see "Flags" | `flags`, `playerSession`, `paused`, `loading` |
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

| Offset | Type | Content | Sample field |
| --- | --- | --- | --- |
| 0x128 | f32 | Steering input in radians. Full lock is ±π. Positive is a turn to the left. | `extension.wheelRotationRad` |
| 0x12C | f32 | Filler | |
| 0x130 | f32 | Sway | `extension.sway` |
| 0x134 | f32 | Heave | `extension.heave` |
| 0x138 | f32 | Surge | `extension.surge` |

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

The decoder reads none of these fields.

### Format `C` adds (368 bytes)

| Offset | Type | Content |
| --- | --- | --- |
| 0x158 | 4 ASCII characters | Surface under each wheel: front left, front right, rear left, rear right. `T` is tarmac, `C` is kerb, `G` is grass. Other letters can occur. |
| 0x15C | i32 | Current lap time, ms. In a licence test it is the game timer of the test, see "Game timer". The decoder reads it as `gameTimerMs` and keeps −1 as −1. |
| 0x160 | f32 | Angle of the left front wheel, radians. About 0.63 at full lock to the left. |
| 0x164 | f32 | Angle of the right front wheel, radians. Same sign as the steering input. |
| 0x168 | f32 | Wheelbase, metres |
| 0x16C | 4 ASCII characters | Car category |

The decoder reads the field 0x15C as `gameTimerMs`. It reads none of the other fields. The raw file keeps all of them.

### Game timer

The field 0x15C is in format `C` only. In licence tests and in Circuit Experience it is the game timer of the run. The best and last lap times (0x78, 0x7C) stay −1 there.

- **Start.** The value goes from 0 to 16 ms in one packet. With a flying start this happens when the game gives control to the player, at the same position in every run. Before it the game drives the car. With a standing start it happens at the start signal, with the car still standing.
- **Running.** The value increases with the packets and is a multiple of about 16.7 ms.
- **Finish.** The value stops at the finish and stays fixed on the result screen until the player restarts or leaves the test. When a test ends with a stop, the value stops when the car comes to rest.
- **The fixed value is the official time** of the game, or at most one packet away from it.
- **A pause stops the value.** While bit 1 (paused) is set, the value stays fixed. After the pause it continues from the same value.
- **A failed run ends the session.** When the game ends a run before the finish, bit 0 becomes false and the value goes to 0.
- **The background scene has a timer too.** The value counts from 0 as in a real run, with bit 0 false. An attempt starts only with bit 0 set.
- **A demonstration has the timer too.** It counts with bit 0 false, from the player's start position to the player's finish position. The demonstration-range finder cuts the reference to this timer run (`docs/algorithms.md`, Demonstration range).
- **A −1 marks a run that left the track.** One packet has the value −1 when the car leaves the track. The packets before and after it continue the count. The game then puts the car back to the start or ends the session.
- **A slow run still finishes.** The value stops at the finish also when the game does not count the run.
- **A restart sets the value to 0** together with a position jump.
- **A false jump.** After the result screen, some packets with bit 0 set can give the final value again, directly after 0. A start is a step from 0 to a small value, not any value above 0.

**What an exercise needs.** The application starts and finishes an attempt only by the game timer. It cuts each reference to a run of the demonstration timer. So an exercise works only when two facts are true for it:

1. **Demonstration timer.** The demonstration runs the value at 0x15C with bit 0 false. The value starts at 0 and stops at a final value inside the demonstration.
2. **Player start.** The player's run gives a step from 0 to a value from 1 to 50 ms in one packet (`GAME_TIMER_START_MAX_MS`).

Without fact 1, an exercise cannot get a reference. The proposals API gives no proposal. The server refuses a range set by hand with `no-timer-run`. A training needs an active reference, so no attempt can start either. Without fact 2, no attempt starts: the tracker sees no start. After 10 s of driving, the Drive screen shows the prompt `The game timer did not start`.

## Flags

The flags are the unsigned 16-bit integer at offset `0x8E`.

| Bit | Value | Meaning | Sample field |
| --- | --- | --- | --- |
| 0 | 0x0001 | The player has a driving session | `playerSession` |
| 1 | 0x0002 | The game is paused | `paused` |
| 2 | 0x0004 | The game loads or prepares a scene | `loading` |

The game does not document these meanings.
The values 8, 0x80, 0x100 and 0x400 also change during driving. The code ignores them. Do not start or split an attempt on these bits.
Bit 0 is already set while the game drives the car to the start line, so `hasPlayerControl` is true before the player has control. No flag bit changes when the game gives control. The value 0x20 is set at full throttle against the rev limiter. The value 0x800 is set while the car pulls away at low speed.
`hasPlayerControl` is `playerSession && !paused && !loading`.

## What a packet does not tell

The code depends on these facts.

- **A packet is not driving.** The console sends packets in menus, during a pause, during loading, in the background scene and in the automatic replay.
- **Fresh packets can hold an old state.** After a demonstration stops, the packet ID increases while the position, speed and pedals stay fixed. The fixed speed can be more than zero. Do not integrate speed to get distance.
- **The background moves.** Before the player starts, a background car drives across the same coordinates with changing pedals.
- **Bit 0 separates the player from a demonstration.** It is false in every demonstration, preview and background packet, and true in the player's session. It becomes true shortly before loading ends.
- **A demonstration has no flag of its own.** It is the same in every run, sample by sample, and the background is not. This is why a reference needs three demonstration recordings.
- **A scene change is a position jump.** The position moves by hundreds of metres in one packet.
- **The lap value does not mark an attempt.** Background packets have positive lap values.
- **The packet does not name the exercise.** It gives a car ID only.
- **The packet has no track edges.** Format `C` gives the surface letter under each wheel. The application does not use it.

## Coordinates and units

- The position is in metres. x and z are the ground plane, y is the height.
- The side of a point relative to a direction of travel `t` is `right = (−t.z, 0, t.x)`. A positive lateral distance is to the right.
- The core uses metres, m/s and milliseconds. Pedals are 0 to 1. km/h appears only on the screen and in speech (`KPH_PER_MPS = 3.6`).

## Packet ID and sequence

`SequenceTracker` (`packages/core/src/sequence.ts`) compares each packet ID with the last one. The ID is a 32-bit counter that wraps.

- Same ID, or up to 64 behind: a duplicate. The packet is dropped.
- More than 600 ahead: a discontinuity.
- Other cases: the difference minus 1 is the number of lost packets.

The packet ID also gives the packet time (`clockMs`, `packages/core/src/packet-clock.ts`). The arrival time has network bursts; the packet ID does not. The packet rate is not exactly 60 per second and it changes during a capture (about 59.2 to 59.94 packets per second), so the packet time follows the earliest arrivals and not a fixed rate.

## Raw capture file

A capture is a text file with one JSON object per line (`.ndjson`). It holds the encrypted payload, so the file is the source of truth and the decoder can change later.

| Field | Content |
| --- | --- |
| `schemaVersion` | Always 1 |
| `captureId` | ID of the capture |
| `rawIndex` | Number of the datagram in the file, from 0. A dropped datagram keeps its number, so gaps can occur. |
| `receivedMonoMs` | Arrival time on a monotonic clock, ms. Real-time rules use this value. Measured times use the packet time, which the core computes from the packet ID and this value (`docs/algorithms.md`, Packet time). |
| `receivedUnixMs` | Arrival time on the wall clock, ms |
| `peerIp` | Address of the console. A committed fixture has `0.0.0.0`. |
| `payloadBase64` | The encrypted datagram |

Rules:

- A raw file is never edited in place. A range of a file is given as `first` and `last` raw index, both inclusive.
- The live path never waits for a file write. The writer has a queue of 8 MiB. If the queue is full or a write fails, the capture is marked incomplete and coaching continues.
- A reader stops with an error on a broken line, except on the last line, which can be cut after a crash.
- At 60 packets per second, a capture needs about 127 MB per hour.

Code: `packages/capture/src/raw-file.ts`, `toSample` in `packages/core/src/decode.ts`.

## Tools

```sh
pnpm capture --ip <PS5 address> --seconds 60 --purpose demo --start-after 5
pnpm replay --file <raw capture .ndjson>
```

`pnpm capture` writes a new file to `data/raw/`. `pnpm replay` decodes a file and prints statistics.
