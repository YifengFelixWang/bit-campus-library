(function () {
  "use strict";

  var C = window.TataCore;
  var esc = C.esc;

  var PERMISSIONS = [
    { label: "浏览图书", perm: "book:read" },
    { label: "维护图书", perm: "book:write" },
    { label: "本人借阅/归还", perm: "borrow:self" },
    { label: "查看借阅", perm: "borrow:read" },
    { label: "管理借阅", perm: "borrow:manage" },
    { label: "查看用户", perm: "user:read" },
    { label: "编辑本人 / 读者资料", perm: "user:edit" },
    { label: "批量注册用户", perm: "user:import" },
    { label: "管理用户", perm: "user:manage" },
    { label: "多表查询", perm: "db:query" },
    { label: "调用存储过程", perm: "db:proc" },
    { label: "导出数据", perm: "data:export" },
    { label: "导入数据", perm: "data:import" },
    { label: "备份恢复", perm: "backup:manage" },
    { label: "主备管理", perm: "server:manage" },
    { label: "审计日志", perm: "audit:read" },
    { label: "管理评价", perm: "review:manage" },
    { label: "管理公告", perm: "announcement:write" }
  ];

  function renderUsers() {
    C.setActions([
      C.can("user:manage") ? '<button class="btn btn-primary btn-sm" type="button" data-hact="adduser">' + C.icon("plus") + "新增用户</button>" : "",
      (C.can("user:manage") || C.can("user:import")) ? '<button class="btn btn-ghost btn-sm" type="button" data-hact="importusers">' + C.icon("upload") + "批量导入</button>" : ""
    ].join(""));

    var users = window.TataDB.users();
    var userCols = [
      { key: "name", label: "用户", render: function (u) { return '<span class="strong">' + esc(u.name) + '</span><div class="small muted">' + esc(u.email || "-") + "</div>"; } },
      { key: "username", label: "账号", render: function (u) { return '<span class="mono small">' + esc(u.username) + "</span>"; } },
      { key: "role", label: "角色", render: function (u) {
        if (!C.can("user:manage")) return C.badge(C.roleName(u.role), u.role === "admin" ? "red" : (u.role === "librarian" ? "blue" : "gray"));
        return '<select class="select" data-role-select="' + esc(u.id) + '" style="padding:5px 8px;font-size:12px">' +
          ["admin", "librarian", "reader"].map(function (r) { return '<option value="' + r + '"' + (u.role === r ? " selected" : "") + ">" + C.roleName(r) + "</option>"; }).join("") +
          "</select>";
      } },
      { key: "status", label: "状态", render: function (u) { return u.status === "active" ? C.badge("启用", "green") : C.badge("停用", "gray"); } },
      { key: "password_md5", label: "密码摘要 (MD5)", render: function (u) { return '<span class="mono small" title="' + esc(u.password_md5) + '">' + esc(u.password_md5.slice(0, 12)) + "…</span>"; } },
      { key: "last_login", label: "最近登录", render: function (u) { return u.last_login ? '<span class="nowrap small">' + C.fmtDateTime(u.last_login) + "</span>" : '<span class="muted small">从未登录</span>'; } },
      { key: "actions", label: "操作", render: function (u) {
        var canEdit = window.TataDB.canEditUser(u.id);
        var manage = C.can("user:manage");
        if (!canEdit && !manage) return '<span class="muted small">只读</span>';
        var actions = [];
        if (canEdit) actions.push('<button class="link-btn primary" type="button" data-act="edit" data-id="' + esc(u.id) + '">编辑</button>');
        if (manage) {
          actions.push('<button class="link-btn" type="button" data-act="reset" data-id="' + esc(u.id) + '">重置密码</button>');
          actions.push('<button class="link-btn ' + (u.status === "active" ? "danger" : "primary") + '" type="button" data-act="toggle" data-id="' + esc(u.id) + '">' + (u.status === "active" ? "停用" : "启用") + "</button>");
        }
        return '<div class="row-actions">' + actions.join("") + "</div>";
      } }
    ];

    var roles = window.TataDB.roles().filter(function (r) { return r.code !== "guest"; });
    var matrixCols = [{ key: "label", label: "权限" }].concat(roles.map(function (r) {
      return {
        key: r.code,
        label: C.roleName(r.code),
        render: function (row) {
          var allowed = roles.filter(function (x) { return x.code === r.code; })[0].permissions;
          var ok = allowed.indexOf("*") !== -1 || allowed.indexOf(row.perm) !== -1;
          return ok ? '<span class="badge green">✓</span>' : '<span class="muted">—</span>';
        }
      };
    }));
    var matrixRows = PERMISSIONS.map(function (p) {
      return { label: p.label, perm: p.perm };
    });

    var dbUsers = window.TataDB.dbAccounts();
    var dbCols = [
      { key: "username", label: "数据库账户", render: function (u) { return '<span class="mono small">' + esc(u.username) + "</span>"; } },
      { key: "type", label: "类型" },
      { key: "auth", label: "认证方式" },
      { key: "privileges", label: "权限", render: function (u) { return '<span class="small">' + esc(u.privileges) + "</span>"; } },
      { key: "status", label: "状态", render: function () { return C.badge("online", "green"); } }
    ];

    C.body().innerHTML = [
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>应用用户</h2><p>账号不可修改；超级管理员可编辑全部用户，图书管理员只能编辑本人与读者。密码仅保存 MD5 摘要，登录时比对摘要而非明文</p></div><span class="pill">' + users.length + " 个账号</span></div>",
      C.tableHtml(userCols, users, "暂无用户"),
      "</div>",
      '<div class="grid-2" style="margin-top:18px">',
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>RBAC 权限矩阵</h2><p>角色 → 权限的映射在 roles.permissions 中维护，前端与接口双重校验</p></div></div>',
      C.tableHtml(matrixCols, matrixRows),
      "  </div>",
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>数据库账户（IAM）</h2><p>数据库内部账户由 IAM 统一管理，应用只持有 tata_app 凭据</p></div></div>',
      C.tableHtml(dbCols, dbUsers),
      '    <div class="divider"></div>',
      '    <pre class="code-block small">' + esc([
        "CREATE USER tata_app WITH PASSWORD '******';",
        "GRANT CONNECT ON DATABASE tata_books TO tata_app;",
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tata_app;",
        "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tata_app;",
        "REVOKE DELETE ON audit_logs FROM tata_app;"
      ].join("\n")) + "</pre>",
      '    <div class="hint" style="margin-top:8px">对外用户是应用用户（admin / librarian / reader）；数据库账户只在 IAM 与后端连接池中使用，不暴露给浏览器。</div>',
      "  </div>",
      "</div>"
    ].join("");

    document.querySelectorAll("[data-role-select]").forEach(function (select) {
      select.addEventListener("change", function () {
        var result = window.TataDB.setUserRole(this.getAttribute("data-role-select"), this.value);
        C.toast(result.message, result.ok ? "success" : "error");
        window.TataUI.refreshAll();
        C.refresh();
      });
    });

    C.body().onclick = function (event) {
      var button = event.target.closest("button[data-act]");
      if (!button || C.state.currentTab !== "users") return;
      var id = button.getAttribute("data-id");
      var act = button.getAttribute("data-act");
      if (act === "toggle") {
        var result = window.TataDB.toggleUser(id);
        C.toast(result.message, result.ok ? "success" : "error");
        renderUsers();
      } else if (act === "reset") {
        openResetPassword(id);
      } else if (act === "edit") {
        openEditUser(id);
      }
    };
  }

  function openEditUser(id) {
    var user = window.TataDB.userById(id);
    if (!user) return C.toast("用户不存在", "error");
    if (!window.TataDB.canEditUser(id)) return C.toast("只能修改本人和读者的资料", "warn");
    var actor = C.currentUser();
    var scopeText = actor && actor.role === "admin" ? "超级管理员可修改全部用户资料" : "图书管理员只能修改本人与读者的资料";
    window.TataUI.modal({
      icon: "users",
      title: "编辑用户资料",
      desc: scopeText + "；登录账号不可修改，姓名、邮箱和密码可修改。",
      wide: true,
      bodyHtml: [
        '<form class="modal-form" onsubmit="return false">',
        '  <div class="form-row">',
        '    <label class="field"><span>登录账号（不可修改）</span><input value="' + esc(user.username) + '" readonly disabled></label>',
        '    <label class="field"><span>角色</span><input value="' + esc(C.roleName(user.role)) + '" readonly disabled></label>',
        "  </div>",
        '  <div class="form-row">',
        '    <label class="field"><span>姓名 *</span><input id="euName" value="' + esc(user.name) + '" placeholder="真实姓名"></label>',
        '    <label class="field"><span>邮箱</span><input id="euEmail" type="email" value="' + esc(user.email || "") + '" placeholder="name@example.com"></label>',
        "  </div>",
        '  <label class="field"><span>新密码（留空则不修改）</span><input id="euPassword" type="text" placeholder="至少 6 位"></label>',
        '  <div class="md5-preview"><span>密码只保存 MD5 摘要 · 当前摘要</span><code id="euHash">' + esc(user.password_md5.slice(0, 16)) + "…</code></div>",
        "</form>"
      ].join(""),
      confirmText: "保存修改",
      onConfirm: function () {
        var result = window.TataDB.updateUserProfile(id, {
          name: document.getElementById("euName").value,
          email: document.getElementById("euEmail").value,
          password: document.getElementById("euPassword").value
        });
        if (!result.ok) {
          C.toast(result.message, "error");
          return false;
        }
        C.toast(result.message, "success");
        renderUsers();
        window.TataUI.refreshAll();
        return true;
      }
    });
    var input = document.getElementById("euPassword");
    input.addEventListener("input", function () {
      document.getElementById("euHash").textContent = this.value ? window.TataDB.md5(this.value) : user.password_md5.slice(0, 16) + "…";
    });
  }

  function openImportUsers() {
    if (!C.can("user:manage") && !C.can("user:import")) return C.toast("当前角色没有批量导入用户权限", "warn");
    var isAdmin = C.can("user:manage");
    var rule = isAdmin
      ? "超级管理员可导入读者、图书管理员和超级管理员账号。"
      : "图书管理员只能批量注册读者（reader）账号。";
    var roleHint = isAdmin ? "reader / librarian / admin" : "reader";
    window.TataUI.modal({
      icon: "upload",
      title: "批量导入注册新用户",
      desc: "支持 CSV 文件或直接粘贴；账号不可修改，已存在的账号会自动跳过。密码只保存 MD5 摘要。",
      wide: true,
      bodyHtml: [
        '<form class="modal-form" onsubmit="return false">',
        '  <div class="hint"><strong>CSV 表头：</strong>账号,姓名,角色,密码,邮箱,电话（角色填 ' + esc(roleHint) + "）。" + esc(rule) + "</div>",
        '  <div class="toolbar">',
        '    <button class="btn btn-ghost btn-sm" type="button" id="iuTemplate">' + C.icon("download") + "下载 CSV 模板</button>",
        '    <label class="btn btn-ghost btn-sm" for="iuFile" style="cursor:pointer">' + C.icon("upload") + "选择 CSV 文件</label>",
        '    <input id="iuFile" type="file" accept=".csv,text/csv" hidden>',
        "  </div>",
        '  <label class="field"><span>CSV 内容预览 / 直接粘贴</span><textarea class="textarea" id="iuText" rows="8" spellcheck="false" placeholder="账号,姓名,角色,密码,邮箱,电话&#10;newreader,新读者,reader,read123,new@stu.edu.cn,138-0000-9999"></textarea></label>',
        '  <div class="hint" id="iuPreview">尚未提供导入内容。</div>',
        '  <div class="hint" id="iuErrors"></div>',
        "</form>"
      ].join(""),
      confirmText: "确认批量注册",
      onConfirm: function () {
        var textEl = document.getElementById("iuText");
        var errorsEl = document.getElementById("iuErrors");
        var text = textEl.value.trim();
        if (!text) {
          C.toast("请先选择 CSV 文件或粘贴内容", "warn");
          return false;
        }
        var rows = window.TataDB.parseCSV(text);
        if (!rows.length) {
          C.toast("没有解析到有效数据，请检查表头与内容", "warn");
          return false;
        }
        var result = window.TataDB.importRegisterUsers(rows);
        if (result.errors && result.errors.length) {
          errorsEl.innerHTML = '<span class="badge red">未导入 ' + result.errors.length + ' 行</span><div class="small" style="margin-top:6px;line-height:1.7">' +
            result.errors.map(function (message) { return esc(message); }).join("<br>") + "</div>";
        }
        if (!result.ok) {
          C.toast(result.message, result.added ? "warn" : "error");
          if (result.added) {
            renderUsers();
            window.TataUI.refreshAll();
          }
          return false;
        }
        C.toast(result.message, "success");
        renderUsers();
        window.TataUI.refreshAll();
        return true;
      }
    });
    var textEl = document.getElementById("iuText");
    var preview = document.getElementById("iuPreview");
    var errorsEl = document.getElementById("iuErrors");
    function refreshPreview() {
      errorsEl.innerHTML = "";
      var text = textEl.value.trim();
      if (!text) {
        preview.textContent = "尚未提供导入内容。";
        return;
      }
      var rows = window.TataDB.parseCSV(text);
      if (!rows.length) {
        preview.textContent = "未解析到数据行，请检查第一行是否为表头。";
        return;
      }
      var sample = rows.slice(0, 5).map(function (row) {
        return String(row["账号"] || row.username || "（无账号）");
      });
      preview.textContent = "解析到 " + rows.length + " 行待注册 · 示例账号：" + sample.join("、") + (rows.length > 5 ? " …" : "");
    }
    textEl.addEventListener("input", refreshPreview);
    document.getElementById("iuTemplate").addEventListener("click", function () {
      window.TataUI.download("users-template.csv", window.TataDB.userHeaderTemplate(), "text/csv;charset=utf-8");
    });
    document.getElementById("iuFile").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        C.toast("文件超过 2 MB，请拆分后再导入", "warn");
        return;
      }
      window.TataUI.readTextFile(file).then(function (text) {
        textEl.value = text;
        refreshPreview();
      }).catch(function (err) {
        C.toast("读取文件失败：" + err.message, "error");
      });
    });
  }

  function openResetPassword(id) {
    var user = window.TataDB.userById(id);
    if (!user) return;
    window.TataUI.modal({
      icon: "key",
      title: "重置密码",
      desc: "为 " + user.name + "（" + user.username + "）设置新密码，保存时写入 MD5 摘要。",
      bodyHtml: [
        '<form class="modal-form" onsubmit="return false">',
        '  <label class="field"><span>新密码</span><input id="rpPassword" type="text" placeholder="至少 6 位" value="read123"></label>',
        '  <div class="md5-preview"><span>MD5(新密码)</span><code id="rpHash">' + esc(window.TataDB.md5("read123")) + "</code></div>",
        "</form>"
      ].join(""),
      confirmText: "保存新密码",
      onConfirm: function () {
        var password = document.getElementById("rpPassword").value;
        var result = window.TataDB.resetPassword(id, password);
        if (!result.ok) {
          C.toast(result.message, "error");
          return false;
        }
        C.toast(result.message + "：" + result.hash.slice(0, 16) + "…");
        renderUsers();
        return true;
      }
    });
    var input = document.getElementById("rpPassword");
    input.addEventListener("input", function () {
      document.getElementById("rpHash").textContent = this.value ? window.TataDB.md5(this.value) : "—";
    });
    input.focus();
  }

  function openAddUser() {
    window.TataUI.modal({
      icon: "users",
      title: "新增应用用户",
      desc: "密码不会以明文入库，保存的是 MD5(密码) 摘要。生产环境应改用 bcrypt/Argon2 加盐。",
      wide: true,
      bodyHtml: [
        '<form class="modal-form" onsubmit="return false">',
        '  <div class="form-row">',
        '    <label class="field"><span>账号 *</span><input id="nuUsername" placeholder="3–20 位字母/数字/下划线"></label>',
        '    <label class="field"><span>姓名 *</span><input id="nuName" placeholder="真实姓名"></label>',
        "  </div>",
        '  <div class="form-row">',
        '    <label class="field"><span>角色 *</span><select id="nuRole"><option value="reader">读者</option><option value="librarian">图书管理员</option><option value="admin">超级管理员</option></select></label>',
        '    <label class="field"><span>初始密码 *</span><input id="nuPassword" type="text" value="read123"></label>',
        "  </div>",
        '  <div class="form-row">',
        '    <label class="field"><span>邮箱</span><input id="nuEmail" placeholder="name@example.com"></label>',
        '    <label class="field"><span>电话</span><input id="nuPhone" placeholder="138-0000-0000"></label>',
        "  </div>",
        '  <div class="md5-preview"><span>将写入 users.password_md5</span><code id="nuHash">' + esc(window.TataDB.md5("read123")) + "</code></div>",
        "</form>"
      ].join(""),
      confirmText: "创建用户",
      onConfirm: function () {
        var result = window.TataDB.addUser({
          username: document.getElementById("nuUsername").value,
          name: document.getElementById("nuName").value,
          role: document.getElementById("nuRole").value,
          password: document.getElementById("nuPassword").value,
          email: document.getElementById("nuEmail").value,
          phone: document.getElementById("nuPhone").value
        });
        if (!result.ok) {
          C.toast(result.message, "error");
          return false;
        }
        C.toast(result.message + "，密码摘要 " + result.hash.slice(0, 16) + "…");
        renderUsers();
        window.TataUI.refreshAll();
        return true;
      }
    });
    var input = document.getElementById("nuPassword");
    input.addEventListener("input", function () {
      document.getElementById("nuHash").textContent = this.value ? window.TataDB.md5(this.value) : "—";
    });
  }

  C.registry.users = renderUsers;
  C.handlers.adduser = function () {
    if (!C.can("user:manage")) return C.toast("当前角色没有管理用户权限", "warn");
    openAddUser();
  };
  C.handlers.importusers = function () {
    openImportUsers();
  };
})();
