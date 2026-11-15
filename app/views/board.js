// board.js — the bounty board: summary strip, live ticker, filters, table.
// One fetch (competitions?activity=times). Filtering, sorting and splitting are client-side.

import { getBoard, getTopBuilders, ApiError } from "../api.js";
import {
  money, money2, moneyShort, num, timeLeft, timeAgo, esc, el, avatar, apiUrl,
} from "../format.js";

const TAKING = "taking";
const CLOSING = "closing";
const CLOSED = "closed";
const OPENING = "opening";

let boardItems = [];
let filterState = { status: "all", fee: "any", sort: "closing", category: "all", q: "" };
let viewRoot = null;
let tableRoot = null;
let summaryRoot = null;
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

/** The computed signature number: (pot / paid places) / entries. */
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
    const who = e.handle ? '<b>@' + esc(e.handle) + "</b> entered " : "New entry in ";
    return who + "<b>" + esc(e.title || e.slug) + "</b> · " + timeAgo(e.at, now);
  }).join('<span class="ticker-sep">·</span>');
}

function paintTicker() {
  const node = document.getElementById("ticker-text");
  if (!node) return;
  if (!tickerEvents.length) {
    node.textContent = "Watching make.fun for new entries…";
    return;
  }
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

/** Poll the board every 60s and diff submissionCount per slug. */
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
      if (fresh.length) {
        setTickerEvents(fresh.concat(tickerEvents).slice(0, 8));
      } else if (!tickerEvents.length) {
        setTickerEvents(recentEntries(items));
      } else {
        paintTicker();
      }
      if (boardItems.length && items.length) {
        boardItems = items;
        renderTable();
      }
    } catch {
      /* keep the last ticker line on failure */
    }
  }, 60000);
}

export function stopTicker() {
  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = null;
}

// ---- rendering -----------------------------------------------------------

function summaryStrip(items) {
  const now = Date.now();
  const taking = items.filter((i) => classify(i, now) === TAKING);
  const pot = taking.reduce((s, i) => s + (Number(i.potUsd) || 0), 0);
  const entries = taking.reduce((s, i) => s + (Number(i.submissionCount) || 0), 0);
  const closing = taking.filter((i) => Date.parse(i.deadline) - now <= 86400000).length;
  const wrap = el("div", { class: "summary" });
  const part = (v, k, cls) => el("span", { class: "s" }, el("span", { class: "v" + (cls ? " " + cls : "") }, v), el("span", { class: "k" }, k));
  wrap.append(
    part(String(taking.length), "taking entries"),
    el("span", { class: "dot" }, "|"),
    part(moneyShort(pot), "in live pots", "money"),
    el("span", { class: "dot" }, "|"),
    part(num(entries), "total entries"),
    el("span", { class: "dot" }, "|"),
    part(String(closing), "closing in 24h"),
  );
  return wrap;
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
  const cat = item.category || "Other";
  const skills = (item.skills || []).slice(0, 3).map((s) => el("span", { class: "skill" }, s));
  const title = el("a", { class: "btitle", href: "#/bounty/" + encodeURIComponent(slug) }, item.title || slug);
  const meta = el("div", { class: "bmeta" }, el("span", { class: "pillcat" }, cat), ...skills);
  const v = valuePerEntry(item);
  const tr = el("tr", { class: isPaid(item) ? "row-paid" : "" },
    el("td", null, title, meta),
    el("td", { class: "right" }, el("span", { class: "money" }, money2(item.potUsd))),
    el("td", null, feeCell(item)),
    el("td", null, timeCell(item, now)),
    el("td", { class: "right" }, el("span", { class: "entries-n" }, num(item.submissionCount))),
    el("td", { class: "right" }, el("span", { class: "val", title: "Live pot ÷ paid places (" + paidPlaces(item) + ") ÷ entries (" + num(item.submissionCount) + ") = " + money2(v) + " per entry" }, money2(v))),
  );
  return tr;
}

function tableHead() {
  const thead = el("thead", null, el("tr", null,
    el("th", null, "Bounty"),
    el("th", { class: "right" }, "Live pot"),
    el("th", null, "Fee"),
    el("th", null, "Time left"),
    el("th", { class: "right" }, "Entries"),
    el("th", { class: "right", title: "Live pot ÷ number of paid places ÷ number of entries" }, "Value / entry"),
  ));
  return thead;
}

function section(title, sub, rows) {
  const head = el("div", { class: "sechead" }, el("h2", null, title), el("span", { class: "n" }, sub));
  const tbody = el("tbody", null, ...rows);
  const table = el("table", null, tableHead(), tbody);
  return [head, el("div", { class: "tablewrap" }, table)];
}

function renderTable() {
  if (!tableRoot) return;
  const now = Date.now();
  const filtered = applyFilters(boardItems);
  const nodes = [];
  const counts = statusCounts(boardItems);

  const live = sortItems(filtered.filter((i) => classify(i, now) === TAKING));
  const opening = sortItems(filtered.filter((i) => classify(i, now) === OPENING));
  const closed = sortItems(filtered.filter((i) => classify(i, now) === CLOSED));

  if (live.length) nodes.push(...section("Taking entries", live.length + " live · $" + moneyShort(live.reduce((s, i) => s + (Number(i.potUsd) || 0), 0)) + " in pots", live.map((i) => row(i, now))));
  if (opening.length) nodes.push(...section("Opening soon", "scheduled · " + opening.length, opening.map((i) => row(i, now))));
  if (closed.length) nodes.push(...section("Closed / awaiting results", closed.length + " past deadline", closed.map((i) => row(i, now))));

  if (!nodes.length) {
    nodes.push(el("div", { class: "empty" }, "No bounties match these filters."));
  }
  if (filterState.status === "all" && !live.length && !opening.length && !closed.length) {
    nodes.push(el("div", { class: "empty" }, "No bounties on the board right now."));
  }
  tableRoot.replaceChildren(...nodes);

  if (summaryRoot) summaryRoot.replaceWith(summaryStrip(boardItems));
  const strip = document.querySelector(".summary");
  if (strip) summaryRoot = strip;
  const allBtn = document.querySelector('.fgroup .pill[data-status="all"]');
  if (allBtn) {
    const c = allBtn.querySelector(".c");
    if (c) c.textContent = String(counts.all);
  }
}

function filtersBar(items) {
  const counts = statusCounts(items);
  const frag = el("div", { class: "filters" });

  const statusGroup = el("div", { class: "fgroup" }, el("span", { class: "flabel" }, "Status"));
  const statuses = [
    ["all", "All", counts.all],
    ["taking", "Taking entries", counts.taking],
    ["closing", "Closing soon", counts.closing],
    ["closed", "Closed", counts.closed],
  ];
  for (const [key, label, count] of statuses) {
    const b = el("button", {
      class: "pill", type: "button", "data-status": key,
      "aria-pressed": String(filterState.status === key),
      onclick: () => { filterState.status = key; syncPills(statusGroup, "status", key); renderTable(); },
    }, label, el("span", { class: "c" }, String(count)));
    statusGroup.append(b);
  }

  const feeGroup = el("div", { class: "fgroup" }, el("span", { class: "flabel" }, "Fee"));
  for (const [key, label] of [["any", "Any"], ["free", "Free"], ["paid", "Paid"]]) {
    const b = el("button", {
      class: "pill", type: "button", "data-fee": key, "aria-pressed": String(filterState.fee === key),
      onclick: () => { filterState.fee = key; syncPills(feeGroup, "fee", key); renderTable(); },
    }, label);
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
  viewRoot = container;
  const hash = location.hash.replace(/^#/, "");
  const qp = hash.split("?")[1] || "";
  const params = new URLSearchParams(qp);
  filterState.q = params.get("q") || filterState.q || "";

  container.replaceChildren(el("div", { class: "loading" }, "Loading the board…"));
  try {
    const { body, stale, refreshFailed } = await getBoard();
    boardItems = Array.isArray(body.items) ? body.items : [];
    primeTicker(boardItems);
    startTicker();

    summaryRoot = summaryStrip(boardItems);
    const frag = document.createDocumentFragment();
    if (refreshFailed) frag.append(el("div", { class: "offline" }, "Could not refresh — showing the last cached board."));
    else if (stale) frag.append(el("div", { class: "offline" }, "Refreshing in the background — showing cached data."));
    frag.append(summaryRoot, filtersBar(boardItems));
    tableRoot = el("div", { id: "board-table" });
    frag.append(tableRoot);
    container.replaceChildren(frag);
    renderTable();
    if (filterState.q) {
      const input = document.getElementById("search-input");
      if (input) input.value = filterState.q;
    }
    ctx.onLoaded && ctx.onLoaded(boardItems);
    return () => { tableRoot = null; summaryRoot = null; viewRoot = null; };
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
      const img = avatar(apiUrl((row.avatar && (row.avatar.url_small || row.avatar.url)) || row.image), 32, row.handle);
      list.append(el("div", { class: "brow" },
        el("span", { class: "r" }, "#" + num(row.rank)),
        img,
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
