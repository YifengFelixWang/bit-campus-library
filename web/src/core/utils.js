export function esc(value) {
  return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function fmtDate(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
}

export function fmtDateTime(value) {
  const d = new Date(value);
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
