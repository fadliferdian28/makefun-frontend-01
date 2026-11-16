// bounty.js — bounty detail: emerald hero header, live stat strip, in-page
// tabs (Overview/Leaderboard/Rules/Rewards/Activity) and a rewards sidebar.

import { getBounty, getLive } from "../api-detail.js";
import { num, money2, esc, el } from "../format.js";
import {
  countdown, dateTimeShort, apiUrl, placeLabel, markdownToHtml,
} from "../format-detail.js";

let countdownTimer = null;

function svg(paths, extra) {
  const ns = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(ns, "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.8");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("aria-hidden", "true");
  if (extra) for (const [k, v] of Object.entries(extra)) node.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    node.append(p);
  }
  return node;
}

const ICONS = {
  pot: ["M4 7h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z", "M4 7l2-3h12l2 3", "M9 12h6"],
  fee: ["M12 2v20", "M17 6.5c0-1.7-2.2-3-5-3s-5 1.3-5 3 2.2 3 5 3 5 1.3 5 3-2.2 3-5 3-5-1.3-5-3"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  entries: ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  code: ["M8 9l-3 3 3 3", "M16 9l3 3-3 3", "M14 6l-4 12"],
  share: ["M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7", "M16 6l-4-4-4 4", "M12 2v13"],
  trophy: ["M8 21h8", "M12 17v4", "M7 4h10v5a5 5 0 0 1-10 0V4z", "M7 6H4a3 3 0 0 0 3 3", "M17 6h3a3 3 0 0 1-3 3"],
};

function statusOf(b) {
  const now = Date.now();
  const deadline = Date.parse(b.deadline || 0);
  const resolved = b.winner || b.status === "resolved" || b.resolvedAt;
  if (resolved) return { key: "resolved", label: "Resolved" };
  if (b.acceptingSubmissions === true && deadline > now) return { key: "live", label: "LIVE BOUNTY" };
  if (b.acceptingSubmissions === false && deadline > now) return { key: "closed", label: "CLOSED" };
  if (deadline > now) return { key: "live", label: "LIVE BOUNTY" };
  return { key: "closed", label: "CLOSED" };
}

function statCard(icon, k, v, sub, cls) {
  return el("div", { class: "stat-card" },
    el("div", { class: "icon" }, svg(ICONS[icon] || ICONS.pot)),
    el("div", { class: "st-body" },
      el("div", { class: "k" }, k),
      el("div", { class: "v" + (cls ? " " + cls : "") }, v),
      sub ? el("div", { class: "sub", style: "font-size:11px;color:var(--muted);margin-top:2px" }, sub) : null,
    ),
  );
}

function rewardsRows(b) {
  const rows = Array.isArray(b.rewardsNow) && b.rewardsNow.length
    ? b.rewardsNow
    : Object.entries(b.rewards || {}).map(([place, amount]) => ({ place: Number(place), baseUsd: String(amount), feeShareUsd: "0", amountUsd: String(amount) }));
  const list = rows.slice().sort((a, c) => Number(a.place) - Number(c.place));
  const max = list.reduce((m, r) => Math.max(m, Number(r.amountUsd) || 0), 0) || 1;
  return { list, max };
}

function rewardRow(r, max, index) {
  const amount = Number(r.amountUsd) || 0;
  const base = Number(r.baseUsd) || 0;
  const fee = Number(r.feeShareUsd) || 0;
  const total = amount || base + fee;
  const width = (total / max) * 100;
  const baseShare = total ? (base / total) * 100 : 100;
  const feeShare = total ? (fee / total) * 100 : 0;
  return el("tr", { class: index === 0 ? "place1" : "" },
    el("td", null, placeLabel(r.place)),
    el("td", { class: "right" }, money2(r.baseUsd)),
    el("td", { class: "right" }, money2(r.feeShareUsd)),
    el("td", { class: "right" }, el("span", { class: "money" }, money2(r.amountUsd))),
    el("td", { class: "hidesm", style: "width:38%" },
      el("div", { class: "rwbar", title: "Base " + money2(r.baseUsd) + " + fee share " + money2(r.feeShareUsd), style: "width:" + width.toFixed(1) + "%" },
        el("span", { class: "base", style: "width:" + baseShare.toFixed(2) + "%" }),
        el("span", { class: "fee", style: "width:" + feeShare.toFixed(2) + "%" }),
      )),
  );
}

function rewardsTable(b) {
  const { list, max } = rewardsRows(b);
  if (!list.length) return el("div", { class: "muted", style: "font-size:12px" }, "No rewards published.");
  const visible = list.slice(0, 10);
  const rest = list.slice(10);
  const tbody = el("tbody", null, ...visible.map((r, i) => rewardRow(r, max, i)));
  const restBody = el("tbody", { class: "rest", hidden: true }, ...rest.map((r, i) => rewardRow(r, max, i + 10)));
  const table = el("table", { class: "rw-table" },
    el("thead", null, el("tr", null,
      el("th", null, "Place"), el("th", { class: "right" }, "Base"),
      el("th", { class: "right" }, "Fee share"), el("th", { class: "right" }, "Pays now"),
      el("th", { class: "hidesm" }, "Share of pot"),
    )),
    tbody, restBody,
  );
  const wrap = el("div", null, el("div", { class: "tablewrap" }, table));
  if (rest.length) {
    const btn = el("button", { class: "pill", type: "button", style: "margin-top:8px" }, "Show all " + list.length + " places");
    btn.addEventListener("click", () => {
      const open = restBody.hidden;
      restBody.hidden = !open;
      btn.textContent = open ? "Show top 10 only" : "Show all " + list.length + " places";
    });
    wrap.append(btn);
  }
  return wrap;
}

function rewardsPanel(b) {
  const feeTotal = Number(b.entryFeesUsd) || 0;
  const baseTotal = Number(b.rewardAmount) || 0;
  return el("div", { class: "panel" },
    el("h2", null, "Rewards · live pot math"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px" },
      money2(baseTotal) + " base + " + money2(feeTotal) + " from " + num(b.entryFeePayers || 0) + " entry fees = ",
      el("span", { class: "money" }, money2(b.potUsd)),
    ),
    rewardsTable(b),
  );
}

function firstLine(b) {
  const text = String(b.summary || b.description || "").split(/\r?\n/)
    .map((s) => s.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  return text ? text.slice(0, 180) : "";
}

function deliverables(b) {
  const source = b.description || "";
  const items = [];
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (m) items.push(m[1].replace(/\*\*/g, "").trim());
  }
  if (!items.length && b.rules) {
    for (const line of String(b.rules).split(/\r?\n/)) {
      const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
      if (m) items.push(m[1].replace(/\*\*/g, "").trim());
    }
  }
  if (!items.length) return el("div", { class: "muted", style: "font-size:12px" }, "No deliverables listed.");
  return el("ul", { class: "checklist" }, ...items.slice(0, 10).map((t) => el("li", null, t)));
}

function activityPanel(rows) {
  const panel = el("div", { class: "panel" }, el("h2", null, "Recent activity"));
  if (!rows || !rows.length) {
    panel.append(el("div", { class: "muted", style: "font-size:12px" }, "No entries yet."));
    return panel;
  }
  const list = el("div", { class: "act-list" });
  for (const r of rows) {
    list.append(el("div", { class: "act-item" },
      el("span", { class: "act-dot" }),
      el("div", { class: "act-t" },
        el("div", null, "Entered ", el("a", { href: "#/u/" + encodeURIComponent(r.handle || "") }, "@" + (r.handle || "builder"))),
        el("div", { class: "act-m" }, r.title || r.entry_title || "Entry submitted"),
      ),
      el("span", { class: "act-x" }, r.received_at ? dateTimeShort(r.received_at) : ""),
    ));
  }
  panel.append(list);
  return panel;
}

function sidebar(b, st) {
  const rewards = b.rewardsNow || [];
  const first = rewards.length ? Math.max(...rewards.map((r) => Number(r.amountUsd) || 0)) : null;
  return el("div", { class: "side" },
    el("div", { class: "panel" },
      el("div", { class: "k muted", style: "font-size:11px;text-transform:uppercase;letter-spacing:.06em" }, "Live pot"),
      el("div", { class: "sp" }, money2(b.potUsd)),
      el("div", { class: "sd" }, "+ " + num(b.submissionCount) + " entries" + (first !== null ? " · top prize " + money2(first) : "")),
      el("div", { style: "margin-top:12px" },
        el("div", { class: "db" }, el("span", { class: "k" }, "Opens"), el("span", { class: "v" }, dateTimeShort(b.opensAt || b.publishedAt))),
        el("div", { class: "db" }, el("span", { class: "k" }, "Closes"), el("span", { class: "v" }, dateTimeShort(b.deadline))),
        el("div", { class: "db" }, el("span", { class: "k" }, "Status"),
          el("span", { class: "v", style: "display:inline-flex;align-items:center;gap:6px" },
            el("span", { class: "dot", style: "width:7px;height:7px;border-radius:50%;background:" + (st.key === "live" ? "var(--emerald-fill)" : "var(--faint)") }),
            st.key === "live" ? "Live" : st.label,
          )),
      ),
    ),
  );
}

function winnerPanel(b) {
  const w = b.winner;
  if (!w) return null;
  const handle = w.handle || w.entrant || "";
  const amount = w.amountUsd || w.amount_usd || w.prizeUsd || w.prize_usd || "";
  return el("div", { class: "winner" },
    el("div", { class: "k muted", style: "font-size:10px;text-transform:uppercase;letter-spacing:.06em" }, "Winner"),
    el("div", { class: "w" }, handle ? el("a", { href: "#/u/" + encodeURIComponent(handle) }, "@" + handle) : "—"),
    el("div", { style: "font-size:12px;margin-top:2px" },
      (w.title || w.entryTitle || "") + (w.placement ? " · " + placeLabel(w.placement) + " place" : "") + (amount ? " · " : ""),
      amount ? el("span", { class: "money" }, money2(amount)) : null,
    ),
    el("div", { style: "font-size:12px;margin-top:4px" },
      el("a", { href: "#/bounty/" + encodeURIComponent(b.slug) + "/leaderboard" }, "Final results →"),
    ),
  );
}

function tabButton(name, label, active) {
  return el("button", { type: "button", role: "tab", "aria-selected": active ? "true" : "false", "data-tab": name }, label);
}

function tabPanel(name, ...children) {
  return el("div", { class: "tab-panel", "data-panel": name, role: "tabpanel", hidden: name !== "overview" }, ...children);
}

export async function render(container, ctx = {}) {
  const slug = ctx.params && ctx.params.slug;
  if (!slug) {
    container.replaceChildren(el("div", { class: "err" }, "No bounty in this URL."));
    return;
  }
  container.replaceChildren(el("div", { class: "loading" }, "Loading bounty…"));
  if (countdownTimer) clearInterval(countdownTimer);

  try {
    const { body: b, stale, refreshFailed } = await getBounty(slug);
    const st = statusOf(b);
    const fee = b.entryFeeUsd === null || b.entryFeeUsd === undefined ? "FREE" : money2(b.entryFeeUsd);
    const isLive = st.key === "live";

    const head = el("div", { class: "bhero" },
      el("div", { class: "bh-text" },
        el("div", { class: "badges" },
          el("span", { class: isLive ? "livepill" : "closedpill" }, isLive ? "LIVE BOUNTY" : "CLOSED"),
          b.entryFeeUsd !== null && b.entryFeeUsd !== undefined && Number(b.entryFeeUsd) > 0 ? el("span", { class: "badge paid" }, "Paid entry") : null,
          b.category ? el("span", { class: "pillcat" }, b.category) : null,
        ),
        el("h1", null, b.title || slug),
        el("div", { class: "b-sub" }, firstLine(b) || "Build, compete, and win rewards on make.fun."),
      ),
      el("div", { class: "bh-icon" }, svg(ICONS.code, { stroke: "#fff" })),
    );

    const stats = el("div", { class: "statgrid" },
      statCard("pot", "Live pot", money2(b.potUsd), money2(b.rewardAmount) + " base + " + money2(b.entryFeesUsd) + " fees", "money"),
      statCard("fee", "Entry fee", fee, b.entryFeeUsd === null || b.entryFeeUsd === undefined ? "no fee to enter" : num(b.entryFeePayers || 0) + " paid entries"),
      statCard("clock", "Time left", el("span", { id: "stat-countdown" }, countdown(b.deadline)), "deadline " + dateTimeShort(b.deadline)),
      statCard("entries", "Entries", num(b.submissionCount), b.submissionsPassed !== undefined ? num(b.submissionsPassed) + " passed" : "accepted entries"),
    );

    const shareLabel = el("span", null, " Share");
    const shareBtn = el("button", { class: "btn ghost", type: "button", title: "Copy this page's URL" }, svg(ICONS.share, { width: "14", height: "14" }), shareLabel);
    shareBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        shareLabel.textContent = " Copied!";
      } catch {
        shareLabel.textContent = " Copy failed";
      }
      setTimeout(() => { shareLabel.textContent = " Share"; }, 1600);
    });

    const actions = el("div", { class: "actions" },
      el("a", { class: "btn", href: "https://make.fun/bounty/" + encodeURIComponent(slug), rel: "noopener" }, "Enter Bounty"),
      el("a", { class: "btn ghost", href: "#/bounty/" + encodeURIComponent(slug) + "/leaderboard" }, "View Leaderboard"),
      shareBtn,
      b.kit && b.kit.tarball ? el("a", { class: "btn link", href: apiUrl(b.kit.tarball), rel: "noopener" }, "Download kit") : null,
      b.url ? el("a", { class: "btn link", href: apiUrl(b.url), rel: "noopener" }, "View on make.fun") : null,
    );

    const overview = tabPanel("overview",
      el("div", { class: "panel" },
        el("h2", null, "About this bounty"),
        b.description ? el("div", { class: "desc md", html: markdownToHtml(b.description) }) : el("div", { class: "muted", style: "font-size:12px" }, "No description published."),
      ),
      el("div", { class: "panel" },
        el("h2", null, "Deliverables"),
        deliverables(b),
      ),
      rewardsPanel(b),
      winnerPanel(b) || "",
    );

    const leaderboardTab = tabPanel("leaderboard",
      el("div", { class: "panel" },
        el("h2", null, "Leaderboard"),
        el("p", { class: "muted", style: "font-size:12px" }, "See every ranked entry, prizes, and confidence intervals on the full board."),
        el("a", { class: "btn", href: "#/bounty/" + encodeURIComponent(slug) + "/leaderboard" }, "Open full leaderboard"),
      ),
    );

    const rulesTab = tabPanel("rules",
      el("div", { class: "panel" },
        el("h2", null, "Rules"),
        el("div", { class: "rulebody md", html: b.rules ? markdownToHtml(b.rules) : "No rules published." }),
      ),
    );

    const rewardsTab = tabPanel("rewards", rewardsPanel(b));

    const activityHost = tabPanel("activity");
    const activityBody = activityPanel(null);
    activityHost.append(activityBody);

    const tabs = el("div", { class: "tabs", role: "tablist" },
      tabButton("overview", "Overview", true),
      tabButton("leaderboard", "Leaderboard", false),
      tabButton("rules", "Rules", false),
      tabButton("rewards", "Rewards", false),
      tabButton("activity", "Activity", false),
    );
    const panels = el("div", null, overview, leaderboardTab, rulesTab, rewardsTab, activityHost);
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      const name = btn.getAttribute("data-tab");
      for (const b2 of tabs.children) b2.setAttribute("aria-selected", String(b2 === btn));
      for (const p of panels.children) p.hidden = p.getAttribute("data-panel") !== name;
    });

    const main = el("div", { class: "main" }, tabs, panels);
    const cols = el("div", { class: "cols" }, main, sidebar(b, st));

    const frag = document.createDocumentFragment();
    if (refreshFailed) frag.append(el("div", { class: "offline" }, "Could not refresh — showing the cached bounty."));
    frag.append(
      el("div", { class: "crumb" }, el("a", { href: "#/" }, "Board"), " / ", esc(b.category || "Bounty")),
      head, stats, actions, cols,
    );
    container.replaceChildren(frag);

    countdownTimer = setInterval(() => {
      const a = document.getElementById("stat-countdown");
      if (a) a.textContent = countdown(b.deadline);
    }, 1000);

    // Reuse the existing live-standings request for the Activity tab.
    try {
      const { body: live } = await getLive(slug);
      const rows = live && live.standings && Array.isArray(live.standings.rows) ? live.standings.rows.slice() : [];
      rows.sort((a, c) => Date.parse(c.received_at || 0) - Date.parse(a.received_at || 0));
      activityHost.replaceChildren(activityPanel(rows.slice(0, 5)));
    } catch {
      activityHost.replaceChildren(activityPanel([]));
    }
    if (stale) { /* already showing data */ }
    return () => { if (countdownTimer) clearInterval(countdownTimer); countdownTimer = null; };
  } catch (err) {
    const notFound = err && err.status === 404;
    container.replaceChildren(el("div", { class: "err" },
      notFound ? "No bounty with that slug. " : "Could not load this bounty. ",
      el("a", { href: "#/" }, "Back to the board")));
    throw err;
  }
}
