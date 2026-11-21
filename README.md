<h1 align="center">
  <a href="https://gt7tutor.app">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/gt-tutor-logo-on-dark.png">
      <img src=".github/assets/gt-tutor-logo-transparent.png" alt="GT7 Tutor" width="460">
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
  <a href="docs/user-guide/README.md">User guide</a> ·
  <a href="#common-problems">Common problems</a> ·
  <a href="#support-the-project">Support</a>
</p>

GT7 Tutor is a self-hosted voice tutor for Gran Turismo 7 on PS5.
You drive with a DualSense controller and watch the game on your TV, as usual.
A computer on your home network receives the telemetry of the PS5 and runs GT7 Tutor.
A browser on that computer or on a phone shows the interface and plays short English voice cues.
The interface and the voice are in English only. Language packs for other languages are welcome: see [Add a language](CONTRIBUTING.md#add-a-language).
GT7 Tutor needs no account and no cloud service, and it does not see the game picture.
It is an unofficial fan project (see [Licences](#licences)).

## How it works

GT7 Tutor leads you through three steps for each exercise:

1. **Reference.** Record the demonstration that the game shows before the exercise. GT7 Tutor finds the start and the end of the demonstration by itself. That part is the reference.
2. **Attempts.** Drive the exercise. GT7 Tutor finds the start and the finish of each attempt by itself, and the time comes from the game. The Drive screen shows the next action, and a voice device says it, for example `Hard brake. One fifteen`, about half a second before the place where the reference does it.
3. **Review.** Compare each attempt with the reference on a map and in speed, pedal and side-distance charts. The differences are grouped by turn, with the time lost in each turn. Differences that repeat in your last attempts show on the cue list.

GT7 Tutor can also record a race by laps. Select **Record a race**, then drive the race in the game. The recording starts and stops with the race. After the race, the **Laps** tab shows the lap times, the pit stops, the position and the fuel. **Compare** puts two laps of the race side by side, by turn. **Off the track** shows where your wheels left the track and the places where it happened in 3 or more laps.

The [user guide](docs/user-guide/README.md) shows each screen and each step.

<table>
  <tr>
    <td width="50%"><img src="https://gt7tutor.app/assets/screenshots/drive-desktop.webp" alt="The Drive screen during a demo attempt. The current cue is Hard brake 115, cue 1 of 6 before turn 1, and the map shows the position on the reference line."></td>
    <td width="50%"><img src="https://gt7tutor.app/assets/screenshots/review-desktop.webp" alt="The review of a demo attempt. The map shows the reference line and the attempt line. The differences are grouped by turn, with 0.36 s lost in turn 1, and the speed chart is below the map."></td>
  </tr>
  <tr>
    <td align="center"><b>Drive</b>: the current cue and the position on the track</td>
    <td align="center"><b>Review</b>: the attempt against the reference</td>
  </tr>
</table>

## Which exercises work

GT7 Tutor finds the demonstration and the start and finish of each attempt from the data of the game. An exercise works when two things are true:

- The game times the demonstration of the exercise. GT7 Tutor needs this to find the reference.
- The game times your run from the start.

The catalogue lists 100 licence tests, 58 Circuit Experience sections and 20 Brand Central exercises from public sources. A catalogue entry does not mean that the exercise works.
For developers, [docs/protocol.md](docs/protocol.md#game-timer) gives the details.

## What you need

- A computer with macOS or Linux. Windows is not supported.
- Docker Desktop (or Docker Engine on Linux), which runs the database.
- Node.js 26 or later. Install it with the installer from <https://nodejs.org/en/download>.
- A current browser on that computer or on a phone on the same home network.
- For training: a PS5 with Gran Turismo 7 on the same home network. The demo needs no PS5.

## Install Docker

Install Docker before you run `./start.sh`. The start script does not install it.

- macOS: install [Docker Desktop](https://www.docker.com/products/docker-desktop/). Open it once and wait until it shows that it is running.
- Linux: install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Docker Engine](https://docs.docker.com/engine/install/). Make sure that your user can run `docker info` without an error.

## Quick setup (macOS and Linux)

1. Install Docker Desktop (see [Install Docker](#install-docker)) and [Node.js 26 or later](https://nodejs.org/en/download) with their installers.
2. Download GT7 Tutor. On the GitHub page of the project, select **Code**, then **Download ZIP**, and unpack the file. If you use Git, clone the repository instead.
3. Start GT7 Tutor in a terminal:
   - On macOS, open **Terminal** from Applications → Utilities.
   - Type `cd` with a space, drag the folder into the terminal window, and press Enter.
   - Run this command:

     ```sh
     ./start.sh
     ```

The script checks Node.js and Docker.
If one of them is missing or Docker is not running, the script stops and tells you what to do.
The script does not install programs on your computer.
It copies `.env.example` to `.env` if `.env` does not exist. It never changes an existing `.env`.

The first start installs the packages and builds GT7 Tutor. This takes a few minutes.
Then the script starts the database, prepares it and starts GT7 Tutor.
When GT7 Tutor is ready, the script shows the addresses, for example:

```text
✓ Server started

On this computer:  http://localhost:3000
On your phone:     http://192.0.2.10:3000
                   [QR code]

Log of this start: data/logs/2026-11-19_12-04-31.log
Press Ctrl+C to stop.
```

Open the address of `On this computer` in a browser on the same computer.
The first visit asks you to create a profile. Then the **Get ready to train** page asks for the console address, the voice device and the first exercise.
The [user guide](docs/user-guide/README.md#create-the-first-profile) shows these steps.

Run `./start.sh` for each start. After an update, the script prepares GT7 Tutor again.

## Manual setup

Use this path when you want to do each step yourself.

1. Install Docker (see above), [Node.js 26 or later](https://nodejs.org/en/download) and [pnpm](https://pnpm.io/installation).
2. Open a terminal in the GT7 Tutor folder.
3. Run these commands one by one:

   ```sh
   cp .env.example .env
   pnpm install
   docker compose up -d --wait postgres
   pnpm db:migrate
   pnpm build
   pnpm start
   ```

The first command copies the example settings. Do not run it if you already have a `.env` file.
`pnpm start` shows no addresses. Open `http://localhost:3000`, or the port of `HTTP_PORT` in `.env`.

## Try the demo without a console

The demo shows GT7 Tutor with recorded data.
You need no PS5 and no game.
Run:

```sh
./start.sh --demo
```

The first start prepares GT7 Tutor, as in the quick setup.
Then the script records a demo history, which takes a few seconds.
When the demo is ready, the script shows:

- the address for this computer: <http://localhost:3001>
- the address for a phone on the same network, and a QR code of it
- the demo profile `demo` and its password `demodemo`.

The demo has the exercise `Autódromo de Interlagos` (Circuit Experience, sector 2), its reference, and three recorded attempts.
Select **Drive**, then **Play a demo attempt**. A recorded attempt replays in real time and takes 27 to 41 s.
To hear the voice, select **Use this device for voice** first.
The [user guide](docs/user-guide/README.md#try-the-demo) shows the demo step by step.

The demo uses its own database and the folder `.demo/`.
It never changes your own profiles and attempts.
The log of each demo start is in `data/logs/`. Its name ends with `-demo.log`.
Press Ctrl+C to stop the demo.
To start the demo again from the beginning, run `./start.sh --demo --reset`.

## Connect the PS5

1. On the PS5, open Settings → Network → View Connection Status, and read the IPv4 address.
2. In GT7 Tutor, enter that address. On the first start, the **Get ready to train** page asks for it. Later, use **Setup** → **Console**.
3. Open Gran Turismo 7 past the title screen, and select the check button next to the address (**Save and check**). GT7 Tutor saves the address and checks the reception.

The console address can change after a router restart. Check it again if reception stops.
The computer must accept UDP on port 33740.
On macOS, allow incoming connections for Node.js when the system asks.
On Linux with `ufw`, run `sudo ufw allow 33740/udp`.

## Use a phone

The phone and the computer must be on the same home network.
`./start.sh` shows the address for the phone and a QR code of it, for example `http://192.0.2.10:3000`.
Scan the QR code with the phone camera, or type the address in the phone browser.
Your computer firewall must accept TCP on that port.

Two limits come from the phone browser, not from GT7 Tutor:

- Tap **Use this device for voice** once after you open the page. The button is in **Setup** → **Voice**, on the Drive screen and on the **Get ready to train** page. A browser does not let a page start sound by itself.
- Do not let the phone screen lock during an attempt. A locked screen stops the sound. Turn off auto-lock for the session.

Known issue on iPhone (Safari): after the screen locks and unlocks, the voice can stay silent.
The status still shows `Voice on this device` in green, and the **Test** button (the speaker) is also silent.
Only a reload of the page brings the sound back. After the reload, tap **Use this device for voice** again.
Until GT7 Tutor has a fix, turn off auto-lock on the iPhone for the whole session (Settings → Display & Brightness → Auto-Lock → Never).

## Stop and start again

- Press Ctrl+C in the terminal to stop GT7 Tutor or the demo.
- The database keeps running in Docker. It starts again with Docker.
- To start GT7 Tutor again, open a terminal in its folder and run `./start.sh`.
- To stop the database too, run `docker compose stop`.

## Common problems

Each start writes a log file to `data/logs/`. The folder keeps the newest 10 logs.
If you report a problem in an issue, attach the log of that start.
Read the log before you attach it. It can contain addresses on your home network.

| Problem | What to do |
| --- | --- |
| `Install Docker Desktop` | Install Docker (see [Install Docker](#install-docker)). Then run `./start.sh` again. |
| `Docker is not running` | Start Docker Desktop (macOS) or the Docker service (Linux). Then run `./start.sh` again. |
| `Install Node.js 26 or later` | Install Node.js from <https://nodejs.org/en/download>. Then run `./start.sh` again. |
| `Port 3000 is in use` | Stop the other program that uses the port, or start with another port, for example `./start.sh --port 3002`. To change the port for every start, set `HTTP_PORT` in `.env`. |
| `The database cannot be updated` | A database from an old development version cannot be migrated. Run `./start.sh --reset`. The script asks you to type `yes`. This removes all GT7 Tutor data. For the demo, run `./start.sh --demo --reset`. The demo reset asks no question. |
| `GT7 Tutor did not start` | Read the last lines of the log that the script shows. |
| The phone cannot open the address | Check that the phone is on the same network as the computer, not on mobile data. Check the computer firewall. |
| No sound on the phone | Tap **Use this device for voice** (in **Setup** → **Voice** or on the Drive screen). On an iPhone after a screen lock, reload the page first. Turn off silent mode. Keep the screen on. |
| `No packets` in **Setup** → **Console** | Check the console address, the firewall rule for UDP 33740, and that GT7 is open past the title screen. |

The [user guide](docs/user-guide/README.md#common-problems) covers problems inside the application, for example an attempt that does not start.

## Documentation

- [User guide](docs/user-guide/README.md): every screen, from the first profile to the review, with screenshots.
- [Telemetry protocol](docs/protocol.md): transport, decryption, the byte layout of a packet, the game timer, and how GT7 Tutor receives and stores the packets.
- [Algorithms](docs/algorithms.md): the reference line, the matching, the voice cues, the differences and the race analysis, each as a task and its solution.
- [Test fixtures](docs/fixtures.md): the recorded telemetry of the tests and the demo.
- [CONTRIBUTING.md](CONTRIBUTING.md): the rules for a change.

## For developers

```sh
pnpm typecheck
pnpm test                  # unit and interface tests, no database
pnpm test:integration      # server tests against PostgreSQL
pnpm test:coverage         # unit tests with a coverage report in coverage/
pnpm capture --ip <PS5 address> --seconds 60 --purpose demo
pnpm replay --file <raw capture .ndjson>
pnpm race:import --file <raw capture .ndjson> --profile <profile name>
pnpm evaluate-coach --attempt ce-slow --reference demo-a --first 457 --last 1422
pnpm catalogue:build --record fixtures/catalogue-sources   # network, rewrites the catalogue
pnpm audio:generate --lang en   # network, about 400 MB, rewrites the voice clips in content/audio/en/
pnpm locale:check <language code>   # checks a language pack in packages/contracts/locales/
```

Always pass `--ip` with the current console address.
`pnpm race:import` copies a raw capture into `DATA_DIR/raw/`. It stores the first race of that capture in the database for the profile. The source file does not change. The command uses `DATABASE_URL` and `DATA_DIR` of the server.
`pnpm db:reset` drops the database of `DATABASE_URL` (by default `gt7_tutor`), creates it again and migrates it. It deletes all data of that database. Use it only for a broken development database.
`pnpm test:integration` checks that UDP port 33740 is free. Stop a recording or a training of a running server before you start it.

## Data terms

| Term | Meaning |
| --- | --- |
| Capture | A complete file of received datagrams, including background and transitions |
| Sample | Telemetry fields that the decoder reads from one datagram |
| Exercise | A task with an activity type and a selected section |
| Reference | A reviewed range of a demonstration or trusted run |
| Attempt | A selected player-driving range inside a capture |
| Cue | A short voice instruction tied to a place on the section, for example `Hard brake. One fifteen`. The server decides it, and the voice device plays it. |
| Difference | A place where an attempt is not the same as the reference, for example `Braked 17 m earlier`. The interface never calls it a mistake. |
| Generation | A new attempt context that invalidates earlier matches and audio cues |
| Trusted match | A position match that passes the configured direction, distance and freshness checks |
| Game timer | The run time that the game sends in each packet. It starts and finishes an attempt. |
| Race | A race by laps that GT7 Tutor recorded, from the grid or the first recorded lap line to the finish |
| Lap | One lap of a race. It keeps the lap number of the game. |
| Pit stop | A stop in the pit lane between an in-lap and an out-lap |
| Off the track | A moment with two or more wheels on a surface that is not the track or a kerb |
| Recurring place | A place of the track with off-track moments in 3 or more laps of one race |

## Support the project

GT7 Tutor is free and open source, and it stays free.
If it helps you, you can support it with a small donation.
A donation is voluntary and unlocks nothing: every feature is in the free code.

<p>
  <a href="https://ko-fi.com/alex85"><img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white" alt="Support on Ko-fi"></a>
  <a href="https://buymeacoffee.com/alex.y.85"><img src="https://img.shields.io/badge/Buy_me_a_coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee"></a>
</p>

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
See `content/catalogue/NOTICE.md` for the attribution.

The voice clips are made with Kokoro-82M, voice `af_heart` (Apache-2.0).
The interface fonts are Sofia Sans and Sofia Sans Condensed (SIL Open Font License 1.1).

GT7 Tutor is an unofficial fan project.
It is not affiliated with or endorsed by Sony Interactive Entertainment or Polyphony Digital.
Gran Turismo is a trademark or registered trademark of Sony Interactive Entertainment Inc.
