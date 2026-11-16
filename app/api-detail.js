// api-detail.js — lazy endpoints for bounty, leaderboard and profile views.

import { fetchCached } from "./api.js";

const BASE = "https://make.fun/api";

export function getBounty(slug, opts = {}) {
  return fetchCached(BASE + "/competitions/" + encodeURIComponent(slug) + "?submissions=summary", {
    ttl: 300000,
    ...opts,
  });
}

/** ?rows=first: 10 whole rows + rank stubs, enough to render every row (70% smaller). */
export function getLeaderboard(slug, { phase, view, ...opts } = {}) {
  const q = new URLSearchParams({ rows: "first" });
  if (phase) q.set("phase", phase);
  if (view) q.set("view", view);
  return fetchCached(BASE + "/competitions/" + encodeURIComponent(slug) + "/leaderboard?" + q, {
    ttl: 60000,
    ...opts,
  });
}

export function getLive(slug, opts = {}) {
  return fetchCached(BASE + "/competitions/" + encodeURIComponent(slug) + "/live", { ttl: 60000, ...opts });
}

export function getProfile(handle, opts = {}) {
  const clean = String(handle || "").replace(/^@/, "");
  return fetchCached(BASE + "/profiles/" + encodeURIComponent(clean), { ttl: 300000, ...opts });
}

export function getTopBuilders(opts = {}) {
  return fetchCached(BASE + "/rankings?order=wins&limit=10", { ttl: 300000, ...opts });
}
