// Lazy detail views: a bounty leaderboard with client-side paging and search,
// metric-aware score columns, and the top-builders surface. The router loads
// this module only when one of those routes is visited.

import { API_ORIGIN, LIST_FRESH_MS, boardUrl, bountyUrl, cacheGet, fetchBoard, fetchCached, leaderboardUrl } from '../api.js';
import {
  buildPrizeIndex,
  loadBuilders,
  mergeLeaderboardRows,
  prizeForRow,
  readColumns,
  readRankKey,
} from '../api-detail.js';
import { formatDate, formatNumber } from '../format.js';
import {
  formatInterval,
  formatLeaderboardValue,
  formatPrize,
} from '../format-detail.js';
import { asList, escapeHtml, handleOf, pickFirst, toFiniteNumber } from './common.js';

const PAGE_SIZE = 50;
const INTERVAL_NOTE = '90 percent confidence interval';

function safeImageUrl(value) {
  const source = value && typeof value === 'object' ? (value.url ?? value.url_small ?? '') : value;
  const text = String(source ?? '').trim();
  if (!text) return '';
  if (text.startsWith('/')) return `${API_ORIGIN}${text}`;
  return /^https?:\/\//i.test(text) ? text : '';
}

// The anonymous cross-origin attribute is written before the source so the
// browser already holds it when it starts the image request.
function avatarMarkup(row, className = 'avatar') {
  if (row?.stub) return '';
  const url = safeImageUrl(pickFirst(row ?? {}, ['image', 'avatar', 'avatar_url', 'avatarUrl']));
  if (!url) return `<div class="${className}" aria-hidden="true"></div>`;
  return `<img class="${className}" crossorigin="anonymous" alt="" src="${escapeHtml(url)}">`;
}

function rankMarkup(rank) {
  const value = toFiniteNumber(rank);
  if (value === null || value < 1) return '<span class="rank-cell">—</span>';
  if (value <= 3) return `<span class="rank-cell"><span class="rank-medal rank-medal-${value}">${formatNumber(value)}</span></span>`;
  return `<span class="rank-cell">${formatNumber(value)}</span>`;
}

function readScoreColumn(columns, rankKey) {
  const list = asList(columns);
  const direct = list.find((column) => typeof column === 'object' && String(column.key ?? '') === rankKey);
  if (direct) return direct;
  const named = list.find((column) => /judge|win|elo|score|loss|profit/i.test(`${column?.key ?? ''} ${column?.title ?? ''}`));
  if (named) return named;
  return { key: rankKey || 'score', title: rankKey === 'elo' ? 'Elo' : '' };
}

function scoreLabel(rankKey, column) {
  const words = `${rankKey ?? ''} ${column?.title ?? ''} ${column?.key ?? ''}`.toLowerCase();
  if (/judge|win[_\s-]*rate|winrate/.test(words)) return 'Judge win rate';
  if (/\belo\b/.test(words)) return 'Elo';
  if (/\bloss\b/.test(words)) return 'Loss';
  if (column?.title) return String(column.title);
  return 'Score';
}

function intervalMarkup(row, column) {
  const interval = pickFirst(row, ['interval', 'confidence', 'confidence_interval', 'confidenceInterval']) ?? {};
  const values = row?.values && typeof row.values === 'object' ? row.values : {};
  const low = pickFirst(interval, ['low', 'min', 'lower']) ?? pickFirst(row, ['low', 'judge_low', 'judgeLow']) ?? pickFirst(values, ['judge_low', 'judgeLow', 'low']);
  const high = pickFirst(interval, ['high', 'max', 'upper']) ?? pickFirst(row, ['high', 'judge_high', 'judgeHigh']) ?? pickFirst(values, ['judge_high', 'judgeHigh', 'high']);
  const text = formatInterval(low, high, column);
  return text === '—' ? '' : `<span class="score-interval" title="${INTERVAL_NOTE}">${escapeHtml(text)}</span>`;
}

function validMarkup(row) {
  const values = row?.values && typeof row.values === 'object' ? row.values : {};
  const valid = values.valid ?? pickFirst(row, ['valid', 'is_valid', 'isValid', 'valid_entry', 'validEntry']);
  if (valid === true || toFiniteNumber(valid) === 1) return '<span class="valid-check" aria-label="Valid entry">✓</span>';
  return '';
}

function receivedOf(row) {
  return pickFirst(row, ['received_at', 'received', 'receivedAt', 'received_date', 'date', 'submitted_at']);
}

function rewardSource(payload, slug) {
  const competition = payload?.competition && typeof payload.competition === 'object' ? payload.competition : {};
  const directNow = competition.rewardsNow ?? payload?.rewardsNow;
  if (directNow) return directNow;
  const cachedBounty = cacheGet(bountyUrl(slug))?.data;
  const cachedCompetition = cachedBounty?.competition && typeof cachedBounty.competition === 'object' ? cachedBounty.competition : cachedBounty;
  const cachedNow = cachedCompetition?.rewardsNow;
  if (cachedNow) return cachedNow;
  const boardItems = cacheGet(boardUrl())?.data?.items;
  const boardCompetition = asList(boardItems).find((entry) => String(entry?.slug ?? '') === String(slug));
  if (boardCompetition?.rewardsNow) return boardCompetition.rewardsNow;
  return competition.rewards ?? payload?.rewards ?? cachedCompetition?.rewards ?? boardCompetition?.rewards;
}

function readChoices(payload, keys) {
  return asList(pickFirst(payload ?? {}, keys)).map((entry) => {
    if (typeof entry === 'string') return { key: entry, title: entry };
    return {
      key: String(pickFirst(entry ?? {}, ['key', 'name', 'slug', 'value']) ?? ''),
      title: String(pickFirst(entry ?? {}, ['title', 'label', 'name', 'key']) ?? ''),
    };
  }).filter((choice) => choice.key && !/cost|efficien/i.test(`${choice.key} ${choice.title}`));
}

// The phase and view controls come from the leaderboard response when it
// carries them, or from the competition's leaderboard info in the cached
// bounty payload. Cost and efficiency views always answer 404 when signed
// out, so readChoices filters those out.
function offeredChoices(payload, slug, keys, boardKeys) {
  const direct = readChoices(payload, keys);
  if (direct.length) return direct;
  const cachedBounty = cacheGet(bountyUrl(slug))?.data;
  const competition = cachedBounty?.competition && typeof cachedBounty.competition === 'object' ? cachedBounty.competition : cachedBounty;
  const board = pickFirst(competition ?? {}, ['leaderboard', 'leaderboard_info', 'leaderboardInfo', 'board']);
  return board && typeof board === 'object' ? readChoices(board, boardKeys) : [];
}

function leaderboardAddress(slug, state) {
  const base = leaderboardUrl(slug);
  const params = [];
  if (state.phasePicked && state.phase) params.push(`phase=${encodeURIComponent(state.phase)}`);
  if (state.viewPicked && state.view) params.push(`view=${encodeURIComponent(state.view)}`);
  return params.length ? `${base}&${params.join('&')}` : base;
}

function titleOf(payload, fallback) {
  const competition = payload?.competition && typeof payload.competition === 'object' ? payload.competition : {};
  return String(pickFirst(competition, ['title', 'name']) ?? pickFirst(payload ?? {}, ['title', 'competition_title', 'competitionTitle']) ?? fallback);
}

function pageNumbers(current, total) {
  const wanted = new Set([1, total, current - 1, current, current + 1]);
  return [...wanted].filter((page) => page >= 1 && page <= total).sort((left, right) => left - right);
}

export async function renderLeaderboard(root, context) {
  const slug = String(context.route?.slug ?? '');
  context.setTitle('Leaderboard');
  const state = { page: 1, query: '', phase: '', view: '', phasePicked: false, viewPicked: false };
  let payload = null;
  let rows = [];
  let scoreColumn = null;
  let prizes = new Map();
  let scoresVisible = true;
  let trueTotal = 0;
  let noticeText = '';

  root.innerHTML = `<div data-head></div><div class="notice" data-notice hidden></div>
    <div class="board-toolbar" data-toolbar hidden></div>
    <div data-rows></div><div class="pagination" data-pager></div>`;

  const head = root.querySelector('[data-head]');
  const notice = root.querySelector('[data-notice]');
  const toolbar = root.querySelector('[data-toolbar]');
  const rowsRegion = root.querySelector('[data-rows]');
  const pager = root.querySelector('[data-pager]');

  function showNotice(text) {
    noticeText = text;
    notice.textContent = text;
    notice.hidden = !text;
  }

  function filteredRows() {
    const query = state.query.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => `${handleOf(row)} ${pickFirst(row, ['title', 'entry_title', 'entryTitle']) ?? ''}`.toLowerCase().includes(query));
  }

  function paintHead() {
    const title = titleOf(payload, slug);
    head.innerHTML = `<div class="section-head"><div><h1>Leaderboard</h1>
      <p>${escapeHtml(title)} · ${formatNumber(trueTotal)} ranked</p></div>
      <a class="button button-secondary button-small" href="#/bounty/${encodeURIComponent(slug)}">Bounty page</a></div>`;
  }

  function toggleGroup(label, choices, key, current) {
    if (choices.length < 2) return '';
    return `<span class="filter-row-label">${escapeHtml(label)}</span><div class="toggle-group" role="group" aria-label="${escapeHtml(label)}">${choices.map((choice) => `<button type="button" class="toggle-option" data-toggle="${key}" data-value="${escapeHtml(choice.key)}" aria-pressed="${choice.key === current}">${escapeHtml(choice.title || choice.key)}</button>`).join('')}</div>`;
  }

  function paintToolbar() {
    const phases = offeredChoices(payload, slug, ['phases', 'windows'], ['phases', 'windows']);
    const views = offeredChoices(payload, slug, ['views', 'view_options', 'viewOptions'], ['views', 'view_options', 'viewOptions']);
    toolbar.innerHTML = `<input class="handle-search" type="search" placeholder="Find a handle" aria-label="Find a handle" value="${escapeHtml(state.query)}" spellcheck="false">
      ${toggleGroup('Phase', phases, 'phase', state.phase)}${toggleGroup('View', views, 'view', state.view)}
      <span class="board-total">${formatNumber(trueTotal)} ranked entries</span>`;
    toolbar.hidden = false;
  }

  function paintRows() {
    if (!scoresVisible) {
      rowsRegion.innerHTML = '<div class="held-note">Scores held until the final run</div>';
      pager.innerHTML = '';
      return;
    }
    const visible = filteredRows();
    const prizeMarkup = (row) => {
      const amount = prizeForRow(row, prizes);
      return amount === null ? '—' : formatPrize(amount);
    };
    const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * PAGE_SIZE;
    const slice = visible.slice(start, start + PAGE_SIZE);
    const label = scoreLabel(readRankKey(payload), scoreColumn);
    const body = slice.map((row) => {
      const rank = row.rank;
      const handle = handleOf(row);
      const entryTitle = pickFirst(row, ['title', 'entry_title', 'entryTitle']);
      return `<tr><td>${rankMarkup(rank)}</td>
        <td><div class="entrant-cell">${avatarMarkup(row)}<div>${handle ? `<a class="entrant-name" href="#/user/${encodeURIComponent(handle)}">@${escapeHtml(handle)}</a>` : '<span class="entrant-name">Anonymous</span>'}${entryTitle ? `<span class="entrant-entry" title="${escapeHtml(entryTitle)}">${escapeHtml(entryTitle)}</span>` : ''}</div></div></td>
        <td class="num"><span class="score-cell">${escapeHtml(formatLeaderboardValue(row, scoreColumn))}</span>${intervalMarkup(row, scoreColumn)}</td>
        <td class="num prize-cell">${escapeHtml(prizeMarkup(row))}</td>
        <td>${validMarkup(row)}</td>
        <td><span class="mono-date">${escapeHtml(formatDate(receivedOf(row)))}</span></td></tr>`;
    }).join('');
    rowsRegion.innerHTML = visible.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Entrant</th><th class="num">${escapeHtml(label)}</th><th class="num">Prize</th><th>Valid</th><th>Received</th></tr></thead><tbody>${body}</tbody></table></div>`
      : `<div class="empty-state"><h2>No handles match “${escapeHtml(state.query)}”</h2><p>Clear the search box to see every ranked entry.</p></div>`;
    paintPager(visible, pages, label);
  }

  function paintPager(visible, pages, label) {
    if (!visible.length) {
      pager.innerHTML = '';
      return;
    }
    const numbers = pageNumbers(state.page, pages);
    let buttons = '';
    let previous = 0;
    for (const page of numbers) {
      if (previous && page - previous > 1) buttons += '<span class="pager-info">…</span>';
      buttons += `<button type="button" class="page-button" data-page="${page}" aria-current="${page === state.page ? 'page' : 'false'}">${formatNumber(page)}</button>`;
      previous = page;
    }
    pager.innerHTML = `<button type="button" class="page-button" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''} aria-label="Previous page">Previous</button>${buttons}<button type="button" class="page-button" data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''} aria-label="Next page">Next</button><span class="pager-info">Page ${formatNumber(state.page)} of ${formatNumber(pages)} · ${formatNumber(visible.length)} ranked</span>`;
    pager.setAttribute('aria-label', `${label} pages`);
  }

  function paint() {
    paintHead();
    paintToolbar();
    paintRows();
    notice.hidden = !noticeText;
  }

  function accept(data) {
    payload = data;
    rows = mergeLeaderboardRows(data);
    scoreColumn = readScoreColumn(readColumns(data), readRankKey(data));
    prizes = buildPrizeIndex(rewardSource(data, slug));
    const phase = data?.phase && typeof data.phase === 'object' ? data.phase : {};
    const held = pickFirst(phase, ['scores_visible', 'scoresVisible', 'scores_live', 'scoresLive'])
      ?? pickFirst(data, ['scores_visible', 'scoresVisible', 'scores_live', 'scoresLive']);
    scoresVisible = held !== false;
    const competition = data?.competition && typeof data.competition === 'object' ? data.competition : {};
    trueTotal = rows.length
      || toFiniteNumber(pickFirst(data, ['total', 'total_rows', 'totalRows', 'total_entries', 'totalEntries', 'ranked', 'count']))
      || toFiniteNumber(pickFirst(competition, ['submissionCount'])) || 0;
    const offeredPhase = String(pickFirst(data, ['phase', 'current_phase']) ?? '');
    const offeredView = String(pickFirst(data, ['view', 'current_view']) ?? '');
    const phases = offeredChoices(data, slug, ['phases', 'windows'], ['phases', 'windows']);
    const views = offeredChoices(data, slug, ['views', 'view_options', 'viewOptions'], ['views', 'view_options', 'viewOptions']);
    if (!state.phasePicked && phases.length) {
      state.phase = phases.some((choice) => choice.key === offeredPhase) ? offeredPhase : phases[0].key;
    }
    if (!state.viewPicked && views.length) {
      state.view = views.some((choice) => choice.key === offeredView) ? offeredView : views[0].key;
    }
  }

  // A leaderboard deep link can paint before the warmed board cache lands, and
  // the leaderboard payload itself carries no rewards list. Await the shared
  // board fetch so the prize column fills from that competition's rewardsNow.
  async function fillPrizes() {
    if (prizes.size > 0) return;
    const board = await fetchBoard();
    const item = asList(board.data?.items).find((entry) => String(entry?.slug ?? '') === slug);
    if (item) prizes = buildPrizeIndex(asList(item.rewardsNow).length ? item.rewardsNow : item.rewards);
  }

  async function load() {
    const result = await fetchCached(leaderboardAddress(slug, state), { ttl: LIST_FRESH_MS });
    if (!context.isActive()) return;
    if (!result.data) {
      const missing = result.error?.status === 404;
      head.innerHTML = '<div class="section-head"><div><h1>Leaderboard</h1><p>Ranked entries for this bounty</p></div><a class="button button-secondary button-small" href="#/bounty/' + encodeURIComponent(slug) + '">Bounty page</a></div>';
      rowsRegion.innerHTML = `<div class="empty-state"><h2>${missing ? 'Leaderboard not found' : 'Leaderboard could not load'}</h2>
        <p>${missing ? 'No leaderboard exists at this address.' : 'The make.fun API did not answer just now. Try again shortly.'}</p>
        <p><button type="button" class="button button-primary" data-retry>Try again</button></p></div>`;
      pager.innerHTML = '';
      toolbar.hidden = true;
      showNotice('');
      return;
    }
    accept(result.data);
    await fillPrizes();
    if (!context.isActive()) return;
    showNotice(result.stale ? 'Showing the last loaded leaderboard while a fresh copy arrives.' : '');
    paint();
  }

  toolbar.addEventListener('input', (event) => {
    if (!event.target.matches('.handle-search')) return;
    state.query = event.target.value;
    state.page = 1;
    paintRows();
  });

  toolbar.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-toggle]');
    if (!button) return;
    const key = button.dataset.toggle;
    if (state[key] === button.dataset.value) return;
    state[key] = button.dataset.value;
    if (key === 'phase') state.phasePicked = true;
    if (key === 'view') state.viewPicked = true;
    state.page = 1;
    paintToolbar();
    rowsRegion.setAttribute('aria-busy', 'true');
    const result = await fetchCached(leaderboardAddress(slug, state), { ttl: LIST_FRESH_MS });
    if (!context.isActive()) return;
    rowsRegion.removeAttribute('aria-busy');
    if (result.data) {
      accept(result.data);
      await fillPrizes();
      if (!context.isActive()) return;
      showNotice(result.stale ? 'Showing the last loaded leaderboard while a fresh copy arrives.' : '');
      paint();
    } else {
      showNotice('That view could not be loaded. The current rows are unchanged.');
    }
  });

  pager.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    const page = toFiniteNumber(button.dataset.page);
    if (page === null) return;
    state.page = page;
    paintRows();
    root.scrollIntoView({ block: 'start' });
  });

  rowsRegion.addEventListener('click', (event) => {
    if (event.target.closest('[data-retry]')) load();
  });

  await load();
}

function builderRecord(row) {
  const record = pickFirst(row, ['record', 'stats', 'counts']);
  return record && typeof record === 'object' ? record : {};
}

export async function renderBuilders(root, context) {
  context.setTitle('Top Builders');
  root.innerHTML = `<div class="section-head"><div><h1>Leaderboard</h1><p>Top builders on make.fun</p></div></div>
    <div class="notice" data-notice hidden></div><div data-rows><p class="loading-line">Loading the top builders…</p></div>`;
  const notice = root.querySelector('[data-notice]');
  const region = root.querySelector('[data-rows]');

  const result = await loadBuilders();
  if (!context.isActive() || !result) return;
  if (!result.data) {
    const missing = result.error?.status === 404;
    region.innerHTML = `<div class="empty-state"><h2>${missing ? 'Rankings not found' : 'Rankings could not load'}</h2>
      <p>${missing ? 'The rankings endpoint answered not found.' : 'The make.fun API did not answer just now. Try again shortly.'}</p>
      <p><a class="button button-primary" href="#/">Back to the board</a></p></div>`;
    return;
  }
  notice.hidden = !result.stale;
  notice.textContent = result.stale ? 'Showing the last loaded rankings while a fresh copy arrives.' : '';
  const rows = result.rows;
  if (!rows.length) {
    region.innerHTML = '<div class="empty-state"><h2>No builders ranked yet</h2><p>The rankings list is empty right now.</p></div>';
    return;
  }
  const body = rows.map((row, index) => {
    const rank = toFiniteNumber(pickFirst(row, ['rank', 'position', 'place'])) ?? index + 1;
    const handle = handleOf(row);
    const verified = pickFirst(row, ['verified', 'is_verified', 'isVerified']) === true;
    const record = builderRecord(row);
    const entered = toFiniteNumber(record.competitions_entered);
    const placed = toFiniteNumber(record.competitions_placed);
    const won = toFiniteNumber(record.competitions_won);
    const best = toFiniteNumber(record.best_placement);
    const rewards = record.prize_usd;
    return `<tr><td>${rankMarkup(rank)}</td>
      <td><div class="builder-cell">${avatarMarkup(row)}<div>${handle ? `<a class="entrant-name" href="#/user/${encodeURIComponent(handle)}">@${escapeHtml(handle)}</a>` : '<span class="entrant-name">Anonymous</span>'}${verified ? '<span class="verified" aria-label="Verified builder">✓</span>' : ''}</div></div></td>
      <td class="num">${formatNumber(entered)}</td>
      <td class="num">${formatNumber(placed)}</td>
      <td class="num">${formatNumber(won)}</td>
      <td class="num">${best !== null && best >= 1 ? `#${formatNumber(best)}` : '—'}</td>
      <td class="num prize-cell">${escapeHtml(formatPrize(rewards))}</td>
      <td><a class="button button-secondary button-small" href="#/user/${encodeURIComponent(handle)}">View</a></td></tr>`;
  }).join('');
  region.innerHTML = `<div class="table-wrap"><table class="data-table builder-table"><thead><tr><th>Rank</th><th>Builder</th><th class="num">Entries</th><th class="num">Placed</th><th class="num">Won</th><th class="num">Best</th><th class="num">Rewards</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
}

