(function () {
  "use strict";

  var TABS = {
    overview: { title: "运营概览", sub: "查看业务指标、业务流程与最近审计事件", eyebrow: "DASHBOARD", perm: "borrow:read" },
    books: { title: "图书管理", sub: "维护馆藏、上架状态与库存；超级管理员和图书管理员均可上架 / 下架，评分来自读者评价", eyebrow: "BOOKS", perm: "book:read" },
    borrows: { title: "借阅管理", sub: "三表联查展示借阅明细，归还操作调用存储过程并触发库存恢复", eyebrow: "BORROWS", perm: "borrow:read" },
    reviews: { title: "读者评价", sub: "查看、编辑或删除读者归还后提交的星级与文字评价，图书得分 = 平均星级 × 2", eyebrow: "REVIEWS", perm: "review:manage" },
    announcements: { title: "公告管理", sub: "超级管理员和图书管理员可发布与修改公告；访客与读者只能查看已发布公告", eyebrow: "ANNOUNCEMENTS", perm: "announcement:write" },
    users: { title: "用户与权限", sub: "超级管理员可管理全部用户；图书管理员只能编辑本人与读者，并批量注册读者账号；账号不可修改", eyebrow: "USERS & RBAC", perm: "user:read" },
    dblab: { title: "数据库实验台", sub: "场景化组装参数化 SQL、执行多表联查、调用存储过程与查看触发器", eyebrow: "SQL LAB", perm: "db:query" },
    data: { title: "数据导入导出", sub: "在浏览器本地完成 CSV / JSON 的上传、预览、导入与下载", eyebrow: "DATA I/O", perm: "data:export" },
    backup: { title: "备份与恢复", sub: "应用界面发起服务器端快照，也可下载或上传备份文件", eyebrow: "BACKUP", perm: "backup:manage" },
    servers: { title: "主备服务器", sub: "图形化展示 GaussDB 主备拓扑、心跳、复制延迟与自动故障转移", eyebrow: "HIGH AVAILABILITY", perm: "server:manage" },
    audit: { title: "审计日志", sub: "记录登录、借阅、触发器、备份与主备切换等关键事件", eyebrow: "AUDIT", perm: "audit:read" }
  };

  var C = {
    state: {
      currentTab: "overview",
      bookFilter: { q: "", cat: "全部", shelf: "all" },
      borrowFilter: { status: "all", q: "" },
      auditFilter: { level: "all", q: "" },
      labState: {
        scenario: "hot",
        params: { category: "全部", limit: 8, status: "all", query: "", role: "all", threshold: 2 },
        proc: "sp_hot_books"
      },
      importState: null
    },
    tabs: TABS,
    registry: {},
    enter: {},
    onchange: {},
    handlers: {},
    timers: { flow: null, cluster: null }
  };

  function esc(value) {
    return window.TataUI.esc(value);
  }

  C.esc = esc;
  C.icon = function (name, cls) { return window.TataUI.icon(name, cls); };
  C.toast = function (message, tone) { window.TataUI.toast(message, tone); };
  C.fmtDate = function (value) { return window.TataUI.fmtDate(value); };
  C.fmtDateTime = function (value) { return window.TataUI.fmtDateTime(value); };
  C.fmtBytes = function (value) { return window.TataUI.fmtBytes(value); };
  C.roleName = function (code) { return window.TataUI.roleName(code); };
  // 当前用户以真实数据层为准（旧 TataDB 里的用户表已废弃，会显示成"访客"）
  C.currentUser = function () {
    if (window.__TATA_API__ && typeof window.__TATA_API__.currentUser === "function") {
      var u = window.__TATA_API__.currentUser();
      if (u) return { name: u.name || u.username, role: u.role };
    }
    return window.TataDB.currentUser();
  };
  // 权限判断优先走真实数据层（api.can 基于登录角色）；
  // 旧版 TataDB 只作为兜底。控制台渲染的数据本身仍是演示数据。
  C.can = function (permission) {
    if (window.__TATA_API__ && typeof window.__TATA_API__.can === "function") {
      try { return window.__TATA_API__.can(permission); } catch (e) { /* 降级 */ }
    }
    return window.TataDB.can(permission);
  };
  C.body = function () { return document.getElementById("consoleBody"); };

  C.badge = function (text, tone) {
    return '<span class="badge ' + (tone || "gray") + '">' + esc(text) + "</span>";
  };

  C.shelfLabel = function (status) {
    if (status === "on_shelf") return "已上架";
    if (status === "warehouse") return "仓库待上架";
    if (status === "off_shelf") return "已下架";
    return "状态未知";
  };

  C.shelfBadge = function (status) {
    var tone = status === "on_shelf" ? "green" : (status === "warehouse" ? "amber" : "red");
    return C.badge(C.shelfLabel(status), tone);
  };

  C.emptyPanel = function (title, sub) {
    return '<div class="empty-panel">' + C.icon("db") + "<h3>" + esc(title) + "</h3><p>" + esc(sub || "") + "</p></div>";
  };

  C.tableHtml = function (columns, rows, emptyTitle) {
    if (!rows.length) return C.emptyPanel(emptyTitle || "暂无数据", "当前筛选条件下没有记录。");
    return [
      '<div class="table-wrap"><table class="data-table"><thead><tr>',
      columns.map(function (c) {
        return "<th" + (c.cls ? ' class="' + c.cls + '"' : "") + ">" +
          (c.labelHtml != null ? c.labelHtml : esc(c.label)) + "</th>";
      }).join(""),
      "</tr></thead><tbody>",
      rows.map(function (row) {
        return "<tr>" + columns.map(function (c) {
          var value = c.render ? c.render(row) : esc(row[c.key]);
          return "<td" + (c.cls ? ' class="' + c.cls + '"' : "") + ">" + (value === undefined || value === null ? "" : value) + "</td>";
        }).join("") + "</tr>";
      }).join(""),
      "</tbody></table></div>"
    ].join("");
  };

  C.thumbHtml = function (book) {
    var url = window.TataDB.coverUrl(book);
    if (url) return '<img class="thumb" src="' + esc(url) + '" alt="' + esc(book.title) + '">';
    return '<span class="thumb-fallback">' + esc(book.title.charAt(0)) + "</span>";
  };

  C.borrowStatusBadge = function (row) {
    if (row.status === "returned") return C.badge("已归还", "gray");
    if (row.status === "overdue") return C.badge("已逾期", "red");
    return C.badge("借阅中", "blue");
  };

  C.levelBadge = function (level) {
    var map = { info: "gray", success: "green", warn: "amber", error: "red", trigger: "trigger" };
    return C.badge(level, map[level] || "gray");
  };

  C.kpiHtml = function (label, value, foot, tone) {
    return '<div class="kpi ' + (tone || "") + '"><span class="kpi-label">' + esc(label) + '</span><strong class="kpi-value">' + esc(value) + '</strong><span class="kpi-foot">' + esc(foot) + "</span></div>";
  };

  C.setActions = function (html) {
    document.getElementById("consoleActions").innerHTML = html;
  };

  C.setTopbar = function (tab) {
    var meta = TABS[tab] || TABS.overview;
    var user = C.currentUser();
    var prefix = user && user.role === "admin" ? "SUPER ADMIN" : (user && user.role === "librarian" ? "LIBRARIAN" : "CONSOLE");
    document.getElementById("consoleTitle").textContent = meta.title;
    var sub = document.getElementById("consoleSub");
    if (sub) {
      sub.textContent = meta.sub;
      sub.title = meta.sub;
    }
    document.getElementById("consoleEyebrow").textContent = prefix + " · " + meta.eyebrow;
  };

  C.updateSidebar = function () {
    var user = C.currentUser();
    var links = document.querySelectorAll("#consoleNavList .side-link");
    Array.prototype.forEach.call(links, function (link) {
      link.hidden = !C.can(link.getAttribute("data-perm"));
      link.classList.toggle("is-active", link.getAttribute("data-tab") === C.state.currentTab);
    });
    var sideUser = document.getElementById("consoleSideUser");
    if (sideUser) sideUser.textContent = user ? user.name + " · " + C.roleName(user.role) : "未登录（访客）";
    var roleEl = document.getElementById("consoleRole");
    if (roleEl) {
      roleEl.textContent = user ? C.roleName(user.role) : "访客";
      roleEl.className = "console-role role-" + (user ? user.role : "guest");
    }
    // 侧栏节点状态不再由这里写：以前读的是本地演示层 window.TataDB.clusterSnapshot()，
    // 永远是「GaussDB 节点 A · 在线」，和真实服务器无关。
    // 现在由 ConsoleView 读 /api/catalog/ops/status 渲染，避免假数据被覆盖回来。
  };

  C.stopTimers = function () {
    Object.keys(C.timers).forEach(function (key) {
      if (C.timers[key]) {
        clearInterval(C.timers[key]);
        C.timers[key] = null;
      }
    });
  };

  C.startClusterHeartbeat = function () {
    if (C.timers.cluster) clearInterval(C.timers.cluster);
    C.timers.cluster = setInterval(function () {
      if (C.state.currentTab !== "servers") return;
      if (!document.getElementById("modal").hidden) return;
      window.TataDB.tickCluster();
    }, 6500);
  };

  C.mount = function (tab) {
    tab = TABS[tab] ? tab : "overview";
    var meta = TABS[tab];
    if (!C.can(meta.perm)) {
      tab = "overview";
      meta = TABS.overview;
      if (!C.can(meta.perm)) {
        C.toast("当前账号没有管理控制台权限", "warn");
        location.hash = "#home";
        return;
      }
      if (location.hash !== "#console/overview") history.replaceState(null, "", "#console/overview");
    }
    if (C.state.currentTab !== tab) C.stopTimers();
    C.state.currentTab = tab;
    C.setTopbar(tab);
    C.updateSidebar();
    var render = C.registry[tab] || C.registry.overview;
    if (render) render();
    if (C.enter[tab]) C.enter[tab]();
  };

  C.refresh = function () {
    C.mount(C.state.currentTab);
  };

  function renderOverview() {
    var stats = window.TataDB.stats();
    var cluster = window.TataDB.clusterSnapshot();
    var primary = cluster.nodes[cluster.primary];
    var standby = cluster.nodes[cluster.standby];
    var logs = window.TataDB.auditLogs({ limit: 7 });

    C.setActions([
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="refresh">' + C.icon("refresh") + "刷新指标</button>",
      '<button class="btn btn-primary btn-sm" type="button" data-hact="gotolab">' + C.icon("db") + "数据库实验台</button>"
    ].join(""));

    var flowSteps = [
      { title: "读者登录", desc: "校验 MD5 摘要" },
      { title: "检索图书", desc: "books ⋈ categories" },
      { title: "发起借阅", desc: "CALL sp_borrow_book" },
      { title: "触发器校验", desc: "库存 / 上限 / 重复" },
      { title: "主备同步", desc: "WAL 流式复制" },
      { title: "归还图书", desc: "CALL sp_return_book" },
      { title: "库存恢复", desc: "trg_after_return" },
      { title: "审计归档", desc: "audit_logs 留痕" }
    ];

    var auditCols = [
      { key: "ts", label: "时间", render: function (r) { return '<span class="nowrap">' + C.fmtDateTime(r.ts) + "</span>"; } },
      { key: "action", label: "操作", render: function (r) { return '<span class="mono small">' + esc(r.action) + "</span>"; } },
      { key: "level", label: "级别", render: function (r) { return C.levelBadge(r.level); } },
      { key: "actor", label: "操作者" },
      { key: "detail", label: "详情", render: function (r) { return '<span class="small">' + esc(r.detail) + "</span>"; } }
    ];

    C.body().innerHTML = [
      '<div class="grid-4">',
      C.kpiHtml("馆藏册数", stats.totalCopies, "可借 " + stats.availableCopies + " 册 · 利用率 " + stats.utilization + "%"),
      C.kpiHtml("当前在借", stats.activeBorrows, "今日新增 " + stats.todayBorrows + " 笔"),
      C.kpiHtml("注册读者", stats.readers, "应用用户共 " + window.TataDB.users().length + " 个"),
      C.kpiHtml("逾期记录", stats.overdue, stats.overdue ? "需要催还" : "当前无逾期", stats.overdue ? "warn" : ""),
      "</div>",
      '<div class="grid-2" style="margin-top:18px">',
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>业务流程演示</h2><p>点击运行，观察一次「借阅 → 归还」在应用与数据库之间的完整链路</p></div>',
      '      <button class="btn btn-primary btn-sm" type="button" id="runFlow">' + C.icon("play") + "运行业务流程</button></div>",
      '    <div class="flow" id="flowSteps">',
      flowSteps.map(function (s, i) {
        return (i ? '<span class="flow-arrow">→</span>' : "") +
          '<div class="flow-step" data-step="' + i + '"><span class="flow-num">STEP ' + String(i + 1).padStart(2, "0") + "</span><b>" + esc(s.title) + "</b><small>" + esc(s.desc) + "</small></div>";
      }).join(""),
      "    </div>",
      '    <div class="flow-status" id="flowStatus">等待运行…</div>',
      "  </div>",
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>系统运行状态</h2><p>主备集群、应用连接与数据库账户</p></div><span class="badge green">运行中</span></div>',
      '    <div class="timeline">',
      '      <div class="timeline-item success"><strong>主节点 ' + esc(primary ? primary.id.replace("node-", "").toUpperCase() : "-") + " · " + esc(primary ? primary.host : "") + ":" + (primary ? primary.port : "") + "</strong><span>延迟 " + (primary ? primary.latency : "-") + " ms · 连接 " + (primary ? primary.connections : "-") + " · CPU " + (primary ? primary.cpu : "-") + "%</span></div>",
      '      <div class="timeline-item ' + (standby && standby.status === "online" ? "success" : "error") + '"><strong>备节点 ' + esc(standby ? standby.id.replace("node-", "").toUpperCase() : "-") + " · " + esc(standby ? standby.host : "") + ":" + (standby ? standby.port : "") + "</strong><span>复制延迟 " + (standby ? standby.lag : "-") + " s · 自动故障转移" + (cluster.autoFailover ? "已开启" : "已关闭") + "</span></div>",
      '      <div class="timeline-item"><strong>应用连接账户 tata_app</strong><span>最小权限：SELECT / INSERT / UPDATE / DELETE / EXECUTE</span></div>',
      '      <div class="timeline-item"><strong>数据库账户 5 个 · 由 IAM 统一管理</strong><span>DBA / 应用 / 只读报表 / 备份 / 审计</span></div>',
      "    </div>",
      '    <div class="divider"></div>',
      '    <div class="hint">备份 <strong>' + stats.backupCount + "</strong> 份 · 审计 <strong>" + stats.auditCount + "</strong> 条 · 热门分类 <strong>" + esc(stats.topCategory) + "</strong></div>",
      "  </div>",
      "</div>",
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>最近审计事件</h2><p>触发器、存储过程、登录与运维操作都会写入 audit_logs</p></div><button class="btn btn-ghost btn-sm" type="button" data-hact="gotoaudit">查看全部</button></div>',
      C.tableHtml(auditCols, logs),
      "</div>"
    ].join("");

    document.getElementById("runFlow").addEventListener("click", runFlowDemo);
  }

  function runFlowDemo() {
    if (C.timers.flow) clearInterval(C.timers.flow);
    var steps = document.querySelectorAll("#flowSteps .flow-step");
    var status = document.getElementById("flowStatus");
    Array.prototype.forEach.call(steps, function (step) {
      step.classList.remove("is-active", "is-done");
    });
    var index = 0;
    var descriptions = [
      "读取 users 表并比对 MD5(密码) 与 password_md5 …",
      "执行 books ⋈ categories 多表联查，返回热门图书 …",
      "前端组装参数化 SQL，调用存储过程 sp_borrow_book …",
      "触发器 trg_validate_borrow 校验借阅上限与重复借阅 …",
      "事务提交后 WAL 流式复制到备节点，复制延迟 < 1s …",
      "归还时调用 sp_return_book 更新借阅状态 …",
      "触发器 trg_after_return 将 available + 1 并写入审计 …",
      "审计日志落库，主备同步完成，业务流程结束。"
    ];
    status.textContent = "开始执行 …";
    C.timers.flow = setInterval(function () {
      if (index > 0) {
        steps[index - 1].classList.remove("is-active");
        steps[index - 1].classList.add("is-done");
      }
      if (index >= steps.length) {
        clearInterval(C.timers.flow);
        C.timers.flow = null;
        status.textContent = "流程演示完成：8 个步骤全部通过，可在「审计日志」查看留痕。";
        C.toast("业务流程演示完成");
        return;
      }
      steps[index].classList.add("is-active");
      status.textContent = "STEP " + (index + 1) + " · " + descriptions[index];
      index += 1;
    }, 850);
  }

  C.registry.overview = renderOverview;

  C.handlers.refresh = function () { C.refresh(); };
  C.handlers.gotolab = function () { location.hash = "#console/dblab"; };
  C.handlers.gotoaudit = function () { location.hash = "#console/audit"; };

  window.TataCore = C;

  window.TataConsole = {
    mount: C.mount,
    refresh: C.refresh,
    onDataChange: function (type) {
      if (document.getElementById("consoleView").hidden) return;
      C.updateSidebar();
      if (type === "cluster" && C.state.currentTab === "servers" && document.getElementById("modal").hidden) {
        if (C.registry.servers) C.registry.servers();
        return;
      }
      var handler = C.onchange[C.state.currentTab];
      if (handler) handler(type);
    }
  };

  document.getElementById("consoleNavList").addEventListener("click", function (event) {
    var button = event.target.closest(".side-link");
    if (!button || button.hidden) return;
    location.hash = "#console/" + button.getAttribute("data-tab");
  });

  document.getElementById("consoleActions").addEventListener("click", function (event) {
    var button = event.target.closest("button[data-hact]");
    if (!button) return;
    var handler = C.handlers[button.getAttribute("data-hact")];
    if (handler) handler(button);
  });
})();
