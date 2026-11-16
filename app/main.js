// PotScope entry script: hash router, header wiring, and the shot-ready flag.
//
// View contract: every view module exports one async render function that
// receives (root, context) and resolves once its data has painted.
//   board.js     renderBoard(root, context)
//   bounty.js    renderBounty(root, context)     context.slug
//   leaderboard  renderLeaderboard(root, context) context.slug
//                renderBuilders(root, context)
//   profile.js   renderProfile(root, context)    context.handle
// The context carries the parsed route, the abort signal for the visit, a
// setTitle helper, a navigate helper, and isActive for polling guards.

import { fetchBoard } from './api.js';
import { formatDateTime } from './format.js';

const TICKER_IDLE_TEXT = 'Loading the latest entries…';

let renderSequence = 0;
let visitController = null;
let activeRouteName = 'board';
let detailStylesPromise = null;

const elements = {
  view: document.getElementById('view'),
  ticker: document.getElementById('ticker'),
  tickerLine: document.getElementById('ticker-line'),
  clock: document.getElementById('clock'),
  searchForm: document.getElementById('search-form'),
  searchInput: document.getElementById('search-input'),
};

function setShotReady(ready) {
  window.__shotReady = Boolean(ready);
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parseRoute(rawHash) {
  const raw = (rawHash || '').replace(/^#/, '');
  const queryIndex = raw.indexOf('?');
  const pathPart = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const queryPart = queryIndex === -1 ? '' : raw.slice(queryIndex + 1);
  const query = new URLSearchParams(queryPart);
  const segments = pathPart.split('/').filter(Boolean).map(safeDecode);

  if (segments.length === 0) {
    return { name: 'board', query };
  }
  if (segments[0] === 'builders' && segments.length === 1) {
    return { name: 'builders' };
  }
  if (segments[0] === 'bounty' && segments.length === 2) {
    return { name: 'bounty', slug: segments[1] };
  }
  if (segments[0] === 'bounty' && segments.length === 3 && segments[2] === 'leaderboard') {
    return { name: 'leaderboard', slug: segments[1] };
  }
  if (segments[0] === 'user' && segments.length === 2) {
    return { name: 'profile', handle: segments[1] };
  }
  return { name: 'not-found', path: pathPart };
}

function routeTitle(route) {
  switch (route.name) {
    case 'bounty':
      return 'make.fun Bounty';
    case 'leaderboard':
      return 'make.fun Leaderboard';
    case 'profile':
      return 'make.fun Profile';
    case 'builders':
      return 'make.fun Top Builders';
    default:
      return 'make.fun Bounty Board';
  }
}

function buildVisitContext(route, sequence) {
  return {
    route,
    signal: visitController.signal,
    ticker: { root: elements.ticker, line: elements.tickerLine },
    isActive: () => sequence === renderSequence,
    navigate: (hash) => {
      if (location.hash === hash) renderRoute();
      else location.hash = hash;
    },
    setTitle: (text) => {
      document.title = text.startsWith('make.fun') ? text : `make.fun · ${text}`;
    },
  };
}

function setActiveNavigation(name) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const isCurrent = link.dataset.nav === name;
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function showRouteNotice(kind, message) {
  const panel = document.createElement('section');
  panel.className = `route-notice route-notice-${kind}`;
  const heading = document.createElement('h1');
  heading.textContent = kind === 'missing' ? 'That page does not exist' : 'Something went wrong';
  const body = document.createElement('p');
  body.textContent = message;
  const action = document.createElement('a');
  action.className = 'button button-primary';
  action.href = '#/';
  action.textContent = 'Back to the board';
  panel.append(heading, body, action);
  elements.view.replaceChildren(panel);
}

// The detail surfaces share one stylesheet that the board and bounty routes
// never need. Attach it once, on first use, and reuse the same promise.
function ensureDetailStyles() {
  if (detailStylesPromise) return detailStylesPromise;
  detailStylesPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'detail.css';
    link.addEventListener('load', () => resolve());
    link.addEventListener('error', () => reject(new Error('detail-styles')));
    document.head.append(link);
  }).catch(() => {});
  return detailStylesPromise;
}

async function renderView(route, context) {
  switch (route.name) {
    case 'board': {
      const module = await import('./views/board.js');
      return module.renderBoard(elements.view, context);
    }
    case 'bounty': {
      const module = await import('./views/bounty.js');
      return module.renderBounty(elements.view, context);
    }
    case 'leaderboard': {
      await ensureDetailStyles();
      const module = await import('./views/leaderboard.js');
      return module.renderLeaderboard(elements.view, context);
    }
    case 'profile': {
      await ensureDetailStyles();
      const module = await import('./views/profile.js');
      return module.renderProfile(elements.view, context);
    }
    case 'builders': {
      await ensureDetailStyles();
      const module = await import('./views/leaderboard.js');
      return module.renderBuilders(elements.view, context);
    }
    default:
      showRouteNotice('missing', 'The address in the navigation bar does not match any PotScope route.');
      return null;
  }
}

async function renderRoute() {
  const route = parseRoute(location.hash);
  const sequence = ++renderSequence;
  activeRouteName = route.name;

  if (visitController) visitController.abort();
  visitController = new AbortController();

  setShotReady(false);
  document.title = routeTitle(route);
  setActiveNavigation(route.name === 'builders' ? 'builders' : 'board');

  if (route.name === 'board') {
    elements.ticker.hidden = false;
    elements.tickerLine.textContent = TICKER_IDLE_TEXT;
  } else {
    elements.ticker.hidden = true;
  }

  const context = buildVisitContext(route, sequence);
  try {
    await renderView(route, context);
  } catch (error) {
    if (sequence === renderSequence) {
      showRouteNotice('error', 'The data could not be loaded just now. Check the connection and try again.');
    }
  } finally {
    if (sequence === renderSequence && route.name !== 'not-found') setShotReady(true);
  }
}

function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  elements.clock.textContent = `${hours}:${minutes}:${seconds}`;
  elements.clock.dateTime = now.toISOString();
  elements.clock.title = formatDateTime(now.toISOString());
}

function submitSearch(event) {
  event.preventDefault();
  const query = elements.searchInput.value.trim();
  if (!query) return;
  if (query.startsWith('@')) {
    location.hash = `#/user/${encodeURIComponent(query.slice(1))}`;
    return;
  }
  if (activeRouteName !== 'board') {
    location.hash = '#/';
    window.setTimeout(() => {
      document.dispatchEvent(new CustomEvent('potscope:search', { detail: { query } }));
    }, 0);
    return;
  }
  document.dispatchEvent(new CustomEvent('potscope:search', { detail: { query } }));
}

function warmBoardCache() {
  fetchBoard().catch(() => {});
}

function bootstrap() {
  updateClock();
  window.setInterval(updateClock, 1000);
  elements.searchForm.addEventListener('submit', submitSearch);
  window.addEventListener('hashchange', renderRoute);
  window.PotScope = {
    routes: ['#/', '#/bounty/:slug', '#/bounty/:slug/leaderboard', '#/user/:handle', '#/builders'],
    current: () => activeRouteName,
  };
  warmBoardCache();
  renderRoute();
}

bootstrap();
