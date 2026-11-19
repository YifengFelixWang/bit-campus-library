(function () {
  "use strict";

  var C = window.TataCore;
  var esc = C.esc;

  function renderData() {
    C.setActions([
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="exportsnapshot">' + C.icon("download") + "下载全量快照</button>"
    ].join(""));
    var counts = {
      books: window.TataDB.books().length,
      borrows: window.TataDB.borrows().length,
      users: window.TataDB.users().length
    };
    C.body().innerHTML = [
      '<div class="grid-2">',
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>导出数据</h2><p>使用 Blob + ObjectURL 在浏览器本地生成文件，不经过网络上传</p></div><span class="badge green">本地完成</span></div>',
      '    <div class="timeline">',
      '      <div class="timeline-item success"><strong>图书数据 CSV</strong><span>' + counts.books + ' 条 · 含 ISBN / 馆藏 / 可借 / 历史借阅</span><button class="link-btn primary" type="button" data-act="export-books" style="margin-top:6px">' + C.icon("download") + "下载 books.csv</button></div>",
      '      <div class="timeline-item success"><strong>借阅记录 CSV</strong><span>' + counts.borrows + ' 条 · 三表联查后的扁平结果</span><button class="link-btn primary" type="button" data-act="export-borrows" style="margin-top:6px">' + C.icon("download") + "下载 borrows.csv</button></div>",
      '      <div class="timeline-item success"><strong>用户数据 CSV</strong><span>' + counts.users + ' 条 · 密码列仅导出 MD5 摘要</span><button class="link-btn primary" type="button" data-act="export-users" style="margin-top:6px">' + C.icon("download") + "下载 users.csv</button></div>",
      '      <div class="timeline-item success"><strong>全量 JSON 快照</strong><span>包含图书、用户、借阅、审计、集群状态</span><button class="link-btn primary" type="button" data-act="export-snapshot" style="margin-top:6px">' + C.icon("download") + "下载 snapshot.json</button></div>",
      "    </div>",
      "  </div>",
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>导入数据</h2><p>支持 CSV（图书 / 用户）与备份 JSON；先预览，再确认导入</p></div><span class="badge blue">FileReader</span></div>',
      '    <label class="dropzone" id="dropzone" for="importFile">' + C.icon("upload") + "<strong>拖拽文件到这里，或点击选择</strong><span>支持 .csv / .json，单个文件建议小于 2 MB</span></label>",
      '    <input id="importFile" type="file" accept=".csv,.json,text/csv,application/json" hidden>',
      '    <div class="toolbar" style="margin-top:10px">',
      '      <button class="link-btn" type="button" data-act="template-books">下载图书 CSV 模板</button>',
      '      <button class="link-btn" type="button" data-act="template-users">下载用户 CSV 模板</button>',
      "    </div>",
      '    <div id="importPreview" class="hint" style="margin-top:10px">尚未选择文件。</div>',
      '    <div class="toolbar" style="margin-top:10px"><button class="btn btn-primary btn-sm" type="button" data-act="apply-import" disabled>' + C.icon("check") + '确认导入</button><span class="hint" id="importKind"></span></div>',
      "  </div>",
      "</div>",
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>导入导出说明</h2><p>本地文件操作与数据库服务器备份是两条不同的链路</p></div></div>',
      '  <div class="grid-2">',
      '    <div class="hint"><strong>本地导入导出：</strong>前端读取用户选择的文件（FileReader），解析后写入当前演示数据库；导出时用 Blob 生成下载链接。数据不经过服务器上传接口，适合课程演示与数据交换。</div>',
      '    <div class="hint"><strong>服务器端备份：</strong>「备份与恢复」页面上的按钮只是发起动作，真实系统由后端调用 <span class="code-inline">gs_dump</span> / <span class="code-inline">pg_basebackup</span>，备份文件存放在数据库服务器备份目录，前端展示进度与结果。</div>',
      "  </div>",
      '  <div class="divider"></div>',
      '  <div class="hint">危险操作：重置会恢复初始演示数据（图书 12 种、演示借阅记录），当前账号若存在会保留登录状态。</div>',
      '  <div class="toolbar" style="margin-top:10px"><button class="btn btn-danger btn-sm" type="button" data-act="reset-demo">' + C.icon("refresh") + "重置演示数据</button></div>",
      "</div>"
    ].join("");

    document.getElementById("importFile").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (file) handleImportFile(file);
    });
    var dropzone = document.getElementById("dropzone");
    ["dragenter", "dragover"].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.remove("is-over");
      });
    });
    dropzone.addEventListener("drop", function (event) {
      var file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) handleImportFile(file);
    });

    C.body().onclick = function (event) {
      var button = event.target.closest("button[data-act]");
      if (!button || C.state.currentTab !== "data") return;
      var act = button.getAttribute("data-act");
      if (act === "export-books") window.TataUI.download("bit-books.csv", window.TataDB.exportBooksCSV(), "text/csv;charset=utf-8");
      else if (act === "export-borrows") window.TataUI.download("bit-borrows.csv", window.TataDB.exportBorrowsCSV(), "text/csv;charset=utf-8");
      else if (act === "export-users") window.TataUI.download("bit-users.csv", window.TataDB.exportUsersCSV(), "text/csv;charset=utf-8");
      else if (act === "export-snapshot") window.TataUI.download("bit-snapshot.json", window.TataDB.exportSnapshot(), "application/json;charset=utf-8");
      else if (act === "template-books") window.TataUI.download("books-template.csv", window.TataDB.bookHeaderTemplate(), "text/csv;charset=utf-8");
      else if (act === "template-users") window.TataUI.download("users-template.csv", window.TataDB.userHeaderTemplate(), "text/csv;charset=utf-8");
      else if (act === "apply-import") applyImport();
      else if (act === "reset-demo") resetDemo();
    };
  }

  function handleImportFile(file) {
    var preview = document.getElementById("importPreview");
    if (file.size > 2 * 1024 * 1024) {
      preview.textContent = "文件超过 2 MB，请拆分后再导入。";
      C.state.importState = null;
      return;
    }
    window.TataUI.readTextFile(file).then(function (text) {
      preview = document.getElementById("importPreview") || preview;
      var applyBtn = document.querySelector("[data-act='apply-import']");
      var kindEl = document.getElementById("importKind");
      var name = file.name.toLowerCase();
      if (name.endsWith(".json")) {
        var parsed;
        try { parsed = JSON.parse(text); } catch (err) {
          preview.textContent = "JSON 解析失败：" + err.message;
          C.state.importState = null;
          return;
        }
        var snapshot = parsed.snapshot || (parsed.data && parsed.data.books ? parsed.data : (parsed.books ? parsed : null));
        if (!snapshot) {
          preview.textContent = "未识别的 JSON 结构，需要 snapshot 或 data.books。";
          C.state.importState = null;
          return;
        }
        C.state.importState = { kind: "backup", text: text, parsed: parsed };
        preview.innerHTML = '<span class="badge blue">备份 JSON</span> ' + esc(file.name) + " · 图书 " + snapshot.books.length + " 种 · 用户 " + snapshot.users.length + " 个 · 借阅 " + snapshot.borrows.length + " 条";
        if (kindEl) kindEl.textContent = "将导入为备份，并在确认后恢复";
        if (applyBtn) applyBtn.disabled = false;
        return;
      }
      var rows = window.TataDB.parseCSV(text);
      if (!rows.length) {
        preview.textContent = "CSV 为空或格式不正确。";
        C.state.importState = null;
        return;
      }
      var headers = Object.keys(rows[0]);
      var isUser = headers.some(function (h) { return ["账号", "username", "密码MD5", "password_md5"].indexOf(h) !== -1; });
      var isBook = headers.some(function (h) { return ["书名", "title", "图书编号", "id"].indexOf(h) !== -1; });
      var kind = isBook ? "books" : (isUser ? "users" : null);
      if (!kind) {
        preview.textContent = "无法识别 CSV 类型：表头需包含「书名」或「账号」。";
        C.state.importState = null;
        return;
      }
      C.state.importState = { kind: kind, rows: rows, name: file.name };
      var cols = headers.slice(0, 6).map(function (h) { return { key: h, label: h }; });
      preview.innerHTML = [
        '<div style="margin-bottom:8px"><span class="badge ' + (kind === "books" ? "blue" : "purple") + '">' + (kind === "books" ? "图书 CSV" : "用户 CSV") + "</span> " + esc(file.name) + " · " + rows.length + " 行（预览前 5 行）</div>",
        C.tableHtml(cols, rows.slice(0, 5))
      ].join("");
      if (kindEl) kindEl.textContent = kind === "books" ? "将导入 books 表（按编号 / 书名+作者合并）" : "将导入 users 表（密码自动转 MD5）";
      if (applyBtn) applyBtn.disabled = false;
    }).catch(function (err) {
      var current = document.getElementById("importPreview") || preview;
      if (current) current.textContent = "读取失败：" + err.message;
      C.state.importState = null;
    });
  }

  function applyImport() {
    var state = C.state.importState;
    if (!state) {
      C.toast("请先选择文件", "warn");
      return;
    }
    if (state.kind === "backup") {
      window.TataUI.confirm({
        icon: "archive",
        title: "导入并恢复备份",
        desc: "该 JSON 将作为备份导入，并立即覆盖当前图书、用户与借阅数据。确定继续？",
        confirmText: "导入并恢复",
        danger: true,
        onConfirm: function () {
          var imported = window.TataDB.importBackupText(state.text);
          if (!imported.ok) {
            C.toast(imported.message, "error");
            return false;
          }
          var restored = window.TataDB.restoreBackup(imported.backup.id);
          if (!restored.ok) {
            C.toast(restored.message, "error");
            return false;
          }
          C.toast("已从上传文件恢复数据库");
          C.state.importState = null;
          window.TataUI.refreshAll();
          renderData();
          return true;
        }
      });
      return;
    }
    var result = state.kind === "books"
      ? window.TataDB.importBooks(state.rows)
      : window.TataDB.importUsers(state.rows);
    var preview = document.getElementById("importPreview");
    preview.innerHTML = '<div class="form-error" style="' + (result.ok ? "background:#e7f2ea;color:#2f6b4f" : "") + '">' + esc(result.message) + "</div>" +
      (result.errors && result.errors.length ? '<ul class="hint" style="margin-top:8px">' + result.errors.slice(0, 8).map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>" : "");
    C.toast(result.message, result.ok ? "success" : "warn");
    C.state.importState = null;
    var apply = document.querySelector("[data-act='apply-import']");
    if (apply) apply.disabled = true;
    window.TataUI.refreshAll();
  }

  function resetDemo() {
    window.TataUI.confirm({
      icon: "refresh",
      title: "重置演示数据",
      desc: "所有新增图书、借阅、用户与审计记录将被清除，恢复到初始演示状态。此操作不可撤销。",
      confirmText: "确认重置",
      danger: true,
      onConfirm: function () {
        var result = window.TataDB.resetDemo();
        C.toast(result.message);
        window.TataUI.refreshAll();
        C.refresh();
        return true;
      }
    });
  }

  function renderBackup() {
    C.setActions([
      '<button class="btn btn-primary btn-sm" type="button" data-hact="backupnow">' + C.icon("archive") + "立即备份</button>"
    ].join(""));
    var backups = window.TataDB.backups();
    var total = backups.reduce(function (sum, b) { return sum + (b.size || 0); }, 0);
    var cols = [
      { key: "id", label: "备份编号", render: function (b) { return '<span class="mono small">' + esc(b.id) + "</span>"; } },
      { key: "name", label: "名称 / 备注", render: function (b) { return '<span class="strong">' + esc(b.name) + '</span><div class="small muted">' + esc(b.note || "—") + "</div>"; } },
      { key: "ts", label: "备份时间", render: function (b) { return '<span class="nowrap small">' + C.fmtDateTime(b.ts) + "</span>"; } },
      { key: "type", label: "类型", render: function (b) { return C.badge(b.type === "uploaded" ? "上传" : "全量", b.type === "uploaded" ? "purple" : "blue"); } },
      { key: "size", label: "大小", cls: "num", render: function (b) { return C.fmtBytes(b.size); } },
      { key: "node", label: "节点" },
      { key: "status", label: "状态", render: function () { return C.badge("成功", "green"); } },
      { key: "actions", label: "操作", render: function (b) {
        return '<div class="row-actions">' +
          '<button class="link-btn primary" type="button" data-act="restore" data-id="' + esc(b.id) + '">恢复</button>' +
          '<button class="link-btn" type="button" data-act="download" data-id="' + esc(b.id) + '">下载</button>' +
          '<button class="link-btn danger" type="button" data-act="delete" data-id="' + esc(b.id) + '">删除</button>' +
          "</div>";
      } }
    ];
    C.body().innerHTML = [
      '<div class="grid-2">',
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>服务器端快照备份</h2><p>应用界面的按钮发起备份请求，备份文件保存在数据库服务器（演示中存于浏览器数据库快照）</p></div><span class="badge green">推荐</span></div>',
      '    <div class="hint">真实系统流程：前端 <span class="code-inline">POST /api/backup</span> → 后端调用 <span class="code-inline">gs_dump -Fc tata_books</span> 或 <span class="code-inline">pg_basebackup</span> → 写入服务器备份目录 → 返回备份编号与大小。前端只负责发起、展示与触发恢复，不接触数据库文件。</div>',
      '    <div class="form-row" style="margin-top:14px"><label class="field"><span>备份备注</span><input id="backupNote" placeholder="例如：演示前基线 / 答辩版本"></label><div class="field"><span>当前数据量</span><div class="input mono" style="background:var(--paper)">' + C.fmtBytes(total) + " · " + backups.length + ' 份备份</div></div></div>',
      '    <div class="toolbar" style="margin-top:12px"><button class="btn btn-primary btn-sm" type="button" data-act="create">' + C.icon("archive") + '创建全量快照</button><span class="hint">恢复会覆盖当前数据，请先确认。</span></div>',
      "  </div>",
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>本地文件备份</h2><p>下载 JSON 到本机，或上传已有的备份文件进行恢复</p></div><span class="badge blue">前端 Blob</span></div>',
      '    <div class="hint">本地文件适合带走留档、换设备演示；它不是数据库服务器的物理备份，不能替代 <span class="code-inline">gs_dump</span>。</div>',
      '    <div class="toolbar" style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" data-act="export-all">' + C.icon("download") + "下载全量 JSON</button></div>",
      '    <label class="dropzone" for="backupUpload" style="margin-top:10px">' + C.icon("upload") + "<strong>上传备份 JSON</strong><span>导入后会出现在备份列表中，可选择恢复</span></label>",
      '    <input id="backupUpload" type="file" accept=".json,application/json" hidden>',
      '    <div class="hint" id="backupUploadMsg" style="margin-top:8px">尚未上传文件。</div>',
      "  </div>",
      "</div>",
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>备份列表</h2><p>备份编号、大小与恢复入口；演示环境最多保留 4 份，超出自动删除最旧</p></div><span class="pill">' + backups.length + " 份</span></div>",
      C.tableHtml(cols, backups, "暂无备份"),
      "</div>"
    ].join("");

    document.getElementById("backupUpload").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      window.TataUI.readTextFile(file).then(function (text) {
        var result = window.TataDB.importBackupText(text);
        document.getElementById("backupUploadMsg").textContent = result.message;
        C.toast(result.message, result.ok ? "success" : "error");
        if (result.ok) renderBackup();
      });
    });

    C.body().onclick = function (event) {
      var button = event.target.closest("button[data-act]");
      if (!button || C.state.currentTab !== "backup") return;
      var act = button.getAttribute("data-act");
      var id = button.getAttribute("data-id");
      if (act === "create") createBackup();
      else if (act === "restore") restoreBackup(id);
      else if (act === "download") {
        var json = window.TataDB.backupJson(id);
        if (json) window.TataUI.download(id + ".json", json, "application/json;charset=utf-8");
      } else if (act === "delete") {
        window.TataUI.confirm({
          icon: "x",
          title: "删除备份",
          desc: "确认删除备份 " + id + "？删除后无法恢复该快照。",
          confirmText: "删除",
          danger: true,
          onConfirm: function () {
            var result = window.TataDB.deleteBackup(id);
            C.toast(result.message);
            renderBackup();
            return true;
          }
        });
      } else if (act === "export-all") {
        window.TataUI.download("bit-snapshot.json", window.TataDB.exportSnapshot(), "application/json;charset=utf-8");
      }
    };
  }

  function createBackup() {
    var note = document.getElementById("backupNote");
    var result = window.TataDB.createBackup(note ? note.value : "");
    C.toast(result.message, "success");
    renderBackup();
  }

  function restoreBackup(id) {
    window.TataUI.confirm({
      icon: "archive",
      title: "恢复数据库",
      desc: "将数据库恢复到备份 " + id + " 的状态。当前未备份的修改会丢失，恢复后所有页面数据会刷新。",
      confirmText: "确认恢复",
      danger: true,
      onConfirm: function () {
        var result = window.TataDB.restoreBackup(id);
        if (!result.ok) {
          C.toast(result.message, "error");
          return false;
        }
        C.toast(result.message);
        window.TataUI.refreshAll();
        renderBackup();
        return true;
      }
    });
  }

  C.registry.data = renderData;
  C.registry.backup = renderBackup;
  C.handlers.exportsnapshot = function () {
    window.TataUI.download("bit-snapshot.json", window.TataDB.exportSnapshot(), "application/json;charset=utf-8");
  };
  C.handlers.backupnow = function () {
    createBackup();
  };
})();
