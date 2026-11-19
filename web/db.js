(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TataDB = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = 6;
  var KEY = "tata-db-v6";
  var SESSION_KEY = "tata-session-v6";
  var LOAN_DAYS = 30;
  var MAX_BORROWS = 5;
  var DAY = 86400000;
  var memory = {};
  var coverCache = {};
  var DB = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function readRaw(key) {
    try {
      if (typeof localStorage !== "undefined") return localStorage.getItem(key);
    } catch (err) {}
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  function writeRaw(key, value) {
    try {
      if (typeof localStorage !== "undefined") {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
        return;
      }
    } catch (err) {}
    if (value === null) delete memory[key];
    else memory[key] = value;
  }

  function emit(type) {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
      window.dispatchEvent(new CustomEvent("tatadb:change", { detail: { type: type } }));
    }
  }

  function safeAdd(x, y) {
    var lsw = (x & 0xffff) + (y & 0xffff);
    var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }

  function bitRotateLeft(num, cnt) {
    return (num << cnt) | (num >>> (32 - cnt));
  }

  function md5cmn(q, a, b, x, s, t) {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }

  function md5ff(a, b, c, d, x, s, t) {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t);
  }

  function md5gg(a, b, c, d, x, s, t) {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  }

  function md5hh(a, b, c, d, x, s, t) {
    return md5cmn(b ^ c ^ d, a, b, x, s, t);
  }

  function md5ii(a, b, c, d, x, s, t) {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  function binlMD5(x, len) {
    var i, olda, oldb, oldc, oldd;
    var a = 1732584193;
    var b = -271733879;
    var c = -1732584194;
    var d = 271733878;

    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;

    for (i = 0; i < x.length; i += 16) {
      olda = a;
      oldb = b;
      oldc = c;
      oldd = d;

      a = md5ff(a, b, c, d, x[i], 7, -680876936);
      d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
      b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
      d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
      b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
      d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
      b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
      d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
      b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);

      a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
      d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
      b = md5gg(b, c, d, a, x[i], 20, -373897302);
      a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
      d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
      b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
      d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
      b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
      d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
      b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);

      a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
      d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
      b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
      d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
      b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
      d = md5hh(d, a, b, c, x[i], 11, -358537222);
      c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
      b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
      d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
      b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);

      a = md5ii(a, b, c, d, x[i], 6, -198630844);
      d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
      b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
      d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
      b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
      d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
      b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
      d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
      b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);

      a = safeAdd(a, olda);
      b = safeAdd(b, oldb);
      c = safeAdd(c, oldc);
      d = safeAdd(d, oldd);
    }

    return [a, b, c, d];
  }

  function rstr2binl(input) {
    var output = [];
    var i;
    for (i = 0; i < input.length * 8; i += 8) {
      output[i >> 5] |= (input.charCodeAt(i / 8) & 0xff) << (i % 32);
    }
    return output;
  }

  function binl2rstr(input) {
    var output = "";
    var i;
    for (i = 0; i < input.length * 32; i += 8) {
      output += String.fromCharCode((input[i >> 5] >>> (i % 32)) & 0xff);
    }
    return output;
  }

  function rstr2hex(input) {
    var hexTab = "0123456789abcdef";
    var output = "";
    var i;
    var x;
    for (i = 0; i < input.length; i++) {
      x = input.charCodeAt(i);
      output += hexTab.charAt((x >>> 4) & 0x0f) + hexTab.charAt(x & 0x0f);
    }
    return output;
  }

  function utf8Encode(string) {
    return unescape(encodeURIComponent(string));
  }

  function md5(str) {
    var bytes = utf8Encode(String(str));
    return rstr2hex(binl2rstr(binlMD5(rstr2binl(bytes), bytes.length * 8)));
  }

  var ROLES = [
    {
      code: "admin",
      name: "超级管理员",
      desc: "最高权限：用户与权限范围、图书与书目导入导出、评分管理、服务器主备、审计、看板、备份恢复、公告",
      permissions: ["*"]
    },
    {
      code: "librarian",
      name: "图书管理员",
      desc: "维护馆藏与上架状态、管理借阅归还、编辑读者评价、发布与修改公告；可编辑本人与读者资料、批量注册读者账号",
      permissions: [
        "console:access", "book:read", "book:detail", "book:write", "book:publish",
        "pdf:read", "pdf:manage", "borrow:self", "borrow:read", "borrow:manage",
        "feedback:manage", "review:manage", "announcement:read", "announcement:write",
        "finance:manage", "user:read", "user:edit", "user:import"
      ]
    },
    {
      code: "reader",
      name: "读者",
      desc: "浏览与借阅图书、续借归还、订阅新书、评分反馈、预约到货、查看公告",
      permissions: [
        "book:read", "book:detail", "pdf:read", "announcement:read", "review:read",
        "borrow:self", "rating:write", "feedback:write", "subscription:manage",
        "reserve:create"
      ]
    },
    {
      code: "guest",
      name: "访客",
      desc: "未登录状态，可浏览图书、搜索、查看详情、评价与公告；借阅/试读/订阅/评分时提示登录",
      permissions: ["book:read", "book:detail", "announcement:read", "review:read"]
    }
  ];

  var PERMISSION_CATALOG = [
    { perm: "book:read", label: "浏览图书", group: "公共" },
    { perm: "book:detail", label: "查看图书详情 / 试读", group: "公共" },
    { perm: "announcement:read", label: "查看公告", group: "公共" },
    { perm: "review:read", label: "查看评价", group: "公共" },
    { perm: "pdf:read", label: "PDF 前十页试读（登录后）", group: "读者" },
    { perm: "borrow:self", label: "本人借阅 / 续借 / 归还", group: "读者" },
    { perm: "rating:write", label: "评分与评价", group: "读者" },
    { perm: "feedback:write", label: "图书反馈", group: "读者" },
    { perm: "subscription:manage", label: "订阅新书推送", group: "读者" },
    { perm: "reserve:create", label: "预约到货提醒", group: "读者" },
    { perm: "console:access", label: "进入管理控制台", group: "图书管理员" },
    { perm: "book:write", label: "维护图书", group: "图书管理员" },
    { perm: "book:publish", label: "上架 / 下架 / 仓库管理", group: "图书管理员" },
    { perm: "pdf:manage", label: "导入 / 删除 PDF 试读", group: "图书管理员" },
    { perm: "borrow:read", label: "查看借阅明细", group: "图书管理员" },
    { perm: "borrow:manage", label: "管理归还 / 逾期 / 他人借阅", group: "图书管理员" },
    { perm: "feedback:manage", label: "管理图书反馈", group: "图书管理员" },
    { perm: "review:manage", label: "编辑 / 隐藏 / 删除评价", group: "图书管理员" },
    { perm: "announcement:write", label: "新增 / 编辑公告", group: "图书管理员" },
    { perm: "finance:manage", label: "编辑保证金与罚款标准", group: "图书管理员" },
    { perm: "user:read", label: "查看用户", group: "图书管理员" },
    { perm: "user:edit", label: "编辑本人 / 读者资料", group: "图书管理员" },
    { perm: "user:import", label: "批量注册新用户", group: "图书管理员" },
    { perm: "dashboard:read", label: "运营看板", group: "超级管理员" },
    { perm: "user:manage", label: "用户增删改 / 角色 / 启停", group: "超级管理员" },
    { perm: "permission:manage", label: "编辑权限范围", group: "超级管理员" },
    { perm: "data:export", label: "批量导出", group: "超级管理员" },
    { perm: "data:import", label: "批量导入", group: "超级管理员" },
    { perm: "backup:manage", label: "数据库备份 / 恢复", group: "超级管理员" },
    { perm: "server:manage", label: "主备服务器管理", group: "超级管理员" },
    { perm: "audit:read", label: "审计报告", group: "超级管理员" },
    { perm: "db:query", label: "数据库实验台查询", group: "超级管理员" },
    { perm: "db:proc", label: "调用存储过程", group: "超级管理员" },
    { perm: "system:reset", label: "重置演示数据", group: "超级管理员" },
    { perm: "system:configure", label: "访客可见范围 / 全局规则", group: "超级管理员" }
  ];

  var DB_USERS = [
    { username: "gauss_dba", type: "数据库管理员", auth: "IAM 联邦认证", privileges: "ALL PRIVILEGES", status: "online", last_login: "2026-11-14T01:12:00.000Z" },
    { username: "tata_app", type: "应用连接账户", auth: "密码 + IAM", privileges: "SELECT / INSERT / UPDATE / DELETE / EXECUTE", status: "online", last_login: "2026-11-14T02:18:00.000Z" },
    { username: "tata_readonly", type: "报表只读账户", auth: "IAM 联邦认证", privileges: "SELECT", status: "online", last_login: "2026-11-13T22:40:00.000Z" },
    { username: "tata_backup", type: "备份运维账户", auth: "密码 + 双因子", privileges: "BACKUP / RESTORE", status: "online", last_login: "2026-11-14T00:05:00.000Z" },
    { username: "tata_audit", type: "安全审计账户", auth: "IAM 联邦认证", privileges: "SELECT(audit_logs)", status: "online", last_login: "2026-11-12T09:30:00.000Z" }
  ];

  var DEFAULT_SETTINGS = {
    deposit_required: 100,
    fine_per_day: 1,
    grace_days: 0,
    max_borrow_days: 30,
    max_borrows: 5,
    renew_days: 15,
    max_renews: 1,
    public_visible_warehouse: false,
    public_categories: ["*"],
    default_scope: { borrow_limit: 5, max_days: 30, categories: ["*"] }
  };

  var CATEGORY_SEED = ["科幻", "文学", "历史", "科技", "商业", "心理"];

  function money(value) {
    var n = Number(value) || 0;
    return "¥" + n.toFixed(2);
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function bookSeed() {
    return [
      { id: "b-santi", title: "三体", author: "刘慈欣", category: "科幻", isbn: "978-7-5366-9293-0", publisher: "重庆出版社", year: 2008, total: 6, rating: 4.9, borrows: 328, colors: ["#0e1b2b", "#2c5364"], desc: "地球文明与三体文明的第一次接触，宏大的宇宙社会学寓言。" },
      { id: "b-huozhe", title: "活着", author: "余华", category: "文学", isbn: "978-7-5063-6543-7", publisher: "作家出版社", year: 2012, total: 5, rating: 4.8, borrows: 296, colors: ["#5c1f18", "#a8412f"], desc: "以福贵的一生，讲述人如何承受苦难并继续活着。" },
      { id: "b-bainian", title: "百年孤独", author: "加西亚·马尔克斯", category: "文学", isbn: "978-7-5442-5399-4", publisher: "南海出版公司", year: 2011, total: 4, rating: 4.7, borrows: 271, colors: ["#6b4a14", "#c08a2e"], desc: "布恩迪亚家族七代人的传奇，魔幻现实主义的巅峰之作。" },
      { id: "b-renleijianshi", title: "人类简史", author: "尤瓦尔·赫拉利", category: "历史", isbn: "978-7-5086-4424-4", publisher: "中信出版社", year: 2014, total: 5, rating: 4.6, borrows: 254, colors: ["#6d4c1e", "#b98a3f"], desc: "从认知革命到科学革命，重新理解智人的崛起。" },
      { id: "b-suanfa", title: "算法导论", author: "Thomas H. Cormen", category: "科技", isbn: "978-7-111-40701-0", publisher: "机械工业出版社", year: 2013, total: 3, rating: 4.7, borrows: 239, colors: ["#173b2f", "#2f6b4f"], desc: "算法领域的经典教材，覆盖排序、图论与动态规划。" },
      { id: "b-csapp", title: "深入理解计算机系统", author: "Randal E. Bryant", category: "科技", isbn: "978-7-111-54493-7", publisher: "机械工业出版社", year: 2016, total: 4, rating: 4.8, borrows: 226, colors: ["#1f2937", "#4b5d70"], desc: "从程序员视角贯通硬件、操作系统与编译系统。" },
      { id: "b-qiongchali", title: "穷查理宝典", author: "查理·芒格", category: "商业", isbn: "978-7-5086-9356-2", publisher: "中信出版社", year: 2018, total: 3, rating: 4.6, borrows: 198, colors: ["#4a2c1a", "#8a5a32"], desc: "芒格的多元思维模型与投资智慧合集。" },
      { id: "b-yuanze", title: "原则", author: "瑞·达利欧", category: "商业", isbn: "978-7-5086-8403-5", publisher: "中信出版社", year: 2018, total: 4, rating: 4.5, borrows: 187, colors: ["#243b53", "#486581"], desc: "桥水基金创始人的生活与工作原则。" },
      { id: "b-beitaoyan", title: "被讨厌的勇气", author: "岸见一郎", category: "心理", isbn: "978-7-111-49541-8", publisher: "机械工业出版社", year: 2015, total: 5, rating: 4.6, borrows: 176, colors: ["#134e4a", "#2c7a7b"], desc: "以对话形式阐释阿德勒心理学与课题分离。" },
      { id: "b-sikao", title: "思考，快与慢", author: "丹尼尔·卡尼曼", category: "心理", isbn: "978-7-5086-3312-9", publisher: "中信出版社", year: 2012, total: 3, rating: 4.5, borrows: 165, colors: ["#3b2a52", "#6b4f8a"], desc: "系统 1 与系统 2，揭示人类判断中的偏差。" },
      { id: "b-wanli", title: "万历十五年", author: "黄仁宇", category: "历史", isbn: "978-7-1010-5008-5", publisher: "中华书局", year: 2007, total: 4, rating: 4.7, borrows: 152, colors: ["#5a2a1e", "#a05a3c"], desc: "从平淡的一年切入，透视明代政治与社会结构。" },
      { id: "b-yueliang", title: "月亮与六便士", author: "毛姆", category: "文学", isbn: "978-7-5339-3564-2", publisher: "浙江文艺出版社", year: 2017, total: 4, rating: 4.6, borrows: 143, colors: ["#1e2a4a", "#3f5a8a"], desc: "在满地六便士的时代，抬头看见月亮。" },
      { id: "b-shujuku", title: "数据库系统概论", author: "王珊", category: "科技", isbn: "978-7-04-040664-1", publisher: "高等教育出版社", year: 2014, total: 6, rating: 4.7, borrows: 0, colors: ["#20343e", "#3f6a78"], desc: "数据库原理、关系代数、SQL、事务与并发控制的经典教材。新书到馆后先入仓库，验收上架后再开放借阅。" },
      { id: "b-ai", title: "人工智能：一种现代的方法", author: "Stuart Russell", category: "科技", isbn: "978-7-302-33199-2", publisher: "清华大学出版社", year: 2013, total: 4, rating: 4.8, borrows: 0, colors: ["#2b2140", "#5d4a86"], desc: "搜索、知识表示、机器学习与机器人学的系统教材。当前处于仓库待上架状态。" }
    ];
  }

  function defaultCluster() {
    var now = nowIso();
    return {
      primary: "node-a",
      standby: "node-b",
      autoFailover: true,
      switchCount: 0,
      lastFailover: null,
      nodes: {
        "node-a": {
          id: "node-a",
          name: "GaussDB 节点 A",
          host: "10.0.1.11",
          port: 8000,
          role: "primary",
          status: "online",
          latency: 8,
          cpu: 34,
          mem: 52,
          lag: 0,
          connections: 42,
          region: "华东 · 可用区 1",
          version: "openGauss 5.0.0",
          since: now
        },
        "node-b": {
          id: "node-b",
          name: "GaussDB 节点 B",
          host: "10.0.1.12",
          port: 8000,
          role: "standby",
          status: "online",
          latency: 11,
          cpu: 19,
          mem: 37,
          lag: 0.3,
          connections: 6,
          region: "华东 · 可用区 2",
          version: "openGauss 5.0.0",
          since: now
        }
      },
      events: [
        { ts: now, level: "info", text: "主备集群启动完成，节点 A 为主节点，节点 B 为备节点" },
        { ts: now, level: "info", text: "流复制通道已建立，复制延迟 0.3s" }
      ]
    };
  }

  function toBase64(text) {
    if (typeof btoa === "function") return btoa(text);
    if (typeof Buffer !== "undefined") return Buffer.from(text, "binary").toString("base64");
    return "";
  }

  function pdfEscape(text) {
    return String(text || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  function makeSamplePdf(title, totalPages) {
    var pages = Math.max(1, Math.min(60, Number(totalPages) || 16));
    var asciiTitle = String(title || "BIT BOOKS").replace(/[^\x20-\x7E]/g, "").trim() || "BIT BOOKS EDITION";
    var objects = {};
    var kids = [];
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    for (var i = 0; i < pages; i++) {
      var pageId = 4 + i * 2;
      var contentId = pageId + 1;
      kids.push(pageId + " 0 R");
      var content = [
        "BT",
        "/F1 23 Tf",
        "72 770 Td",
        "(" + pdfEscape("BIT BOOKS / SAMPLE EDITION") + ") Tj",
        "0 -38 Td",
        "/F1 17 Tf",
        "(" + pdfEscape(asciiTitle) + ") Tj",
        "0 -34 Td",
        "/F1 13 Tf",
        "(" + pdfEscape("Preview page " + (i + 1) + " of " + pages) + ") Tj",
        "0 -30 Td",
        "/F1 11 Tf",
        "(" + pdfEscape("Only the first 10 pages are exposed in the reader preview.") + ") Tj",
        "0 -18 Td",
        "(" + pdfEscape("Librarians can replace this file with a real PDF in the console.") + ") Tj",
        "0 -18 Td",
        "(" + pdfEscape("Generated demo file - no copyrighted content.") + ") Tj",
        "ET"
      ].join("\n");
      objects[pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " + contentId + " 0 R >>";
      objects[contentId] = "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream";
    }
    objects[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pages + " >>";
    var maxId = 4 + pages * 2 - 1;
    var out = "%PDF-1.4\n";
    var offsets = {};
    for (var id = 1; id <= maxId; id++) {
      offsets[id] = out.length;
      out += id + " 0 obj\n" + objects[id] + "\nendobj\n";
    }
    var xref = out.length;
    out += "xref\n0 " + (maxId + 1) + "\n0000000000 65535 f \n";
    for (var k = 1; k <= maxId; k++) {
      out += String(offsets[k]).padStart(10, "0") + " 00000 n \n";
    }
    out += "trailer\n<< /Size " + (maxId + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    return toBase64(out);
  }

  function defaultScope() {
    return clone(DEFAULT_SETTINGS.default_scope);
  }

  function scopeOf(user) {
    var scope = (user && user.scope) || {};
    var base = defaultScope();
    return {
      borrow_limit: Math.max(1, Number(scope.borrow_limit) || base.borrow_limit),
      max_days: Math.max(1, Number(scope.max_days) || base.max_days),
      categories: Array.isArray(scope.categories) && scope.categories.length ? scope.categories.slice() : base.categories.slice()
    };
  }

  function categoryAllowed(scope, category) {
    if (!scope || !scope.categories || scope.categories.indexOf("*") !== -1) return true;
    return scope.categories.indexOf(category) !== -1;
  }

  function pushNotification(db, userId, type, title, body, extra) {
    if (!userId) return null;
    var seq = db.seq.notification = (db.seq.notification || 0) + 1;
    var item = {
      id: "N" + String(seq).padStart(4, "0"),
      user_id: userId,
      type: type || "system",
      title: title,
      body: body || "",
      book_id: extra && extra.book_id ? extra.book_id : null,
      link: extra && extra.link ? extra.link : null,
      read: false,
      created_at: nowIso()
    };
    db.notifications.unshift(item);
    if (db.notifications.length > 500) db.notifications.length = 500;
    return item;
  }

  function recalcBookRating(db, bookId) {
    var book = db.books.filter(function (b) { return b.id === bookId; })[0];
    if (!book) return;
    var reviews = db.reviews.filter(function (r) {
      return r.book_id === bookId && r.status === "visible" && r.type === "review";
    });
    if (reviews.length) {
      var sum = reviews.reduce(function (acc, r) { return acc + Number(r.rating || 0); }, 0);
      var average = sum / reviews.length;
      book.rating = Math.round(average * 10) / 10;
      book.rating_10 = Math.round(average * 2 * 10) / 10;
      book.rating_count = reviews.length;
    } else {
      book.rating = 0;
      book.rating_10 = 0;
      book.rating_count = 0;
    }
  }

  function pushAudit(db, action, detail, level, actor, node) {
    var id = "LOG" + String(db.auditLogs.length + 1).padStart(4, "0");
    db.auditLogs.unshift({
      id: id,
      ts: nowIso(),
      actor: actor || "system",
      action: action,
      detail: detail,
      level: level || "info",
      node: node || db.cluster.primary
    });
    if (db.auditLogs.length > 300) db.auditLogs.length = 300;
  }

  function seedBorrow(db, userId, bookId, daysAgo, status, returnAfterDays) {
    var book = db.books.filter(function (b) { return b.id === bookId; })[0];
    if (!book) return;
    var borrowed = new Date(Date.now() - daysAgo * DAY);
    var due = new Date(borrowed.getTime() + LOAN_DAYS * DAY);
    var returned = null;
    if (status === "returned") {
      returned = new Date(Math.min(borrowed.getTime() + (returnAfterDays || 9) * DAY, Date.now() - 3600000));
    }
    var fine = 0;
    var fineDays = 0;
    if (returned && returned.getTime() > due.getTime()) {
      fineDays = Math.ceil((returned.getTime() - due.getTime()) / DAY);
      fine = round2(Math.max(0, fineDays - Number(db.settings.grace_days || 0)) * Number(db.settings.fine_per_day || 0));
      var owner = db.users.filter(function (u) { return u.id === userId; })[0];
      if (owner && fine) owner.deposit_balance = round2((Number(owner.deposit_balance) || 0) - fine);
    }
    var id = "BR" + String(db.borrows.length + 1).padStart(4, "0");
    db.borrows.push({
      id: id,
      user_id: userId,
      book_id: bookId,
      borrowed_at: borrowed.toISOString(),
      due_at: due.toISOString(),
      returned_at: returned ? returned.toISOString() : null,
      status: status,
      renew_count: 0,
      fine: fine,
      fine_days: fineDays,
      operator: "tata_app"
    });
  }

  function makeSnapshot(db) {
    return clone({
      users: db.users,
      roles: db.roles,
      books: db.books,
      categories: db.categories,
      borrows: db.borrows,
      dbUsers: db.dbUsers,
      auditLogs: db.auditLogs,
      settings: db.settings,
      reviews: db.reviews,
      announcements: db.announcements,
      notifications: db.notifications,
      waitlist: db.waitlist,
      seq: db.seq
    });
  }

  function seed() {
    var now = Date.now();
    var db = {
      version: VERSION,
      roles: clone(ROLES),
      users: [],
      categories: [],
      books: bookSeed(),
      borrows: [],
      dbUsers: clone(DB_USERS),
      auditLogs: [],
      backups: [],
      cluster: defaultCluster(),
      settings: clone(DEFAULT_SETTINGS),
      reviews: [],
      announcements: [],
      notifications: [],
      waitlist: [],
      seq: { user: 8, book: 14, borrow: 0, audit: 0, backup: 1, review: 0, announcement: 0, notification: 0, waitlist: 0 },
      meta: { createdAt: nowIso(), updatedAt: nowIso() }
    };

    var userSeed = [
      { id: "U001", username: "admin", password_md5: "0192023a7bbd73250516f069df18b500", name: "系统管理员", role: "admin", email: "admin@tata.books", phone: "138-0000-0001" },
      { id: "U002", username: "librarian", password_md5: "152ed960b613b67008ca54c756b4ced0", name: "周晓岚", role: "librarian", email: "zhouxl@tata.books", phone: "138-0000-0002" },
      { id: "U003", username: "reader", password_md5: "25bab5d8386065dbcaebde4d49aa2193", name: "林小满", role: "reader", email: "linxm@stu.edu.cn", phone: "138-0000-0003" },
      { id: "U004", username: "chenziang", password_md5: "25bab5d8386065dbcaebde4d49aa2193", name: "陈子昂", role: "reader", email: "chenza@stu.edu.cn", phone: "138-0000-0004" },
      { id: "U005", username: "wangyutong", password_md5: "25bab5d8386065dbcaebde4d49aa2193", name: "王雨桐", role: "reader", email: "wangyt@stu.edu.cn", phone: "138-0000-0005" },
      { id: "U006", username: "zhaoyifan", password_md5: "25bab5d8386065dbcaebde4d49aa2193", name: "赵一凡", role: "reader", email: "zhaoyf@stu.edu.cn", phone: "138-0000-0006" },
      { id: "U007", username: "sunjahe", password_md5: "25bab5d8386065dbcaebde4d49aa2193", name: "孙嘉禾", role: "reader", email: "sunjh@stu.edu.cn", phone: "138-0000-0007" },
      { id: "U008", username: "oldreader", password_md5: "25bab5d8386065dbcaebde4d49aa2193", name: "停用示例", role: "reader", status: "disabled", email: "old@stu.edu.cn", phone: "138-0000-0008" }
    ];

    userSeed.forEach(function (u) {
      db.users.push({
        id: u.id,
        username: u.username,
        password_md5: u.password_md5,
        name: u.name,
        role: u.role,
        status: u.status || "active",
        email: u.email,
        phone: u.phone,
        deposit_balance: u.role === "reader" ? 100 : 0,
        scope: defaultScope(),
        subscription: u.role === "reader",
        created_at: new Date(now - 120 * DAY).toISOString(),
        last_login: null
      });
    });
    db.users[4].deposit_balance = 88;
    db.users[6].deposit_balance = 73;

    CATEGORY_SEED.forEach(function (name, index) {
      db.categories.push({ id: "C" + String(index + 1).padStart(2, "0"), name: name, sort: index + 1 });
    });

    db.books.forEach(function (b) {
      b.available = b.total;
      b.cover_blob = null;
      b.cover_mime = "image/png";
      b.shelf_status = "on_shelf";
      b.rating = 0;
      b.rating_10 = 0;
      b.rating_count = 0;
      b.pdf_blob = null;
      b.pdf_name = "";
      b.pdf_pages = 0;
      b.pdf_mime = "application/pdf";
      b.pdf_demo = false;
      b.created_at = new Date(now - 200 * DAY).toISOString();
    });
    ["b-shujuku", "b-ai"].forEach(function (id) {
      var b = db.books.filter(function (x) { return x.id === id; })[0];
      if (b) {
        b.shelf_status = "warehouse";
        b.available = 0;
        b.created_at = new Date(now - 2 * DAY).toISOString();
      }
    });
    var newArrivals = ["b-huozhe", "b-bainian", "b-csapp", "b-yueliang", "b-beitaoyan", "b-qiongchali"];
    newArrivals.forEach(function (id, idx) {
      var b = db.books.filter(function (x) { return x.id === id; })[0];
      if (b) b.created_at = new Date(now - (idx + 1) * 6 * DAY).toISOString();
    });

    ["b-santi", "b-huozhe", "b-suanfa", "b-renleijianshi"].forEach(function (id) {
      var b = db.books.filter(function (x) { return x.id === id; })[0];
      if (!b) return;
      b.pdf_blob = makeSamplePdf(b.title, 16);
      b.pdf_name = "《" + b.title + "》试读本.pdf";
      b.pdf_pages = 16;
      b.pdf_mime = "application/pdf";
      b.pdf_demo = true;
      b.pdf_uploaded_at = new Date(now - 12 * DAY).toISOString();
      b.pdf_uploaded_by = "librarian";
    });

    var activeSeed = [
      ["U003", "b-santi", 3], ["U004", "b-santi", 9],
      ["U003", "b-huozhe", 6],
      ["U004", "b-bainian", 2], ["U005", "b-bainian", 5], ["U006", "b-bainian", 11], ["U007", "b-bainian", 35],
      ["U005", "b-renleijianshi", 1], ["U006", "b-renleijianshi", 8],
      ["U007", "b-suanfa", 4],
      ["U004", "b-csapp", 3], ["U005", "b-csapp", 10],
      ["U006", "b-qiongchali", 7],
      ["U004", "b-yuanze", 2], ["U005", "b-yuanze", 6], ["U006", "b-yuanze", 9],
      ["U007", "b-beitaoyan", 4], ["U004", "b-beitaoyan", 34],
      ["U006", "b-sikao", 3],
      ["U006", "b-wanli", 5],
      ["U007", "b-yueliang", 2], ["U005", "b-yueliang", 7]
    ];

    activeSeed.forEach(function (item) {
      seedBorrow(db, item[0], item[1], item[2], "borrowing");
    });

    var returnedSeed = [
      ["U003", "b-santi", 45], ["U004", "b-huozhe", 38], ["U005", "b-huozhe", 33],
      ["U006", "b-bainian", 41], ["U007", "b-renleijianshi", 29], ["U003", "b-suanfa", 26],
      ["U004", "b-csapp", 24], ["U005", "b-qiongchali", 22], ["U006", "b-yuanze", 20],
      ["U007", "b-beitaoyan", 18], ["U003", "b-sikao", 16], ["U005", "b-wanli", 15],
      ["U004", "b-yueliang", 14], ["U006", "b-santi", 13], ["U007", "b-huozhe", 12],
      ["U005", "b-bainian", 11], ["U003", "b-renleijianshi", 10], ["U004", "b-suanfa", 9]
    ];

    returnedSeed.forEach(function (item) {
      seedBorrow(db, item[0], item[1], item[2], "returned");
    });
    seedBorrow(db, "U003", "b-santi", 50, "returned", 40);

    db.books.forEach(function (b) {
      var active = db.borrows.filter(function (br) { return br.book_id === b.id && br.status !== "returned"; }).length;
      b.available = b.shelf_status === "on_shelf" ? Math.max(0, b.total - active) : 0;
    });
    db.seq.borrow = db.borrows.length;

    db.borrows.sort(function (a, b) { return new Date(b.borrowed_at) - new Date(a.borrowed_at); });

    var reviewSeed = [
      ["b-santi", "U003", 5, "宏大而克制，黑暗森林法则至今仍然震撼。", "visible", "感谢推荐，三体确实常读常新。"],
      ["b-santi", "U004", 4, "设定极强，人物稍显工具化，但瑕不掩瑜。", "visible", ""],
      ["b-huozhe", "U005", 5, "读完很久说不出话。活着本身就是意义。", "visible", "这句话总结得很好。"],
      ["b-bainian", "U006", 4, "人名重复是阅读门槛，但家族的宿命感很强。", "visible", ""],
      ["b-suanfa", "U007", 5, "课程指定教材，图论和动态规划章节讲得最透。", "visible", ""],
      ["b-renleijianshi", "U004", 4, "视角开阔，适合作为历史类入门。", "visible", ""],
      ["b-bainian", "U007", 2, "借到的这一册第 87 页有缺页，希望馆员处理。", "visible", "已收到，我们会更换馆藏并联系你。"],
      ["b-csapp", "U005", 3, "内容很好，但本书太重，建议增加电子试读。", "visible", ""]
    ];
    reviewSeed.forEach(function (item) {
      var book = db.books.filter(function (b) { return b.id === item[0]; })[0];
      var reviewer = db.users.filter(function (u) { return u.id === item[1]; })[0];
      if (!book || !reviewer) return;
      var seq = db.seq.review = (db.seq.review || 0) + 1;
      db.reviews.push({
        id: "RV" + String(seq).padStart(4, "0"),
        book_id: item[0],
        user_id: item[1],
        user_name: reviewer.name,
        rating: item[2],
        content: item[3],
        type: "review",
        status: item[4],
        reply: item[5] || "",
        replied_at: item[5] ? new Date(now - 3 * DAY).toISOString() : null,
        replied_by: item[5] ? "librarian" : "",
        created_at: new Date(now - (20 - seq) * DAY).toISOString()
      });
    });
    db.books.forEach(function (b) { recalcBookRating(db, b.id); });

    var announcements = [
      { title: "新书上架：数据库系统概论 / 人工智能：一种现代的方法", content: "两本新书已完成编目并进入仓库验收，验收通过后将开放借阅。已订阅新书推送的读者会收到到馆通知。", pinned: true, status: "published" },
      { title: "关于逾期罚款标准的说明", content: "自本月起，逾期归还按每天 ¥1.00 从保证金余额中扣除；每位读者注册时需缴纳 ¥100.00 保证金。保证金不足时请及时补缴，否则将暂停借阅。", pinned: false, status: "published" },
      { title: "国庆假期开放时间调整", content: "10 月 1 日至 10 月 3 日闭馆，10 月 4 日起恢复正常开放。闭馆期间到期图书会自动顺延，不产生逾期罚款。", pinned: false, status: "published" },
      { title: "馆员内部培训通知（草稿）", content: "本周五下午进行 openGauss 主备切换演练，请馆员提前熟悉控制台操作。", pinned: false, status: "draft" },
      { title: "自助借还机启用通知", content: "一楼大厅两台自助借还机已启用，支持刷校园卡借阅与归还；如遇设备异常，请移步服务台由馆员协助处理。", pinned: false, status: "published" },
      { title: "读者荐购通道开放", content: "每月 1–25 日可在服务台或管理控制台提交荐购书目，馆员将根据馆藏结构统一采购，并在到馆后通知荐购读者。", pinned: false, status: "published" }
    ];
    announcements.forEach(function (a, index) {
      var seq = db.seq.announcement = (db.seq.announcement || 0) + 1;
      db.announcements.push({
        id: "AN" + String(seq).padStart(3, "0"),
        title: a.title,
        content: a.content,
        pinned: a.pinned,
        status: a.status,
        author: index === 3 || index === 4 ? "librarian" : "admin",
        created_at: new Date(now - (index + 1) * DAY).toISOString(),
        updated_at: new Date(now - (index + 1) * DAY).toISOString()
      });
    });

    db.waitlist.push(
      { id: "W0001", book_id: "b-shujuku", user_id: "U005", created_at: new Date(now - DAY).toISOString(), notified: false },
      { id: "W0002", book_id: "b-shujuku", user_id: "U006", created_at: new Date(now - 8 * 3600000).toISOString(), notified: false }
    );
    db.seq.waitlist = 2;
    pushNotification(db, "U003", "new_book", "新书到馆提醒", "《数据库系统概论》已入库，上架后将第一时间通知你。", { book_id: "b-shujuku" });
    pushNotification(db, "U003", "fine", "逾期罚款提醒", "《百年孤独》已逾期，归还时将按每天 ¥1.00 扣款。", { book_id: "b-bainian" });
    pushNotification(db, "U004", "new_book", "新书到馆提醒", "你订阅的新书《人工智能：一种现代的方法》正在验收。", { book_id: "b-ai" });

    pushAudit(db, "SYSTEM_INIT", "初始化馆藏 12 种、读者 7 名、演示借阅记录 " + db.borrows.length + " 条", "info", "system");
    pushAudit(db, "TRG_AFTER_BORROW_INSERT", "触发器 fn_after_borrow 更新库存：三体 available 6 → 5", "trigger", "tata_app");
    pushAudit(db, "TRG_AFTER_RETURN_UPDATE", "触发器 fn_after_return 恢复库存：算法导论 available 2 → 3", "trigger", "tata_app");
    pushAudit(db, "LOGIN", "读者 林小满 通过应用登录，密码校验方式 MD5", "info", "reader");
    pushAudit(db, "BACKUP", "服务器端全量快照备份完成（初始化快照）", "success", "tata_backup");
    pushAudit(db, "PUBLISH announcements", "管理员发布 3 条公告，1 条草稿待审核", "info", "admin");
    pushAudit(db, "INSERT books", "新书《数据库系统概论》《人工智能：一种现代的方法》入库，状态 warehouse，待验收上架", "info", "admin");
    pushAudit(db, "FINE", "读者 林小满 归还《三体》逾期 10 天，扣款 ¥10.00，保证金余额 ¥90.00", "warn", "librarian");

    db.seq.user = 8;
    db.seq.book = 14;
    db.seq.audit = db.auditLogs.length;
    db.seq.backup = 1;

    var snapshot = makeSnapshot(db);
    db.backups.push({
      id: "BK-20261114-001",
      name: "初始化快照",
      note: "系统初始化后的基线备份",
      ts: new Date(now - 2 * 3600000).toISOString(),
      type: "full",
      status: "success",
      size: JSON.stringify(snapshot).length,
      node: "node-a",
      snapshot: snapshot
    });

    return db;
  }

  function load() {
    if (DB) return DB;
    var raw = readRaw(KEY);
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === VERSION && parsed.books && parsed.users) {
          DB = parsed;
          DB.roles = clone(ROLES);
          DB.cluster = DB.cluster || defaultCluster();
          DB.settings = Object.assign({}, clone(DEFAULT_SETTINGS), DB.settings || {});
          DB.reviews = DB.reviews || [];
          DB.announcements = DB.announcements || [];
          DB.notifications = DB.notifications || [];
          DB.waitlist = DB.waitlist || [];
          DB.seq = DB.seq || {};
          DB.seq.borrow = DB.seq.borrow || DB.borrows.length;
          DB.seq.book = DB.seq.book || DB.books.length;
          DB.seq.user = DB.seq.user || DB.users.length;
          DB.seq.review = DB.seq.review || DB.reviews.length;
          DB.seq.announcement = DB.seq.announcement || DB.announcements.length;
          DB.seq.notification = DB.seq.notification || DB.notifications.length;
          DB.seq.waitlist = DB.seq.waitlist || DB.waitlist.length;
          var shelfMigrated = false;
          DB.books.forEach(function (b) {
            if (["on_shelf", "warehouse", "off_shelf"].indexOf(b.shelf_status) === -1) {
              b.shelf_status = "on_shelf";
              shelfMigrated = true;
            }
          });
          if (shelfMigrated) {
            DB.books.forEach(function (b) {
              var active = DB.borrows.filter(function (br) { return br.book_id === b.id && br.status !== "returned"; }).length;
              b.available = b.shelf_status === "on_shelf" ? Math.max(0, Number(b.total || 0) - active) : 0;
            });
            persist();
          }
          var extraNotices = [
            { title: "自助借还机启用通知", content: "一楼大厅两台自助借还机已启用，支持刷校园卡借阅与归还；如遇设备异常，请移步服务台由馆员协助处理。", author: "librarian" },
            { title: "读者荐购通道开放", content: "每月 1–25 日可在服务台或管理控制台提交荐购书目，馆员将根据馆藏结构统一采购，并在到馆后通知荐购读者。", author: "admin" }
          ];
          var extraAdded = false;
          extraNotices.forEach(function (notice, index) {
            var exists = DB.announcements.some(function (a) { return a.title === notice.title; });
            if (exists) return;
            DB.seq.announcement = (DB.seq.announcement || 0) + 1;
            var ts = new Date(Date.now() - (index + 5) * DAY).toISOString();
            DB.announcements.push({
              id: "AN" + String(DB.seq.announcement).padStart(3, "0"),
              title: notice.title,
              content: notice.content,
              pinned: false,
              status: "published",
              author: notice.author,
              created_at: ts,
              updated_at: ts
            });
            extraAdded = true;
          });
          if (extraAdded) persist();
          return DB;
        }
      } catch (err) {}
    }
    DB = seed();
    persist();
    return DB;
  }

  function persist() {
    if (!DB) return;
    DB.meta.updatedAt = nowIso();
    try {
      writeRaw(KEY, JSON.stringify(DB));
    } catch (err) {}
    emit("persist");
  }

  function db() {
    return load();
  }

  function normalizeBorrowStatus(borrow) {
    if (borrow.status === "returned") return "returned";
    if (borrow.status === "overdue") return "overdue";
    if (new Date(borrow.due_at).getTime() < Date.now()) return "overdue";
    return "borrowing";
  }

  function shelfStatusLabel(status) {
    if (status === "warehouse") return "仓库待上架";
    if (status === "off_shelf") return "已下架";
    return "已上架";
  }

  function getUserById(id) {
    return db().users.filter(function (u) { return u.id === id; })[0] || null;
  }

  function getUserByName(username) {
    var lower = String(username || "").toLowerCase();
    return db().users.filter(function (u) { return u.username.toLowerCase() === lower; })[0] || null;
  }

  function getBook(id) {
    return db().books.filter(function (b) { return b.id === id; })[0] || null;
  }

  function getRole(code) {
    return db().roles.filter(function (r) { return r.code === code; })[0] || null;
  }

  function permissionsOf(user) {
    var role = user ? getRole(user.role) : getRole("guest");
    if (!role) return [];
    var perms = clone(role.permissions);
    if (!user || user.role === "guest") {
      perms = perms.filter(function (p) { return p !== "pdf:read"; });
    }
    return perms;
  }

  function currentUser() {
    var username = readRaw(SESSION_KEY);
    if (!username) return null;
    var user = getUserByName(username);
    if (!user || user.status !== "active") {
      writeRaw(SESSION_KEY, null);
      return null;
    }
    return clone(user);
  }

  function sessionUser() {
    var user = currentUser();
    if (user) return user;
    return {
      id: "guest",
      username: "guest",
      name: "访客",
      role: "guest",
      status: "active",
      email: "",
      phone: ""
    };
  }

  function can(permission, user) {
    var target = user || sessionUser();
    var perms = permissionsOf(target);
    if (perms.indexOf("*") !== -1) return true;
    return perms.indexOf(permission) !== -1;
  }

  function canAny(list, user) {
    var target = user || sessionUser();
    var perms = permissionsOf(target);
    if (perms.indexOf("*") !== -1) return true;
    return list.some(function (p) { return perms.indexOf(p) !== -1; });
  }

  function isStaff(user) {
    var target = user || sessionUser();
    return target && (target.role === "admin" || target.role === "librarian");
  }

  function forbidden(message) {
    return { ok: false, code: "FORBIDDEN", message: message || "当前账号没有该操作权限" };
  }

  function guard(permission, message) {
    return can(permission) ? null : forbidden(message);
  }

  function guardAny(list, message) {
    return canAny(list) ? null : forbidden(message);
  }

  function audit(action, detail, level, actor) {
    var actorName = actor || (currentUser() ? currentUser().username : "guest");
    pushAudit(load(), action, detail, level, actorName, DB.cluster.primary);
    persist();
    emit("audit");
  }

  function login(username, password) {
    var user = getUserByName(username);
    if (!user) return { ok: false, message: "用户名不存在" };
    if (user.status !== "active") return { ok: false, message: "账号已被停用，请联系管理员" };
    var hash = md5(password);
    if (hash !== user.password_md5) {
      audit("LOGIN_FAILED", "用户 " + username + " 密码校验失败", "warn", username);
      return { ok: false, message: "密码错误", hash: hash };
    }
    user.last_login = nowIso();
    writeRaw(SESSION_KEY, user.username);
    audit("LOGIN", "用户 " + user.name + " 登录成功，密码以 MD5 摘要比对", "success", user.username);
    persist();
    emit("login");
    return { ok: true, user: clone(user), hash: hash };
  }

  function register(payload) {
    var data = db();
    var username = String(payload.username || "").trim();
    var name = String(payload.name || "").trim();
    var password = String(payload.password || "");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return { ok: false, message: "账号需为 3–20 位字母、数字或下划线" };
    if (!name) return { ok: false, message: "姓名不能为空" };
    if (password.length < 6) return { ok: false, message: "密码至少 6 位" };
    if (getUserByName(username)) return { ok: false, message: "账号已存在，请直接登录或更换账号" };
    var deposit = round2(data.settings.deposit_required);
    var user = {
      id: nextUserId(),
      username: username,
      password_md5: md5(password),
      name: name,
      role: "reader",
      status: "active",
      email: String(payload.email || "").trim(),
      phone: String(payload.phone || "").trim(),
      deposit_balance: deposit,
      scope: defaultScope(),
      subscription: true,
      created_at: nowIso(),
      last_login: nowIso()
    };
    data.users.push(user);
    writeRaw(SESSION_KEY, user.username);
    pushAudit(data, "REGISTER users", "读者自助注册 " + username + "，缴纳保证金 " + money(deposit) + "，密码保存为 MD5 摘要", "success", username);
    pushNotification(data, user.id, "system", "欢迎加入BIT书屋", "已为你开通读者账号并缴纳保证金 " + money(deposit) + "。逾期归还会从保证金中扣款。");
    persist();
    emit("register");
    return { ok: true, message: "注册成功，已缴纳保证金 " + money(deposit), user: clone(user), hash: user.password_md5 };
  }

  function logout() {
    var user = currentUser();
    writeRaw(SESSION_KEY, null);
    if (user) audit("LOGOUT", "用户 " + user.name + " 退出登录", "info", user.username);
    emit("logout");
    return { ok: true };
  }

  function activeBorrowsOf(userId) {
    return db().borrows.filter(function (b) {
      return b.user_id === userId && b.status !== "returned";
    });
  }

  function hasReturned(userId, bookId) {
    return db().borrows.some(function (b) {
      return b.user_id === userId && b.book_id === bookId && b.status === "returned";
    });
  }

  function availability(book) {
    if (!book) return 0;
    if (book.shelf_status && book.shelf_status !== "on_shelf") return 0;
    return Math.max(0, Number(book.available) || 0);
  }

  function bookVisibleTo(book, user) {
    if (!book) return false;
    var target = user === undefined ? sessionUser() : user;
    var data = db();
    if (isStaff(target)) return true;
    if (book.shelf_status !== "on_shelf") {
      if (book.shelf_status === "warehouse" && target && target.role === "guest" && data.settings.public_visible_warehouse) {
        return categoryAllowed({ categories: data.settings.public_categories || ["*"] }, book.category);
      }
      return false;
    }
    if (!target || target.role === "guest") {
      return categoryAllowed({ categories: data.settings.public_categories || ["*"] }, book.category);
    }
    return true;
  }

  function publicBooks(user) {
    var target = user === undefined ? sessionUser() : user;
    return db().books.filter(function (b) { return bookVisibleTo(b, target); });
  }

  function borrowPolicyFor(user) {
    var data = db();
    var scope = scopeOf(user);
    return {
      limit: Math.max(1, Math.min(Number(data.settings.max_borrows) || MAX_BORROWS, scope.borrow_limit || MAX_BORROWS)),
      days: Math.max(1, Math.min(Number(data.settings.max_borrow_days) || LOAN_DAYS, scope.max_days || LOAN_DAYS)),
      categories: scope.categories,
      renew_days: Number(data.settings.renew_days) || 15,
      max_renews: Number(data.settings.max_renews) || 1,
      fine_per_day: Number(data.settings.fine_per_day) || 0,
      grace_days: Number(data.settings.grace_days) || 0
    };
  }

  function fineProjection(record) {
    if (!record) return { days: 0, fine: 0 };
    var data = db();
    var end = record.returned_at ? new Date(record.returned_at).getTime() : Date.now();
    var overMs = end - new Date(record.due_at).getTime();
    var days = overMs > 0 ? Math.ceil(overMs / DAY) : 0;
    var chargeDays = Math.max(0, days - (Number(data.settings.grace_days) || 0));
    return { days: days, fine: round2(chargeDays * (Number(data.settings.fine_per_day) || 0)) };
  }

  function borrowBook(userId, bookId) {
    var data = db();
    var actor = sessionUser();
    if (!actor || actor.role === "guest") return forbidden("请先登录或注册读者账号");
    if (actor.id !== userId && !can("borrow:manage", actor)) return forbidden("不能替其他读者借阅");
    var user = getUserById(userId);
    var book = getBook(bookId);
    if (!user) return { ok: false, message: "读者不存在" };
    if (user.status !== "active") return { ok: false, message: "读者账号已停用" };
    if (!book) return { ok: false, message: "图书不存在" };
    if (!bookVisibleTo(book, user)) return { ok: false, message: "该图书当前不对读者开放" };
    if (book.shelf_status !== "on_shelf") return { ok: false, message: "《" + book.title + "》尚未上架，可先预约到货提醒" };
    var policy = borrowPolicyFor(user);
    if (!categoryAllowed({ categories: policy.categories }, book.category)) {
      return { ok: false, message: "当前账号的借阅范围不包含「" + book.category + "」分类" };
    }
    if ((Number(user.deposit_balance) || 0) < 0) {
      return { ok: false, message: "保证金已透支，请先补缴后再借阅" };
    }
    var active = activeBorrowsOf(userId);
    if (active.length >= policy.limit) {
      return { ok: false, message: "当前账号最多同时借阅 " + policy.limit + " 本，请先归还一本" };
    }
    var dup = active.filter(function (b) { return b.book_id === bookId; })[0];
    if (dup) return { ok: false, message: "《" + book.title + "》已在借阅中，请勿重复借阅" };
    if (availability(book) <= 0) return { ok: false, message: "《" + book.title + "》库存不足，可预约到货提醒" };

    var borrowed = new Date();
    var due = new Date(borrowed.getTime() + policy.days * DAY);
    data.seq.borrow = (data.seq.borrow || 0) + 1;
    var id = "BR" + String(data.seq.borrow).padStart(4, "0");
    var record = {
      id: id,
      user_id: userId,
      book_id: bookId,
      borrowed_at: borrowed.toISOString(),
      due_at: due.toISOString(),
      returned_at: null,
      status: "borrowing",
      renew_count: 0,
      fine: 0,
      fine_days: 0,
      operator: actor.username
    };
    data.borrows.unshift(record);
    book.available = Math.max(0, book.available - 1);
    book.borrows = (book.borrows || 0) + 1;
    data.waitlist = data.waitlist.filter(function (w) { return !(w.book_id === bookId && w.user_id === userId && !w.notified); });

    pushAudit(data, "CALL sp_borrow_book", "参数 user_id=" + userId + ", book_id=" + bookId + "，返回 " + id + "，借期 " + policy.days + " 天", "info", actor.username);
    pushAudit(data, "TRG_AFTER_BORROW_INSERT", "触发器 fn_after_borrow：库存 " + (book.available + 1) + " → " + book.available + "，写入审计日志", "trigger", "tata_app");
    persist();
    emit("borrow");
    return { ok: true, message: "借阅成功，借期 " + policy.days + " 天", borrow: clone(record), book: clone(book), policy: policy };
  }

  function returnBook(borrowId, options) {
    var data = db();
    var opts = options || {};
    var actor = sessionUser();
    var record = data.borrows.filter(function (b) { return b.id === borrowId; })[0];
    if (!record) return { ok: false, message: "借阅记录不存在" };
    if (record.status === "returned") return { ok: false, message: "该图书已归还" };
    if (actor.role !== "guest" && actor.id === record.user_id) {
      if (!can("borrow:self", actor)) return forbidden("当前角色不能归还图书");
    } else if (!can("borrow:manage", actor)) {
      return forbidden("只能归还本人的借阅记录");
    }
    var book = getBook(record.book_id);
    var user = getUserById(record.user_id);
    var projection = fineProjection(record);
    record.status = "returned";
    record.returned_at = nowIso();
    record.fine = projection.fine;
    record.fine_days = projection.days;
    record.returned_by = opts.operator || actor.username;
    if (book) {
      var active = data.borrows.filter(function (b) { return b.book_id === book.id && b.status !== "returned"; }).length;
      book.available = book.shelf_status === "on_shelf" ? Math.max(0, book.total - active) : 0;
    }
    if (user) {
      user.deposit_balance = round2((Number(user.deposit_balance) || 0) - projection.fine);
      if (projection.fine > 0) {
        pushNotification(data, user.id, "fine", "逾期罚款已扣除", "《" + (book ? book.title : record.book_id) + "》逾期 " + projection.days + " 天，扣款 " + money(projection.fine) + "，当前保证金 " + money(user.deposit_balance) + "。", { book_id: record.book_id });
      }
    }
    var wait = data.waitlist.filter(function (w) { return w.book_id === record.book_id && !w.notified; }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })[0];
    if (wait && book && availability(book) > 0) {
      wait.notified = true;
      pushNotification(data, wait.user_id, "reserve", "预约图书已到馆", "《" + book.title + "》已归还并重新上架，请尽快到馆借阅。", { book_id: book.id });
    }
    pushAudit(data, "CALL sp_return_book", "参数 borrow_id=" + borrowId + "，归还《" + (book ? book.title : "") + "》，逾期 " + projection.days + " 天，扣款 " + money(projection.fine), projection.fine ? "warn" : "info", actor.username);
    pushAudit(data, "TRG_AFTER_RETURN_UPDATE", "触发器 fn_after_return：库存恢复为 " + (book ? book.available : "-") + "，写入审计日志", "trigger", "tata_app");
    persist();
    emit("return");
    return { ok: true, message: "归还成功" + (projection.fine ? "，扣除逾期罚款 " + money(projection.fine) : ""), borrow: clone(record), book: book ? clone(book) : null, fine: projection.fine, fine_days: projection.days };
  }

  function renewBorrow(borrowId) {
    var data = db();
    var actor = sessionUser();
    var record = data.borrows.filter(function (b) { return b.id === borrowId; })[0];
    if (!record) return { ok: false, message: "借阅记录不存在" };
    if (record.status === "returned") return { ok: false, message: "已归还的记录不能续借" };
    if (actor.id !== record.user_id && !can("borrow:manage", actor)) return forbidden("只能续借本人的借阅记录");
    if ((Number(record.renew_count) || 0) >= (Number(data.settings.max_renews) || 1)) {
      return { ok: false, message: "已达到最大续借次数" };
    }
    var projection = fineProjection(record);
    if (projection.days > 0) return { ok: false, message: "已逾期图书不能续借，请先归还" };
    var base = Math.max(Date.now(), new Date(record.due_at).getTime());
    record.due_at = new Date(base + (Number(data.settings.renew_days) || 15) * DAY).toISOString();
    record.renew_count = (Number(record.renew_count) || 0) + 1;
    pushNotification(data, record.user_id, "system", "续借成功", "《" + (getBook(record.book_id) || {}).title + "》已续借至 " + record.due_at.slice(0, 10) + "。", { book_id: record.book_id });
    pushAudit(data, "RENEW borrows", "借阅号 " + borrowId + " 续借，应还日期更新为 " + record.due_at.slice(0, 10), "info", actor.username);
    persist();
    emit("renew");
    return { ok: true, message: "续借成功，新的应还日期 " + record.due_at.slice(0, 10), borrow: clone(record) };
  }

  function reserveBook(bookId) {
    var data = db();
    var actor = sessionUser();
    if (!actor || actor.role === "guest") return forbidden("请先登录或注册读者账号");
    if (!canAny(["reserve:create", "borrow:self"], actor)) return forbidden();
    var book = getBook(bookId);
    if (!book) return { ok: false, message: "图书不存在" };
    if (availability(book) > 0) return { ok: false, message: "《" + book.title + "》当前可借，无需预约" };
    if (data.borrows.some(function (b) { return b.book_id === bookId && b.user_id === actor.id && b.status !== "returned"; })) {
      return { ok: false, message: "你已经在借阅这本书" };
    }
    if (data.waitlist.some(function (w) { return w.book_id === bookId && w.user_id === actor.id && !w.notified; })) {
      return { ok: false, message: "你已预约过这本书，到货后会通知你" };
    }
    data.seq.waitlist = (data.seq.waitlist || 0) + 1;
    data.waitlist.push({ id: "W" + String(data.seq.waitlist).padStart(4, "0"), book_id: bookId, user_id: actor.id, created_at: nowIso(), notified: false });
    var position = data.waitlist.filter(function (w) { return w.book_id === bookId && !w.notified; }).length;
    pushAudit(data, "RESERVE books", "读者 " + actor.name + " 预约《" + book.title + "》，队列第 " + position + " 位", "info", actor.username);
    persist();
    emit("reserve");
    return { ok: true, message: "预约成功，当前队列第 " + position + " 位，到货后会推送通知" };
  }

  function topUpDeposit(userId, amount) {
    var data = db();
    var actor = sessionUser();
    if (!actor || actor.role === "guest") return forbidden("请先登录");
    if (actor.id !== userId && !can("finance:manage", actor)) return forbidden("不能修改其他用户的保证金");
    var user = getUserById(userId);
    var value = round2(amount);
    if (!user) return { ok: false, message: "用户不存在" };
    if (!value || value <= 0) return { ok: false, message: "补缴金额必须大于 0" };
    user.deposit_balance = round2((Number(user.deposit_balance) || 0) + value);
    pushNotification(data, userId, "system", "保证金已补缴", "补缴 " + money(value) + "，当前余额 " + money(user.deposit_balance) + "。");
    pushAudit(data, "TOPUP deposit", "用户 " + user.username + " 补缴保证金 " + money(value) + "，余额 " + money(user.deposit_balance), "success", actor.username);
    persist();
    emit("deposit");
    return { ok: true, message: "补缴成功，当前保证金 " + money(user.deposit_balance), balance: user.deposit_balance };
  }

  function adjustBalance(userId, amount, reason) {
    var denied = guardAny(["finance:manage", "user:manage"], "当前角色不能调整保证金");
    if (denied) return denied;
    var data = db();
    var user = getUserById(userId);
    var value = round2(amount);
    if (!user) return { ok: false, message: "用户不存在" };
    if (!value) return { ok: false, message: "调整金额不能为 0" };
    user.deposit_balance = round2((Number(user.deposit_balance) || 0) + value);
    pushNotification(data, user.id, "system", "保证金余额已调整", (reason ? reason + "：" : "") + (value > 0 ? "+" : "") + money(value) + "，当前余额 " + money(user.deposit_balance) + "。");
    pushAudit(data, "ADJUST deposit", "调整 " + user.username + " 保证金 " + (value > 0 ? "+" : "") + money(value) + "（" + (reason || "人工调整") + "），余额 " + money(user.deposit_balance), "warn", sessionUser().username);
    persist();
    emit("deposit");
    return { ok: true, message: "保证金已调整，当前余额 " + money(user.deposit_balance), balance: user.deposit_balance };
  }

  function overdueSweep() {
    var denied = guard("borrow:manage", "只有馆员或管理员可以执行逾期扫描");
    if (denied) return denied;
    var data = db();
    var changed = [];
    data.borrows.forEach(function (b) {
      if (b.status === "borrowing" && new Date(b.due_at).getTime() < Date.now()) {
        b.status = "overdue";
        changed.push(clone(b));
      }
    });
    if (changed.length) {
      pushAudit(data, "CALL sp_overdue_check", "扫描到 " + changed.length + " 条逾期记录并更新状态", "warn", "tata_app");
      persist();
      emit("overdue");
    }
    return { ok: true, message: "扫描完成，更新 " + changed.length + " 条逾期记录", rows: changed };
  }

  function listBorrows(options) {
    var opts = Object.assign({}, options || {});
    var data = db();
    var actor = sessionUser();
    if (!canAny(["borrow:read", "borrow:manage"], actor) && !opts.userId) {
      opts.userId = actor.id === "guest" ? "__no_user__" : actor.id;
    }
    var rows = data.borrows.map(function (b) {
      var user = getUserById(b.user_id);
      var book = getBook(b.book_id);
      var status = normalizeBorrowStatus(b);
      var projection = fineProjection(b);
      return {
        borrow_id: b.id,
        user_id: b.user_id,
        user_name: user ? user.name : "(已删除)",
        username: user ? user.username : "-",
        role: user ? user.role : "-",
        book_id: b.book_id,
        book_title: book ? book.title : "(已下架)",
        book_author: book ? book.author : "-",
        category: book ? book.category : "-",
        borrowed_at: b.borrowed_at,
        due_at: b.due_at,
        returned_at: b.returned_at,
        status: status,
        stored_status: b.status,
        days_left: Math.ceil((new Date(b.due_at).getTime() - Date.now()) / DAY),
        fine: Number(b.fine) || 0,
        fine_days: Number(b.fine_days) || 0,
        projected_fine: projection.fine,
        projected_days: projection.days,
        renew_count: Number(b.renew_count) || 0,
        balance: user ? Number(user.deposit_balance) || 0 : 0,
        raw: b
      };
    });

    if (opts.userId) rows = rows.filter(function (r) { return r.user_id === opts.userId; });
    if (opts.status && opts.status !== "all") {
      if (opts.status === "active") rows = rows.filter(function (r) { return r.status !== "returned"; });
      else rows = rows.filter(function (r) { return r.status === opts.status; });
    }
    if (opts.query) {
      var q = String(opts.query).toLowerCase();
      rows = rows.filter(function (r) {
        return [r.borrow_id, r.user_name, r.username, r.book_title, r.category].join(" ").toLowerCase().indexOf(q) !== -1;
      });
    }
    rows.sort(function (a, b) {
      var aa = a.status === "returned" ? 1 : 0;
      var bb = b.status === "returned" ? 1 : 0;
      if (aa !== bb) return aa - bb;
      return new Date(b.borrowed_at) - new Date(a.borrowed_at);
    });
    return rows;
  }

  function reviewsFor(bookId, options) {
    var opts = options || {};
    var canManage = canAny(["review:manage", "feedback:manage"]);
    var type = opts.type || null;
    var rows = db().reviews.filter(function (r) {
      if (bookId && r.book_id !== bookId) return false;
      if (type && r.type !== type) return false;
      if (!canManage && r.status !== "visible") return false;
      return true;
    }).map(function (r) {
      var user = getUserById(r.user_id);
      var book = getBook(r.book_id);
      return Object.assign({}, clone(r), {
        user_name: user ? user.name : r.user_name || "(已删除)",
        username: user ? user.username : "-",
        book_title: book ? book.title : "(已下架)"
      });
    }).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    return rows;
  }

  function addReview(payload) {
    var actor = sessionUser();
    if (!actor || actor.role === "guest") return forbidden("请先登录或注册后再评价");
    if (actor.role !== "reader" || !can("rating:write", actor)) return forbidden("只有读者可以提交评分与评价");
    var data = db();
    var book = getBook(payload.bookId);
    if (!book) return { ok: false, message: "图书不存在" };
    var rawRating = Number(payload.rating);
    if (!isFinite(rawRating) || rawRating < 1 || rawRating > 5) {
      return { ok: false, message: "请先选择 1–5 颗星的评分" };
    }
    var rating = Math.round(rawRating);
    var content = String(payload.content || "").trim();
    if (content.length > 500) return { ok: false, message: "评价内容不能超过 500 字" };
    var returned = data.borrows.some(function (r) {
      return r.user_id === actor.id && r.book_id === payload.bookId && r.status === "returned";
    });
    if (!returned) return { ok: false, message: "归还《" + book.title + "》后才能评价" };
    var existing = data.reviews.filter(function (r) {
      return r.book_id === payload.bookId && r.user_id === actor.id && r.type === "review";
    })[0];
    if (existing) {
      existing.rating = rating;
      existing.content = content;
      existing.status = "visible";
      existing.created_at = nowIso();
      existing.updated_at = nowIso();
    } else {
      data.seq.review = (data.seq.review || 0) + 1;
      data.reviews.push({
        id: "RV" + String(data.seq.review).padStart(4, "0"),
        book_id: payload.bookId,
        user_id: actor.id,
        user_name: actor.name,
        rating: rating,
        content: content,
        type: "review",
        status: "visible",
        reply: "",
        replied_at: null,
        replied_by: "",
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
    recalcBookRating(data, payload.bookId);
    pushAudit(data, "INSERT reviews", "读者评价《" + book.title + "》" + rating + " 星" + (content ? "：" + content.slice(0, 60) : "（未填写文字）"), "info", actor.username);
    persist();
    emit("review");
    return {
      ok: true,
      message: "评价已提交，感谢你的分享",
      rating: book.rating,
      rating_10: book.rating_10,
      rating_count: book.rating_count
    };
  }

  function setReviewStatus(id, status) {
    var denied = guardAny(["review:manage", "feedback:manage"], "当前角色不能管理评价");
    if (denied) return denied;
    var data = db();
    var review = data.reviews.filter(function (r) { return r.id === id; })[0];
    if (!review) return { ok: false, message: "评价不存在" };
    review.status = status === "hidden" ? "hidden" : "visible";
    recalcBookRating(data, review.book_id);
    pushAudit(data, "UPDATE reviews.status", "评价 " + id + " 状态 → " + review.status, "warn", sessionUser().username);
    persist();
    emit("review");
    return { ok: true, message: review.status === "hidden" ? "评价已隐藏" : "评价已恢复显示" };
  }

  function updateReview(id, payload) {
    var denied = guardAny(["review:manage", "feedback:manage"], "当前角色不能编辑评价");
    if (denied) return denied;
    var data = db();
    var review = data.reviews.filter(function (r) { return r.id === id; })[0];
    if (!review) return { ok: false, message: "评价不存在" };
    var rawRating = Number(payload && payload.rating);
    if (!isFinite(rawRating) || rawRating < 1 || rawRating > 5) {
      return { ok: false, message: "评分必须为 1–5 颗星" };
    }
    var rating = Math.round(rawRating);
    var content = String((payload && payload.content) || "").trim();
    if (content.length > 500) return { ok: false, message: "评价内容不能超过 500 字" };
    review.rating = rating;
    review.content = content;
    review.updated_at = nowIso();
    recalcBookRating(data, review.book_id);
    pushAudit(data, "UPDATE reviews", "编辑评价 " + id + "：" + rating + " 星" + (content ? "，" + content.slice(0, 60) : "（未填写文字）"), "info", sessionUser().username);
    persist();
    emit("review");
    var book = getBook(review.book_id);
    return {
      ok: true,
      message: "评价已更新，图书得分已重新计算",
      rating: book ? book.rating : 0,
      rating_10: book ? book.rating_10 : 0,
      rating_count: book ? book.rating_count : 0
    };
  }

  function replyReview(id, reply) {
    var denied = guardAny(["review:manage", "feedback:manage"], "当前角色不能回复评价");
    if (denied) return denied;
    var data = db();
    var review = data.reviews.filter(function (r) { return r.id === id; })[0];
    if (!review) return { ok: false, message: "评价不存在" };
    review.reply = String(reply || "").trim();
    review.replied_at = nowIso();
    review.replied_by = sessionUser().username;
    pushAudit(data, "REPLY reviews", "回复评价 " + id + "：" + review.reply.slice(0, 60), "info", sessionUser().username);
    persist();
    emit("review");
    return { ok: true, message: "回复已保存" };
  }

  function deleteReview(id) {
    var denied = guardAny(["review:manage", "feedback:manage"], "当前角色不能删除评价");
    if (denied) return denied;
    var data = db();
    var review = data.reviews.filter(function (r) { return r.id === id; })[0];
    if (!review) return { ok: false, message: "评价不存在" };
    data.reviews = data.reviews.filter(function (r) { return r.id !== id; });
    recalcBookRating(data, review.book_id);
    pushAudit(data, "DELETE reviews", "删除评价 " + id + "（" + review.book_id + "）", "warn", sessionUser().username);
    persist();
    emit("review");
    return { ok: true, message: "评价已删除" };
  }

  function announcements(publishedOnly) {
    var canManage = can("announcement:write");
    var rows = db().announcements.filter(function (a) {
      return canManage && !publishedOnly ? true : a.status === "published";
    }).slice().sort(function (a, b) {
      if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    return clone(rows);
  }

  function saveAnnouncement(payload) {
    var denied = guard("announcement:write", "当前角色不能编辑公告");
    if (denied) return denied;
    var data = db();
    var title = String(payload.title || "").trim();
    var content = String(payload.content || "").trim();
    if (!title || !content) return { ok: false, message: "公告标题和内容不能为空" };
    var existing = payload.id ? data.announcements.filter(function (a) { return a.id === payload.id; })[0] : null;
    if (existing) {
      existing.title = title;
      existing.content = content;
      existing.pinned = Boolean(payload.pinned);
      existing.status = payload.status === "draft" ? "draft" : "published";
      existing.updated_at = nowIso();
      pushAudit(data, "UPDATE announcements", "更新公告《" + title + "》，状态 " + existing.status, "info", sessionUser().username);
    } else {
      data.seq.announcement = (data.seq.announcement || 0) + 1;
      var item = {
        id: "AN" + String(data.seq.announcement).padStart(3, "0"),
        title: title,
        content: content,
        pinned: Boolean(payload.pinned),
        status: payload.status === "draft" ? "draft" : "published",
        author: sessionUser().username,
        created_at: nowIso(),
        updated_at: nowIso()
      };
      data.announcements.unshift(item);
      pushAudit(data, "INSERT announcements", "新增公告《" + title + "》，状态 " + item.status, "success", sessionUser().username);
    }
    persist();
    emit("announcement");
    return { ok: true, message: "公告已保存" };
  }

  function deleteAnnouncement(id) {
    var denied = guard("announcement:write", "当前角色不能删除公告");
    if (denied) return denied;
    var data = db();
    var item = data.announcements.filter(function (a) { return a.id === id; })[0];
    if (!item) return { ok: false, message: "公告不存在" };
    data.announcements = data.announcements.filter(function (a) { return a.id !== id; });
    pushAudit(data, "DELETE announcements", "删除公告《" + item.title + "》", "warn", sessionUser().username);
    persist();
    emit("announcement");
    return { ok: true, message: "公告已删除" };
  }

  function notificationsOf(userId) {
    var actor = sessionUser();
    if (actor.role !== "admin" && actor.id !== userId) return [];
    return clone(db().notifications.filter(function (n) { return n.user_id === userId; }).slice(0, 80));
  }

  function unreadNotificationCount(userId) {
    var actor = sessionUser();
    if (actor.role === "guest" || (actor.id !== userId && actor.role !== "admin")) return 0;
    return db().notifications.filter(function (n) { return n.user_id === userId && !n.read; }).length;
  }

  function markNotificationsRead(userId, ids) {
    var data = db();
    var actor = sessionUser();
    if (actor.role === "guest" || (actor.id !== userId && actor.role !== "admin")) return forbidden();
    var set = Array.isArray(ids) && ids.length ? ids : null;
    data.notifications.forEach(function (n) {
      if (n.user_id !== userId) return;
      if (!set || set.indexOf(n.id) !== -1) n.read = true;
    });
    persist();
    emit("notification");
    return { ok: true, message: "通知已标记为已读" };
  }

  function subscribeNewBooks(enabled) {
    var data = db();
    var actor = sessionUser();
    if (!actor || actor.role === "guest") return forbidden("请先登录或注册");
    if (!can("subscription:manage", actor)) return forbidden();
    var user = getUserById(actor.id);
    if (!user) return forbidden();
    user.subscription = Boolean(enabled);
    pushAudit(data, "UPDATE users.subscription", "用户 " + user.username + " " + (user.subscription ? "开启" : "关闭") + "新书订阅推送", "info", actor.username);
    persist();
    emit("subscription");
    return { ok: true, message: user.subscription ? "已开启新书订阅推送" : "已关闭新书订阅推送", subscription: user.subscription };
  }

  function notifyNewBook(book, actor) {
    if (!book || book.shelf_status !== "on_shelf") return 0;
    var data = db();
    var count = 0;
    data.users.forEach(function (u) {
      if (u.role !== "reader" || u.status !== "active" || !u.subscription) return;
      pushNotification(data, u.id, "new_book", "新书上架：" + book.title, "你订阅的新书《" + book.title + "》已上架，可前往首页借阅。", { book_id: book.id });
      count += 1;
    });
    if (count) pushAudit(data, "PUSH new_book", "向 " + count + " 名订阅读者推送《" + book.title + "》上架通知", "success", actor || "system");
    return count;
  }

  function waitlistOf(bookId) {
    var rows = db().waitlist.filter(function (w) { return !bookId || w.book_id === bookId; }).map(function (w) {
      var user = getUserById(w.user_id);
      var book = getBook(w.book_id);
      return Object.assign({}, clone(w), { user_name: user ? user.name : "-", username: user ? user.username : "-", book_title: book ? book.title : "-" });
    });
    return rows;
  }

  function hotBooks(limit, category) {
    var data = db();
    var viewer = sessionUser();
    var cutoff = Date.now() - 30 * DAY;
    var rows = data.books.filter(function (b) {
      if (!bookVisibleTo(b, viewer)) return false;
      return !category || category === "全部" || b.category === category;
    }).map(function (b) {
      var recent = data.borrows.filter(function (br) {
        return br.book_id === b.id && new Date(br.borrowed_at).getTime() >= cutoff;
      }).length;
      return Object.assign({}, b, {
        pdf_blob: null,
        has_pdf: Boolean(b.pdf_blob),
        recent_count: recent,
        heat: (b.borrows || 0) + recent * 3
      });
    });
    rows.sort(function (a, b) {
      if (b.heat !== a.heat) return b.heat - a.heat;
      return b.rating - a.rating;
    });
    return limit ? rows.slice(0, limit) : rows;
  }

  function newArrivals(limit) {
    var viewer = sessionUser();
    var rows = db().books
      .filter(function (b) { return bookVisibleTo(b, viewer); })
      .slice()
      .sort(function (a, b) {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
    return (limit ? rows.slice(0, limit) : rows).map(function (b) {
      return Object.assign({}, b, { pdf_blob: null, has_pdf: Boolean(b.pdf_blob), recent_count: 0, heat: 0 });
    });
  }

  function categories() {
    return clone(db().categories);
  }

  function stats() {
    var data = db();
    var active = data.borrows.filter(function (b) { return normalizeBorrowStatus(b) !== "returned"; });
    var overdue = active.filter(function (b) { return normalizeBorrowStatus(b) === "overdue"; });
    var today = new Date().toISOString().slice(0, 10);
    var todayBorrow = data.borrows.filter(function (b) { return b.borrowed_at.slice(0, 10) === today; }).length;
    var totalCopies = data.books.reduce(function (sum, b) { return sum + Number(b.total || 0); }, 0);
    var availableCopies = data.books.reduce(function (sum, b) { return sum + availability(b); }, 0);
    var readers = data.users.filter(function (u) { return u.role === "reader" && u.status === "active"; }).length;
    var byCategory = {};
    active.forEach(function (b) {
      var book = getBook(b.book_id);
      if (!book) return;
      byCategory[book.category] = (byCategory[book.category] || 0) + 1;
    });
    var topCategory = Object.keys(byCategory).sort(function (a, b) { return byCategory[b] - byCategory[a]; })[0] || "-";
    var warehouse = data.books.filter(function (b) { return b.shelf_status === "warehouse"; });
    var pendingFeedback = data.reviews.filter(function (r) { return r.type === "review" && r.status === "visible" && !r.reply; });
    var outstanding = data.users.reduce(function (sum, u) {
      return sum + (u.role === "reader" && Number(u.deposit_balance) < 0 ? Math.abs(Number(u.deposit_balance)) : 0);
    }, 0);
    return {
      titles: data.books.length,
      totalCopies: totalCopies,
      availableCopies: availableCopies,
      readers: readers,
      activeBorrows: active.length,
      overdue: overdue.length,
      todayBorrows: todayBorrow,
      utilization: totalCopies ? Math.round(((totalCopies - availableCopies) / totalCopies) * 100) : 0,
      topCategory: topCategory,
      auditCount: data.auditLogs.length,
      backupCount: data.backups.length,
      warehouseTitles: warehouse.length,
      warehouseCopies: warehouse.reduce(function (sum, b) { return sum + Number(b.total || 0); }, 0),
      pendingFeedback: pendingFeedback.length,
      outstandingFines: round2(outstanding),
      subscribers: data.users.filter(function (u) { return u.role === "reader" && u.subscription; }).length,
      announcementCount: data.announcements.filter(function (a) { return a.status === "published"; }).length,
      reviewCount: data.reviews.length,
      waitlistCount: data.waitlist.filter(function (w) { return !w.notified; }).length
    };
  }

  function queryHot(params) {
    var p = params || {};
    var limit = Math.max(1, Math.min(50, Number(p.limit) || 8));
    var category = p.category || "全部";
    var rows = hotBooks(limit, category).map(function (b) {
      return {
        book_id: b.id,
        title: b.title,
        category: b.category,
        borrow_count: b.borrows,
        recent_count: b.recent_count,
        rating: b.rating_10,
        available: b.available + " / " + b.total
      };
    });
    var sql = [
      "SELECT b.book_id, b.title, c.name AS category,",
      "       b.borrow_count, COUNT(br.borrow_id) AS recent_count,",
      "       ROUND(b.rating * 2, 1) AS rating_10, b.available || ' / ' || b.total AS stock",
      "FROM books b",
      "JOIN categories c ON c.name = b.category",
      "LEFT JOIN borrows br ON br.book_id = b.book_id",
      "     AND br.borrowed_at >= CURRENT_DATE - INTERVAL '30 days'",
      "WHERE (:category = '全部' OR c.name = :category)",
      "GROUP BY b.book_id, b.title, c.name, b.borrow_count, b.rating, b.available, b.total",
      "ORDER BY recent_count DESC, b.borrow_count DESC",
      "LIMIT :limit;"
    ].join("\n");
    return {
      title: "多表联查 · 热门图书排行",
      sql: sql,
      params: [{ name: "category", value: category }, { name: "limit", value: limit }],
      columns: [
        { key: "book_id", label: "图书编号" },
        { key: "title", label: "书名" },
        { key: "category", label: "分类" },
        { key: "borrow_count", label: "历史借阅" },
        { key: "recent_count", label: "近30天" },
        { key: "rating", label: "评分 (10分制)" },
        { key: "available", label: "可借/馆藏" }
      ],
      rows: rows,
      plan: "Hash Join (books ⋈ borrows) → Hash Join (⋈ categories) → GroupAggregate → Sort → Limit",
      elapsed: 3 + Math.round(rows.length * 0.4)
    };
  }

  function queryDetail(params) {
    var p = params || {};
    var status = p.status || "all";
    var q = p.query || "";
    var rows = listBorrows({ status: status, query: q }).slice(0, 40).map(function (r) {
      return {
        borrow_id: r.borrow_id,
        user_name: r.user_name,
        username: r.username,
        book_title: r.book_title,
        category: r.category,
        borrowed_at: r.borrowed_at.slice(0, 10),
        due_at: r.due_at.slice(0, 10),
        status: r.status === "returned" ? "已归还" : (r.status === "overdue" ? "已逾期" : "借阅中")
      };
    });
    var sql = [
      "SELECT br.borrow_id, u.name AS user_name, u.username,",
      "       b.title AS book_title, b.category,",
      "       br.borrowed_at, br.due_at, br.status",
      "FROM borrows br",
      "JOIN users u  ON u.user_id = br.user_id",
      "JOIN books b  ON b.book_id = br.book_id",
      "WHERE (:status = 'all' OR br.status = :status)",
      "  AND (:query = '' OR u.name LIKE :query OR b.title LIKE :query)",
      "ORDER BY br.borrowed_at DESC",
      "LIMIT 40;"
    ].join("\n");
    return {
      title: "多表联查 · 借阅明细（users ⋈ borrows ⋈ books）",
      sql: sql,
      params: [{ name: "status", value: status }, { name: "query", value: q || "(空)" }],
      columns: [
        { key: "borrow_id", label: "借阅号" },
        { key: "user_name", label: "读者" },
        { key: "username", label: "账号" },
        { key: "book_title", label: "图书" },
        { key: "category", label: "分类" },
        { key: "borrowed_at", label: "借出日期" },
        { key: "due_at", label: "应还日期" },
        { key: "status", label: "状态" }
      ],
      rows: rows,
      plan: "Nested Loop (users) → Hash Join (borrows) → Index Scan (books_pkey) → Sort",
      elapsed: 4 + Math.round(rows.length * 0.5)
    };
  }

  function querySummary(params) {
    var p = params || {};
    var role = p.role || "all";
    var data = db();
    var rows = data.users.filter(function (u) { return role === "all" || u.role === role; }).map(function (u) {
      var all = data.borrows.filter(function (b) { return b.user_id === u.id; });
      var active = all.filter(function (b) { return normalizeBorrowStatus(b) !== "returned"; });
      var over = active.filter(function (b) { return normalizeBorrowStatus(b) === "overdue"; });
      return {
        user_id: u.id,
        user_name: u.name,
        username: u.username,
        role: u.role,
        total_borrows: all.length,
        active_borrows: active.length,
        overdue: over.length
      };
    }).sort(function (a, b) { return b.total_borrows - a.total_borrows; });
    var sql = [
      "SELECT u.user_id, u.name AS user_name, u.username, u.role,",
      "       COUNT(br.borrow_id) AS total_borrows,",
      "       COUNT(br.borrow_id) FILTER (WHERE br.status <> 'returned') AS active_borrows,",
      "       COUNT(br.borrow_id) FILTER (WHERE br.due_at < NOW() AND br.status <> 'returned') AS overdue",
      "FROM users u",
      "LEFT JOIN borrows br ON br.user_id = u.user_id",
      "WHERE (:role = 'all' OR u.role = :role)",
      "GROUP BY u.user_id, u.name, u.username, u.role",
      "ORDER BY total_borrows DESC;"
    ].join("\n");
    return {
      title: "多表联查 · 读者借阅汇总（users ⟕ borrows）",
      sql: sql,
      params: [{ name: "role", value: role }],
      columns: [
        { key: "user_id", label: "读者编号" },
        { key: "user_name", label: "姓名" },
        { key: "username", label: "账号" },
        { key: "role", label: "角色" },
        { key: "total_borrows", label: "累计借阅" },
        { key: "active_borrows", label: "在借" },
        { key: "overdue", label: "逾期" }
      ],
      rows: rows,
      plan: "Hash Left Join (users ⟕ borrows) → HashAggregate → Sort",
      elapsed: 2 + Math.round(rows.length * 0.2)
    };
  }

  function queryStock(params) {
    var p = params || {};
    var threshold = Math.max(0, Number(p.threshold) || 2);
    var rows = db().books.filter(function (b) { return b.available <= threshold; }).map(function (b) {
      return {
        book_id: b.id,
        title: b.title,
        category: b.category,
        total: b.total,
        available: b.available,
        rate: Math.round((b.available / Math.max(1, b.total)) * 100) + "%"
      };
    }).sort(function (a, b) { return a.available - b.available; });
    var sql = [
      "SELECT b.book_id, b.title, c.name AS category,",
      "       b.total, b.available,",
      "       ROUND(b.available * 100.0 / b.total, 0) || '%' AS available_rate",
      "FROM books b",
      "JOIN categories c ON c.name = b.category",
      "WHERE b.available <= :threshold",
      "ORDER BY b.available ASC, b.total DESC;"
    ].join("\n");
    return {
      title: "多表联查 · 库存预警（books ⋈ categories）",
      sql: sql,
      params: [{ name: "threshold", value: threshold }],
      columns: [
        { key: "book_id", label: "图书编号" },
        { key: "title", label: "书名" },
        { key: "category", label: "分类" },
        { key: "total", label: "馆藏" },
        { key: "available", label: "可借" },
        { key: "rate", label: "可借率" }
      ],
      rows: rows,
      plan: "Seq Scan (books) → Hash Join (categories) → Filter → Sort",
      elapsed: 2 + Math.round(rows.length * 0.3)
    };
  }

  function runQuery(scenario, params) {
    var denied = guard("db:query", "当前角色不能访问数据库实验台");
    if (denied) return denied;
    var result;
    if (scenario === "detail") result = queryDetail(params);
    else if (scenario === "summary") result = querySummary(params);
    else if (scenario === "stock") result = queryStock(params);
    else result = queryHot(params);
    return result;
  }

  function procDefs() {
    return [
      {
        name: "sp_borrow_book",
        params: "p_user_id UUID, p_book_id TEXT",
        desc: "校验读者状态、借阅上限、重复借阅与库存后写入借阅记录；库存由触发器维护",
        sql: [
          "CREATE OR REPLACE PROCEDURE sp_borrow_book(p_user_id UUID, p_book_id TEXT)",
          "LANGUAGE plpgsql AS $$",
          "DECLARE v_active INT; v_stock INT;",
          "BEGIN",
          "  SELECT COUNT(*) INTO v_active FROM borrows",
          "   WHERE user_id = p_user_id AND status <> 'returned';",
          "  IF v_active >= 5 THEN",
          "    RAISE EXCEPTION '每位读者最多同时借阅 5 本';",
          "  END IF;",
          "  SELECT available INTO v_stock FROM books",
          "   WHERE book_id = p_book_id FOR UPDATE;",
          "  IF v_stock <= 0 THEN",
          "    RAISE EXCEPTION '库存不足';",
          "  END IF;",
          "  INSERT INTO borrows(borrow_id, user_id, book_id, borrowed_at, due_at, status)",
          "  VALUES (gen_random_uuid(), p_user_id, p_book_id, NOW(), NOW() + INTERVAL '30 days', 'borrowing');",
          "END; $$;"
        ].join("\n")
      },
      {
        name: "sp_return_book",
        params: "p_borrow_id UUID",
        desc: "将借阅记录置为已归还，触发器恢复库存并写入审计日志",
        sql: [
          "CREATE OR REPLACE PROCEDURE sp_return_book(p_borrow_id UUID)",
          "LANGUAGE plpgsql AS $$",
          "BEGIN",
          "  UPDATE borrows SET status = 'returned', returned_at = NOW()",
          "   WHERE borrow_id = p_borrow_id AND status <> 'returned';",
          "  IF NOT FOUND THEN",
          "    RAISE EXCEPTION '借阅记录不存在或已归还';",
          "  END IF;",
          "END; $$;"
        ].join("\n")
      },
      {
        name: "sp_hot_books",
        params: "p_limit INT DEFAULT 10",
        desc: "按近 30 天借阅次数与历史热度返回热门图书",
        sql: [
          "CREATE OR REPLACE FUNCTION sp_hot_books(p_limit INT DEFAULT 10)",
          "RETURNS TABLE(book_id TEXT, title TEXT, category TEXT, recent BIGINT, rating NUMERIC)",
          "LANGUAGE sql AS $$",
          "  SELECT b.book_id, b.title, c.name, COUNT(br.borrow_id) AS recent, b.rating",
          "  FROM books b JOIN categories c ON c.name = b.category",
          "  LEFT JOIN borrows br ON br.book_id = b.book_id",
          "       AND br.borrowed_at >= CURRENT_DATE - INTERVAL '30 days'",
          "  GROUP BY b.book_id, b.title, c.name, b.rating, b.borrow_count",
          "  ORDER BY recent DESC, b.borrow_count DESC LIMIT p_limit;",
          "$$;"
        ].join("\n")
      },
      {
        name: "sp_overdue_check",
        params: "无参数",
        desc: "扫描到期未还记录，更新为 overdue 并写入审计日志",
        sql: [
          "CREATE OR REPLACE PROCEDURE sp_overdue_check()",
          "LANGUAGE plpgsql AS $$",
          "BEGIN",
          "  UPDATE borrows SET status = 'overdue'",
          "   WHERE status = 'borrowing' AND due_at < NOW();",
          "  INSERT INTO audit_logs(action, detail, level)",
          "  VALUES ('CALL sp_overdue_check', '逾期扫描完成', 'warn');",
          "END; $$;"
        ].join("\n")
      },
      {
        name: "sp_user_summary",
        params: "p_user_id UUID",
        desc: "统计指定读者的累计、在借与逾期数量",
        sql: [
          "CREATE OR REPLACE FUNCTION sp_user_summary(p_user_id UUID)",
          "RETURNS TABLE(total BIGINT, active BIGINT, overdue BIGINT)",
          "LANGUAGE sql AS $$",
          "  SELECT COUNT(*),",
          "         COUNT(*) FILTER (WHERE status <> 'returned'),",
          "         COUNT(*) FILTER (WHERE due_at < NOW() AND status <> 'returned')",
          "  FROM borrows WHERE user_id = p_user_id;",
          "$$;"
        ].join("\n")
      }
    ];
  }

  function triggerDefs() {
    return [
      {
        name: "trg_after_borrow",
        event: "AFTER INSERT ON borrows",
        desc: "借阅成功后扣减库存并写入审计日志",
        sql: [
          "CREATE OR REPLACE FUNCTION fn_after_borrow() RETURNS TRIGGER",
          "LANGUAGE plpgsql AS $$",
          "BEGIN",
          "  UPDATE books SET available = available - 1",
          "   WHERE book_id = NEW.book_id AND available > 0;",
          "  IF NOT FOUND THEN",
          "    RAISE EXCEPTION '库存不足，触发器回滚借阅事务';",
          "  END IF;",
          "  INSERT INTO audit_logs(action, detail, level)",
          "  VALUES ('TRG_AFTER_BORROW_INSERT', '库存扣减: ' || NEW.book_id, 'trigger');",
          "  RETURN NEW;",
          "END; $$;",
          "CREATE TRIGGER trg_after_borrow AFTER INSERT ON borrows",
          "FOR EACH ROW EXECUTE PROCEDURE fn_after_borrow();"
        ].join("\n")
      },
      {
        name: "trg_after_return",
        event: "AFTER UPDATE ON borrows",
        desc: "归还后恢复库存，保证 available 不超过 total",
        sql: [
          "CREATE OR REPLACE FUNCTION fn_after_return() RETURNS TRIGGER",
          "LANGUAGE plpgsql AS $$",
          "BEGIN",
          "  IF NEW.status = 'returned' AND OLD.status <> 'returned' THEN",
          "    UPDATE books SET available = LEAST(total, available + 1)",
          "     WHERE book_id = NEW.book_id;",
          "    INSERT INTO audit_logs(action, detail, level)",
          "    VALUES ('TRG_AFTER_RETURN_UPDATE', '库存恢复: ' || NEW.book_id, 'trigger');",
          "  END IF;",
          "  RETURN NEW;",
          "END; $$;",
          "CREATE TRIGGER trg_after_return AFTER UPDATE ON borrows",
          "FOR EACH ROW EXECUTE PROCEDURE fn_after_return();"
        ].join("\n")
      },
      {
        name: "trg_validate_borrow",
        event: "BEFORE INSERT OR UPDATE ON borrows",
        desc: "校验借期、重复借阅与借阅上限，异常时回滚事务",
        sql: [
          "CREATE OR REPLACE FUNCTION fn_validate_borrow() RETURNS TRIGGER",
          "LANGUAGE plpgsql AS $$",
          "DECLARE v_active INT;",
          "BEGIN",
          "  IF NEW.due_at <= NEW.borrowed_at THEN",
          "    RAISE EXCEPTION '到期日必须晚于借出日';",
          "  END IF;",
          "  SELECT COUNT(*) INTO v_active FROM borrows",
          "   WHERE user_id = NEW.user_id AND status <> 'returned';",
          "  IF v_active >= 5 THEN",
          "    RAISE EXCEPTION '借阅上限 5 本';",
          "  END IF;",
          "  RETURN NEW;",
          "END; $$;",
          "CREATE TRIGGER trg_validate_borrow BEFORE INSERT ON borrows",
          "FOR EACH ROW EXECUTE PROCEDURE fn_validate_borrow();"
        ].join("\n")
      }
    ];
  }

  function repeat(str, n) {
    var out = "";
    for (var i = 0; i < n; i++) out += str;
    return out;
  }

  function callProcedure(name, args) {
    var denied = guardAny(["db:proc", "borrow:manage"], "当前角色不能调用存储过程");
    if (denied) return { ok: false, message: denied.message, sql: "", columns: [], rows: [] };
    var a = args || {};
    var result;
    if (name === "sp_borrow_book") {
      result = borrowBook(a.userId, a.bookId);
      return {
        ok: result.ok,
        message: result.message + (result.ok ? "（借阅号 " + result.borrow.id + "）" : ""),
        sql: "CALL sp_borrow_book('" + (a.userId || "?") + "', '" + (a.bookId || "?") + "');",
        columns: result.ok ? [{ key: "field", label: "字段" }, { key: "value", label: "值" }] : [],
        rows: result.ok ? [
          { field: "borrow_id", value: result.borrow.id },
          { field: "due_at", value: result.borrow.due_at.slice(0, 10) },
          { field: "book.available", value: result.book.available },
          { field: "trigger", value: "trg_after_borrow 已触发" }
        ] : []
      };
    }
    if (name === "sp_return_book") {
      result = returnBook(a.borrowId);
      return {
        ok: result.ok,
        message: result.message,
        sql: "CALL sp_return_book('" + (a.borrowId || "?") + "');",
        columns: result.ok ? [{ key: "field", label: "字段" }, { key: "value", label: "值" }] : [],
        rows: result.ok ? [
          { field: "borrow_id", value: result.borrow.id },
          { field: "status", value: "returned" },
          { field: "book.available", value: result.book ? result.book.available : "-" },
          { field: "trigger", value: "trg_after_return 已触发" }
        ] : []
      };
    }
    if (name === "sp_overdue_check") {
      result = overdueSweep();
      return {
        ok: true,
        message: result.message,
        sql: "CALL sp_overdue_check();",
        columns: [{ key: "borrow_id", label: "借阅号" }, { key: "user_id", label: "读者" }, { key: "book_id", label: "图书" }, { key: "due_at", label: "应还日期" }],
        rows: result.rows.map(function (r) {
          return { borrow_id: r.id, user_id: r.user_id, book_id: r.book_id, due_at: r.due_at.slice(0, 10) };
        })
      };
    }
    if (name === "sp_hot_books") {
      var q = queryHot({ limit: a.limit || 5, category: "全部" });
      return { ok: true, message: "返回 " + q.rows.length + " 行热门图书", sql: "SELECT * FROM sp_hot_books(" + (a.limit || 5) + ");", columns: q.columns, rows: q.rows };
    }
    if (name === "sp_user_summary") {
      var user = getUserById(a.userId);
      var all = db().borrows.filter(function (b) { return b.user_id === a.userId; });
      var active = all.filter(function (b) { return b.status !== "returned"; });
      var over = active.filter(function (b) { return normalizeBorrowStatus(b) === "overdue"; });
      return {
        ok: true,
        message: "读者 " + (user ? user.name : a.userId) + " 的借阅统计",
        sql: "SELECT * FROM sp_user_summary('" + (a.userId || "?") + "');",
        columns: [{ key: "metric", label: "指标" }, { key: "value", label: "数值" }],
        rows: [
          { metric: "累计借阅", value: all.length },
          { metric: "当前在借", value: active.length },
          { metric: "其中逾期", value: over.length }
        ]
      };
    }
    return { ok: false, message: "未知存储过程", sql: "", columns: [], rows: [] };
  }

  function nextUserId() {
    var data = db();
    data.seq.user = (data.seq.user || 0) + 1;
    return "U" + String(data.seq.user).padStart(3, "0");
  }

  function nextBookId() {
    var data = db();
    data.seq.book = (data.seq.book || 0) + 1;
    return "b-new" + data.seq.book;
  }

  function slugColors(title) {
    var palettes = [
      ["#243b53", "#486581"], ["#134e4a", "#2c7a7b"], ["#5c1f18", "#a8412f"],
      ["#4a2c1a", "#8a5a32"], ["#3b2a52", "#6b4f8a"], ["#5a2a1e", "#a05a3c"]
    ];
    var hash = 0;
    for (var i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
    return palettes[hash % palettes.length];
  }

  function addBook(payload) {
    var denied = guard("book:write", "当前角色不能维护图书");
    if (denied) return denied;
    var data = db();
    var title = String(payload.title || "").trim();
    var author = String(payload.author || "").trim();
    var category = String(payload.category || "").trim();
    var total = Math.max(1, Number(payload.total) || 1);
    var shelfStatus = ["on_shelf", "warehouse", "off_shelf"].indexOf(payload.shelf_status) !== -1 ? payload.shelf_status : "warehouse";
    if (shelfStatus !== "warehouse" && !can("book:publish")) return forbidden("当前角色不能上架或下架图书");
    if (!title || !author || !category) return { ok: false, message: "书名、作者、分类不能为空" };
    var id = payload.id || nextBookId();
    if (getBook(id)) return { ok: false, message: "图书编号已存在" };
    var book = {
      id: id,
      title: title,
      author: author,
      category: category,
      isbn: String(payload.isbn || "").trim(),
      publisher: String(payload.publisher || "").trim(),
      year: Number(payload.year) || new Date().getFullYear(),
      total: total,
      available: shelfStatus === "on_shelf" ? total : 0,
      shelf_status: shelfStatus,
      rating: 0,
      rating_10: 0,
      rating_count: 0,
      borrows: 0,
      colors: slugColors(title),
      desc: String(payload.desc || "").trim(),
      cover_blob: null,
      cover_mime: "image/png",
      pdf_blob: payload.pdf_blob || null,
      pdf_name: payload.pdf_name || "",
      pdf_pages: Number(payload.pdf_pages) || 0,
      pdf_mime: "application/pdf",
      pdf_uploaded_at: payload.pdf_blob ? nowIso() : null,
      pdf_uploaded_by: payload.pdf_blob ? sessionUser().username : "",
      pdf_demo: false,
      created_at: nowIso()
    };
    data.books.push(book);
    if (payload.cover_blob) {
      book.cover_blob = payload.cover_blob;
      book.cover_mime = payload.cover_mime || "image/png";
    }
    if (!data.categories.some(function (c) { return c.name === category; })) {
      data.categories.push({ id: "C" + String(data.categories.length + 1).padStart(2, "0"), name: category, sort: data.categories.length + 1 });
    }
    var pushed = notifyNewBook(book, sessionUser().username);
    pushAudit(data, "INSERT books", "新增图书《" + title + "》，馆藏 " + total + " 册，状态 " + shelfStatusLabel(shelfStatus) + (pushed ? "，推送 " + pushed + " 名订阅读者" : ""), "success", sessionUser().username);
    ensureCovers();
    persist();
    emit("book");
    return {
      ok: true,
      message: shelfStatus === "on_shelf" ? "已新增并上架《" + title + "》" : (shelfStatus === "off_shelf" ? "已新增《" + title + "》，并设置为已下架" : "已新增《" + title + "》，已存入仓库，待上架后开放借阅"),
      book: clone(book)
    };
  }

  function updateBook(id, payload) {
    var denied = guard("book:write", "当前角色不能维护图书");
    if (denied) return denied;
    var data = db();
    var book = getBook(id);
    if (!book) return { ok: false, message: "图书不存在" };
    var active = data.borrows.filter(function (b) { return b.book_id === id && b.status !== "returned"; }).length;
    var total = payload.total === undefined ? book.total : Math.max(1, Number(payload.total) || 1);
    if (total < active) return { ok: false, message: "馆藏册数不能小于当前在借数量 " + active };
    var oldShelf = book.shelf_status;
    var nextShelf = payload.shelf_status && ["on_shelf", "warehouse", "off_shelf"].indexOf(payload.shelf_status) !== -1 ? payload.shelf_status : book.shelf_status;
    if (nextShelf !== book.shelf_status && !can("book:publish")) return forbidden("当前角色不能上架或下架图书");
    ["title", "author", "category", "isbn", "publisher", "desc"].forEach(function (key) {
      if (payload[key] !== undefined) book[key] = String(payload[key]).trim();
    });
    if (payload.year !== undefined) book.year = Number(payload.year) || book.year;
    book.total = total;
    book.shelf_status = nextShelf;
    book.available = nextShelf === "on_shelf" ? Math.max(0, total - active) : 0;
    if (payload.cover_blob) {
      book.cover_blob = payload.cover_blob;
      book.cover_mime = payload.cover_mime || "image/png";
      invalidateCover(id);
    }
    if (payload.pdf_blob) {
      if (!can("pdf:manage")) return forbidden("当前角色不能导入 PDF 试读");
      book.pdf_blob = payload.pdf_blob;
      book.pdf_name = payload.pdf_name || "试读本.pdf";
      book.pdf_pages = Number(payload.pdf_pages) || 0;
      book.pdf_mime = "application/pdf";
      book.pdf_uploaded_at = nowIso();
      book.pdf_uploaded_by = sessionUser().username;
      book.pdf_demo = false;
    } else if (payload.remove_pdf) {
      if (!can("pdf:manage")) return forbidden("当前角色不能删除 PDF 试读");
      book.pdf_blob = null;
      book.pdf_name = "";
      book.pdf_pages = 0;
      book.pdf_demo = false;
    }
    var pushed = 0;
    if (book.shelf_status === "on_shelf" && oldShelf !== "on_shelf") pushed = notifyNewBook(book, sessionUser().username);
    pushAudit(data, "UPDATE books", "更新图书《" + book.title + "》，馆藏 " + total + " 册，状态 " + shelfStatusLabel(book.shelf_status) + (pushed ? "，推送 " + pushed + " 名订阅读者" : ""), "info", sessionUser().username);
    persist();
    emit("book");
    return { ok: true, message: "已保存《" + book.title + "》（" + shelfStatusLabel(book.shelf_status) + "）", book: clone(book) };
  }

  function setBookShelfStatus(id, status) {
    var denied = guard("book:publish", "当前角色不能上架或下架图书");
    if (denied) return denied;
    var data = db();
    var book = getBook(id);
    if (!book) return { ok: false, message: "图书不存在" };
    if (["on_shelf", "warehouse", "off_shelf"].indexOf(status) === -1) return { ok: false, message: "上架状态不合法" };
    var active = data.borrows.filter(function (b) { return b.book_id === id && b.status !== "returned"; }).length;
    book.shelf_status = status;
    book.available = status === "on_shelf" ? Math.max(0, book.total - active) : 0;
    var pushed = status === "on_shelf" ? notifyNewBook(book, sessionUser().username) : 0;
    var label = status === "on_shelf" ? "已上架" : (status === "warehouse" ? "已移入仓库" : "已下架");
    pushAudit(data, "UPDATE books.shelf_status", "《" + book.title + "》" + label + (pushed ? "，推送 " + pushed + " 名订阅读者" : ""), "success", sessionUser().username);
    persist();
    emit("book");
    return { ok: true, message: "《" + book.title + "》" + label, book: clone(book) };
  }

  function setBookPdf(id, dataUrl, name, pages) {
    var denied = guard("pdf:manage", "当前角色不能导入 PDF 试读");
    if (denied) return denied;
    var book = getBook(id);
    if (!book) return { ok: false, message: "图书不存在" };
    var match = /^data:application\/pdf;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
    if (!match) return { ok: false, message: "仅支持 PDF 文件" };
    var base64 = match[1].replace(/\s/g, "");
    var bytes = Math.floor(base64.length * 3 / 4);
    if (bytes > 12 * 1024 * 1024) return { ok: false, message: "PDF 不能超过 12 MB" };
    var footprint = 0;
    try { footprint = JSON.stringify(db()).length; } catch (err) { footprint = 0; }
    if (footprint + base64.length > 4000000) {
      return { ok: false, message: "浏览器本地演示存储约 5 MB，当前 PDF 过大，请选择更小的文件（建议 2 MB 以内）" };
    }
    book.pdf_blob = base64;
    book.pdf_name = String(name || "试读本.pdf");
    book.pdf_pages = Math.max(0, Number(pages) || 0);
    book.pdf_mime = "application/pdf";
    book.pdf_uploaded_at = nowIso();
    book.pdf_uploaded_by = sessionUser().username;
    book.pdf_demo = false;
    pushAudit(db(), "UPDATE books.pdf", "为《" + book.title + "》导入 PDF《" + book.pdf_name + "》，共 " + book.pdf_pages + " 页，前端仅预览前 10 页", "info", sessionUser().username);
    persist();
    emit("pdf");
    return { ok: true, message: "PDF 已写入数据库，试读仅开放前 10 页", pages: book.pdf_pages, bytes: bytes };
  }

  function removeBookPdf(id) {
    var denied = guard("pdf:manage", "当前角色不能删除 PDF 试读");
    if (denied) return denied;
    var book = getBook(id);
    if (!book) return { ok: false, message: "图书不存在" };
    book.pdf_blob = null;
    book.pdf_name = "";
    book.pdf_pages = 0;
    book.pdf_demo = false;
    pushAudit(db(), "DELETE books.pdf", "删除《" + book.title + "》的 PDF 试读", "warn", sessionUser().username);
    persist();
    emit("pdf");
    return { ok: true, message: "PDF 试读已删除" };
  }

  function deleteBook(id) {
    var denied = guard("book:write", "当前角色不能删除图书");
    if (denied) return denied;
    var data = db();
    var book = getBook(id);
    if (!book) return { ok: false, message: "图书不存在" };
    var active = data.borrows.filter(function (b) { return b.book_id === id && b.status !== "returned"; }).length;
    if (active > 0) return { ok: false, message: "该图书仍有 " + active + " 本在借，无法删除" };
    data.books = data.books.filter(function (b) { return b.id !== id; });
    data.waitlist = data.waitlist.filter(function (w) { return w.book_id !== id; });
    invalidateCover(id);
    pushAudit(data, "DELETE books", "删除图书《" + book.title + "》", "warn", sessionUser().username);
    persist();
    emit("book");
    return { ok: true, message: "已删除《" + book.title + "》" };
  }

  function activeAdminCount(excludeId) {
    return db().users.filter(function (u) {
      return u.role === "admin" && u.status === "active" && u.id !== excludeId;
    }).length;
  }

  function canEditUser(target, actor) {
    if (!target) return false;
    var current = actor || sessionUser();
    if (!current || !current.role || current.role === "guest") return false;
    if (!can("user:edit", current) && !can("user:manage", current)) return false;
    if (current.role === "admin") return true;
    return target.id === current.id || target.role === "reader";
  }

  function canEditUserById(id) {
    return canEditUser(getUserById(id));
  }

  function addUser(payload) {
    var denied = guard("user:manage", "只有超级管理员可以新增用户");
    if (denied) return denied;
    var data = db();
    var username = String(payload.username || "").trim();
    var name = String(payload.name || "").trim();
    var role = String(payload.role || "reader");
    var password = String(payload.password || "");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return { ok: false, message: "账号需为 3–20 位字母、数字或下划线" };
    if (!name) return { ok: false, message: "姓名不能为空" };
    if (!getRole(role) || role === "guest") return { ok: false, message: "角色不合法" };
    if (password.length < 6) return { ok: false, message: "密码至少 6 位" };
    if (getUserByName(username)) return { ok: false, message: "账号已存在" };
    var user = {
      id: nextUserId(),
      username: username,
      password_md5: md5(password),
      name: name,
      role: role,
      status: "active",
      email: String(payload.email || "").trim(),
      phone: String(payload.phone || "").trim(),
      deposit_balance: role === "reader" ? round2(data.settings.deposit_required) : 0,
      scope: payload.scope ? normalizeScope(payload.scope) : defaultScope(),
      subscription: role === "reader",
      created_at: nowIso(),
      last_login: null
    };
    data.users.push(user);
    pushAudit(data, "INSERT users", "新增应用用户 " + username + "（" + role + "），密码保存为 MD5 摘要，借阅范围 " + user.scope.categories.join("/"), "success", sessionUser().username);
    persist();
    emit("user");
    return { ok: true, message: "已新增用户 " + name, user: clone(user), hash: user.password_md5 };
  }

  function normalizeScope(scope) {
    var input = scope || {};
    var categories = Array.isArray(input.categories) ? input.categories.map(function (c) { return String(c).trim(); }).filter(Boolean) : ["*"];
    if (!categories.length) categories = ["*"];
    return {
      borrow_limit: Math.max(1, Math.min(20, Number(input.borrow_limit) || DEFAULT_SETTINGS.default_scope.borrow_limit)),
      max_days: Math.max(1, Math.min(120, Number(input.max_days) || DEFAULT_SETTINGS.default_scope.max_days)),
      categories: categories
    };
  }

  function updateUser(id, payload) {
    var denied = guard("user:manage", "只有超级管理员可以编辑用户");
    if (denied) return denied;
    var data = db();
    var user = getUserById(id);
    if (!user) return { ok: false, message: "用户不存在" };
    var oldRole = user.role;
    var nextRole = payload.role || user.role;
    if (!getRole(nextRole) || nextRole === "guest") return { ok: false, message: "角色不合法" };
    if (oldRole === "admin" && nextRole !== "admin" && activeAdminCount(id) === 0) {
      return { ok: false, message: "至少保留一名启用状态的超级管理员" };
    }
    if (payload.name !== undefined) user.name = String(payload.name).trim() || user.name;
    if (payload.email !== undefined) user.email = String(payload.email).trim();
    if (payload.phone !== undefined) user.phone = String(payload.phone).trim();
    user.role = nextRole;
    if (payload.scope) user.scope = normalizeScope(payload.scope);
    if (payload.subscription !== undefined) user.subscription = Boolean(payload.subscription);
    if (nextRole === "reader" && !(Number(user.deposit_balance) > 0) && !payload.keep_balance) {
      user.deposit_balance = round2(data.settings.deposit_required);
    }
    pushAudit(data, "UPDATE users", "编辑用户 " + user.username + "，角色 " + oldRole + " → " + nextRole + "，借阅上限 " + scopeOf(user).borrow_limit + " 本，分类 " + scopeOf(user).categories.join("/"), "warn", sessionUser().username);
    persist();
    emit("user");
    return { ok: true, message: "用户信息已更新", user: clone(user) };
  }

  function deleteUser(id) {
    var denied = guard("user:manage", "只有超级管理员可以删除用户");
    if (denied) return denied;
    var data = db();
    var user = getUserById(id);
    if (!user) return { ok: false, message: "用户不存在" };
    if (user.username === sessionUser().username) return { ok: false, message: "不能删除当前登录账号" };
    if (user.role === "admin" && activeAdminCount(id) === 0) return { ok: false, message: "至少保留一名启用状态的超级管理员" };
    var active = data.borrows.filter(function (b) { return b.user_id === id && b.status !== "returned"; }).length;
    if (active > 0) return { ok: false, message: "该用户还有 " + active + " 本图书未归还，不能删除" };
    data.users = data.users.filter(function (u) { return u.id !== id; });
    data.notifications = data.notifications.filter(function (n) { return n.user_id !== id; });
    data.waitlist = data.waitlist.filter(function (w) { return w.user_id !== id; });
    pushAudit(data, "DELETE users", "删除用户 " + user.username + "（" + user.role + "）", "warn", sessionUser().username);
    persist();
    emit("user");
    return { ok: true, message: "用户 " + user.name + " 已删除" };
  }

  function setUserRole(id, role) {
    return updateUser(id, { role: role });
  }

  function updateUserProfile(id, payload) {
    var input = payload || {};
    var actor = sessionUser();
    if (!actor || actor.role === "guest") return forbidden("请先登录");
    var data = db();
    var user = getUserById(id);
    if (!user) return { ok: false, message: "用户不存在" };
    if (!canEditUser(user, actor)) return forbidden("只能修改本人和读者的资料");
    if (input.username !== undefined && String(input.username).trim() !== user.username) {
      return { ok: false, message: "账号不可修改" };
    }
    var name = input.name !== undefined ? String(input.name).trim() : user.name;
    if (!name) return { ok: false, message: "姓名不能为空" };
    var email = input.email !== undefined ? String(input.email).trim() : user.email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "邮箱格式不正确" };
    var password = input.password !== undefined && input.password !== null ? String(input.password) : "";
    if (password && password.length < 6) return { ok: false, message: "密码至少 6 位" };
    var fields = [];
    if (name !== user.name) {
      user.name = name;
      fields.push("姓名");
    }
    if (email !== user.email) {
      user.email = email;
      fields.push("邮箱");
    }
    if (password) {
      user.password_md5 = md5(password);
      fields.push("密码");
    }
    if (!fields.length) return { ok: true, message: "没有需要保存的修改", user: clone(user), fields: fields };
    pushAudit(data, "UPDATE users.profile", "编辑用户 " + user.username + " 的" + fields.join("、") + "（账号不可修改）", "warn", actor.username);
    persist();
    emit("user");
    return { ok: true, message: "已更新" + fields.join("、"), user: clone(user), fields: fields };
  }

  function toggleUser(id) {
    var denied = guard("user:manage", "只有超级管理员可以启停用户");
    if (denied) return denied;
    var data = db();
    var user = getUserById(id);
    if (!user) return { ok: false, message: "用户不存在" };
    if (user.username === sessionUser().username) return { ok: false, message: "不能停用当前登录账号" };
    if (user.status === "active" && user.role === "admin" && activeAdminCount(id) === 0) {
      return { ok: false, message: "至少保留一名启用状态的超级管理员" };
    }
    user.status = user.status === "active" ? "disabled" : "active";
    pushAudit(data, "UPDATE users.status", "用户 " + user.username + " 状态 → " + user.status, "warn", sessionUser().username);
    persist();
    emit("user");
    return { ok: true, message: user.status === "active" ? "账号已启用" : "账号已停用" };
  }

  function resetPassword(id, password) {
    var denied = guard("user:manage", "只有超级管理员可以重置他人密码");
    if (denied) return denied;
    var data = db();
    var user = getUserById(id);
    if (!user) return { ok: false, message: "用户不存在" };
    if (String(password).length < 6) return { ok: false, message: "密码至少 6 位" };
    user.password_md5 = md5(password);
    pushAudit(data, "UPDATE users.password", "重置用户 " + user.username + " 的密码为 MD5 摘要", "warn", sessionUser().username);
    persist();
    emit("user");
    return { ok: true, message: "密码已重置", hash: user.password_md5 };
  }

  function changePassword(currentPassword, newPassword) {
    var actor = sessionUser();
    if (!actor || actor.role === "guest") return forbidden("请先登录");
    var data = db();
    var user = getUserById(actor.id);
    if (!user) return forbidden();
    if (md5(currentPassword) !== user.password_md5) return { ok: false, message: "当前密码不正确" };
    if (String(newPassword || "").length < 6) return { ok: false, message: "新密码至少 6 位" };
    user.password_md5 = md5(newPassword);
    pushAudit(data, "UPDATE users.password", "用户 " + user.username + " 修改本人密码，保存 MD5 摘要", "info", user.username);
    persist();
    emit("user");
    return { ok: true, message: "密码已修改", hash: user.password_md5 };
  }

  function auditLogs(filter) {
    if (!can("audit:read")) return [];
    var opts = filter || {};
    var logs = db().auditLogs.slice();
    if (opts.level && opts.level !== "all") logs = logs.filter(function (l) { return l.level === opts.level; });
    if (opts.action) logs = logs.filter(function (l) { return String(l.action).toLowerCase().indexOf(String(opts.action).toLowerCase()) !== -1; });
    if (opts.actor) logs = logs.filter(function (l) { return String(l.actor).toLowerCase().indexOf(String(opts.actor).toLowerCase()) !== -1; });
    if (opts.detail) logs = logs.filter(function (l) { return String(l.detail).toLowerCase().indexOf(String(opts.detail).toLowerCase()) !== -1; });
    if (opts.query) {
      var q = String(opts.query).toLowerCase();
      logs = logs.filter(function (l) { return [l.action, l.detail, l.actor].join(" ").toLowerCase().indexOf(q) !== -1; });
    }
    return logs.slice(0, opts.limit || 120);
  }

  function csvCell(value) {
    var text = value === null || value === undefined ? "" : String(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function toCSV(columns, rows) {
    var lines = [columns.map(function (c) { return csvCell(c.label); }).join(",")];
    rows.forEach(function (row) {
      lines.push(columns.map(function (c) { return csvCell(row[c.key]); }).join(","));
    });
    return "\ufeff" + lines.join("\r\n");
  }

  function exportBooksCSV() {
    var denied = guard("data:export", "当前角色不能导出书目");
    if (denied) return "";
    var cols = [
      { key: "id", label: "图书编号" }, { key: "title", label: "书名" }, { key: "author", label: "作者" },
      { key: "category", label: "分类" }, { key: "isbn", label: "ISBN" }, { key: "publisher", label: "出版社" },
      { key: "year", label: "出版年" }, { key: "total", label: "馆藏" }, { key: "available", label: "可借" },
      { key: "shelf_status", label: "上架状态" }, { key: "rating_10", label: "评分(10分制)" },
      { key: "rating", label: "平均星级" }, { key: "rating_count", label: "评价数" },
      { key: "borrows", label: "历史借阅" }, { key: "pdf_pages", label: "PDF页数" }
    ];
    var rows = db().books.map(function (book) {
      return Object.assign({}, book, {
        rating_10: book.rating_count ? (Number(book.rating_10) || Number(book.rating) * 2).toFixed(1) : ""
      });
    });
    return toCSV(cols, rows);
  }

  function exportBorrowsCSV() {
    var denied = guardAny(["data:export", "borrow:read"], "当前角色不能导出借阅记录");
    if (denied) return "";
    var cols = [
      { key: "borrow_id", label: "借阅号" }, { key: "user_name", label: "读者" }, { key: "username", label: "账号" },
      { key: "book_title", label: "图书" }, { key: "category", label: "分类" }, { key: "borrowed_at", label: "借出日期" },
      { key: "due_at", label: "应还日期" }, { key: "returned_at", label: "归还日期" }, { key: "status", label: "状态" },
      { key: "fine", label: "罚款" }, { key: "fine_days", label: "逾期天数" }
    ];
    return toCSV(cols, listBorrows({ status: "all" }));
  }

  function exportUsersCSV() {
    var denied = guard("data:export", "当前角色不能导出用户");
    if (denied) return "";
    if (!can("user:read")) return "";
    var cols = [
      { key: "id", label: "用户编号" }, { key: "username", label: "账号" }, { key: "name", label: "姓名" },
      { key: "role", label: "角色" }, { key: "status", label: "状态" }, { key: "password_md5", label: "密码MD5" },
      { key: "deposit_balance", label: "保证金" }, { key: "email", label: "邮箱" }, { key: "phone", label: "电话" }
    ];
    return toCSV(cols, db().users);
  }

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;
    var input = String(text || "").replace(/^\ufeff/, "");
    while (i < input.length) {
      var ch = input.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (input.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        field += ch; i += 1; continue;
      }
      if (ch === '"') { inQuotes = true; i += 1; continue; }
      if (ch === ",") { row.push(field); field = ""; i += 1; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && input.charAt(i + 1) === "\n") i += 1;
        row.push(field);
        if (row.some(function (cell) { return cell !== ""; })) rows.push(row);
        row = []; field = ""; i += 1; continue;
      }
      field += ch; i += 1;
    }
    row.push(field);
    if (row.some(function (cell) { return cell !== ""; })) rows.push(row);
    if (!rows.length) return [];
    var headers = rows.shift().map(function (h) { return h.trim(); });
    return rows.map(function (cells) {
      var obj = {};
      headers.forEach(function (h, idx) { obj[h] = (cells[idx] || "").trim(); });
      return obj;
    });
  }

  var BOOK_HEADER_MAP = {
    "图书编号": "id", "书名": "title", "作者": "author", "分类": "category", "ISBN": "isbn",
    "出版社": "publisher", "出版年": "year", "馆藏": "total", "可借": "available", "评分": "rating",
    "平均星级": "rating", "评分(10分制)": "rating_10",
    "评价数": "rating_count", "历史借阅": "borrows", "简介": "desc", "上架状态": "shelf_status",
    "PDF页数": "pdf_pages"
  };

  function remapRows(rows, map) {
    return rows.map(function (row) {
      var out = {};
      Object.keys(row).forEach(function (key) {
        out[map[key] || key] = row[key];
      });
      return out;
    });
  }

  function importBooks(rows) {
    var denied = guard("data:import", "当前角色不能批量导入书目");
    if (denied) return denied;
    var data = db();
    var mapped = remapRows(rows, BOOK_HEADER_MAP);
    var added = 0;
    var updated = 0;
    var errors = [];
    mapped.forEach(function (row, index) {
      var title = String(row.title || "").trim();
      var author = String(row.author || "").trim();
      var category = String(row.category || "").trim();
      var total = Number(row.total);
      if (!title || !author || !category) {
        errors.push("第 " + (index + 2) + " 行：书名/作者/分类不能为空");
        return;
      }
      if (!total || total < 1) {
        errors.push("第 " + (index + 2) + " 行：馆藏必须为正整数");
        return;
      }
      var shelf = ["on_shelf", "warehouse", "off_shelf"].indexOf(row.shelf_status) !== -1 ? row.shelf_status : "warehouse";
      var existing = row.id ? getBook(row.id) : data.books.filter(function (b) { return b.title === title && b.author === author; })[0];
      if (existing) {
        var active = data.borrows.filter(function (b) { return b.book_id === existing.id && b.status !== "returned"; }).length;
        existing.title = title;
        existing.author = author;
        existing.category = category;
        existing.total = Math.max(total, active);
        if (row.shelf_status) existing.shelf_status = shelf;
        existing.available = existing.shelf_status === "on_shelf" ? Math.max(0, existing.total - active) : 0;
        if (row.isbn) existing.isbn = String(row.isbn);
        if (row.publisher) existing.publisher = String(row.publisher);
        if (row.year) existing.year = Number(row.year) || existing.year;
        if (row.desc) existing.desc = String(row.desc);
        updated += 1;
      } else {
        var id = row.id && !getBook(row.id) ? String(row.id) : nextBookId();
        data.books.push({
          id: id,
          title: title,
          author: author,
          category: category,
          isbn: String(row.isbn || ""),
          publisher: String(row.publisher || ""),
          year: Number(row.year) || new Date().getFullYear(),
          total: total,
          available: shelf === "on_shelf" ? total : 0,
          shelf_status: shelf,
          rating: 0,
          rating_10: 0,
          rating_count: 0,
          borrows: Number(row.borrows) || 0,
          colors: slugColors(title),
          desc: String(row.desc || ""),
          cover_blob: null,
          cover_mime: "image/png",
          pdf_blob: null,
          pdf_name: "",
          pdf_pages: Number(row.pdf_pages) || 0,
          pdf_mime: "application/pdf",
          pdf_demo: false,
          created_at: nowIso()
        });
        if (!data.categories.some(function (c) { return c.name === category; })) {
          data.categories.push({ id: "C" + String(data.categories.length + 1).padStart(2, "0"), name: category, sort: data.categories.length + 1 });
        }
        added += 1;
      }
    });
    pushAudit(data, "IMPORT books", "CSV 导入完成：新增 " + added + "（默认仓库待上架），更新 " + updated + "，失败 " + errors.length, errors.length ? "warn" : "success", sessionUser().username);
    ensureCovers();
    persist();
    emit("import");
    return { ok: errors.length === 0, message: "导入完成：新增 " + added + " 条（默认仓库待上架），更新 " + updated + " 条" + (errors.length ? "，" + errors.length + " 条失败" : ""), added: added, updated: updated, errors: errors };
  }

  function importUsers(rows) {
    var denied = guardAny(["data:import", "user:manage"], "当前角色不能批量导入用户");
    if (denied) return denied;
    var map = {
      "账号": "username", "姓名": "name", "角色": "role", "状态": "status", "密码": "password",
      "密码MD5": "password_md5", "邮箱": "email", "电话": "phone", "保证金": "deposit_balance"
    };
    var mapped = remapRows(rows, map);
    var added = 0;
    var updated = 0;
    var errors = [];
    mapped.forEach(function (row, index) {
      var username = String(row.username || "").trim();
      if (!username) { errors.push("第 " + (index + 2) + " 行：账号为空"); return; }
      var role = String(row.role || "reader");
      if (!getRole(role) || role === "guest") { errors.push("第 " + (index + 2) + " 行：角色不合法"); return; }
      var existing = getUserByName(username);
      var passwordHash = row.password_md5 || (row.password ? md5(row.password) : null);
      if (existing) {
        existing.name = String(row.name || existing.name);
        existing.role = role;
        if (row.status === "disabled" || row.status === "active") existing.status = row.status;
        if (passwordHash) existing.password_md5 = passwordHash;
        if (row.email) existing.email = String(row.email);
        if (row.phone) existing.phone = String(row.phone);
        updated += 1;
      } else {
        if (!passwordHash) { errors.push("第 " + (index + 2) + " 行：新用户需要密码或密码MD5"); return; }
        var data = db();
        data.users.push({
          id: nextUserId(),
          username: username,
          password_md5: passwordHash,
          name: String(row.name || username),
          role: role,
          status: row.status === "disabled" ? "disabled" : "active",
          email: String(row.email || ""),
          phone: String(row.phone || ""),
          deposit_balance: role === "reader" ? round2(row.deposit_balance || db().settings.deposit_required) : 0,
          scope: defaultScope(),
          subscription: role === "reader",
          created_at: nowIso(),
          last_login: null
        });
        added += 1;
      }
    });
    pushAudit(db(), "IMPORT users", "用户导入完成：新增 " + added + "，更新 " + updated + "，失败 " + errors.length, errors.length ? "warn" : "success", sessionUser().username);
    persist();
    emit("import");
    return { ok: errors.length === 0, message: "用户导入完成：新增 " + added + "，更新 " + updated + (errors.length ? "，失败 " + errors.length : ""), added: added, updated: updated, errors: errors };
  }

  function importRegisterUsers(rows) {
    var actor = sessionUser();
    var isAdmin = can("user:manage", actor);
    if (!isAdmin && !can("user:import", actor)) return forbidden("当前角色不能批量注册用户");
    var data = db();
    var map = {
      "账号": "username", "姓名": "name", "角色": "role", "密码": "password",
      "密码MD5": "password_md5", "邮箱": "email", "电话": "phone"
    };
    var roleAlias = { "读者": "reader", "图书管理员": "librarian", "馆员": "librarian", "超级管理员": "admin" };
    var mapped = remapRows(Array.isArray(rows) ? rows : [], map);
    if (!mapped.length) return { ok: false, message: "没有可导入的数据", added: 0, errors: [] };
    var added = 0;
    var errors = [];
    mapped.forEach(function (row, index) {
      var line = index + 2;
      var username = String(row.username || "").trim();
      if (!username) {
        errors.push("第 " + line + " 行：账号为空");
        return;
      }
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        errors.push("第 " + line + " 行：账号 " + username + " 需为 3–20 位字母、数字或下划线");
        return;
      }
      if (getUserByName(username)) {
        errors.push("第 " + line + " 行：账号 " + username + " 已存在，账号不可修改，已跳过");
        return;
      }
      var roleInput = String(row.role || "reader").trim();
      var role = roleAlias[roleInput] || roleInput;
      if (!getRole(role) || role === "guest") {
        errors.push("第 " + line + " 行：角色不合法");
        return;
      }
      if (!isAdmin && role !== "reader") {
        errors.push("第 " + line + " 行：图书管理员只能批量注册读者账号");
        return;
      }
      var name = String(row.name || "").trim();
      if (!name) {
        errors.push("第 " + line + " 行：姓名不能为空");
        return;
      }
      var passwordHash = row.password_md5 || (row.password ? md5(row.password) : null);
      if (!passwordHash) {
        errors.push("第 " + line + " 行：新用户需要密码或密码MD5");
        return;
      }
      var email = String(row.email || "").trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push("第 " + line + " 行：邮箱格式不正确");
        return;
      }
      data.users.push({
        id: nextUserId(),
        username: username,
        password_md5: passwordHash,
        name: name,
        role: role,
        status: "active",
        email: email,
        phone: String(row.phone || "").trim(),
        deposit_balance: role === "reader" ? round2(data.settings.deposit_required) : 0,
        scope: defaultScope(),
        subscription: role === "reader",
        created_at: nowIso(),
        last_login: null
      });
      added += 1;
    });
    if (!added) {
      return {
        ok: false,
        message: "批量注册未完成：0 个账号新增" + (errors.length ? "，" + errors.length + " 行未导入" : ""),
        added: 0,
        errors: errors
      };
    }
    pushAudit(data, "IMPORT users.register", "批量注册用户：" + (isAdmin ? "超级管理员" : "图书管理员") + " 新增 " + added + " 个账号，跳过 " + errors.length + " 行", errors.length ? "warn" : "success", actor.username);
    persist();
    emit("import");
    return {
      ok: errors.length === 0,
      message: "批量注册完成：新增 " + added + " 个账号" + (errors.length ? "，" + errors.length + " 行未导入" : ""),
      added: added,
      errors: errors
    };
  }

  function backupSubset() {
    return makeSnapshot(db());
  }

  function createBackup(note) {
    var data = db();
    var snapshot = backupSubset();
    var now = new Date();
    var stamp = now.getFullYear() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + "-" + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
    var record = {
      id: "BK-" + stamp,
      name: note || "手动快照",
      note: note || "",
      ts: now.toISOString(),
      type: "full",
      status: "success",
      size: JSON.stringify(snapshot).length,
      node: data.cluster.primary,
      snapshot: snapshot
    };
    data.backups.unshift(record);
    data.seq.backup = (data.seq.backup || 0) + 1;
    if (data.backups.length > 4) data.backups.length = 4;
    pushAudit(data, "BACKUP", "应用界面发起服务器端全量备份 " + record.id + "，大小 " + (record.size / 1024).toFixed(1) + " KB", "success", sessionUser().username);
    persist();
    emit("backup");
    return { ok: true, message: "备份完成：" + record.id, backup: { id: record.id, size: record.size, ts: record.ts, name: record.name } };
  }

  function restoreBackup(id) {
    var data = db();
    var record = data.backups.filter(function (b) { return b.id === id; })[0];
    if (!record) return { ok: false, message: "备份不存在" };
    var snap = record.snapshot;
    data.users = clone(snap.users);
    data.roles = clone(snap.roles);
    data.books = clone(snap.books);
    data.categories = clone(snap.categories);
    data.borrows = clone(snap.borrows);
    data.dbUsers = clone(snap.dbUsers);
    data.auditLogs = clone(snap.auditLogs);
    data.settings = Object.assign({}, clone(DEFAULT_SETTINGS), clone(snap.settings || {}));
    data.reviews = clone(snap.reviews || []);
    data.announcements = clone(snap.announcements || []);
    data.notifications = clone(snap.notifications || []);
    data.waitlist = clone(snap.waitlist || []);
    data.seq = clone(snap.seq);
    Object.keys(coverCache).forEach(function (key) { invalidateCover(key); });
    ensureCovers();
    pushAudit(data, "RESTORE", "从备份 " + id + " 恢复数据库，恢复后图书 " + data.books.length + " 种、借阅 " + data.borrows.length + " 条", "warn", sessionUser().username);
    persist();
    emit("restore");
    return { ok: true, message: "已从 " + id + " 恢复数据库" };
  }

  function deleteBackup(id) {
    var data = db();
    var record = data.backups.filter(function (b) { return b.id === id; })[0];
    if (!record) return { ok: false, message: "备份不存在" };
    data.backups = data.backups.filter(function (b) { return b.id !== id; });
    pushAudit(data, "DELETE BACKUP", "删除备份 " + id, "warn", sessionUser().username);
    persist();
    emit("backup");
    return { ok: true, message: "已删除备份 " + id };
  }

  function backupJson(id) {
    var record = db().backups.filter(function (b) { return b.id === id; })[0];
    if (!record) return null;
    return JSON.stringify({
      format: "tata-books-backup",
      version: VERSION,
      id: record.id,
      name: record.name,
      note: record.note,
      ts: record.ts,
      size: record.size,
      snapshot: record.snapshot
    }, null, 2);
  }

  function exportSnapshot() {
    return JSON.stringify({
      format: "tata-books-full",
      version: VERSION,
      exported_at: nowIso(),
      cluster: db().cluster,
      data: backupSubset()
    }, null, 2);
  }

  function importBackupText(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (err) { return { ok: false, message: "文件不是合法 JSON" }; }
    var snapshot = parsed.snapshot || (parsed.data && parsed.data.books ? parsed.data : (parsed.books ? parsed : null));
    if (!snapshot || !snapshot.books || !snapshot.users || !snapshot.borrows) {
      return { ok: false, message: "备份文件缺少 books/users/borrows 数据" };
    }
    var data = db();
    var record = {
      id: parsed.id && !data.backups.some(function (b) { return b.id === parsed.id; }) ? parsed.id : "BK-UP-" + Date.now(),
      name: parsed.name || "上传的备份",
      note: parsed.note || "从本地文件上传",
      ts: parsed.ts || nowIso(),
      type: "uploaded",
      status: "success",
      size: JSON.stringify(snapshot).length,
      node: data.cluster.primary,
      snapshot: snapshot
    };
    data.backups.unshift(record);
    if (data.backups.length > 4) data.backups.length = 4;
    pushAudit(data, "UPLOAD BACKUP", "导入备份文件 " + record.id + "，可在列表中恢复", "info", sessionUser().username);
    persist();
    emit("backup");
    return { ok: true, message: "备份文件已导入，点击恢复即可应用", backup: { id: record.id } };
  }

  function resetDemo() {
    var session = readRaw(SESSION_KEY);
    Object.keys(coverCache).forEach(function (key) { invalidateCover(key); });
    DB = seed();
    ensureCovers();
    persist();
    if (session && getUserByName(session)) writeRaw(SESSION_KEY, session);
    else writeRaw(SESSION_KEY, null);
    emit("reset");
    return { ok: true, message: "演示数据已重置" };
  }

  function clusterSnapshot() {
    return clone(db().cluster);
  }

  function clusterPrimary() {
    var c = clusterSnapshot();
    return c.nodes[c.primary] || null;
  }

  function tickCluster() {
    var c = db().cluster;
    Object.keys(c.nodes).forEach(function (id) {
      var node = c.nodes[id];
      if (node.status !== "online") return;
      var drift = (Math.random() - 0.5) * 4;
      node.latency = Math.max(3, Math.round((node.latency + drift) * 10) / 10);
      node.cpu = Math.max(8, Math.min(92, Math.round(node.cpu + (Math.random() - 0.5) * 6)));
      node.mem = Math.max(20, Math.min(90, Math.round(node.mem + (Math.random() - 0.5) * 3)));
      node.connections = Math.max(1, node.connections + Math.round((Math.random() - 0.5) * 4));
      if (node.role === "standby") {
        node.lag = Math.max(0.05, Math.round((node.lag + (Math.random() - 0.48) * 0.25) * 100) / 100);
      } else {
        node.lag = 0;
      }
    });
    persist();
    emit("cluster");
    return clusterSnapshot();
  }

  function clusterEvent(text, level) {
    var c = load().cluster;
    c.events.unshift({ ts: nowIso(), level: level || "info", text: text });
    if (c.events.length > 40) c.events.length = 40;
  }

  function switchPrimary() {
    var c = db().cluster;
    var a = c.nodes[c.primary];
    var b = c.nodes[c.standby];
    if (!a || !b) return { ok: false, message: "集群节点不完整" };
    if (a.status !== "online" || b.status !== "online") return { ok: false, message: "两个节点均在线时才能手动切换" };
    var oldPrimary = c.primary;
    var oldStandby = c.standby;
    b.lag = 0;
    a.lag = 0.2;
    a.role = "standby";
    b.role = "primary";
    c.primary = oldStandby;
    c.standby = oldPrimary;
    c.switchCount += 1;
    clusterEvent("手动主备切换：" + oldPrimary + " → " + c.primary + "，连接串已更新", "success");
    pushAudit(load(), "SWITCHOVER", "手动切换主备：新主节点 " + c.primary, "warn", sessionUser().username, c.primary);
    persist();
    emit("cluster");
    return { ok: true, message: "主备已切换，新主节点：" + c.primary, primary: c.primary };
  }

  function stopPrimary() {
    var c = db().cluster;
    var primary = c.nodes[c.primary];
    var standby = c.nodes[c.standby];
    if (!primary) return { ok: false, message: "主节点不存在" };
    if (primary.status !== "online") return { ok: false, message: "主节点已处于离线状态" };
    if (!standby || standby.status !== "online") return { ok: false, message: "备节点离线，无法完成自动切换" };
    primary.status = "offline";
    primary.role = "offline";
    primary.latency = 0;
    standby.role = "primary";
    standby.lag = 0;
    var oldPrimary = c.primary;
    c.primary = c.standby;
    c.standby = oldPrimary;
    c.lastFailover = nowIso();
    c.switchCount += 1;
    var steps = [
      "检测到主节点 " + oldPrimary + " 心跳超时（3 次未响应）",
      "仲裁组件 DCS 判定主节点故障，集群进入选主状态",
      "提升备节点 " + c.primary + " 为新主节点，回放完剩余 WAL",
      "更新虚拟 IP / 连接串，应用连接自动重定向",
      "前端心跳检测到主节点变化，自动重连成功"
    ];
    steps.forEach(function (text, index) {
      clusterEvent(text, index === 4 ? "success" : "warn");
    });
    pushAudit(load(), "FAILOVER", "主节点 " + oldPrimary + " 下线，备节点 " + c.primary + " 自动提升为主节点", "error", sessionUser().username, c.primary);
    persist();
    emit("cluster");
    return { ok: true, message: "故障转移完成，新主节点：" + c.primary, steps: steps, primary: c.primary };
  }

  function recoverNode(id) {
    var c = db().cluster;
    var node = c.nodes[id];
    if (!node) return { ok: false, message: "节点不存在" };
    if (node.status === "online") return { ok: false, message: "节点已在线" };
    node.status = "online";
    node.role = id === c.primary ? "primary" : "standby";
    node.latency = 12;
    node.cpu = 15;
    node.mem = 32;
    node.lag = node.role === "standby" ? 2.4 : 0;
    node.since = nowIso();
    clusterEvent("节点 " + id + " 恢复上线，角色 " + node.role + "，开始追赶复制日志", "success");
    pushAudit(load(), "RECOVER NODE", "节点 " + id + " 恢复上线，角色 " + node.role, "success", sessionUser().username, c.primary);
    persist();
    emit("cluster");
    return { ok: true, message: "节点 " + id + " 已恢复上线（" + node.role + "）" };
  }

  function connectNode(id) {
    var c = db().cluster;
    var node = c.nodes[id];
    if (!node) return { ok: false, message: "节点不存在" };
    if (node.status !== "online") return { ok: false, message: "节点离线，连接失败" };
    if (node.role === "primary") return { ok: true, message: "已连接主节点 " + id + "，读写正常", readOnly: false, node: clone(node) };
    return { ok: true, message: "节点 " + id + " 为备节点，读写请求已自动路由到主节点 " + c.primary, readOnly: true, node: clone(node) };
  }

  function setAutoFailover(enabled) {
    var c = db().cluster;
    c.autoFailover = Boolean(enabled);
    clusterEvent("自动故障转移已" + (c.autoFailover ? "开启" : "关闭"), c.autoFailover ? "success" : "warn");
    persist();
    emit("cluster");
    return { ok: true, message: "自动故障转移已" + (c.autoFailover ? "开启" : "关闭") };
  }

  function makeCoverBase64(book) {
    if (typeof document === "undefined") return null;
    try {
      var canvas = document.createElement("canvas");
      canvas.width = 360;
      canvas.height = 480;
      var ctx = canvas.getContext("2d");
      var grad = ctx.createLinearGradient(0, 0, 360, 480);
      grad.addColorStop(0, book.colors[0]);
      grad.addColorStop(1, book.colors[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 360, 480);
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      for (var r = 40; r < 520; r += 34) {
        ctx.beginPath();
        ctx.arc(300, 120, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(20, 20, 320, 440);
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = "600 15px sans-serif";
      ctx.fillText(book.category, 40, 64);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "500 11px sans-serif";
      ctx.fillText("BIT BOOKS", 40, 86);
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 38px serif";
      var chars = String(book.title).split("");
      var lines = [];
      var line = "";
      for (var i = 0; i < chars.length; i++) {
        line += chars[i];
        if (line.length >= 5 || i === chars.length - 1) {
          lines.push(line);
          line = "";
        }
      }
      lines.slice(0, 3).forEach(function (text, index) {
        ctx.fillText(text, 40, 210 + index * 52);
      });
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.font = "500 17px serif";
      ctx.fillText(book.author, 40, 408);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(40, 424, 60, 2);
      return canvas.toDataURL("image/png").split(",")[1];
    } catch (err) {
      return null;
    }
  }

  function ensureCovers() {
    var data = db();
    var changed = 0;
    data.books.forEach(function (book) {
      if (!book.cover_blob) {
        var base64 = makeCoverBase64(book);
        if (base64) {
          book.cover_blob = base64;
          book.cover_mime = "image/png";
          changed += 1;
        }
      }
    });
    if (changed) persist();
    return changed;
  }

  function invalidateCover(id) {
    if (coverCache[id]) {
      try { URL.revokeObjectURL(coverCache[id]); } catch (err) {}
      delete coverCache[id];
    }
  }

  function coverUrl(book) {
    if (!book || !book.cover_blob) return "";
    if (coverCache[book.id]) return coverCache[book.id];
    try {
      var binary = atob(book.cover_blob);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var blob = new Blob([bytes], { type: book.cover_mime || "image/png" });
      var url = URL.createObjectURL(blob);
      coverCache[book.id] = url;
      return url;
    } catch (err) {
      return "";
    }
  }

  function setBookCover(id, dataUrl) {
    var book = getBook(id);
    if (!book) return { ok: false, message: "图书不存在" };
    var match = /^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
    if (!match) return { ok: false, message: "仅支持 PNG / JPEG / WebP / GIF / SVG 图片" };
    var base64 = match[2].replace(/\s/g, "");
    var bytes = Math.floor(base64.length * 3 / 4);
    if (bytes > 512 * 1024) return { ok: false, message: "图片不能超过 512 KB" };
    book.cover_blob = base64;
    book.cover_mime = match[1];
    invalidateCover(id);
    pushAudit(db(), "UPDATE books.cover", "更新《" + book.title + "》封面，BLOB " + (bytes / 1024).toFixed(1) + " KB，MIME " + match[1], "info", sessionUser().username);
    persist();
    emit("cover");
    return { ok: true, message: "封面已写入数据库 BLOB", bytes: bytes, mime: match[1] };
  }

  function imageMeta(id) {
    var book = getBook(id);
    if (!book) return null;
    var base64 = book.cover_blob || "";
    return {
      id: book.id,
      title: book.title,
      mime: book.cover_mime || "image/png",
      base64_length: base64.length,
      bytes: Math.floor(base64.length * 3 / 4),
      head: base64.slice(0, 72),
      url: coverUrl(book),
      has_cover: Boolean(base64)
    };
  }

  function books() {
    return clone(db().books);
  }

  function users() {
    return clone(db().users);
  }

  function roles() {
    return clone(db().roles);
  }

  function dbAccounts() {
    return clone(db().dbUsers);
  }

  function borrows() {
    return clone(db().borrows);
  }

  function backups() {
    return clone(db().backups.map(function (b) {
      return { id: b.id, name: b.name, note: b.note, ts: b.ts, type: b.type, status: b.status, size: b.size, node: b.node };
    }));
  }

  function bookHeaderTemplate() {
    return "\ufeff图书编号,书名,作者,分类,ISBN,出版社,出版年,馆藏,可借,评分(10分制),历史借阅,简介\r\nb-demo,示例图书,示例作者,文学,978-0-000-00000-0,示例出版社,2026,3,3,,0,通过 CSV 导入的示例数据\r\n";
  }

  function userHeaderTemplate() {
    return "\ufeff账号,姓名,角色,密码,邮箱,电话\r\nnewreader,新读者,reader,read123,new@stu.edu.cn,138-0000-9999\r\nreader02,读者二号,reader,read123,reader02@stu.edu.cn,138-0000-8888\r\n";
  }

  return {
    VERSION: VERSION,
    LOAN_DAYS: LOAN_DAYS,
    MAX_BORROWS: MAX_BORROWS,
    md5: md5,
    load: load,
    resetDemo: resetDemo,
    sessionUser: sessionUser,
    currentUser: currentUser,
    login: login,
    register: register,
    logout: logout,
    can: can,
    permissionsOf: permissionsOf,
    roles: roles,
    users: users,
    userById: getUserById,
    userByName: getUserByName,
    canEditUser: canEditUserById,
    addUser: addUser,
    updateUserProfile: updateUserProfile,
    setUserRole: setUserRole,
    toggleUser: toggleUser,
    resetPassword: resetPassword,
    importRegisterUsers: importRegisterUsers,
    dbAccounts: dbAccounts,
    books: books,
    bookById: getBook,
    borrows: borrows,
    addBook: addBook,
    updateBook: updateBook,
    setBookShelfStatus: setBookShelfStatus,
    setBookPdf: setBookPdf,
    removeBookPdf: removeBookPdf,
    deleteBook: deleteBook,
    categories: categories,
    availability: availability,
    borrowBook: borrowBook,
    returnBook: returnBook,
    activeBorrowsOf: activeBorrowsOf,
    hasReturned: hasReturned,
    listBorrows: listBorrows,
    reviewsFor: reviewsFor,
    addReview: addReview,
    setReviewStatus: setReviewStatus,
    updateReview: updateReview,
    replyReview: replyReview,
    deleteReview: deleteReview,
    announcements: announcements,
    saveAnnouncement: saveAnnouncement,
    deleteAnnouncement: deleteAnnouncement,
    overdueSweep: overdueSweep,
    hotBooks: hotBooks,
    newArrivals: newArrivals,
    stats: stats,
    runQuery: runQuery,
    procDefs: procDefs,
    triggerDefs: triggerDefs,
    callProcedure: callProcedure,
    audit: audit,
    auditLogs: auditLogs,
    exportBooksCSV: exportBooksCSV,
    exportBorrowsCSV: exportBorrowsCSV,
    exportUsersCSV: exportUsersCSV,
    toCSV: toCSV,
    parseCSV: parseCSV,
    importBooks: importBooks,
    importUsers: importUsers,
    bookHeaderTemplate: bookHeaderTemplate,
    userHeaderTemplate: userHeaderTemplate,
    createBackup: createBackup,
    restoreBackup: restoreBackup,
    deleteBackup: deleteBackup,
    backupJson: backupJson,
    exportSnapshot: exportSnapshot,
    importBackupText: importBackupText,
    backups: backups,
    clusterSnapshot: clusterSnapshot,
    clusterPrimary: clusterPrimary,
    tickCluster: tickCluster,
    switchPrimary: switchPrimary,
    stopPrimary: stopPrimary,
    recoverNode: recoverNode,
    connectNode: connectNode,
    setAutoFailover: setAutoFailover,
    ensureCovers: ensureCovers,
    base64ToBlobUrl: function (base64, mime) {
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    },
    coverUrl: coverUrl,
    invalidateCover: invalidateCover,
    setBookCover: setBookCover,
    imageMeta: imageMeta
  };
});
