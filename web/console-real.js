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
            ["多条件查询（分类 / 图书 / 借阅状态 / 日期）", "report-service · D", "READY", "report-query"],
            ["借阅统计与报表", "report-service · D", "READY", ["report-stats", "report-export"]],
            ["书目与借阅导出", "已可用：控制台『数据导入导出』页", "READY", "data"]
          ]
        }
      : {
          title: "运维管理员工作台",
          desc: "职责：查看数据库状态、备份恢复、主备切换。执行端由 E 的 dbops-service 提供。",
          items: [
            ["数据库连接状态", "dbops-service · 真实状态", "READY", "servers"],
            ["备份 / 恢复任务", "dbops-service · 已接入", "READY", "backup"],
            ["主备拓扑与切换", "dbops-service · 已接入", "READY", "servers"],
            ["审计日志", "loan.loan_audit · 待接入", "PENDING"]
          ]
        };

    C.setActions("");
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>' + esc(cfg.title) + "</h2><p>" + esc(cfg.desc) + "</p></div></div>",
      '  <div class="toolbar" style="flex-direction:column;align-items:stretch;gap:10px">',
      cfg.items.map(function (it) {
        var tone = it[2] === "READY" ? "green" : "gray";
        var nav = "";
        if (it[2] === "READY" && it[3]) {
          if (Array.isArray(it[3])) {
            nav = it[3].map(function (tab) {
              var label = tab === "report-stats" ? "借阅统计" : (tab === "report-export" ? "统计导出" : tab);
              return '<button class="btn btn-ghost btn-sm" type="button" data-goto-tab="' + esc(tab) + '">' + esc(label) + "</button>";
            }).join(" ");
          } else {
            nav = '<button class="btn btn-primary btn-sm" type="button" data-goto-tab="' + esc(it[3]) + '">进入</button>';
          }
        }
        return '<div style="display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid #e3ebf3;border-radius:8px">' +
          C.badge(it[2] === "READY" ? "可用" : "待接入", tone) +
          '<span style="flex:1">' + esc(it[0]) + "</span>" +
          '<span class="small muted">' + esc(it[1]) + "</span>" +
          (nav ? '<span style="display:flex;gap:6px;flex-wrap:wrap">' + nav + "</span>" : "") +
          "</div>";
      }).join(""),
      "  </div>",
      '  <p class="hint">当前角色不会访问 catalog / loan 的业务数据，只能看到本职责范围内的内容。</p>',
      "</div>"
    ].join("");

    C.body().onclick = function (event) {
      var btn = event.target.closest("button[data-goto-tab]");
      if (!btn) return;
      var tab = btn.getAttribute("data-goto-tab");
      if (tab) window.location.hash = "#console/" + tab;
    };
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

  // ---------------------------------------------------------------- 运维任务（E）
  var TASK_TEXT = { QUEUED: "排队", RUNNING: "执行中", SUCCEEDED: "成功", FAILED: "失败" };
  var TASK_TONE = { QUEUED: "gray", RUNNING: "blue", SUCCEEDED: "green", FAILED: "red" };

  function fmtBytes(n) {
    var value = Number(n) || 0;
    var units = ["B", "KB", "MB", "GB"];
    var i = 0;
    while (value >= 1024 && i < units.length - 1) { value = value / 1024; i++; }
    return (i === 0 ? String(value) : value.toFixed(1)) + " " + units[i];
  }

  function taskDetailHtml(task) {
    if (!task) return '<p class="hint">选择一条任务查看执行步骤与结果。</p>';
    var steps = (task.steps || []).map(function (step) {
      var tone = step.status === "SUCCEEDED" ? "green" : (step.status === "FAILED" ? "red" : "blue");
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #eef3f8">' +
        C.badge(TASK_TEXT[step.status] || step.status, tone) +
        '<span style="flex:1">' + esc(step.name) +
        (step.detail ? '<div class="small muted" style="margin-top:3px">' + esc(step.detail) + "</div>" : "") +
        '</span><span class="small muted">' + esc(step.finishedAt || step.startedAt || "") + "</span></div>";
    }).join("");
    var error = task.error ? '<p class="hint" style="color:#c0392b;margin-top:10px">失败原因：' + esc(task.error) + "</p>" : "";
    var result = task.result
      ? '<h3 style="margin:16px 0 6px">执行结果</h3><pre class="code-block small" style="white-space:pre-wrap">' + esc(JSON.stringify(task.result, null, 2)) + "</pre>"
      : "";
    var log = task.log
      ? '<details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">执行日志</summary>' +
        '<pre class="code-block small" style="white-space:pre-wrap;max-height:260px;overflow:auto">' + esc(task.log) + "</pre></details>"
      : "";
    return '<div class="panel" style="margin-bottom:0">' +
      '<div class="panel-head"><div><h2>' + esc(task.actionLabel) + "</h2>" +
      '<p class="small muted">任务 ' + esc(task.id) + " · 提交人 " + esc(task.actor || "—") + " · " + esc(task.createdAt) + "</p></div>" +
      C.badge(TASK_TEXT[task.status] || task.status, TASK_TONE[task.status] || "gray") + "</div>" +
      steps + error + result + log + "</div>";
  }

  function taskRows(items) {
    if (!items || !items.length) return '<p class="hint">暂无任务记录。</p>';
    return '<table class="table"><thead><tr><th>任务</th><th>动作</th><th>状态</th><th>提交时间</th><th></th></tr></thead><tbody>' +
      items.map(function (task) {
        return "<tr><td class=\"mono small\">" + esc(task.id) + "</td><td>" + esc(task.actionLabel) +
          '</td><td>' + C.badge(TASK_TEXT[task.status] || task.status, TASK_TONE[task.status] || "gray") +
          '</td><td class="small muted">' + esc(task.createdAt) + '</td><td><button class="btn btn-ghost btn-sm" type="button" data-opact="task" data-taskid="' +
          esc(task.id) + '">查看</button></td></tr>';
      }).join("") + "</tbody></table>";
  }

  function trackTask(taskId, tab) {
    var attempts = 0;
    function tick() {
      if (C.state.currentTab !== tab) return;
      api().opsTask(taskId).then(function (res) {
        if (!res.ok) {
          if (++attempts < 3) setTimeout(tick, 2000);
          return;
        }
        var task = res.data;
        var box = document.getElementById("opsTaskDetail");
        if (box) box.innerHTML = taskDetailHtml(task);
        if (task.status === "SUCCEEDED" || task.status === "FAILED") {
          C.toast(task.status === "SUCCEEDED" ? "任务完成：" + task.actionLabel : "任务失败，请查看详情", task.status === "SUCCEEDED" ? "success" : "error");
          return;
        }
        setTimeout(tick, 1500);
      });
    }
    setTimeout(tick, 800);
  }

  function bindOpsActions(handler) {
    var dispatch = function (event) {
      var el = event.target.closest("[data-opact]");
      if (!el) return;
      handler(el.getAttribute("data-opact"), el);
    };
    C.body().onclick = dispatch;
    // 顶部操作栏位于 #consoleActions，console.js 只识别 data-hact，
    // 这里补一个 data-opact 的监听；没有匹配元素时不影响原有按钮。
    var bar = document.getElementById("consoleActions");
    if (bar) bar.onclick = dispatch;
  }

  // ---------------------------------------------------------------- 主备服务器（真实状态）
  C.registry.servers = async function () {
    C.setActions([
      '<button class="btn btn-ghost btn-sm" type="button" data-opact="refresh">' + C.icon("refresh") + "刷新状态</button>",
      '<button class="btn btn-primary btn-sm" type="button" data-opact="switch-open">切换主备</button>'
    ].join(""));

    var res = await api().opsStatus(true);
    var d = res.ok ? res.data : null;
    if (!d) {
      C.body().innerHTML = [
        '<div class="panel"><div class="panel-head"><div><h2>主备拓扑</h2>',
        "<p>运维服务不可达，页面无法读取数据库状态。</p></div></div>",
        '<p class="hint" style="color:#c0392b">' + esc(res.message || "请求失败") + "</p>",
        '<p class="hint">检查 dbops-service 是否启动：<span class="mono">docker compose -f compose.yaml -f compose.web.yaml ps dbops-service</span>，',
        "以及 Nginx 的 <span class=\"mono\">/api/ops/</span> 路由是否已生效。</p>",
        "</div>"
      ].join("");
      return;
    }

    var db = d.database || {};
    var nodes = d.nodes || [];
    var rep = d.replication || {};
    var single = !rep.configured;
    var nodeHtml = nodes.map(function (node) {
      var roleText = node.role === "primary" ? "主节点" : (node.role === "standby" ? "备节点" : "角色未知");
      var tone = node.status !== "online" ? "red" : (node.role === "primary" ? "green" : "blue");
      return '<div style="border:1px solid #e3ebf3;border-radius:10px;padding:14px 16px;min-width:280px;flex:1">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        "<strong>" + esc(node.name) + "</strong>" + C.badge(roleText, tone) + "</div>" +
        '<div class="small muted">地址：' + esc(node.host + ":" + node.port) + "</div>" +
        '<div class="small muted">容器：<span class="mono">' + esc(node.container) + "</span></div>" +
        '<div class="small muted">进程：' + (node.status === "online" ? "运行中" : "未运行") + " · 数据库状态：" + esc(node.dbState) + "</div>" +
        (node.error ? '<div class="small" style="color:#c0392b;margin-top:6px">' + esc(node.error) + "</div>" : "") +
        "</div>";
    }).join("");

    var replicationText = single ? "单实例（未配置备节点）" : (
      rep.state === "STREAMING" ? "流复制正常" : (rep.state === "DEGRADED" ? "复制降级" : "复制状态未知"));
    var lagText = rep.lagSeconds === null || rep.lagSeconds === undefined ? "—" : rep.lagSeconds + " 秒";

    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>主备拓扑</h2>',
      "<p>数据来自 dbops-service 的实时采集；采集时间 " + esc(d.collectedAt) + "，耗时 " + esc(d.durationMs) + " ms。</p></div>",
      C.badge(databaseReady(db) ? "数据库在线" : "数据库异常", databaseReady(db) ? "green" : "red") + "</div>",
      '<div class="toolbar" style="flex-wrap:wrap;gap:12px">',
      '<div style="display:flex;gap:10px;flex-wrap:wrap;flex:1">' + (nodeHtml || '<p class="hint">未采集到节点信息</p>') + "</div>",
      '<div style="border:1px solid #e3ebf3;border-radius:10px;padding:14px 16px;min-width:220px">',
      "  <strong>复制状态</strong>",
      '  <div style="margin-top:8px">' + C.badge(replicationText, single ? "gray" : (rep.state === "STREAMING" ? "green" : "red")) + "</div>",
      '  <div class="small muted" style="margin-top:8px">复制延迟：<b>' + esc(lagText) + "</b></div>",
      '  <div class="small muted">执行模式：' + esc((d.service || {}).execMode || "—") + "</div>",
      "</div></div>",
      "</div>",

      '<div class="panel"><div class="panel-head"><div><h2>数据库连接</h2>',
      "<p>连接信息由 dbops-service 通过 gsql 读取，不回传口令。</p></div></div>",
      databaseReady(db)
        ? '<div class="toolbar" style="flex-wrap:wrap;gap:22px">' +
          "<span>数据库：<b>" + esc(db.database) + "</b></span>" +
          "<span>账号：<b>" + esc(db.databaseUser) + "</b></span>" +
          "<span>会话数：<b>" + esc(db.connections === null || db.connections === undefined ? "—" : db.connections) + "</b></span>" +
          '<span class="small muted">' + esc(db.version || "") + "</span></div>"
        : '<p class="hint" style="color:#c0392b">连接失败：' + esc(db.error || "未知原因") + "</p>",
      "</div>",

      '<div class="panel"><div class="panel-head"><div><h2>运维任务</h2>',
      "<p>切换前需要在此确认；执行过程每 1.5 秒刷新一次。</p></div>",
      '<span id="opsSwitchForm" hidden>' +
      '  <span class="small muted" style="margin-right:8px">确认把业务切到备节点？</span>' +
      '  <button class="btn btn-primary btn-sm" type="button" data-opact="switch-confirm">确认切换</button> ' +
      '  <button class="btn btn-ghost btn-sm" type="button" data-opact="switch-cancel">取消</button>' +
      "</span></div>",
      '<div id="opsTaskDetail" style="margin-bottom:16px">' + taskDetailHtml(null) + "</div>",
      '<div id="opsTaskList"><p class="hint">读取任务记录…</p></div>',
      "</div>"
    ].join("");

    bindOpsActions(function (act, el) {
      if (act === "refresh") { C.registry.servers(); return; }
      if (act === "switch-open") {
        if (single) { C.toast("当前是单实例部署，未配置备节点，不能切换", "warn"); return; }
        var form = document.getElementById("opsSwitchForm");
        if (form) form.hidden = false;
        return;
      }
      if (act === "switch-cancel") {
        var cancel = document.getElementById("opsSwitchForm");
        if (cancel) cancel.hidden = true;
        return;
      }
      if (act === "switch-confirm") {
        var confirmBox = document.getElementById("opsSwitchForm");
        if (confirmBox) confirmBox.hidden = true;
        api().opsSwitchover().then(function (r) {
          if (!r.ok) { C.toast("切换未提交：" + r.message, "error"); return; }
          C.toast("切换任务已提交：" + r.data.id + "，正在执行", "success");
          var detail = document.getElementById("opsTaskDetail");
          if (detail) detail.innerHTML = taskDetailHtml(r.data);
          trackTask(r.data.id, "servers");
        });
        return;
      }
      if (act === "task") {
        api().opsTask(el.getAttribute("data-taskid")).then(function (r) {
          if (!r.ok) { C.toast(r.message || "读取任务失败", "error"); return; }
          var box = document.getElementById("opsTaskDetail");
          if (box) box.innerHTML = taskDetailHtml(r.data);
        });
      }
    });

    api().opsTasks(8).then(function (r) {
      var list = document.getElementById("opsTaskList");
      if (!list) return;
      list.innerHTML = r.ok ? taskRows(r.data.items) : '<p class="hint" style="color:#c0392b">任务记录读取失败：' + esc(r.message) + "</p>";
    });
  };

  function databaseReady(db) {
    return Boolean(db && db.reachable);
  }

  // ---------------------------------------------------------------- 备份与恢复（真实任务）
  C.registry.backup = async function () {
    C.setActions([
      '<button class="btn btn-primary btn-sm" type="button" data-opact="backup">' + C.icon("db") + "立即备份</button>",
      '<button class="btn btn-ghost btn-sm" type="button" data-opact="refresh">' + C.icon("refresh") + "刷新</button>"
    ].join(""));

    var res = await api().opsBackups();
    var d = res.ok ? res.data : null;
    if (!d) {
      C.body().innerHTML = [
        '<div class="panel"><div class="panel-head"><div><h2>备份与恢复</h2>',
        "<p>运维服务不可达，无法读取备份清单。</p></div></div>",
        '<p class="hint" style="color:#c0392b">' + esc(res.message || "请求失败") + "</p>",
        "</div>"
      ].join("");
      return;
    }

    var items = d.items || [];
    var table = items.length
      ? '<table class="table"><thead><tr><th>归档文件</th><th>生成时间</th><th>大小</th><th>备注</th><th>SHA-256</th><th>操作</th></tr></thead><tbody>' +
        items.map(function (item) {
          return '<tr><td class="mono small">' + esc(item.backupId) + "</td>" +
            '<td class="small muted">' + esc(item.createdAt) + "</td>" +
            "<td>" + fmtBytes(item.sizeBytes) + "</td>" +
            '<td class="small">' + esc(item.note || "—") + "</td>" +
            '<td class="mono small">' + esc((item.sha256 || "").slice(0, 16)) + "…</td>" +
            '<td><button class="btn btn-ghost btn-sm" type="button" data-opact="restore-open" data-backup="' + esc(item.backupId) + '">恢复到验证库</button></td></tr>';
        }).join("") + "</tbody></table>"
      : '<p class="hint">还没有备份。点右上角“立即备份”生成第一份 gs_dump 归档。</p>';

    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>备份与恢复</h2>',
      "<p>归档为 gs_dump 自定义格式，落在 <span class=\"mono\">" + esc(d.backupDir || "/backup") + "</span>；共 " +
      items.length + " 份，占用 " + fmtBytes(d.totalBytes) + "。</p></div>",
      C.badge("数据库之外", "gray") + "</div>",
      '<div id="opsBackupTable">' + table + "</div>",
      '<div id="opsRestoreForm" hidden style="margin-top:16px;border:1px solid #f0c36d;background:#fffaf0;border-radius:10px;padding:14px 16px">' +
      '  <strong>恢复确认</strong>' +
      '  <p class="small muted" style="margin:6px 0">归档：<span class="mono" id="opsRestoreName">—</span>。只会写入以 ' +
      esc("library_verify") + " 开头的验证库；同名的旧验证库会先被删除。</p>" +
      '  <label class="small">目标库名 <input id="opsRestoreTarget" value="library_verify" style="margin-left:8px;padding:6px 8px;border:1px solid #d8e2ec;border-radius:6px;width:240px"></label>' +
      '  <div style="margin-top:10px"><button class="btn btn-primary btn-sm" type="button" data-opact="restore-confirm">确认恢复</button> ' +
      '  <button class="btn btn-ghost btn-sm" type="button" data-opact="restore-cancel">取消</button></div>' +
      "</div>",
      "</div>",

      '<div class="panel"><div class="panel-head"><div><h2>备份 / 恢复任务</h2>',
      "<p>任务记录保存在业务库之外，数据库异常时仍可查看。</p></div></div>",
      '<div id="opsTaskDetail" style="margin-bottom:16px">' + taskDetailHtml(null) + "</div>",
      '<div id="opsTaskList"><p class="hint">读取任务记录…</p></div>',
      "</div>"
    ].join("");

    var pendingBackup = "";

    function refreshTable() {
      api().opsBackups().then(function (r2) {
        var box = document.getElementById("opsBackupTable");
        if (!box || !r2.ok) return;
        var list = r2.data.items || [];
        box.innerHTML = list.length
          ? '<table class="table"><thead><tr><th>归档文件</th><th>生成时间</th><th>大小</th><th>备注</th><th>SHA-256</th><th>操作</th></tr></thead><tbody>' +
            list.map(function (item) {
              return '<tr><td class="mono small">' + esc(item.backupId) + "</td>" +
                '<td class="small muted">' + esc(item.createdAt) + "</td>" +
                "<td>" + fmtBytes(item.sizeBytes) + "</td>" +
                '<td class="small">' + esc(item.note || "—") + "</td>" +
                '<td class="mono small">' + esc((item.sha256 || "").slice(0, 16)) + "…</td>" +
                '<td><button class="btn btn-ghost btn-sm" type="button" data-opact="restore-open" data-backup="' + esc(item.backupId) + '">恢复到验证库</button></td></tr>';
            }).join("") + "</tbody></table>"
          : '<p class="hint">还没有备份。</p>';
      });
    }

    bindOpsActions(function (act, el) {
      if (act === "refresh") { C.registry.backup(); return; }
      if (act === "backup") {
        api().opsCreateBackup("").then(function (r) {
          if (!r.ok) { C.toast("备份未提交：" + r.message, "error"); return; }
          C.toast("备份任务已提交：" + r.data.id, "success");
          var detail = document.getElementById("opsTaskDetail");
          if (detail) detail.innerHTML = taskDetailHtml(r.data);
          trackTask(r.data.id, "backup");
          setTimeout(refreshTable, 3000);
        });
        return;
      }
      if (act === "restore-open") {
        pendingBackup = el.getAttribute("data-backup");
        var form = document.getElementById("opsRestoreForm");
        var name = document.getElementById("opsRestoreName");
        if (name) name.textContent = pendingBackup;
        if (form) form.hidden = false;
        return;
      }
      if (act === "restore-cancel") {
        var cancel = document.getElementById("opsRestoreForm");
        if (cancel) cancel.hidden = true;
        return;
      }
      if (act === "restore-confirm") {
        var target = (document.getElementById("opsRestoreTarget") || {}).value || "library_verify";
        var box = document.getElementById("opsRestoreForm");
        if (box) box.hidden = true;
        api().opsRestore(pendingBackup, target).then(function (r) {
          if (!r.ok) { C.toast("恢复未提交：" + r.message, "error"); return; }
          C.toast("恢复任务已提交：" + r.data.id, "success");
          var detail = document.getElementById("opsTaskDetail");
          if (detail) detail.innerHTML = taskDetailHtml(r.data);
          trackTask(r.data.id, "backup");
        });
        return;
      }
      if (act === "task") {
        api().opsTask(el.getAttribute("data-taskid")).then(function (r) {
          if (!r.ok) { C.toast(r.message || "读取任务失败", "error"); return; }
          var panel = document.getElementById("opsTaskDetail");
          if (panel) panel.innerHTML = taskDetailHtml(r.data);
        });
      }
    });

    api().opsTasks(8).then(function (r) {
      var list = document.getElementById("opsTaskList");
      if (!list) return;
      list.innerHTML = r.ok ? taskRows(r.data.items) : '<p class="hint" style="color:#c0392b">任务记录读取失败：' + esc(r.message) + "</p>";
    });
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

  // ---------------------------------------------------------------- 审计（预留）
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

  // ---------------------------------------------------------------- 报表（report-service · D）
  var REPORT_SEED_CATS = [
    { categoryId: 1, categoryName: "文学" },
    { categoryId: 2, categoryName: "计算机" }
  ];
  var REPORT_SEED_BOOKS = [
    { bookId: 1, title: "红楼梦", categoryId: 1 },
    { bookId: 2, title: "活着", categoryId: 1 },
    { bookId: 3, title: "围城", categoryId: 1 },
    { bookId: 4, title: "数据库系统概念", categoryId: 2 }
  ];

  function reportAuthHeaders() {
    var t = sessionStorage.getItem("tata-token") || "";
    return t ? { Authorization: "Bearer " + t } : {};
  }

  function reportUnwrap(payload) {
    if (payload && typeof payload === "object" && "code" in payload && "data" in payload) return payload.data;
    return payload;
  }

  async function reportFetchJson(url) {
    var res = await fetch(url, { headers: reportAuthHeaders() });
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      if (res.status === 401 && window.TataUI && window.TataUI.openLogin) window.TataUI.openLogin();
      throw new Error((body && body.message) || ("HTTP " + res.status));
    }
    return reportUnwrap(body);
  }

  function toReportDateTime(val) {
    if (!val) return "";
    var s = String(val).trim();
    if (s.length === 16) s += ":00";
    return s;
  }

  function buildReportFilters(prefix) {
    var p = prefix || "rq";
    var categoryId = document.getElementById(p + "Category") ? document.getElementById(p + "Category").value : "";
    var bookId = document.getElementById(p + "Book") ? document.getElementById(p + "Book").value : "";
    var statusEl = document.getElementById(p + "Status");
    var status = statusEl ? statusEl.value : "";
    var from = toReportDateTime(document.getElementById(p + "From") ? document.getElementById(p + "From").value : "");
    var to = toReportDateTime(document.getElementById(p + "To") ? document.getElementById(p + "To").value : "");
    var sortBy = document.getElementById(p + "SortBy") ? document.getElementById(p + "SortBy").value : "";
    var sortOrder = document.getElementById(p + "SortOrder") ? document.getElementById(p + "SortOrder").value : "";
    var out = {};
    if (categoryId) out.categoryId = Number(categoryId);
    if (bookId) out.bookId = Number(bookId);
    if (status) out.status = status;
    if (from) out.from = from;
    if (to) out.to = to;
    if (sortBy) out.sortBy = sortBy;
    if (sortOrder) out.sortOrder = sortOrder;
    return out;
  }

  async function loadReportCategories() {
    try {
      var rows = await reportFetchJson("/api/catalog/categories");
      return { list: Array.isArray(rows) ? rows : [], seed: false };
    } catch (e) {
      return { list: REPORT_SEED_CATS.slice(), seed: true };
    }
  }

  async function loadReportBooks(categoryId) {
    try {
      return { list: await api().reportBookOptions(categoryId), seed: false };
    } catch (e) {
      var cid = categoryId ? Number(categoryId) : 0;
      var list = REPORT_SEED_BOOKS.filter(function (b) { return !cid || b.categoryId === cid; });
      return { list: list, seed: true };
    }
  }

  function fillCategorySelect(sel, rows) {
    if (!sel) return;
    sel.innerHTML = '<option value="">全部分类</option>' + rows.map(function (c) {
      return '<option value="' + esc(c.categoryId) + '">' + esc(c.categoryName) + "</option>";
    }).join("");
  }

  function fillBookSelect(sel, rows) {
    if (!sel) return;
    sel.innerHTML = '<option value="">全部图书</option>' + rows.map(function (b) {
      return '<option value="' + esc(b.bookId) + '">' + esc(b.title) + "</option>";
    }).join("");
  }

  function reportFilterToolbar(prefix, withStatus, withSort) {
    var p = prefix || "rq";
    var statusBlock = withStatus
      ? '<label class="field"><span>借阅状态</span><select class="select" id="' + p + 'Status">' +
        '<option value="">全部</option><option value="BORROWED">BORROWED</option><option value="RETURNED">RETURNED</option></select></label>'
      : "";
    var sortBlock = withSort
      ? '<label class="field"><span>排序字段</span><select class="select" id="' + p + 'SortBy">' +
        '<option value="">默认</option>' +
        '<option value="categoryName">categoryName</option>' +
        '<option value="title">title</option>' +
        '<option value="readerName">readerName</option>' +
        '<option value="borrowedAt">borrowedAt</option>' +
        '<option value="status">status</option></select></label>' +
        '<label class="field"><span>方向</span><select class="select" id="' + p + 'SortOrder">' +
        '<option value="desc" selected>降序 desc</option><option value="asc">升序 asc</option></select></label>'
      : "";
    return [
      '<div class="toolbar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">',
      '<label class="field"><span>分类</span><select class="select" disabled id="' + p + 'Category"><option value="">全部分类</option></select></label>',
      '<label class="field"><span>图书</span><select class="select" disabled id="' + p + 'Book"><option value="">全部图书</option></select></label>',
      statusBlock,
      '<label class="field"><span>开始时间</span><input class="input" type="datetime-local" id="' + p + 'From"></label>',
      '<label class="field"><span>结束时间</span><input class="input" type="datetime-local" id="' + p + 'To"></label>',
      sortBlock,
      "</div>"
    ].join("");
  }

  async function wireReportFilters(prefix, onCategoryChange) {
    var p = prefix || "rq";
    var catSel = document.getElementById(p + "Category");
    var bookSel = document.getElementById(p + "Book");
    var cats = await loadReportCategories();
    fillCategorySelect(catSel, cats.list);
    var books = await loadReportBooks(catSel ? catSel.value : "");
    fillBookSelect(bookSel, books.list);
    if (bookSel) bookSel.disabled = false;
    if (cats.seed || books.seed) {
      var hint = document.getElementById(p + "SeedHint");
      if (hint) hint.hidden = false;
    }
    if (catSel) {
      catSel.disabled = false;
      catSel.onchange = async function () {
        var selected = catSel.value;
        fillBookSelect(bookSel, []);
        if (bookSel) bookSel.disabled = true;
        var b = await loadReportBooks(selected);
        if (selected !== catSel.value) return;
        fillBookSelect(bookSel, b.list);
        if (bookSel) bookSel.disabled = false;
        var hint2 = document.getElementById(p + "SeedHint");
        if (hint2) hint2.hidden = !(cats.seed || b.seed);
        if (onCategoryChange) onCategoryChange();
      };
    }
  }

  function reportResultStatusBadge(st) {
    var s = String(st || "").toUpperCase();
    if (s === "RETURNED") return C.badge("RETURNED", "green");
    if (s === "BORROWED") return C.badge("BORROWED", "blue");
    return esc(st);
  }

  C.registry["report-query"] = async function () {
    C.setActions("");
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>报表查询</h2>',
      "<p>候选项来自书目服务，结果来自报表投影，两边可能短暂不一致。</p></div></div>",
      '  <p id="rqSeedHint" class="hint" hidden>临时数据</p>',
      reportFilterToolbar("rq", true, true),
      '  <div class="toolbar" style="margin-top:8px"><button class="btn btn-primary btn-sm" type="button" id="rqSearch">查询</button></div>',
      '  <div id="rqTable" style="margin-top:14px"></div>',
      '  <div class="divider"></div>',
      '  <label class="field" style="margin-top:12px"><span>sqlTemplate（只读）</span>',
      '    <textarea class="input" id="rqSql" rows="4" readonly></textarea></label>',
      '  <label class="field"><span>parameters（只读）</span>',
      '    <textarea class="input" id="rqParams" rows="3" readonly></textarea></label>',
      "</div>"
    ].join("");

    await wireReportFilters("rq");

    var searchBtn = document.getElementById("rqSearch");
    if (searchBtn) {
      searchBtn.onclick = async function () {
        var filters = buildReportFilters("rq");
        var wrap = document.getElementById("rqTable");
        if (wrap) wrap.innerHTML = '<p class="hint">查询中…</p>';
        var res = await api().reportQuery(filters);
        if (!res.ok) {
          if (wrap) wrap.innerHTML = '<div class="empty-panel"><h3>查询失败</h3><p>' + esc(res.message) + "</p></div>";
          return;
        }
        var data = res.data || {};
        var rows = data.rows || [];
        var cols = [
          { key: "categoryName", label: "分类" },
          { key: "title", label: "书名" },
          { key: "readerName", label: "读者" },
          { key: "borrowedAt", label: "借阅时间", render: function (r) { return '<span class="nowrap small">' + esc(r.borrowedAt) + "</span>"; } },
          { key: "status", label: "状态", render: function (r) { return reportResultStatusBadge(r.status); } }
        ];
        if (wrap) wrap.innerHTML = C.tableHtml(cols, rows, "没有符合条件的借阅记录");
        var sqlEl = document.getElementById("rqSql");
        var parEl = document.getElementById("rqParams");
        if (sqlEl) sqlEl.value = data.sqlTemplate != null ? String(data.sqlTemplate) : "";
        if (parEl) parEl.value = data.parameters != null ? JSON.stringify(data.parameters, null, 2) : "";
      };
    }
  };

  C.registry["report-stats"] = async function () {
    C.setActions("");
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>借阅统计</h2>',
      "<p>按分类汇总 loanCount 与 openCount，数据来自报表投影。</p></div></div>",
      '  <p id="rsSeedHint" class="hint" hidden>临时数据</p>',
      reportFilterToolbar("rs", false, false),
      '  <div class="toolbar" style="margin-top:8px"><button class="btn btn-primary btn-sm" type="button" id="rsLoad">刷新统计</button></div>',
      '  <div id="rsTable" style="margin-top:14px"></div>',
      '  <div id="rsSyncStatus" style="margin-top:14px"></div>',
      "</div>"
    ].join("");

    await wireReportFilters("rs");

    async function loadSyncStatus() {
      var wrap = document.getElementById("rsSyncStatus");
      if (!wrap) return;
      wrap.innerHTML = '<p class="hint">同步状态加载中…</p>';
      var lagHtml = "";
      try {
        var res = await fetch("/api/reports/sync", {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, reportAuthHeaders())
        });
        var body = null;
        try { body = await res.json(); } catch (e) { body = null; }
        if (!res.ok) {
          if (res.status === 401 && window.TataUI && window.TataUI.openLogin) window.TataUI.openLogin();
          wrap.innerHTML = '<div class="empty-panel"><h3>同步状态读取失败</h3><p>' + esc((body && body.message) || ("HTTP " + res.status)) + "</p></div>";
          return;
        }
        var data = reportUnwrap(body);
        var sources = (data && Array.isArray(data.sources)) ? data.sources : [];
        var rows = sources.map(function (s) {
          var name = s && s.sourceName ? s.sourceName : "—";
          var status = (name === "iam" || name === "catalog")
            ? "接口未提供"
            : ((s && s.status) || "—");
          var lastOk = (s && s.lastSuccessAt) || "—";
          var err = (s && s.lastError) || "—";
          if (name === "loan" && ((s && s.status === "ERROR") || (s && s.lastError))) {
            lagHtml = '<p class="hint" style="margin-top:8px">统计可能滞后</p>';
          }
          return { sourceName: name, status: status, lastSuccessAt: lastOk, lastError: err };
        });
        var cols = [
          { key: "sourceName", label: "来源" },
          { key: "status", label: "状态" },
          { key: "lastSuccessAt", label: "上次成功" },
          { key: "lastError", label: "最近错误" }
        ];
        wrap.innerHTML = '<h3 style="margin:0 0 8px;font-size:14px">投影同步状态</h3>'
          + C.tableHtml(cols, rows, "暂无同步状态")
          + lagHtml;
      } catch (e) {
        wrap.innerHTML = '<div class="empty-panel"><h3>同步状态读取失败</h3><p>' + esc(e.message) + "</p></div>";
      }
    }

    async function loadStats() {
      var f = buildReportFilters("rs");
      delete f.status;
      delete f.sortBy;
      delete f.sortOrder;
      var wrap = document.getElementById("rsTable");
      if (wrap) wrap.innerHTML = '<p class="hint">加载中…</p>';
      var res = await api().reportStats(f);
      if (!res.ok) {
        if (wrap) wrap.innerHTML = '<div class="empty-panel"><h3>读取失败</h3><p>' + esc(res.message) + "</p></div>";
        return;
      }
      var rows = (res.data && Array.isArray(res.data.categories)) ? res.data.categories : [];
      var cols = [
        { key: "categoryName", label: "分类", render: function (r) { return esc(r.categoryName || r.category || "—"); } },
        { key: "loanCount", label: "借阅次数", cls: "num" },
        { key: "openCount", label: "未归还次数", cls: "num" }
      ];
      if (wrap) wrap.innerHTML = C.tableHtml(cols, rows, "暂无统计数据");
    }

    var btn = document.getElementById("rsLoad");
    if (!btn) return;
    async function refresh() {
      btn.disabled = true;
      try {
        await loadSyncStatus();
        if (btn.isConnected) await loadStats();
      } finally {
        btn.disabled = false;
      }
    }
    btn.onclick = refresh;
    await refresh();
  };

  C.registry["report-export"] = async function () {
    C.setActions("");
    C.body().innerHTML = [
      '<div class="panel"><div class="panel-head"><div><h2>统计导出</h2>',
      "<p>导出的行与报表查询的可见行一致。</p></div></div>",
      '  <p id="reSeedHint" class="hint" hidden>临时数据</p>',
      reportFilterToolbar("re", true, true),
      '  <div class="toolbar" style="margin-top:8px">',
      '    <button class="btn btn-primary btn-sm" type="button" id="reDownload">下载 CSV</button>',
      "  </div>",
      '  <p class="hint" style="margin-top:12px">使用与「报表查询」相同的筛选条件；文件名将保存为 report.csv。</p>',
      "</div>"
    ].join("");

    await wireReportFilters("re");

    var dl = document.getElementById("reDownload");
    if (dl) {
      dl.onclick = async function () {
        var filters = buildReportFilters("re");
        dl.disabled = true;
        var res = await api().reportExport(filters);
        dl.disabled = false;
        if (!res.ok) C.toast(res.message || "导出失败", "error");
        else C.toast("已开始下载 report.csv", "success");
      };
    }
  };
})();
