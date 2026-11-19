(function () {
  "use strict";

  var C = window.TataCore;
  var esc = C.esc;

  function renderAudit() {
    C.setActions([
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="exportaudit">' + C.icon("download") + "导出日志</button>"
    ].join(""));
    var filter = C.state.auditFilter;
    C.body().innerHTML = [
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>审计事件</h2><p>应用与数据库都向 audit_logs 追加记录；触发器事件标记为 trigger</p></div><span class="pill">' + window.TataDB.auditLogs({ limit: 300 }).length + " 条</span></div>",
      '  <div class="toolbar">',
      '    <div class="segmented" id="auditLevel">',
      ["all|全部", "info|信息", "success|成功", "warn|警告", "error|错误", "trigger|触发器"].map(function (item) {
        var pair = item.split("|");
        return '<button type="button" data-level="' + pair[0] + '" class="' + (filter.level === pair[0] ? "is-active" : "") + '">' + pair[1] + "</button>";
      }).join(""),
      "    </div>",
      '    <input class="input search" id="auditSearch" type="search" placeholder="搜索操作 / 操作者 / 详情" value="' + esc(filter.q) + '">',
      "  </div>",
      '  <div id="auditTableWrap"></div>',
      "</div>"
    ].join("");
    updateAuditTable();
    document.getElementById("auditLevel").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-level]");
      if (!button) return;
      filter.level = button.getAttribute("data-level");
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (b) {
        b.classList.toggle("is-active", b === button);
      });
      updateAuditTable();
    });
    document.getElementById("auditSearch").addEventListener("input", function () {
      filter.q = this.value;
      updateAuditTable();
    });
  }

  function updateAuditTable() {
    var wrap = document.getElementById("auditTableWrap");
    if (!wrap) return;
    var filter = C.state.auditFilter;
    var logs = window.TataDB.auditLogs({ level: filter.level, query: filter.q, limit: 200 });
    var cols = [
      { key: "ts", label: "时间", render: function (r) { return '<span class="nowrap small">' + C.fmtDateTime(r.ts) + "</span>"; } },
      { key: "action", label: "操作", render: function (r) { return '<span class="mono small">' + esc(r.action) + "</span>"; } },
      { key: "level", label: "级别", render: function (r) { return C.levelBadge(r.level); } },
      { key: "actor", label: "操作者", render: function (r) { return '<span class="mono small">' + esc(r.actor) + "</span>"; } },
      { key: "node", label: "节点", render: function (r) { return '<span class="mono small">' + esc(r.node || "-") + "</span>"; } },
      { key: "detail", label: "详情", render: function (r) { return '<span class="small">' + esc(r.detail) + "</span>"; } }
    ];
    wrap.innerHTML = C.tableHtml(cols, logs, "没有审计记录");
  }

  C.registry.audit = renderAudit;
  C.handlers.exportaudit = function () {
    var logs = window.TataDB.auditLogs({ level: C.state.auditFilter.level, query: C.state.auditFilter.q, limit: 300 });
    var cols = [
      { key: "ts", label: "时间" }, { key: "action", label: "操作" }, { key: "level", label: "级别" },
      { key: "actor", label: "操作者" }, { key: "node", label: "节点" }, { key: "detail", label: "详情" }
    ];
    window.TataUI.download("bit-audit-log.csv", window.TataDB.toCSV(cols, logs), "text/csv;charset=utf-8");
  };
})();
