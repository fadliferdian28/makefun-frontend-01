// Detail-view data access. The base client in api.js already knows how to
// fetch and cache each endpoint; this module turns the raw payloads the
// leaderboard, top-builders, and profile views share into flat rows.

import { fetchLeaderboard, fetchProfile, fetchRankings, LIST_FRESH_MS, fetchCached, leaderboardUrl } from './api.js';
import { parseAmount } from './format.js';
import { asList, pickFirst, toFiniteNumber } from './views/common.js';

function firstRowArray(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function readRankKey(payload) {
  return String(pickFirst(payload, ['rank_key', 'rankKey', 'metric']) ?? '');
}

export function readColumns(payload) {
  return asList(pickFirst(payload, ['columns', 'column_list', 'columnList']));
}

// The first-rows leaderboard response carries whole rows and rank-only stubs.
// Merge both, keep one row per rank, drop unranked rows, and sort by rank.
export function mergeLeaderboardRows(payload) {
  const whole = firstRowArray(payload, ['entries', 'rows', 'items']);
  const stubs = firstRowArray(payload, ['rest', 'stubs', 'stub_entries', 'stubEntries', 'remaining']);
  const byRank = new Map();
  for (const row of whole) {
    const rank = toFiniteNumber(pickFirst(row, ['rank', 'position']));
    if (rank !== null && rank > 0) byRank.set(rank, { ...row, rank, stub: false });
  }
  for (const row of stubs) {
    const rank = toFiniteNumber(pickFirst(row, ['rank', 'position']));
    if (rank !== null && rank > 0 && !byRank.has(rank)) byRank.set(rank, { ...row, rank, stub: true });
  }
  return [...byRank.values()].sort((left, right) => left.rank - right.rank);
}

// Prize dollars keyed by prize place. The live rewardsNow list carries the
// total each place pays now; the base rewards map is the fallback.
export function buildPrizeIndex(rewards) {
  const index = new Map();
  if (Array.isArray(rewards)) {
    for (const reward of rewards) {
      const place = toFiniteNumber(reward?.place);
      const amount = parseAmount(reward?.amountUsd);
      if (place !== null && amount !== null) index.set(place, amount);
    }
    return index;
  }
  if (rewards && typeof rewards === 'object') {
    for (const [place, amount] of Object.entries(rewards)) {
      const parsedPlace = toFiniteNumber(place);
      const parsedAmount = parseAmount(amount);
      if (parsedPlace !== null && parsedAmount !== null) index.set(parsedPlace, parsedAmount);
    }
  }
  return index;
}

export function prizeForRow(row, prizeIndex) {
  if (!prizeIndex || prizeIndex.size === 0) return null;
  const place = toFiniteNumber(pickFirst(row, ['prize_rank', 'prizeRank']));
  return place === null ? null : prizeIndex.get(place) ?? null;
}

function recordOf(profile) {
  const record = pickFirst(profile, ['record', 'stats', 'counts']);
  return record && typeof record === 'object' ? record : {};
}

export function readProfileCard(payload) {
  const profile = pickFirst(payload, ['profile', 'user', 'account']) ?? payload ?? {};
  const record = recordOf(profile);
  return {
    handle: String(pickFirst(profile, ['handle', 'username', 'login']) ?? ''),
    displayName: pickFirst(profile, ['display_name', 'displayName', 'name']) ?? null,
    bio: pickFirst(profile, ['bio', 'description']) ?? null,
    image: pickFirst(profile, ['image']) ?? pickFirst(profile?.avatar ?? {}, ['url', 'url_small']) ?? pickFirst(profile, ['avatar_url', 'avatarUrl']) ?? '',
    github: pickFirst(profile, ['github', 'github_login', 'githubLogin']) ?? null,
    discord: pickFirst(profile, ['discord', 'discord_url', 'discordUrl']) ?? null,
    x: pickFirst(profile, ['x', 'x_handle', 'xHandle', 'twitter']) ?? null,
    wallet: pickFirst(profile, ['wallet', 'wallet_address', 'walletAddress']) ?? null,
    walletUrl: pickFirst(profile, ['wallet_url', 'walletUrl', 'explorer', 'explorer_url', 'explorerUrl']) ?? pickFirst(profile?.wallet ?? {}, ['explorer_url', 'explorerUrl']) ?? null,
    joined: pickFirst(profile, ['joined_at', 'joinedAt', 'created_at', 'createdAt']) ?? null,
    record: {
      entered: toFiniteNumber(pickFirst(record, ['competitions_entered', 'entered', 'entries'])),
      placed: toFiniteNumber(pickFirst(record, ['competitions_placed', 'placed'])),
      won: toFiniteNumber(pickFirst(record, ['competitions_won', 'won', 'wins'])),
      podiums: toFiniteNumber(pickFirst(record, ['podium_finishes', 'podiums', 'podium'])),
      best: toFiniteNumber(pickFirst(record, ['best_placement', 'bestPlacement', 'best'])),
      rewards: parseAmount(pickFirst(record, ['prize_usd', 'prize_dollars', 'rewards', 'total_rewards', 'prizes'])),
    },
    solutions: asList(pickFirst(profile, ['solutions', 'entries', 'submissions'])),
    payouts: asList(pickFirst(profile, ['payouts', 'prizes', 'payments'])),
  };
}

export function readBuilderRows(payload) {
  return firstRowArray(payload, ['rankings', 'items', 'entries', 'rows', 'builders']);
}

export async function loadLeaderboard(slug, options) {
  const result = await fetchLeaderboard(slug, options);
  if (!result.data) return { ...result, board: null };
  const payload = result.data;
  return {
    ...result,
    board: {
      rankKey: readRankKey(payload),
      columns: readColumns(payload),
      rows: mergeLeaderboardRows(payload),
      scoresVisible: pickFirst(payload, ['scores_visible', 'scoresVisible', 'scores_live', 'scoresLive']) !== false,
      views: asList(pickFirst(payload, ['views', 'view_options', 'viewOptions'])),
      total: toFiniteNumber(pickFirst(payload, ['total', 'total_rows', 'totalRows', 'count'])),
    },
  };
}

export async function loadProfile(handle, options) {
  const result = await fetchProfile(handle, options);
  return { ...result, card: result.data ? readProfileCard(result.data) : null };
}

export async function loadBuilders(options) {
  const result = await fetchRankings(options);
  return { ...result, rows: result.data ? readBuilderRows(result.data) : [] };
}

// A leaderboard refresh for a view that already holds rows: revalidate the
// same address without blocking, then merge the newest payload.
export async function refreshLeaderboard(slug) {
  const result = await fetchCached(leaderboardUrl(slug), { ttl: LIST_FRESH_MS });
  return result.data ? { ...result, board: {
    rankKey: readRankKey(result.data),
    columns: readColumns(result.data),
    rows: mergeLeaderboardRows(result.data),
  } } : result;
}
