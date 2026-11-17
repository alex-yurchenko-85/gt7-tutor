# Recorded catalogue sources

These files are the answers of the catalogue sources on the retrieval date of `catalogue/catalogue.json`.
`pnpm catalogue:build --record fixtures/catalogue-sources` writes them. `index.json` maps each request URL to its file.
The server tests serve them through a stub `fetch`, so that the tests need no network.

- `*-csv.txt`: tables of ddm999/gt7info, <https://github.com/ddm999/gt7info>, licence MIT-0.
- `gt7-*-license.txt` and `circuit-experience.txt`: MediaWiki API answers of the Gran Turismo Wiki, <https://gran-turismo.fandom.com>, by the contributors to those pages. Licence: CC BY-SA, <https://www.fandom.com/licensing>.
