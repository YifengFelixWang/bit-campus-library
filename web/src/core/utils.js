export function esc(value) {
  return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * 库里的时间列是 timestamp without time zone，存的是北京时间墙上时间；
 * 接口把它序列化成「…+00:00」后，直接 new Date 会多算 8 小时（今天的公告显示成明天）。
 * 所以这里按字面量还原成本地时间，忽略那个偏移标记。
 */
function toLocalDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const m = String(value == null ? "" : value)
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return new Date(value);
}

export function fmtDate(value) {
  const d = toLocalDate(value);
  if (isNaN(d.getTime())) return "—";
  return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
}

export function fmtDateTime(value) {
  const d = toLocalDate(value);
  if (isNaN(d.getTime())) return "—";
  return fmtDate(value) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

export function roleName(code) {
  const map = { reader: "读者", librarian: "馆员", analyst: "数据分析员", ops: "运维管理员", guest: "访客" };
  return map[code] || code;
}

export function icon(name, cls) {
  return '<svg class="icon ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
}

export function bookScore(book) {
  if (!book || !book.rating_count) return null;
  let score = Number(book.rating_10);
  if (!isFinite(score) || score <= 0) score = Number(book.rating || 0) * 2;
  if (!isFinite(score) || score <= 0) return null;
  return score;
}

export function scoreText(book) {
  const score = bookScore(book);
  return score === null ? "暂无评分" : score.toFixed(1);
}

export function scoreShort(book) {
  const score = bookScore(book);
  return score === null ? "暂无" : score.toFixed(1);
}

export function announcementAuthor(author) {
  if (author === "admin") return "超级管理员";
  if (author === "librarian") return "图书管理员";
  return author;
}

export function filterBooks(rows, category, query) {
  const q = String(query || "").trim().toLowerCase();
  return rows.filter(function (book) {
    const inCategory = category === "全部" || book.category === category;
    if (!inCategory) return false;
    if (!q) return true;
    return [book.title, book.author, book.category, book.isbn].join(" ").toLowerCase().indexOf(q) !== -1;
  });
}

export function delay(ms) {
  return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
}
