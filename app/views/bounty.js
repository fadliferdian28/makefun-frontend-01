/**
 * The bounty detail surface: the pane the board's split view shows beside the
 * table, and the full page at #/bounty/<slug>.
 *
 * Both faces read the same live competition reply, so the pot, the fee math
 * and the reward places can never drift apart.
 *
 * @module views/bounty
 */

import { MAKEFUN_ORIGIN, getBounty, getLeadersStrip } from '../api.js';
import { getBountyWithLeaderboard } from '../api-detail.js';
import {
  firstLine,
  formatDate,
  formatDateTime,
  formatDollars,
  formatMoney,
  formatNumber,
  formatScore,
  toNumber,
} from '../format.js';
import { formatCountdown, describeScoreColumn } from '../format-detail.js';
import {
  el,
  emptyNote,
  link,
  renderMarkdown,
  rewardsMathLine,
  rewardsTable,
  sectionBlock,
  statStrip,
} from './common.js';

const DASH = '—';
const DEFAULTS = {
  feePill: 'FREE',
  visibleRewardPlaces: 10,
  paneRewardPlaces: 5,
  previewRows: 5,
  activityRows: 5,
  kitLabel: 'Download the starter kit',
};
const COUNTDOWN_MS = 1_000;

/**
 * The first defined value among several possible API field spellings.
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

/** @param {any} bounty */
function entryCount(bounty) {
  return pick(bounty, ['submissionCount', 'entries', 'entry_count', 'submissions_count', 'submissions']);
}

/** @param {any} live */
function liveStandings(live) {
  const raw = pick(live, ['standings']);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const rows = pick(raw, ['rows']);
    return Array.isArray(rows) ? rows : [];
  }
  const fallback = pick(live, ['entries', 'rows']);
  return Array.isArray(fallback) ? fallback : [];
}

/** @param {any} bounty */
function rewardsNow(bounty) {
  const list = pick(bounty, ['rewards_now', 'rewardsNow', 'rewards']);
  if (!Array.isArray(list)) return [];
  return list.map((reward) => ({
    place: pick(reward, ['place']),
    base: pick(reward, ['baseUsd', 'base']),
    fee_share: pick(reward, ['feeShareUsd', 'fee_share']),
    amount: pick(reward, ['amountUsd', 'amount', 'total']),
  }));
}

/** @param {any} bounty */
function feeText(bounty) {
  const fee = toNumber(pick(bounty, ['entryFeeUsd', 'entryFee', 'entry_fee', 'fee']));
  return fee === null || fee === 0 ? DEFAULTS.feePill : formatDollars(fee);
}

/**
 * The public bounty address on make.fun, from whichever field the reply uses.
 * @param {any} bounty
 * @param {string} slug Fallback route segment.
 * @returns {string}
 */
function bountyAddress(bounty, slug) {
  const raw = pick(bounty, ['page', 'url', 'link', 'page_url', 'bounty_url']);
  if (typeof raw === 'string' && /^https?:\/\//.test(raw)) return raw;
  if (typeof raw === 'string' && raw.startsWith('/')) return `${MAKEFUN_ORIGIN}${raw}`;
  return `${MAKEFUN_ORIGIN}/bounty/${encodeURIComponent(slug)}`;
}

/** @param {any} bounty */
function bountyState(bounty) {
  const accepting = pick(bounty, ['accepting_submissions', 'acceptingSubmissions']);
  const deadline = Date.parse(pick(bounty, ['deadline', 'ends_at', 'end']) ?? '');
  if (accepting === false) return { live: false, label: 'CLOSED' };
  if (Number.isFinite(deadline)) return deadline > Date.now()
    ? { live: true, label: 'LIVE BOUNTY' }
    : { live: false, label: 'CLOSED' };
  return accepting === true ? { live: true, label: 'LIVE BOUNTY' } : { live: false, label: 'CLOSED' };
}

/**
 * Keep one or more countdown nodes in step with the clock.
 * @param {Array<{node: HTMLElement, deadline: string|number}>} targets
 * @returns {() => void} Stop function.
 */
function startCountdowns(targets) {
  const paint = () => {
    for (const target of targets) target.node.textContent = formatCountdown(target.deadline);
  };
  paint();
  const timer = window.setInterval(paint, COUNTDOWN_MS);
  return () => window.clearInterval(timer);
}

/** A shimmering skeleton for the detail pane. @returns {HTMLElement} */
export function detailSkeleton() {
  const panel = el('div', 'panel detail-skeleton');
  for (let index = 0; index < 5; index += 1) {
    const block = el('div', 'sk');
    block.style.height = index === 0 ? '58px' : '34px';
    block.style.margin = '10px 12px';
    panel.append(block);
  }
  panel.setAttribute('aria-hidden', 'true');
  return panel;
}

/**
 * The header block: the LIVE or CLOSED pill, the title and the first line of
 * the description.
 * @param {any} bounty
 * @returns {HTMLElement}
 */
function detailHeader(bounty, level = 1) {
  const head = el('header', 'detail-head');
  const state = bountyState(bounty);
  head.append(el('span', `status-pill ${state.live ? 'status-live' : 'status-closed'}`, state.label));
  const category = pick(bounty, ['category', 'category_name']);
  if (category) head.append(el('span', 'tag', String(category)));
  const holder = el('div');
  holder.append(head);
  holder.append(el(level === 1 ? 'h1' : 'h2', 'detail-title', String(pick(bounty, ['title', 'name']) ?? 'Bounty')));
  const subline = firstLine(pick(bounty, ['summary', 'description', 'tagline']), 190);
  if (subline) holder.append(el('p', 'detail-subline', subline));
  return holder;
}

/**
 * The four live stat cards plus the pot's fee breakdown.
 * @param {any} bounty
 * @param {string} slug
 * @returns {{node: HTMLElement, countdown: {node: HTMLElement, deadline: string|number}}}
 */
function detailStats(bounty, slug) {
  const pot = pick(bounty, ['potUsd', 'pot', 'live_pot', 'pot_dollars']);
  const feeTotal = pick(bounty, ['entryFeesUsd', 'entry_fees_total', 'entryFeesTotal', 'fee_total']);
  const feePayers = pick(bounty, ['entry_fee_payers', 'entryFeePayers', 'fee_payers']);
  const fee = pick(bounty, ['entryFeeUsd', 'entryFee', 'entry_fee', 'fee']);
  const deadline = pick(bounty, ['deadline', 'ends_at', 'end']) ?? '';
  const countdownNode = el('span', 'value', formatCountdown(deadline));
  const potHint = feeTotal !== undefined
    ? `${formatMoney(feeTotal)} from ${formatNumber(feePayers ?? 0)} entry fees`
    : `${formatDollars(pot)} live pot`;
  const feeHint = toNumber(fee) === null || toNumber(fee) === 0 ? 'Free to enter' : 'Paid entry';
  const entries = entryCount(bounty);
  const card = (label, valueNode, hint, accent) => {
    const cell = el('div', 'stat-card');
    cell.append(el('span', 'label', label), valueNode, el('span', 'hint', hint));
    if (accent) valueNode.classList.add('accent');
    return cell;
  };
  const strip = el('div', 'stat-strip');
  strip.append(
    card('Live pot', el('span', 'value', formatMoney(pot)), potHint, true),
    card('Entry fee', el('span', 'value', feeText(bounty)), feeHint, false),
    card('Time left', countdownNode, deadline ? `Closes ${formatDate(deadline)}` : 'No deadline given', false),
    card('Entries', el('span', 'value', formatNumber(entries)), 'Submissions in the pot', false),
  );
  return { node: strip, countdown: { node: countdownNode, deadline } };
}

/**
 * Enter, leaderboard and share, wired to real destinations.
 * @param {{bounty: any, slug: string, navigate?: (hash: string) => void, ranked?: number, announce?: (message: string) => void}} options
 * @returns {HTMLElement}
 */
function detailActions(options) {
  const { bounty, slug } = options;
  const row = el('div', 'action-row');
  const enter = link(bountyAddress(bounty, slug), 'Enter on make.fun', 'btn btn-primary');
  const leaderboard = link(
    `#/bounty/${encodeURIComponent(slug)}/leaderboard`,
    `Leaderboard${options.ranked ? ` · ${formatNumber(options.ranked)}` : ''}`,
    'btn btn-secondary',
  );
  const share = el('button', 'btn btn-secondary', 'Share');
  share.type = 'button';
  const note = el('span', 'copied-note');
  note.setAttribute('aria-live', 'polite');
  share.addEventListener('click', async () => {
    const address = window.location.href;
    try {
      await navigator.clipboard.writeText(address);
      note.textContent = 'Copied';
    } catch {
      note.textContent = 'Copy this page address';
    }
    window.setTimeout(() => { note.textContent = ''; }, 2_400);
    options.announce?.('Page address copied.');
  });
  row.append(enter, leaderboard, share, note);
  return row;
}

/**
 * The top-five standings preview, from the live competition snapshot.
 * @param {{standings: any[], metric: any, slug: string}} options
 * @returns {HTMLElement}
 */
function previewBlock(options) {
  const rows = Array.isArray(options.standings) ? options.standings.slice(0, DEFAULTS.previewRows) : [];
  const holder = el('div');
  if (rows.length === 0) {
    holder.append(emptyNote('No standings yet. The first scored entries will appear here.'));
  } else {
    for (const row of rows) {
      const line = el('div', 'preview-row');
      line.append(el('span', 'preview-rank num-cell', `#${formatNumber(pick(row, ['rank']) ?? DASH)}`));
      const middle = el('div');
      const handle = String(pick(row, ['handle', 'username', 'name']) ?? 'builder');
      middle.append(link(`#/user/${encodeURIComponent(handle)}`, handle, 'preview-handle'));
      const title = pick(row, ['title', 'submission_title', 'entry_title']);
      if (title) middle.append(el('span', 'preview-title', String(title)));
      line.append(middle);
      const values = pick(row, ['values']);
      const score = values && typeof values === 'object' && options.metric?.key
        && values[options.metric.key] !== undefined
        ? values[options.metric.key]
        : pick(row, ['value', 'score']);
      line.append(el('span', 'preview-score', formatScore(score, options.metric)));
      holder.append(line);
    }
  }
  return sectionBlock('Top 5 entries', holder, '', 'block preview-block');
}

/**
 * The three dated phases of the bounty, marking the one the clock sits in.
 * @param {any} bounty
 * @returns {HTMLElement}
 */
function timelineBlock(bounty) {
  const timeline = el('div', 'timeline');
  const declared = pick(bounty, ['phases']);
  const phases = Array.isArray(declared) && declared.length > 0
    ? declared.map((phase) => ({
      name: String(pick(phase, ['title', 'key', 'name']) ?? 'Phase'),
      moment: pick(phase, ['start', 'starts_at']),
      end: pick(phase, ['end', 'ends_at']),
      scores: pick(phase, ['scores_visible', 'scores']),
    }))
    : [
      { name: 'Opened', moment: pick(bounty, ['published', 'published_at', 'publish_date', 'starts_at', 'start']) },
      { name: 'Deadline', moment: pick(bounty, ['deadline', 'ends_at', 'end']) },
      { name: 'Results by', moment: pick(bounty, ['results_at', 'results_by', 'resolved_at']) },
    ];
  const now = Date.now();
  for (const phase of phases) {
    const cell = el('div', 'phase');
    const start = Date.parse(phase.moment ?? '');
    const end = Date.parse(phase.end ?? '');
    const current = Number.isFinite(start) && Number.isFinite(end)
      ? now >= start && now < end
      : Number.isFinite(start) && Math.abs(start - now) < 86_400_000;
    if (current) cell.classList.add('is-now');
    cell.append(el('span', 'phase-name', phase.name));
    cell.append(el('span', 'phase-date', phase.moment ? formatDate(phase.moment) : DASH));
    if (phase.scores === false) cell.append(el('span', 'phase-date', 'Scores held'));
    timeline.append(cell);
  }
  return timeline;
}

/**
 * The rewards block shared by the pane and the page.
 * @param {any} bounty
 * @param {number} [limit]
 * @returns {HTMLElement}
 */
function rewardsBlock(bounty, limit = DEFAULTS.visibleRewardPlaces) {
  const rewards = rewardsNow(bounty);
  const baseTotal = rewards.reduce((total, row) => total + (toNumber(row.base) ?? 0), 0);
  const feeTotal = rewards.reduce((total, row) => total + (toNumber(row.fee_share) ?? 0), 0);
  const node = rewardsTable({
    rewardsNow: rewards,
    pot: pick(bounty, ['potUsd', 'pot', 'live_pot', 'pot_dollars']),
    visibleLimit: limit,
    showAllLabel: `Show all ${formatNumber(rewards.length)} places`,
  });
  return sectionBlock(
    'Rewards',
    node,
    rewardsMathLine({
      pot: pick(bounty, ['potUsd', 'pot', 'live_pot', 'pot_dollars']),
      baseTotal: rewards.length ? baseTotal : null,
      feeTotal: rewards.length ? feeTotal : null,
    }),
    'block rewards-block',
  );
}

/**
 * The compact detail pane used by the board's split view. It renders only
 * into the mount it is given, so selecting another row never touches the
 * table.
 * @param {{mount: HTMLElement, slug: string, navigate?: (hash: string) => void, announce?: (message: string) => void, onData?: (payload: {bounty: any, standings: any[]}) => void}} options
 * @returns {Promise<() => void>} Cleanup for the countdown timers.
 */
export async function renderDetailPane(options) {
  const { mount, slug } = options;
  mount.replaceChildren(detailSkeleton());
  const [bountyResult, liveResult] = await Promise.all([
    getBounty(slug),
    getLeadersStrip(slug).catch(() => ({ data: null })),
  ]);
  const bounty = bountyResult.data ?? {};
  const live = liveResult?.data ?? {};
  const standings = liveStandings(live);
  const metric = describeScoreColumn(pick(bounty, ['leaderboard', 'leaderboard_info']));
  const ranked = pick(bounty, ['ranked_count', 'entries_ranked']) ?? (Array.isArray(standings) ? standings.length : 0);
  options.onData?.({ bounty, standings: Array.isArray(standings) ? standings : [] });

  const panel = el('div', 'panel');
  panel.append(detailHeader(bounty, 2));
  const body = el('div', 'detail-body');
  const stats = detailStats(bounty);
  body.append(stats.node);
  body.append(detailActions({ bounty, slug, navigate: options.navigate, ranked, announce: options.announce }));
  body.append(rewardsBlock(bounty, DEFAULTS.paneRewardPlaces));
  body.append(previewBlock({ standings, metric, slug }));
  body.append(sectionBlock('Dates', timelineBlock(bounty), '', 'block'));
  panel.append(body);
  mount.replaceChildren(panel);

  const stop = startCountdowns([stats.countdown]);
  return stop;
}

/**
 * Pull the first list of bullet points that follows a "Deliverables" heading.
 * @param {string|null|undefined} markdown
 * @returns {string[]}
 */
function deliverablesFrom(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const found = [];
  let collecting = false;
  for (const line of lines) {
    if (/^#{2,4}\s+deliverables?/i.test(line.trim())) {
      collecting = true;
      continue;
    }
    if (!collecting) continue;
    if (/^#{2,4}\s+/.test(line.trim())) break;
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (bullet) found.push(bullet[1].replace(/[`*]/g, '').trim());
    else if (found.length > 0 && line.trim() === '') break;
  }
  return found.slice(0, 8);
}

/**
 * The judging card: the resolution summary, criteria and metric.
 * @param {any} bounty
 * @returns {HTMLElement}
 */
function judgingBlock(bounty) {
  const resolution = pick(bounty, ['resolution', 'judging']) ?? {};
  const metric = pick(resolution, ['metric']) ?? {};
  const criteria = pick(resolution, ['criteria', 'criteria_list']);
  const grid = el('div', 'judge-grid');
  const summary = pick(resolution, ['summary', 'description']);
  const wrapper = el('div');
  if (summary) {
    const card = el('div', 'judge-card');
    card.append(el('b', '', 'How entries are read'), document.createTextNode(String(summary)));
    grid.append(card);
  }
  const metricName = pick(metric, ['name', 'title', 'key']);
  const metricUnit = pick(metric, ['unit']);
  if (metricName) {
    const card = el('div', 'judge-card');
    card.append(el('b', '', 'Metric'), document.createTextNode(
      `${metricName}${metricUnit ? ` · ${metricUnit}` : ''}`,
    ));
    grid.append(card);
  }
  if (Array.isArray(criteria) && criteria.length > 0) {
    const list = el('ul', 'checklist');
    for (const item of criteria.slice(0, 10)) {
      list.append(el('li', '', typeof item === 'string' ? item : String(pick(item, ['title', 'name', 'label']) ?? '')));
    }
    const card = el('div', 'judge-card');
    card.append(el('b', '', 'Criteria'), list);
    grid.append(card);
  }
  if (!summary && !metricName && (!Array.isArray(criteria) || criteria.length === 0)) {
    wrapper.append(emptyNote('The judging plan has not been published for this bounty yet.'));
  } else {
    wrapper.append(grid);
  }
  return sectionBlock('How it is judged', wrapper, '', 'block judging');
}

/**
 * The resolved winner card, shown only when the reply names a winner.
 * @param {any} bounty
 * @param {string} slug
 * @returns {HTMLElement|null}
 */
function winnerBlock(bounty, slug) {
  const winner = pick(bounty, ['winner']);
  if (!winner) return null;
  const card = el('div', 'winner-card');
  const place = pick(winner, ['place', 'placement', 'rank']);
  card.append(el('span', 'winner-place', place ? `#${formatNumber(place)}` : 'Winner'));
  const detail = el('div');
  const handle = pick(winner, ['handle', 'username']);
  if (handle) detail.append(link(`#/user/${encodeURIComponent(handle)}`, String(handle), 'preview-handle'));
  const title = pick(winner, ['title', 'submission_title']);
  if (title) detail.append(el('span', 'preview-title', String(title)));
  card.append(detail);
  const amount = pick(winner, ['prize', 'amount', 'prize_dollars']);
  if (amount !== undefined) card.append(el('span', 'preview-score', formatMoney(amount)));
  card.append(link(`#/bounty/${encodeURIComponent(slug)}/leaderboard`, 'Final results →', 'btn btn-secondary'));
  return sectionBlock('Winner', card, '', 'block');
}

/**
 * The in-page tab set. Every tab is a real button that toggles a panel and
 * never changes the route.
 * @param {Array<{label: string, content: Node}>} tabs
 * @returns {HTMLElement}
 */
function tabbedSections(tabs) {
  const wrapper = el('div', 'tab-wrap');
  const bar = el('div', 'tabs');
  bar.setAttribute('role', 'tablist');
  const panels = el('div');
  tabs.forEach((tab, index) => {
    const button = el('button', `tab${index === 0 ? ' is-active' : ''}`, tab.label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.id = `bounty-tab-${index}`;
    button.setAttribute('aria-controls', `bounty-panel-${index}`);
    button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    const panel = el('section', 'tab-panel');
    panel.id = `bounty-panel-${index}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    panel.hidden = index !== 0;
    panel.append(tab.content);
    button.addEventListener('click', () => {
      for (const other of bar.querySelectorAll('.tab')) {
        const active = other === button;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      for (const other of panels.querySelectorAll('.tab-panel')) other.hidden = other !== panel;
      button.focus();
    });
    bar.append(button);
    panels.append(panel);
  });
  wrapper.append(bar, panels);
  return wrapper;
}

/**
 * The full bounty page. It shares the pane's header, stats, rewards and top-5
 * preview, then adds tabs, judging, the kit link, the rules and a winner card.
 * @param {import('../main.js').ViewContext} context
 * @returns {Promise<() => void>}
 */
export async function renderBounty(context) {
  const slug = context.route.slug;
  const root = context.root;
  root.replaceChildren(detailSkeleton());
  const { bounty, leaderboard, stale } = await getBountyWithLeaderboard(slug);
  const liveMetric = describeScoreColumn(pick(bounty, ['leaderboard', 'leaderboard_info']));
  const entries = pick(leaderboard, ['entries', 'rows']) ?? [];
  const standings = entries.slice(0, DEFAULTS.previewRows);
  const title = String(pick(bounty, ['title', 'name']) ?? 'Bounty');
  context.setTitle(title);
  document.title = `make.fun — ${title}`;
  if (stale) window.dispatchEvent(new CustomEvent('potscope:stale'));

  const page = el('article', 'full-bounty');
  page.append(detailHeader(bounty));
  const body = el('div', 'detail-body');
  const stats = detailStats(bounty);
  body.append(stats.node);
  body.append(detailActions({ bounty, slug, navigate: context.navigate, announce: context.announce, ranked: pick(leaderboard, ['total', 'count']) }));

  const about = el('div', 'prose');
  about.innerHTML = renderMarkdown(pick(bounty, ['description'])) || '<p>No description published.</p>';
  const deliverables = deliverablesFrom(pick(bounty, ['description']));
  const checklist = el('ul', 'checklist');
  for (const item of deliverables) checklist.append(el('li', '', item));
  const overview = el('div');
  overview.append(sectionBlock('About', about, '', 'block'));
  if (deliverables.length > 0) overview.append(sectionBlock('Deliverables', checklist, '', 'block'));
  overview.append(rewardsBlock(bounty));

  const rulesText = pick(bounty, ['rules']);
  const rulesTab = el('div');
  const rulesProse = el('div', 'prose');
  rulesProse.innerHTML = rulesText ? renderMarkdown(rulesText) : '<p>No rules published.</p>';
  rulesTab.append(rulesProse);

  const activity = el('div');
  const newest = [...entries].slice(0, DEFAULTS.activityRows);
  if (newest.length === 0) activity.append(emptyNote('No entries recorded yet.'));
  for (const row of newest) {
    const line = el('div', 'preview-row');
    line.append(el('span', 'preview-rank num-cell', `#${formatNumber(pick(row, ['rank']) ?? DASH)}`));
    const middle = el('div');
    const handle = String(pick(row, ['handle', 'username']) ?? 'builder');
    middle.append(link(`#/user/${encodeURIComponent(handle)}`, handle, 'preview-handle'));
    middle.append(el('span', 'preview-title', formatDateTime(pick(row, ['received', 'received_at', 'created_at']))));
    line.append(middle);
    const activityMetric = describeScoreColumn(leaderboard);
    const activityValues = pick(row, ['values']);
    const activityScore = activityValues && typeof activityValues === 'object'
      && activityValues[activityMetric.key] !== undefined
      ? activityValues[activityMetric.key]
      : pick(row, ['value', 'score']);
    line.append(el('span', 'preview-score', formatScore(activityScore, activityMetric)));
    activity.append(line);
  }

  body.append(tabbedSections([
    { label: 'Overview', content: overview },
    { label: 'Rules', content: rulesTab },
    { label: 'Rewards', content: rewardsBlock(bounty) },
    { label: 'Activity', content: activity },
  ]));

  body.append(judgingBlock(bounty));
  const details = el('details', 'rules-details');
  details.append(el('summary', '', 'Full rules text'));
  const rulesBody = el('div', 'prose');
  rulesBody.innerHTML = rulesText ? renderMarkdown(rulesText) : '<p>No rules published.</p>';
  details.append(rulesBody);
  body.append(details);
  const kit = pick(bounty, ['kit_tarball', 'kit', 'kit_url']);
  if (typeof kit === 'string' && kit && !kit.startsWith('{')) {
    const kitRow = el('div', 'action-row');
    kitRow.append(link(kit.startsWith('http') ? kit : `${MAKEFUN_ORIGIN}${kit}`, DEFAULTS.kitLabel, 'btn btn-secondary'));
    body.append(sectionBlock('Build kit', kitRow, '', 'block'));
  }
  const winner = winnerBlock(bounty, slug);
  if (winner) body.append(winner);
  body.append(previewBlock({ standings, metric: liveMetric, slug }));
  body.append(link(`#/bounty/${encodeURIComponent(slug)}/leaderboard`, 'Full leaderboard →', 'btn btn-secondary'));

  page.append(body);
  root.replaceChildren(page);
  const stop = startCountdowns([stats.countdown]);
  context.markReady();
  return stop;
}
