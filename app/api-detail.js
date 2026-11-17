/**
 * Endpoint helpers used only by the detail surfaces: the full bounty page,
 * the leaderboard and the profile. They are loaded lazily with those views.
 *
 * @module api-detail
 */

import { getBounty, getLeaderboard, getProfile } from './api.js';

/**
 * A competition's detail together with its leaderboard, fetched once each so
 * the full page and its activity tab share one round trip per surface.
 * @param {string} slug Competition slug.
 * @returns {Promise<{bounty: any, leaderboard: any, stale: boolean}>}
 */
export async function getBountyWithLeaderboard(slug) {
  const [bounty, leaderboard] = await Promise.all([getBounty(slug), getLeaderboard(slug)]);
  return { bounty: bounty.data, leaderboard: leaderboard.data, stale: bounty.stale || leaderboard.stale };
}

/**
 * A profile plus nothing else: the profile payload already carries its
 * solutions and payouts, so one request fills the whole page.
 * @param {string} handle Account handle.
 * @returns {Promise<import('./api.js').ApiResult>}
 */
export function getBuilderProfile(handle) {
  return getProfile(handle);
}

export { getBounty, getLeaderboard, getProfile };
