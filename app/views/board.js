// board.js — bounty board: compact hero, 4 stat cards, filters, dense table.
// One fetch (competitions?activity=times). Filtering, sorting and splitting are client-side.

import { getBoard, getTopBuilders, ApiError } from "../api.js";
import { money, money2, moneyShort, num, timeLeft, timeAgo, esc, el } from "../format.js";

const TAKING = "taking";
const CLOSED = "closed";
const OPENING = "opening";

let boardItems = [];
let filterState = { status: "all", fee: "any", sort: "closing", category: "all", q: "" };
let tableRoot = null;
let tickerTimer = null;
let tickerRotate = null;
let tickerEvents = [];
let tickerIndex = 0;
let knownCounts = new Map();
let tickerPrime = false;

export function classify(item, now = Date.now()) {
  const published = Date.parse(item.publishedAt || item.opensAt || 0);
  const deadline = Date.parse(item.deadline || 0);
  if (Number.isFinite(published) && published > now) return OPENING;
  if (Number.isFinite(deadline) && deadline <= now) return CLOSED;
  return TAKING;
}

export function paidPlaces(item) {
  if (Array.isArray(item.rewardsNow) && item.rewardsNow.length) return item.rewardsNow.length;
  if (item.rewards && typeof item.rewards === "object") return Object.keys(item.rewards).length;
  return 20;
}

export function valuePerEntry(item) {
  const pot = Number(item.potUsd) || 0;
  const places = paidPlaces(item);
  const entries = Number(item.submissionCount) || 0;
  if (!entries || !places) return 0;
  return pot / places / entries;
}

function isPaid(item) {
  return item.entryFeeUsd !== null && item.entryFeeUsd !== undefined && Number(item.entryFeeUsd) > 0;
}

function entryWindow(item) {
  const start = Date.parse(item.publishedAt || item.opensAt || 0);
  const end = Date.parse(item.deadline || 0);
  return { start, end, span: end - start };
}

function progress(item, now) {
  const { start, end, span } = entryWindow(item);
  if (!Number.isFinite(span) || span <= 0) return 100;
  return Math.max(0, Math.min(100, ((now - start) / span) * 100));
}

// ---- ticker --------------------------------------------------------------

function entryHandle(sub) {
  return sub.hunter || sub.handle || sub.author || sub.agent || "";
}

function recentEntries(items, limit = 6) {
  const out = [];
  for (const item of items) {
    const subs = Array.isArray(item.submissions) ? item.submissions : [];
    for (const sub of subs) {
      const at = sub.createdAt || sub.created_at;
      if (!at) continue;
      out.push({ at, handle: entryHandle(sub), title: item.title, slug: item.slug });
    }
  }
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out.slice(0, limit);
}

function tickerMarkup(events, now) {
  if (!events.length) return "Watching make.fun for new entries…";
  return events.map((e) => {
    const who = e.handle ? '<b>@' + esc(e.handle) + '</b> entered ' : 'New entry in ';
    return who + '<b>' + esc(e.title || e.slug) + '</b> · ' + timeAgo(e.at, now);
  }).join('<span class="ticker-sep">·</span>');
}

function paintTicker() {
  const node = document.getElementById("ticker-text");
  if (!node) return;
  if (!tickerEvents.length) { node.textContent = "Watching make.fun for new entries…"; return; }
  const now = Date.now();
  const one = tickerEvents[tickerIndex % tickerEvents.length];
  node.innerHTML = tickerMarkup([one], now);
}

function setTickerEvents(events) {
  tickerEvents = events;
  tickerIndex = 0;
  paintTicker();
}

export function primeTicker(items) {
  if (tickerPrime) return;
  tickerPrime = true;
  for (const it of items) knownCounts.set(it.slug, Number(it.submissionCount) || 0);
  setTickerEvents(recentEntries(items));
  if (tickerRotate) clearInterval(tickerRotate);
  tickerRotate = setInterval(() => {
    if (tickerEvents.length > 1) {
      tickerIndex = (tickerIndex + 1) % tickerEvents.length;
      paintTicker();
    }
  }, 6000);
}

export function startTicker() {
  if (tickerTimer) return;
  tickerTimer = setInterval(async () => {
    try {
      const { body } = await getBoard({ force: true });
      const items = Array.isArray(body.items) ? body.items : [];
      const fresh = [];
      for (const it of items) {
        const prev = knownCounts.get(it.slug);
        const count = Number(it.submissionCount) || 0;
        if (prev !== undefined && count > prev) {
          const subs = (it.submissions || []).filter((s) => Date.parse(s.createdAt || s.created_at) > Date.now() - 120000);
          if (subs.length) {
            for (const s of subs) fresh.push({ at: s.createdAt || s.created_at, handle: entryHandle(s), title: it.title, slug: it.slug });
          } else {
            fresh.push({ at: new Date().toISOString(), handle: "", title: it.title + " (" + (count - prev) + " new)", slug: it.slug });
          }
        }
        knownCounts.set(it.slug, count);
      }
      if (fresh.length) setTickerEvents(fresh.concat(tickerEvents).slice(0, 8));
      else if (!tickerEvents.length) setTickerEvents(recentEntries(items));
      else paintTicker();
      if (boardItems.length && items.length) { boardItems = items; renderTable(); }
    } catch { /* keep last ticker line */ }
  }, 60000);
}

export function stopTicker() {
  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = null;
}

// ---- rendering -----------------------------------------------------------

function boardStats(items) {
  const now = Date.now();
  const taking = items.filter((i) => classify(i, now) === TAKING);
  const totalBounties = items.length;
  const totalRewards = taking.reduce((s, i) => s + (Number(i.potUsd) || 0), 0);
  const totalEntries = taking.reduce((s, i) => s + (Number(i.submissionCount) || 0), 0);
  const closingSoon = taking.filter((i) => {
    const dl = Date.parse(i.deadline);
    return Number.isFinite(dl) && (dl - now) <= 86400000 && (dl - now) >= 0;
  }).length;
  return { totalBounties, totalRewards, totalEntries, closingSoon };
}

function boardHero() {
  const wrap = el("section", { class: "board-hero" });
  const left = el("div", null,
    el("h1", { class: "board-hero-title" }, "Discover & Compete on ", el("span", { class: "em" }, "make.fun"), " Bounties"),
    el("p", { class: "board-hero-sub" }, "Build amazing AI agents, win rewards, and climb the leaderboard."),
  );
  const right = el("div", { class: "board-hero-art", "aria-hidden": "true" });
  right.innerHTML = '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M5 4H3v2a4 4 0 0 0 4 4"/><path d="M19 4h2v2a4 4 0 0 1-4 4"/></svg>';
  wrap.append(left, right);
  return wrap;
}

function statCard(label, value, iconSvg) {
  const icon = el("div", { class: "stat-ico" });
  icon.innerHTML = iconSvg;
  return el("div", { class: "stat-card" },
    el("div", { class: "stat-top" }, icon, el("div", { class: "stat-label" }, label)),
    el("div", { class: "stat-value" }, value),
  );
}

function summaryStrip(items) {
  const stats = boardStats(items);
  const row = el("div", { class: "stat-row" });
  row.append(
    statCard("Total Bounties", num(stats.totalBounties),
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M5 4H3v2a4 4 0 0 0 4 4"/><path d="M19 4h2v2a4 4 0 0 1-4 4"/></svg>'),
    statCard("Total Rewards", moneyShort(stats.totalRewards),
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>'),
    statCard("Total Entries", num(stats.totalEntries),
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'),
    statCard("Closing Soon", num(stats.closingSoon),
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'),
  );
  return row;
}

function statusCounts(items) {
  const now = Date.now();
  const c = { all: items.length, taking: 0, closing: 0, closed: 0, opening: 0 };
  for (const it of items) {
    const k = classify(it, now);
    c[k] += 1;
    if (k === TAKING && Date.parse(it.deadline) - now <= 86400000) c.closing += 1;
  }
  return c;
}

function categoryCounts(items) {
  const map = new Map();
  for (const it of items) {
    const c = it.category || "Other";
    map.set(c, (map.get(c) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function applyFilters(items) {
  const now = Date.now();
  const q = filterState.q.trim().toLowerCase();
  return items.filter((it) => {
    const k = classify(it, now);
    if (filterState.status === "taking" && k !== TAKING) return false;
    if (filterState.status === "closing" && !(k === TAKING && Date.parse(it.deadline) - now <= 86400000)) return false;
    if (filterState.status === "closed" && k !== CLOSED) return false;
    if (filterState.fee === "free" && isPaid(it)) return false;
    if (filterState.fee === "paid" && !isPaid(it)) return false;
    if (filterState.category !== "all" && (it.category || "Other") !== filterState.category) return false;
    if (q) {
      const hay = (it.title + " " + (it.skills || []).join(" ") + " " + (it.sponsor ? it.sponsor.name : "") + " " + it.category).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sortItems(items) {
  const now = Date.now();
  const copy = items.slice();
  const s = filterState.sort;
  copy.sort((a, b) => {
    if (s === "pot") return (Number(b.potUsd) || 0) - (Number(a.potUsd) || 0);
    if (s === "entries") return (Number(b.submissionCount) || 0) - (Number(a.submissionCount) || 0);
    if (s === "value") return valuePerEntry(b) - valuePerEntry(a);
    const ad = Date.parse(a.deadline) || Infinity;
    const bd = Date.parse(b.deadline) || Infinity;
    const aPast = ad <= now, bPast = bd <= now;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return ad - bd;
  });
  return copy;
}

function feeCell(item) {
  if (isPaid(item)) return el("span", { class: "fee-paid", title: "Paid entry fee" }, "$" + Number(item.entryFeeUsd).toFixed(2));
  return el("span", { class: "fee-free" }, "FREE");
}

function timeCell(item, now) {
  const left = timeLeft(item.deadline, now);
  const p = progress(item, now);
  const closed = left === "closed";
  const bar = el("div", { class: "bar", title: "Elapsed share of the entry window" }, el("i", { class: closed ? "late" : "", style: "width:" + p.toFixed(1) + "%" }));
  return el("div", { class: "tleft" }, closed ? "closed" : left, bar);
}

function row(item, now) {
  const slug = item.slug;
  const pot = Number(item.potUsd) || 0;
  const fee = item.entryFeeUsd === null || item.entryFeeUsd === undefined ? 0 : Number(item.entryFeeUsd);
  const val = valuePerEntry(item);
  const paidRow = isPaid(item);
  const tr = el("tr", null,
    el("td", null,
      el("a", { class: "btitle", href: "#/bounty/" + encodeURIComponent(slug) }, esc(item.title || slug))),
    el("td", { class: "right" }, el("span", { class: "money paid" }, money2(pot))),
    feeCell(item),
    timeCell(item, now),
    el("td", { class: "right" }, num(Number(item.submissionCount) || 0)),
    el("td", { class: "right paid" }, el("span", { class: "money" }, money2(val))),
  );
  if (paidRow) tr.classList.add("paidrow");
  return tr;
}

function renderTable() {
  const now = Date.now();
  const items = sortItems(applyFilters(boardItems));
  const frag = document.createDocumentFragment();
  for (const it of items) frag.append(row(it, now));
  tableRoot.replaceChildren(frag);
  return frag.children.length;
}

function filtersBar(items) {
  const c = statusCounts(items);
  const frag = document.createDocumentFragment();
  const statusGroup = el("div", { class: "fgroup" }, el("span", { class: "flabel" }, "Status"));
  const statusOpts = [
    ["all", "All", c.all],
    ["taking", "Taking entries", c.taking],
    ["closing", "Closing soon", c.closing],
    ["closed", "Closed", c.closed],
  ];
  for (const [k, lab, count] of statusOpts) {
    const b = el("button", {
      class: "pill", type: "button", "data-st": k, "aria-pressed": String(filterState.status === k),
      onclick: () => { filterState.status = k; syncPills(statusGroup, "st", k); renderTable(); },
    }, lab, el("span", { class: "c" }, String(count)));
    statusGroup.append(b);
  }

  const feeGroup = el("div", { class: "fgroup" }, el("span", { class: "flabel" }, "Fee"));
  const feeOpts = [
    ["any", "Any", items.length],
    ["free", "Free", items.filter((i) => !isPaid(i)).length],
    ["paid", "Paid", items.filter((i) => isPaid(i)).length],
  ];
  for (const [k, lab, count] of feeOpts) {
    const b = el("button", {
      class: "pill", type: "button", "data-fee": k, "aria-pressed": String(filterState.fee === k),
      onclick: () => { filterState.fee = k; syncPills(feeGroup, "fee", k); renderTable(); },
    }, lab, el("span", { class: "c" }, String(count)));
    feeGroup.append(b);
  }

  const catGroup = el("div", { class: "fgroup" }, el("span", { class: "flabel" }, "Category"));
  const cats = categoryCounts(items);
  const allCat = el("button", {
    class: "pill", type: "button", "data-cat": "all", "aria-pressed": String(filterState.category === "all"),
    onclick: () => { filterState.category = "all"; syncPills(catGroup, "cat", "all"); renderTable(); },
  }, "All", el("span", { class: "c" }, String(items.length)));
  catGroup.append(allCat);
  for (const [cat, count] of cats) {
    const b = el("button", {
      class: "pill", type: "button", "data-cat": cat, "aria-pressed": String(filterState.category === cat),
      onclick: () => { filterState.category = cat; syncPills(catGroup, "cat", cat); renderTable(); },
    }, cat, el("span", { class: "c" }, String(count)));
    catGroup.append(b);
  }

  const sortWrap = el("div", { class: "fgroup" }, el("span", { class: "flabel" }, "Sort"));
  const sel = el("select", { class: "sort", "aria-label": "Sort bounties" },
    el("option", { value: "closing" }, "Closing soonest"),
    el("option", { value: "pot" }, "Biggest pot"),
    el("option", { value: "entries" }, "Most entries"),
    el("option", { value: "value" }, "Best value/entry"),
  );
  sel.value = filterState.sort;
  sel.addEventListener("change", () => { filterState.sort = sel.value; renderTable(); });
  sortWrap.append(sel);

  frag.append(statusGroup, feeGroup, catGroup, el("div", { class: "spacer" }), sortWrap);
  return frag;
}

function syncPills(group, attr, value) {
  for (const b of group.querySelectorAll(".pill")) {
    b.setAttribute("aria-pressed", String(b.getAttribute("data-" + attr) === value));
  }
}

export function setSearch(q) {
  filterState.q = q || "";
  renderTable();
}

// ---- entry points --------------------------------------------------------

export async function render(container, ctx = {}) {
  container.replaceChildren(el("div", { class: "loading" }, "Loading the board…"));
  try {
    const { body, stale, refreshFailed } = await getBoard();
    boardItems = Array.isArray(body.items) ? body.items : [];
    primeTicker(boardItems);
    startTicker();

    const hero = boardHero();
    const statsRow = summaryStrip(boardItems);
    const frag = document.createDocumentFragment();
    if (refreshFailed) frag.append(el("div", { class: "offline" }, "Could not refresh — showing the last cached board."));
    else if (stale) frag.append(el("div", { class: "offline" }, "Refreshing in the background — showing cached data."));
    frag.append(hero, statsRow, filtersBar(boardItems));
    tableRoot = el("div", { id: "board-table" });
    frag.append(tableRoot);
    container.replaceChildren(frag);
    renderTable();
    ctx.onLoaded && ctx.onLoaded(boardItems);
    return () => { tableRoot = null; };
  } catch (err) {
    const msg = err instanceof ApiError && err.status === 404 ? "The board endpoint returned 404." : "Could not reach make.fun. Check your connection and retry.";
    container.replaceChildren(el("div", { class: "err" }, msg + " ",
      el("button", { class: "pill", type: "button", onclick: () => render(container, ctx) }, "Retry")));
    throw err;
  }
}

/** Optional Top builders surface linked from the header. */
export async function renderBuilders(container) {
  container.replaceChildren(el("div", { class: "loading" }, "Loading top builders…"));
  try {
    const { body } = await getTopBuilders();
    const items = Array.isArray(body.items) ? body.items : [];
    const head = el("div", { class: "sechead" }, el("h1", null, "Top builders"), el("span", { class: "n" }, "by wins"));
    const list = el("div", { class: "builders" });
    for (const row of items) {
      const rec = row.record || {};
      list.append(el("div", { class: "brow" },
        el("span", { class: "r" }, "#" + num(row.rank)),
        el("div", { class: "g" },
          el("a", { class: "n", href: "#/u/" + encodeURIComponent(row.handle) }, row.display_name || row.handle),
          el("div", { class: "m" }, "@" + (row.handle || "") + " · " + num(rec.competitions_won) + " wins · " + num(rec.competitions_entered) + " entered · " + money(rec.prize_usd) + " prizes"),
        ),
      ));
    }
    if (!items.length) list.append(el("div", { class: "empty" }, "No builders ranked yet."));
    container.replaceChildren(head, list);
  } catch {
    container.replaceChildren(el("div", { class: "err" }, "Could not load top builders."));
    throw new Error("builders failed");
  }
}
