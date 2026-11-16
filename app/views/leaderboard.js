// leaderboard.js — lazy-loaded per-bounty board (50 rows a page, handle search,
// metric-adaptive score column + 90% interval, medals for the top 3) and the
// top-builders surface (rank medals, win rate, entries, rewards).

import { getLeaderboard, getTopBuilders } from "../api.js";
import { num, score, intervalRange, money2, money, dateShort, pct, el, avatar, apiUrl } from "../format.js";

const PAGE_SIZE = 50;

let state = null;

function held(container) {
  container.replaceChildren(el("div", { class: "held" }, "Scores held until the final run."));
}

function metricLabel(rankKey, columns, b) {
  const key = String(rankKey || "");
  if (key.includes("judge")) return "Judge win rate";
  if (key.includes("elo")) return "Elo";
  if (key.includes("log_score") || key.includes("loss")) return "Log score";
  if (key.includes("probability")) return "Probability";
  if (key.includes("distance")) return "Distance";
  const col = (columns || []).find((c) => c.key === key);
  return col ? col.title : key || "Score";
}

function metricUnit(rankKey, b) {
  const key = String(rankKey || "");
  if (key.includes("judge")) return "millionths";
  if (key.includes("elo")) return "elo";
  if (key.includes("probability")) return "probability";
  if (key.includes("distance")) return "km";
  return "";
}

function prizeLookup(b) {
  const map = new Map();
  const rw = Array.isArray(b.rewardsNow) ? b.rewardsNow : [];
  for (const r of rw) {
    const place = Number(r.place);
    if (!Number.isInteger(place) || place <= 0) continue;
    let amount = r.amountUsd !== undefined && r.amountUsd !== null ? r.amountUsd : null;
    if (amount === null && (r.baseUsd !== undefined || r.feeShareUsd !== undefined)) {
      amount = (Number(r.baseUsd) || 0) + (Number(r.feeShareUsd) || 0);
    }
    if (amount !== null) map.set(place, amount);
  }
  if (!map.size && b.rewards && typeof b.rewards === "object") {
    for (const [place, amount] of Object.entries(b.rewards)) {
      const n = Number(place);
      if (Number.isInteger(n) && n > 0) map.set(n, amount);
    }
  }
  if (b.rewards && typeof b.rewards === "object") {
    for (const [place, amount] of Object.entries(b.rewards)) {
      const n = Number(place);
      if (Number.isInteger(n) && n > 0 && !map.has(n)) map.set(n, amount);
    }
  }
  return map;
}

/** The paid place for a row: prize_rank, falling back to its overall rank. */
function paidPlace(r) {
  const pr = Number(r.prize_rank);
  if (Number.isInteger(pr) && pr > 0) return pr;
  const rank = Number(r.rank);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

/** Score value for a full row (values keyed by column) or a stub (scalar value/display). */
function rowValue(r, rankKey) {
  if (r.values && typeof r.values === "object") {
    if (r.values[rankKey] !== undefined && r.values[rankKey] !== null) return r.values[rankKey];
    const keys = Object.keys(r.values);
    if (keys.length) return r.values[keys[0]];
  }
  const value = r.value;
  if (value && typeof value === "object") {
    if (value[rankKey] !== undefined && value[rankKey] !== null) return value[rankKey];
    const keys = Object.keys(value);
    if (keys.length) return value[keys[0]];
  }
  if (value !== undefined && value !== null) return value;
  if (r.performance !== undefined && r.performance !== null) return r.performance;
  if (r.display && typeof r.display === "object") {
    if (r.display[rankKey] !== undefined && r.display[rankKey] !== null) return r.display[rankKey];
  }
  if (typeof r.display === "string" || typeof r.display === "number") return r.display;
  return null;
}

function blankAvatar(size) {
  return el("span", { class: "avatar", "aria-hidden": "true", style: "display:inline-block;width:" + size + "px;height:" + size + "px" });
}

/** Format a row score, keeping any preformatted display string as-is. */
function scoreText(value, label, unit) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && value.trim() !== "" && !Number.isFinite(Number(value))) return value;
  return score(value, label, unit);
}

const MEDALS = { 1: "gold", 2: "silver", 3: "bronze" };

function rankCell(rank, cls) {
  const n = Number(rank);
  if (MEDALS[n]) {
    return el("td", { class: "rank" + (cls ? " " + cls : "") },
      el("span", { class: "medal " + MEDALS[n], title: "#" + n + " place" }, String(n)));
  }
  return el("td", { class: "rank" + (cls ? " " + cls : "") }, "#" + num(rank));
}

function buildHead(b, columns, rankKey) {
  const label = metricLabel(rankKey, columns, b);
  return el("thead", null, el("tr", null,
    el("th", null, "Rank"),
    el("th", null, "Entrant"),
    el("th", { class: "right" }, label),
    el("th", { class: "right hidesm" }, "Prize"),
    el("th", { class: "right hidesm" }, "Valid"),
    el("th", { class: "hidesm" }, "Received"),
  ));
}

function buildBody(b, rows, columns, rankKey, unit) {
  const label = metricLabel(rankKey, columns, b);
  const prizes = prizeLookup(b);
  const tbody = el("tbody");
  for (const r of rows) {
    const img = r.image ? avatar(apiUrl(r.image), 24, r.handle) : blankAvatar(24);
    const iv = r.interval ? intervalRange(r.interval.low, r.interval.high, label, unit) : "";
    const place = paidPlace(r);
    let prize = place !== null && prizes.has(place) ? prizes.get(place) : null;
    if (prize === null) {
      const rowPrize = r.prize_usd !== undefined && r.prize_usd !== null ? r.prize_usd
        : r.prizeUsd !== undefined && r.prizeUsd !== null ? r.prizeUsd : null;
      if (rowPrize !== null) prize = rowPrize;
    }
    const prizeText = prize !== null ? money2(prize) : "—";
    const value = rowValue(r, rankKey);
    tbody.append(el("tr", null,
      rankCell(r.rank, r.rank <= 3 ? "top" : ""),
      el("td", null, el("div", { class: "entrant" }, img,
        el("div", { class: "et" },
          el("a", { class: "h", href: "#/u/" + encodeURIComponent(r.handle) }, "@" + (r.handle || "")),
          el("div", { class: "ti", title: r.title || "" }, r.title || "—"),
        ))),
      el("td", { class: "right" }, el("span", { class: "score" }, scoreText(value, label, unit)),
        iv ? el("span", { class: "iv", title: "90% confidence interval" }, iv) : null),
      el("td", { class: "right hidesm" }, prize !== null ? el("span", { class: "money" }, prizeText) : "—"),
      el("td", { class: "right hidesm" }, r.values && Number(r.values.valid) ? el("span", { class: "chk" }, "✓") : "—"),
      el("td", { class: "hidesm muted", style: "white-space:nowrap;font-size:12px" }, dateShort(r.received_at)),
    ));
  }
  return tbody;
}

function pager(total, page, onPage) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const wrap = el("div", { class: "pager" });
  const prev = el("button", { type: "button", onclick: () => onPage(page - 1) }, "‹ Prev");
  prev.disabled = page <= 1;
  wrap.append(prev, el("span", { class: "info" }, "Page " + page + " of " + pages));
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (pages <= 9 || p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  for (const n of nums) {
    if (n === "…") { wrap.append(el("span", { class: "info" }, "…")); continue; }
    const b = el("button", { type: "button", "aria-current": n === page ? "page" : null, onclick: () => onPage(n) }, String(n));
    wrap.append(b);
  }
  const next = el("button", { type: "button", onclick: () => onPage(page + 1) }, "Next ›");
  next.disabled = page >= pages;
  wrap.append(next);
  return wrap;
}

function renderTableArea() {
  if (!state) return;
  const { container, b, data } = state;
  const host = container.querySelector("#lb-table");
  if (!host) return;
  const rankKey = data.rank_key || (b.leaderboard && b.leaderboard.rankKey) || "judge";
  const columns = Array.isArray(data.columns) ? data.columns : [];
  const unit = metricUnit(rankKey);
  const q = state.q.trim().toLowerCase();

  const full = Array.isArray(data.entries) ? data.entries : [];
  const rest = Array.isArray(data.rest) ? data.rest : [];
  const seen = new Set();
  let rows = [];
  for (const r of full.concat(rest)) {
    if (r.rank === null || r.rank === undefined) continue;
    const key = r.submission_id ? "s:" + r.submission_id : "r:" + r.rank + ":" + (r.handle || "") + ":" + (r.title || "");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }
  if (q) rows = rows.filter((r) => (r.handle || "").toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q));
  rows.sort((a, c) => a.rank - c.rank);

  const total = rows.length;

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.page, pages);
  state.page = page;
  const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const table = el("table", null, buildHead(b, columns, rankKey), buildBody(b, slice, columns, rankKey, unit));
  const frag = el("div", null,
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:4px" },
      num(total) + " ranked" + (q ? " matching “" + q + "”" : "") + " · " + PAGE_SIZE + " per page"),
    el("div", { class: "tablewrap" }, table),
    pager(total, page, (p) => { state.page = p; renderTableArea(); }),
  );
  host.replaceChildren(frag);
}

export async function render(container, ctx = {}) {
  const slug = ctx.params && ctx.params.slug;
  if (!slug) {
    container.replaceChildren(el("div", { class: "err" }, "No bounty in this URL."));
    return;
  }
  container.replaceChildren(el("div", { class: "loading" }, "Loading leaderboard…"));
  const phase = ctx.query && ctx.query.get("phase") || "";
  const view = ctx.query && ctx.query.get("view") || "";

  try {
    const { body: b } = await (await import("../api.js")).getBounty(slug);
    const { body: data } = await getLeaderboard(slug, { phase, view });
    const phaseInfo = data.phase || {};
    const title = b.title || slug;
    const rankKey = data.rank_key || (b.leaderboard && b.leaderboard.rankKey) || "judge";
    const columns = Array.isArray(data.columns) ? data.columns : [];
    const unit = metricUnit(rankKey);

    state = { container, b, data, page: 1, q: "" };

    const head = el("div", null,
      el("div", { class: "crumb" }, el("a", { href: "#/" }, "Board"), " / ",
        el("a", { href: "#/bounty/" + encodeURIComponent(slug) }, title), " / Leaderboard"),
      el("div", { class: "lb-head" },
        el("h1", null, "Leaderboard"),
        el("span", { class: "badge " + (phaseInfo.scores_visible === false ? "closed" : "live") },
          phaseInfo.scores_visible === false ? "Scores held" : (phaseInfo.title || "Live")),
      ),
      el("div", { class: "muted", style: "font-size:12px" },
        title + " · " + metricLabel(rankKey, columns, b) + (unit === "millionths" ? " (win rate)" : "") +
        " · scores " + (phaseInfo.scores === "live" ? "live" : "after finalize"),
      ),
    );

    const tools = el("div", { class: "lb-tools" });
    const search = el("input", { type: "search", placeholder: "Find a handle", "aria-label": "Find a handle on this leaderboard" });
    search.addEventListener("input", () => { state.q = search.value; state.page = 1; renderTableArea(); });
    tools.append(search);

    const phases = Array.isArray(b.phases) ? b.phases : [];
    if (phases.length > 1) {
      const tg = el("div", { class: "toggle" });
      for (const p of phases) {
        const btn = el("button", {
          type: "button", "aria-pressed": String((phase || data.phase && data.phase.key || "dev") === p.key),
          onclick: async () => {
            if (state.phaseBusy) return;
            state.phaseBusy = true;
            try {
              const { body: next } = await getLeaderboard(slug, { phase: p.key, view });
              state.data = next;
              state.page = 1;
              for (const x of tg.children) x.setAttribute("aria-pressed", String(x === btn));
              renderTableArea();
            } catch { /* keep the current board */ }
            state.phaseBusy = false;
          },
        }, p.title || p.key);
        tg.append(btn);
      }
      tools.append(el("span", { class: "faint" }, "Phase"), tg);
    }
    const views = Array.isArray(data.views) ? data.views.filter((v) => v === "overall" || v === "performance") : [];
    if (views.length > 1) {
      const vg = el("div", { class: "toggle" });
      for (const v of views) {
        const btn = el("button", {
          type: "button", "aria-pressed": String((view || data.view || "performance") === v),
          onclick: async () => {
            const { body: next } = await getLeaderboard(slug, { phase: data.phase ? data.phase.key : phase, view: v });
            state.data = next;
            state.page = 1;
            for (const x of vg.children) x.setAttribute("aria-pressed", String(x === btn));
            renderTableArea();
          },
        }, v === "overall" ? "Overall" : "Performance");
        vg.append(btn);
      }
      tools.append(el("span", { class: "faint" }, "View"), vg);
    }

    const host = el("div", { id: "lb-table" });
    container.replaceChildren(head, tools, host);

    if (phaseInfo.scores_visible === false) {
      held(host);
    } else {
      renderTableArea();
    }
  } catch (err) {
    container.replaceChildren(el("div", { class: "err" },
      "Could not load this leaderboard. ", el("a", { href: "#/bounty/" + encodeURIComponent(slug) }, "Back to the bounty")));
    throw err;
  }
}

// ---- Top builders surface (#/builders) ----

function builderRank(rank) {
  const n = Number(rank);
  if (MEDALS[n]) return el("span", { class: "medal " + MEDALS[n], title: "#" + n + " place" }, String(n));
  return el("span", { class: "muted", style: "font-variant-numeric:tabular-nums;font-weight:700" }, "#" + num(rank));
}

function winRate(rec) {
  const entered = Number(rec.competitions_entered) || 0;
  const won = Number(rec.competitions_won) || 0;
  if (!entered) return "—";
  return pct((won / entered) * 100, 1);
}

export async function renderBuilders(container) {
  container.replaceChildren(el("div", { class: "loading" }, "Loading top builders…"));
  try {
    const { body } = await getTopBuilders();
    const items = Array.isArray(body.items) ? body.items : [];

    const head = el("div", { class: "lb-head" },
      el("h1", null, "Leaderboard"),
      el("div", { class: "muted", style: "font-size:13px;width:100%" }, "Top builders on make.fun"),
    );

    // The rankings API has no time dimension: the pills are visual only and
    // "All Time" stays selected. No data is invented.
    const filters = el("div", { class: "toggle", role: "group", "aria-label": "Time range" });
    for (const label of ["All Time", "This Month", "This Week"]) {
      filters.append(el("button", {
        type: "button",
        "aria-pressed": label === "All Time" ? "true" : "false",
        title: label === "All Time" ? "" : "Time filtering is unavailable from the API",
      }, label));
    }
    filters.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      for (const b2 of filters.children) b2.setAttribute("aria-pressed", String(b2 === btn));
    });

    const tbody = el("tbody");
    for (const row of items) {
      const rec = row.record || {};
      const img = row.image
        ? avatar(apiUrl(row.image), 26, row.handle)
        : el("span", { class: "avatar", "aria-hidden": "true", style: "display:inline-block;width:26px;height:26px" });
      tbody.append(el("tr", null,
        el("td", { class: "rank" }, builderRank(row.rank)),
        el("td", null, el("div", { class: "entrant" }, img,
          el("div", { class: "et" },
            el("a", { class: "h", href: "#/u/" + encodeURIComponent(row.handle) },
              row.display_name || ("@" + row.handle),
              row.verified === true ? el("span", { class: "chk", title: "Verified" }, " ✓") : null),
            el("div", { class: "ti" }, "@" + (row.handle || "")),
          ))),
        el("td", { class: "right" }, winRate(rec)),
        el("td", { class: "right hidesm muted", title: "Not provided by the API" }, "—"),
        el("td", { class: "right" }, num(rec.competitions_entered)),
        el("td", { class: "right" }, el("span", { class: "money" }, money(rec.prize_usd))),
        el("td", { class: "right" }, el("a", { class: "btn ghost sm", href: "#/u/" + encodeURIComponent(row.handle) }, "View")),
      ));
    }

    const table = el("table", null,
      el("thead", null, el("tr", null,
        el("th", null, "Rank"), el("th", null, "Builder"),
        el("th", { class: "right" }, "Win rate"), el("th", { class: "right hidesm" }, "90% CI"),
        el("th", { class: "right" }, "Entries"), el("th", { class: "right" }, "Rewards"),
        el("th", { class: "right" }, ""),
      )),
      tbody,
    );

    const frag = el("div", null,
      head,
      el("div", { class: "lb-tools" }, filters),
      items.length ? el("div", { class: "tablewrap" }, table) : el("div", { class: "empty" }, "No builders ranked yet."),
    );
    container.replaceChildren(frag);
  } catch {
    container.replaceChildren(el("div", { class: "err" }, "Could not load top builders."));
    throw new Error("builders failed");
  }
}

export function teardown() {
  state = null;
}
