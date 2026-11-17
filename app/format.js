/**
 * Formatting helpers shared by every PotScope view.
 *
 * Money is always parsed from the API's decimal strings, figures always carry
 * thousands separators, and no function ever returns a bare raw number.
 *
 * @module format
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DASH = '—';
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const PLAIN = new Intl.NumberFormat('en-US');
const DECIMAL = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Parse the API's money strings (or a number) into a finite number.
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {number} time */
export function formatClock(time) {
  return new Date(time).toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Dollars and cents from a money string or number.
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
export function formatMoney(value) {
  const amount = toNumber(value);
  return amount === null ? DASH : USD.format(amount);
}

/**
 * Dollars and cents without a currency mark, for tight table cells.
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
export function formatDollars(value) {
  const amount = toNumber(value);
  return amount === null ? DASH : `$${amount.toFixed(2)}`;
}

/**
 * A large figure with separators, or a compact form for very large counts.
 * @param {string|number|null|undefined} value
 * @param {boolean} [compact] Use the compact form above ten thousand.
 * @returns {string}
 */
export function formatNumber(value, compact = false) {
  const amount = toNumber(value);
  if (amount === null) return DASH;
  if (compact && Math.abs(amount) >= 10_000) return COMPACT.format(amount);
  return PLAIN.format(amount);
}

/**
 * A whole percentage from a 0..1 ratio.
 * @param {number|null|undefined} ratio
 * @returns {string}
 */
export function formatPercent(ratio) {
  const value = toNumber(ratio);
  return value === null ? DASH : `${(value * 100).toFixed(1)}%`;
}

/**
 * Time from now until an address, as "1 day 20 hours", "5 hours 12 min", or
 * "12 min 30 s" once it is close. Past deadlines read as closed.
 * @param {string|number|null|undefined} deadline ISO date or epoch milliseconds.
 * @param {number} [now]
 * @returns {string}
 */
export function formatTimeLeft(deadline, now = Date.now()) {
  const target = typeof deadline === 'number' ? deadline : Date.parse(deadline ?? '');
  if (!Number.isFinite(target)) return DASH;
  const remaining = target - now;
  if (remaining <= 0) return 'Closed';
  if (remaining >= DAY_MS) {
    const days = Math.floor(remaining / DAY_MS);
    const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
    return `${days} day${days === 1 ? '' : 's'} ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (remaining >= HOUR_MS) {
    const hours = Math.floor(remaining / HOUR_MS);
    const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);
    return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} min`;
  }
  const minutes = Math.floor(remaining / MINUTE_MS);
  const seconds = Math.floor((remaining % MINUTE_MS) / 1000);
  return `${minutes} min ${seconds} s`;
}

/**
 * The elapsed share of an entry window, 0 to 1, for progress bars.
 * @param {string|number|null|undefined} opened
 * @param {string|number|null|undefined} deadline
 * @param {number} [now]
 * @returns {number}
 */
export function elapsedShare(opened, deadline, now = Date.now()) {
  const start = typeof opened === 'number' ? opened : Date.parse(opened ?? '');
  const end = typeof deadline === 'number' ? deadline : Date.parse(deadline ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(Math.max((now - start) / (end - start), 0), 1);
}

/**
 * "2 minutes ago" from an address in the past.
 * @param {string|number|null|undefined} moment ISO date or epoch milliseconds.
 * @param {number} [now]
 * @returns {string}
 */
export function formatRelative(moment, now = Date.now()) {
  const then = typeof moment === 'number' ? moment : Date.parse(moment ?? '');
  if (!Number.isFinite(then)) return DASH;
  const seconds = Math.max(Math.round((now - then) / 1000), 0);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.round(months / 12)} year${months >= 18 ? 's' : ''} ago`;
}

/**
 * A short calendar date such as "17 Nov 2026".
 * @param {string|number|null|undefined} moment
 * @returns {string}
 */
export function formatDate(moment) {
  const then = typeof moment === 'number' ? moment : Date.parse(moment ?? '');
  if (!Number.isFinite(then)) return DASH;
  const date = new Date(then);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * A date and time, for activity lists.
 * @param {string|number|null|undefined} moment
 * @returns {string}
 */
export function formatDateTime(moment) {
  const then = typeof moment === 'number' ? moment : Date.parse(moment ?? '');
  if (!Number.isFinite(then)) return DASH;
  const date = new Date(then);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(then)} ${hours}:${minutes} UTC`;
}

/**
 * A score formatted by its metric descriptor: a judge win rate in millionths
 * becomes a percent, profit and loss in micro-dollars becomes dollars, small
 * integers stay integers and decimals keep their precision.
 * @param {string|number|null|undefined} value
 * @param {{key?: string, title?: string, unit?: string}|null} [metric]
 * @returns {string}
 */
export function formatScore(value, metric) {
  const amount = toNumber(value);
  if (amount === null) return DASH;
  const unit = String(metric?.unit ?? '').toLowerCase();
  const key = String(metric?.key ?? '').toLowerCase();
  if (unit.includes('millionth') || unit.includes('win rate') || unit.includes('rate') || key.includes('judge')) {
    return `${(amount / 1_000_000 * 100).toFixed(2)}%`;
  }
  if (unit.includes('micro') || unit.includes('usd') || key.includes('profit') || key.includes('pnl')) {
    return USD.format(amount / 1_000_000);
  }
  if (unit) {
    const figure = Number.isInteger(amount) ? PLAIN.format(amount) : DECIMAL.format(amount);
    return `${figure} ${metric.unit}`;
  }
  if (Number.isInteger(amount)) return PLAIN.format(amount);
  return DECIMAL.format(amount);
}

/**
 * Remove tags and collapse whitespace, for a safe one-line subline.
 * @param {string|null|undefined} text
 * @param {number} [limit] Maximum characters.
 * @returns {string}
 */
export function firstLine(text, limit = 160) {
  const clean = String(text ?? '').replace(/[#*_`>\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}
