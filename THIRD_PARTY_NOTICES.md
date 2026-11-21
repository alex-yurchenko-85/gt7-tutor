# Third-party notices

This file lists code and data that GT7 Tutor ports or copies from other projects.

## GT7 Datalogger

- Source: <https://github.com/jbhoorasingh/gt7-datalogger>, `backend/app/telemetry/crypto.py`.
- Licence: MIT.
- Use: the packet decryption scheme (Salsa20 key, IV offset `0x40`, nonce XOR constant, magic value) in `packages/core/src/decode.ts` follows that file.
- The packet sizes of the formats `A`, `B`, `~` and `C` (296, 316, 344, 368 bytes) and their nonce constants follow `backend/app/telemetry/packet.py` and `crypto.py` of the same project. The offsets of the format `B` fields (wheel rotation 0x128, sway 0x130, heave 0x134, surge 0x138) follow the same files. The byte layout in `docs/protocol.md` also follows `packet.py`. `packages/core/src/decode.ts` is an independent implementation. It copies no code.
- The licence text of GT7 Datalogger follows.

```text
MIT License

Copyright (c) 2026 Jermaine Bhoorasingh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

No file in this repository contains code from another GPL project.

## Catalogue data

- `content/catalogue/catalogue.json` contains data from the Gran Turismo Wiki (CC BY-SA) and from `ddm999/gt7info` (MIT-0). `content/catalogue/NOTICE.md` gives the attribution and the licence terms.
- `fixtures/catalogue-sources/` contains recorded answers of the same sources for tests. `fixtures/catalogue-sources/NOTICE.md` gives the attribution.
- `packages/catalogue` is an independent implementation. It copies no code.

## Voice clips

- `content/audio/en/clips/` contains speech generated with the Kokoro-82M model and the `af_heart` voice (Apache License 2.0). `content/audio/en/NOTICE.md` gives the tool, the voice and the licence.
- `tools/generate-audio.ts` is an independent implementation. It copies no code.

## Fonts

- Sofia Sans and Sofia Sans Condensed, by The Sofia Sans Project Authors, <https://github.com/lettersoup/Sofia-Sans>. Licence: SIL Open Font License 1.1.
- The interface gets the fonts from the packages `@fontsource/sofia-sans` and `@fontsource/sofia-sans-condensed`. The build of `apps/web` contains the font files.

## Packages

- The application installs its packages with `pnpm install`. The repository holds no copy of them.
- Their licences are MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, MPL-2.0 and BlueOak-1.0.0. `pnpm licenses list` prints the licence of each package.

## Packages used by tools

- `uqr` 0.1.3 (<https://github.com/unjs/uqr>), licence MIT, no dependencies, no network access. `./start.sh` (`tools/start/ready.ts`) uses it to print the QR code of the phone address. The package is a dependency. No code is copied.
