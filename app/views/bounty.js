// Bounty page: gradient header, live stat strip, in-page tabs, a rewards table
// with fee-share bars, phase timeline, judging summary, top five preview, the
// collapsible rules, an optional winner card, and a desktop sidebar.

import { fetchBounty } from '../api.js';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatRelativeTime, formatScore, formatTimeLeft, parseAmount } from '../format.js';
import { asList, escapeHtml, handleOf, parseTimestamp, pickFirst, toFiniteNumber, toIso } from './common.js';

const SECOND = 1_000;
const TABS = [['overview', 'Overview'], ['leaderboard', 'Leaderboard'], ['rules', 'Rules'], ['rewards', 'Rewards'], ['activity', 'Activity']];
const ICONS = {
  pot: '<circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12.5 6.6A5 5 0 1 1 9 17" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  fee: '<path d="M4 12h16M4 7h16M4 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  entry: '<circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

const icon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
const potOf = (item) => parseAmount(item?.potUsd);
const feeOf = (item) => parseAmount(item?.entryFeeUsd);
const feeTotalOf = (item) => parseAmount(item?.entryFeesUsd);
const titleOf = (item) => String(pickFirst(item, ['title', 'name']) ?? 'Bounty');
const slugOf = (item) => String(pickFirst(item, ['slug', 'competition_slug', 'id']) ?? '');
const deadlineOf = (item) => parseTimestamp(item?.deadline);
const publishOf = (item) => parseTimestamp(item?.publishedAt ?? item?.opensAt);
const resultsOf = (item) => parseTimestamp(item?.resolvedAt);
function entriesOf(item) {
  return toFiniteNumber(item?.submissionCount);
}
function isOpen(item, now) {
  const accepting = pickFirst(item, ['accepting_submissions', 'acceptingSubmissions', 'accepting']);
  if (typeof accepting === 'boolean') return accepting;
  const deadline = deadlineOf(item);
  return deadline !== null && deadline > now;
}

function rewardsOf(item) {
  return asList(item?.rewardsNow).map((row, index) => {
    const base = parseAmount(row?.baseUsd);
    const share = parseAmount(row?.feeShareUsd);
    const amount = parseAmount(row?.amountUsd) ?? (base ?? 0) + (share ?? 0);
    return { place: toFiniteNumber(row?.place) ?? index + 1, base, share, amount };
  }).sort((left, right) => left.place - right.place);
}

function standingsOf(item) {
  const board = pickFirst(item, ['leaderboard', 'standings', 'top_entries', 'topEntries']);
  if (Array.isArray(board)) return board;
  if (board && typeof board === 'object') {
    const rows = pickFirst(board, ['entries', 'rows', 'items', 'standings']);
    if (Array.isArray(rows)) return rows;
  }
  const submissions = pickFirst(item, ['submissions', 'entries']);
  return Array.isArray(submissions) ? submissions : [];
}

function judgeMetricOf(item) {
  const resolution = pickFirst(item ?? {}, ['resolution', 'judging']) ?? {};
  const metric = pickFirst(resolution, ['metric', 'metric_name', 'metricName']) ?? {};
  const words = typeof metric === 'object'
    ? `${metric.name ?? ''} ${metric.unit ?? ''}`
    : String(metric ?? '');
  return /millionth|judge|win[\s_-]*rate/i.test(`${words} ${resolution.unit ?? ''}`);
}

function scoreText(row, judge) {
  const direct = pickFirst(row, ['score_display', 'display', 'value_display']);
  const value = pickFirst(row, ['score', 'value', 'judge_score']);
  if (value && typeof value === 'object') return String(pickFirst(value, ['display', 'formatted']) ?? formatScore(pickFirst(value, ['value', 'score', 'judge'])));
  if (judge) return formatScore(value ?? direct);
  return direct !== undefined ? String(direct) : formatScore(value);
}

function renderInline(text) {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, target) => (/^https?:\/\//i.test(target) ? `<a href="${target.replace(/"/g, '&quot;')}" rel="noopener">${label}</a>` : label))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/[*_]{1,2}/g, '');
}

// Hand-rolled markdown: escape first, then headings, lists, emphasis, code,
// quotes, and links. Unhandled markers are stripped, never shown raw.
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let bullets = [];
  let numbers = [];
  let code = null;
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushLists = () => {
    if (bullets.length) out.push(`<ul>${bullets.map((line) => `<li>${renderInline(line)}</li>`).join('')}</ul>`);
    if (numbers.length) out.push(`<ol>${numbers.map((line) => `<li>${renderInline(line)}</li>`).join('')}</ol>`);
    bullets = [];
    numbers = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      flushParagraph(); flushLists();
      if (code === null) code = [];
      else { out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = null; }
      continue;
    }
    if (code !== null) { code.push(raw); continue; }
    if (!line) { flushParagraph(); flushLists(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph(); flushLists();
      const level = Math.min(3, Math.max(2, heading[1].length));
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2].replace(/#+$/, '').trim()).replace(/&amp;/g, '&'))}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    if (bullet) { flushParagraph(); if (numbers.length) flushLists(); bullets.push(bullet[1]); continue; }
    const ordered = line.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) { flushParagraph(); if (bullets.length) flushLists(); numbers.push(ordered[1]); continue; }
    if (line.startsWith('>')) { flushParagraph(); flushLists(); out.push(`<blockquote><p>${renderInline(line.replace(/^>\s?/, ''))}</p></blockquote>`); continue; }
    if (/^[-*_]{3,}$/.test(line)) { flushParagraph(); flushLists(); out.push('<hr />'); continue; }
    flushLists(); paragraph.push(line);
  }
  flushParagraph(); flushLists();
  if (code !== null) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return out.join('');
}

function plainText(source) {
  return String(source ?? '').replace(/^#{1,6}\s*/gm, '').replace(/^[-*+]\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_>#]/g, '').replace(/\s+/g, ' ').trim();
}

function deliverablesOf(item) {
  const lines = String(pickFirst(item, ['description', 'summary']) ?? '').split('\n');
  const start = lines.findIndex((line) => /deliverables/i.test(line));
  if (start === -1) return [];
  const found = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^#{1,4}\s/.test(line)) break;
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    if (bullet) found.push(plainText(bullet[1]));
    else if (found.length && line) break;
  }
  return found.filter(Boolean).slice(0, 8);
}

function criteriaOf(resolution) {
  return asList(pickFirst(resolution ?? {}, ['criteria', 'judging_criteria', 'rubric'])).map((entry) => {
    if (typeof entry === 'string') return entry;
    const label = pickFirst(entry, ['title', 'name', 'label', 'criterion']);
    const weight = pickFirst(entry, ['weight', 'share', 'percent']);
    return weight ? `${label} (${weight})` : String(label ?? '');
  }).filter(Boolean);
}

const statCard = (name, label, value, note) => `<div class="stat-card"><div class="stat-icon">${icon(name)}</div>
  <div class="stat-body"><span class="stat-label">${label}</span><span class="stat-value">${escapeHtml(value)}</span><span class="stat-note">${escapeHtml(note)}</span></div></div>`;

function statMarkup(item, now) {
  const fee = feeOf(item);
  const feeTotal = feeTotalOf(item);
  return statCard('pot', 'Live pot', formatMoney(potOf(item)), feeTotal !== null && feeTotal > 0 ? `Includes ${formatMoney(feeTotal)} in entry fees` : 'Base rewards, before fees')
    + statCard('fee', 'Entry fee', fee !== null ? formatMoney(fee) : 'Free', fee !== null ? 'Per paid entry' : 'Free to enter')
    + statCard('clock', 'Time left', formatTimeLeft(toIso(deadlineOf(item)), now), `Closes ${formatDate(toIso(deadlineOf(item)))}`)
    + statCard('entry', 'Entries', formatNumber(entriesOf(item)), 'Submissions received');
}

function rewardsMarkup(item) {
  const rewards = rewardsOf(item).slice(0, 20);
  if (!rewards.length) return '<p class="card-note">The API has not published a rewards breakdown for this bounty.</p>';
  const base = toFiniteNumber(item?.rewardAmount) ?? 0;
  const fees = feeTotalOf(item);
  const math = fees !== null ? `${formatMoney(base)} base + ${formatMoney(fees)} entry fees = ${formatMoney(potOf(item))} live pot` : `Live pot ${formatMoney(potOf(item))}, split across ${formatNumber(rewards.length)} paid places`;
  const max = Math.max(...rewards.map((row) => row.amount ?? 0), 1);
  const rows = rewards.map((row) => `<tr${row.place > 10 ? ' data-extra hidden' : ''}><td class="num">${formatNumber(row.place)}</td>
    <td class="num">${formatMoney(row.base)}</td><td class="num">${formatMoney(row.share)}</td><td class="num"><strong>${formatMoney(row.amount)}</strong></td>
    <td><span class="reward-bar" aria-hidden="true"><span class="base" style="width:${(((row.base ?? 0) / max) * 100).toFixed(1)}%"></span><span class="share" style="width:${(((row.share ?? 0) / max) * 100).toFixed(1)}%"></span></span></td></tr>`).join('');
  const toggle = rewards.some((row) => row.place > 10) ? '<button type="button" class="button button-secondary button-small" data-show-all>Show all 20 places</button>' : '';
  return `<p class="card-note">${escapeHtml(math)}</p><div class="table-wrap"><table class="data-table reward-table">
    <thead><tr><th class="num">Place</th><th class="num">Base</th><th class="num">Fee share</th><th class="num">Pays now</th><th>Share</th></tr></thead>
    <tbody>${rows}</tbody></table></div>${toggle}`;
}

function timelineMarkup(item, now) {
  const phases = asList(pickFirst(item, ['phases', 'windows']));
  const rows = phases.length ? phases.map((phase) => {
    const start = parseTimestamp(pickFirst(phase, ['start', 'starts_at', 'from']));
    const end = parseTimestamp(pickFirst(phase, ['end', 'ends_at', 'to']));
    return { title: String(pickFirst(phase, ['title', 'name', 'key']) ?? 'Phase'), start, end, live: start !== null && end !== null && start <= now && now < end };
  }) : [
    { title: 'Development window', start: publishOf(item), end: deadlineOf(item), live: isOpen(item, now) },
    { title: 'Results', start: deadlineOf(item), end: resultsOf(item), live: false },
  ];
  const markup = rows.map((row) => `<div class="phase${row.live ? ' phase-live' : ''}"><span class="phase-dot" aria-hidden="true"></span>
    <span class="phase-title">${escapeHtml(row.title)}</span><span class="phase-date">${escapeHtml(formatDate(toIso(row.start)))} – ${escapeHtml(formatDate(toIso(row.end)))}</span></div>`).join('');
  const scores = pickFirst(item, ['scores_visible', 'scoresVisible']);
  const note = typeof scores === 'boolean' && !scores ? 'Scores are held until the final run.' : 'Live scores update as judging proceeds.';
  return `<div class="timeline">${markup}</div><p class="card-note">${note}</p>`;
}

function judgingMarkup(item) {
  const resolution = pickFirst(item, ['resolution', 'judging']) ?? {};
  const summary = pickFirst(resolution, ['summary', 'description', 'text']);
  const criteria = criteriaOf(resolution);
  const metric = pickFirst(resolution, ['metric_name', 'metricName']) ?? pickFirst(item, ['metric_name', 'metric']);
  const unit = pickFirst(resolution, ['metric_unit', 'metricUnit']) ?? pickFirst(item, ['metric_unit', 'unit']);
  const metricLine = metric ? `<p class="card-note">Metric: <strong>${escapeHtml(String(metric))}</strong>${unit ? ` · ${escapeHtml(String(unit))}` : ''}</p>` : '';
  const checklist = criteria.length ? `<ul class="checklist">${criteria.map((entry) => `<li>${escapeHtml(String(entry))}</li>`).join('')}</ul>` : '';
  return `${summary ? `<div class="prose">${renderMarkdown(summary)}</div>` : ''}${metricLine}${checklist}`;
}

function topFiveMarkup(item) {
  const rows = standingsOf(item)
    .filter((row) => toFiniteNumber(pickFirst(row, ['rank', 'place', 'position'])) !== null)
    .sort((left, right) => toFiniteNumber(pickFirst(left, ['rank', 'place'])) - toFiniteNumber(pickFirst(right, ['rank', 'place'])))
    .slice(0, 5);
  if (!rows.length) return '<p class="card-note">No standings have been published yet.</p>';
  return `<div class="entry-list">${rows.map((row) => {
    const handle = handleOf(row);
    const rank = toFiniteNumber(pickFirst(row, ['rank', 'place', 'position']));
    const title = String(pickFirst(row, ['title', 'entry_title']) ?? 'Entry');
    return `<div class="entry-row"><span class="entry-rank">${formatNumber(rank)}</span><div class="entry-body">
      ${handle ? `<a class="entry-handle" href="#/user/${encodeURIComponent(handle)}">@${escapeHtml(handle)}</a>` : '<span class="entry-handle">Anonymous</span>'}
      <span class="entry-title">${escapeHtml(title)}</span></div><span class="entry-score">${escapeHtml(scoreText(row, judgeMetricOf(item)))}</span></div>`;
  }).join('')}</div>`;
}

function activityMarkup(item) {
  const rows = standingsOf(item).map((row) => ({ row, at: parseTimestamp(pickFirst(row, ['received_at', 'received', 'created_at', 'entered_at', 'date'])) }))
    .filter((entry) => entry.at !== null).sort((left, right) => right.at - left.at).slice(0, 5);
  if (!rows.length) return '<p class="card-note">No recent entry timestamps are available yet.</p>';
  return `<div class="entry-list">${rows.map(({ row, at }) => {
    const handle = handleOf(row);
    return `<div class="entry-row"><span class="entry-rank" aria-hidden="true">•</span><div class="entry-body">
      ${handle ? `<a class="entry-handle" href="#/user/${encodeURIComponent(handle)}">@${escapeHtml(handle)}</a>` : '<span class="entry-handle">Anonymous</span>'}
      <span class="entry-title">${escapeHtml(String(pickFirst(row, ['title', 'entry_title']) ?? 'Entered this bounty'))}</span></div>
      <span class="entry-score muted">${escapeHtml(formatRelativeTime(toIso(at), Date.now()))}</span></div>`;
  }).join('')}</div>`;
}

function winnerMarkup(item) {
  const winner = pickFirst(item, ['winner']);
  if (!winner || typeof winner !== 'object') return '';
  const handle = handleOf(winner);
  const title = pickFirst(winner, ['title', 'entry_title']);
  const place = toFiniteNumber(pickFirst(winner, ['placement', 'place', 'rank']));
  const amount = parseAmount(pickFirst(winner, ['amountUsd', 'amount']));
  return `<section class="card winner-card"><div class="card-head"><h2>Winner</h2>${place ? `<span class="status-pill status-soon">Place ${formatNumber(place)}</span>` : ''}</div>
    <p class="reward-big">${formatMoney(amount)}</p>${title ? `<p class="reward-meta">${escapeHtml(String(title))}</p>` : ''}
    ${handle ? `<p class="reward-meta">by <a href="#/user/${encodeURIComponent(handle)}">@${escapeHtml(handle)}</a></p>` : ''}
    <p class="button-row"><a class="button button-secondary button-small" href="#/bounty/${encodeURIComponent(slugOf(item))}/leaderboard">Final results</a></p></section>`;
}

function headerMarkup(item, open) {
  const summary = String(pickFirst(item, ['summary', 'subtitle']) ?? plainText(pickFirst(item, ['description']))).split('\n')[0];
  return `<section class="bounty-head"><div>${open ? '<span class="status-pill status-live">Live bounty</span>' : '<span class="status-pill status-closed">Closed</span>'}
    <h1>${escapeHtml(titleOf(item))}</h1><p class="subline">${escapeHtml(summary)}</p></div>
    <div class="bounty-head-art" aria-hidden="true"><svg viewBox="0 0 36 36" width="28" height="28" focusable="false"><path d="M13 9l-3 3 3 3M19 9l3 3-3 3M16.5 6l-2 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div></section>`;
}

function sidebarMarkup(item, now) {
  const status = isOpen(item, now) ? '<span class="live-dot">Live now</span>' : '<span class="status-pill status-closed">Closed</span>';
  const fee = feeOf(item);
  return `<div class="card"><div class="card-head"><h2>Rewards</h2>${status}</div>
    <p class="reward-big">${formatMoney(potOf(item))}</p>
    <p class="reward-meta">${formatNumber(entriesOf(item))} entries · ${fee !== null ? formatMoney(fee) : 'Free'} fee</p>
    <dl class="meta-list"><div><dt>Opens</dt><dd>${escapeHtml(formatDateTime(toIso(publishOf(item))))}</dd></div>
    <div><dt>Closes</dt><dd>${escapeHtml(formatDateTime(toIso(deadlineOf(item))))}</dd></div>
    <div><dt>Results by</dt><dd>${escapeHtml(formatDateTime(toIso(resultsOf(item))))}</dd></div></dl></div>
    <div class="card"><div class="card-head"><h2>Timeline</h2></div>${timelineMarkup(item, now)}</div>`;
}

function actionsMarkup(item) {
  const address = pickFirst(item, ['page_url', 'pageUrl', 'page', 'url', 'href']) ?? 'https://make.fun/';
  const kit = pickFirst(item, ['kit_tarball', 'kitTarball', 'kit_url', 'kit']);
  return `<a class="button button-primary" href="${escapeHtml(String(address))}" rel="noopener">Enter Bounty</a>
    <a class="button button-secondary" href="#/bounty/${encodeURIComponent(slugOf(item))}/leaderboard">View Leaderboard</a>
    <button type="button" class="button button-secondary" data-share>Share</button>
    ${kit ? `<a class="button button-ghost" href="${escapeHtml(String(kit))}" rel="noopener">Download kit</a>` : ''}`;
}

export async function renderBounty(root, context) {
  const slug = context.route.slug;
  context.setTitle('Bounty');
  root.innerHTML = '<p class="loading-line">Loading the bounty…</p>';
  const result = await fetchBounty(slug);
  if (!context.isActive()) return;
  if (!result.data) {
    const missing = result.error?.status === 404;
    root.innerHTML = `<div class="empty-state"><h2>${missing ? 'Bounty not found' : 'Bounty could not load'}</h2>
      <p>${missing ? 'No bounty exists at this address.' : 'The make.fun API did not answer just now. Try again shortly.'}</p>
      <p><a class="button button-primary" href="#/">Back to the board</a></p></div>`;
    return;
  }

  const item = result.data.competition ?? result.data;
  context.setTitle(titleOf(item));
  const now = Date.now();
  const notices = asList(pickFirst(item, ['notices'])).map(String);
  root.innerHTML = `${headerMarkup(item, isOpen(item, now))}
    ${notices.length ? `<div class="notice">${notices.map(escapeHtml).join(' ')}</div>` : ''}
    <div class="stat-row" data-stats>${statMarkup(item, now)}</div>
    <div class="button-row bounty-actions">${actionsMarkup(item)}</div>
    <div class="layout-split"><div class="main-column">
      <div class="tabs" role="tablist" aria-label="Bounty sections">${TABS.map(([key, label], index) => `<button type="button" class="tab" role="tab" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${index === 0}" data-tab="${key}">${label}</button>`).join('')}</div>
      <div class="tab-panel" role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" data-panel="overview">
        <section class="card"><div class="card-head"><h2>About this bounty</h2></div>${pickFirst(item, ['description', 'summary']) ? `<div class="prose">${renderMarkdown(pickFirst(item, ['description', 'summary']))}</div>` : '<p class="card-note">No description was published.</p>'}
          ${deliverablesOf(item).length ? `<h2>Deliverables</h2><ul class="checklist">${deliverablesOf(item).map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>` : ''}</section>
        <section class="card"><div class="card-head"><h2>Rewards</h2><span class="card-note">${formatMoney(potOf(item))} live pot</span></div><div data-rewards>${rewardsMarkup(item)}</div></section>
        <section class="card"><div class="card-head"><h2>How it is judged</h2></div>${judgingMarkup(item)}</section></div>
      <div class="tab-panel" role="tabpanel" id="panel-leaderboard" aria-labelledby="tab-leaderboard" data-panel="leaderboard" hidden>
        <section class="card"><div class="card-head"><h2>Top 5 entries</h2><a href="#/bounty/${encodeURIComponent(slug)}/leaderboard">Full leaderboard</a></div>${topFiveMarkup(item)}</section>
        <section class="card"><div class="card-head"><h2>Standings</h2></div><p class="card-note">The full ranked table lives on its own page.</p>
          <a class="button button-primary" href="#/bounty/${encodeURIComponent(slug)}/leaderboard">Open the leaderboard</a></section></div>
      <div class="tab-panel" role="tabpanel" id="panel-rules" aria-labelledby="tab-rules" data-panel="rules" hidden>
        <section class="card"><div class="card-head"><h2>Rules</h2></div><details class="details"><summary>Read the full rules</summary>
          <div class="details-body prose">${pickFirst(item, ['rules']) ? renderMarkdown(pickFirst(item, ['rules'])) : '<p>No rules text was published for this bounty.</p>'}</div></details></section></div>
      <div class="tab-panel" role="tabpanel" id="panel-rewards" aria-labelledby="tab-rewards" data-panel="rewards" hidden>
        <section class="card"><div class="card-head"><h2>Rewards</h2></div>${rewardsMarkup(item)}</section></div>
      <div class="tab-panel" role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" data-panel="activity" hidden>
        <section class="card"><div class="card-head"><h2>Recent entries</h2></div>${activityMarkup(item)}</section></div>
    </div><aside class="side-column">${sidebarMarkup(item, now)}</aside></div>${winnerMarkup(item)}`;

  const stats = root.querySelector('[data-stats]');
  const countdown = window.setInterval(() => {
    if (context.isActive()) stats.innerHTML = statMarkup(item, Date.now());
  }, SECOND);
  const tabs = [...root.querySelectorAll('[data-tab]')];
  const panels = [...root.querySelectorAll('[data-panel]')];
  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      for (const button of tabs) button.setAttribute('aria-selected', String(button.dataset.tab === tab.dataset.tab));
      for (const panel of panels) panel.hidden = panel.dataset.panel !== tab.dataset.tab;
    }
    const showAll = event.target.closest('[data-show-all]');
    if (showAll) {
      for (const row of root.querySelectorAll('tr[data-extra]')) row.hidden = false;
      showAll.hidden = true;
    }
    const share = event.target.closest('[data-share]');
    if (share) {
      const done = () => {
        share.textContent = 'Copied';
        window.setTimeout(() => { share.textContent = 'Share'; }, 1500);
      };
      navigator.clipboard?.writeText(location.href).then(done, done);
    }
  });
  context.signal.addEventListener('abort', () => window.clearInterval(countdown), { once: true });
}
