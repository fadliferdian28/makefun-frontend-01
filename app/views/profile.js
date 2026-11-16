// profile.js — lazy-loaded public profile: card layout with avatar/handle,
// three stat boxes, recent activity built from real solutions/payouts,
// entries table, payouts panel and a motivational strip.

import { getProfile } from "../api.js";
import { num, money2, pct, dateShort, profileScore, el, avatar, apiUrl, placeLabel } from "../format.js";

function svg(paths) {
  const ns = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(ns, "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.8");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("width", "16");
  node.setAttribute("height", "16");
  for (const d of paths) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    node.append(p);
  }
  return node;
}

const CHECK = ["M20 6L9 17l-5-5"];

function statBox(k, v, cls) {
  return el("div", { class: "p-stat" },
    el("div", { class: "k" }, k),
    el("div", { class: "v" + (cls ? " " + cls : "") }, v),
  );
}

function links(p) {
  const wrap = el("div", { class: "links" });
  if (p.github_login) wrap.append(el("a", { href: "https://github.com/" + encodeURIComponent(p.github_login), rel: "noopener" }, "GitHub"));
  if (p.discord && p.discord.url) wrap.append(el("a", { href: p.discord.url, rel: "noopener" }, "Discord"));
  if (p.x && p.x.url) wrap.append(el("a", { href: p.x.url, rel: "noopener" }, "X"));
  if (p.wallet && p.wallet.explorer_url) wrap.append(el("a", { href: p.wallet.explorer_url, rel: "noopener" }, "Wallet"));
  return wrap;
}

function entriesTable(p) {
  const rows = (p.solutions || []).slice().sort((a, b) => {
    const ap = a.placement === null || a.placement === undefined ? Infinity : Number(a.placement);
    const bp = b.placement === null || b.placement === undefined ? Infinity : Number(b.placement);
    if (ap !== bp) return ap - bp;
    return Date.parse(b.entered_at || 0) - Date.parse(a.entered_at || 0);
  });
  const tbody = el("tbody");
  for (const s of rows) {
    const comp = s.competition || {};
    const sc = s.score || {};
    const col = sc.column || {};
    const rawScore = sc.value !== null && sc.value !== undefined ? sc.value : sc.display;
    tbody.append(el("tr", null,
      el("td", null, el("a", { class: "btitle", href: "#/bounty/" + encodeURIComponent(comp.slug) }, comp.title || comp.slug || "—")),
      el("td", { class: "hidesm", style: "max-width:40ch" }, el("div", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: s.title || "" }, s.title || "—")),
      el("td", null, s.placement !== null && s.placement !== undefined ? "#" + num(s.placement) : "—"),
      el("td", { class: "right" }, s.prize_usd !== null && s.prize_usd !== undefined ? el("span", { class: "money" }, money2(s.prize_usd)) : "—"),
      el("td", { class: "right score" }, rawScore !== null && rawScore !== undefined && rawScore !== "" ? profileScore(rawScore, col) : "—"),
      el("td", { class: "hidesm muted", style: "white-space:nowrap;font-size:12px" }, dateShort(s.entered_at)),
    ));
  }
  return el("div", { class: "tablewrap" }, el("table", null,
    el("thead", null, el("tr", null,
      el("th", null, "Competition"), el("th", { class: "hidesm" }, "Entry"),
      el("th", null, "Place"), el("th", { class: "right" }, "Prize"),
      el("th", { class: "right" }, "Score"), el("th", { class: "hidesm" }, "Entered"),
    )),
    tbody,
  ));
}

function payoutsPanel(p) {
  const list = (p.payouts || []).slice().sort((a, b) => Date.parse(b.paid_at || 0) - Date.parse(a.paid_at || 0));
  const panel = el("div", { class: "panel" }, el("h2", null, "Payouts"));
  if (!list.length) {
    panel.append(el("div", { class: "muted", style: "font-size:12px" }, "No prizes paid yet."));
    return panel;
  }
  const tbody = el("tbody");
  for (const p2 of list) {
    const comp = p2.competition || {};
    tbody.append(el("tr", null,
      el("td", { class: "hidesm muted", style: "white-space:nowrap" }, dateShort(p2.paid_at)),
      el("td", null, placeLabel(p2.place)),
      el("td", null, el("a", { href: "#/bounty/" + encodeURIComponent(comp.slug) }, comp.title || comp.slug || "—")),
      el("td", { class: "right" }, el("span", { class: "money" }, money2(p2.amount_usd))),
      el("td", { class: "right" }, p2.explorer_url ? el("a", { href: p2.explorer_url, rel: "noopener", title: p2.signature || "" }, "tx ↗") : "—"),
    ));
  }
  panel.append(el("div", { class: "tablewrap" }, el("table", null,
    el("thead", null, el("tr", null,
      el("th", { class: "hidesm" }, "Date"), el("th", null, "Place"),
      el("th", null, "Competition"), el("th", { class: "right" }, "Amount"), el("th", { class: "right" }, "Tx"),
    )),
    tbody,
  )));
  return panel;
}

/** Recent activity from real solutions[] and payouts[] only. */
function recentActivity(p) {
  const events = [];
  for (const s of p.solutions || []) {
    const comp = s.competition || {};
    const at = s.entered_at || null;
    if (!at) continue;
    if (s.prize_usd !== null && s.prize_usd !== undefined && Number(s.prize_usd) > 0) {
      events.push({ kind: "payout", at, text: "Won " + (comp.title || comp.slug || "a bounty"), amount: s.prize_usd, href: comp.slug });
    } else {
      events.push({ kind: "entry", at, text: "Entered " + (comp.title || comp.slug || "a bounty"), href: comp.slug });
    }
  }
  for (const p2 of p.payouts || []) {
    const comp = p2.competition || {};
    const at = p2.paid_at || null;
    if (!at) continue;
    events.push({
      kind: "payout", at,
      text: "Won " + (comp.title || comp.slug || "a bounty"),
      amount: p2.amount_usd, href: comp.slug,
    });
  }
  events.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const seen = new Set();
  const unique = [];
  for (const e of events) {
    const key = e.kind + ":" + e.text + ":" + (e.amount || "");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  return unique.slice(0, 5);
}

function activityCard(p) {
  const card = el("div", { class: "act-card" }, el("h3", null, "Recent Activity"));
  const events = recentActivity(p);
  if (!events.length) {
    card.append(el("div", { class: "muted", style: "font-size:12px" }, "No activity yet."));
    return card;
  }
  const list = el("div", { class: "act-list" });
  for (const e of events) {
    list.append(el("div", { class: "act-item" },
      el("span", { class: "act-dot" + (e.kind === "payout" ? " payout" : "") }),
      el("div", { class: "act-t" },
        el("div", null, e.href ? el("a", { href: "#/bounty/" + encodeURIComponent(e.href) }, e.text) : e.text),
        el("div", { class: "act-m" }, e.kind === "payout" ? "Prize paid" : "Entry submitted"),
      ),
      el("span", { class: "act-x" },
        e.amount !== undefined && e.amount !== null ? el("span", { class: "money" }, money2(e.amount)) : dateShort(e.at)),
    ));
  }
  card.append(list);
  return card;
}

export async function render(container, ctx = {}) {
  const handle = (ctx.params && ctx.params.handle) || "";
  if (!handle) {
    container.replaceChildren(el("div", { class: "err" }, "No handle in this URL."));
    return;
  }
  container.replaceChildren(el("div", { class: "loading" }, "Loading profile…"));
  try {
    const { body: p } = await getProfile(handle);
    const rec = p.record || {};
    const imgSrc = apiUrl((p.avatar && (p.avatar.url_small || p.avatar.url)) || p.image);
    const name = p.display_name || p.handle || handle;

    const entered = Number(rec.competitions_entered) || 0;
    const won = Number(rec.competitions_won) || 0;
    const placed = Number(rec.competitions_placed) || 0;
    const hasRate = entered > 0 && rec.competitions_placed !== undefined && rec.competitions_placed !== null;

    const rank = p.rank || p.ranking || null;
    const points = (rank && (rank.points ?? rank.score)) ?? p.points ?? null;
    const topLine = points !== null
      ? el("div", { class: "muted", style: "font-size:12px" }, "Top Builder • " + num(points) + " points")
      : null;

    const verified = p.verified === true || (p.badges && Array.isArray(p.badges) && p.badges.includes("verified"));

    const leftCard = el("div", { class: "p-card" },
      el("div", { class: "p-av" }, avatar(imgSrc, 72, name)),
      el("div", { class: "p-name" }, name, verified ? el("span", { class: "chk", title: "Verified" }, svg(CHECK)) : null),
      el("div", { class: "p-handle" }, "@" + (p.handle || handle)),
      topLine,
      p.bio ? el("p", { class: "p-bio" }, p.bio) : null,
      el("div", { class: "muted", style: "font-size:12px;margin-top:6px" }, "Joined " + dateShort(p.joined_at)),
      links(p),
      p.wallet && p.wallet.address ? el("div", { class: "wallet mono", style: "margin-top:6px;font-size:11px;color:var(--muted);word-break:break-all" }, p.wallet.address) : null,
      el("div", { class: "p-btn" },
        el("a", { class: "btn", href: "https://make.fun/u/" + encodeURIComponent(p.handle || handle), rel: "noopener" }, "View on make.fun"),
      ),
      el("div", { class: "p-stats" },
        statBox("Entries", num(rec.competitions_entered)),
        hasRate ? statBox("Win Rate", pct((won / entered) * 100, 1)) : null,
        statBox("Total Rewards", money2(rec.prize_usd || 0), "money"),
      ),
    );

    const rightCard = activityCard(p);
    const grid = el("div", { class: "p-grid" }, leftCard, rightCard);

    const entries = el("div", { class: "panel" },
      el("h2", null, "Entries · " + num((p.solutions || []).length)),
      (p.solutions || []).length ? entriesTable(p) : el("div", { class: "muted", style: "font-size:12px" }, "No entries yet."),
    );

    const motiv = el("div", { class: "p-motiv" },
      el("div", { class: "t" }, "Keep building, keep competing!"),
      el("a", { class: "btn", href: "#/" }, "Explore Bounties"),
    );

    container.replaceChildren(grid, entries, payoutsPanel(p), motiv);
  } catch (err) {
    container.replaceChildren(el("div", { class: "err" },
      "No profile @" + handle + ". ", el("a", { href: "#/" }, "Back to the board")));
    throw err;
  }
}
