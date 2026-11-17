# PotScope

[![make.fun competition badge](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01)

[![make.fun rank badge](https://make.fun/badge/makefun-frontend-01/fadliferdian28/makefun-frontend-01/rank.svg)](https://make.fun/bounty/makefun-frontend-01)

[![make.fun reward badge](https://make.fun/badge/makefun-frontend-01/fadliferdian28/makefun-frontend-01/reward.svg)](https://make.fun/bounty/makefun-frontend-01)

PotScope is a static frontend for [make.fun](https://make.fun): a live bounty
board with a split view, each bounty's detail page and leaderboard, a builder
profile and the top builders ranking. It reads the public make.fun API in the
browser; there is no build step, no framework and no web font.

## Run it

```sh
node serve.ts                 # http://127.0.0.1:8080
node serve.ts --port 9000     # another port
```

The server serves `app/` on the loopback address. Open the printed address and
the board loads from the live API.

## Routes

- `#/` — the bounty board, split view: table left, selected bounty right.
- `#/bounty/<slug>` — one bounty's full page with tabs, rewards and judging.
- `#/bounty/<slug>/leaderboard` — that bounty's ranked leaderboard.
- `#/user/<handle>` — a builder's public profile.
- `#/builders` — the top builders ranking, from the header navigation.

Every route is a hash address, so a shared link or a refresh opens the right
view; back and forward work.

## Performance story

The first load is a single file: `app/index.html`, **846 bytes gzip-9**
(1 file, measured with `gzip -9` and the dossier's Totals line). It carries a
small inline style block and a small inline module script that dynamic-imports
the main module; the style sheet, the API client, the formatters and every view
arrive afterwards through `import()`.

API reads go through an in-memory cache keyed by request address, storing the
JSON body, its ETag and the fetch time. Fresh entries (60 s for lists and
leaderboards, 5 min for details and profiles) are served without a request;
stale entries stay on screen while a conditional request revalidates them. The
footer of every view prints the view's counted requests, cache hits and 304s,
so the discipline is visible rather than claimed. A full tour of the four
surfaces is four requests.

## License

MIT. See [LICENSE](LICENSE).
