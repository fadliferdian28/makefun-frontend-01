# PotScope

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/fadliferdian28/makefun-frontend-01/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/fadliferdian28/makefun-frontend-01/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

A static, no-build make.fun frontend: a live bounty board, bounty pages with
live-pot reward math, paginated leaderboards, and public builder profiles. Reads
the public make.fun API directly from the browser; no backend, no framework, no
web font.

## Run

```sh
node serve.ts            # http://localhost:8080
node serve.ts --port 9000
```

## Routes

- `#/` — bounty board (summary strip, live ticker, filters, live / opening soon / closed tables)
- `#/bounty/<slug>` — bounty page (stat cards, rewards + fee-share bars, dates, judging, top 5, rules)
- `#/bounty/<slug>/leaderboard` — full leaderboard, 50 rows per page, find-a-handle, 90% intervals
- `#/u/<handle>` — public profile (5 stat cards, entries, payouts with explorer links)
- `#/builders` — top builders by wins

## Performance

- First load: `index.html` + one small CSS file + one small JS module (board and bounty
  views statically imported); leaderboard and profile views load on demand via `import()`.
- One API request per view: board (`?activity=times`), bounty (`?submissions=summary`),
  leaderboard (`?rows=first`), profile. The bounty page adds one `/live` call for the top-5 strip.
- In-memory cache keyed by URL with ETag revalidation: fresh for 60s (lists) / 5min
  (detail, profile), then stale-while-revalidate. Repeat visits inside the window cost zero.
- No images on first load; avatars set `crossorigin="anonymous"` before `src`.

## Package

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `app/` and `screenshots/` (if present) into the output directory and
writes `dossier.json` via the vendor dossier builder. If `screenshots/` is absent it
creates an empty output folder and leaves a `DOSSIER-PENDING.txt`; add the three
screenshots named in `shots.json` and rerun to produce the dossier.
