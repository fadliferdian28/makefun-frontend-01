// main.js — hash router, bootstrap, live clock, search, __shotReady flag.
// Static imports: board + bounty. Lazy: leaderboard + profile.

import { render as renderBoard, renderBuilders, setSearch, primeTicker, startTicker, stopTicker } from "./views/board.js";
import { render as renderBounty } from "./views/bounty.js";

const view = document.getElementById("view");
let cleanup = null;
let routeToken = 0;

window.__shotReady = false;

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(queryPart || "");
  if (!parts.length) return { name: "board", params: {}, query };
  if (parts[0] === "builders") return { name: "builders", params: {}, query };
  if (parts[0] === "bounty" && parts[1]) {
    if (parts[2] === "leaderboard") return { name: "leaderboard", params: { slug: parts[1] }, query };
    return { name: "bounty", params: { slug: parts[1] }, query };
  }
  if (parts[0] === "u" && parts[1]) return { name: "profile", params: { handle: parts[1] }, query };
  return { name: "notfound", params: {}, query };
}

function setNav(name) {
  for (const a of document.querySelectorAll("[data-nav]")) {
    if (a.dataset.nav === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

function setTitle(route) {
  if (route.name === "bounty") document.title = "Bounty · PotScope";
  else if (route.name === "leaderboard") document.title = "Leaderboard · PotScope";
  else if (route.name === "profile") document.title = "@" + route.params.handle + " · PotScope";
  else if (route.name === "builders") document.title = "Top builders · PotScope";
  else document.title = "PotScope — live make.fun bounty board";
}

function showLoading(name) {
  view.replaceChildren();
  const div = document.createElement("div");
  div.className = "loading";
  div.textContent = name === "profile" ? "Loading profile…" : name === "leaderboard" ? "Loading leaderboard…" : "Loading…";
  view.append(div);
}

function showError(message) {
  const div = document.createElement("div");
  div.className = "err";
  div.textContent = message;
  const a = document.createElement("a");
  a.href = "#/";
  a.textContent = "Go to the board";
  div.append(" ", a);
  view.replaceChildren(div);
}

async function route() {
  const token = ++routeToken;
  const r = parseHash();
  if (cleanup) {
    try { cleanup(); } catch { /* ignore */ }
    cleanup = null;
  }
  if (r.name !== "board") stopTicker();
  setNav(r.name === "builders" ? "builders" : "board");
  setTitle(r);

  window.__shotReady = false;

  if (r.name === "board") {
    try {
      cleanup = await renderBoard(view, { query: r.query });
      if (token === routeToken) window.__shotReady = true;
    } catch {
      if (token === routeToken) {
        showError("The board could not load. make.fun may be unreachable.");
        window.__shotReady = true;
      }
    }
    return;
  }

  if (r.name === "builders") {
    try {
      await renderBuilders(view);
    } catch {
      if (token === routeToken) showError("Top builders could not load.");
    }
    if (token === routeToken) window.__shotReady = true;
    return;
  }

  showLoading(r.name);

  if (r.name === "bounty") {
    try {
      cleanup = await renderBounty(view, { params: r.params, query: r.query });
    } catch {
      if (token === routeToken) {
        view.querySelector(".err") || showError("The bounty could not load.");
      }
    }
    if (token === routeToken) window.__shotReady = true;
    return;
  }

  if (r.name === "leaderboard" || r.name === "profile") {
    try {
      const mod = r.name === "leaderboard"
        ? await import("./views/leaderboard.js")
        : await import("./views/profile.js");
      if (token !== routeToken) return;
      const result = await mod.render(view, { params: r.params, query: r.query });
      if (typeof result === "function") cleanup = result;
      if (r.name === "leaderboard" && typeof mod.teardown === "function") {
        const prev = cleanup;
        cleanup = () => { if (prev) prev(); mod.teardown(); };
      }
    } catch {
      if (token === routeToken) {
        view.querySelector(".err") || showError(r.name === "profile" ? "No profile @ " + r.params.handle + "." : "The leaderboard could not load.");
      }
    }
    if (token === routeToken) window.__shotReady = true;
    return;
  }

  const box = document.createElement("div");
  box.className = "err";
  box.textContent = "Page not found. ";
  const a = document.createElement("a");
  a.href = "#/";
  a.textContent = "Back to the board";
  box.append(a);
  view.replaceChildren(box);
  window.__shotReady = true;
}

function startClock() {
  const node = document.getElementById("clock");
  if (!node) return;
  const tick = () => {
    const d = new Date();
    node.textContent = d.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" });
  };
  tick();
  setInterval(tick, 1000);
}

function wireSearch() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  if (!form || !input) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    if (raw.startsWith("@")) {
      location.hash = "#/u/" + encodeURIComponent(raw.slice(1));
      return;
    }
    const current = parseHash();
    if (current.name !== "board") {
      location.hash = "#/?q=" + encodeURIComponent(raw);
    } else {
      setSearch(raw);
    }
  });
  input.addEventListener("input", () => {
    if (parseHash().name === "board") setSearch(input.value);
  });
}

function boot() {
  startClock();
  wireSearch();
  window.addEventListener("hashchange", route);
  if (!location.hash) location.hash = "#/";
  route();
}

boot();
