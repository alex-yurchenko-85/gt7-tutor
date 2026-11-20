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
