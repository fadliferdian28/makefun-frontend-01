/**
 * A builder's public profile: the identity card with five record boxes, the
 * links row, recent activity, the entries table and the payouts panel.
 *
 * The router imports this module lazily. Everything it prints comes from one
 * profile reply; whatever the reply omits stays a dash.
 *
 * @module views/profile
 */

import { MAKEFUN_ORIGIN } from '../api.js';
import { getBuilderProfile } from '../api-detail.js';
import {
  firstLine,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatScore,
  toNumber,
} from '../format.js';
import { formatPlacement } from '../format-detail.js';
import { el, emptyNote, link, sectionBlock } from './common.js';

const DASH = '—';
const ACTIVITY_LIMIT = 5;
const DASH_LABELS = {
  entered: 'Entered',
  placed: 'Placed',
  won: 'Won',
  best: 'Best Place',
  rewards: 'Total Rewards',
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
 * The public profile address on make.fun.
 * @param {string} handle
 * @returns {string}
 */
function profileAddress(handle) {
  return `${MAKEFUN_ORIGIN}/u/${encodeURIComponent(handle)}`;
}

/**
 * A 90 percent interval from a profile record, if one is present.
 * @param {any} record
 * @returns {string}
 */
function intervalText(record) {
  const interval = pick(record, ['interval']);
  if (!interval) return '';
  const low = toNumber(pick(interval, ['low']));
  const high = toNumber(pick(interval, ['high']));
  if (low === null || high === null) return '';
  return `${formatNumber(low)} – ${formatNumber(high)}`;
}

/**
 * The identity card: avatar, handle, verification, bio and the make.fun link.
 * @param {any} profile
 * @param {string} handle
 * @returns {HTMLElement}
 */
function identityCard(profile, handle) {
  const card = el('section', 'panel identity-card');
  const top = el('div', 'identity-top');
  const avatar = document.createElement('img');
  avatar.className = 'identity-avatar';
  avatar.alt = '';
  avatar.width = 64;
  avatar.height = 64;
  avatar.decoding = 'async';
  const rawSource = pick(profile, ['image', 'avatar', 'avatar_url']);
  const source = rawSource && typeof rawSource === 'object'
    ? pick(rawSource, ['url', 'url_small'])
    : rawSource;
  if (typeof source === 'string' && source) {
    avatar.crossOrigin = 'anonymous';
    avatar.src = source.startsWith('/') ? `${MAKEFUN_ORIGIN}${source}` : source;
  }
  top.append(avatar);
  const names = el('div');
  const heading = el('h1', 'identity-handle');
  heading.append(document.createTextNode(String(handle)));
  const verified = pick(profile, ['verified', 'is_verified']);
  if (verified === true) {
    const check = el('span', 'verified', '✓');
    check.title = 'Verified builder';
    heading.append(check);
  }
  names.append(heading);
  const display = pick(profile, ['display_name', 'displayName', 'name']);
  if (display && String(display) !== handle) names.append(el('p', 'muted', String(display)));
  top.append(names);
  card.append(top);

  const bio = pick(profile, ['bio']);
  if (bio) card.append(el('p', 'identity-bio', firstLine(bio, 240)));
  const joined = pick(profile, ['joined', 'joined_at', 'created_at']);
  if (joined) card.append(el('p', 'identity-bio', `Joined ${formatDate(joined)}`));
  card.append(link(profileAddress(handle), 'View on make.fun', 'btn btn-primary'));

  const record = pick(profile, ['record', 'stats']) ?? {};
  const boxes = el('div', 'stat-boxes');
  const values = [
    [DASH_LABELS.entered, pick(record, ['competitions_entered', 'entered', 'competitions'])],
    [DASH_LABELS.placed, pick(record, ['competitions_placed', 'placed'])],
    [DASH_LABELS.won, pick(record, ['competitions_won', 'won'])],
    [DASH_LABELS.best, pick(record, ['best_placement', 'best_place', 'best'])],
    [DASH_LABELS.rewards, pick(record, ['prize_usd', 'prize_dollars', 'rewards', 'total_rewards'])],
  ];
  for (const [label, raw] of values) {
    const box = el('div', 'stat-box');
    box.append(el('span', 'label', label));
    let text = DASH;
    if (raw !== undefined && raw !== null) {
      if (label === DASH_LABELS.best) text = formatPlacement(raw);
      else if (label === DASH_LABELS.rewards) text = formatMoney(raw);
      else text = formatNumber(raw);
    }
    box.append(el('span', 'value', text));
    boxes.append(box);
  }
  card.append(boxes);

  const linksRow = el('div', 'link-row');
  const addLink = (label, href) => linksRow.append(link(href, label));
  const github = pick(profile, ['github_login', 'github']);
  if (github) addLink('GitHub', `https://github.com/${encodeURIComponent(String(github))}`);
  const discord = pick(profile, ['discord', 'discord_handle']);
  if (discord) addLink('Discord', String(discord).startsWith('http') ? String(discord) : `https://discord.com/users/${encodeURIComponent(String(discord))}`);
  const x = pick(profile, ['x_handle', 'x', 'twitter']);
  if (x) addLink('X', `https://x.com/${encodeURIComponent(String(x).replace(/^@/, ''))}`);
  const explorer = pick(profile, ['explorer_address', 'explorer']);
  if (explorer) addLink('Wallet', String(explorer));
  const interval = intervalText(record);
  if (linksRow.children.length > 0 || interval) {
    if (interval) linksRow.append(el('span', 'muted', `90% interval ${interval}`));
    card.append(linksRow);
  }
  return card;
}

/**
 * The competition name from an activity record: the reply nests it as an
 * object, so read its title, never interpolate the object itself.
 * @param {any} item
 * @returns {string|null}
 */
function activityName(item) {
  const value = pick(item, ['competition_title', 'competition', 'bounty']);
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const title = pick(value, ['title', 'name', 'slug']);
    return typeof title === 'string' ? title : null;
  }
  const title = pick(item, ['title', 'name']);
  return typeof title === 'string' ? title : null;
}

/**
 * The five most recent real events from the solutions and payouts lists.
 * @param {any} profile
 * @returns {HTMLElement[]}
 */
function recentActivity(profile) {
  const solutions = pick(profile, ['solutions', 'entries']);
  const payouts = pick(profile, ['payouts', 'claimed']);
  const events = [];
  if (Array.isArray(solutions)) {
    for (const solution of solutions) {
      const moment = pick(solution, ['entered', 'entered_at', 'created_at', 'submitted_at']);
      if (!moment) continue;
      events.push({
        kind: 'Entered',
        competition: String(activityName(solution) ?? 'a bounty'),
        moment,
      });
    }
  }
  if (Array.isArray(payouts)) {
    for (const payout of payouts) {
      const moment = pick(payout, ['paid', 'paid_at', 'date']);
      if (!moment) continue;
      events.push({
        kind: 'Won',
        competition: String(activityName(payout) ?? 'a bounty'),
        moment,
        amount: pick(payout, ['amount_usd', 'amount', 'amount_dollars']),
      });
    }
  }
  events.sort((left, right) => Date.parse(right.moment) - Date.parse(left.moment));
  return events.slice(0, ACTIVITY_LIMIT).map((event) => {
    const row = el('div', 'activity-row');
    const phrase = el('div');
    phrase.append(el('span', `activity-kind${event.kind === 'Won' ? ' is-win' : ''}`, event.kind));
    phrase.append(document.createTextNode(event.competition));
    if (event.kind === 'Won' && event.amount !== undefined) {
      phrase.append(document.createTextNode(` · ${formatMoney(event.amount)}`));
    }
    row.append(phrase);
    row.append(el('time', 'activity-when', formatDateTime(event.moment)));
    return row;
  });
}

/**
 * The metric a solution's score belongs to, from its own column descriptor.
 * @param {any} solution
 * @returns {{key?: string, title?: string, unit?: string}|null}
 */
function solutionMetric(solution) {
  const column = pick(solution, ['column', 'score_column', 'scoreColumn', 'metric']);
  const score = pick(solution, ['score']);
  const descriptor = (column && typeof column === 'object' ? column : null)
    ?? (score && typeof score === 'object'
      ? (pick(score, ['column', 'descriptor', 'metric']) ?? { key: String(pick(score, ['key']) ?? '') })
      : null);
  if (!descriptor) return null;
  if (descriptor.unit) return descriptor;
  const title = String(pick(descriptor, ['title']) ?? '');
  const unit = title.match(/\(([^,)]+)/)?.[1]?.trim() ?? '';
  return unit ? { ...descriptor, unit } : descriptor;
}

/**
 * A solution's raw score value, whether the reply nests it or not.
 * @param {any} solution
 * @returns {any}
 */
function solutionValue(solution) {
  const score = pick(solution, ['score']);
  if (score && typeof score === 'object') return pick(score, ['value', 'display', 'score']);
  return score;
}

/**
 * Rows sorted best placement first, unresolved entries last.
 * @param {any} profile
 * @returns {any[]}
 */
function sortedSolutions(profile) {
  const solutions = pick(profile, ['solutions', 'entries']);
  if (!Array.isArray(solutions)) return [];
  return [...solutions].sort((left, right) => {
    const a = toNumber(pick(left, ['placement']));
    const b = toNumber(pick(right, ['placement']));
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
}

/**
 * The entries table: title, entry, placement, prize, score and date.
 * @param {any} profile
 * @returns {HTMLElement}
 */
function entriesTable(profile) {
  const solutions = sortedSolutions(profile);
  if (solutions.length === 0) {
    return emptyNote('No entries yet. Every builder starts with the first one.');
  }
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'rank-table entries-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Competition', 'Entry', 'Placement', 'Prize', 'Score', 'Entered']) {
    const th = el('th', '', label);
    th.scope = 'col';
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = el('tbody');
  for (const solution of solutions) {
    const tr = el('tr');
    const competition = el('td');
    const bounty = pick(solution, ['competition']) ?? {};
    const slug = String(pick(bounty, ['slug']) ?? pick(solution, ['competition_slug']) ?? '');
    const title = String(pick(bounty, ['title']) ?? pick(solution, ['competition_title']) ?? DASH);
    competition.append(slug ? link(`#/bounty/${encodeURIComponent(slug)}`, title) : document.createTextNode(title));
    tr.append(competition);
    tr.append(el('td', '', String(pick(solution, ['title', 'submission_title']) ?? DASH)));
    tr.append(el('td', 'num-cell', formatPlacement(pick(solution, ['placement']))));
    const prize = pick(solution, ['prize_usd', 'prize_dollars', 'prize', 'amount']);
    tr.append(el('td', 'num-cell', prize === undefined ? DASH : formatMoney(prize)));
    tr.append(el('td', 'num-cell', formatScore(solutionValue(solution), solutionMetric(solution))));
    const entered = pick(solution, ['entered', 'entered_at', 'created_at', 'submitted_at']);
    tr.append(el('td', 'num-cell', entered ? formatDate(entered) : DASH));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

/**
 * The payouts panel: one real paid prize per row with its explorer link.
 * @param {any} profile
 * @returns {HTMLElement}
 */
function payoutsPanel(profile) {
  const payouts = pick(profile, ['payouts', 'claimed']);
  if (!Array.isArray(payouts) || payouts.length === 0) {
    return emptyNote('No payouts yet. Paid prizes appear here with their explorer receipt.');
  }
  const rows = [...payouts].sort((left, right) => (
    Date.parse(pick(right, ['paid', 'paid_at', 'date']) ?? '') - Date.parse(pick(left, ['paid', 'paid_at', 'date']) ?? '')
  ));
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'rank-table payouts-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Date', 'Place', 'Competition', 'Amount', 'Transaction']) {
    const th = el('th', '', label);
    th.scope = 'col';
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = el('tbody');
  for (const payout of rows) {
    const tr = el('tr');
    const paid = pick(payout, ['paid', 'paid_at', 'date']);
    tr.append(el('td', 'num-cell', paid ? formatDate(paid) : DASH));
    tr.append(el('td', 'num-cell', formatPlacement(pick(payout, ['place', 'placement']))));
    const competitionCell = el('td');
    const slug = String(pick(payout, ['competition_slug']) ?? '');
    const title = String(pick(payout, ['competition_title', 'competition']) ?? DASH);
    competitionCell.append(slug ? link(`#/bounty/${encodeURIComponent(slug)}`, title) : document.createTextNode(title));
    tr.append(competitionCell);
    tr.append(el('td', 'amount num-cell', formatMoney(pick(payout, ['amount', 'amount_dollars']))));
    const explorer = pick(payout, ['explorer_address', 'explorer_url']);
    const signature = pick(payout, ['signature']);
    const transaction = el('td');
    if (explorer) transaction.append(link(String(explorer), 'Explorer', 'num-cell'));
    else if (signature) transaction.append(document.createTextNode(String(signature).slice(0, 12)));
    else transaction.append(document.createTextNode(DASH));
    tr.append(transaction);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

/**
 * A friendly page for a handle the API does not know.
 * @param {HTMLElement} root
 * @param {string} handle
 * @param {import('../main.js').ViewContext} context
 */
function noProfile(root, handle, context) {
  const panel = el('section', 'panel route-error');
  panel.append(el('h1', 'page-title', 'No profile'));
  panel.append(el('p', 'muted', `make.fun has no public profile for @${handle}. Check the handle and try again.`));
  const retry = el('button', 'btn btn-secondary', 'Try again');
  retry.type = 'button';
  retry.addEventListener('click', () => context.navigate(`#/user/${encodeURIComponent(handle)}`));
  const board = link('#/', 'Back to the board', 'btn btn-primary');
  panel.append(retry, board);
  root.replaceChildren(panel);
}

/**
 * Render one profile route.
 * @param {import('../main.js').ViewContext} context
 * @returns {Promise<() => void>}
 */
export async function renderProfile(context) {
  const handle = context.route.handle;
  const root = context.root;
  root.replaceChildren(el('div', 'sk'));
  let result;
  try {
    result = await getBuilderProfile(handle);
  } catch (error) {
    if (error?.status === 404) {
      context.setTitle('No profile');
      document.title = 'make.fun — No profile';
      noProfile(root, handle, context);
      context.markReady();
      return () => {};
    }
    throw error;
  }
  const profile = result.data ?? {};
  const shown = String(pick(profile, ['handle']) ?? handle);
  context.setTitle(`${shown} profile`);
  document.title = `make.fun — ${shown} profile`;
  if (result.stale) window.dispatchEvent(new CustomEvent('potscope:stale'));

  const page = el('div', 'profile-page');
  const grid = el('div', 'profile-grid');
  grid.append(identityCard(profile, shown));

  const activity = el('section', 'panel activity-card');
  activity.append(el('h2', 'section-title', 'Recent activity'));
  const events = recentActivity(profile);
  if (events.length === 0) activity.append(emptyNote('No activity has been recorded for this builder yet.'));
  else activity.append(...events);
  grid.append(activity);
  page.append(grid);

  const bottom = el('div', 'bottom-cards');
  bottom.append(sectionBlock('Entries', entriesTable(profile), 'Best placement first', 'panel card'));
  bottom.append(sectionBlock('Payouts', payoutsPanel(profile), 'Paid prizes', 'panel card'));
  page.append(bottom);

  const strip = el('div', 'motivation');
  strip.append(el('p', '', 'Keep building, keep competing!'));
  strip.append(link('#/', 'Explore Bounties', 'btn btn-primary'));
  page.append(strip);

  root.replaceChildren(page);
  context.markReady();
  return () => {};
}

