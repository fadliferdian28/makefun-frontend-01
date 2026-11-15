// profile.js — lazy-loaded public profile: header, 5 stat cards,
// entries table (best place first), payouts panel with explorer links.

import { getProfile } from "../api.js";
import { num, money, money2, dateShort, profileScore, el, avatar, apiUrl, placeLabel } from "../format.js";

function stat(k, v, cls) {
  return el("div", { class: "stat" }, el("div", { class: "k" }, k), el("div", { class: "v" + (cls ? " " + cls : "") }, v));
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
    const head = el("div", { class: "phead" },
      avatar(imgSrc, 64, p.display_name || p.handle),
      el("div", { class: "who" },
        el("h1", null, p.display_name || p.handle || handle),
        el("div", { class: "handle" }, "@" + (p.handle || handle)),
        p.bio ? el("p", { class: "bio" }, p.bio) : null,
        el("div", { class: "muted", style: "font-size:12px;margin-top:2px" }, "Joined " + dateShort(p.joined_at)),
        links(p),
        p.wallet && p.wallet.address ? el("div", { class: "wallet", style: "margin-top:6px" }, p.wallet.address) : null,
      ),
    );

    const stats = el("div", { class: "stats5" },
      stat("Entered", num(rec.competitions_entered)),
      stat("Placed", num(rec.competitions_placed)),
      stat("Won", num(rec.competitions_won)),
      stat("Best place", rec.best_placement ? "#" + num(rec.best_placement) : "—"),
      stat("Prizes", money2(rec.prize_usd || 0), "money"),
    );

    const entries = el("div", { class: "panel" },
      el("h2", null, "Entries · " + num((p.solutions || []).length)),
      (p.solutions || []).length ? entriesTable(p) : el("div", { class: "muted", style: "font-size:12px" }, "No entries yet."),
    );

    container.replaceChildren(head, stats, entries, payoutsPanel(p));
  } catch (err) {
    container.replaceChildren(el("div", { class: "err" },
      "No profile @" + handle + ". ", el("a", { href: "#/" }, "Back to the board")));
    throw err;
  }
}
