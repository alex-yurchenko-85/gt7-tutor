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
| `A` | 296 bytes (0x128) | `0xDEADBEAF` | Base packet | Verified. The server always asks for `A`. |
| `B` | 316 bytes (0x13C) | `0xDEADBEEF` | Base packet and motion fields | Software check only |
| `~` | 344 bytes (0x158) | `0x55FABB4F` | Format `B` and powertrain fields | Software check only |
| `C` | 368 bytes (0x170) | `0xDEADBEEF` | Format `~` and wheel fields | Verified in one capture session |

Each larger packet starts with the complete smaller packet.
The decoder accepts all four lengths. It rejects every other length with `unsupported-format`.
Only `pnpm capture --format` asks for a format other than `A`.

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

### Base packet, format `A` (296 bytes)

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
| 0x158 | 4 ASCII characters | Surface under each wheel: front left, front right, rear left, rear right. `T` is tarmac, `C` is kerb. | Verified for `T` and `C`. Other letters were not seen. |
| 0x15C | i32 | Current lap time, ms | Described |
| 0x160 | f32 | Angle of the left front wheel, radians. About 0.63 at full lock to the left. | Verified in one capture session |
| 0x164 | f32 | Angle of the right front wheel, radians. Same sign as the steering input. | Verified in one capture session |
| 0x168 | f32 | Wheelbase, metres | Described |
| 0x16C | 4 ASCII characters | Car category | Described |

The decoder reads none of these fields. A capture with `--format C` keeps them in the raw file.

## Flags

The flags are the unsigned 16-bit integer at offset `0x8E`.

| Bit | Value | Meaning in the tested captures | Sample field |
| --- | --- | --- | --- |
| 0 | 0x0001 | The player has a driving session | `playerSession` |
| 1 | 0x0002 | The game is paused | `paused` |
| 2 | 0x0004 | The game loads or prepares a scene | `loading` |

These meanings are observed, not documented by the game.
The values 8, 0x80, 0x100 and 0x400 also change during driving. The code ignores them. Do not start or split an attempt on these bits.
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

## Raw capture file

A capture is a text file with one JSON object per line (`.ndjson`). It holds the encrypted payload, so the file is the source of truth and the decoder can change later.

| Field | Content |
| --- | --- |
| `schemaVersion` | Always 1 |
| `captureId` | ID of the capture |
| `rawIndex` | Number of the datagram in the file, from 0. A dropped datagram keeps its number, so gaps can occur. |
| `receivedMonoMs` | Arrival time on a monotonic clock, ms. All timing uses this value. |
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
pnpm capture --ip <PS5 address> --seconds 60 --purpose demo --start-after 5 [--format A|B|~|C]
pnpm replay --file <raw capture .ndjson>
```

`pnpm capture` writes a new file to `data/raw/`. `pnpm replay` decodes a file and prints statistics.
