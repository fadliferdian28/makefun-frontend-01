/**
 * The leaderboard surface for one bounty, and the top builders ranking that
 * shares its table language.
 *
 * The router imports this module lazily, so none of it counts in the first
 * load. Every row is rendered from the reply's full ranked list, stubs
 * included, and pagination keeps the DOM at one page of rows.
 *
 * @module views/leaderboard
 */

import { API_ROOT, MAKEFUN_ORIGIN, fetchCached, getBounty, getTopBuilders } from '../api.js';
import {
  formatDate,
  formatMoney,
  formatNumber,
  toNumber,
} from '../format.js';
import {
  describeScoreColumn,
  formatInterval,
  formatRankValue,
  medalClass,
} from '../format-detail.js';
import { el, emptyNote, link } from './common.js';

const DASH = '—';
const PAGE_SIZE = 50;
const LIST_CACHE_MS = 60_000;
const METRIC_LABELS = {
  judge: 'Judge win rate',
  elo: 'Elo',
  loss: 'Loss',
  score: 'Score',
};
const PHASE_LABELS = { development: 'Development', final: 'Final' };
const VIEW_LABELS = { overall: 'Overall', performance: 'Performance' };

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
 * The score column's human label, adapted from the reply's own descriptor.
 * @param {{key?: string, title?: string, unit?: string}} metric
 * @returns {string}
 */
function metricLabel(metric) {
  const key = `${metric.key} ${metric.title} ${metric.unit}`.toLowerCase();
  for (const [needle, label] of Object.entries(METRIC_LABELS)) {
    if (key.includes(needle)) return label;
  }
  return metric.title || 'Score';
}

/**
 * The option names a toggle can offer, from the reply's own lists. The API
 * may send plain strings or objects with a key.
 * @param {any} data
 * @param {string[]} keys
 * @returns {string[]}
 */
function optionNames(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((entry) => (typeof entry === 'string' ? entry : String(pick(entry, ['key', 'name', 'value']) ?? '')))
      .filter(Boolean);
  }
  return [];
}

/**
 * Build the prize lookup from the competition's rewards-now list.
 * @param {any} bounty
 * @returns {Map<number, string>}
 */
function prizeLookup(bounty) {
  const map = new Map();
  const sources = [bounty, pick(bounty, ['competition', 'bounty'])];
  for (const source of sources) {
    const rewards = pick(source, ['rewards_now', 'rewardsNow', 'rewards']);
    if (!Array.isArray(rewards)) continue;
    for (const reward of rewards) {
      const place = toNumber(pick(reward, ['place']));
      const amount = pick(reward, ['amountUsd', 'amount', 'total']);
      if (place !== null && amount !== undefined) map.set(place, formatMoney(amount));
    }
  }
  return map;
}

/**
 * One row's score for the active metric: whole rows carry it in values,
 * stub rows in value.
 * @param {any} row
 * @param {{key?: string}} metric
 * @returns {any}
 */
function rowScore(row, metric) {
  const values = pick(row, ['values']);
  if (values && typeof values === 'object' && metric?.key && values[metric.key] !== undefined) {
    return values[metric.key];
  }
  return pick(row, ['value', 'score']);
}

/**
 * A row's interval, from its own field or the metric's low/high columns.
 * @param {any} row
 * @param {{key?: string}} metric
 * @returns {{low?: any, high?: any}|null}
 */
function rowInterval(row, metric) {
  const interval = pick(row, ['interval']);
  if (interval && typeof interval === 'object') return interval;
  const values = pick(row, ['values']);
  if (values && typeof values === 'object' && metric?.key && values[`${metric.key}_low`] !== undefined) {
    return { low: values[`${metric.key}_low`], high: values[`${metric.key}_high`] };
  }
  return null;
}

/**
 * The record a rankings row nests its counts under, or the row itself.
 * @param {any} builder
 * @returns {any}
 */
function builderRecord(builder) {
  const record = pick(builder, ['record']);
  return record && typeof record === 'object' ? record : builder;
}

/**
 * A builder's win rate as a fraction: competitions won over competitions
 * entered. Null while the reply carries no usable counts.
 * @param {any} record
 * @returns {number|null}
 */
function builderWinRate(record) {
  const won = toNumber(pick(record, ['competitions_won', 'wins', 'won']));
  const entered = toNumber(pick(record, ['competitions_entered', 'entries', 'entered']));
  if (won === null || entered === null || entered <= 0) return null;
  return won / entered;
}

/**
 * The 90 percent Wilson score interval around a win rate, from the same
 * counts, as a fraction pair. Null while the rate or its sample is missing.
 * @param {number|null} rate
 * @param {any} record
 * @returns {{low: number, high: number}|null}
 */
function builderInterval(rate, record) {
  const entered = toNumber(pick(record, ['competitions_entered', 'entries', 'entered']));
  if (rate === null || entered === null || entered <= 0) return null;
  const z = 1.6448536269514722;
  const denominator = 1 + (z * z) / entered;
  const center = (rate + (z * z) / (2 * entered)) / denominator;
  const spread = (z / denominator) * Math.sqrt((rate * (1 - rate)) / entered + (z * z) / (4 * entered * entered));
  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) };
}

/**
 * A fraction as a percentage with two decimals.
 * @param {number|null} ratio
 * @returns {string}
 */
function percentText(ratio) {
  return ratio === null ? DASH : `${(ratio * 100).toFixed(2)}%`;
}

/**
 * The whole ranked list, whole rows plus stubs, filtered of unranked rows.
 * @param {any} data Leaderboard reply.
 * @returns {any[]}
 */
function fullRowList(data) {
  const entries = pick(data, ['entries', 'rows']);
  const stubs = pick(data, ['stubs', 'stub_rows', 'rest']);
  const list = [
    ...(Array.isArray(entries) ? entries : []),
    ...(Array.isArray(stubs) ? stubs : []),
  ];
  return list
    .filter((row) => toNumber(pick(row, ['rank'])) !== null)
    .sort((left, right) => toNumber(left.rank) - toNumber(right.rank));
}

/** @param {any} row */
function rowHandle(row) {
  return String(pick(row, ['handle', 'username', 'name']) ?? '');
}

/** @param {any} row */
function rowTitle(row) {
  return String(pick(row, ['title', 'submission_title', 'entry_title']) ?? '');
}

/**
 * A rank cell with the gold, silver and bronze medals done in CSS.
 * @param {number} rank
 * @returns {HTMLElement}
 */
function rankCell(rank) {
  const cell = el('td', 'rank-cell');
  const medal = medalClass(rank);
  if (medal) {
    const badge = el('span', `medal ${medal}`, formatNumber(rank));
    badge.title = `${['Gold', 'Silver', 'Bronze'][rank - 1]} place`;
    cell.append(badge);
  } else {
    cell.append(el('span', 'plain-rank', formatNumber(rank)));
  }
  return cell;
}

/**
 * The avatar, set with crossorigin before its source, as the API's resource
 * policy requires.
 * @param {any} row
 * @returns {HTMLImageElement|null}
 */
function avatarFor(row) {
  const image = pick(row, ['image', 'avatar', 'avatar_url']);
  if (typeof image !== 'string' || !image) return null;
  const img = document.createElement('img');
  img.className = 'avatar';
  img.alt = '';
  img.width = 24;
  img.height = 24;
  img.loading = 'lazy';
  img.crossOrigin = 'anonymous';
  img.src = image.startsWith('/') ? `${MAKEFUN_ORIGIN}${image}` : image;
  return img;
}

/**
 * One leaderboard row. Stub rows carry no avatar and no win record, so those
 * cells stay empty for them.
 * @param {{row: any, metric: any, prizes: Map<number, string>}} options
 * @returns {HTMLTableRowElement}
 */
function leaderboardRow(options) {
  const { row, metric, prizes } = options;
  const rank = toNumber(pick(row, ['rank']));
  const tr = el('tr');
  tr.append(rankCell(rank));

  const entrant = el('td');
  const box = el('div', 'entrant');
  const avatar = avatarFor(row);
  if (avatar) box.append(avatar);
  const identity = el('div');
  const handle = rowHandle(row);
  identity.append(handle ? link(`#/user/${encodeURIComponent(handle)}`, handle, 'entrant-name') : el('span', 'entrant-name'));
  const title = rowTitle(row);
  if (title) identity.append(el('span', 'entrant-title', title));
  box.append(identity);
  entrant.append(box);
  tr.append(entrant);

  const score = el('td', 'score-cell');
  score.append(document.createTextNode(formatRankValue(rowScore(row, metric), metric)));
  const interval = formatInterval(rowInterval(row, metric), metric);
  if (interval) score.append(el('span', 'interval', interval));
  tr.append(score);

  const prizeRank = toNumber(pick(row, ['prize_rank', 'prizeRank'])) ?? rank;
  const prize = prizes.get(prizeRank);
  tr.append(el('td', 'num-cell', prize ?? DASH));

  const values = pick(row, ['values']);
  const valid = pick(row, ['valid', 'is_valid'])
    ?? (values && typeof values === 'object' ? values.valid : undefined);
  const validCell = el('td');
  if (valid === true || valid === 1 || valid === '1') {
    const mark = el('span', 'valid-mark', '✓');
    mark.title = 'Valid entry';
    validCell.append(mark);
    validCell.setAttribute('aria-label', 'Valid');
  } else {
    validCell.append(document.createTextNode(DASH));
    validCell.setAttribute('aria-label', 'Not marked valid');
  }
  tr.append(validCell);

  const received = pick(row, ['received', 'received_at', 'created_at']);
  tr.append(el('td', 'num-cell', received ? formatDate(received) : DASH));
  return tr;
}

/**
 * The pager: previous, page numbers around the current page, next.
 * @param {{page: number, pages: number, onPage: (page: number) => void}} options
 * @returns {HTMLElement}
 */
function pager(options) {
  const bar = el('nav', 'pager');
  bar.setAttribute('aria-label', 'Leaderboard pages');
  const button = (label, page, disabled = false) => {
    const control = el('button', '', label);
    control.type = 'button';
    control.disabled = disabled;
    if (!disabled) control.addEventListener('click', () => options.onPage(page));
    return control;
  };
  bar.append(button('Prev', Math.max(options.page - 1, 1), options.page <= 1));
  const windowStart = Math.max(1, Math.min(options.page - 2, options.pages - 4));
  const windowEnd = Math.min(options.pages, windowStart + 4);
  if (windowStart > 1) bar.append(button('1', 1), el('span', 'muted', '…'));
  for (let page = windowStart; page <= windowEnd; page += 1) {
    const control = button(String(page), page);
    control.classList.toggle('is-current', page === options.page);
    control.setAttribute('aria-current', page === options.page ? 'page' : 'false');
    bar.append(control);
  }
  if (windowEnd < options.pages) bar.append(el('span', 'muted', '…'), button(String(options.pages), options.pages));
  bar.append(button('Next', Math.min(options.page + 1, options.pages), options.page >= options.pages));
  bar.append(el('span', 'pager-count', `Page ${formatNumber(options.page)} of ${formatNumber(options.pages)}`));
  return bar;
}

/**
 * Fetch one leaderboard view. Only the phase and view switches the reply
 * itself offers are ever sent; cost and efficiency are dropped because they
 * answer 404 when signed out.
 * @param {string} slug
 * @param {{phase?: string, view?: string}} state
 * @returns {Promise<any>}
 */
function loadLeaderboard(slug, state) {
  const params = new URLSearchParams({ rows: 'first' });
  if (state.phase) params.set('phase', state.phase);
  if (state.view) params.set('view', state.view);
  return fetchCached(
    `${API_ROOT}/competitions/${encodeURIComponent(slug)}/leaderboard?${params.toString()}`,
    LIST_CACHE_MS,
  );
}

/**
 * A phase or view toggle set. It appears only when the reply offers at least
 * two options, and every button refetches the one endpoint with the choice.
 * @param {{label: string, options: string[], active: string, names: Record<string, string>, onPick: (name: string) => void}} options
 * @returns {HTMLElement|null}
 */
function toggleGroup(options) {
  if (options.options.length < 2) return null;
  const group = el('div', 'filter-group');
  group.append(el('span', 'eyebrow', options.label));
  for (const name of options.options) {
    const button = el('button', `pill${name === options.active ? ' is-active' : ''}`, options.names[name] ?? name);
    button.type = 'button';
    button.setAttribute('aria-pressed', name === options.active ? 'true' : 'false');
    button.addEventListener('click', () => options.onPick(name));
    group.append(button);
  }
  return group;
}

/**
 * Render the leaderboard for the current bounty route.
 * @param {import('../main.js').ViewContext} context
 * @returns {Promise<() => void>}
 */
export async function renderLeaderboard(context) {
  const slug = context.route.slug;
  const root = context.root;
  root.replaceChildren(el('div', 'sk'));
  const state = { page: 1, query: '', phase: '', view: '' };
  let result = await loadLeaderboard(slug, state);
  const bountyResult = await getBounty(slug).catch(() => null);
  const bounty = bountyResult?.data ?? null;
  let data = result.data ?? {};
  const phases = optionNames(data, ['phases', 'phase_options']);
  const views = optionNames(data, ['views', 'view_options']).filter((name) => !/cost|efficiency/i.test(name));
  state.phase = phases.includes(String(data.phase)) ? String(data.phase) : '';
  state.view = views.includes(String(data.view)) ? String(data.view) : '';

  let metric = describeScoreColumn(data);
  let rows = fullRowList(data);
  let prizes = prizeLookup(bounty ?? data);
  let total = toNumber(pick(data, ['total', 'count', 'ranked_count'])) ?? rows.length;
  let scoresHeld = pick(data, ['scores_visible', 'scoresVisible']) === false;
  const title = String(pick(data, ['title', 'competition_title']) ?? pick(pick(data, ['competition', 'bounty']) ?? {}, ['title']) ?? slug);
  context.setTitle(`${title} leaderboard`);
  document.title = `make.fun — ${title} leaderboard`;
  if (result.stale) window.dispatchEvent(new CustomEvent('potscope:stale'));

  const page = el('div', 'leaderboard-page');
  const head = el('header', 'board-head');
  const heading = el('div');
  heading.append(el('p', 'eyebrow', 'Bounty leaderboard'));
  heading.append(el('h1', 'page-title', `${title} leaderboard`));
  const subline = el('p', 'page-subline');
  heading.append(subline);
  head.append(heading);

  const tools = el('div', 'board-tools');
  const searchLabel = el('label', 'visually-hidden', 'Find a handle');
  searchLabel.htmlFor = 'leaderboard-search';
  const search = document.createElement('input');
  search.id = 'leaderboard-search';
  search.type = 'search';
  search.placeholder = 'Find a handle';
  search.autocomplete = 'off';
  tools.append(searchLabel, search);
  const toggleBar = el('div', 'filter-group');
  tools.append(toggleBar);
  head.append(tools);
  page.append(head);

  const tableWrap = el('div', 'table-wrap');
  const table = el('table', 'rank-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Rank', 'Entrant', 'Score', 'Prize', 'Valid', 'Received']) {
    const th = el('th', '', label);
    th.scope = 'col';
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = el('tbody');
  table.append(tbody);
  tableWrap.append(table);
  page.append(tableWrap);
  const footer = el('div');
  page.append(footer);
  root.replaceChildren(page);

  const paintToggles = () => {
    toggleBar.replaceChildren();
    const phaseGroup = toggleGroup({
      label: 'Phase',
      options: phases,
      active: state.phase,
      names: PHASE_LABELS,
      onPick: (phase) => applyToggle({ phase }),
    });
    const viewGroup = toggleGroup({
      label: 'View',
      options: views,
      active: state.view,
      names: VIEW_LABELS,
      onPick: (view) => applyToggle({ view }),
    });
    if (phaseGroup) toggleBar.append(phaseGroup);
    if (viewGroup) toggleBar.append(viewGroup);
    toggleBar.hidden = !phaseGroup && !viewGroup;
  };

  const paint = () => {
    headRow.children[2].textContent = metricLabel(metric);
    subline.textContent = `${formatNumber(total)} ranked · ${formatNumber(rows.length)} listed · 90% intervals`;
    const matches = rows.filter((row) => {
      if (!state.query) return true;
      const needle = state.query.toLowerCase();
      return rowHandle(row).toLowerCase().includes(needle) || rowTitle(row).toLowerCase().includes(needle);
    });
    const pages = Math.max(Math.ceil(matches.length / PAGE_SIZE), 1);
    state.page = Math.min(state.page, pages);
    footer.replaceChildren();
    tbody.replaceChildren();
    paintToggles();
    if (scoresHeld) {
      tableWrap.replaceChildren(el('p', 'held-note', 'Scores held until the final run'));
      return;
    }
    tableWrap.replaceChildren(table);
    if (matches.length === 0) {
      footer.append(emptyNote(state.query ? `No handle matches “${state.query}”.` : 'No ranked entries yet.'));
      return;
    }
    const start = (state.page - 1) * PAGE_SIZE;
    for (const row of matches.slice(start, start + PAGE_SIZE)) {
      tbody.append(leaderboardRow({ row, metric, prizes }));
    }
    footer.append(pager({
      page: state.page,
      pages,
      onPage: (next) => {
        state.page = next;
        paint();
        tableWrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
    }));
  };

  const applyToggle = async (patch) => {
    Object.assign(state, patch, { page: 1 });
    tableWrap.replaceChildren(el('div', 'sk'));
    try {
      result = await loadLeaderboard(slug, state);
      data = result.data ?? {};
      metric = describeScoreColumn(data);
      rows = fullRowList(data);
      prizes = prizeLookup(bounty ?? data);
      total = toNumber(pick(data, ['total', 'count', 'ranked_count'])) ?? rows.length;
      scoresHeld = pick(data, ['scores_visible', 'scoresVisible']) === false;
      if (result.stale) window.dispatchEvent(new CustomEvent('potscope:stale'));
    } catch {
      window.dispatchEvent(new CustomEvent('potscope:stale'));
    }
    paint();
  };

  search.addEventListener('input', () => {
    state.query = search.value.trim();
    state.page = 1;
    paint();
  });

  paint();
  context.markReady();
  return () => {};
}

/**
 * The top builders page: the rankings reply as a ranked table with medals and
 * a profile link per row. There is no time filter because the API has none.
 * @param {import('../main.js').ViewContext} context
 * @returns {Promise<() => void>}
 */
export async function renderTopBuilders(context) {
  const root = context.root;
  root.replaceChildren(el('div', 'sk'));
  const result = await getTopBuilders(10);
  const data = result.data ?? {};
  const builders = pick(data, ['builders', 'items', 'rankings', 'rows']) ?? [];
  context.setTitle('Top builders');
  document.title = 'make.fun — Top builders';
  if (result.stale) window.dispatchEvent(new CustomEvent('potscope:stale'));

  const page = el('div', 'leaderboard-page');
  const head = el('header', 'board-head');
  const heading = el('div');
  heading.append(el('h1', 'page-title', 'Top builders'));
  heading.append(el('p', 'page-subline', 'Top builders on make.fun'));
  head.append(heading);
  page.append(head);

  const wrap = el('div', 'table-wrap');
  const table = el('table', 'rank-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Rank', 'Builder', 'Win rate', '90% interval', 'Entries', 'Rewards', '']) {
    const th = el('th', '', label);
    th.scope = 'col';
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = el('tbody');
  table.append(thead, tbody);
  wrap.append(table);
  page.append(wrap);

  const list = Array.isArray(builders) ? builders : [];
  if (list.length === 0) {
    wrap.replaceChildren(emptyNote('The builder rankings have not been published yet.'));
  }
  list.forEach((builder, index) => {
    const rank = toNumber(pick(builder, ['rank'])) ?? index + 1;
    const tr = el('tr');
    tr.append(rankCell(rank));
    const builderCell = el('td');
    const box = el('div', 'entrant');
    const avatar = avatarFor(builder);
    if (avatar) box.append(avatar);
    const identity = el('div');
    const handle = rowHandle(builder);
    const name = el('span', 'entrant-name');
    name.append(handle ? link(`#/user/${encodeURIComponent(handle)}`, handle) : document.createTextNode(DASH));
    const verified = pick(builder, ['verified', 'is_verified']);
    if (verified === true) {
      const check = el('span', 'verified', '✓');
      check.title = 'Verified builder';
      name.append(check);
    }
    identity.append(name);
    box.append(identity);
    builderCell.append(box);
    tr.append(builderCell);

    const record = builderRecord(builder);
    const winRate = builderWinRate(record);
    tr.append(el('td', 'num-cell', percentText(winRate)));
    const interval = builderInterval(winRate, record);
    tr.append(el('td', 'num-cell', interval
      ? `${percentText(interval.low)} – ${percentText(interval.high)}`
      : DASH));
    tr.append(el('td', 'num-cell', formatNumber(pick(record, ['competitions_entered', 'entries', 'entered']))));
    const rewards = pick(record, ['prize_usd', 'rewards', 'prize_dollars', 'winnings']);
    tr.append(el('td', 'num-cell', rewards === undefined ? DASH : formatMoney(rewards)));
    const action = el('td');
    if (handle) action.append(link(`#/user/${encodeURIComponent(handle)}`, 'View', 'btn btn-secondary'));
    tr.append(action);
    tbody.append(tr);
  });

  root.replaceChildren(page);
  context.markReady();
  return () => {};
}
