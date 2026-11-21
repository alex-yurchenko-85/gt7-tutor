# Voice clips notice

The files in `clips/` are speech clips for the voice cues.
`pnpm audio:generate` (`tools/generate-audio.ts`) makes them.
It is a maintainer command. No speech synthesis runs during training.

## Speech model and voice

- Model: Kokoro-82M v1.0, by hexgrad, <https://huggingface.co/hexgrad/Kokoro-82M>.
- Model files: ONNX conversion `onnx-community/Kokoro-82M-v1.0-ONNX`, <https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX>, revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231` on the generation day.
- Voice: `af_heart` (American English, female), from the voice files of the `kokoro-js` package.
- Licence of the model weights and voices: Apache License 2.0, <https://www.apache.org/licenses/LICENSE-2.0>.
- The model card states that the model was trained only on permissive or non-copyrighted audio.
- The Apache License 2.0 sets no restriction on audio that the model generates. The clips can be redistributed.

## Speech tool

- `kokoro-js` 1.2.1, Apache License 2.0, <https://github.com/hexgrad/kokoro/tree/main/kokoro.js>.
- `kokoro-js` uses `@huggingface/transformers` (Apache License 2.0) and `phonemizer` 1.2.1 (Apache License 2.0, based on eSpeak NG).
- These packages are installed only in `tools/audio/` by `pnpm audio:generate`. They are not part of the application, and no code from them is in this repository.

## Processing

- Speed 1.1, sample rate 24 kHz, mono, 16-bit PCM WAV.
- The command scales each clip to a peak of 0.89. It keeps 15 ms before the first audible sample and 40 ms after the last audible sample. It fades out the last 20 ms.
- `manifest.json` lists the file and the duration in milliseconds of each clip. The server uses these durations for the cue lead time.

## Clip set

- 13 action and system phrases, for example `Hard brake`, `Full throttle`, `Closer to apex`, `Big brake ahead` and `Guidance paused`.
- 60 focus sentences, `focus-<kind>-<turn>`, for turns one to ten, for example `Turn one. Brake later.`.
- 65 target speed numbers, `speed-<kph>`, from `thirty` to `three fifty` in steps of 5. The voice speaks a number only after a brake phrase.

Generation date: 17 November 2026.
