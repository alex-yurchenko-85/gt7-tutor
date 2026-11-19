# GT7 telemetry protocol

This document describes the telemetry that Gran Turismo 7 sends from a PS5 and how GT7 Tutor reads it.
Read this document before you change `packages/core/src/decode.ts` or `packages/capture`.

Each statement has one of three states:

- **Verified:** seen on the project's console and used by the code.
- **Described:** taken from the open description of gt7-datalogger (MIT, see `THIRD_PARTY_NOTICES.md`). The code does not read the field and the project did not check it.
- **Observed:** seen in captures of one exercise. It is not a general rule of the game.

## Transport

| Item | Value |
| --- | --- |
| Protocol | UDP over IPv4 on the home network |
| Receive port on the computer | 33740 |
| Heartbeat port on the console | 33739 |
| Heartbeat payload | One ASCII letter that selects the packet format |
| Heartbeat period | 1000 ms. The first heartbeat goes out at once after the bind. |
| Packet rate | About 60 packets per second (59.75 to 59.94 Hz measured) |
| Packet order | The packet ID increases by 1. No loss was seen on the home network. |

The console sends packets only while it receives heartbeats.
Only one program can bind port 33740 at a time.
The receiver drops a datagram that does not come from the configured console address.

Code: `packages/capture/src/udp-source.ts`. Settings: `DEFAULT_CONFIG.udp` in `packages/core/src/config.ts`.

## Packet formats

| Heartbeat letter | Packet length | Nonce constant | Content | State |
| --- | --- | --- | --- | --- |
| `A` | 296 bytes (0x128) | `0xDEADBEAF` | Base packet | Not decoded. The decoder rejects it. |
| `B` | 316 bytes (0x13C) | `0xDEADBEEF` | Base packet and motion fields | Not decoded. The decoder rejects it. |
| `~` | 344 bytes (0x158) | `0x55FABB4F` | Format `B` and powertrain fields | Not decoded. The decoder rejects it. |
| `C` | 368 bytes (0x170) | `0xDEADBEEF` | Format `~` and wheel fields | Verified. The server always asks for `C`. |

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

| Offset | Type | Content | Sample field | State |
| --- | --- | --- | --- | --- |
| 0x00 | u32 | Magic value `0x47375330` | checked, not stored | Verified |
| 0x04 | 3 × f32 | Position x, y, z in metres. y is the height. | `position` | Verified |
| 0x10 | 3 × f32 | Velocity x, y, z in m/s | `velocity` | Verified |
| 0x1C | 3 × f32 | Rotation (orientation x, y, z) | | Described |
| 0x28 | f32 | Orientation relative to north (orientation w) | | Described |
| 0x2C | 3 × f32 | Angular velocity x, y, z | | Described |
| 0x38 | f32 | Body height | | Described |
| 0x3C | f32 | Engine speed, rpm | | Described |
| 0x40 | u32 | `iv` for the nonce. Not encrypted content. | used for decryption | Verified |
| 0x44 | f32 | Fuel level | | Described |
| 0x48 | f32 | Fuel capacity | | Described |
| 0x4C | f32 | Speed in m/s | `speedMps` | Verified |
| 0x50 | f32 | Boost pressure, bar + 1 | | Described |
| 0x54 | f32 | Oil pressure | | Described |
| 0x58 | f32 | Water temperature | | Described |
| 0x5C | f32 | Oil temperature | | Described |
| 0x60 | 4 × f32 | Tyre temperature: front left, front right, rear left, rear right | | Described |
| 0x70 | u32 | Packet ID | `packetId` | Verified |
| 0x74 | i16 | Current lap. −1, 0 and positive values occur. | `lap` | Verified |
| 0x76 | i16 | Laps in the race | | Described |
| 0x78 | i32 | Best lap time, ms | | Described |
| 0x7C | i32 | Last lap time, ms | | Described |
| 0x80 | i32 | Time of day, ms | | Described |
| 0x84 | i16 | Race position | | Described |
| 0x86 | i16 | Number of cars | | Described |
| 0x88 | u16 | Lower rpm alert | | Described |
| 0x8A | u16 | Upper rpm alert | | Described |
| 0x8C | i16 | Calculated maximum speed | | Described |
| 0x8E | u16 | Flags, see "Flags" | `flags`, `playerSession`, `paused`, `loading` | Verified for bits 0 to 2 |
| 0x90 | u8 | Low 4 bits: current gear. High 4 bits: suggested gear. | `gear` (low 4 bits) | Verified for the current gear |
| 0x91 | u8 | Throttle, 0 to 255 | `throttle` = value / 255 | Verified |
| 0x92 | u8 | Brake, 0 to 255 | `brake` = value / 255 | Verified |
| 0x93 | u8 | Padding | | Described |
| 0x94 | 4 × f32 | Road plane: three components and a distance | | Described |
| 0xA4 | 4 × f32 | Wheel rotation speed per wheel | | Described |
| 0xB4 | 4 × f32 | Tyre radius per wheel | | Described |
| 0xC4 | 4 × f32 | Suspension height per wheel | | Described |
| 0xD4 | 8 × f32 | Reserved | | Described |
| 0xF4 | f32 | Clutch pedal | | Described |
| 0xF8 | f32 | Clutch engagement | | Described |
| 0xFC | f32 | Engine speed after the clutch, rpm | | Described |
| 0x100 | f32 | Top speed of the transmission | | Described |
| 0x104 | 8 × f32 | Gear ratios | | Described |
| 0x124 | i32 | Car ID | `carId` | Verified |

### Format `B` adds (316 bytes)

| Offset | Type | Content | Sample field | State |
| --- | --- | --- | --- | --- |
| 0x128 | f32 | Steering input in radians. Full lock is ±π. Positive is a turn to the left. | `extension.wheelRotationRad` | Verified in one capture session |
| 0x12C | f32 | Filler | | Described |
| 0x130 | f32 | Sway | `extension.sway` | Decoded, meaning not checked |
| 0x134 | f32 | Heave | `extension.heave` | Decoded, meaning not checked |
| 0x138 | f32 | Surge | `extension.surge` | Decoded, meaning not checked |

### Format `~` adds (344 bytes)

| Offset | Type | Content | State |
| --- | --- | --- | --- |
| 0x13C | u8 | Filtered throttle | Described |
| 0x13D | u8 | Filtered brake | Described |
| 0x13E | u8 | Powertrain flags | Described |
| 0x13F | u8 | Energy recovery available, 0 or not 0 | Described |
| 0x140 | 4 × f32 | Torque vectors | Described |
| 0x150 | f32 | Energy recovery | Described |
| 0x154 | f32 | Normalised engine torque | Described |

The decoder reads none of these fields.

### Format `C` adds (368 bytes)

| Offset | Type | Content | State |
| --- | --- | --- | --- |
| 0x158 | 4 ASCII characters | Surface under each wheel: front left, front right, rear left, rear right. `T` is tarmac, `C` is kerb, `G` is grass. | Verified for `T`, `C` and `G` (Circuit Experience, 18 November 2026). Other letters were not seen. |
| 0x15C | i32 | Current lap time, ms. In a licence test it is the game timer of the test, see "Game timer". The decoder reads it as `gameTimerMs` and keeps −1 as −1. | Verified in two licence tests |
| 0x160 | f32 | Angle of the left front wheel, radians. About 0.63 at full lock to the left. | Verified in one capture session |
| 0x164 | f32 | Angle of the right front wheel, radians. Same sign as the steering input. | Verified in one capture session |
| 0x168 | f32 | Wheelbase, metres | Described |
| 0x16C | 4 ASCII characters | Car category | Described |

The decoder reads the field 0x15C as `gameTimerMs`. It reads none of the other fields. The raw file keeps all of them.

### Game timer

Captures of the National B licence tests B-3 (`Cornering Basics 1`, the game drives the car to the start line and gives control at about 68 km/h) and B-1 (standing start, the test ends when the car stops) and of one Circuit Experience sector (the game gives control at about 213 km/h) on the console, 18 November 2026. Format `C` only: formats `A`, `B` and `~` do not have this field. In these tests the best and last lap times (0x78, 0x7C) stayed −1.

- **Start.** The value goes from 0 to 16 ms in one packet. In B-3 this happens when the game gives control to the player, at the same position in every run. Before it the game drives the car with full throttle. The player's first brake input came 0.43 to 0.67 s later. In B-1 it happens at the start signal, with the car still standing. The car moves one or two packets later.
- **Running.** The value increases with the packets and is a multiple of about 16.7 ms.
- **Finish.** The value stops at the finish and stays fixed on the result screen until the player restarts or leaves the test. In B-3 it stopped at the same position in every run. In B-1 it stopped when the car came to rest.
- **The fixed value is the official time.** B-3: 15 839 ms, screen 0:15.839. B-1: 21 683 ms and 20 366 ms, screen 0:21.668 and 0:20.352. Circuit Experience: 17 071 ms, screen 0:17.071; with a pause 17 412 ms, screen 0:17.417 as the user remembered it. So the value is the official time or less than one packet away.
- **A pause stops the value.** While bit 1 (paused) is set, the value stays fixed. After the pause it continues from the same value. In one run a pause of about 12 s added nothing to the value.
- **A failed run ends the session.** When the game ended a Circuit Experience run before the finish, bit 0 became false and the value went to 0.
- **The background scene has a timer too.** After that failed run, the background scene drove the sector and the value counted from 0 as in a real run, with bit 0 false. An attempt starts only with bit 0 set. The demonstration-range finder reads the demonstration timer, which also counts with bit 0 false (`docs/algorithms.md`, Demonstration range).
- **A −1 marks a run that left the track.** In the two Circuit Experience runs where the player left the track, one packet had the value −1, at the moment the surface letters showed grass under two or four wheels. The packets before and after it continued the count. In one run the game put the car back to the start 1.7 s later; in the other it ended the session 5.6 s later. Two cases only: this meaning is an assumption.
- **A demonstration has the timer too.** Three demonstrations of Interlagos Circuit Experience sector 2 (bit 0 false): the timer started at the same position as in the player's runs (about 0.5 m away) and stopped at 16 082 ms in all three, at the player's finish position (about 1 m away). The demonstration started 1.1 to 1.4 s after the START cue with a position jump; the timer started about 1.3 s later. The demonstration-range finder cuts the reference to this timer run (`docs/algorithms.md`, Demonstration range).
- **A slow run still finishes.** The game did not count one Circuit Experience run because it was too slow. The value still stopped at the finish (18 824 ms).
- **A restart sets the value to 0** together with a position jump.
- **A false jump.** After the result screen, four packets with bit 0 set gave the final value again, at another position, directly after 0. A start is a step from 0 to a small value, not any value above 0.

**What an exercise needs.** The application starts and finishes an attempt only by the game timer. It cuts each reference to a run of the demonstration timer. So an exercise works only when two facts are true for it:

1. **Demonstration timer.** The demonstration runs the value at 0x15C with bit 0 false. The value starts at 0 and stops at a final value inside the demonstration.
2. **Player start.** The player's run gives a step from 0 to a value from 1 to 50 ms in one packet (`GAME_TIMER_START_MAX_MS`).

Verified on the console (18 November 2026):

- Fact 1: one Circuit Experience sector only (Interlagos sector 2).
- Fact 2: the same Circuit Experience sector and the licence tests B-1 and B-3.

Not verified: the demonstrations of the licence tests, the demonstrations and runs of the Brand Central exercises, and full laps. The application assumes that these exercises give the two facts too. This is an assumption.

Without fact 1, an exercise cannot get a reference. The proposals API gives no proposal. The server refuses a range set by hand with `no-timer-run`. A training needs an active reference, so no attempt can start either. Without fact 2, no attempt starts: the tracker sees no start. After 10 s of driving, the Drive screen shows the prompt `The game timer did not start`.

Not checked: a licence test that the player fails, the replay that the player opens from the result screen, a full Circuit Experience lap, a race, the demonstration of a licence test, a Brand Central exercise.

## Flags

The flags are the unsigned 16-bit integer at offset `0x8E`.

| Bit | Value | Meaning in the tested captures | Sample field |
| --- | --- | --- | --- |
| 0 | 0x0001 | The player has a driving session | `playerSession` |
| 1 | 0x0002 | The game is paused | `paused` |
| 2 | 0x0004 | The game loads or prepares a scene | `loading` |

These meanings are observed, not documented by the game.
The values 8, 0x80, 0x100 and 0x400 also change during driving. The code ignores them. Do not start or split an attempt on these bits.
In the licence tests B-1 and B-3 (18 November 2026) bit 0 was already set while the game drove the car to the start line, so `hasPlayerControl` is true before the player has control. No flag bit changed when the game gave control. The value 0x20 was set with full throttle while the car stood before the start signal and at full throttle shortly before a gear change; this looks like the rev limiter. The value 0x800 was set while the car pulled away at low speed. These meanings are assumptions.
`hasPlayerControl` is `playerSession && !paused && !loading`.

## What a packet does not tell

These facts come from captures of one exercise. The code depends on them.

- **A packet is not driving.** The console sends packets in menus, during a pause, during loading, in the background scene and in the automatic replay.
- **Fresh packets can hold an old state.** After a demonstration stops, the packet ID increases while the position, speed and pedals stay fixed. The fixed speed can be more than zero. Do not integrate speed to get distance.
- **The background moves.** Before the player starts, a background car drives across the same coordinates with changing pedals.
- **Bit 0 separates the player from a demonstration.** It was false in every demonstration, preview and background packet, and true in the player's session. It becomes true shortly before loading ends.
- **A demonstration has no flag of its own.** It is the same in every run, sample by sample, and the background is not. This is why a reference needs three demonstration recordings.
- **A scene change is a position jump.** The position moves by hundreds of metres in one packet.
- **The lap value does not mark an attempt.** Background packets have positive lap values.
- **The packet does not name the exercise.** It gives a car ID only. Car ID 3602 is the Yangwang U9 '24 in the community car table.
- **The packet has no track edges.** Format `C` gives the surface letter under each wheel. The application does not use it.

The captures behind these facts come from one exercise: `Yangwang EXP-1 Racing Line: Intermediate` (Brand Central, Experience).

## Coordinates and units

- The position is in metres. x and z are the ground plane, y is the height.
- The side of a point relative to a direction of travel `t` is `right = (−t.z, 0, t.x)`. A positive lateral distance is to the right. This sign is verified on the console.
- The core uses metres, m/s and milliseconds. Pedals are 0 to 1. km/h appears only on the screen and in speech (`KPH_PER_MPS = 3.6`).

## Packet ID and sequence

`SequenceTracker` (`packages/core/src/sequence.ts`) compares each packet ID with the last one. The ID is a 32-bit counter that wraps.

- Same ID, or up to 64 behind: a duplicate. The packet is dropped.
- More than 600 ahead: a discontinuity.
- Other cases: the difference minus 1 is the number of lost packets.

The packet ID also gives the packet time (`clockMs`, `packages/core/src/packet-clock.ts`). The arrival time has network bursts; the packet ID does not. The packet rate is not exactly 60 per second and it changes during a capture (59.2 to 59.9 packets per second in one earlier capture; 59.85 to 59.94 on average in the format `C` fixtures), so the packet time follows the earliest arrivals and not a fixed rate.

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
