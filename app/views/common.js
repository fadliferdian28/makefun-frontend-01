// Shared view helpers: HTML escaping, tolerant lookup, and one normalizer for
// the competition object the board and bounty views both consume.

import { parseAmount } from '../format.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

export function pickFirst(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function asList(value) {
  return Array.isArray(value) ? value : [];
}

export function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function toIso(time) {
  return time === null || time === undefined ? '' : new Date(time).toISOString();
}

export function handleOf(row) {
  return String(row?.handle ?? row?.user?.handle ?? row?.author?.handle ?? '');
}

// Flatten one competition into the handful of fields the views show. Money
// stays as parsed numbers; timestamps stay as epoch milliseconds.
export function readCompetition(source) {
  const item = source ?? {};
  const liveRewards = asList(item.rewardsNow);
  const rewards = (liveRewards.length
    ? liveRewards.map((row, index) => {
      const base = parseAmount(row?.baseUsd);
      const share = parseAmount(row?.feeShareUsd);
      return {
        place: toFiniteNumber(row?.place) ?? index + 1,
        base,
        share,
        amount: parseAmount(row?.amountUsd) ?? (base ?? 0) + (share ?? 0),
      };
    })
    : Object.entries(item.rewards && typeof item.rewards === 'object' ? item.rewards : {}).map(([place, base]) => ({
      place: toFiniteNumber(place),
      base: parseAmount(base),
      share: 0,
      amount: parseAmount(base),
    }))).filter((row) => row.place !== null).sort((left, right) => left.place - right.place);
  const category = item.category;
  return {
    slug: String(item.slug ?? ''),
    title: String(item.title ?? 'Bounty'),
    pot: parseAmount(item.potUsd),
    fee: parseAmount(item.entryFeeUsd),
    feeTotal: parseAmount(item.entryFeesUsd),
    payers: toFiniteNumber(item.entryFeePayers),
    reward: toFiniteNumber(item.rewardAmount),
    deadline: parseTimestamp(item.deadline),
    publish: parseTimestamp(item.publishedAt),
    results: parseTimestamp(item.resolvedAt),
    entries: toFiniteNumber(item.submissionCount),
    category: typeof category === 'object' && category !== null ? String(category.name ?? category.title ?? '') : String(category ?? ''),
    skills: asList(item.skills).map(String).filter(Boolean),
    rewards,
  };
}
