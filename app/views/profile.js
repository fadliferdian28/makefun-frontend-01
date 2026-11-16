// Lazy profile view: the public record of one handle, its five stat boxes,
// links, recent activity, entries, payouts, and a friendly missing state.

import { API_ORIGIN } from '../api.js';
import { loadProfile, readProfileCard } from '../api-detail.js';
import { formatDate, formatMoney, formatNumber, formatRelativeTime } from '../format.js';
import { formatPlacement, formatPrize, formatSolutionScore, shortenAddress } from '../format-detail.js';
import { asList, escapeHtml, pickFirst, toFiniteNumber } from './common.js';

const MISSING = '—';
const RECENT_LIMIT = 5;

function safeImageUrl(value) {
  const source = value && typeof value === 'object' ? (value.url ?? value.url_small ?? '') : value;
  const text = String(source ?? '').trim();
  if (!text) return '';
  if (text.startsWith('/')) return `${API_ORIGIN}${text}`;
  return /^https?:\/\//i.test(text) ? text : '';
}

function asAddress(value) {
  const text = String(value ?? '').trim();
  return /^https?:\/\//i.test(text) ? text : '';
}

function profileLink(card, pageUrl) {
  const direct = asAddress(pageUrl);
  if (direct) return direct;
  return card.handle ? `${API_ORIGIN}/@${encodeURIComponent(card.handle)}` : API_ORIGIN;
}

function verifiedMarkup(profilePayload) {
  return pickFirst(profilePayload ?? {}, ['verified', 'is_verified', 'isVerified']) === true
    ? '<span class="verified" aria-label="Verified account">✓</span>'
    : '';
}

function statBox(label, value) {
  return `<div class="stat-box"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function statBoxes(record) {
  const dash = (value) => (value === null || value === undefined ? MISSING : value);
  return `<div class="stat-boxes">
    ${statBox('Entered', formatNumber(dash(record.entered)))}
    ${statBox('Placed', formatNumber(dash(record.placed)))}
    ${statBox('Won', formatNumber(dash(record.won)))}
    ${statBox('Best Place', record.best === null || record.best < 1 ? MISSING : `#${formatNumber(record.best)}`)}
    ${statBox('Total Rewards', formatMoney(record.rewards))}</div>`;
}

function linkMarkup(card) {
  const links = [];
  const githubLogin = card.github && typeof card.github === 'object'
    ? pickFirst(card.github, ['login', 'handle', 'name'])
    : card.github;
  if (githubLogin) {
    const login = String(githubLogin);
    links.push(`<a href="https://github.com/${encodeURIComponent(login)}" rel="noopener">GitHub</a>`);
  }
  const discord = asAddress(card.discord && typeof card.discord === 'object' ? card.discord.url : card.discord);
  if (discord) links.push(`<a href="${escapeHtml(discord)}" rel="noopener">Discord</a>`);
  if (card.x) {
    const handle = String(card.x).replace(/^@/, '');
    links.push(`<a href="https://x.com/${encodeURIComponent(handle)}" rel="noopener">X</a>`);
  }
  const walletUrl = asAddress(card.walletUrl);
  if (walletUrl) links.push(`<a href="${escapeHtml(walletUrl)}" rel="noopener">Wallet</a>`);
  else if (card.wallet) links.push(`<a href="https://explorer.solana.com/address/${encodeURIComponent(String(card.wallet))}" rel="noopener">Wallet</a>`);
  if (!links.length) return '';
  const separator = '<span class="muted" aria-hidden="true">·</span>';
  return `<div class="profile-links">${links.join(separator)}</div>`;
}

function headerCard(card, pageUrl, profilePayload) {
  const image = safeImageUrl(card.image);
  const avatar = image
    ? `<img class="profile-avatar" crossorigin="anonymous" alt="" src="${escapeHtml(image)}">`
    : '<div class="profile-avatar" aria-hidden="true"></div>';
  const name = card.displayName && card.displayName !== card.handle
    ? `<p class="profile-name">${escapeHtml(String(card.displayName))}</p>`
    : '';
  const bio = card.bio ? `<p class="profile-bio">${escapeHtml(String(card.bio))}</p>` : '';
  return `<section class="profile-card">${avatar}
    <h1 class="profile-handle">@${escapeHtml(card.handle)}${verifiedMarkup(profilePayload)}</h1>${name}${bio}
    <p class="button-row"><a class="button button-primary" href="${escapeHtml(profileLink(card, pageUrl))}" rel="noopener">View on make.fun</a></p>
    ${linkMarkup(card)}${statBoxes(card.record)}</section>`;
}

function competitionTitle(solution) {
  const competition = pickFirst(solution, ['competition', 'competitions']);
  if (competition && typeof competition === 'object') {
    return String(pickFirst(competition, ['title', 'name']) ?? 'a bounty');
  }
  return String(pickFirst(solution, ['competition_title', 'competitionTitle', 'competition', 'title']) ?? 'a bounty');
}

function solutionDate(solution) {
  return pickFirst(solution, ['entered_at', 'enteredAt', 'created_at', 'createdAt', 'date']);
}

function payoutDate(payout) {
  return pickFirst(payout, ['paid_at', 'paidAt', 'date', 'created_at']);
}

function payoutAmount(payout) {
  const value = pickFirst(payout, ['amount_usd', 'amount', 'prize_usd']);
  return value === undefined ? null : value;
}

function activityEvents(card) {
  const events = [];
  for (const solution of asList(card.solutions)) {
    const at = solutionDate(solution);
    if (!at) continue;
    events.push({ kind: 'Entered', title: competitionTitle(solution), at, time: Date.parse(at) });
  }
  for (const payout of asList(card.payouts)) {
    const at = payoutDate(payout);
    if (!at) continue;
    const amount = payoutAmount(payout);
    events.push({ kind: 'Won', title: competitionTitle(payout), at, amount: amount === null ? null : formatMoney(amount), time: Date.parse(at) });
  }
  return events.filter((event) => Number.isFinite(event.time)).sort((left, right) => right.time - left.time).slice(0, RECENT_LIMIT);
}

function activityCard(card) {
  const events = activityEvents(card);
  const body = events.length
    ? `<div class="activity-list">${events.map((event) => `<div class="activity-item">
        <p><strong>${event.kind}</strong> ${escapeHtml(event.title)}${event.amount ? ` · <span class="payout-amount">${escapeHtml(event.amount)}</span>` : ''}</p>
        <span class="activity-time" title="${escapeHtml(formatDate(event.at))}">${escapeHtml(formatRelativeTime(event.at))}</span></div>`).join('')}</div>`
    : '<p class="card-note">No dated activity has been published for this account yet.</p>';
  return `<section class="card"><div class="card-head activity-head"><h2>Recent Activity</h2><span class="card-note">Latest public events</span></div>${body}</section>`;
}

function scoreOfSolution(solution) {
  const score = pickFirst(solution, ['score', 'result']);
  if (score === undefined) return MISSING;
  return formatSolutionScore(score);
}

function prizeOfSolution(solution) {
  const prize = solution?.prize_usd;
  return prize === undefined || prize === null ? MISSING : formatPrize(prize);
}

function entriesTable(card) {
  const rows = asList(card.solutions).slice().sort((left, right) => {
    const leftPlace = toFiniteNumber(pickFirst(left, ['placement', 'place', 'rank']));
    const rightPlace = toFiniteNumber(pickFirst(right, ['placement', 'place', 'rank']));
    if (leftPlace === null && rightPlace === null) return 0;
    if (leftPlace === null) return 1;
    if (rightPlace === null) return -1;
    return leftPlace - rightPlace;
  });
  if (!rows.length) return '<p class="card-note">This account has no published entries yet.</p>';
  const body = rows.map((solution) => {
    const competition = pickFirst(solution, ['competition', 'competitions']);
    const slug = String(pickFirst(solution, ['competition_slug', 'competitionSlug', 'slug']) ?? pickFirst(competition ?? {}, ['slug']) ?? '');
    const title = competitionTitle(solution);
    const entryTitle = String(pickFirst(solution, ['title', 'entry_title', 'entryTitle']) ?? MISSING);
    const placement = formatPlacement(pickFirst(solution, ['placement', 'place', 'rank']));
    return `<tr><td><a class="bounty-title" href="#/bounty/${encodeURIComponent(slug)}">${escapeHtml(title)}</a></td>
      <td>${escapeHtml(entryTitle)}</td><td class="num placement">${placement === MISSING ? MISSING : `#${placement}`}</td>
      <td class="num prize-cell">${escapeHtml(prizeOfSolution(solution))}</td><td class="num">${escapeHtml(scoreOfSolution(solution))}</td>
      <td><span class="mono-date">${escapeHtml(formatDate(solutionDate(solution)))}</span></td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table entries-table"><thead><tr><th>Bounty</th><th>Entry</th><th class="num">Place</th><th class="num">Prize</th><th class="num">Score</th><th>Entered</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function payoutLink(payout) {
  const explorer = asAddress(pickFirst(payout, ['explorer', 'explorer_url', 'explorerUrl', 'tx_url', 'txUrl', 'url']));
  if (explorer) return explorer;
  const signature = pickFirst(payout, ['signature', 'tx', 'transaction']);
  return signature ? `https://explorer.solana.com/tx/${encodeURIComponent(String(signature))}` : '';
}

function payoutsTable(card) {
  const rows = asList(card.payouts);
  if (!rows.length) return '<p class="card-note">No prizes have been paid to this account yet.</p>';
  const body = rows.map((payout) => {
    const competition = pickFirst(payout, ['competition', 'competitions']);
    const slug = String(pickFirst(payout, ['competition_slug', 'competitionSlug', 'slug']) ?? pickFirst(competition ?? {}, ['slug']) ?? '');
    const title = competitionTitle(payout);
    const place = formatPlacement(pickFirst(payout, ['place', 'placement', 'rank']));
    const amount = payoutAmount(payout);
    const link = payoutLink(payout);
    return `<tr><td><span class="mono-date">${escapeHtml(formatDate(payoutDate(payout)))}</span></td>
      <td class="num placement">${place === MISSING ? MISSING : `#${place}`}</td>
      <td><a class="bounty-title" href="#/bounty/${encodeURIComponent(slug)}">${escapeHtml(title)}</a></td>
      <td class="num payout-amount">${amount === null ? MISSING : escapeHtml(formatMoney(amount))}</td>
      <td>${link ? `<a class="tx-link" href="${escapeHtml(link)}" rel="noopener">Transaction</a>` : `<span class="tx-link">${escapeHtml(shortenAddress(pickFirst(payout, ['signature', 'tx']), 5))}</span>`}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table payouts-table"><thead><tr><th>Date</th><th class="num">Place</th><th>Bounty</th><th class="num">Amount</th><th>Transaction</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function missingCard(handle) {
  return `<div class="empty-state"><h2>No profile for @${escapeHtml(handle)}</h2>
    <p>make.fun has no public record for that handle. Check the spelling, or find the builder on the leaderboard.</p>
    <p><a class="button button-primary" href="#/">Explore the board</a></p></div>`;
}

export async function renderProfile(root, context) {
  const handle = String(context.route?.handle ?? '');
  context.setTitle(handle ? `@${handle}` : 'Profile');
  root.innerHTML = `<p class="loading-line">Loading the profile…</p>`;

  const result = await loadProfile(handle);
  if (!context.isActive()) return;

  if (!result.data) {
    if (result.error?.status === 404) {
      root.innerHTML = missingCard(handle);
      return;
    }
    root.innerHTML = `<div class="empty-state"><h2>The profile could not load</h2>
      <p>The make.fun API did not answer just now. Try again shortly.</p>
      <p><a class="button button-primary" href="#/user/${encodeURIComponent(handle)}">Reload this profile</a></p></div>`;
    return;
  }

  const card = result.card ?? readProfileCard(result.data);
  if (!card.handle) {
    root.innerHTML = missingCard(handle);
    return;
  }
  context.setTitle(`@${card.handle}`);
  const stale = result.stale ? '<div class="notice">Showing the last saved profile while a fresh copy arrives.</div>' : '';
  const profilePayload = result.data?.profile && typeof result.data.profile === 'object' ? result.data.profile : result.data;
  const pageUrl = pickFirst(result.data, ['page', 'url', 'profile_url', 'profileUrl'])
    ?? pickFirst(profilePayload ?? {}, ['page', 'url', 'profile_url', 'profileUrl']);
  root.innerHTML = `${stale}<div class="profile-layout">${headerCard(card, pageUrl, profilePayload)}${activityCard(card)}</div>
    <section class="card"><div class="card-head"><h2>Entries</h2><span class="card-note">${formatNumber(card.solutions.length)} published</span></div>${entriesTable(card)}</section>
    <section class="card"><div class="card-head"><h2>Payouts</h2><span class="card-note">Paid prizes</span></div>${payoutsTable(card)}</section>
    <div class="motivational-strip"><p>Keep building, keep competing!</p><a class="button button-primary" href="#/">Explore Bounties</a></div>`;
}
