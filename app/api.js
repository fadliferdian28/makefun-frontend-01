const BASE = "https://make.fun/api";

export class ApiError extends Error {
  constructor(message, status, retryAfterMs) {
    super(message);
    this.name = "ApiError";
    this.status = status || 0;
    this.retryAfterMs = retryAfterMs || 0;
  }
}

const cache = new Map();
const inflight = new Map();

function parseRetryAfter(value) {
  if (!value) return 5000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(1000, when - Date.now());
  return 5000;
}

async function request(url, etag) {
  const headers = { Accept: "application/json" };
  if (etag) headers["If-None-Match"] = etag;
  let res;
  try {
    res = await fetch(url, {
      headers,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new ApiError("Network unavailable", 0);
  }
  if (res.status === 304) return { notModified: true, etag };
  if (res.status === 503 || res.status === 429) {
    throw new ApiError("Service busy", res.status, parseRetryAfter(res.headers.get("Retry-After")));
  }
  if (res.status === 404) throw new ApiError("Not found", 404);
  if (!res.ok) throw new ApiError("Request failed (" + res.status + ")", res.status);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("Bad response", res.status);
  }
  return { body, etag: res.headers.get("ETag") || "", finalUrl: res.url || url };
}

// Fetch with If-None-Match; updates the cache in place on a 304.
async function revalidate(url, ttlMs, etagHint) {
  const hit = cache.get(url);
  const etag = etagHint !== undefined ? etagHint : hit ? hit.etag : "";
  let result = await request(url, etag);
  if (result.notModified) {
    if (hit) {
      hit.at = Date.now();
      cache.set(url, hit);
      return { body: hit.body, stale: false, cached: true, notModified: true };
    }
    result = await request(url, "");
  }
  const entry = { body: result.body, etag: result.etag, at: Date.now(), finalUrl: result.finalUrl };
  cache.set(url, entry);
  return { body: result.body, stale: false, cached: false, finalUrl: result.finalUrl };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cache-first fetch with stale-while-revalidate: fresh cache is instant, stale
// cache renders now and revalidates in the background, 503 retries Retry-After.
export async function fetchCached(url, { ttl = 60000, onFresh = null, force = false } = {}) {
  const hit = cache.get(url);
  if (hit && !force) {
    if (Date.now() - hit.at < ttl) {
      return { body: hit.body, stale: false, cached: true };
    }
    const pending = inflight.get(url);
    if (!pending) {
      const job = revalidate(url, ttl)
        .then((r) => {
          if (onFresh) onFresh(r.body, false);
          return r;
        })
        .catch(() => null)
        .finally(() => inflight.delete(url));
      inflight.set(url, job);
    }
    return { body: hit.body, stale: true, cached: true };
  }

  const pending = inflight.get(url);
  if (pending) {
    const r = await pending;
    if (r) return r;
  }

  const job = (async () => {
    let attempt = 0;
    for (;;) {
      try {
        return await revalidate(url, ttl);
      } catch (err) {
        if (err instanceof ApiError && err.status === 503 && attempt < 2) {
          attempt += 1;
          await sleep(Math.min(err.retryAfterMs || 5000, 10000));
          continue;
        }
        throw err;
      }
    }
  })().finally(() => inflight.delete(url));
  inflight.set(url, job);

  try {
    return await job;
  } catch (err) {
    const stale = cache.get(url);
    if (stale) {
      return { body: stale.body, stale: true, cached: true, refreshFailed: true };
    }
    throw err;
  }
}

export function getBoard(opts = {}) {
  return fetchCached(BASE + "/competitions?activity=times", { ttl: 60000, ...opts });
}
