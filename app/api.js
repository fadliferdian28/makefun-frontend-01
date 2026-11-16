// Read-only client for the public make.fun API. Every response is cached in
// memory with its ETag and fetch time; stale entries keep rendering while a
// conditional request revalidates them in the background.

export const API_ORIGIN = 'https://make.fun';
export const API_BASE = `${API_ORIGIN}/api`;

// Freshness windows, in milliseconds.
export const LIST_FRESH_MS = 60_000;
export const DETAIL_FRESH_MS = 300_000;

const MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;

const responseCache = new Map();
const inFlight = new Map();

export class ApiError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function getCached(url) {
  return responseCache.get(url) ?? null;
}

export function cacheGet(url) {
  return getCached(url);
}

export function cacheSet(url, data, etag, fetchedAt = Date.now()) {
  responseCache.set(url, { data, etag: etag || null, fetchedAt });
}

function isFresh(entry, ttl) {
  return Boolean(entry) && Date.now() - entry.fetchedAt < ttl;
}

function retryAfterMs(response) {
  const header = response.headers.get('retry-after');
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000));
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - Date.now()));
  return DEFAULT_RETRY_AFTER_MS;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One GET with conditional headers. A 304 refreshes the stored timestamp; a
// 503 honors retry-after and tries again; any other failure throws.
async function requestJson(url, etag, attempt = 0) {
  const headers = { accept: 'application/json' };
  if (etag) headers['if-none-match'] = etag;

  let response;
  try {
    response = await fetch(url, { headers, credentials: 'omit', mode: 'cors' });
  } catch {
    throw new ApiError('network', { status: 0 });
  }

  if (response.status === 304) {
    return { notModified: true, data: null, etag };
  }
  if (response.status === 404) {
    throw new ApiError('not-found', { status: 404 });
  }
  if (response.status === 503 && attempt < 3) {
    const delay = retryAfterMs(response);
    if (delay <= MAX_RETRY_AFTER_MS) {
      await wait(delay);
      return requestJson(url, etag, attempt + 1);
    }
  }
  if (!response.ok) {
    throw new ApiError(`http-${response.status}`, { status: response.status });
  }
  return {
    notModified: false,
    data: await response.json(),
    etag: response.headers.get('etag'),
  };
}

// Revalidate a cached address without blocking the visible table. Resolves to
// true when fresh data arrived and false when the old copy must stay.
export async function revalidate(url) {
  const entry = getCached(url);
  if (!entry) return false;
  if (inFlight.has(url)) return inFlight.get(url);
  const task = (async () => {
    try {
      const result = await requestJson(url, entry.etag);
      if (result.notModified) {
        cacheSet(url, entry.data, entry.etag);
      } else {
        cacheSet(url, result.data, result.etag);
      }
      return true;
    } catch {
      return false;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, task);
  return task;
}

// The public entry point. Fresh cache answers at once; a stale cache answers
// at once and refreshes behind the scene; an empty cache awaits the network.
export async function fetchCached(url, { ttl = LIST_FRESH_MS, onRefresh } = {}) {
  const entry = getCached(url);
  if (isFresh(entry, ttl)) {
    return { data: entry.data, stale: false, error: null, fetchedAt: entry.fetchedAt };
  }
  if (entry) {
    revalidate(url).then((ok) => {
      if (ok && typeof onRefresh === 'function') onRefresh(getCached(url));
    });
    return { data: entry.data, stale: true, error: null, fetchedAt: entry.fetchedAt };
  }
  if (inFlight.has(url)) {
    const shared = await inFlight.get(url);
    return { data: shared.data, stale: false, error: null, fetchedAt: Date.now() };
  }
  const task = (async () => {
    const result = await requestJson(url, null);
    cacheSet(url, result.data, result.etag);
    return result;
  })();
  inFlight.set(url, task);
  try {
    const result = await task;
    return { data: result.data, stale: false, error: null, fetchedAt: Date.now() };
  } catch (error) {
    return { data: null, stale: false, error: error instanceof ApiError ? error : new ApiError('network'), fetchedAt: 0 };
  } finally {
    inFlight.delete(url);
  }
}

export function boardUrl() {
  return `${API_BASE}/competitions?activity=times`;
}

export function bountyUrl(slug) {
  return `${API_BASE}/competitions/${encodeURIComponent(slug)}?submissions=summary`;
}

export function liveUrl(slug) {
  return `${API_BASE}/competitions/${encodeURIComponent(slug)}/live`;
}

export function leaderboardUrl(slug) {
  return `${API_BASE}/competitions/${encodeURIComponent(slug)}/leaderboard?rows=first`;
}

export function profileUrl(handle) {
  return `${API_BASE}/profiles/${encodeURIComponent(handle)}`;
}

export function rankingsUrl() {
  return `${API_BASE}/rankings?order=wins&limit=10`;
}

export function fetchBoard(options) {
  return fetchCached(boardUrl(), { ttl: LIST_FRESH_MS, ...options });
}

export function fetchBounty(slug, options) {
  return fetchCached(bountyUrl(slug), { ttl: DETAIL_FRESH_MS, ...options });
}

export function fetchLive(slug, options) {
  return fetchCached(liveUrl(slug), { ttl: LIST_FRESH_MS, ...options });
}

export function fetchLeaderboard(slug, options) {
  return fetchCached(leaderboardUrl(slug), { ttl: LIST_FRESH_MS, ...options });
}

export function fetchProfile(handle, options) {
  return fetchCached(profileUrl(handle), { ttl: DETAIL_FRESH_MS, ...options });
}

export function fetchRankings(options) {
  return fetchCached(rankingsUrl(), { ttl: LIST_FRESH_MS, ...options });
}
