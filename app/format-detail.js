/**
 * Formatting helpers used only by the profile, leaderboard and bounty detail
 * surfaces. Loaded lazily with them so the board's first paint stays small.
 *
 * @module format-detail
 */

import { formatNumber, formatScore, toNumber } from './format.js';

const DASH = '—';
const MEDAL_LABELS = ['Gold', 'Silver', 'Bronze'];
const SCORE_COLUMN = /judge|elo|score|loss|value|metric|accuracy|profit/i;

/**
 * The name and unit a leaderboard's score column carries, read from the
 * response rather than assumed: the rank key, or the first score-like column.
 * @param {{rank_key?: string, rankKey?: string, columns?: Array<{key?: string, title?: string, sorting?: string, unit?: string}>}|null} leaderboard
 * @returns {{key: string, title: string, unit: string}}
 */
export function describeScoreColumn(leaderboard) {
  const columns = Array.isArray(leaderboard?.columns) ? leaderboard.columns : [];
  const key = leaderboard?.rank_key ?? leaderboard?.rankKey ?? '';
  const match = columns.find((column) => column?.key === key)
    ?? columns.find((column) => SCORE_COLUMN.test(String(column?.key ?? '')))
    ?? columns[0]
    ?? {};
  return {
    key: String(match.key ?? key ?? 'score'),
    title: String(match.title ?? 'Score'),
    unit: String(match.unit ?? ''),
  };
}

/**
 * Format a leaderboard value by the column descriptor: judge win rates are
 * millionths, and the descriptor's unit decides how the rest render.
 * @param {string|number|null|undefined} value
 * @param {{key?: string, title?: string, unit?: string}|null} metric
 * @returns {string}
 */
export function formatRankValue(value, metric) {
  return formatScore(value, metric);
}

/**
 * The 90 percent interval under a score, low to high.
 * @param {{low?: string|number|null, high?: string|number|null}|null|undefined} interval
 * @param {{key?: string, title?: string, unit?: string}|null} metric
 * @returns {string}
 */
export function formatInterval(interval, metric) {
  const low = toNumber(interval?.low);
  const high = toNumber(interval?.high);
  if (low === null && high === null) return '';
  return `${formatScore(low, metric)} – ${formatScore(high, metric)}`;
}

/**
 * Which medal class a rank earns, if any.
 * @param {number|null|undefined} rank
 * @returns {string}
 */
export function medalClass(rank) {
  const place = toNumber(rank);
  return place !== null && place >= 1 && place <= 3 ? `place-${place}` : '';
}

/** @param {number} place */
export function medalLabel(place) {
  return MEDAL_LABELS[place - 1] ?? '';
}

/**
 * A win record as "12W 3D 1L", or a dash when the API has no record.
 * @param {{wins?: number|null, draws?: number|null, losses?: number|null}|null|undefined} record
 * @returns {string}
 */
export function formatRecord(record) {
  if (!record) return DASH;
  const wins = toNumber(record.wins);
  const draws = toNumber(record.draws);
  const losses = toNumber(record.losses);
  if (wins === null && draws === null && losses === null) return DASH;
  return `${formatNumber(wins ?? 0)}W ${formatNumber(draws ?? 0)}D ${formatNumber(losses ?? 0)}L`;
}

/**
 * A placement as an ordinal ("2nd") or a dash while unresolved.
 * @param {number|string|null|undefined} placement
 * @returns {string}
 */
export function formatPlacement(placement) {
  const place = toNumber(placement);
  if (place === null || place < 1) return DASH;
  const rounded = Math.round(place);
  const suffix = rounded % 100 >= 11 && rounded % 100 <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[rounded % 10] ?? 'th');
  return `${formatNumber(rounded)}${suffix}`;
}

/**
 * A paid place's share of the whole pot, 0 to 1, for reward bars.
 * @param {string|number|null|undefined} amount
 * @param {string|number|null|undefined} pot
 * @returns {number}
 */
export function rewardShare(amount, pot) {
  const part = toNumber(amount);
  const whole = toNumber(pot);
  if (part === null || whole === null || whole <= 0) return 0;
  return Math.min(Math.max(part / whole, 0), 1);
}

/**
 * The value of each entry to the paid places: the pot split across the paid
 * places, then divided by the entries. The one number the API does not send.
 * @param {{pot?: string|number|null, entries?: string|number|null, rewards_now?: Array<unknown>|null}} bounty
 * @returns {number|null}
 */
export function valuePerEntry(bounty) {
  const pot = toNumber(bounty?.pot);
  const entries = toNumber(bounty?.entries ?? bounty?.entry_count);
  const paidPlaces = Array.isArray(bounty?.rewards_now) && bounty.rewards_now.length > 0
    ? bounty.rewards_now.length
    : toNumber(bounty?.rewards?.length ?? 0);
  if (pot === null || entries === null || !paidPlaces || entries <= 0) return null;
  return pot / paidPlaces / entries;
}

/**
 * A compact countdown for stat cards, e.g. "1d 20h" or "5h 12m".
 * @param {string|number|null|undefined} deadline
 * @param {number} [now]
 * @returns {string}
 */
export function formatCountdown(deadline, now = Date.now()) {
  const target = typeof deadline === 'number' ? deadline : Date.parse(deadline ?? '');
  if (!Number.isFinite(target)) return DASH;
  const remaining = target - now;
  if (remaining <= 0) return 'Closed';
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Split help text into a plain paragraph, keeping it free of markup markers.
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function plainSummary(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
