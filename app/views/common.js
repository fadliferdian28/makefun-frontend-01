/**
 * Shared builders used by more than one PotScope view: small DOM helpers, the
 * hand-written markdown renderer, the stat card and the rewards table.
 *
 * The module carries no data of its own; every figure it prints arrives from
 * the live make.fun API reply the calling view passes in.
 *
 * @module views/common
 */

import { formatDollars, formatMoney, formatNumber, toNumber } from '../format.js';

const DASH = '—';
const MAX_MARKDOWN_DEPTH = 8;
const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const INLINE_CODE_PATTERN = /`([^`]+)`/g;
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;
const BULLET_PATTERN = /^\s*[-*+]\s+/;
const NUMBERED_PATTERN = /^\s*\d+[.)]\s+/;
const HEADING_PATTERN = /^\s*(#{1,4})\s+(.*)$/;
const RULE_PATTERN = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

/**
 * Escape the five HTML-significant characters before any markup is added.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Create an element with a class name and, optionally, text content.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [content]
 * @returns {HTMLElement}
 */
export function el(tag, className = '', content = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

/**
 * Create a link to an in-app hash route or an external make.fun page.
 * @param {string} href
 * @param {string} label
 * @param {string} [className]
 * @returns {HTMLAnchorElement}
 */
export function link(href, label, className = '') {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.textContent = label;
  if (className) anchor.className = className;
  if (/^https?:/.test(href)) {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  return anchor;
}

/**
 * Inline markdown for one line of text: links, code and bold, already escaped.
 * @param {string} line Raw line.
 * @returns {string} Safe HTML.
 */
function renderInline(line) {
  let html = escapeHtml(line);
  html = html.replace(LINK_PATTERN, (match, label, href) => (
    `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
  ));
  html = html.replace(INLINE_CODE_PATTERN, '<code>$1</code>');
  html = html.replace(BOLD_PATTERN, '<strong>$1</strong>');
  return html;
}

/**
 * A small markdown-to-HTML renderer written by hand. It handles second- to
 * fourth-level headings, bullet and numbered lists, bold text, inline code,
 * paragraphs and http(s) links. Anything it does not understand has its
 * markers stripped so no literal hash or dash reaches the screen.
 * @param {string|null|undefined} markdown
 * @returns {string} Safe HTML.
 */
export function renderMarkdown(markdown) {
  const source = String(markdown ?? '').replace(/\r\n?/g, '\n');
  if (!source.trim()) return '';
  const lines = source.split('\n');
  const out = [];
  let listKind = '';
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${paragraph.map(renderInline).join(' ')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listKind) return;
    out.push(`</${listKind}>`);
    listKind = '';
  };
  const openList = (kind) => {
    if (listKind === kind) return;
    closeList();
    out.push(`<${kind}>`);
    listKind = kind;
  };

  for (let index = 0; index < lines.length && index < MAX_MARKDOWN_DEPTH * 1_000; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    if (RULE_PATTERN.test(line)) {
      flushParagraph();
      closeList();
      out.push('<hr>');
      continue;
    }
    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(Math.max(heading[1].length, 2), 4);
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }
    if (BULLET_PATTERN.test(line)) {
      flushParagraph();
      openList('ul');
      out.push(`<li>${renderInline(line.replace(BULLET_PATTERN, ''))}</li>`);
      continue;
    }
    if (NUMBERED_PATTERN.test(line)) {
      flushParagraph();
      openList('ol');
      out.push(`<li>${renderInline(line.replace(NUMBERED_PATTERN, ''))}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  return out.join('\n');
}

/**
 * A compact stat card: a label, the figure and one hint line. The value may
 * be marked as money so the accent colour only touches cash.
 * @param {{label: string, value: string, hint?: string, accent?: boolean}} options
 * @returns {HTMLElement}
 */
export function statCard(options) {
  const card = el('div', 'stat-card');
  const label = el('span', 'label', options.label);
  const value = el('span', `value${options.accent ? ' accent' : ''}`, options.value || DASH);
  card.append(label, value);
  if (options.hint) card.append(el('span', 'hint', options.hint));
  return card;
}

/**
 * The four-card strip the bounty surfaces share.
 * @param {Array<{label: string, value: string, hint?: string, accent?: boolean}>} cards
 * @returns {HTMLElement}
 */
export function statStrip(cards) {
  const strip = el('div', 'stat-strip');
  strip.append(...cards.map(statCard));
  return strip;
}

/**
 * One reward row's fee-share bar: the base portion at full accent, the fee
 * share at half strength, both scaled against the live pot.
 * @param {number} baseShare 0 to 1 of the pot.
 * @param {number} feeShare 0 to 1 of the pot.
 * @returns {HTMLElement}
 */
function rewardBar(baseShare, feeShare) {
  const bar = el('div', 'reward-bar');
  const base = el('span', 'base');
  const share = el('span', 'share');
  base.style.width = `${Math.round(baseShare * 100)}%`;
  share.style.width = `${Math.round(feeShare * 100)}%`;
  bar.append(base, share);
  return bar;
}

/**
 * The rewards spine shared by the split pane and the full bounty page.
 *
 * Rows come from the competition's rewards-now list. Places past the visible
 * limit stay behind a "show all" button so the pane keeps its shape on the
 * first screen while every paid place remains reachable.
 * @param {{rewardsNow?: Array<{place?: number|string, base?: string|number, fee_share?: string|number, amount?: string|number}|null>, pot?: string|number|null, visibleLimit?: number, showAllLabel?: string}} options
 * @returns {HTMLElement}
 */
export function rewardsTable(options) {
  const rewards = Array.isArray(options.rewardsNow) ? options.rewardsNow.filter(Boolean) : [];
  const limit = options.visibleLimit ?? rewards.length;
  const wrapper = el('div', 'rewards-block');
  const scroller = el('div', 'table-wrap');
  const table = el('table', 'rewards-table');
  const head = el('thead');
  const headRow = el('tr');
  for (const title of ['Place', 'Base', 'Fee share', 'Pays now', 'Share of pot']) {
    headRow.append(el('th', '', title));
  }
  head.append(headRow);
  const body = el('tbody');
  const pot = toNumber(options.pot);

  const buildRow = (reward) => {
    const row = el('tr');
    const base = toNumber(reward.base);
    const fee = toNumber(reward.fee_share);
    const total = toNumber(reward.amount) ?? (base ?? 0) + (fee ?? 0);
    const place = toNumber(reward.place);
    row.append(el('td', 'place num-cell', place === null ? DASH : `#${formatNumber(place)}`));
    row.append(el('td', 'num-cell', base === null ? DASH : formatDollars(base)));
    row.append(el('td', 'num-cell', fee === null ? DASH : formatDollars(fee)));
    row.append(el('td', 'amount num-cell', total === null ? DASH : formatDollars(total)));
    const barCell = el('td');
    const baseShare = pot && base !== null ? Math.min(base / pot, 1) : 0;
    const feeShare = pot && fee !== null ? Math.min(fee / pot, 1) : 0;
    barCell.append(rewardBar(baseShare, feeShare));
    row.append(barCell);
    return row;
  };

  for (const reward of rewards.slice(0, limit)) body.append(buildRow(reward));
  table.append(head, body);
  scroller.append(table);
  wrapper.append(scroller);

  if (rewards.length === 0) {
    wrapper.append(el('p', 'empty-note', 'No reward places published for this bounty yet.'));
    return wrapper;
  }
  if (rewards.length > limit) {
    const rest = rewards.slice(limit);
    const button = el('button', 'btn btn-ghost show-all', options.showAllLabel ?? `Show all ${formatNumber(rewards.length)} places`);
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        for (const row of [...body.querySelectorAll('tr.extra-place')]) row.remove();
        button.setAttribute('aria-expanded', 'false');
        button.textContent = options.showAllLabel ?? `Show all ${formatNumber(rewards.length)} places`;
      } else {
        for (const reward of rest) {
          const row = buildRow(reward);
          row.classList.add('extra-place');
          body.append(row);
        }
        button.setAttribute('aria-expanded', 'true');
        button.textContent = 'Show fewer places';
      }
    });
    wrapper.append(button);
  }
  return wrapper;
}

/**
 * The header line of the rewards block: the live pot math.
 * @param {{pot?: string|number|null, baseTotal?: string|number|null, feeTotal?: string|number|null, entryFeesTotal?: string|number|null}} options
 * @returns {string}
 */
export function rewardsMathLine(options) {
  const parts = [];
  if (options.baseTotal !== undefined && options.baseTotal !== null) {
    parts.push(`${formatMoney(options.baseTotal)} base`);
  }
  const fees = options.feeTotal ?? options.entryFeesTotal;
  if (fees !== undefined && fees !== null) parts.push(`${formatMoney(fees)} entry fees`);
  if (parts.length === 0) return `Live pot ${formatMoney(options.pot)}`;
  return `Live pot ${formatMoney(options.pot)} · ${parts.join(' + ')}`;
}

/**
 * A labelled section with a title, an optional note and its content.
 * @param {string} title
 * @param {Node|string} content
 * @param {string} [note]
 * @param {string} [className]
 * @returns {HTMLElement}
 */
export function sectionBlock(title, content, note = '', className = 'block') {
  const block = el('section', className);
  const head = el('div', 'block-head');
  head.append(el('h2', 'block-title', title));
  if (note) head.append(el('span', 'block-note', note));
  block.append(head);
  if (typeof content === 'string') block.append(el('p', 'muted', content));
  else block.append(content);
  return block;
}

/**
 * A safe, empty-state paragraph for lists that have no rows yet.
 * @param {string} message
 * @returns {HTMLElement}
 */
export function emptyNote(message) {
  return el('p', 'empty-note', message);
}
