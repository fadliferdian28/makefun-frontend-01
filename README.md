# PotScope

PotScope is a fast, static read of the public make.fun API: a live bounty board, each bounty's page and leaderboard, and any builder's public profile, all rendered from live data with no framework, no build step, and no sign-in.

[![make.fun competition badge](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01)

[![make.fun rank badge](https://make.fun/badge/makefun-frontend-01/fadliferdian28/makefun-frontend-01/rank.svg)](https://make.fun/bounty/makefun-frontend-01)

[![make.fun reward badge](https://make.fun/badge/makefun-frontend-01/fadliferdian28/makefun-frontend-01/reward.svg)](https://make.fun/bounty/makefun-frontend-01)

## Run it

```sh
node serve.ts            # http://127.0.0.1:8080
node serve.ts --port 9000
```

The server serves `app/` on the loopback address. To package the entry with the dossier, run `MAKEFUN_OUTPUT_DIR=out node main.ts`.

## Routes

- `#/` — the bounty board: live, opening-soon, and closed bounties with live pot, fee, time left, entries, and value per entry.
- `#/bounty/:slug` — one bounty: stat strip, tabs, rewards table with fee-share bars, dates, judging, rules, and a sidebar.
- `#/bounty/:slug/leaderboard` — the full ranked leaderboard, 50 rows per page with search, medals, 90% intervals, prizes, and phase and view toggles.
- `#/user/:handle` — a builder's profile: five stat boxes, recent activity, entries, and payouts.
- `#/builders` — the top-builders surface.

## Performance

The first load is one HTML shell, one stylesheet, and the router plus the API and formatting modules: about 11 KB gzipped (level 9) across the shell, style sheet, and those statically imported modules. The board and bounty views, their shared view helper, the leaderboard and profile views, the detail API and formatting modules, and the detail stylesheet all load lazily: the board route still paints immediately, but that payload sits outside the first load. Every API response is cached in memory with its ETag: lists and leaderboards stay fresh for 60 seconds, detail and profiles for 5 minutes, and stale bodies keep rendering while a conditional request revalidates them, so repeat visits inside a window make zero requests and a full four-surface tour makes four.
