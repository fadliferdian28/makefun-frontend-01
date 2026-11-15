// format.js — all display formatting. Every number the app shows passes through here.

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfMax = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

/** Parse an API money string ("577.50", "0.50", "0") into a finite number. */
export function moneyValue(raw) {
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Money with cents when needed: $577.50, $500, $0.50. */
export function money(raw) {
  const n = moneyValue(raw);
  if (Math.abs(n) >= 1000) return "$" + nf0.format(n);
  return Number.isInteger(n) ? "$" + nf0.format(n) : "$" + nf2.format(n);
}

/** Always two decimals: $577.50. */
export function money2(raw) {
  return "$" + nf2.format(moneyValue(raw));
}

/** Compact money for the summary strip: $2.1k. */
export function moneyShort(raw) {
  const n = moneyValue(raw);
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
  if (n >= 10000) return "$" + (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return money(n);
}

export function num(n) {
  return nf0.format(Number(n) || 0);
}

export function pct(n, d = 2) {
  return (Number(n) || 0).toFixed(d) + "%";
}

/** Countdown from a timestamp: "1d 20h" / "43h 32m" / "10h 41m 32s" / "closed". */
export function timeLeft(iso, now = Date.now()) {
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return "—";
  let ms = end - now;
  if (ms <= 0) return "closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return d + "d " + h + "h";
  if (h >= 10) return h + "h " + m + "m";
  if (h > 0) return h + "h " + String(m).padStart(2, "0") + "m " + String(sec).padStart(2, "0") + "s";
  if (m > 0) return m + "m " + String(sec).padStart(2, "0") + "s";
  return sec + "s";
}

/** Long countdown used on detail pages: "1d 20h 12m". */
export function countdown(iso, now = Date.now()) {
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return "—";
  let ms = end - now;
  if (ms <= 0) return "closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return d + "d " + h + "h " + m + "m";
  if (h > 0) return h + "h " + m + "m " + String(sec).padStart(2, "0") + "s";
  return m + "m " + String(sec).padStart(2, "0") + "s";
}

/** Relative past time: "2m ago", "3h ago", "2d ago". */
export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  let s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

export function dateShort(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTimeShort(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }) + " UTC";
}

export function timeShort(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }) + " UTC";
}

/**
 * Score formatting that adapts to the metric name/unit from the API.
 * judge / win rate: value is win rate x 1,000,000 -> "94.21%".
 * elo: integer -> "1,812". loss / log score: plain decimal. probability: percent.
 */
export function score(value, metricName, unit) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const name = String(metricName || "").toLowerCase();
  const u = String(unit || "").toLowerCase();
  if (u === "millionths" || name.includes("win rate") || name.includes("judge")) {
    return (n / 1e4).toFixed(2) + "%";
  }
  if (u === "probability" || u === "percent" || name.includes("probability")) {
    const p = n <= 1 ? n * 100 : n;
    return p.toFixed(2) + "%";
  }
  if (u === "elo" || name.includes("elo")) return nf0.format(Math.round(n));
  if (name.includes("loss") || name.includes("log score")) return n.toFixed(4);
  if (u === "km" || u === "distance") return nf0.format(n) + " km";
  if (Number.isInteger(n)) return nf0.format(n);
  return n.toFixed(2);
}

/** Interval from the API: low/high are strings in the same unit as the score. */
export function intervalRange(low, high, metricName, unit) {
  const a = Number(low), b = Number(high);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  if (String(unit).toLowerCase() === "millionths") return (a / 1e4).toFixed(2) + "–" + (b / 1e4).toFixed(2);
  return nf0.format(a) + "–" + nf0.format(b);
}

function scoreShape(value, column) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const col = typeof column === "string" ? { key: column, title: column } : column || {};
  const key = String(col.key || "").toLowerCase();
  const title = String(col.title || "").toLowerCase();
  const unit = String(col.unit || "").toLowerCase();
  const source = String(col.source || "").toLowerCase();
  const text = [key, title, unit, source].join(" ");
  const precision = Number.isInteger(col.precision) ? col.precision : null;

  const winRate = text.includes("millionth") || text.includes("win rate") || text.includes("win_rate") ||
    text.includes("judge");
  if (winRate) {
    return (n / 1e4).toFixed(2) + "%";
  }
  if (text.includes("probability") || unit === "percent") {
    const p = Math.abs(n) <= 1 ? n * 100 : n;
    return p.toFixed(2) + "%";
  }

  const microUsd = /micro[_\s-]?usd|usd[_\s-]?micro|microdollars?|\bmicros?\b/.test(text);
  const pnl = text.includes("pnl") || /p\s*&\s*l/.test(text) ||
    /\bprofit\b|\bnet\b|\breturn\b|\bearnings\b|\brevenue\b/.test(text);
  if (microUsd || pnl) {
    return (n < 0 ? "-$" : "$") + nf2.format(Math.abs(n) / 1e6);
  }

  if (text.includes("loss") || text.includes("log score") || text.includes("log_score")) {
    if (precision !== null && precision > 0) return n.toFixed(precision);
    return n.toFixed(8).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  if (/\belo\b/.test(text)) return nf0.format(Math.round(n));
  if (text.includes("distance") || unit === "km") return nf0.format(n) + " km";
  if (Number.isInteger(n)) return precision !== null && precision > 0 ? n.toFixed(precision) : nf0.format(n);
  return null;
}

/**
 * Format a profile score using the competition's score `column` descriptor.
 * - win rate / millionths -> "94.21%"
 * - PnL / micro-USD -> "$1,234.56" (negative: "-$3,810.00")
 * - loss / log score -> plain decimals
 * - small integer scores -> "2,230,000" (thousands separators)
 */
export function profileScore(value, column) {
  const shaped = scoreShape(value, column);
  if (shaped !== null) return shaped;
  const n = Number(value);
  const precision = Number.isInteger((column || {}).precision) ? column.precision : 0;
  if (precision > 0) return n.toFixed(precision);
  return nfMax.format(n);
}

export function placeLabel(p) {
  const n = Number(p);
  if (!Number.isInteger(n) || n <= 0) return "—";
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return n + "th";
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(s) {
  return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
}

function mdInline(escaped) {
  let s = escaped;
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, code) => {
    codes.push(code);
    return "\u0000C" + (codes.length - 1) + "\u0000";
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const href = /^(javascript|data|vbscript):/i.test(url) ? "#" : url;
    return '<a href="' + href + '" rel="noopener">' + text + "</a>";
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/\*\*/g, "").replace(/\*/g, "").replace(/`/g, "");
  s = s.replace(/\u0000C(\d+)\u0000/g, (m, i) => "<code>" + codes[Number(i)] + "</code>");
  return s;
}

/**
 * Minimal, dependency-free markdown -> HTML renderer.
 * Handles headings, bullet/numbered lists, bold/italic, inline code, links and
 * paragraphs. Input is HTML-escaped before any markup is added. Unknown
 * markers are stripped rather than shown raw.
 */
export function markdownToHtml(markdown) {
  if (markdown === null || markdown === undefined) return "";
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let paragraph = [];
  let list = null;
  let code = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push("<p>" + mdInline(esc(paragraph.join(" "))) + "</p>");
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.type === "ol" ? "ol" : "ul";
    out.push("<" + tag + ">" + list.items.map((item) => "<li>" + mdInline(esc(item)) + "</li>").join("") + "</" + tag + ">");
    list = null;
  };
  const flush = () => { flushParagraph(); flushList(); };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^\s*```/.test(line)) {
      if (code) {
        out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code) { code.push(rawLine); continue; }

    if (!line.trim()) { flush(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/) || line.match(/^(#{2,6})(\S.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length <= 2 ? 2 : heading[1].length === 3 ? 3 : 4;
      const text = heading[2].trim().replace(/\s+#+\s*$/, "");
      out.push("<h" + level + ">" + mdInline(esc(text)) + "</h" + level + ">");
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(numbered[1]);
      continue;
    }

    const cleaned = line.replace(/^\s*>\s?/, "");
    if (list) list.items[list.items.length - 1] += " " + cleaned;
    else paragraph.push(cleaned);
  }
  if (code) out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
  flush();
  return out.join("");
}

/** Small DOM helper: build an element with attributes and children. */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Avatar img with crossorigin set BEFORE src (the API's CORP header needs CORS mode). */
export function avatar(src, size, alt) {
  const img = document.createElement("img");
  img.setAttribute("crossorigin", "anonymous");
  img.className = "avatar";
  img.width = size;
  img.height = size;
  img.alt = alt || "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.src = src || "";
  img.addEventListener("error", () => { img.style.visibility = "hidden"; }, { once: true });
  return img;
}

export function apiUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return "https://make.fun" + (path.startsWith("/") ? path : "/" + path);
}
