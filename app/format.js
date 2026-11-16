// Formatting helpers for every surface. All on-screen numbers pass through
// here so the interface never prints a raw API value.

const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const DECIMAL_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const MISSING = '—';
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Money arrives from the API as a decimal string ("1234.500000"); accept a
// number too, and refuse anything that is not finite.
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9.+-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoney(value) {
  const amount = parseAmount(value);
  return amount === null ? MISSING : MONEY_FORMAT.format(amount);
}

export function formatNumber(value, fractionDigits = 0) {
  const amount = parseAmount(value);
  if (amount === null) return MISSING;
  if (fractionDigits > 0) return DECIMAL_FORMAT.format(amount);
  return NUMBER_FORMAT.format(amount);
}

export function formatScore(millionths) {
  const value = parseAmount(millionths);
  if (value === null) return MISSING;
  return `${(value / 10_000).toFixed(2)}%`;
}

export function formatDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? DATE_FORMAT.format(time) : MISSING;
}

export function formatDateTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? DATE_TIME_FORMAT.format(time) : MISSING;
}

function plural(count, word) {
  return `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`;
}

// Countdown in three sizes: days and hours, hours and minutes, or minutes and
// seconds. A deadline in the past reads "Closed".
export function formatTimeLeft(deadline, now = Date.now()) {
  const closesAt = Date.parse(deadline);
  if (!Number.isFinite(closesAt)) return MISSING;
  const remaining = closesAt - now;
  if (remaining <= 0) return 'Closed';
  const totalSeconds = Math.floor(remaining / SECOND);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days >= 1) return `${plural(days, 'day')} ${plural(hours, 'hour')}`;
  if (hours >= 1) return `${plural(hours, 'hour')} ${plural(minutes, 'minute')}`;
  return `${plural(minutes, 'minute')} ${plural(seconds, 'second')}`;
}

// Relative time for ticker events and activity lines: "2 minutes ago".
export function formatRelativeTime(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return MISSING;
  const elapsed = Math.max(0, now - time);
  if (elapsed < 45 * SECOND) return 'just now';
  if (elapsed < HOUR) return `${plural(Math.round(elapsed / MINUTE), 'minute')} ago`;
  if (elapsed < DAY) return `${plural(Math.round(elapsed / HOUR), 'hour')} ago`;
  if (elapsed < 30 * DAY) return `${plural(Math.round(elapsed / DAY), 'day')} ago`;
  if (elapsed < 365 * DAY) return `${plural(Math.round(elapsed / (30 * DAY)), 'month')} ago`;
  return `${plural(Math.round(elapsed / (365 * DAY)), 'year')} ago`;
}

