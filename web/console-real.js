/**
 * 控制台真实数据页（覆盖旧版 localStorage 实现）。
 * 加载顺序在 console-*.js 之后，因此直接覆盖 C.registry 上的渲染函数。
 * 未覆盖的部分（数据库实验台、审计、备份）仍是旧版演示数据。
 */
(function () {
  "use strict";

  var C = window.TataCore;
  var esc = C.esc;
  function api() { return window.__TATA_API__; }

  // ---------------------------------------------------------------- 概览
  // 概览对所有"能进控制台"的角色开放（各角色看到的内容不同）
  if (C.tabs && C.tabs.overview) C.tabs.overview.perm = "console:access";

  function renderRoleLanding(role) {
    var cfg = role === "analyst"
      ? {
          title: "数据分析员工作台",
          desc: "职责：多条件查询、数据导入导出。数据来自 report schema 的四张投影表（由 D 的报表服务提供）。",
          items: [
            ["多条件查询（分类 / 图书 / 借阅状态 / 日期）", "report-service · D", "PENDING"],
            ["借阅统计与报表", "report-service · D", "PENDING"],
            ["书目与借阅导出", "已可用：控制台『数据导入导出』页", "READY"]
          ]
        }
      : {
          title: "运维管理员工作台",
          desc: "职责：查看数据库状态、备份恢复、主备切换。执行端由 E 的 dbops-service 提供。",
          items: [
            ["数据库连接状态", "catalog-service · 已返回真实连接信息", "READY"],
            ["备份 / 恢复任务", "dbops-service · E", "PENDING"],
            ["主备拓扑与切换", "dbops-service · E", "PENDING"],
            ["审计日志", "dbops-service · E", "PENDING"]
          ]
        };

    C.setActions("");
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>' + esc(cfg.title) + "</h2><p>" + esc(cfg.desc) + "</p></div></div>",
      '  <div class="toolbar" style="flex-direction:column;align-items:stretch;gap:10px">',
      cfg.items.map(function (it) {
        var tone = it[2] === "READY" ? "green" : "gray";
        return '<div style="display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid #e3ebf3;border-radius:8px">' +
          C.badge(it[2] === "READY" ? "可用" : "待接入", tone) +
          '<span style="flex:1">' + esc(it[0]) + "</span>" +
          '<span class="small muted">' + esc(it[1]) + "</span></div>";
      }).join(""),
      "  </div>",
      '  <p class="hint">当前角色不会访问 catalog / loan 的业务数据，只能看到本职责范围内的内容。</p>',
      "</div>"
    ].join("");
  }

  C.registry.overview = async function () {
    var current = api().currentUser();
    var role = current ? current.role : "reader";
    if (role === "analyst" || role === "ops") {
      renderRoleLanding(role);
      return;
    }
    C.setActions([
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="refresh">' + C.icon("refresh") + "刷新指标</button>",
      '<button class="btn btn-primary btn-sm" type="button" data-hact="gotobooks">' + C.icon("book") + "去维护书目</button>"
    ].join(""));

    var stats;
    var cat = {};
    var totalCopies = 0, availableCopies = 0, utilization = 0;

    // 每次进入 / 点「刷新指标」都重读一次数据库，
    // 保证指标与库内实时数据一致，而不是登录时的旧快照。
    await api().preload();

    stats = api().stats();

    // 馆藏册数同「在架书目」一样：渲染时现查接口，不用启动时的缓存
    var copies = await api().copiesLiveSummary();
    if (!copies.ok) copies = api().copiesSummary();
    totalCopies = copies.total;
    availableCopies = copies.available;
    utilization = totalCopies ? Math.round((1 - availableCopies / totalCopies) * 100) : 0;

    var res = await api().consoleStats();
    cat = res.ok ? res.data : {};

    var loans = api().listBorrows({ status: "all" }).slice(0, 8);
    var loanCols = [
      { key: "loan_id", label: "借阅号", render: function (r) { return '<span class="mono small">' + esc(r.loan_id) + "</span>"; } },
      { key: "book", label: "图书", render: function (r) { return esc(r.book_title); } },
      { key: "reader", label: "读者", cls: "num", render: function (r) { return "#" + esc(r.user_id); } },
      { key: "time", label: "借出", render: function (r) { return C.fmtDate(r.borrowed_at); } },
      { key: "status", label: "状态", render: function (r) {
        var label = r.status === "BORROWED" ? (r.overdue ? "逾期" : "在借") : "已归还";
        return C.badge(label, r.status === "BORROWED" ? (r.overdue ? "red" : "blue") : "green");
      } }
    ];

    C.body().innerHTML = [
      '<div class="grid-4">',
      C.kpiHtml("在架书目", cat.books || 0, "分类 " + (cat.categories || 0) + " 个"),
      C.kpiHtml("馆藏册数", totalCopies, "可借 " + availableCopies + " 册 · 借出率 " + utilization + "%"),
      C.kpiHtml("当前在借", stats.activeLoans || 0, "逾期 " + (stats.overdue || 0) + " 笔"),
      C.kpiHtml("读者评价", cat.reviews || 0, "平均 " + (cat.avgRating || 0) + " 星"),
      "</div>",

      '<div class="panel"><div class="panel-head"><div><h2>最近借阅</h2><p>来自借阅服务 loan-service</p></div></div>',
      '  <div id="ovLoans"></div>',
      "</div>"
    ].join("");

    var wrap = document.getElementById("ovLoans");
    if (wrap) wrap.innerHTML = C.tableHtml(loanCols, loans, "暂无借阅记录");
  };

  C.handlers.refresh = function () { C.registry.overview(); };
  C.handlers.gotobooks = function () { window.location.hash = "#console/books"; };

  // ---------------------------------------------------------------- 用户与权限
  var ROLE_TONE = { READER: "gray", LIBRARIAN: "blue", ANALYST: "amber", OPERATOR: "red" };
  var lastRoleSync = null;

  C.handlers.refreshusers = function () { C.registry.users(); };

  C.registry.users = async function () {
    C.setActions('<button class="btn btn-ghost btn-sm" type="button" data-hact="refreshusers">' + C.icon("refresh") + "刷新用户</button>");

    var res = await api().identityUsers();
    var body = C.body();
    if (!res.ok) {
      body.innerHTML = '<div class="panel"><div class="panel-head"><div><h2>用户与权限</h2>' +
        "<p>读取用户列表失败：" + esc(res.message) + "（需要运维管理员账号，且身份服务连得上数据库）</p></div></div></div>";
      return;
    }

    var data = res.data || {};
    var rows = data.items || [];
    var roleOptions = data.roles || [];
    var canEdit = C.can("user:manage");

    var cols = [
      { key: "user", label: "用户", render: function (u) {
          return '<span class="strong">' + esc(u.displayName) + "</span>" +
            '<div class="small muted">@' + esc(u.username) + " · #" + esc(u.userId) + "</div>";
      } },
      { key: "role", label: "当前身份", render: function (u) {
          var badge = C.badge(u.roleName, ROLE_TONE[u.role] || "gray");
          return u.editable ? badge : badge + ' <span class="small muted">不可在此修改</span>';
      } },
      { key: "db", label: "数据库账号", render: function (u) {
          var list = u.dbAccounts || [];
          if (!list.length) return '<span class="muted small">—</span>';
          return list.map(function (a) {
            return '<span class="badge gray" title="' + esc(a.service) + ' 服务的连接账号">' + esc(a.dbUsername) + "</span>";
          }).join(" ");
      } },
      { key: "status", label: "状态", render: function (u) {
          return u.enabled ? C.badge("启用", "green") : C.badge("停用", "gray");
      } },
      { key: "actions", label: "修改身份", render: function (u) {
          if (!canEdit || !u.editable) return '<span class="muted small">只读</span>';
          return '<select class="select" data-role-user="' + esc(u.userId) + '" data-current="' + esc(u.role) +
            '" style="padding:5px 8px;font-size:12px">' +
            roleOptions.map(function (r) {
              return '<option value="' + esc(r.code) + '"' + (u.role === r.code ? " selected" : "") + ">" +
                esc(r.name) + "</option>";
            }).join("") + "</select>";
      } }
    ];

    var syncPanel = "";
    if (lastRoleSync) {
      syncPanel = '<div class="panel"><div class="panel-head"><div><h2>最近一次权限同步</h2>' +
        "<p>" + esc(lastRoleSync.displayName || lastRoleSync.username) + " → " + esc(lastRoleSync.roleName) +
        "；数据库账号的表权限已按目标角色差分调整（缺的授予、多的回收）</p></div></div>" +
        '<div id="roleSyncWrap"></div></div>';
    }

    body.innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>用户与权限</h2>',
      "<p>身份取自 iam.user_role，数据库账号取自 iam.db_identity_mapping。修改身份后，该账号在各服务数据库中的表权限会同步调整，" +
      "下一次鉴权即按新身份生效（无需重启服务）。</p></div></div>",
      '  <div id="userRoleWrap"></div>',
      '  <p class="hint">可选身份：读者（只读浏览与借还）、馆员（书目与借阅维护）、数据分析员（只读统计）。运维管理员账号不在此列表中，避免误改后无法登录。</p>',
      "</div>",
      syncPanel
    ].join("");

    var wrap = document.getElementById("userRoleWrap");
    if (wrap) wrap.innerHTML = C.tableHtml(cols, rows, "没有可管理的用户");

    var syncWrap = document.getElementById("roleSyncWrap");
    if (syncWrap && lastRoleSync) {
      var syncCols = [
        { key: "account", label: "数据库账号", render: function (r) { return '<span class="mono small">' + esc(r.account) + "</span>"; } },
        { key: "schema", label: "Schema", render: function (r) { return '<span class="small">' + esc(r.schema) + "</span>"; } },
        { key: "granted", label: "已授予", render: function (r) {
            if (!r.granted) return '<span class="muted small">—</span>';
            return '<span class="badge green" title="' + esc(r.granted) + '">' + r.grantedCount + " 项</span>";
        } },
        { key: "revoked", label: "已回收", render: function (r) {
            if (!r.revoked) return '<span class="muted small">—</span>';
            return '<span class="badge amber" title="' + esc(r.revoked) + '">' + r.revokedCount + " 项</span>";
        } },
        { key: "note", label: "备注", render: function (r) { return '<span class="small muted">' + esc(r.note) + "</span>"; } }
      ];
      var syncRows = (lastRoleSync.dbSync || []).map(function (s) {
        var granted = (s.granted || []).join("；");
        var revoked = (s.revoked || []).join("；");
        return {
          account: s.account,
          schema: s.schema || "—",
          granted: granted,
          grantedCount: (s.granted || []).length,
          revoked: revoked,
          revokedCount: (s.revoked || []).length,
          note: s.note || ((s.errors && s.errors.length) ? "失败：" + s.errors.join("；") : "")
        };
      });
      syncWrap.innerHTML = C.tableHtml(syncCols, syncRows, "本次没有需要调整的数据库账号");
    }

    if (wrap) {
      wrap.onchange = function (event) {
        var sel = event.target.closest("select[data-role-user]");
        if (!sel) return;
        var userId = sel.getAttribute("data-role-user");
        var prev = sel.getAttribute("data-current");
        var code = sel.value;
        var label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : code;
        if (code === prev) return;
        sel.value = prev;   // 先把界面还原，等确认后再真正改

        var target = rows.filter(function (u) { return String(u.userId) === String(userId); })[0] || {};
        window.TataUI.confirm({
          icon: "users",
          title: "修改用户身份",
          desc: "将 " + (target.displayName || target.username) + "（@" + (target.username || userId) + "）的身份改为「" + label +
            "」。数据库层会同步：授予该角色应有的表权限，并回收超出的部分；服务无需重启，下一次鉴权即生效。",
          confirmText: "确认修改",
          danger: code === "READER",
          onConfirm: async function () {
            var r = await api().changeUserRole(userId, code);
            if (!r.ok) {
              C.toast(r.message, "error");
              return false;
            }
            lastRoleSync = Object.assign({ displayName: target.displayName }, r.data);
            lastRoleSync.username = (r.data && r.data.username) || target.username;
            C.toast("已改为" + ((r.data && r.data.roleName) || label) + "，数据库权限已同步");
            C.registry.users();
            if (window.TataUI.refreshAll) window.TataUI.refreshAll();
            return true;
          }
        });
      };
    }
  };

  // ---------------------------------------------------------------- 评价
  C.registry.reviews = async function () {
    C.setActions('<button class="btn btn-ghost btn-sm" type="button" data-hact="refreshreviews">' + C.icon("refresh") + "刷新</button>");
    var res = await api().consoleReviews(null);
    var rows = res.ok ? res.data.items : [];
    var cols = [
      { key: "book", label: "图书", render: function (r) { return '<span class="strong">' + esc(r.bookTitle) + "</span>"; } },
      { key: "user", label: "读者", render: function (r) { return esc(r.username || ("#" + r.userId)); } },
      { key: "rating", label: "评分", cls: "num", render: function (r) { return "<b>" + r.rating + "</b> / 5"; } },
      { key: "content", label: "内容", render: function (r) { return '<span class="small">' + esc(r.content || "—") + "</span>"; } },
      { key: "time", label: "时间", render: function (r) { return '<span class="nowrap small">' + C.fmtDateTime(r.createdAt) + "</span>"; } },
      { key: "actions", label: "操作", render: function (r) {
        return C.can("review:manage")
          ? '<button class="link-btn danger" type="button" data-act="del-review" data-id="' + r.reviewId + '">删除</button>'
          : '<span class="muted small">只读</span>';
      } }
    ];
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>读者评价</h2>',
      "<p>数据来自 catalog.review（" + rows.length + " 条）。读者在图书详情页发表，馆员可删除不当评价。</p></div></div>",
      '  <div id="reviewWrap"></div>',
      "</div>"
    ].join("");

    var wrap = document.getElementById("reviewWrap");
    wrap.innerHTML = C.tableHtml(cols, rows, "还没有读者评价");
    wrap.onclick = function (event) {
      var btn = event.target.closest("button[data-act='del-review']");
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      window.TataUI.confirm({
        icon: "x",
        title: "删除评价",
        desc: "确认删除这条评价？为软删除，数据保留在库中。",
        confirmText: "确认删除",
        danger: true,
        onConfirm: async function () {
          var r = await api().deleteReview(id);
          if (!r.ok) { C.toast(r.message, "error"); return false; }
          C.toast("已删除");
          C.registry.reviews();
          return true;
        }
      });
    };
  };
  C.handlers.refreshreviews = function () { C.registry.reviews(); };

  // ---------------------------------------------------------------- 公告
  C.registry.announcements = async function () {
    C.setActions([
      C.can("announcement:write")
        ? '<button class="btn btn-primary btn-sm" type="button" data-hact="addannouncement">' + C.icon("plus") + "发布公告</button>"
        : ""
    ].join(""));
    var res = await api().consoleAnnouncements(false);
    var rows = res.ok ? res.data.items : [];
    var cols = [
      { key: "title", label: "标题", render: function (r) { return '<span class="strong">' + esc(r.title) + "</span>"; } },
      { key: "content", label: "内容", render: function (r) { return '<span class="small">' + esc(r.content) + "</span>"; } },
      { key: "published", label: "状态", render: function (r) { return r.published ? C.badge("已发布", "green") : C.badge("草稿", "gray"); } },
      { key: "time", label: "创建时间", render: function (r) { return '<span class="nowrap small">' + C.fmtDateTime(r.createdAt) + "</span>"; } },
      { key: "actions", label: "操作", render: function (r) {
        return C.can("announcement:write")
          ? '<button class="link-btn danger" type="button" data-act="del-ann" data-id="' + r.announcementId + '">删除</button>'
          : '<span class="muted small">只读</span>';
      } }
    ];
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>公告管理</h2>',
      "<p>数据来自 catalog.announcement（" + rows.length + " 条）。已发布的公告会显示在读者端「公告」页。</p></div></div>",
      '  <div id="annWrap"></div>',
      "</div>"
    ].join("");

    var wrap = document.getElementById("annWrap");
    wrap.innerHTML = C.tableHtml(cols, rows, "还没有公告");
    wrap.onclick = function (event) {
      var btn = event.target.closest("button[data-act='del-ann']");
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      window.TataUI.confirm({
        icon: "x", title: "删除公告", desc: "确认删除这条公告？", confirmText: "确认删除", danger: true,
        onConfirm: async function () {
          var r = await api().deleteAnnouncement(id);
          if (!r.ok) { C.toast(r.message, "error"); return false; }
          C.toast("已删除");
          C.registry.announcements();
          return true;
        }
      });
    };
  };

  C.handlers.addannouncement = function () {
    var body = [
      '<form class="modal-form" onsubmit="return false">',
      '  <label class="field"><span>标题 *</span><input id="anTitle" placeholder="例如：闭馆通知"></label>',
      '  <label class="field"><span>内容 *</span><textarea id="anContent" rows="4"></textarea></label>',
      '  <label class="field"><span>状态</span><select id="anPublished">',
      '    <option value="true">立即发布</option><option value="false">存为草稿</option>',
      "  </select></label>",
      "</form>"
    ].join("");
    window.TataUI.modal({
      title: "发布公告",
      desc: "写入 catalog.announcement，发布后读者端立即可见。",
      bodyHtml: body,
      confirmText: "保存",
      onConfirm: async function () {
        var title = document.getElementById("anTitle").value.trim();
        var content = document.getElementById("anContent").value.trim();
        if (!title || !content) { C.toast("标题和内容不能为空", "error"); return false; }
        var r = await api().saveAnnouncement({
          title: title,
          content: content,
          published: document.getElementById("anPublished").value === "true"
        });
        if (!r.ok) { C.toast("保存失败：" + r.message, "error"); return false; }
        C.toast("公告已保存");
        C.registry.announcements();
        return true;
      }
    });
  };

  // ---------------------------------------------------------------- 主备服务器（预留）
  C.registry.servers = async function () {
    C.setActions("");
    var res = await api().opsStatus();
    var d = res.ok ? res.data : null;
    var db = d && d.database ? d.database : {};
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>主备拓扑</h2>',
      "<p>该页面为预留接口，等待 E 的 dbops-service 接入后展示真实主备与复制延迟。</p></div></div>",
      '  <div class="toolbar" style="flex-wrap:wrap;gap:18px">',
      '    <span>当前节点：<b>primary</b>（单实例）</span>',
      '    <span>数据库：<b>' + esc(db.database || "—") + "</b></span>",
      '    <span>连接账号：<b>' + esc(db.databaseUser || "—") + "</b></span>",
      '    <span>会话数：<b>' + esc(db.connections || "—") + "</b></span>",
      "  </div>",
      '  <div class="code-block small" style="white-space:pre-wrap;margin-top:12px">' + esc(db.version || "") + "</div>",
      '  <p class="hint" style="margin-top:12px">接口约定：GET /api/catalog/ops/status 已返回 ',
      '<span class="mono">' + esc(d ? d.status : "PENDING") + "</span>，",
      "待 dbops-service 提供真实拓扑后替换 primary / standby / replicationLagSeconds 三个字段即可，前端不用改。</p>",
      "</div>"
    ].join("");
  };

  // ---------------------------------------------------------------- 数据导入导出
  C.registry.data = async function () {
    C.setActions([
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="importbooks">' + C.icon("upload") + "导入书目 CSV</button>",
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="exportbooks">' + C.icon("download") + "导出书目 CSV</button>"
    ].join(""));
    var stats = api().stats();
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>数据导入导出</h2>',
      "<p>书目导入写成 catalog.book；借阅记录导出读取 loan.loan_record。</p></div></div>",
      '  <div class="toolbar" style="flex-wrap:wrap;gap:12px">',
      '    <a class="btn btn-ghost btn-sm" href="' + api().templateUrl() + '">下载导入模板</a>',
      '    <a class="btn btn-ghost btn-sm" href="' + api().exportBooksUrl("") + '">导出全部书目</a>',
      "  </div>",
      '  <p class="hint">CSV 模板列：isbn,title,category,author,publisher,year,copies,summary。',
      "copies 是馆藏册数（0–50），可留空；分类必须已存在；ISBN 重复会更新已有记录，不会产生重复行。</p>",
      '  <p class="hint">当前库内：' + (stats.books || 0) + " 种图书，" + (stats.categories || 0) + " 个分类。</p>",
      "</div>"
    ].join("");
  };

  // ---------------------------------------------------------------- 备份 / 审计（预留，避免继续展示编造数据）
  C.registry.backup = async function () {
    C.setActions("");
    var res = await api().opsStatus();
    var d = res.ok ? res.data : null;
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>备份与恢复</h2>',
      "<p>该页面为预留接口，等待 E 的 dbops-service 提供备份、恢复与校验能力。</p></div></div>",
      '  <div class="toolbar" style="flex-wrap:wrap;gap:12px">',
      C.badge("待接入", "gray"),
      '    <span class="small muted">执行端：dbops-service（E）</span>',
      "  </div>",
      '  <p class="hint">数据库当前状态：' + esc(d && d.database ? d.database.database + " / " + d.database.databaseUser : "—") + "</p>",
      '  <p class="hint">接入后此处展示：备份文件列表、执行结果、恢复验证对照。前端无需改动，只替换数据源。</p>',
      "</div>"
    ].join("");
  };

  C.registry.audit = async function () {
    C.setActions("");
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>审计日志</h2>',
      "<p>该页面为预留接口。借还审计已真实写入 loan.loan_audit，由借阅服务（C）提供查询接口。</p></div></div>",
      '  <div class="toolbar" style="flex-wrap:wrap;gap:12px">',
      C.badge("待接入", "gray"),
      '    <span class="small muted">数据源：loan.loan_audit（C）</span>',
      "  </div>",
      '  <p class="hint">建议 C 提供 GET /api/loans/audit?afterId=&limit=，接入后此处展示审计明细。</p>',
      "</div>"
    ].join("");
  };
})();
