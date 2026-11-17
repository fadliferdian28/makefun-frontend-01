/**
 * Live make.fun API client for PotScope.
 *
 * Every read goes through fetchCached: responses are kept in memory with their
 * ETag and fetch time, fresh entries are served without a request, stale ones
 * are served while a conditional request revalidates them in the background.
 * The counters below are real: the footer prints them for every view.
 *
 * @module api
 */

export const MAKEFUN_ORIGIN = 'https://make.fun';
export const API_ROOT = `${MAKEFUN_ORIGIN}/api`;
const LIST_CACHE_MS = 60_000;
const DETAIL_CACHE_MS = 300_000;
const DEFAULT_RETRY_MS = 2_000;
const MAX_RETRY_MS = 15_000;
const MAX_ATTEMPTS = 3;

/**
 * @typedef {Object} CacheEntry
 * @property {unknown} data Parsed JSON body.
 * @property {string|null} etag Validator sent back on the next request.
 * @property {number} fetchedAt Epoch milliseconds of the last successful answer.
 */

/**
 * @typedef {Object} ApiResult
 * @property {any} data Parsed JSON body.
 * @property {boolean} stale True when a network failure left us on cached data.
 * @property {boolean} fromCache True when no request was needed for this answer.
 * @property {boolean} revalidated True when a 304 refreshed the cached body.
 * @property {number} updatedAt Epoch milliseconds of the data actually held.
 */

/** @type {Map<string, CacheEntry>} */
const entryCache = new Map();

/** @type {Map<string, Promise<void>>} */
const pendingRefreshes = new Map();

const requestCounters = { requests: 0, cacheHits: 0, notModified: 0, failedRefreshes: 0, updatedAt: 0 };
let viewCounters = { requests: 0, cacheHits: 0, notModified: 0, failedRefreshes: 0, updatedAt: 0 };

/** An HTTP answer the app cannot use. */
export class ApiError extends Error {
  /**
   * @param {string} message Human-readable reason.
   * @param {number} [status] HTTP status, 0 for a network failure.
   */
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Reset the per-view counters; called by the router before each view loads. */
export function beginView() {
  viewCounters = { requests: 0, cacheHits: 0, notModified: 0, failedRefreshes: 0, updatedAt: 0 };
}

/** @returns {{requests: number, cacheHits: number, notModified: number, failedRefreshes: number, updatedAt: number}} */
export function getRequestStats() {
  return { ...requestCounters };
}

/** @returns {{requests: number, cacheHits: number, notModified: number, failedRefreshes: number, updatedAt: number}} */
export function getViewStats() {
  return { ...viewCounters };
}

/**
 * @param {string} url Request address used as the cache key.
 * @returns {CacheEntry|undefined}
 */
export function cacheGet(url) {
  return entryCache.get(url);
}

/**
 * The cached body for a URL, without its bookkeeping, or null when unknown.
 * @param {string} url Request address used as the cache key.
 * @returns {unknown|null}
 */
export function getCached(url) {
  return entryCache.get(url)?.data ?? null;
}

/**
 * @param {string} url Cache key.
 * @param {CacheEntry} entry Body, validator and fetch time.
 */
export function cacheSet(url, entry) {
  entryCache.set(url, entry);
}

/**
 * Parse a retry-after header in seconds or HTTP-date form.
 * @param {string|null} header
 * @returns {number} Milliseconds to wait, capped so a view never hangs.
 */
function parseRetryAfter(header) {
  if (!header) return DEFAULT_RETRY_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_MS);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_MS);
  return DEFAULT_RETRY_MS;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One GET, with the cached validator attached when we have one.
 * @param {string} url
 * @param {string|null} etag
 * @returns {Promise<{kind: 'ok'|'notModified'|'busy', data?: any, etag?: string|null, waitMs?: number}>}
 */
async function requestJson(url, etag) {
  const headers = { accept: 'application/json' };
  if (etag) headers['if-none-match'] = etag;
  let response;
  try {
    response = await fetch(url, { headers, credentials: 'omit', mode: 'cors' });
  } catch {
    throw new ApiError('make.fun is unreachable from this network', 0);
  }
  if (response.status === 304) return { kind: 'notModified', etag };
  if (response.status === 503) return { kind: 'busy', waitMs: parseRetryAfter(response.headers.get('retry-after')) };
  if (!response.ok) throw new ApiError(`make.fun answered ${response.status}`, response.status);
  const data = await response.json();
  return { kind: 'ok', data, etag: response.headers.get('etag') };
}

/** Tell the page that a cache entry changed, so visible numbers can be patched. */
function announceUpdate(url) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('potscope:data', { detail: { url } }));
  }
}

/**
 * Load one address into the cache, retrying a 503 once as the API asks.
 * @param {string} url
 * @param {CacheEntry|undefined} cached
 * @returns {Promise<CacheEntry & {stale?: boolean, revalidated?: boolean}>}
 */
async function loadEntry(url, cached) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    requestCounters.requests += 1;
    viewCounters.requests += 1;
    let answer;
    try {
      answer = await requestJson(url, cached?.etag ?? null);
    } catch (error) {
      if (cached) return { ...cached, stale: true };
      throw error;
    }
    if (answer.kind === 'notModified' && cached) {
      requestCounters.notModified += 1;
      viewCounters.notModified += 1;
      const refreshed = { ...cached, fetchedAt: Date.now() };
      cacheSet(url, refreshed);
      requestCounters.updatedAt = Math.max(requestCounters.updatedAt, refreshed.fetchedAt);
      viewCounters.updatedAt = Math.max(viewCounters.updatedAt, refreshed.fetchedAt);
      return { ...refreshed, revalidated: true };
    }
    if (answer.kind === 'busy') {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(answer.waitMs ?? DEFAULT_RETRY_MS);
        continue;
      }
      if (cached) return { ...cached, stale: true };
      throw new ApiError('make.fun is busy; try again in a moment', 503);
    }
    if (answer.kind === 'ok') {
      const entry = { data: answer.data, etag: answer.etag ?? null, fetchedAt: Date.now() };
      cacheSet(url, entry);
      requestCounters.updatedAt = entry.fetchedAt;
      viewCounters.updatedAt = entry.fetchedAt;
      announceUpdate(url);
      return entry;
    }
  }
  throw new ApiError('make.fun did not answer', 0);
}

/**
 * Revalidate a stale entry without blocking the render that used it.
 * @param {string} url
 */
export function revalidate(url) {
  const running = pendingRefreshes.get(url);
  if (running) return running;
  const task = loadEntry(url, cacheGet(url))
    .then(() => undefined)
    .catch(() => {
      requestCounters.failedRefreshes += 1;
      viewCounters.failedRefreshes += 1;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('potscope:stale', { detail: { url } }));
      }
    })
    .finally(() => pendingRefreshes.delete(url));
  pendingRefreshes.set(url, task);
  return task;
}

/**
 * @param {CacheEntry} entry
 * @param {{fromCache?: boolean, stale?: boolean, revalidated?: boolean}} flags
 * @returns {ApiResult}
 */
function toResult(entry, flags) {
  if (flags.fromCache) {
    requestCounters.cacheHits += 1;
    viewCounters.cacheHits += 1;
  }
  viewCounters.updatedAt = Math.max(viewCounters.updatedAt, entry.fetchedAt);
  requestCounters.updatedAt = Math.max(requestCounters.updatedAt, entry.fetchedAt);
  return {
    data: entry.data,
    stale: Boolean(flags.stale),
    fromCache: Boolean(flags.fromCache),
    revalidated: Boolean(flags.revalidated),
    updatedAt: entry.fetchedAt,
  };
}

/**
 * Serve a URL from memory while fresh, else from memory plus a background
 * revalidation, else from the network (with an ETag when one is known).
 * @param {string} url
 * @param {number} maxAgeMs Freshness window for this kind of data.
 * @returns {Promise<ApiResult>}
 */
export async function fetchCached(url, maxAgeMs) {
  const cached = cacheGet(url);
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) {
    return toResult(cached, { fromCache: true });
  }
  if (cached) {
    revalidate(url);
    return toResult(cached, { fromCache: true });
  }
  const running = pendingRefreshes.get(url);
  if (running) {
    await running;
    const settled = cacheGet(url);
    if (settled) return toResult(settled, { fromCache: true });
  }
  const entry = await loadEntry(url, undefined);
  return toResult(entry, { stale: entry.stale });
}

/**
 * The competition list, newest activity first.
 * @param {{cursor?: string}} [options]
 * @returns {Promise<ApiResult>}
 */
export function getBoard(options = {}) {
  const params = new URLSearchParams({ activity: 'times' });
  if (options.cursor) params.set('cursor', options.cursor);
  return fetchCached(`${API_ROOT}/competitions?${params.toString()}`, LIST_CACHE_MS);
}

/**
 * One competition with its description, rules, rewards and summary submissions.
 * @param {string} slug Competition slug.
 * @returns {Promise<ApiResult>}
 */
export function getBounty(slug) {
  const address = `${API_ROOT}/competitions/${encodeURIComponent(slug)}?submissions=summary`;
  return fetchCached(address, DETAIL_CACHE_MS);
}

/**
 * The full ranked list in its compact first-rows form.
 * @param {string} slug Competition slug.
 * @returns {Promise<ApiResult>}
 */
export function getLeaderboard(slug) {
  const address = `${API_ROOT}/competitions/${encodeURIComponent(slug)}/leaderboard?rows=first`;
  return fetchCached(address, LIST_CACHE_MS);
}

/**
 * The live top-ten standings snapshot for a competition.
 * @param {string} slug Competition slug.
 * @returns {Promise<ApiResult>}
 */
export function getLeadersStrip(slug) {
  const address = `${API_ROOT}/competitions/${encodeURIComponent(slug)}/live`;
  return fetchCached(address, LIST_CACHE_MS);
}

/**
 * One public account profile. Redirects (308) are followed by fetch.
 * @param {string} handle Account handle.
 * @returns {Promise<ApiResult>}
 */
export function getProfile(handle) {
  const address = `${API_ROOT}/profiles/${encodeURIComponent(handle)}`;
  return fetchCached(address, DETAIL_CACHE_MS);
}

/**
 * The builder rankings, best win record first.
 * @param {number} [limit] Rows to ask for.
 * @returns {Promise<ApiResult>}
 */
export function getTopBuilders(limit = 10) {
  const params = new URLSearchParams({ order: 'wins', limit: String(limit) });
  return fetchCached(`${API_ROOT}/rankings?${params.toString()}`, LIST_CACHE_MS);
}
