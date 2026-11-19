(function () {
  "use strict";

  var C = window.TataCore;
  var esc = C.esc;

  function filterState() {
    if (!C.state.announcementFilter) C.state.announcementFilter = { q: "", status: "all" };
    return C.state.announcementFilter;
  }

  function renderAnnouncements() {
    var filter = filterState();
    var rows = window.TataDB.announcements(false);
    var published = rows.filter(function (a) { return a.status === "published"; }).length;
    C.setActions([
      '<button class="btn btn-primary btn-sm" type="button" data-hact="addannouncement">' + C.icon("plus") + "发布公告</button>"
    ].join(""));
    C.body().innerHTML = [
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>公告管理</h2><p>超级管理员和图书管理员可以新增、编辑、置顶或删除公告，首页「馆内公告」会立即同步；访客与读者只能查看已发布公告。</p></div>',
      '    <span class="pill">共 ' + rows.length + ' 条 · 已发布 ' + published + "</span>",
      "  </div>",
      '  <div class="toolbar">',
      '    <div class="segmented" id="announcementStatus">',
      ["all|全部", "published|已发布", "draft|草稿"].map(function (item) {
        var pair = item.split("|");
        return '<button type="button" data-status="' + pair[0] + '" class="' + (filter.status === pair[0] ? "is-active" : "") + '">' + pair[1] + "</button>";
      }).join(""),
      "    </div>",
      '    <input class="input search" id="announcementSearch" type="search" placeholder="搜索标题 / 内容 / 作者" value="' + esc(filter.q) + '">',
      "  </div>",
      '  <div id="announcementsTableWrap"></div>',
      "</div>"
    ].join("");
    updateAnnouncementsTable();
    document.getElementById("announcementStatus").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-status]");
      if (!button) return;
      filter.status = button.getAttribute("data-status");
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (b) {
        b.classList.toggle("is-active", b === button);
      });
      updateAnnouncementsTable();
    });
    document.getElementById("announcementSearch").addEventListener("input", function () {
      filter.q = this.value;
      updateAnnouncementsTable();
    });
  }

  function updateAnnouncementsTable() {
    var wrap = document.getElementById("announcementsTableWrap");
    if (!wrap) return;
    var filter = filterState();
    var rows = window.TataDB.announcements(false);
    if (filter.status !== "all") rows = rows.filter(function (a) { return a.status === filter.status; });
    if (filter.q.trim()) {
      var q = filter.q.trim().toLowerCase();
      rows = rows.filter(function (a) {
        return [a.title, a.content, a.author].join(" ").toLowerCase().indexOf(q) !== -1;
      });
    }
    var cols = [
      { key: "title", label: "公告", render: function (a) {
        return (a.pinned ? '<span class="badge amber">置顶</span> ' : "") + '<span class="strong">' + esc(a.title) + '</span><div class="small muted">' + esc((a.content || "").slice(0, 80)) + ((a.content || "").length > 80 ? "…" : "") + "</div>";
      } },
      { key: "status", label: "状态", render: function (a) {
        return a.status === "published" ? C.badge("已发布", "green") : C.badge("草稿", "gray");
      } },
      { key: "author", label: "发布人", render: function (a) {
        return '<span class="mono small">' + esc(a.author) + "</span>";
      } },
      { key: "updated_at", label: "更新时间", render: function (a) {
        return '<span class="nowrap small">' + C.fmtDateTime(a.updated_at || a.created_at) + "</span>";
      } },
      { key: "actions", label: "操作", render: function (a) {
        return '<div class="row-actions">' +
          '<button class="link-btn primary" type="button" data-act="announcement-edit" data-id="' + esc(a.id) + '">编辑</button>' +
          '<button class="link-btn danger" type="button" data-act="announcement-delete" data-id="' + esc(a.id) + '">删除</button>' +
          "</div>";
      } }
    ];
    wrap.innerHTML = C.tableHtml(cols, rows, "暂无公告");
    wrap.onclick = function (event) {
      var button = event.target.closest("button[data-act]");
      if (!button) return;
      var id = button.getAttribute("data-id");
      if (button.getAttribute("data-act") === "announcement-edit") openAnnouncementForm(id);
      else deleteAnnouncement(id);
    };
  }

  function openAnnouncementForm(id) {
    var item = id ? window.TataDB.announcements(false).filter(function (a) { return a.id === id; })[0] : null;
    if (id && !item) return;
    var body = [
      '<form class="modal-form" onsubmit="return false">',
      '  <label class="field"><span>公告标题 *</span><input id="anTitle" maxlength="80" value="' + esc(item ? item.title : "") + '" placeholder="例如：新书上架通知"></label>',
      '  <label class="field"><span>公告内容 *</span><textarea id="anContent" rows="7" maxlength="1200" placeholder="填写公告正文">' + esc(item ? item.content : "") + "</textarea></label>",
      '  <div class="form-row">',
      '    <label class="field"><span>发布状态</span><select id="anStatus"><option value="published"' + (!item || item.status === "published" ? " selected" : "") + '>立即发布</option><option value="draft"' + (item && item.status === "draft" ? " selected" : "") + '>保存草稿</option></select><small>草稿仅管理端可见，访客和读者看不到。</small></label>',
      '    <div class="field"><span>置顶</span><label class="switch"><input id="anPinned" type="checkbox"' + (item && item.pinned ? " checked" : "") + '> 在公告列表置顶显示</label></div>',
      "  </div>",
      "</form>"
    ].join("");
    window.TataUI.modal({
      title: item ? "编辑公告" : "发布公告",
      desc: "公告发布后，访客和读者可在首页「馆内公告」中查看。",
      bodyHtml: body,
      wide: true,
      confirmText: item ? "保存修改" : "保存公告",
      onConfirm: function () {
        var title = document.getElementById("anTitle").value.trim();
        var content = document.getElementById("anContent").value.trim();
        if (!title || !content) {
          C.toast("公告标题和内容不能为空", "error");
          return false;
        }
        var result = window.TataDB.saveAnnouncement({
          id: item ? item.id : undefined,
          title: title,
          content: content,
          status: document.getElementById("anStatus").value,
          pinned: document.getElementById("anPinned").checked
        });
        if (!result.ok) {
          C.toast(result.message, "error");
          return false;
        }
        C.toast(result.message);
        window.TataUI.refreshAll();
        renderAnnouncements();
        return true;
      }
    });
  }

  function deleteAnnouncement(id) {
    var item = window.TataDB.announcements(false).filter(function (a) { return a.id === id; })[0];
    if (!item) return;
    window.TataUI.confirm({
      icon: "x",
      title: "删除公告",
      desc: "确认删除《" + item.title + "》？删除后访客和读者将不再看到该公告。",
      confirmText: "确认删除",
      danger: true,
      onConfirm: function () {
        var result = window.TataDB.deleteAnnouncement(id);
        if (!result.ok) {
          C.toast(result.message, "error");
          return false;
        }
        C.toast(result.message);
        window.TataUI.refreshAll();
        renderAnnouncements();
        return true;
      }
    });
  }

  C.registry.announcements = renderAnnouncements;
  C.onchange.announcements = function () { renderAnnouncements(); };
  C.handlers.addannouncement = function () { openAnnouncementForm(null); };
})();
