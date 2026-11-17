/**
 * The bounty board: the default route, drawn as a dense split view with the
 * board table on the left and the selected bounty's detail pane on the right.
 *
 * Filters and sorting run on the data already held, so a pill press never
 * causes a request. Selecting a row re-renders only the detail pane.
 *
 * @module views/board
 */

import { getBoard, getLeadersStrip } from '../api.js';
import {
  elapsedShare,
  formatMoney,
  formatNumber,
  formatRelative,
  formatTimeLeft,
  toNumber,
} from '../format.js';
import { el, emptyNote } from './common.js';
import { renderDetailPane } from './bounty.js';

const DASH = '—';
const TICKER_POLL_MS = 60_000;
const CLOSING_SOON_MS = 86_400_000;
const MOBILE_QUERY = '(max-width: 640px)';
const TICKER_LIMIT = 5;
const SECTION_LABELS = {
  live: 'Taking entries',
  soon: 'Opening soon',
  closed: 'Closed / awaiting results',
};

/**
 * First defined value among possible API spellings.
 * @param {Record<string, any>|null|undefined} source
 * @param {string[]} keys
 * @returns {any}
 */
function pick(source, keys) {
  if (!source) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

/**
 * A board row with the fields the table needs, parsed once.
 * @typedef {Object} BoardRow
 * @property {any} raw
 * @property {string} slug
 * @property {string} title
 * @property {string} category
 * @property {string[]} skills
 * @property {number|null} pot
 * @property {number|null} fee
 * @property {number|null} entries
 * @property {number|null} deadline
 * @property {number|null} published
 * @property {number|null} value
 * @property {'live'|'soon'|'closed'} state
 * @property {boolean} closingSoon
 */

/**
 * The value of each entry to the paid places: the live pot split across the
 * paid places, then divided by the entries. The one number the API omits.
 * @param {any} item
 * @returns {number|null}
 */
function valuePerEntry(item) {
  const pot = toNumber(pick(item, ['potUsd', 'pot', 'live_pot', 'pot_dollars']));
  const entries = toNumber(pick(item, ['submissionCount', 'entries', 'entry_count', 'submissions_count']));
  const rewards = pick(item, ['rewards_now', 'rewardsNow']);
  const paidPlaces = Array.isArray(rewards) && rewards.length > 0
    ? rewards.length
    : toNumber(pick(item, ['rewards_count', 'paid_places'])) ?? 0;
  if (pot === null || entries === null || !paidPlaces || entries <= 0) return null;
  return pot / paidPlaces / entries;
}

/**
 * Normalise one competition reply into a table row.
 * @param {any} item Competition object from the board endpoint.
 * @param {number} now
 * @returns {BoardRow}
 */
function toBoardRow(item, now) {
  const published = Date.parse(pick(item, ['published', 'published_at', 'publish_date', 'starts_at']) ?? '');
  const deadline = Date.parse(pick(item, ['deadline', 'ends_at', 'end']) ?? '');
  const deadlineValue = Number.isFinite(deadline) ? deadline : null;
  const publishedValue = Number.isFinite(published) ? published : null;
  let state = 'live';
  if (publishedValue !== null && publishedValue > now) state = 'soon';
  else if (deadlineValue !== null && deadlineValue <= now) state = 'closed';
  const skills = pick(item, ['skills', 'skill_tags', 'tags']);
  return {
    raw: item,
    slug: String(pick(item, ['slug']) ?? ''),
    title: String(pick(item, ['title', 'name']) ?? 'Untitled bounty'),
    category: String(pick(item, ['category', 'category_name']) ?? ''),
    skills: Array.isArray(skills) ? skills.map((skill) => String(skill)) : [],
    pot: toNumber(pick(item, ['potUsd', 'pot', 'live_pot', 'pot_dollars'])),
    fee: toNumber(pick(item, ['entryFeeUsd', 'entryFee', 'entry_fee', 'fee'])),
    entries: toNumber(pick(item, ['submissionCount', 'entries', 'entry_count', 'submissions_count'])),
    deadline: deadlineValue,
    published: publishedValue,
    value: valuePerEntry(item),
    state,
    closingSoon: state === 'live' && deadlineValue !== null && deadlineValue - now <= CLOSING_SOON_MS,
  };
}

/**
 * The one-line summary: taking entries, live dollars, entries, closing soon.
 * @param {BoardRow[]} rows
 * @returns {HTMLElement}
 */
function summaryStrip(rows) {
  const live = rows.filter((row) => row.state === 'live');
  const dollars = live.reduce((total, row) => total + (row.pot ?? 0), 0);
  const entries = live.reduce((total, row) => total + (row.entries ?? 0), 0);
  const closing = live.filter((row) => row.closingSoon).length;
  const strip = el('div', 'summary-strip');
  const part = (label, value, money = false) => {
    const span = el('span');
    span.append(el('b', money ? 'money' : '', value), document.createTextNode(` ${label}`));
    return span;
  };
  strip.append(
    part('taking entries', formatNumber(live.length)),
    part('in live pots', formatMoney(dollars), true),
    part('total entries', formatNumber(entries)),
    part('close in 24 hours', formatNumber(closing)),
  );
  strip.setAttribute('aria-label', 'Board summary');
  return strip;
}

/**
 * The live ticker. It starts from real standings the split pane holds and
 * appends a real event whenever the poll sees a submission count rise.
 * @returns {{node: HTMLElement, track: HTMLElement}}
 */
function tickerShell() {
  const shell = el('div', 'ticker');
  const label = el('span', 'ticker-label');
  label.append(el('span', 'dot'), document.createTextNode('Live entries'));
  const track = el('div', 'ticker-track');
  shell.append(label, track);
  return { node: shell, track };
}

/**
 * One ticker sentence with a real handle and a real relative time when the
 * reply carries one.
 * @param {string} handle
 * @param {string} title
 * @param {string|number|null|undefined} moment
 * @returns {HTMLElement}
 */
function tickerItem(handle, title, moment) {
  const item = el('span', 'ticker-item');
  item.append(document.createTextNode(`${handle} entered `));
  item.append(el('strong', '', title));
  if (moment) item.append(document.createTextNode(` · ${formatRelative(moment)}`));
  return item;
}

/**
 * Build one table row.
 * @param {BoardRow} row
 * @param {{selected: string, onSelect: (slug: string, focusRow?: boolean) => void}} options
 * @returns {HTMLTableRowElement}
 */
function boardRow(row, options) {
  const tr = document.createElement('tr');
  tr.dataset.slug = row.slug;
  tr.tabIndex = 0;
  tr.setAttribute('aria-selected', row.slug === options.selected ? 'true' : 'false');
  if (row.slug === options.selected) tr.classList.add('is-selected');
  if (row.fee) tr.classList.add('is-paid');
  if (row.state === 'soon') tr.classList.add('is-soon');
  if (row.state === 'closed') tr.classList.add('is-closed');
  tr.setAttribute('aria-label', `${row.title}${row.state === 'live' ? ', taking entries' : ''}`);

  const bountyCell = el('td', 'bounty-cell');
  bountyCell.dataset.label = 'Bounty';
  bountyCell.append(el('span', 'bounty-title', row.title));
  const meta = el('span', 'bounty-meta');
  if (row.category) meta.append(el('span', 'tag', row.category));
  for (const skill of row.skills.slice(0, 3)) meta.append(el('span', 'tag', skill));
  bountyCell.append(meta);

  const potCell = el('td', 'num-cell');
  potCell.dataset.label = 'Live pot';
  potCell.append(el('span', 'pot', row.pot === null ? DASH : formatMoney(row.pot)));

  const feeCell = el('td');
  feeCell.dataset.label = 'Fee';
  feeCell.append(row.fee ? el('span', 'fee-paid', formatMoney(row.fee)) : el('span', 'fee-free', 'FREE'));

  const timeCell = el('td');
  timeCell.dataset.label = 'Time left';
  const time = el('div', 'time-left', row.state === 'soon' ? 'Opens soon' : row.state === 'closed' ? 'Closed' : formatTimeLeft(row.deadline));
  const progress = el('div', 'progress');
  const fill = el('i');
  const share = row.published !== null && row.deadline !== null
    ? elapsedShare(row.published, row.deadline)
    : 0;
  fill.style.width = `${Math.round(share * 100)}%`;
  progress.append(fill);
  progress.setAttribute('aria-hidden', 'true');
  timeCell.append(time, progress);

  const entriesCell = el('td', 'num-cell');
  entriesCell.dataset.label = 'Entries';
  entriesCell.textContent = formatNumber(row.entries);

  const valueCell = el('td', 'num-cell');
  valueCell.dataset.label = 'Value / entry';
  valueCell.title = 'Live pot ÷ paid places ÷ entries';
  valueCell.textContent = row.value === null ? DASH : formatMoney(row.value);

  tr.append(bountyCell, potCell, feeCell, timeCell, entriesCell, valueCell);
  tr.addEventListener('click', () => options.onSelect(row.slug));
  tr.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      window.location.hash = `#/bounty/${encodeURIComponent(row.slug)}`;
    } else if (event.key === ' ' && event.target === tr) {
      event.preventDefault();
      options.onSelect(row.slug);
    }
  });
  return tr;
}

/**
 * A section header row, so the three groups stay inside one table.
 * @param {string} title
 * @param {number} count
 * @returns {HTMLTableRowElement}
 */
function sectionRow(title, count) {
  const tr = document.createElement('tr');
  tr.className = 'section-row';
  const th = document.createElement('th');
  th.colSpan = 6;
  th.scope = 'colgroup';
  const label = el('span', 'section-label');
  label.append(document.createTextNode(title), el('span', 'count', formatNumber(count)));
  th.append(label);
  tr.append(th);
  return tr;
}

/**
 * The select and the pill groups. Counts are computed from the rows the
 * current search and category leave, so a pill's number matches what a press
 * would show.
 * @param {{rows: BoardRow[], status: string, fee: string, sort: string, category: string, onChange: (patch: Record<string, string>) => void}} options
 * @returns {HTMLElement}
 */
function filtersBar(options) {
  const bar = el('div', 'filters');
  const live = options.rows.filter((row) => row.state === 'live');
  const statusCounts = {
    all: options.rows.length,
    live: live.length,
    closing: live.filter((row) => row.closingSoon).length,
    closed: options.rows.filter((row) => row.state === 'closed').length,
  };
  const group = (items) => {
    const box = el('div', 'filter-group');
    for (const item of items) {
      const button = el('button', `pill${item.value === item.active ? ' is-active' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', item.value === item.active ? 'true' : 'false');
      button.append(document.createTextNode(item.label));
      if (item.count !== undefined) button.append(el('span', 'count', formatNumber(item.count)));
      button.addEventListener('click', () => options.onChange(item.patch));
      box.append(button);
    }
    return box;
  };
  bar.append(group([
    { label: 'All', value: 'all', active: options.status, count: statusCounts.all, patch: { status: 'all' } },
    { label: 'Taking entries', value: 'live', active: options.status, count: statusCounts.live, patch: { status: 'live' } },
    { label: 'Closing soon', value: 'closing', active: options.status, count: statusCounts.closing, patch: { status: 'closing' } },
    { label: 'Closed', value: 'closed', active: options.status, count: statusCounts.closed, patch: { status: 'closed' } },
  ]));
  bar.append(group([
    { label: 'Any fee', value: 'any', active: options.fee, patch: { fee: 'any' } },
    { label: 'Free', value: 'free', active: options.fee, patch: { fee: 'free' } },
    { label: 'Paid', value: 'paid', active: options.fee, patch: { fee: 'paid' } },
  ]));
  const categories = [...new Set(options.rows.map((row) => row.category).filter(Boolean))].sort();
  if (categories.length > 1) {
    bar.append(group([
      { label: 'All categories', value: '', active: options.category, patch: { category: '' } },
      ...categories.map((category) => ({ label: category, value: category, active: options.category, patch: { category } })),
    ]));
  }
  const sortLabel = el('label', 'sort');
  sortLabel.append(document.createTextNode('Sort'));
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Sort bounties');
  for (const option of [
    ['closing', 'Closing soonest'],
    ['pot', 'Biggest pot'],
    ['entries', 'Most entries'],
    ['value', 'Best value per entry'],
  ]) {
    const node = document.createElement('option');
    node.value = option[0];
    node.textContent = option[1];
    if (option[0] === options.sort) node.selected = true;
    select.append(node);
  }
  select.addEventListener('change', () => options.onChange({ sort: select.value }));
  sortLabel.append(select);
  bar.append(sortLabel);
  return bar;
}

/**
 * Apply the current filters and sort, keeping the three sections apart.
 * @param {BoardRow[]} rows
 * @param {{status: string, fee: string, sort: string, category: string, query: string}} state
 * @returns {{visible: BoardRow[], groups: Record<'live'|'soon'|'closed', BoardRow[]>}}
 */
function shapeRows(rows, state) {
  const query = state.query.trim().toLowerCase();
  const visible = rows.filter((row) => {
    if (state.status === 'live' && row.state !== 'live') return false;
    if (state.status === 'closing' && !row.closingSoon) return false;
    if (state.status === 'closed' && row.state !== 'closed') return false;
    if (state.fee === 'free' && row.fee) return false;
    if (state.fee === 'paid' && !row.fee) return false;
    if (state.category && row.category !== state.category) return false;
    if (!query) return true;
    return [row.title, row.category, ...row.skills].join(' ').toLowerCase().includes(query);
  });
  const compare = {
    closing: (left, right) => (left.deadline ?? Infinity) - (right.deadline ?? Infinity),
    pot: (left, right) => (right.pot ?? -1) - (left.pot ?? -1),
    entries: (left, right) => (right.entries ?? -1) - (left.entries ?? -1),
    value: (left, right) => (right.value ?? -1) - (left.value ?? -1),
  }[state.sort] ?? (() => 0);
  const sorted = [...visible].sort(compare);
  return {
    visible,
    groups: {
      live: sorted.filter((row) => row.state === 'live'),
      soon: sorted.filter((row) => row.state === 'soon'),
      closed: sorted.filter((row) => row.state === 'closed'),
    },
  };
}

/**
 * The board route: summary, ticker, filters, table and the detail pane.
 * @param {import('../main.js').ViewContext} context
 * @returns {Promise<() => void>}
 */
export async function renderBoard(context) {
  const root = context.root;
  context.setTitle('Bounty board');
  document.title = 'make.fun — Bounty board';
  root.replaceChildren(el('div', 'sk'));

  const ticker = tickerShell();
  context.tickerSlot.replaceChildren(ticker.node);
  ticker.track.append(el('span', 'ticker-item muted', 'Loading live events from make.fun…'));

  const result = await getBoard();
  const items = pick(result.data, ['items', 'competitions', 'results']) ?? [];
  const rows = (Array.isArray(items) ? items : []).map((item) => toBoardRow(item, Date.now()));
  const counts = new Map(rows.map((row) => [row.slug, row.entries ?? 0]));
  const tickerEvents = [];
  const seenEntries = new Set();

  const split = el('div', 'split');
  const boardPane = el('section', 'board-pane');
  const detailPane = el('aside', 'detail-pane');
  const detailMount = el('div');
  detailPane.append(detailMount);
  detailPane.setAttribute('aria-label', 'Selected bounty');
  split.append(boardPane, detailPane);
  root.replaceChildren(summaryStrip(rows), split);

  const state = { status: 'all', fee: 'any', sort: 'closing', category: '', query: '', selected: '' };
  const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;
  let stopCountdown = null;
  let paneReady = Promise.resolve();

  const loadPane = (slug) => {
    paneReady = (async () => {
      if (typeof stopCountdown === 'function') stopCountdown();
      try {
        stopCountdown = await renderDetailPane({
          mount: detailMount,
          slug,
          navigate: context.navigate,
          announce: context.announce,
          onData: ({ standings }) => {
            prependStandings(standings, true);
            paintTicker();
          },
        });
      } catch {
        detailMount.replaceChildren(emptyNote('This bounty could not load. Pick another row or retry.'));
      }
      context.markReady();
    })();
    return paneReady;
  };

  const paintTicker = () => {
    ticker.track.replaceChildren();
    if (tickerEvents.length === 0) {
      ticker.track.append(el('span', 'ticker-item muted', 'Waiting for the next entry event from make.fun…'));
      return;
    }
    for (const item of tickerEvents.slice(0, TICKER_LIMIT)) ticker.track.append(item);
  };

  /**
   * Turn standings the poll did not hold before into real entry events.
   * @param {any[]} standings
   */
  const prependStandings = (standings, append = false) => {
    const fresh = [];
    for (const row of standings) {
      const handle = pick(row, ['handle', 'username', 'name']);
      const title = pick(row, ['title', 'submission_title']);
      const key = `${handle}|${title}`;
      if (!handle || seenEntries.has(key)) continue;
      seenEntries.add(key);
      fresh.push(tickerItem(String(handle), String(title ?? ''), pick(row, ['received', 'received_at', 'created_at'])));
    }
    if (fresh.length === 0) return;
    if (append) tickerEvents.push(...fresh.slice(0, TICKER_LIMIT));
    else tickerEvents.unshift(...fresh.slice(0, TICKER_LIMIT));
  };

  let tableWrap = null;
  let emptyBox = null;

  const selectRow = (slug, focusRow = false) => {
    state.selected = slug;
    for (const tr of boardPane.querySelectorAll('tbody tr[data-slug]')) {
      const active = tr.dataset.slug === slug;
      tr.classList.toggle('is-selected', active);
      tr.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active && focusRow) tr.focus();
    }
    loadPane(slug);
  };

  const moveSelection = (fromRow, direction) => {
    const all = [...boardPane.querySelectorAll('tbody tr[data-slug]')];
    const index = all.indexOf(fromRow);
    const next = all[index + direction];
    if (next) selectRow(next.dataset.slug, true);
  };

  const paintTable = () => {
    const previousFocus = document.activeElement?.dataset?.slug;
    const shaped = shapeRows(rows, state);
    if (!tableWrap) {
      const heading = el('h1', 'visually-hidden', 'Bounty board');
      const bar = el('div');
      const wrap = el('div', 'table-wrap');
      const table = el('table', 'board-table');
      const head = el('thead');
      const headRow = el('tr');
      for (const [label, hint] of [
        ['Bounty', ''],
        ['Live pot', ''],
        ['Fee', ''],
        ['Time left', ''],
        ['Entries', ''],
        ['Value / entry', 'Live pot ÷ paid places ÷ entries'],
      ]) {
        const th = el('th', '', label);
        th.scope = 'col';
        if (hint) th.title = hint;
        headRow.append(th);
      }
      head.append(headRow);
      table.append(head);
      wrap.append(table);
      boardPane.append(heading, bar, wrap);
      tableWrap = { bar, table };
      bar.append(filtersBar({
        rows,
        status: state.status,
        fee: state.fee,
        sort: state.sort,
        category: state.category,
        onChange: (patch) => {
          Object.assign(state, patch);
          paintTable();
        },
      }));
    } else {
      tableWrap.bar.replaceChildren(filtersBar({
        rows,
        status: state.status,
        fee: state.fee,
        sort: state.sort,
        category: state.category,
        onChange: (patch) => {
          Object.assign(state, patch);
          paintTable();
        },
      }));
    }

    const body = el('tbody');
    const order = ['live', 'soon', 'closed'];
    for (const key of order) {
      const group = shaped.groups[key];
      if (group.length === 0) continue;
      body.append(sectionRow(SECTION_LABELS[key], group.length));
      for (const row of group) {
        body.append(boardRow(row, { selected: state.selected, onSelect: (slug) => {
          if (isMobile()) {
            window.location.hash = `#/bounty/${encodeURIComponent(slug)}`;
            return;
          }
          selectRow(slug);
        } }));
      }
    }
    const table = tableWrap.table;
    table.querySelector('tbody')?.remove();
    table.append(body);
    body.addEventListener('keydown', (event) => {
      const tr = event.target.closest('tr[data-slug]');
      if (!tr) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(tr, 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(tr, -1);
      }
    });

    emptyBox?.remove();
    emptyBox = null;
    if (shaped.visible.length === 0) {
      const empty = el('div', 'filter-empty');
      empty.append(el('p', 'muted', state.query
        ? `No bounties match “${state.query}”.`
        : 'No bounties match these filters.'));
      const clear = el('button', 'btn btn-secondary', 'Clear filters');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        state.status = 'all';
        state.fee = 'any';
        state.category = '';
        state.query = '';
        paintTable();
      });
      empty.append(clear);
      boardPane.append(empty);
      emptyBox = empty;
    }

    const nextSelection = previousFocus && shaped.visible.some((row) => row.slug === previousFocus)
      ? previousFocus
      : firstLiveSlug(shaped, rows);
    if (nextSelection && nextSelection !== state.selected) {
      selectRow(nextSelection);
    } else {
      context.refreshStats();
    }
  };

  paintTable();
  paintTicker();
  await paneReady;

  const onSearch = (event) => {
    const query = String(event.detail?.query ?? '');
    if (event.detail?.submit && query.trim().startsWith('@')) return;
    state.query = query.replace(/^@/, '');
    paintTable();
  };
  window.addEventListener('potscope:search', onSearch);

  const poll = window.setInterval(async () => {
    try {
      const fresh = await getBoard();
      const freshItems = pick(fresh.data, ['items', 'competitions', 'results']) ?? [];
      for (const item of freshItems) {
        counts.set(String(pick(item, ['slug']) ?? ''), toNumber(pick(item, ['submissionCount', 'entries', 'entry_count', 'submissions_count'])) ?? 0);
      }
      if (state.selected) {
        const standingReply = await getLeadersStrip(state.selected).catch(() => null);
        const standings = pick(standingReply?.data ?? {}, ['standings', 'entries', 'rows']);
        if (Array.isArray(standings)) prependStandings(standings);
      }
      context.refreshStats();
    } catch {
      window.dispatchEvent(new CustomEvent('potscope:stale'));
    }
  }, TICKER_POLL_MS);

  return () => {
    window.clearInterval(poll);
    window.removeEventListener('potscope:search', onSearch);
    if (typeof stopCountdown === 'function') stopCountdown();
    context.tickerSlot.replaceChildren();
  };
}

/**
 * The row the board opens with: the paid showcase bounty when it is present,
 * else the first live bounty.
 * @param {{groups: Record<string, BoardRow[]>}} shaped
 * @param {BoardRow[]} rows
 * @returns {string}
 */
function firstLiveSlug(shaped, rows) {
  const paid = rows.find((row) => row.state === 'live' && row.fee);
  return paid?.slug ?? shaped.groups.live[0]?.slug ?? shaped.groups.soon[0]?.slug ?? shaped.groups.closed[0]?.slug ?? '';
}
