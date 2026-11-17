<h1 align="center">
  <a href="https://gt7tutor.app">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="site/assets/brand/gt-tutor-logo-on-dark.png">
      <img src="site/assets/brand/gt-tutor-logo-transparent.png" alt="GT7 Tutor" width="460">
    </picture>
  </a>
</h1>

<p align="center"><b>Voice cues for Gran Turismo 7 exercises, timed from the live telemetry of your PS5.</b></p>

<p align="center">
  <a href="https://github.com/alex-yurchenko-85/gt7-tutor/actions/workflows/ci.yml"><img src="https://github.com/alex-yurchenko-85/gt7-tutor/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/alex-yurchenko-85/gt7-tutor"><img src="https://codecov.io/gh/alex-yurchenko-85/gt7-tutor/graph/badge.svg" alt="Test coverage"></a>
  <a href="https://github.com/alex-yurchenko-85/gt7-tutor/releases"><img src="https://img.shields.io/github/v/release/alex-yurchenko-85/gt7-tutor" alt="Latest release"></a>
  <a href="https://nodejs.org/en/download"><img src="https://img.shields.io/badge/node-%E2%89%A5%2026-339933?logo=nodedotjs&logoColor=white" alt="Node.js 26 or later"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-GPL--3.0-blue" alt="Licence: GPL-3.0"></a>
  <a href="https://gt7tutor.app"><img src="https://img.shields.io/badge/website-gt7tutor.app-d90000" alt="Website: gt7tutor.app"></a>
</p>

<p align="center">
  <a href="https://gt7tutor.app">Website</a> ·
  <a href="#quick-setup-macos-and-linux">Setup</a> ·
  <a href="#try-the-demo-without-a-console">Demo</a> ·
  <a href="#connect-the-ps5">Connect the PS5</a> ·
  <a href="#common-problems">Common problems</a>
</p>

GT7 Tutor is a self-hosted voice tutor for Gran Turismo 7 on PS5.
The player uses a DualSense controller and watches the game on a TV.
A computer on the home network records telemetry and runs the application.
A browser on that computer or on a phone shows the interface and plays short English voice cues.
GT7 Tutor has no account, no cloud service and no game footage.
It is an unofficial fan project (see [Licences](#licences)).

## How it works

GT7 Tutor leads you through four steps for each exercise:

1. **Reference.** Record a drive of the exercise and select the range that GT7 Tutor follows.
2. **Baseline.** Drive a few attempts without voice. GT7 Tutor measures them.
3. **Guided attempts.** Drive with voice. GT7 Tutor calls the next action, for example `Hard brake 85`, about half a second before the point where the reference does it.
4. **Review.** Compare each attempt with the reference: the line, the speed, the pedals and the differences.

<table>
  <tr>
    <td width="50%"><img src="site/assets/screenshots/drive-desktop.png" alt="The Drive view during a guided attempt. The current cue is Hard brake 85, and the map shows the position on the track."></td>
    <td width="50%"><img src="site/assets/screenshots/review-desktop.png" alt="The review of one attempt. The map shows the reference line and the attempt line, with speed and throttle charts and a list of differences."></td>
  </tr>
  <tr>
    <td align="center"><b>Drive</b>: the current cue and the position on the track</td>
    <td align="center"><b>Review</b>: the attempt against the reference</td>
  </tr>
</table>

## What you need

- A computer with macOS or Linux for the quick setup. Windows works with the manual setup.
- Docker, which runs the database.
- Node.js 26 or later and pnpm. On macOS, the setup script can install them with Homebrew.
- A current browser on that computer or on a phone on the same home network.
- For training: a PS5 with Gran Turismo 7 on the same home network. The demo needs no PS5.

## Install Docker

Install Docker before you run the setup. The setup script does not install it.

- macOS: install [Docker Desktop](https://www.docker.com/products/docker-desktop/). Open it once and wait until it shows that it is running.
- Linux: install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Docker Engine](https://docs.docker.com/engine/install/). Make sure that your user can run `docker info` without an error.

## Quick setup (macOS and Linux)

1. Download GT7 Tutor. On the GitHub page of the project, select **Code**, then **Download ZIP**, and unpack the file. If you use Git, clone the repository instead.
2. Open a terminal. On macOS, open **Terminal** from Applications → Utilities.
3. Go to the GT7 Tutor folder. Type `cd` with a space, drag the folder into the terminal window, and press Enter.
4. Start the setup:

   ```sh
   sh scripts/setup.sh
   ```

The script checks Docker, Node.js and pnpm, and then prepares GT7 Tutor.
It prints each step in plain English.
On macOS with [Homebrew](https://brew.sh), it installs Node.js and pnpm if they are missing.
On Linux, it stops and gives the install link for a missing tool. Install the tool, then run the script again.
The script is safe to run again.
To see the steps without a change to your computer, run `sh scripts/setup.sh --dry-run`.

When the script finishes, start GT7 Tutor:

```sh
pnpm start
```

Then open <http://localhost:3000> in a browser on the same computer.
The first visit asks you to create a profile.

## Manual setup

Use this path on Windows, or when you want to do each step yourself.
The guided setup is not available on Windows yet.

1. Install Docker (see above), [Node.js 26 or later](https://nodejs.org/en/download) and [pnpm](https://pnpm.io/installation).
2. Open a terminal in the GT7 Tutor folder.
3. Run these commands one by one:

   ```sh
   pnpm setup:local
   pnpm start
   ```

`pnpm setup:local` does the same work as the last step of the setup script.
It copies `.env.example` to `.env` if `.env` does not exist, installs the packages, starts the database, prepares it and builds the application.
It never changes an existing `.env`.

If you prefer the single commands, they are:

```sh
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:migrate
pnpm build
pnpm start
```

On Windows, use `copy .env.example .env` for the first command.

## Try the demo without a console

The demo shows GT7 Tutor with recorded data.
You need no PS5 and no game.
After the setup, run:

```sh
pnpm demo
```

The first start records a demo history, which takes a few seconds.
Then the command prints:

- the address for this computer: <http://localhost:3001>
- the address for a phone on the same network, and a QR code of it
- the demo profile `demo` and its password `demodemo`.

The demo has the exercise `Yangwang Experience / Racing Lines`, its reference, and three recorded attempts.
Open **Drive** and select **Play a demo attempt** to hear a guided attempt with voice.
The attempt replays in real time and takes about one minute.
After it, the attempt summary, the review and **Progress** show the results.

The demo uses its own database and the folder `.demo/`.
It never changes your own profiles and attempts.
The demo server writes its messages to `.demo/server.log`.
Press Ctrl+C to stop the demo.
To start the demo again from the beginning, run `pnpm demo --reset`.
You can also run the setup and the demo in one step: `sh scripts/setup.sh --demo`.

## Connect the PS5

1. On the PS5, open Settings → Network → View Connection Status, and read the IPv4 address.
2. In GT7 Tutor, open **Setup** and enter that address in **Console**.
3. Open Gran Turismo 7 past the title screen, and select **Check reception**.

The console address can change after a router restart. Check it again if reception stops.
The computer must accept UDP on port 33740.
On macOS, allow incoming connections for Node.js when the system asks.
On Linux with `ufw`, run `sudo ufw allow 33740/udp`.
On Windows, allow Node.js in the firewall for private networks.

## Use a phone

The phone and the computer must be on the same home network.
Open the address that the computer shows, for example `http://192.0.2.10:3000`.
`pnpm demo` prints this address and a QR code for the demo.
For your own server, use the address of the computer on the home network, with port 3000.
Your computer firewall must accept TCP on that port.

Two limits come from the phone browser, not from GT7 Tutor:

- In **Setup**, tap **Use this device for voice** once. A browser does not let a page start sound by itself.
- Do not let the phone screen lock during an attempt. A locked screen stops the sound. Turn off auto-lock for the session.

Known issue on iPhone (Safari): after the screen locks and unlocks, the voice can stay silent.
The status still shows `Voice on this device` in green, and **Run voice test** is also silent.
Only a reload of the page brings the sound back. After the reload, tap **Use this device for voice** again.
Until GT7 Tutor has a fix, turn off auto-lock on the iPhone for the whole session (Settings → Display & Brightness → Auto-Lock → Never).

## Stop and start again

- Press Ctrl+C in the terminal to stop GT7 Tutor or the demo.
- The database keeps running in Docker. It starts again with Docker.
- To start GT7 Tutor again, open a terminal in its folder and run `pnpm start`.
- To stop the database too, run `docker compose stop`.

## Common problems

| Problem | What to do |
| --- | --- |
| `Docker is not running` | Start Docker Desktop (macOS) or the Docker service (Linux). Then run the command again. |
| `Node.js 26 or later is required` | Install Node.js from <https://nodejs.org/en/download>. Then run the command again. |
| Port 3000 or 3001 is in use | Stop the other program that uses the port. For the demo, you can also run `pnpm demo --port 3002`. |
| The phone cannot open the address | Check that the phone is on the same network as the computer, not on mobile data. Check the computer firewall. |
| No sound on the phone | In **Setup**, tap **Use this device for voice**. On an iPhone after a screen lock, reload the page first. Turn off silent mode. Keep the screen on. |
| `No packets` in **Setup** | Check the console address, the firewall rule for UDP 33740, and that GT7 is open past the title screen. |

## Security

Each profile has a password.
The password keeps other people on your home network out of your profile.
GT7 Tutor uses plain HTTP on the home network.
It does not protect against an attacker on the same network.
Do not make GT7 Tutor reachable from the internet.

## For developers

```sh
pnpm typecheck
pnpm test                  # unit and interface tests, no database
pnpm test:integration      # server tests against PostgreSQL
pnpm test:coverage         # unit tests with a coverage report in coverage/
pnpm capture --ip <PS5 address> --seconds 60 --purpose demo --start-after 5
pnpm replay --file <raw capture .ndjson>
pnpm evaluate-coach --attempt player-run --reference demo-wait05 --first 352 --last 1897
pnpm catalogue:build --record fixtures/catalogue-sources   # network, rewrites the catalogue
pnpm audio:generate        # network, about 400 MB, rewrites the voice clips
pnpm site:check            # checks the landing page
```

Always pass `--ip` with the current console address.
Stop a running server before `pnpm test`: only one program can receive telemetry on UDP port 33740.
[CONTRIBUTING.md](CONTRIBUTING.md) gives the rules for a change.

## Read the project documents

- [Telemetry protocol](docs/protocol.md): transport, decryption and the byte layout of a packet.
- [Core algorithms](docs/algorithms.md): reference, matching, voice decisions and differences.

## Data terms

| Term | Meaning |
| --- | --- |
| Capture | A complete file of received datagrams, including background and transitions |
| Sample | Telemetry fields that the decoder reads from one datagram |
| Exercise | A task with an activity type, selected section and driving conditions |
| Reference | A reviewed range of a demonstration or trusted run |
| Attempt | A selected player-driving range inside a capture |
| Generation | A new attempt context that invalidates earlier matches and audio cues |
| Trusted match | A position match that passes the configured direction, distance and freshness checks |
| Gate | A directed spatial boundary for an exercise start or finish |

## Files and dependencies

`apps/server` is the NestJS server. `apps/web` is the React interface.
`packages/` holds the core logic, the shared contracts, the capture code and the catalogue builder.
`scripts/setup.sh` and `tools/setup/` hold the guided setup. `tools/demo/` holds the demo command.
`fixtures/` holds short recorded captures for tests and for the demo. They do not contain the console address.
`tools/` holds the capture, replay and evaluation commands.
PostgreSQL stores metadata, attempts and statistics. Raw capture files remain the source of truth for telemetry.

The production stack is TypeScript, NestJS, React, PostgreSQL and Knex with `pg`.
The project ignores `data/`, `.demo/`, dependencies and `.env` files in Git.

## Acknowledgements

GT7 Tutor exists because other people published their work on the GT7 telemetry interface.

- [GT7 Datalogger](https://github.com/jbhoorasingh/gt7-datalogger) by Jermaine Bhoorasingh, MIT licence. The packet decryption and the packet layout in this project follow its Python telemetry code.
- [gt7info](https://github.com/ddm999/gt7info) by ddm999, MIT-0 licence. The circuit, layout and car tables of the catalogue come from it.
- [Gran Turismo Wiki](https://gran-turismo.fandom.com) contributors, CC BY-SA licence. The licence test and Circuit Experience lists of the catalogue come from it.
- [noble-ciphers](https://github.com/paulmillr/noble-ciphers) by Paul Miller, MIT licence. It provides the Salsa20 implementation.
- [GT7 dashboard](https://github.com/snipem/gt7dashboard) and [GT7 SpeedBoard](https://github.com/profittlich/gt7speedboard), GPL-3.0. They informed the design. This project contains none of their code.

## Licences

Copyright (C) 2026 Alex.

GT7 Tutor is free software. You can use it, change it and share it under the terms of the GNU General Public License, version 3.
The full text is in [LICENSE](LICENSE). GT7 Tutor comes with no warranty.

If you share a changed copy, the licence asks three things of you:

- Keep the copyright notice and the licence.
- Say clearly that you changed the work, and give the date.
- Publish your source under the same licence.

To propose a change, send a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists the work of other people that this project uses.
Catalogue data from the Gran Turismo Wiki stays under CC BY-SA, in its own files with a notice beside them.
See `catalogue/NOTICE.md` for the attribution.

GT7 Tutor is an unofficial fan project.
It is not affiliated with or endorsed by Sony Interactive Entertainment or Polyphony Digital.
Gran Turismo is a trademark of its owner.
