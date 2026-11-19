/**
 * 真实数据层：书目走 catalog-service，借还走 loan-service。
 *
 * 设计取舍（重要）：
 *   读接口保持「同步」签名 —— 组件里到处是 api.books()、api.bookById(id)，
 *   改成 Promise 会牵连十几个组件。所以采用「启动预加载 + 内存缓存」：
 *   preload() 拉一次，读函数从缓存同步返回；写操作才走异步。
 *   写成功后调 preload() 刷新缓存，store 的响应式对象随之更新。
 */

const ROLE_LABEL = { reader: "读者", librarian: "馆员", analyst: "数据分析员", ops: "运维管理员" };

// 权限矩阵：按角色给能力，控制台各 tab 按 perm 自动显隐
const PERMISSIONS = {
  reader: ["book:read", "book:detail", "borrow:self", "borrow:read", "rating:write"],
  librarian: [
    "book:read", "book:detail", "book:write", "book:publish",
    "borrow:self", "borrow:read", "borrow:manage",
    "review:manage", "announcement:write",
    "data:export", "console:access"
  ],
  analyst: ["report:read", "data:export", "console:access", "book:read", "book:detail"],
  ops: ["server:manage", "backup:manage", "audit:read", "console:access", "book:read", "book:detail"]
};

const PALETTE = [
  ["#0e1b2b", "#2c5364"], ["#5c1f18", "#a8412f"], ["#6b4a14", "#c08a2e"],
  ["#6d4c1e", "#b98a3f"], ["#173b2f", "#2f6b4f"], ["#1f2937", "#4b5d70"],
  ["#4a2c1a", "#8a5a32"], ["#243b53", "#486581"], ["#134e4a", "#2c7a7b"],
  ["#3b2a52", "#6b4f8a"], ["#5a2a1e", "#a05a3c"], ["#1e2a4a", "#3f5a8a"]
];

const state = {
  token: sessionStorage.getItem("tata-token") || "",
  user: null,
  books: [],
  byId: new Map(),
  categories: [],
  copyStats: new Map(),
  // 借阅量：bookId → 历史借阅次数（正在借 + 已归还都算），来自 loan-service 聚合接口
  borrowCounts: new Map(),
  loans: [],
  reviews: [],
  // bookId → { sum, count, latest }，由 applyReviewStats 从 reviews 聚合
  ratingStats: new Map(),
  announcements: [],
  loaded: false,
  lastError: ""
};

function pickColors(seed) {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return PALETTE[h % PALETTE.length];
}

function authHeaders() {
  return state.token ? { Authorization: "Bearer " + state.token } : {};
}

async function getJson(url, options) {
  const res = await fetch(url, Object.assign({ headers: authHeaders() }, options || {}));
  let body = null;
  try { body = await res.json(); } catch (err) { body = null; }
  if (!res.ok) {
    const code = body && (body.code || body.error) ? (body.code || body.error) : "HTTP_" + res.status;
    const message = body && body.message ? body.message : code;
    const error = new Error(message);
    error.code = code;
    error.status = res.status;
    throw error;
  }
  return body;
}

function unwrap(payload) {
  if (payload && typeof payload === "object" && "code" in payload && "data" in payload) return payload.data;
  return payload;
}

function coverUrlOf(raw) {
  if (!raw) return "";
  if (/^https?:/i.test(raw)) return raw;
  // 统一走服务接口，不依赖 Nginx / dev-server 的 /covers 静态路由
  const name = String(raw).split("/").pop();
  return "/api/catalog/covers/" + name;
}

function mapBook(row, stats) {
  const authors = row.authorNames
    ? (Array.isArray(row.authorNames) ? row.authorNames : String(row.authorNames).split(";").filter(Boolean))
    : [];
  const s = stats || { total: 0, available: 0, borrowed: 0 };
  // 馆藏册数优先用 catalog.book.total_copies（馆员登记的计划册数），
  // 副本聚合值作为兜底；可借数 = 馆藏 - 已借出，保证这两个数字始终自洽。
  const total = (row.totalCopies != null && Number(row.totalCopies) > 0) ? Number(row.totalCopies) : s.total;
  const borrowed = Number(s.borrowed) || 0;
  const available = Math.max(0, total - borrowed);
  return {
    id: String(row.bookId),
    bookId: row.bookId,
    title: row.title,
    author: authors[0] || "",
    authors: authors,
    category: row.categoryName,
    categoryId: row.categoryId,
    isbn: row.isbn,
    publisher: row.publisher || "",
    year: row.publishYear || null,
    summary: row.summary || "",
    desc: row.summary || "",
    total: total,
    available: available,
    borrowed: borrowed,
    rating: 0,
    rating_count: 0,
    rating_10: 0,
    // 借阅量 = loan.loan_record 里该书的全部记录数（BORROWED + RETURNED）
    borrows: Number(state.borrowCounts.get(Number(row.bookId))) || 0,
    colors: pickColors(row.isbn || row.title),
    coverUrl: coverUrlOf(row.coverUrl),
    shelfStatus: row.shelfStatus || "ON_SHELF",
    // BookCard 等处按小写形式判断是否在架，这里一并给出，避免两套写法
    shelf_status: String(row.shelfStatus || "ON_SHELF").toUpperCase() === "OFF_SHELF" ? "off_shelf" : "on_shelf"
  };
}

/**
 * 评价映射：后端字段是 reviewId/bookId/bookTitle/userId/rating/content/createdAt，
 * 前端各处（详情弹窗、书架评价、评分聚合）读的是下划线形式，这里统一一次。
 * 后端没有返回用户名，先用「读者 #id」占位，不再伪造姓名。
 */
function mapReview(r) {
  return {
    review_id: r.reviewId != null ? Number(r.reviewId) : r.review_id,
    id: r.reviewId != null ? Number(r.reviewId) : r.id,
    book_id: Number(r.bookId != null ? r.bookId : r.book_id),
    book_title: r.bookTitle || r.book_title || "",
    user_id: Number(r.userId != null ? r.userId : r.user_id),
    user_name: r.userName || r.user_name || ("读者 #" + (r.userId != null ? r.userId : r.user_id)),
    rating: Number(r.rating) || 0,
    content: r.content || "",
    created_at: r.createdAt || r.created_at || "",
    // 后端只返回未删除的评价，前端按「可见」处理
    status: r.status || "visible"
  };
}

/** 把评价聚合成每本书的评分（5 分制与 10 分制各存一份，供不同页面使用） */
function applyReviewStats() {
  const agg = new Map();
  state.reviews.forEach(function (r) {
    if (!r.book_id || !r.rating) return;
    const cur = agg.get(r.book_id) || { sum: 0, count: 0, latest: 0 };
    cur.sum += r.rating;
    cur.count += 1;
    const t = new Date(r.created_at).getTime();
    if (isFinite(t) && t > cur.latest) cur.latest = t;
    agg.set(r.book_id, cur);
  });
  state.ratingStats = agg;
  state.books.forEach(function (b) {
    const s = agg.get(Number(b.bookId));
    if (!s || !s.count) {
      b.rating = 0;
      b.rating_count = 0;
      b.rating_10 = 0;
      return;
    }
    b.rating = Math.round((s.sum / s.count) * 100) / 100;
    b.rating_count = s.count;
    b.rating_10 = Math.round((s.sum / s.count) * 20) / 10;
  });
}

function mapLoan(l) {
  return {
    borrow_id: l.loan_id,
    loan_id: l.loan_id,
    user_id: l.user_id,
    book_id: l.book_id,
    copy_id: l.copy_id,
    book_title: l.title,
    barcode: l.barcode,
    status: l.status,
    borrowed_at: l.borrowed_at,
    due_at: l.due_at,
    returned_at: l.returned_at,
    overdue: Boolean(l.overdue),
    deleted: Boolean(l.deleted)
  };
}

/** 热门排序：借阅量降序 → 可借数降序 → 书目编号升序（稳定、可复现） */
function hotOrder(a, b) {
  const borrowDiff = (Number(b.borrows) || 0) - (Number(a.borrows) || 0);
  if (borrowDiff !== 0) return borrowDiff;
  const availDiff = (Number(b.available) || 0) - (Number(a.available) || 0);
  if (availDiff !== 0) return availDiff;
  return Number(a.bookId) - Number(b.bookId);
}

function applyCopies(rows) {
  const map = new Map();
  rows.forEach(function (c) {
    const cur = map.get(c.book_id) || { total: 0, available: 0, borrowed: 0 };
    cur.total += 1;
    if (c.status === "AVAILABLE") cur.available += 1;
    // 已借出 / 逾期未还 / 遗失等「不在架」的副本都算占用，可借数不能把它们算进去
    else if (c.status === "BORROWED" || c.status === "OVERDUE") cur.borrowed += 1;
    map.set(c.book_id, cur);
  });
  state.copyStats = map;
}

/** 拉全量书目：/books 单页最多 100 条（BookQuery.MAX_SIZE），馆藏超 100 种时必须翻页取完 */
async function fetchAllBooks() {
  const out = [];
  for (let page = 1; page <= 200; page += 1) {
    const body = unwrap(await getJson("/api/catalog/books?page=" + page + "&size=100")) || {};
    const items = body.items || [];
    out.push.apply(out, items);
    const totalPages = Number(body.totalPages) || 0;
    if (!items.length || page >= totalPages) break;
  }
  return out;
}

/** 拉全量副本：/api/copies 每页最多 100 条，必须按 copy_id 游标翻完 */
async function fetchAllCopies() {
  const all = [];
  let after = 0;
  for (let guard = 0; guard < 500; guard += 1) {
    const rows = await getJson("/api/copies?after=" + after);
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) break;
    all.push.apply(all, list);
    const last = Number(list[list.length - 1].copy_id);
    if (!Number.isFinite(last) || last <= after) break;   // 游标不前进时防死循环
    after = last;
    if (list.length < 100) break;
  }
  return all;
}

// 角色码 → 前端角色。一个账号可能带多个角色，取权限最高的那个，
// 与后端 AuthFilter.mapRole 的优先级保持一致（馆员 > 分析员 > 运维 > 读者）。
function roleOf(roles) {
  const rs = roles || [];
  if (rs.indexOf("LIBRARIAN") >= 0 || rs.indexOf("ADMIN") >= 0) return "librarian";
  if (rs.indexOf("ANALYST") >= 0) return "analyst";
  if (rs.indexOf("OPS") >= 0 || rs.indexOf("OPERATOR") >= 0) return "ops";
  return "reader";
}

function clearToken() {
  state.token = "";
  state.user = null;
  state.loans = [];
  state.copyStats = new Map();
  sessionStorage.removeItem("tata-token");
}

// 唯一身份来源：/api/me 读的是 iam.user_role 的实时角色，
// 所以运维在控制台改完身份后，这里下次调用就能拿到新角色。
async function loadIdentity() {
  const token = state.token;
  const me = await getJson("/users/me");
  let database = null;
  if (me.roles.includes("READER") || me.roles.includes("LIBRARIAN")) {
    try {
      const loan = await getJson("/api/me");
      if (loan.id === me.id && loan.username === me.username) database = loan.database;
    } catch (error) {
      if (error.status === 401) throw error;
    }
  }
  if (token !== state.token) throw new Error("登录账号已经变更");
  const rs = me.roles || [];
  state.user = {
    id: me.id,
    username: me.username,
    name: me.username,
    role: roleOf(rs),
    roles: rs,
    database
  };
  return state.user;
}

export const api = {
  isMock: false,
  endpoints: {
    catalog: "/api/catalog",
    loans: "/api/loans",
    copies: "/api/copies",
    me: "/api/me"
  },

  async preload() {
    const errors = [];
    let bookRows = [];
    try {
      // 只取第 1 页会让 100 名之后的书（含借阅次数最多的老书）从首页消失，
      // 热门榜也就永远排不出真实名次，所以这里翻页取全量。
      bookRows = await fetchAllBooks();
    } catch (e) { errors.push("书目：" + e.message); }

    try {
      const cats = unwrap(await getJson("/api/catalog/categories")) || [];
      state.categories = cats.map(function (c) {
        return { id: c.categoryId, name: c.categoryName, count: c.bookCount };
      });
    } catch (e) { errors.push("分类：" + e.message); }

    try {
      // 借阅量是公开聚合数据（只有 book_id + 次数，不含读者信息），匿名也要取，
      // 否则首页「借阅 N」在未登录时恒为 0。
      const rows = await getJson("/api/borrow-counts");
      const counts = new Map();
      (Array.isArray(rows) ? rows : []).forEach(function (r) {
        const id = Number(r.book_id);
        if (id > 0) counts.set(id, Number(r.borrows) || 0);
      });
      state.borrowCounts = counts;
    } catch (e) { errors.push("借阅量：" + e.message); }

    if (state.token) {
      try { await loadIdentity(); }
      catch (e) {
        if (e.status === 401) clearToken();
        else errors.push("身份：" + e.message);
      }
    }
    const canBorrow = state.user?.roles?.some(role => role === "READER" || role === "LIBRARIAN");
    if (!canBorrow) {
      // 副本接口要求登录，匿名访问必然 401，不必发这一次请求
      state.copyStats = new Map();
    } else {
      try {
        // 副本表会随导入不断增长，只取首页 100 条会让绝大多数书显示「可借 0」。
        // 偶发失败（并发抖动）重试两次，否则统计会整片归零。
        let copies = null;
        for (let attempt = 0; attempt < 3 && copies === null; attempt += 1) {
          try {
            copies = await fetchAllCopies();
          } catch (e) {
            if (attempt === 2) throw e;
            await new Promise(function (r) { setTimeout(r, 300 * (attempt + 1)); });
          }
        }
        applyCopies(copies || []);
      } catch (e) { errors.push("副本：" + e.message); }
    }

    if (canBorrow) {
      try {
        // 只有馆员能看全馆借阅（借阅服务的 all=true 只放行 LIBRARIAN）；
        // 分析员/运维若带上 all=true 会被 403，列表反而整片空白。
        const all = Boolean(state.user) && Array.isArray(state.user.roles) && state.user.roles.indexOf("LIBRARIAN") >= 0;
        const loanToken = state.token;
        const rows = await getJson("/api/loans?after=0" + (all ? "&all=true" : ""));
        if (state.token === loanToken) state.loans = (Array.isArray(rows) ? rows : []).map(mapLoan);
      } catch (e) { errors.push("借阅：" + e.message); }
    } else {
      state.loans = [];
    }

    state.books = bookRows.map(function (r) { return mapBook(r, state.copyStats.get(r.bookId)); });
    state.byId = new Map(state.books.map(function (b) { return [b.id, b]; }));
    // 评价是公开只读数据：首页「口碑最高」、卡片评分、详情页评价列表都靠它。
    // 放在书目之后加载，拿到就能直接聚合到 book.rating / rating_count / rating_10。
    try {
      // catalog 统一是 {code,data} 壳，必须先 unwrap，否则拿到的是信封而不是 items
      const payload = unwrap(await getJson("/api/catalog/reviews"));
      const items = payload && Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : []);
      state.reviews = items.map(mapReview);
    } catch (e) { errors.push("评价：" + e.message); }
    applyReviewStats();
    state.loaded = true;
    state.lastError = errors.join("；");
    return { ok: errors.length === 0, errors: errors };
  },

  currentUser: function () { return state.user; },
  hasToken: function () { return Boolean(state.token); },

  /** 重新读一次库里的身份。角色被改过时，下一次调用就能看到新角色。 */
  refreshIdentity: async function () {
    if (!state.token) { state.user = null; return { ok: false, user: null, reason: "no-token" }; }
    try {
      const user = await loadIdentity();
      return { ok: true, user: user };
    } catch (e) {
      if (e.status === 401) { clearToken(); return { ok: false, user: null, reason: "unauthorized" }; }
      return { ok: false, user: state.user, reason: e.message };
    }
  },
  sessionUser: function () { return state.user; },
  users: function () { return state.user ? [state.user] : []; },
  userById: function (id) { return state.user && state.user.id === Number(id) ? state.user : null; },
  roles: function () { return [{ code: "reader", name: "读者" }, { code: "librarian", name: "馆员" }]; },

  can: function (permission, user) {
    const u = user || state.user;
    // 匿名游客按读者权限处理（只读浏览）
    const role = u ? u.role : "reader";
    const list = PERMISSIONS[role] || PERMISSIONS.reader;
    return list.indexOf(permission) >= 0;
  },

  categories: function () { return state.categories; },
  books: function () { return state.books; },
  bookById: function (id) { return state.byId.get(String(id)) || null; },
  /**
   * 热门排序口径：借阅量降序（在借 + 已还都算），借阅量相同再比可借数、书目编号，
   * 保证同一批数据每次渲染顺序稳定，翻页/筛选不会莫名换位。
   */
  hotBooks: function (limit, category) {
    let list = state.books.slice();
    if (category && category !== "全部") list = list.filter(function (b) { return b.category === category; });
    list.sort(hotOrder);
    return limit ? list.slice(0, limit) : list;
  },
  /**
   * 热门图书：**任何视图都只显示 per 本**，按借阅量取前 per 本。
   *   - 指定分类 → 该分类借阅量最高的 per 本；
   *   - 「全部」  → 全馆借阅量最高的 per 本（不再按分类合并，用户要求「全部」也只显示 8 本）。
   */
  hotByCategory: function (category, per) {
    const cap = Number(per) > 0 ? Number(per) : 8;
    return api.hotBooks(cap, category || "全部");
  },
  /** 全馆可借册数：各书「馆藏 − 已借出」之和，首页浮卡用它，不再靠不存在的 stats.availableCopies */
  availableCopies: function () {
    return state.books.reduce(function (n, b) {
      return n + Math.max(0, Number(b.available) || 0);
    }, 0);
  },
  /**
   * 口碑最高的书：优先近 days 天内的评价，窗口内没有评价则回退到全部评价。
   * 排序：平均分降序 → 评价人数降序 → 书目编号升序（同分也稳定）。
   * 返回 { book, stars, score, count, recent } 或 null。
   */
  topRated: function (days) {
    const windowMs = (Number(days) > 0 ? Number(days) : 7) * 86400000;
    const since = Date.now() - windowMs;
    function pick(recentOnly) {
      const agg = new Map();
      state.reviews.forEach(function (r) {
        if (!r.book_id || !r.rating) return;
        const t = new Date(r.created_at).getTime();
        if (recentOnly && (!isFinite(t) || t < since)) return;
        const cur = agg.get(r.book_id) || { sum: 0, count: 0 };
        cur.sum += r.rating;
        cur.count += 1;
        agg.set(r.book_id, cur);
      });
      const list = [];
      agg.forEach(function (v, bookId) {
        const book = state.byId.get(String(bookId));
        if (!book) return;
        const stars = v.sum / v.count;
        list.push({
          book: book,
          stars: stars,
          score: Math.round(stars * 20) / 10,
          count: v.count
        });
      });
      list.sort(function (a, b) {
        return (b.stars - a.stars) || (b.count - a.count) || (a.book.bookId - b.book.bookId);
      });
      return list[0] || null;
    }
    const recent = pick(true);
    if (recent) return Object.assign({ recent: true }, recent);
    const all = pick(false);
    return all ? Object.assign({ recent: false }, all) : null;
  },
  newArrivals: function (limit) {
    const list = state.books.slice().sort(function (a, b) { return b.bookId - a.bookId; });
    return limit ? list.slice(0, limit) : list;
  },
  availability: function (book) {
    if (!book) return 0;
    // 已经过 mapBook 的书直接取现成值（馆藏 - 已借出）
    if (book.available != null) return Number(book.available);
    const s = state.copyStats.get(Number(book.bookId || book.id));
    if (!s) return 0;
    const total = Number(book.totalCopies) > 0 ? Number(book.totalCopies) : s.total;
    return Math.max(0, total - (Number(s.borrowed) || 0));
  },
  /** 只刷新副本统计（可借 / 馆藏），比整包 preload 轻 */
  async refreshCopies() {
    try {
      applyCopies(await fetchAllCopies());
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  /** 全馆副本汇总：直接来自 loan.book_copy，控制台指标用 */
  copiesSummary: function () {
    let total = 0, available = 0;
    state.copyStats.forEach(function (s) {
      total += s.total;
      available += s.available;
    });
    return { total: total, available: available };
  },

  /**
   * 现查副本汇总：每次都向 loan-service 重新请求 /api/copies，
   * 不走启动时缓存，保证控制台指标与库里即时一致（同 consoleStats 的做法）。
   */
  async copiesLiveSummary() {
    const all = [];
    let after = 0;
    try {
      // 接口按 copy_id 分页，每页最多 100 条，循环取完
      for (let guard = 0; guard < 100; guard += 1) {
        const rows = await getJson("/api/copies?after=" + after);
        const list = Array.isArray(rows) ? rows : [];
        if (!list.length) break;
        all.push.apply(all, list);
        after = Number(list[list.length - 1].copy_id);
        if (list.length < 100) break;
      }
    } catch (e) {
      return { ok: false, total: 0, available: 0, message: e.message };
    }
    let available = 0;
    all.forEach(function (c) { if (c.status === "AVAILABLE") available += 1; });
    return { ok: true, total: all.length, available: available };
  },
  coverUrl: function (book) { return book && book.coverUrl ? book.coverUrl : ""; },

  /**
   * 多条件联动查询（「全部图书」页的多条件表单）。
   *
   * 后端接口：GET /api/catalog/books/search
   *   一次请求关联 catalog.book / category / book_author / author / media 五张表；
   *   每个条件独立生效、AND 连接，不传即不限；排序字段由后端白名单校验。
   *
   * 前端不做任何过滤/拼 SQL，条件原样交给后端，拿到什么就渲染什么。
   */
  async searchBooks(params) {
    const p = params || {};
    const qs = new URLSearchParams();
    ["title", "author", "publisher", "isbn", "categoryId", "yearFrom", "yearTo",
      "status", "sortBy", "sortOrder", "page", "size"].forEach(function (key) {
      const v = p[key];
      if (v !== undefined && v !== null && v !== "") qs.set(key, v);
    });
    const empty = { items: [], total: 0, page: 1, size: 12, totalPages: 0, joinTables: [], appliedConditions: 0 };
    try {
      const body = unwrap(await getJson("/api/catalog/books/search?" + qs.toString())) || {};
      const items = (body.items || []).map(function (row) {
        return mapBook(row, state.copyStats.get(row.bookId));
      });
      return Object.assign({
        ok: true,
        message: ""
      }, empty, {
        items: items,
        total: Number(body.total) || 0,
        page: Number(body.page) || 1,
        size: Number(body.size) || 12,
        totalPages: Number(body.totalPages) || 0,
        joinTables: body.joinTables || [],
        appliedConditions: Number(body.appliedConditions) || 0
      });
    } catch (e) {
      return Object.assign({ ok: false, message: e.message }, empty);
    }
  },

  borrows: function () { return state.loans; },
  listBorrows: function (options) {
    const opts = options || {};
    let list = state.loans.slice();
    const st = opts.status;
    if (st && st !== "all") {
      if (st === "active") list = list.filter(function (r) { return r.status === "BORROWED"; });
      else if (st === "returned" || st === "RETURNED") list = list.filter(function (r) { return r.status === "RETURNED"; });
      else if (st === "overdue") list = list.filter(function (r) { return r.overdue; });
      else list = list.filter(function (r) { return r.status === st; });
    }
    if (opts.userId) list = list.filter(function (r) { return r.user_id === Number(opts.userId); });
    return list.sort(function (a, b) { return b.loan_id - a.loan_id; });
  },
  activeBorrowsOf: function (userId) {
    return state.loans.filter(function (r) { return r.user_id === Number(userId) && r.status === "BORROWED"; });
  },
  hasReturned: function (userId, bookId) {
    return state.loans.some(function (r) {
      return r.user_id === Number(userId) && r.book_id === Number(bookId) && r.status === "RETURNED";
    });
  },
  reviewsFor: function (bookId) {
    // 详情弹窗、评价弹窗都按书过滤；以前忽略参数返回全部，
    // 只是当时评价列表恒为空所以没暴露出来。
    if (bookId == null || bookId === "") return state.reviews;
    const id = Number(bookId);
    return state.reviews.filter(function (r) { return Number(r.book_id) === id; });
  },
  announcements: function () { return state.announcements; },
  stats: function () {
    return {
      books: state.books.length,
      categories: state.categories.length,
      activeLoans: state.loans.filter(function (r) { return r.status === "BORROWED"; }).length,
      overdue: state.loans.filter(function (r) { return r.overdue; }).length,
      readers: new Set(state.loans.map(function (r) { return r.user_id; })).size
    };
  },
  clusterSnapshot: function () { return null; },
  ensureCovers: function () {},
  maxBorrows: function () { return 5; },
  loanDays: function () { return 14; },

  async login(username, password) {
    clearToken();
    try {
      const session = await getJson("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!session.accessToken) throw new Error("身份服务没有返回令牌");
      state.token = session.accessToken;
      const user = await loadIdentity();
      sessionStorage.setItem("tata-token", state.token);
      return { ok: true, user };
    } catch (error) {
      clearToken();
      return { ok: false, message: error.status === 401 ? "账号或密码不正确，或账号已停用。" : "登录失败，请检查身份服务连接。" };
    }
  },
  logout: clearToken,
  roleLabel: function (role) { return ROLE_LABEL[role] || role; },

  async borrowBook(userId, bookId) {
    try {
      const copies = await fetchAllCopies();
      const target = Number(bookId);
      const free = (Array.isArray(copies) ? copies : []).find(function (c) {
        return Number(c.book_id) === target && c.status === "AVAILABLE";
      });
      if (!free) return { ok: false, message: "这本书暂时没有可借副本" };

      await getJson("/api/loans", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
        body: JSON.stringify({
          readerId: Number(userId),
          copyId: free.copy_id,
          days: 14,
          requestKey: "web-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)
        })
      });
      await api.preload();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  async returnBook(loanId) {
    try {
      await getJson("/api/loans/" + Number(loanId) + "/return", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
        body: JSON.stringify({ requestKey: "web-ret-" + Date.now() })
      });
      await api.preload();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  async addReview(payload) {
    return sendJson("/api/catalog/reviews", "POST", payload);
  },

  // ---------- 控制台数据 ----------
  async consoleStats() {
    return sendJson("/api/catalog/stats", "GET", null);
  },

  async consoleUsers() {
    return sendJson("/api/catalog/users", "GET", null);
  },

  // ---------- 身份与权限（走身份服务，角色与数据库授权都在 iam schema） ----------
  async identityUsers() {
    try {
      const body = await getJson("/users/list");
      return { ok: true, data: body };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  async changeUserRole(userId, role) {
    try {
      const res = await fetch("/users/" + Number(userId) + "/role", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
        body: JSON.stringify({ role: role })
      });
      const body = await res.json().catch(function () { return null; });
      if (!res.ok) return { ok: false, message: (body && body.error) || ("HTTP " + res.status) };
      return { ok: true, data: body };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  async consoleReviews(bookId) {
    return sendJson("/api/catalog/reviews" + (bookId ? "?bookId=" + bookId : ""), "GET", null);
  },

  async deleteReview(id) {
    return sendJson("/api/catalog/reviews/" + id, "DELETE", null);
  },

  async consoleAnnouncements(publishedOnly) {
    return sendJson("/api/catalog/announcements" + (publishedOnly ? "?publishedOnly=true" : ""), "GET", null);
  },

  async saveAnnouncement(payload) {
    return sendJson("/api/catalog/announcements", "POST", payload);
  },

  async deleteAnnouncement(id) {
    return sendJson("/api/catalog/announcements/" + id, "DELETE", null);
  },

  async opsStatus() {
    return sendJson("/api/catalog/ops/status", "GET", null);
  },

  /** 只刷新借阅记录（控制台切到借阅页时调用，避免看到登录时的旧快照） */
  async refreshLoans() {
    try {
      const all = Boolean(state.user) && Array.isArray(state.user.roles) && state.user.roles.indexOf("LIBRARIAN") >= 0;
      const rows = await getJson("/api/loans?after=0" + (all ? "&all=true" : ""));
      state.loans = (Array.isArray(rows) ? rows : []).map(mapLoan);
      return { ok: true, count: state.loans.length };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  // ---------- 与借阅服务（C）协作：登记副本 ----------
  async syncSnapshot(book) {
    return sendJson("/api/book-snapshots", "PUT", {
      bookId: book.bookId, title: book.title, isbn: book.isbn
    });
  },

  async addCopy(bookId, barcode) {
    return sendJson("/api/copies", "POST", { bookId: Number(bookId), barcode: barcode });
  },

  /** 一次把某本书的副本补齐到 copies 册（后端单事务完成，幂等） */
  async batchCopies(book) {
    return sendJson("/api/copies/batch", "POST", {
      bookId: Number(book.bookId),
      title: book.title,
      isbn: book.isbn || "",
      count: Number(book.copies) || 0
    });
  },

  // ---------- 书目维护（馆员/管理员） ----------
  async saveBook(form, bookId) {
    const url = bookId ? "/api/catalog/books/" + bookId : "/api/catalog/books";
    return sendJson(url, bookId ? "PUT" : "POST", form);
  },

  async removeBook(bookId) {
    return sendJson("/api/catalog/books/" + bookId, "DELETE", null);
  },

  /** 批量删除（软删，与单条删除同一语义；后端逐条 update deleted=true） */
  async deleteBooks(bookIds) {
    const ids = (bookIds || []).map(Number).filter(function (n) { return n > 0; });
    if (!ids.length) return { ok: false, message: "请先选择要删除的图书" };
    return sendJson("/api/catalog/books/batch-delete", "POST", { bookIds: ids });
  },

  async restoreBook(bookId) {
    return sendJson("/api/catalog/books/" + bookId + "/restore", "POST", null);
  },

  /** 某本书当前的副本数（来自最近一次 /api/copies 缓存） */
  copiesOfBook(bookId) {
    const s = state.copyStats.get(Number(bookId));
    return s ? { total: s.total, available: s.available } : { total: 0, available: 0 };
  },

  /**
   * 维护页用：在架 + 已下架一起取，带 shelfStatus 字段。
   * /books 单页最多 100 条（BookQuery.MAX_SIZE），馆藏超过 100 种时必须翻页取完，
   * 否则页面只显示前 100 本。
   */
  async adminBooks() {
    const loadAll = async function (status) {
      const out = [];
      for (let page = 1; page <= 200; page += 1) {
        const body = unwrap(await getJson(
          "/api/catalog/books?page=" + page + "&size=100&status=" + status)) || {};
        const items = body.items || [];
        out.push.apply(out, items);
        const totalPages = Number(body.totalPages) || 0;
        if (!items.length || page >= totalPages) break;
      }
      return out;
    };
    const [onShelf, offShelf] = await Promise.all([loadAll("ON_SHELF"), loadAll("OFF_SHELF")]);
    return onShelf.concat(offShelf).map(function (r) {
      return mapBook(r, state.copyStats.get(r.bookId));
    });
  },

  async importBooks(file) {
    const data = new FormData();
    data.append("file", file);
    return sendForm("/api/catalog/books/import", data);
  },

  async uploadCover(bookId, file) {
    const data = new FormData();
    data.append("file", file);
    return sendForm("/api/catalog/books/" + bookId + "/cover", data);
  },

  exportBooksUrl: function (keyword) {
    const q = keyword ? "?keyword=" + encodeURIComponent(keyword) : "";
    return "/api/catalog/books/export" + q;
  },

  templateUrl: function () {
    return "/api/catalog/books/import-template";
  }
};

async function sendJson(url, method, body) {
  try {
    const res = await fetch(url, {
      method: method,
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: body ? JSON.stringify(body) : null
    });
    const payload = await res.json().catch(function () { return null; });
    if (!res.ok || (payload && payload.code && payload.code !== "OK")) {
      return { ok: false, message: (payload && (payload.message || payload.code)) || ("HTTP " + res.status) };
    }
    // catalog 走 ApiResponse（{code,data}），借阅服务直接返回业务对象。
    // 统一成「data 就是业务对象」，调用方不必区分两种壳。
    const data = payload && Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

async function sendForm(url, formData) {
  try {
    const res = await fetch(url, { method: "POST", headers: authHeaders(), body: formData });
    const payload = await res.json().catch(function () { return null; });
    if (!res.ok || (payload && payload.code && payload.code !== "OK")) {
      return { ok: false, message: (payload && (payload.message || payload.code)) || ("HTTP " + res.status) };
    }
    return { ok: true, data: payload ? payload.data : null };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
