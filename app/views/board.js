// Bounty board: compact hero, live stat cards, summary strip, one-line entry
// ticker, client-side filters, and live, opening-soon, and closed sections.

import { fetchBoard } from '../api.js';
import { formatMoney, formatNumber, formatRelativeTime, formatTimeLeft } from '../format.js';
import { asList, escapeHtml, handleOf, parseTimestamp, readCompetition, toIso } from './common.js';

const DAY = 86_400_000;
const POLL_MS = 60_000;
const ROTATE_MS = 5_000;

const ICONS = {
  trophy: '<path d="M8 4h8v3a4 4 0 0 1-8 0V4Z" fill="currentColor"/><path d="M6 5H3.5v1.5A3.5 3.5 0 0 0 7 10M18 5h2.5v1.5A3.5 3.5 0 0 1 17 10M10 13h4v3h-4zM8 20h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  coins: '<circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12.5 6.6A5 5 0 1 1 9 17" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  entries: '<circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};
const TROPHY = '<path d="M30 16h12v5a6 6 0 0 1-12 0v-5Z" fill="#0f9d63"/><path d="M26 17h-5v4a6 6 0 0 0 6 6M46 17h5v4a6 6 0 0 1-6 6" fill="none" stroke="#d9a514" stroke-width="3" stroke-linecap="round"/><path d="M33 27h6v7h-6z" fill="#d9a514"/><path d="M27 40h18M31 36h10v4H31z" fill="none" stroke="#0a6b45" stroke-width="3" stroke-linecap="round"/><path d="M36 9l1.6 3.4L41 14l-3.4 1.6L36 19l-1.6-3.4L31 14l3.4-1.6L36 9Z" fill="#d9a514"/>';
const icon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

const isLive = (item, now) => item.deadline !== null && item.deadline > now && (item.publish === null || item.publish <= now);
const isSoon = (item) => item.publish !== null && item.publish > Date.now();
const isClosingSoon = (item, now) => item.deadline !== null && item.deadline > now && item.deadline - now <= DAY;
const isClosed = (item, now) => item.deadline !== null && item.deadline <= now;
const placesOf = (item) => item.rewards.length;
const valuePerEntry = (item) => (item.pot === null || !item.entries || !item.rewards.length ? null : item.pot / item.rewards.length / item.entries);
const sumPot = (items) => items.reduce((total, item) => total + (item.pot ?? 0), 0);
const sumEntries = (items) => items.reduce((total, item) => total + (item.entries ?? 0), 0);

const statCard = (name, label, value, note) => `<div class="stat-card"><div class="stat-icon">${icon(name)}</div>
  <div class="stat-body"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-note">${note}</span></div></div>`;

const heroMarkup = () => `<section class="hero"><div class="hero-copy">
  <h1>Discover and Compete on <span>make.fun</span> Bounties</h1>
  <p>Build amazing AI agents, win rewards, and climb the leaderboard</p></div>
  <div class="hero-art" aria-hidden="true"><svg viewBox="0 0 72 72" width="72" height="72" focusable="false">${TROPHY}</svg></div></section>`;

function statMarkup(items, now) {
  return statCard('trophy', 'Total bounties', formatNumber(items.length), 'Every listing')
    + statCard('coins', 'Total rewards', formatMoney(sumPot(items)), 'Live pots, in dollars')
    + statCard('entries', 'Total entries', formatNumber(sumEntries(items)), 'Submissions received')
    + statCard('clock', 'Closing soon', formatNumber(items.filter((item) => isClosingSoon(item, now)).length), 'Within 24 hours');
}

function summaryMarkup(items, now) {
  const live = items.filter((item) => isLive(item, now));
  const piece = (value, label) => `<span><b>${value}</b> ${label}</span>`;
  return piece(formatNumber(live.length), 'taking entries')
    + piece(formatMoney(sumPot(live)), 'in live pots')
    + piece(formatNumber(sumEntries(live)), 'entries so far')
    + piece(formatNumber(items.filter((item) => isClosingSoon(item, now)).length), 'close in 24 hours');
}

function filterMarkup(state, items, now) {
  const pill = (group, value, label, count) => `<button type="button" class="pill" data-filter="${group}" data-value="${escapeHtml(value)}" aria-pressed="${state[group] === value}">${escapeHtml(label)}${count === undefined ? '' : `<span class="count">${formatNumber(count)}</span>`}</button>`;
  const statuses = [['all', 'All', items.length], ['live', 'Taking entries', items.filter((item) => isLive(item, now)).length], ['soon', 'Closing soon', items.filter((item) => isClosingSoon(item, now)).length], ['closed', 'Closed', items.filter((item) => isClosed(item, now)).length]];
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const categoryRow = categories.length ? `<div class="filter-row"><span class="filter-row-label">Category</span>${pill('category', 'all', 'All')}${categories.map((name) => pill('category', name, name)).join('')}</div>` : '';
  return `<div class="filter-row"><span class="filter-row-label">Status</span>${statuses.map(([value, label, count]) => pill('status', value, label, count)).join('')}<span class="result-count">${formatNumber(items.length)} bounties</span></div>
    <div class="filter-row"><span class="filter-row-label">Fee</span>${pill('fee', 'any', 'Any')}${pill('fee', 'free', 'Free')}${pill('fee', 'paid', 'Paid')}
    <select class="filter-select" data-sort aria-label="Sort bounties">${[['closing', 'Closing soonest'], ['pot', 'Biggest pot'], ['entries', 'Most entries'], ['value', 'Best value per entry']].map(([value, label]) => `<option value="${value}"${state.sort === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div>${categoryRow}`;
}

function matches(item, state, now) {
  if (state.category !== 'all' && item.category !== state.category) return false;
  if (state.fee === 'free' && item.fee !== null && item.fee > 0) return false;
  if (state.fee === 'paid' && (item.fee === null || item.fee <= 0)) return false;
  if (state.status === 'live' && !isLive(item, now)) return false;
  if (state.status === 'soon' && !isClosingSoon(item, now)) return false;
  if (state.status === 'closed' && !isClosed(item, now)) return false;
  return !state.query || [item.title, item.slug, item.category, ...item.skills].join(' ').toLowerCase().includes(state.query);
}

function compare(left, right, sort) {
  if (sort === 'pot') return (right.pot ?? -1) - (left.pot ?? -1);
  if (sort === 'entries') return (right.entries ?? -1) - (left.entries ?? -1);
  if (sort === 'value') return (valuePerEntry(right) ?? -1) - (valuePerEntry(left) ?? -1);
  return (left.deadline ?? Infinity) - (right.deadline ?? Infinity);
}

function rowMarkup(item, now) {
  const elapsed = item.publish !== null && item.deadline !== null && item.deadline > item.publish ? Math.min(100, Math.max(0, ((now - item.publish) / (item.deadline - item.publish)) * 100)) : 0;
  const bar = elapsed > 0 ? `<span class="time-bar" aria-hidden="true"><span style="width:${elapsed.toFixed(1)}%"></span></span>` : '';
  return `<tr${item.fee !== null && item.fee > 0 ? ' class="row-paid"' : ''}>
    <td class="bounty-cell"><a class="bounty-title" href="#/bounty/${encodeURIComponent(item.slug)}">${escapeHtml(item.title)}</a>
    <span class="meta-line">${item.category ? `<span class="category-pill">${escapeHtml(item.category)}</span>` : ''}${item.skills.slice(0, 3).map((skill) => `<span class="skill-tag">${escapeHtml(skill)}</span>`).join('')}</span></td>
    <td class="num"><span class="pot">${formatMoney(item.pot)}</span></td>
    <td>${item.fee !== null && item.fee > 0 ? `<span class="fee-paid">${formatMoney(item.fee)}</span>` : '<span class="fee-free">FREE</span>'}</td>
    <td><span class="time-left${item.deadline !== null && item.deadline <= now ? ' closed' : ''}">${escapeHtml(formatTimeLeft(toIso(item.deadline), now))}</span>${bar}</td>
    <td class="num">${formatNumber(item.entries)}</td>
    <td class="num"><span class="value-entry" title="Live pot divided by paid places, then divided by entries">${formatMoney(valuePerEntry(item))}${placesOf(item) ? `<small>${formatNumber(placesOf(item))} places</small>` : ''}</span></td></tr>`;
}

function sectionMarkup(label, note, items, now, state) {
  const rows = items.slice().sort((left, right) => compare(left, right, state.sort)).map((item) => rowMarkup(item, now)).join('');
  return `<div class="section-label">${label}</div><div class="section-head"><p>${note}</p></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Bounty</th><th class="num">Live pot</th><th>Fee</th><th>Time left</th><th class="num">Entries</th><th class="num">Value / entry</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty-cell">No bounties here match the filters.</td></tr>'}</tbody></table></div>`;
}

function sectionsMarkup(items, state, now) {
  const visible = items.filter((item) => matches(item, state, now));
  const live = visible.filter((item) => isLive(item, now));
  const soon = visible.filter((item) => isSoon(item));
  const closed = visible.filter((item) => isClosed(item, now));
  if (!live.length && !soon.length && !closed.length) return '<div class="empty-state"><h2>No bounties match these filters</h2><p>Clear a status, fee, or category pill to see the whole board.</p></div>';
  let markup = sectionMarkup('Live bounties', 'Taking entries right now.', live, now, state);
  if (soon.length) markup += sectionMarkup('Opening soon', 'Scheduled bounties whose publish date is still ahead.', soon, now, state);
  if (closed.length) markup += sectionMarkup('Closed / awaiting results', 'The deadline has passed; results may still be pending.', closed, now, state);
  return markup;
}

function initialEvents(payload) {
  const found = [];
  for (const row of asList(payload?.activity ?? payload?.recent_entries)) {
    const time = parseTimestamp(row?.created_at ?? row?.entered_at ?? row?.date);
    if (time !== null) found.push({ handle: handleOf(row), title: String(row?.competition_title ?? row?.title ?? 'a bounty'), time });
  }
  return found.sort((left, right) => right.time - left.time).slice(0, 5);
}

export async function renderBoard(root, context) {
  context.setTitle('Bounty Board');
  const state = { status: 'all', fee: 'any', category: 'all', sort: 'closing', query: '' };
  let items = [];
  let events = [];
  let tick = 0;
  let previous = new Map();
  let noticeText = '';

  root.innerHTML = `${heroMarkup()}<div class="stat-row" data-stats></div><div class="summary-strip" data-summary></div>
    <div data-notice></div><div class="filters" data-filters></div><div data-sections></div>`;
  const stats = root.querySelector('[data-stats]');
  const summary = root.querySelector('[data-summary]');
  const notice = root.querySelector('[data-notice]');
  const filters = root.querySelector('[data-filters]');
  const sections = root.querySelector('[data-sections]');

  function paintTicker() {
    const line = context.ticker?.line;
    if (!line) return;
    if (events.length) {
      const event = events[tick % events.length];
      const who = event.handle ? `<strong>@${escapeHtml(event.handle)}</strong> entered ` : 'New entry on ';
      line.innerHTML = `${who}<strong>${escapeHtml(event.title)}</strong> <span class="muted">${escapeHtml(formatRelativeTime(toIso(event.time), Date.now()))}</span>`;
      return;
    }
    const next = items.filter((item) => isLive(item, Date.now())).sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity))[0];
    const tail = next ? ` · next close <strong>${escapeHtml(next.title)}</strong> in <strong>${escapeHtml(formatTimeLeft(toIso(next.deadline), Date.now()))}</strong>` : '';
    line.innerHTML = `Watching <strong>${formatNumber(items.length)}</strong> bounties · <strong>${formatNumber(sumEntries(items))}</strong> entries received${tail}`;
  }

  function paint() {
    const now = Date.now();
    stats.innerHTML = statMarkup(items, now);
    summary.innerHTML = summaryMarkup(items, now);
    filters.innerHTML = filterMarkup(state, items, now);
    sections.innerHTML = sectionsMarkup(items, state, now);
    notice.innerHTML = noticeText;
  }

  function accept(payload) {
    const next = (Array.isArray(payload) ? payload : asList(payload?.items ?? payload?.competitions)).map(readCompetition);
    for (const item of next) {
      const before = previous.get(item.slug);
      if (before !== undefined && item.entries !== null && item.entries > before) events.unshift({ handle: '', title: item.title, time: Date.now() });
    }
    previous = new Map(next.map((item) => [item.slug, item.entries ?? 0]));
    events = events.slice(0, 5);
    if (!events.length) events = initialEvents(payload);
    items = next;
    paint();
    paintTicker();
  }

  filters.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state[button.dataset.filter] = button.dataset.value;
    paint();
  });
  filters.addEventListener('change', (event) => {
    if (!event.target.matches('[data-sort]')) return;
    state.sort = event.target.value;
    paint();
  });
  const onSearch = (event) => {
    state.query = String(event.detail?.query ?? '').trim().toLowerCase();
    paint();
  };
  document.addEventListener('potscope:search', onSearch);

  const result = await fetchBoard();
  if (!context.isActive()) {
    document.removeEventListener('potscope:search', onSearch);
    return;
  }
  if (!result.data) {
    noticeText = `<div class="notice notice-error">${result.error?.status === 404 ? 'The board endpoint answered not found.' : 'The live board could not be loaded. Check the connection and try again.'}</div>`;
    paint();
    document.removeEventListener('potscope:search', onSearch);
    return;
  }
  if (result.stale) noticeText = '<div class="notice">Showing the last board while a fresh copy loads.</div>';
  accept(result.data);

  const poll = window.setInterval(async () => {
    if (!context.isActive()) return;
    const fresh = await fetchBoard();
    if (context.isActive() && fresh.data) accept(fresh.data);
  }, POLL_MS);
  const rotate = window.setInterval(() => { tick += 1; paintTicker(); }, ROTATE_MS);
  context.signal.addEventListener('abort', () => {
    window.clearInterval(poll);
    window.clearInterval(rotate);
    document.removeEventListener('potscope:search', onSearch);
  }, { once: true });
}
