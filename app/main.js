/**
 * PotScope entry module: hash router, header chrome, footers and the
 * shot-ready flag. No app module is imported statically — the style sheet,
 * the API and every view arrive through import() after the first load.
 *
 * @module main
 */

const ROUTE_BOARD = '#/';
const HEADER_ID = 'site-header';
const MAIN_ID = 'main';
const FOOTER_ID = 'site-footer';
const SHOT_FLAG = '__shotReady';
const TICK_MS = 1_000;
const FIRST_LOAD_GZIP_BYTES = 846;
const FIRST_LOAD_FILE_COUNT = 1;
const LOGO_SIZE_PX = 28;
const TICKER_SLOT_ID = 'ticker-slot';

/**
 * @typedef {Object} Route
 * @property {'board'|'bounty'|'leaderboard'|'profile'|'builders'} name
 * @property {string} [slug]
 * @property {string} [handle]
 * @property {string} hash
 */

/**
 * @typedef {Object} ViewContext
 * @property {HTMLElement} root Main container the view renders into.
 * @property {HTMLElement} tickerSlot The shell's one-line ticker region.
 * @property {Route} route Parsed current route.
 * @property {(hash: string) => void} navigate Go to a hash route.
 * @property {(title: string) => void} setTitle Update the document title.
 * @property {(message: string) => void} announce Politely announce a change.
 * @property {() => void} refreshStats Reprint the footer's request line.
 * @property {() => void} markReady Set the shot-ready flag once rendered.
 */

/** Titles per surface, so a view only has to refine one after it knows its data. */
const ROUTE_TITLES = {
  board: 'Bounty board',
  bounty: 'Bounty',
  leaderboard: 'Leaderboard',
  profile: 'Profile',
  builders: 'Top builders',
};

/** @type {Record<string, {load: () => Promise<any>, exportName: string}>} */
const VIEW_LOADERS = {
  board: { load: () => import('./views/board.js'), exportName: 'renderBoard' },
  bounty: { load: () => import('./views/bounty.js'), exportName: 'renderBounty' },
  leaderboard: { load: () => import('./views/leaderboard.js'), exportName: 'renderLeaderboard' },
  profile: { load: () => import('./views/profile.js'), exportName: 'renderProfile' },
  builders: { load: () => import('./views/leaderboard.js'), exportName: 'renderTopBuilders' },
};

let apiModule = null;
let formatModule = null;
let currentCleanup = null;
let stylesheetReady = null;
let detailStylesheetReady = null;
let statsTimer = 0;

/** @returns {Route} */
function parseRoute() {
  const hash = window.location.hash || ROUTE_BOARD;
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeSegment);
  if (segments[0] === 'bounty' && segments[1]) {
    if (segments[2] === 'leaderboard') {
      return { name: 'leaderboard', slug: segments[1], hash };
    }
    return { name: 'bounty', slug: segments[1], hash };
  }
  if (segments[0] === 'user' && segments[1]) {
    return { name: 'profile', handle: segments[1], hash };
  }
  if (segments[0] === 'builders') {
    return { name: 'builders', hash };
  }
  return { name: 'board', hash: ROUTE_BOARD };
}

/** @param {string} segment */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** @param {string} hash */
function goTo(hash) {
  if (window.location.hash === hash) {
    renderRoute();
    return;
  }
  window.location.hash = hash;
}

/**
 * Load a style sheet's text from this app and adopt it in one style element.
 * The text arrives after the first load, so index.html stays a single file.
 * @param {string} href Address inside the app.
 * @param {string} mark Data attribute that makes the load idempotent.
 * @returns {Promise<void>}
 */
async function loadStyleSheet(href, mark) {
  if (document.querySelector(`style[data-potscope="${mark}"]`)) return;
  const style = document.createElement('style');
  style.dataset.potscope = mark;
  document.head.append(style);
  try {
    const response = await fetch(href, { credentials: 'same-origin' });
    if (response.ok) style.textContent = await response.text();
  } catch {
    style.remove();
  }
}

/** Load the main style sheet, once per page. */
function ensureStyles() {
  if (!stylesheetReady) stylesheetReady = loadStyleSheet('style.css', 'main-style');
  return stylesheetReady;
}

/** Load the detail style sheet only when a detail surface opens. */
function ensureDetailStyles() {
  if (!detailStylesheetReady) detailStylesheetReady = loadStyleSheet('detail.css', 'detail-style');
  return detailStylesheetReady;
}

/**
 * Build the one-line site header: logo, wordmark, navigation, search, clock.
 * @returns {HTMLElement}
 */
function renderHeader() {
  const header = byId(HEADER_ID);
  header.replaceChildren();

  const bar = element('div', 'r topbar');
  const brand = element('a', 'brand');
  brand.href = ROUTE_BOARD;
  brand.setAttribute('aria-label', 'make.fun bounty board');
  const logo = document.createElement('img');
  logo.src = 'logo.png';
  logo.alt = '';
  logo.width = LOGO_SIZE_PX;
  logo.height = LOGO_SIZE_PX;
  logo.decoding = 'async';
  brand.append(logo, text('span', 'wordmark', 'make.fun'));

  const nav = element('nav', 'topnav');
  nav.setAttribute('aria-label', 'Main');
  nav.append(navLink('Bounties', ROUTE_BOARD, 'board'), navLink('Top builders', '#/builders', 'builders'));

  const search = element('div', 'search');
  const label = text('label', 'visually-hidden', 'Search bounties or handles');
  label.htmlFor = 'site-search';
  const input = document.createElement('input');
  input.id = 'site-search';
  input.type = 'search';
  input.placeholder = 'Search bounties or @handles';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    window.dispatchEvent(new CustomEvent('potscope:search', { detail: { query: input.value } }));
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const query = input.value.trim().replace(/^@/, '');
    if (!query) return;
    event.preventDefault();
    if (input.value.trim().startsWith('@') || window.location.hash.startsWith('#/user/')) {
      goTo(`#/user/${encodeURIComponent(query)}`);
    } else {
      window.dispatchEvent(new CustomEvent('potscope:search', { detail: { query, submit: true } }));
    }
  });
  search.append(label, input);

  const live = element('div', 'livenow');
  const clock = text('time', 'clock', '--:--:--');
  clock.id = 'live-clock';
  clock.dateTime = new Date().toISOString();
  clock.setAttribute('aria-label', 'Current time');
  const freshness = text('span', 'freshness', 'syncing');
  freshness.id = 'live-freshness';
  live.append(clock, freshness);

  bar.append(brand, nav, search, live);
  header.append(bar);
  const announcer = element('p', 'visually-hidden');
  announcer.id = 'route-announcer';
  announcer.setAttribute('aria-live', 'polite');
  header.append(announcer);
  return header;
}

/**
 * @param {string} label
 * @param {string} hash
 * @param {Route['name']} routeName
 */
function navLink(label, hash, routeName) {
  const link = element('a', 'topnav-link');
  link.href = hash;
  link.textContent = label;
  link.dataset.route = routeName;
  return link;
}

/** Mark the navigation link of the active surface. */
function syncNavigation(route) {
  const activeName = route.name === 'bounty' || route.name === 'leaderboard' ? 'board' : route.name;
  document.querySelectorAll('.topnav-link').forEach((link) => {
    const isActive = link.dataset.route === activeName;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('.search')?.toggleAttribute('hidden', route.name === 'builders');
}

/** Start the one-second clock and freshness readout. */
function startClock() {
  window.clearInterval(statsTimer);
  const tick = () => {
    const clock = byId('live-clock');
    const now = new Date();
    if (clock) {
      clock.textContent = formatModule ? formatModule.formatClock(now.getTime()) : now.toLocaleTimeString('en-US', { hour12: false });
      clock.dateTime = now.toISOString();
    }
    refreshFreshness();
    refreshFooterLine();
  };
  tick();
  statsTimer = window.setInterval(tick, TICK_MS);
}

/** How long ago the most recent API answer arrived, in the header. */
function refreshFreshness() {
  const node = byId('live-freshness');
  if (!node) return;
  if (!apiModule) {
    node.textContent = 'syncing';
    return;
  }
  const stats = apiModule.getRequestStats();
  if (!stats.updatedAt) {
    node.textContent = 'syncing';
    return;
  }
  const seconds = Math.max(Math.round((Date.now() - stats.updatedAt) / 1000), 0);
  node.textContent = seconds >= 60 && formatModule ? `updated ${formatModule.formatRelative(stats.updatedAt)}` : `updated ${seconds}s ago`;
}

/** The measured first-load line, shared by every footer. */
function performanceStory() {
  const kb = (FIRST_LOAD_GZIP_BYTES / 1024).toFixed(1);
  return `${FIRST_LOAD_FILE_COUNT}-file first load (${FIRST_LOAD_GZIP_BYTES} bytes gzip-9, ${kb} KB) · ETag cache · views by import() · rows patched in place`;
}

/**
 * Paint the footer: the view's counted requests, then the performance story.
 * @param {string} [note] Optional extra line such as a stale-data warning.
 */
function renderFooter(note = '') {
  const footer = byId(FOOTER_ID);
  footer.replaceChildren();
  const stats = element('p', 'footer-stats');
  stats.id = 'request-stats';
  const story = element('p', 'footer-story');
  story.textContent = performanceStory();
  footer.append(stats, story);
  if (note) {
    const warning = element('p', 'footer-note');
    warning.textContent = note;
    footer.append(warning);
  }
  refreshFooterLine();
}

/**
 * Keep the footer's note in step with the API's background revalidations: a
 * failed refresh leaves the cached data on screen and says so.
 * @param {boolean} stale
 */
function markRefreshFailure(stale) {
  const footer = byId(FOOTER_ID);
  let note = footer.querySelector('.footer-note');
  if (!stale) {
    note?.remove();
    return;
  }
  if (!note) {
    note = element('p', 'footer-note');
    footer.append(note);
  }
  note.textContent = 'Could not refresh from make.fun just now; showing the last data this view held. It will retry on its own.';
}

/** Reprint the per-view request line from the real API counters. */
function refreshFooterLine() {
  const node = byId('request-stats');
  if (!node) return;
  if (!apiModule) {
    node.textContent = 'This view: connecting to make.fun';
    return;
  }
  const stats = apiModule.getViewStats();
  const updated = stats.updatedAt
    ? `updated ${Math.max(Math.round((Date.now() - stats.updatedAt) / 1000), 0)}s ago`
    : 'no data yet';
  node.textContent = `This view: ${stats.requests} API request${stats.requests === 1 ? '' : 's'} · ${stats.cacheHits} from cache · ${stats.notModified} unchanged (304) · ${updated}`;
}

/** @param {string} id */
function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`PotScope shell is missing #${id}`);
  return node;
}

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [content]
 */
function text(tag, className, content = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

/**
 * @param {string} tag
 * @param {string} className
 */
function element(tag, className) {
  return text(tag, className);
}

/** @param {string} message */
function announce(message) {
  const node = byId('route-announcer');
  node.textContent = '';
  window.setTimeout(() => {
    node.textContent = message;
  }, 30);
}

/** @param {string} title */
function setTitle(title) {
  document.title = `make.fun — ${title}`;
}

/**
 * Render an empty route with a retry action, keeping the shell usable.
 * @param {Route} route
 * @param {Error} error
 */
function renderRouteError(route, error) {
  const root = byId(MAIN_ID);
  root.replaceChildren();
  const panel = element('section', 'panel route-error');
  const heading = text('h2', 'section-title', 'This view could not load');
  const detail = text('p', 'muted', describeFailure(error));
  const retry = text('button', 'btn btn-primary', 'Try again');
  retry.type = 'button';
  retry.addEventListener('click', () => renderRoute());
  const home = element('a', 'btn btn-secondary');
  home.href = ROUTE_BOARD;
  home.textContent = 'Back to the board';
  panel.append(heading, detail, retry, home);
  root.append(panel);
  renderFooter('Showing nothing but the shell; the live API did not answer for this view.');
  setReady(true);
  announce(`Could not load ${route.name}. ${detail.textContent}`);
}

/** @param {unknown} error */
function describeFailure(error) {
  if (error instanceof Error && error.message) return error.message;
  return 'An unexpected problem stopped this view. Check the network and try again.';
}

/** Set the flag the screenshot script waits on. @param {boolean} ready */
function setReady(ready) {
  window[SHOT_FLAG] = ready;
}

/** Fade the new view in, unless the reader prefers reduced motion. */
function animateRouteIn() {
  const root = byId(MAIN_ID);
  if (typeof root.animate !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.animate(
    [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
    { duration: 180, easing: 'ease-out' },
  );
}

/** @param {ViewContext} context */
async function runViewLoader(context) {
  const loader = VIEW_LOADERS[context.route.name];
  const module = await loader.load();
  const render = module?.[loader.exportName];
  if (typeof render !== 'function') {
    throw new Error(`${context.route.name} view does not export ${loader.exportName}`);
  }
  return render(context);
}

/** Resolve the current hash into a rendered view. */
async function renderRoute() {
  const route = parseRoute();
  setReady(false);
  byId(MAIN_ID).setAttribute('aria-busy', 'true');

  if (typeof currentCleanup === 'function') {
    currentCleanup();
    currentCleanup = null;
  }
  const [, api, format] = await Promise.all([
    ensureStyles(),
    import('./api.js'),
    import('./format.js'),
  ]);
  apiModule = api;
  formatModule = format;
  apiModule.beginView();
  if (route.name === 'board' || route.name === 'bounty' || route.name === 'leaderboard' || route.name === 'profile' || route.name === 'builders') {
    await ensureDetailStyles();
  }
  syncNavigation(route);
  setTitle(ROUTE_TITLES[route.name] ?? 'Bounty board');

  const context = {
    root: byId(MAIN_ID),
    tickerSlot: byId(TICKER_SLOT_ID),
    route,
    navigate: goTo,
    setTitle,
    announce,
    refreshStats: refreshFooterLine,
    markReady: () => setReady(true),
  };

  try {
    if (route.name !== 'board') byId(TICKER_SLOT_ID).replaceChildren();
    const cleanup = await runViewLoader(context);
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
    renderFooter();
    byId(MAIN_ID).setAttribute('aria-busy', 'false');
    animateRouteIn();
    setReady(true);
  } catch (error) {
    byId(MAIN_ID).setAttribute('aria-busy', 'false');
    renderRouteError(route, error);
  }
  refreshFreshness();
}

/** Wire the hash router, the clock and the first route. */
function bootstrap() {
  renderHeader();
  renderFooter();
  startClock();
  const skip = document.querySelector('.skip');
  if (skip) {
    skip.addEventListener('click', (event) => {
      event.preventDefault();
      byId(MAIN_ID).focus();
    });
  }
  window.addEventListener('hashchange', () => {
    if (!window.location.hash.startsWith('#/')) return;
    renderRoute();
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
  window.addEventListener('potscope:data', () => {
    markRefreshFailure(false);
    refreshFreshness();
    refreshFooterLine();
  });
  window.addEventListener('potscope:stale', () => {
    markRefreshFailure(true);
    refreshFooterLine();
  });
  if (!window.location.hash) {
    window.history.replaceState(null, '', ROUTE_BOARD);
  }
  renderRoute();
}

setReady(false);
bootstrap();

export { parseRoute, renderRoute, performanceStory };
