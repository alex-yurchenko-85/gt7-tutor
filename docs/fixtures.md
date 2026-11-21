# Test fixtures

Recorded telemetry for the tests and the demo. Tests use `fixtures/`, never `data/`.

- `fixtures/manifest.json` names the source range of each file.
- `pnpm fixture` makes a fixture from a capture. It sets `peerIp` to `0.0.0.0`.
- The packet format is in `docs/protocol.md`. The calculations are in `docs/algorithms.md`.

## Files

| Fixture | Content |
| --- | --- |
| `demo-a`, `demo-b`, `demo-c` | Demonstration of Autódromo de Interlagos, Circuit Experience sector 2, 16 082 ms. Test reference: `demo-a`, raw 457 to 1422, 818.17 m. One corner: apex 404 m, turn zone 346 to 462 m. `demo-c` also has a background timer run, raw 758 to 970. |
| `ce-clean` | Clean run, 17 071 ms, finish at raw 9476 |
| `ce-slow` | 18 824 ms, finish at raw 6621. Two brake zones before turn 1, about 216 to 300 m and 328 to 348 m. |
| `ce-pause` | 17 412 ms, pause raw 11651 to 12346, brakes early at turn 1 |
| `ce-off-track-reset`, `ce-off-track-end` | Value −1, then restart or session end |
| `b3-run`, `b1-run` | National B-3: final value 15 839 ms, screen 0:15.839. B-1, standing start: final value 20 366 ms, screen 0:20.352. |
| `race-grid-start` | Race of 5 laps, rolling start, 20 cars. Scene before the grid: bit 0 false, lap 0, laps 0. Grid at raw 688: laps 0 to 5, cars 20. Position 10 from raw 690. Run-up. Start at raw 1071. Lap 0 to 1 at raw 1073. |
| `race-lap-line` | Same race. Lap 1 to 2 at raw 6086, last lap and best lap 83 585 ms |
| `race-finish` | Same race. Lap 5 to 6 at raw 24982, last lap 79 336 ms, then 659 samples with the car driven by the game |
| `race-pit-stop` | Race of 7 laps. Stop at the pit entry, raw 18165 to 19591: speed below 0.1 m/s, bit 3 false. Cut to the pit box at raw 19591 (lap 2 to 3). Stop in the pit box, raw 19693 to 20190. Loading bit with no jump at raw 19761. Refuel 38 to 100 from raw 19770 to 20141. Cut to the pit exit at raw 20291. |
| `race-off-track` | Same race of 7 laps. Lap 4 has one off-track moment, raw 32233 to 32456, about 3.7 s. Four wheels are off at the peak. The lowest speed is about 40 km/h. |

The demo uses `demo-a` and the attempts `ce-clean`, `ce-slow`, `ce-pause`.

## Golden traces

Golden traces: `fixtures/golden/ce-slow-cues.json` (defaults) and `ce-slow-cues-side-1m.json` (side cue distance 1 m). Rewrite only after a deliberate coach or clip change, and read the new trace first:

```sh
pnpm evaluate-coach --attempt ce-slow --reference demo-a --first 457 --last 1422 --out fixtures/golden/ce-slow-cues.json
pnpm evaluate-coach --attempt ce-slow --reference demo-a --first 457 --last 1422 --side-distance 1 --out fixtures/golden/ce-slow-cues-side-1m.json
```
