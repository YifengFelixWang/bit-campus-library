(function () {
  "use strict";

  var C = window.TataCore;
  var esc = C.esc;

  function renderLab() {
    C.setActions([
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="refreshlab">' + C.icon("refresh") + "重置实验台</button>"
    ].join(""));

    var lab = C.state.labState;
    var categories = ["全部"].concat(window.TataDB.categories().map(function (c) { return c.name; }));
    var procs = window.TataDB.procDefs();
    var triggers = window.TataDB.triggerDefs();
    var recentTrigger = window.TataDB.auditLogs({ limit: 80 }).filter(function (l) {
      return l.level === "trigger" || l.action.indexOf("TRG_") === 0;
    }).slice(0, 6);

    var scenarios = [
      ["hot", "多表联查 · 热门排行"],
      ["detail", "多表联查 · 借阅明细"],
      ["summary", "多表联查 · 读者汇总"],
      ["stock", "多表联查 · 库存预警"]
    ];

    C.body().innerHTML = [
      '<div class="grid-2">',
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>场景化查询构建器</h2><p>选择场景与参数，前端组装参数化 SQL；点击执行查看结果</p></div></div>',
      '    <div class="toolbar">',
      '      <select class="select" id="labScenario">',
      scenarios.map(function (s) { return '<option value="' + s[0] + '"' + (lab.scenario === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join(""),
      "      </select>",
      '      <span class="spacer"></span>',
      '      <button class="btn btn-ghost btn-sm" type="button" data-act="lab-sql">' + C.icon("db") + "重新生成 SQL</button>",
      '      <button class="btn btn-primary btn-sm" type="button" data-act="lab-run">' + C.icon("play") + "执行查询</button>",
      "    </div>",
      '    <div id="labControls" class="form-row three"></div>',
      '    <div class="divider"></div>',
      '    <div class="panel-head" style="margin-bottom:8px"><div><h3 style="font-size:14px">生成的 SQL（命名参数）</h3></div><span class="badge blue">Prepared Statement</span></div>',
      '    <pre class="code-block" id="labSql"></pre>',
      '    <div class="sql-meta" id="labParams"></div>',
      '    <div id="labResults"><div class="empty-panel">' + C.icon("play") + "<h3>尚未执行</h3><p>选择参数后点击「执行查询」。</p></div></div>",
      "  </div>",
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>存储过程调用</h2><p>选择过程并填写参数，前端通过 tata_app 账户调用</p></div></div>',
      '    <div class="form-row">',
      '      <label class="field"><span>存储过程</span><select id="procSelect">',
      procs.map(function (p) { return '<option value="' + p.name + '"' + (lab.proc === p.name ? " selected" : "") + ">" + p.name + "</option>"; }).join(""),
      "      </select></label>",
      '      <div class="field"><span>调用账户</span><div class="input mono" style="background:var(--paper)">tata_app</div></div>',
      "    </div>",
      '    <div id="procArgs" class="form-row" style="margin-top:12px"></div>',
      '    <div class="toolbar" style="margin-top:12px"><button class="btn btn-primary btn-sm" type="button" data-act="proc-call">' + C.icon("play") + '调用存储过程</button><span class="hint" id="procDesc"></span></div>',
      '    <div id="procResult"></div>',
      "  </div>",
      "</div>",
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>触发器与对象定义</h2><p>借阅/归还的库存维护、重复借阅校验与审计留痕均由数据库触发器保证</p></div><span class="badge trigger">GaussDB / openGauss</span></div>',
      '  <div class="grid-2">',
      triggers.map(function (t) {
        return '<details class="panel panel-soft" style="margin-top:0"><summary style="cursor:pointer"><strong>' + esc(t.name) + '</strong> <span class="badge amber">' + esc(t.event) + '</span><div class="hint" style="margin-top:4px">' + esc(t.desc) + '</div></summary><pre class="code-block small" style="margin-top:10px">' + esc(t.sql) + "</pre></details>";
      }).join(""),
      "  </div>",
      '  <div class="divider"></div>',
      '  <h3 style="font-size:14px;margin-bottom:8px">最近触发器日志</h3>',
      C.tableHtml([
        { key: "ts", label: "时间", render: function (r) { return '<span class="nowrap small">' + C.fmtDateTime(r.ts) + "</span>"; } },
        { key: "action", label: "触发器 / 动作", render: function (r) { return '<span class="mono small">' + esc(r.action) + "</span>"; } },
        { key: "detail", label: "详情" },
        { key: "node", label: "节点" }
      ], recentTrigger, "暂无触发器日志"),
      "</div>",
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>存储过程定义</h2><p>与前端调用逻辑一一对应，可复制到 GaussDB 执行</p></div></div>',
      '  <div class="grid-2">',
      procs.map(function (p) {
        return '<details class="panel panel-soft" style="margin-top:0"><summary style="cursor:pointer"><strong class="mono small">' + esc(p.name) + '</strong><div class="hint" style="margin-top:4px">' + esc(p.params) + " · " + esc(p.desc) + '</div></summary><pre class="code-block small" style="margin-top:10px">' + esc(p.sql) + "</pre></details>";
      }).join(""),
      "  </div>",
      "</div>",
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>参数化与防注入说明</h2><p>界面上的筛选值不会拼接进 SQL 文本，而是作为绑定变量传入</p></div></div>',
      '  <div class="hint">前端展示的 <span class="code-inline">:category</span>、<span class="code-inline">:limit</span> 等为命名参数。真实后端使用 <span class="code-inline">PreparedStatement</span> 或 <span class="code-inline">EXECUTE ... USING</span> 绑定，避免 SQL 注入；同时对用户输入做长度与类型校验。</div>',
      "</div>"
    ].join("");

    document.getElementById("labScenario").addEventListener("change", function () {
      lab.scenario = this.value;
      renderLab();
    });
    document.getElementById("procSelect").addEventListener("change", function () {
      lab.proc = this.value;
      renderProcArgs();
    });

    renderLabControls(categories);
    updateLabSql();
    renderProcArgs();

    C.body().onclick = function (event) {
      var button = event.target.closest("button[data-act]");
      if (!button || C.state.currentTab !== "dblab") return;
      var act = button.getAttribute("data-act");
      if (act === "lab-run") runLabQuery();
      else if (act === "lab-sql") updateLabSql();
      else if (act === "proc-call") callLabProc();
    };
  }

  function renderLabControls(categories) {
    var lab = C.state.labState;
    var controls = document.getElementById("labControls");
    if (!controls) return;
    if (lab.scenario === "hot") {
      controls.innerHTML =
        '<label class="field"><span>分类</span><select id="labCategory">' +
        categories.map(function (c) { return '<option value="' + esc(c) + '"' + (lab.params.category === c ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") +
        '</select></label><label class="field"><span>返回条数</span><input id="labLimit" type="number" min="1" max="50" value="' + lab.params.limit + '"></label><div class="field"><span>说明</span><div class="hint">books ⋈ categories ⟕ borrows</div></div>';
    } else if (lab.scenario === "detail") {
      controls.innerHTML =
        '<label class="field"><span>借阅状态</span><select id="labStatus">' +
        ["all|全部", "borrowing|借阅中", "overdue|已逾期", "returned|已归还"].map(function (item) {
          var pair = item.split("|");
          return '<option value="' + pair[0] + '"' + (lab.params.status === pair[0] ? " selected" : "") + ">" + pair[1] + "</option>";
        }).join("") +
        '</select></label><label class="field"><span>关键词</span><input id="labQuery" value="' + esc(lab.params.query) + '" placeholder="读者姓名或书名"></label><div class="field"><span>说明</span><div class="hint">users ⋈ borrows ⋈ books</div></div>';
    } else if (lab.scenario === "summary") {
      controls.innerHTML =
        '<label class="field"><span>角色</span><select id="labRole">' +
        ["all|全部", "reader|读者", "librarian|图书管理员", "admin|超级管理员"].map(function (item) {
          var pair = item.split("|");
          return '<option value="' + pair[0] + '"' + (lab.params.role === pair[0] ? " selected" : "") + ">" + pair[1] + "</option>";
        }).join("") +
        '</select></label><div class="field"><span>聚合</span><div class="hint">COUNT / FILTER / LEFT JOIN</div></div><div class="field"><span>说明</span><div class="hint">users ⟕ borrows</div></div>';
    } else {
      controls.innerHTML =
        '<label class="field"><span>库存阈值</span><input id="labThreshold" type="number" min="0" max="20" value="' + lab.params.threshold + '"></label><div class="field"><span>排序</span><div class="hint">available ASC</div></div><div class="field"><span>说明</span><div class="hint">books ⋈ categories</div></div>';
    }
    function sync() {
      readLabControls();
      updateLabSql();
    }
    controls.addEventListener("change", sync);
    controls.addEventListener("input", sync);
  }

  function readLabControls() {
    var p = C.state.labState.params;
    var el;
    if ((el = document.getElementById("labCategory"))) p.category = el.value;
    if ((el = document.getElementById("labLimit"))) p.limit = Math.max(1, Math.min(50, Number(el.value) || 8));
    if ((el = document.getElementById("labStatus"))) p.status = el.value;
    if ((el = document.getElementById("labQuery"))) p.query = el.value;
    if ((el = document.getElementById("labRole"))) p.role = el.value;
    if ((el = document.getElementById("labThreshold"))) p.threshold = Math.max(0, Number(el.value) || 0);
  }

  function updateLabSql() {
    var lab = C.state.labState;
    var result = window.TataDB.runQuery(lab.scenario, lab.params);
    var sqlEl = document.getElementById("labSql");
    if (!sqlEl) return;
    sqlEl.textContent = result.sql;
    document.getElementById("labParams").innerHTML = result.params.map(function (p) {
      return '<span class="param">:' + esc(p.name) + " = " + esc(p.value) + "</span>";
    }).join("");
  }

  function runLabQuery() {
    readLabControls();
    var lab = C.state.labState;
    var result = window.TataDB.runQuery(lab.scenario, lab.params);
    var wrap = document.getElementById("labResults");
    wrap.innerHTML = [
      '<div class="panel-head" style="margin:16px 0 8px"><div><h3 style="font-size:14px">' + esc(result.title) + '</h3><p>' + result.rows.length + " 行 · " + result.elapsed + " ms · " + esc(result.plan) + '</p></div><span class="badge green">执行成功</span></div>',
      C.tableHtml(result.columns, result.rows, "查询无结果"),
      '<details class="hint" style="margin-top:10px"><summary style="cursor:pointer">查看模拟执行计划</summary><pre class="code-block small" style="margin-top:8px">' + esc("QUERY PLAN\n" + result.plan + "\n  -> Rows: " + result.rows.length + "  Width: 128  Cost: 0.00.." + (12 + result.rows.length) + ".00") + "</pre></details>"
    ].join("");
    updateLabSql();
    C.toast("查询完成，返回 " + result.rows.length + " 行");
  }

  function renderProcArgs() {
    var wrap = document.getElementById("procArgs");
    if (!wrap) return;
    var lab = C.state.labState;
    var users = window.TataDB.users().filter(function (u) { return u.status === "active"; });
    var books = window.TataDB.books().filter(function (b) { return b.available > 0; });
    var borrows = window.TataDB.listBorrows({ status: "active" });
    var proc = window.TataDB.procDefs().filter(function (p) { return p.name === lab.proc; })[0];
    var desc = document.getElementById("procDesc");
    if (desc && proc) desc.textContent = proc.desc;
    if (lab.proc === "sp_borrow_book") {
      wrap.innerHTML =
        '<label class="field"><span>读者</span><select id="procUser">' + users.filter(function (u) { return u.role === "reader"; }).map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name) + " · " + esc(u.username) + "</option>"; }).join("") + "</select></label>" +
        '<label class="field"><span>图书</span><select id="procBook">' + books.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.title) + " · 可借 " + b.available + "</option>"; }).join("") + "</select></label>";
    } else if (lab.proc === "sp_return_book") {
      if (!borrows.length) wrap.innerHTML = '<div class="hint">当前没有在借记录。</div>';
      else wrap.innerHTML = '<label class="field"><span>在借记录</span><select id="procBorrow">' + borrows.map(function (r) { return '<option value="' + esc(r.borrow_id) + '">' + esc(r.borrow_id) + " · " + esc(r.user_name) + " · " + esc(r.book_title) + "</option>"; }).join("") + "</select></label>";
    } else if (lab.proc === "sp_user_summary") {
      wrap.innerHTML = '<label class="field"><span>读者</span><select id="procUser">' + users.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name) + " · " + esc(u.username) + "</option>"; }).join("") + "</select></label>";
    } else if (lab.proc === "sp_hot_books") {
      wrap.innerHTML = '<label class="field"><span>返回条数</span><input id="procLimit" type="number" min="1" max="20" value="5"></label>';
    } else {
      wrap.innerHTML = '<div class="hint">该过程不需要参数，将扫描全部到期未还记录。</div>';
    }
  }

  function callLabProc() {
    var lab = C.state.labState;
    var args = {};
    var userEl = document.getElementById("procUser");
    var bookEl = document.getElementById("procBook");
    var borrowEl = document.getElementById("procBorrow");
    var limitEl = document.getElementById("procLimit");
    if (userEl) args.userId = userEl.value;
    if (bookEl) args.bookId = bookEl.value;
    if (borrowEl) args.borrowId = borrowEl.value;
    if (limitEl) args.limit = Number(limitEl.value) || 5;
    var proc = window.TataDB.procDefs().filter(function (p) { return p.name === lab.proc; })[0];
    var result = window.TataDB.callProcedure(lab.proc, args);
    var wrap = document.getElementById("procResult");
    wrap.innerHTML = [
      '<div class="divider"></div>',
      '<div class="panel-head" style="margin-bottom:8px"><div><h3 style="font-size:14px">调用结果</h3><p>' + esc(result.message) + '</p></div><span class="badge ' + (result.ok ? "green" : "red") + '">' + (result.ok ? "成功" : "失败") + "</span></div>",
      '<pre class="code-block small">' + esc(result.sql) + "</pre>",
      result.rows && result.rows.length ? C.tableHtml(result.columns, result.rows, "无返回行") : "",
      proc ? '<div class="hint" style="margin-top:8px">过程定义：' + esc(proc.desc) + "</div>" : ""
    ].join("");
    C.toast(result.message, result.ok ? "success" : "error");
    window.TataUI.refreshAll();
    renderProcArgs();
  }

  C.registry.dblab = renderLab;
  C.handlers.refreshlab = function () {
    C.state.labState = {
      scenario: "hot",
      params: { category: "全部", limit: 8, status: "all", query: "", role: "all", threshold: 2 },
      proc: "sp_hot_books"
    };
    renderLab();
  };
})();
