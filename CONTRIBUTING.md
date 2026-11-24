# Contributing to GT7 Tutor

Thank you for your interest in GT7 Tutor.
Send each change as a pull request on GitHub. Do not publish a changed copy under another name without the notices that the licence requires.

## Before you start

- For a larger change, open an issue first and describe the change. This prevents work that the project cannot accept.
- Read `docs/protocol.md` before a change to the decoder or the capture code.
- Read `docs/algorithms.md` before a change to `packages/core`.

## How to send a change

1. Fork the repository on GitHub and create a branch.
2. Write the test first. See it fail, then write the code and see the test pass.
3. Run the checks:

   ```sh
   pnpm typecheck
   pnpm test
   pnpm test:integration
   ```

4. Update the document that describes the code you changed.
5. Open a pull request. Say what the change does and what you did not check.

## Add a language

GT7 Tutor shows English only. All text on the screens and all spoken text come from a language pack. You can add a language without a change to the code.

### The files of a language pack

- The English pack in `packages/contracts/locales/en/` is the source. `messages.json` holds the screen texts. `voice.json` holds the spoken texts.
- Each English entry has a `text`, a `note` and sometimes a `maxChars`. The note tells where the text shows or sounds. `maxChars` is the maximum length of a text that cannot wrap, for example a button or a tab. The count includes the placeholders.
- A pack of a different language is one flat file for each part: `{ "<key>": "<text>" }`. The folder name is the language code, for example `ru`, `de` or `pt-BR`.
- A placeholder such as `{name}` or `{count}` gets a value from the screen. Keep each placeholder of the English text. You can move a placeholder to a different place in the sentence.
- A key that ends with `_one` or `_other` has plural forms. Your language can have more forms, for example `_few` and `_many`. The number in `{count}` selects the form.
- A key that is missing or empty shows the English text.

### Steps

1. Make the empty pack:

   ```sh
   pnpm locale:new <language code>
   ```

   The command writes `messages.json` and `voice.json` with every key and with the plural forms of your language. Each text is empty. The command does not write over a folder that exists.

2. Write each text. Read the note of the English entry first. Keep game names, track names, car names and product names as they are.
3. Check the pack:

   ```sh
   pnpm locale:check <language code>
   ```

   The command shows each problem in the pack. A problem is a missing text, a missing plural form or a wrong placeholder. A text that is too long and a key that the English pack does not have are problems too. The last line must be `0 problems`.

4. Start the demo with `./start.sh --demo`. Open the address with `?lang=<language code>`, for example `http://localhost:3001/exercises?lang=de`. Add `?lang=<language code>` to each address that you open: the language stays only for that page.
5. Look at each screen on a computer and on a phone, in the light theme and in the dark theme. A text must not overlap, must not be cut off and must not move the page to the side. The screens are:
   - the sign-in and Get ready,
   - Exercises with an open catalogue group, an exercise with its tabs, Attempts and Review,
   - the Drive stage of a demo attempt and the attempt summary,
   - the Record screen,
   - Setup with each part,
   - Races, and a race with Laps, Compare and Off the track,
   - the race recording stage.
6. The address `?lang=xx` shows a pseudo-language. It makes each English text longer and puts it in brackets. Text outside brackets does not come from the pack. Use it to find long texts and missing keys.

### Voice clips

- A pack without clips is valid: the voice stays English.
- The clips of a language go into `content/audio/<language code>/`, with a `manifest.json` and a `clips/` folder, as in `content/audio/en/`.
- Each voice folder has a `NOTICE.md`. It names the voice model or the speaker and the licence of the clips.
- The licence of the clips must allow redistribution, also for commercial use: for example Apache-2.0, MIT, CC0 or CC BY 4.0.
- For a recorded human voice, the speaker must give permission under such a licence.

### Licence of a translation

A contributed text uses the licence of GT7 Tutor, GPL-3.0, as all contributions do.

## Commit messages

Each commit message follows [Conventional Commits](https://www.conventionalcommits.org). A hook checks the message when you commit.

```text
<type>(<optional scope>): <summary in lower case, no full stop>
```

| Type | Use | Effect on the version |
| --- | --- | --- |
| `feat` | A new function for the user | Minor release |
| `fix` | A correction of wrong behaviour | Patch release |
| `feat!` or a `BREAKING CHANGE:` footer | A change that breaks existing use | Major release |
| `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore` | Other work | No release |

Examples: `fix(core): keep the side cue silent before the apex`, `docs: describe the packet layout`.

`pnpm install` sets two Git hooks. The `commit-msg` hook checks the message. The `pre-push` hook runs `pnpm typecheck` and `pnpm test`.

## Releases

A merge to `main` starts the release job after all tests pass.
The job reads the commit messages, chooses the next version, writes `CHANGELOG.md`, creates the tag and publishes the GitHub release.
Do not edit `CHANGELOG.md` or create a version tag by hand.

## Rules that reviewers apply

- No comments in code, in any file type. Names, types and small functions carry the meaning.
- The core (`packages/core`) stays pure: no Node, storage, audio or clock access. The same capture and settings give the same decisions.
- Raw capture files are the source of truth. The database stores no individual samples.
- Documents use short English sentences and one word for one meaning.
- No private data: no console address, no local path, no raw capture from your own network.
- A statement about the console needs hardware evidence. Say plainly when a check is software only.
- Do not copy code from another project unless its licence is compatible with GPL-3.0. Record the source and the licence in `THIRD_PARTY_NOTICES.md`.

## Licence of your contribution

GT7 Tutor uses the GNU General Public License, version 3 (`LICENSE`).
When you send a pull request, you agree that your contribution uses the same licence.
You keep the copyright of your contribution.
