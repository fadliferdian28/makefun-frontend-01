// Detail-only formatting for the leaderboard, profile, and top-builders
// views. These helpers are metric-aware; the base formatters in format.js
// stay metric-blind so the board and bounty views can share them.

import { formatMoney, parseAmount } from './format.js';

const MISSING = '—';
const MICRO = 1_000_000;

const PERCENT_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DECIMAL_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const INTEGER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function numericValue(value) {
  if (value && typeof value === 'object') {
    return parseAmount(value.value ?? value.score ?? value.judge ?? value.amount ?? value.display);
  }
  return parseAmount(value);
}

function columnWords(column) {
  if (!column) return '';
  if (typeof column === 'string') return column.toLowerCase();
  return [column.key, column.title, column.label, column.unit, column.metric, column.sorting, column.format]
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join(' ')
    .toLowerCase();
}

// Classify the metric from the column descriptor the API returns. Judge
// competitions report win rate in millionths; forecast boards report
// profit-and-loss in micro-dollars; a loss column keeps its decimals.
export function detectMetric(column) {
  const words = columnWords(column);
  if (/judge|win[\s_-]*rate|millionth/.test(words)) return 'judge';
  if (/profit|p&l|pnl|earnings?|dollars?|usd|\$/.test(words)) return 'profit';
  if (/\bloss\b/.test(words)) return 'loss';
  if (/percent|%/.test(words)) return 'percent';
  return 'score';
}

export function formatProfitLoss(microUnits) {
  const amount = numericValue(microUnits);
  return amount === null ? MISSING : formatMoney(amount / MICRO);
}

export function formatWinRate(millionths) {
  const amount = numericValue(millionths);
  return amount === null ? MISSING : `${PERCENT_FORMAT.format((amount / MICRO) * 100)}%`;
}

export function formatLoss(value) {
  const amount = numericValue(value);
  return amount === null ? MISSING : DECIMAL_FORMAT.format(amount);
}

export function formatMetricValue(value, column) {
  const amount = numericValue(value);
  if (amount === null) return MISSING;
  switch (detectMetric(column)) {
    case 'judge':
      return formatWinRate(amount);
    case 'profit':
      return formatProfitLoss(amount);
    case 'loss':
      return formatLoss(amount);
    case 'percent':
      return `${PERCENT_FORMAT.format(amount)}%`;
    default:
      return Number.isInteger(amount) ? INTEGER_FORMAT.format(amount) : DECIMAL_FORMAT.format(amount);
  }
}

// Read one leaderboard column from a row. Whole rows carry a values object
// keyed by column key; stubs carry a single value.
export function readColumnValue(row, column) {
  const key = column && typeof column === 'object' ? column.key : column;
  const values = row?.values;
  if (key && values && typeof values === 'object' && key in values) return values[key];
  if (values && typeof values === 'object') {
    const first = values[key ?? ''] ?? values.score ?? values.value ?? values.judge_score ?? Object.values(values)[0];
    if (first !== undefined) return first;
  }
  return row?.value ?? row?.score ?? row?.judge_score ?? null;
}

export function formatLeaderboardValue(row, column) {
  return formatMetricValue(readColumnValue(row, column), column);
}

export function formatInterval(low, high, column) {
  const start = numericValue(low);
  const end = numericValue(high);
  if (start === null || end === null) return MISSING;
  return `${formatMetricValue(start, column)} – ${formatMetricValue(end, column)}`;
}

export function formatPlacement(placement) {
  const value = numericValue(placement);
  return value === null || value < 1 ? MISSING : INTEGER_FORMAT.format(value);
}

export function formatRank(rank) {
  const value = numericValue(rank);
  return value === null || value < 1 ? MISSING : `#${INTEGER_FORMAT.format(value)}`;
}

export function formatPrize(prize) {
  if (prize && typeof prize === 'object') {
    return formatMoney(prize.amount ?? prize.value ?? prize.dollars ?? prize.prize);
  }
  return formatMoney(prize);
}

// A solution carries its score plus the column descriptor that explains how
// to read it. Fall back to its display string when the payload only has one.
export function formatSolutionScore(score) {
  if (score === null || score === undefined) return MISSING;
  if (typeof score !== 'object') return formatMetricValue(score, null);
  const column = score.column ?? score.descriptor ?? score.metric ?? score;
  const value = score.value ?? score.score ?? score.judge ?? score.judge_score;
  if (value === undefined && typeof score.display === 'string') return score.display;
  return formatMetricValue(value, column);
}

export function shortenAddress(value, size = 6) {
  const text = String(value ?? '');
  if (!text) return MISSING;
  if (text.length <= size * 2 + 1) return text;
  return `${text.slice(0, size)}…${text.slice(-size)}`;
}
