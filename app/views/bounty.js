// bounty.js — bounty detail: stat cards, rewards table with fee-share bars,
// dates timeline, judging, top-5 preview, rules, winner card.

import { getBounty, getLive } from "../api.js";
import {
  money, money2, num, countdown, dateShort, dateTimeShort, timeShort, score,
  esc, el, avatar, apiUrl, placeLabel, markdownToHtml,
} from "../format.js";

let countdownTimer = null;

function statusOf(b) {
  const now = Date.now();
  const deadline = Date.parse(b.deadline || 0);
  const resolved = b.winner || b.status === "resolved" || b.resolvedAt;
  if (resolved) return { key: "resolved", label: "Resolved" };
  if (b.acceptingSubmissions === true && deadline > now) return { key: "live", label: "Takes entries" };
  if (b.acceptingSubmissions === false && deadline > now) return { key: "closed", label: "Closed" };
  if (deadline > now) return { key: "live", label: "Takes entries" };
  return { key: "closed", label: "Closed" };
}

function statCard(k, v, sub, cls) {
  return el("div", { class: "stat" },
    el("div", { class: "k" }, k),
    el("div", { class: "v" + (cls ? " " + cls : "") }, v),
    sub ? el("div", { class: "sub" }, sub) : null,
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
  const tr = el("tr", { class: index === 0 ? "place1" : "" },
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
  return tr;
}

function rewardsPanel(b) {
  const { list, max } = rewardsRows(b);
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
  const feeTotal = Number(b.entryFeesUsd) || 0;
  const baseTotal = Number(b.rewardAmount) || 0;
  const math = el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px" },
    money2(baseTotal) + " base + " + money2(feeTotal) + " from " + num(b.entryFeePayers || 0) + " entry fees = ",
    el("span", { class: "money" }, money2(b.potUsd)),
  );
  const panel = el("div", { class: "panel" },
    el("h2", null, "Rewards · live pot math"),
    math,
    el("div", { class: "tablewrap" }, table),
  );
  if (rest.length) {
    const btn = el("button", { class: "pill", type: "button", style: "margin-top:8px" }, "Show all " + list.length + " places");
    btn.addEventListener("click", () => {
      const open = restBody.hidden;
      restBody.hidden = !open;
      btn.textContent = open ? "Show top 10 only" : "Show all " + list.length + " places";
    });
    panel.append(btn);
  }
  return panel;
}

function timelinePanel(b) {
  const now = Date.now();
  const phases = Array.isArray(b.phases) ? b.phases : [];
  const opened = b.opensAt || b.publishedAt;
  const finalPhase = phases.find((p) => p.key === "final") || phases[phases.length - 1];
  const rows = [];
  const tl = (title, when, detail, state) => el("div", { class: "tl " + (state || "") },
    el("span", { class: "dotl" }),
    el("div", null,
      el("div", { class: "t" }, title),
      el("div", { class: "d" }, when + (detail ? " · " + detail : "")),
    ),
  );
  if (opened) rows.push(tl("Opened", dateTimeShort(opened), "", Date.parse(opened) <= now ? "done" : ""));
  rows.push(tl("Deadline", dateTimeShort(b.deadline), Date.parse(b.deadline) > now ? "entries close" : "entries closed", Date.parse(b.deadline) <= now ? "done" : "now"));
  if (finalPhase && finalPhase.endsAt) rows.push(tl("Results by", dateTimeShort(finalPhase.endsAt), "final window ends", Date.parse(finalPhase.endsAt) <= now ? "done" : ""));
  const phaseList = el("div", { class: "timeline", style: "margin-top:10px" });
  for (const p of phases) {
    const state = Date.parse(p.startsAt) <= now && (!p.endsAt || Date.parse(p.endsAt) > now) ? "now" : Date.parse(p.endsAt || 0) <= now ? "done" : "";
    phaseList.append(tl(
      (p.title || p.key) + (p.scores === "live" ? " · scores live" : p.scoresVisible ? "" : " · scores held"),
      (p.startsAt ? timeShort(p.startsAt) : "—") + " → " + (p.endsAt ? timeShort(p.endsAt) : "—"),
      p.scores === "live" ? "scored as entries arrive" : "scored after finalize",
      state,
    ));
  }
  return el("div", { class: "panel" },
    el("h2", null, "Dates"),
    el("div", { class: "timeline" }, ...rows),
    phaseList,
  );
}

function judgedPanel(b) {
  const res = b.resolution || {};
  const criteria = Array.isArray(res.criteria) ? res.criteria : [];
  const metric = res.metric || {};
  return el("div", { class: "panel judge" },
    el("h2", null, "How it is judged"),
    el("p", { class: "lede" }, res.summary || "No judging notes published."),
    criteria.length ? el("ul", null, ...criteria.slice(0, 8).map((c) => el("li", null, c))) : null,
    el("div", { class: "metric" },
      "Metric: ", el("b", null, metric.name || b.leaderboard && b.leaderboard.rankKey || "Score"),
      metric.unit ? " (" + metric.unit + ", " + (metric.better || "higher") + " is better)" : "",
    ),
  );
}

function livePreview(b, live, onLoaded) {
  const panel = el("div", { class: "panel" },
    el("div", { style: "display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap" },
      el("h2", null, "Top 5 entries"),
      el("a", { href: "#/bounty/" + encodeURIComponent(b.slug) + "/leaderboard", style: "font-size:12px" }, "Full leaderboard →"),
    ),
  );
  const standings = live && live.standings ? live.standings : null;
  if (!standings) {
    panel.append(el("div", { class: "loading", style: "padding:10px" }, "Loading standings…"));
    return panel;
  }
  if (standings.scores_visible === false || !standings.rows || !standings.rows.length) {
    panel.append(el("div", { class: "held", style: "margin:6px 0" }, "Scores held until the final run."));
    return panel;
  }
  const metricName = standings.rank_key_title || (b.resolution && b.resolution.metric && b.resolution.metric.name) || "";
  const unit = b.resolution && b.resolution.metric ? b.resolution.metric.unit : "";
  const table = el("table", { class: "mini" },
    el("thead", null, el("tr", null,
      el("th", null, "Rank"), el("th", null, "Entrant"), el("th", null, "Entry"),
      el("th", { class: "right" }, metricName || "Score"),
    )),
    el("tbody", null, ...standings.rows.slice(0, 5).map((r) => el("tr", null,
      el("td", { class: "rank" }, "#" + num(r.rank)),
      el("td", null, el("a", { href: "#/u/" + encodeURIComponent(r.handle) }, "@" + (r.handle || ""))),
      el("td", { class: "hidesm", style: "max-width:38ch" }, r.title || "—"),
      el("td", { class: "right score" }, score(r.value, metricName, unit)),
    ))),
  );
  panel.append(el("div", { class: "tablewrap" }, table));
  if (onLoaded) onLoaded();
  return panel;
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
    const liveEl = el("div", { id: "bounty-countdown" }, countdown(b.deadline));
    const head = el("div", null,
      el("div", { class: "crumb" }, el("a", { href: "#/" }, "Board"), " / ", esc(b.category || "Bounty")),
      el("div", { class: "bhead" },
        el("h1", null, b.title || slug),
        el("span", { class: "badge " + st.key }, st.label),
        b.entryFeeUsd !== null && b.entryFeeUsd !== undefined && Number(b.entryFeeUsd) > 0 ? el("span", { class: "badge paid" }, "Paid entry") : null,
      ),
      el("div", { class: "muted", style: "font-size:12px" },
        "by " + (b.sponsor ? b.sponsor.name : "make.fun"),
        b.skills && b.skills.length ? " · " + b.skills.join(" · ") : "",
        " · " + num(b.submissionCount) + " entries",
      ),
    );

    const stats = el("div", { class: "stats" },
      statCard("Live pot", money2(b.potUsd), money2(b.rewardAmount) + " base + " + money2(b.entryFeesUsd) + " fees", "money"),
      statCard("Entry fee", fee, b.entryFeeUsd === null ? "no fee to enter" : num(b.entryFeePayers || 0) + " paid entries"),
      statCard("Time left", "", "", ""),
      statCard("Entries", num(b.submissionCount), b.submissionsPassed !== undefined ? num(b.submissionsPassed) + " passed" : "accepted entries"),
    );
    stats.children[2].replaceChildren(el("div", { class: "k" }, "Time left"), el("div", { class: "v", id: "stat-countdown" }, countdown(b.deadline)), el("div", { class: "sub" }, "deadline " + dateTimeShort(b.deadline)));

    const actions = el("div", { class: "actions" },
      el("a", { class: "btn", href: "https://make.fun/bounty/" + encodeURIComponent(slug), rel: "noopener" }, "Enter on make.fun"),
      el("a", { class: "btn ghost", href: "#/bounty/" + encodeURIComponent(slug) + "/leaderboard" }, "Leaderboard"),
      b.kit && b.kit.tarball ? el("a", { class: "btn link", href: apiUrl(b.kit.tarball), rel: "noopener" }, "Download kit") : null,
      b.url ? el("a", { class: "btn link", href: apiUrl(b.url), rel: "noopener" }, "View on make.fun") : null,
    );

    const intro = el("div", null,
      b.summary ? el("p", { class: "lede" }, b.summary) : null,
      b.description ? el("div", { class: "desc md", html: markdownToHtml(b.description) }) : null,
    );

    const previewHost = el("div", null, livePreview(b, null));
    const rules = el("details", { class: "rules" },
      el("summary", null, "Rules (" + ((b.rules || "").length ? num(b.rules.length) + " characters" : "full text") + ")"),
      el("div", { class: "rulebody md", html: b.rules ? markdownToHtml(b.rules) : "No rules published." }),
    );

    const frag = document.createDocumentFragment();
    if (refreshFailed) frag.append(el("div", { class: "offline" }, "Could not refresh — showing the cached bounty."));
    frag.append(head, stats, actions, intro, winnerPanel(b) || "", rewardsPanel(b), el("div", { class: "cols" }, timelinePanel(b), judgedPanel(b)), previewHost, rules);
    container.replaceChildren(frag);

    countdownTimer = setInterval(() => {
      const a = document.getElementById("stat-countdown");
      if (a) a.textContent = countdown(b.deadline);
      const c = document.getElementById("bounty-countdown");
      if (c) c.textContent = countdown(b.deadline);
    }, 1000);

    // Second request only for the top-5 standings strip.
    try {
      const { body: live } = await getLive(slug);
      const fresh = livePreview(b, live);
      previewHost.replaceChildren(fresh);
    } catch {
      previewHost.replaceChildren(el("div", { class: "panel" },
        el("h2", null, "Top 5 entries"),
        el("div", { class: "muted", style: "font-size:12px" }, "Standings unavailable right now.")));
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
