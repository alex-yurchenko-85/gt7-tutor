# Catalogue data notice

`catalogue.json` is built by `pnpm catalogue:build` from two public sources.
The data is community content. It is not checked against the game screen.
A catalogue entry does not state that the application supports that exercise.

## Gran Turismo Wiki

- Source: Gran Turismo Wiki, <https://gran-turismo.fandom.com>, read through its MediaWiki API.
- Pages: `GT7 B-License`, `GT7 A-License`, `GT7 International B-License`, `GT7 International A-License`, `GT7 S-License`, `GT7 Master B-License`, `GT7 Master A-License`, `GT7 Master International B-License`, `GT7 Master International A-License`, `GT7 Master S-License` and `Circuit Experience`.
- Authors: the contributors to these pages. The page history on the wiki lists them.
- Licence: Creative Commons Attribution-Share Alike (CC BY-SA), <https://www.fandom.com/licensing>.
- Data taken: licence test codes, names, cars, tracks and gold, silver and bronze target times. Also Circuit Experience tracks, regions, cars and section counts.
- Changes: the build command extracts these fields and converts target times to milliseconds. It adds circuit identifiers from gt7info.

The licence test and Circuit Experience entries in `catalogue.json` are an adaptation of this content.
You can use them under the terms of CC BY-SA.
This licence applies to that data only. The application code uses GPL-3.0 (`LICENSE`).

## ddm999/gt7info

- Source: <https://github.com/ddm999/gt7info>, branch `web-new`, tables `course.csv`, `crsbase.csv`, `country.csv`, `cars.csv` and `maker.csv`.
- Licence: MIT No Attribution (MIT-0).
- Data taken: circuits and layouts, and car names by game car ID.

## Manual entries

The `Brand Central` entries are manual entries. `packages/catalogue/src/manual.ts` holds them.
They are the Experience exercises `EXP-1` to `EXP-5` of Hyundai, Polestar, Xiaomi and Yangwang.
`brand-yangwang-racing-lines` is Yangwang `EXP-1`. It keeps its earlier identifier.

- Track, car and target times come from the game screen (17 November 2026).
- Track names and car labels use the spelling of the gt7info tables.
- The English exercise names come from the section `Experience` of the Gran Turismo Wiki page of each track. The entry field `source` names the page. The names are an adaptation of that content under CC BY-SA.
- Yangwang `EXP-4` is not in the wiki. Its name follows the other exercises that have the same label on the game screen.
- The `EXP-5` entries have no target times. The game screen shows the times only after the exercise is unlocked.
- The wiki lists other target times for Xiaomi `EXP-4`. The catalogue uses the times from the game screen.

`aliases.json` maps wiki track names to gt7info layout IDs where the names differ. The project maintainer wrote it.
