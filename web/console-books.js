(function () {
  "use strict";

  var C = window.TataCore;
  var esc = C.esc;

  // 书目维护走真实接口（catalog-service）。旧版是读写 localStorage，现已废弃。
  function api() { return window.__TATA_API__; }

  var cache = [];        // 当前维护页数据（在架 + 已下架）
  var cacheReady = false;
  var selected = {};     // 勾选中的图书（跨页保留）

  function selectedIds() {
    return Object.keys(selected).filter(function (k) { return selected[k]; });
  }

  function shelfOf(book) {
    return book.shelfStatus === "OFF_SHELF" ? "off_shelf" : "on_shelf";
  }

  function shape(book) {
    return {
      id: book.bookId,
      title: book.title,
      author: book.author,
      category: book.category,
      isbn: book.isbn,
      publisher: book.publisher,
      year: book.year,
      desc: book.summary || book.desc,
      total: book.total,
      available: book.available,
      coverUrl: book.coverUrl,
      shelf_status: shelfOf(book)
    };
  }

  async function loadBooks() {
    try {
      // 先刷新副本统计，否则「可借 / 馆藏」是登录那一刻的旧快照
      await api().refreshCopies();
      var list = await api().adminBooks();
      cache = list.map(shape);
    } catch (e) {
      cache = [];
      C.toast("书目加载失败：" + (e && e.message ? e.message : e), "error");
    }
    cacheReady = true;
  }

  async function renderBooks() {
    C.setActions([
      C.can("book:write")
        ? '<button class="btn btn-primary btn-sm" type="button" data-hact="addbook">' + C.icon("plus") + "新增图书</button>"
        : "",
      C.can("data:export")
        ? '<button class="btn btn-ghost btn-sm" type="button" data-hact="exportbooks">' + C.icon("download") + "导出 CSV</button>"
        : "",
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="importbooks">' + C.icon("upload") + "导入 CSV</button>"
    ].join(""));

    if (!cacheReady) {
      C.body().innerHTML = '<div class="panel"><div class="panel-head"><div><h2>馆藏列表</h2><p>正在从数据库加载…</p></div></div></div>';
      await loadBooks();
    }

    var filter = C.state.bookFilter;
    if (filter.page == null || filter.page < 1) filter.page = 1;
    if (filter.size == null) filter.size = 20;

    var categories = ["全部"].concat(
      api().categories().map(function (c) { return c.name; })
    );
    var shelfOptions = [
      { value: "all", label: "全部状态" },
      { value: "on_shelf", label: "已上架" },
      { value: "off_shelf", label: "已下架" }
    ];
    var onShelfCount = cache.filter(function (b) { return b.shelf_status === "on_shelf"; }).length;
    var canDelete = C.can("book:write");

    C.body().innerHTML = [
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>馆藏列表</h2><p>共 ' + cache.length + ' 种图书 · 已上架 ' + onShelfCount + ' 种 · 数据来自 catalog schema</p></div></div>',
      '  <div class="toolbar">',
      '    <input class="input search" id="bookSearch" type="search" placeholder="搜索书名 / 作者 / ISBN" value="' + esc(filter.q) + '">',
      '    <select class="select" id="bookCategory">',
      categories.map(function (c) {
        return '<option value="' + esc(c) + '"' + (c === filter.cat ? " selected" : "") + ">" + esc(c) + "</option>";
      }).join(""),
      "    </select>",
      '    <select class="select" id="bookShelf">',
      shelfOptions.map(function (s) {
        return '<option value="' + s.value + '"' + (s.value === filter.shelf ? " selected" : "") + ">" + s.label + "</option>";
      }).join(""),
      "    </select>",
      '    <span class="spacer"></span>',
      '    <span class="hint">下架为软删除，读者端不可见，借阅记录保留</span>',
      canDelete
        ? '<button class="btn btn-danger btn-sm" type="button" id="bookBatchDelete" disabled>删除选中</button>'
        : "",
      "  </div>",
      '  <div id="booksTableWrap"></div>',
      '  <div id="booksPager" class="pager"></div>',
      "</div>"
    ].join("");

    updateBooksTable();
    document.getElementById("bookSearch").addEventListener("input", function () {
      filter.q = this.value;
      filter.page = 1;
      updateBooksTable();
    });
    document.getElementById("bookCategory").addEventListener("change", function () {
      filter.cat = this.value;
      filter.page = 1;
      updateBooksTable();
    });
    document.getElementById("bookShelf").addEventListener("change", function () {
      filter.shelf = this.value;
      filter.page = 1;
      updateBooksTable();
    });
    var batchBtn = document.getElementById("bookBatchDelete");
    if (batchBtn) batchBtn.addEventListener("click", deleteSelected);
    updateBatchButton();
  }

  function filteredBooks() {
    var filter = C.state.bookFilter;
    var q = filter.q.trim().toLowerCase();
    return cache.filter(function (b) {
      if (filter.cat !== "全部" && b.category !== filter.cat) return false;
      if (filter.shelf && filter.shelf !== "all" && b.shelf_status !== filter.shelf) return false;
      if (!q) return true;
      return [b.title, b.author, b.isbn, b.category].join(" ").toLowerCase().indexOf(q) !== -1;
    });
  }

  function updateBooksTable() {
    var wrap = document.getElementById("booksTableWrap");
    if (!wrap) return;
    var filter = C.state.bookFilter;
    var all = filteredBooks();
    var pageSize = filter.size || 20;
    var totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    if (filter.page > totalPages) filter.page = totalPages;
    if (filter.page < 1) filter.page = 1;
    var page = filter.page;
    var rows = all.slice((page - 1) * pageSize, page * pageSize);
    var canWrite = C.can("book:write");

    var cols = [
      { key: "sel", label: "", cls: "col-check",
        labelHtml: canWrite ? '<input type="checkbox" id="bookSelectAll" title="全选本页">' : "",
        render: function (b) {
          if (!canWrite) return "";
          return '<input type="checkbox" data-book-check="' + esc(b.id) + '"' + (selected[b.id] ? " checked" : "") + ">";
        } },
      { key: "cover", label: "封面", render: function (b) {
        if (!b.coverUrl) return '<span class="muted small">无</span>';
        // 文件不存在时浏览器会显示裂图，这里回退成占位文字
        return '<img src="' + esc(b.coverUrl) + '" alt="" ' +
          'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'" ' +
          'style="width:40px;height:54px;object-fit:cover;border-radius:6px">' +
          '<span class="muted small" style="display:none">缺失</span>';
      } },
      { key: "title", label: "图书", render: function (b) {
        return '<span class="strong">' + esc(b.title) + "</span>" +
          '<div class="small muted">' + esc(b.author || "未填作者") + "</div>";
      } },
      { key: "category", label: "分类", render: function (b) { return C.badge(b.category, "blue"); } },
      { key: "shelf_status", label: "上架状态", render: function (b) {
        return C.shelfBadge(b.shelf_status) +
          (b.shelf_status === "on_shelf" ? "" : '<div class="small muted">读者端不可见</div>');
      } },
      { key: "isbn", label: "ISBN", render: function (b) { return '<span class="mono small">' + esc(b.isbn || "-") + "</span>"; } },
      { key: "publisher", label: "出版信息", render: function (b) {
        return '<span class="small">' + esc(b.publisher || "—") + "</span>" +
          '<div class="small muted">' + esc(b.year || "—") + "</div>";
      } },
      { key: "stock", label: "可借 / 馆藏", cls: "num", render: function (b) {
        return "<b>" + b.available + "</b> / " + b.total;
      } },
      { key: "actions", label: "操作", render: function (b) {
        if (!canWrite) return '<span class="muted small">只读</span>';
        return '<div class="row-actions">' +
          '<button class="link-btn" type="button" data-act="book-edit" data-id="' + b.id + '">编辑</button>' +
          (b.shelf_status === "on_shelf"
            ? '<button class="link-btn danger" type="button" data-act="book-off" data-id="' + b.id + '">下架</button>'
            : '<button class="link-btn primary" type="button" data-act="book-on" data-id="' + b.id + '">上架</button>') +
          "</div>";
      } }
    ];
    wrap.innerHTML = C.tableHtml(cols, rows, all.length ? "没有匹配的图书" : "还没有图书，可以用右上角「导入 CSV」批量添加");
    wrap.onclick = function (event) {
      var button = event.target.closest("button[data-act]");
      if (!button) return;
      var id = button.getAttribute("data-id");
      var act = button.getAttribute("data-act");
      if (act === "book-edit") openBookForm(id);
      else if (act === "book-on") changeShelfStatus(id, "on_shelf");
      else if (act === "book-off") changeShelfStatus(id, "off_shelf");
    };
    wrap.onchange = function (event) {
      var input = event.target.closest("input[data-book-check]");
      if (!input) return;
      var id = input.getAttribute("data-book-check");
      if (input.checked) selected[id] = true; else delete selected[id];
      syncSelectAll();
      updateBatchButton();
    };

    var allBox = document.getElementById("bookSelectAll");
    if (allBox) {
      var onThisPage = rows.filter(function (b) { return selected[b.id]; }).length;
      allBox.checked = rows.length > 0 && onThisPage === rows.length;
      allBox.onchange = function () {
        var on = allBox.checked;
        rows.forEach(function (b) { if (on) selected[b.id] = true; else delete selected[b.id]; });
        wrap.querySelectorAll("input[data-book-check]").forEach(function (el) { el.checked = on; });
        updateBatchButton();
      };
    }

    renderBooksPager(all.length, page, totalPages, pageSize);
    updateBatchButton();
  }

  function syncSelectAll() {
    var box = document.getElementById("bookSelectAll");
    if (!box) return;
    var checks = document.querySelectorAll("#booksTableWrap input[data-book-check]");
    var n = 0, on = 0;
    Array.prototype.forEach.call(checks, function (el) { n += 1; if (el.checked) on += 1; });
    box.checked = n > 0 && n === on;
  }

  function updateBatchButton() {
    var btn = document.getElementById("bookBatchDelete");
    if (!btn) return;
    var n = selectedIds().length;
    btn.disabled = n === 0;
    btn.textContent = n ? "删除选中 (" + n + ")" : "删除选中";
  }

  /** 页码序列：页数多时中间用省略号，始终保留首末页 */
  function pageNumbers(page, totalPages) {
    var out = [];
    if (totalPages <= 7) {
      for (var i = 1; i <= totalPages; i += 1) out.push(i);
      return out;
    }
    out.push(1);
    var start = Math.max(2, page - 2);
    var end = Math.min(totalPages - 1, page + 2);
    if (start > 2) out.push("...");
    for (var j = start; j <= end; j += 1) out.push(j);
    if (end < totalPages - 1) out.push("...");
    out.push(totalPages);
    return out;
  }

  function renderBooksPager(total, page, totalPages, pageSize) {
    var box = document.getElementById("booksPager");
    if (!box) return;
    if (!total) { box.innerHTML = ""; return; }

    var parts = [];
    parts.push('<button class="pager-btn" type="button" data-page="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + ">上一页</button>");
    pageNumbers(page, totalPages).forEach(function (n) {
      if (n === "...") { parts.push('<span class="pager-gap">…</span>'); return; }
      parts.push('<button class="pager-num' + (n === page ? " is-active" : "") + '" type="button" data-page="' + n + '">' + n + "</button>");
    });
    parts.push('<button class="pager-btn" type="button" data-page="' + (page + 1) + '"' + (page >= totalPages ? " disabled" : "") + ">下一页</button>");
    parts.push('<span class="pager-info">共 ' + total + " 种 · 第 " + page + "/" + totalPages + " 页</span>");
    parts.push('<select class="select" id="booksPageSize" style="height:36px">' +
      [20, 50, 100].map(function (n) {
        return '<option value="' + n + '"' + (n === pageSize ? " selected" : "") + ">每页 " + n + " 条</option>";
      }).join("") + "</select>");
    box.innerHTML = parts.join("");

    box.onclick = function (event) {
      var target = event.target.closest("button[data-page]");
      if (!target || target.disabled) return;
      var next = Number(target.getAttribute("data-page"));
      if (!next || next < 1 || next > totalPages) return;
      C.state.bookFilter.page = next;
      updateBooksTable();
      var table = document.getElementById("booksTableWrap");
      if (table && table.scrollIntoView) table.scrollIntoView({ block: "nearest" });
    };
    var sizeSel = document.getElementById("booksPageSize");
    if (sizeSel) sizeSel.onchange = function () {
      C.state.bookFilter.size = Number(this.value) || 20;
      C.state.bookFilter.page = 1;
      updateBooksTable();
    };
  }

  function deleteSelected() {
    var ids = selectedIds();
    if (!ids.length) return;
    var picked = cache.filter(function (b) { return selected[b.id]; });
    var sample = picked.slice(0, 3).map(function (b) { return "《" + b.title + "》"; }).join("、");

    window.TataUI.confirm({
      icon: "archive",
      title: "删除图书",
      danger: true,
      confirmText: "确认删除 (" + ids.length + ")",
      desc: "确认删除选中的 " + ids.length + " 本图书" +
        (sample ? "（" + sample + (ids.length > 3 ? " 等" : "") + "）" : "") +
        "？删除为软删除：读者端立即不可见，借阅记录保留，可在「已下架」里恢复。",
      onConfirm: async function () {
        var res = await api().deleteBooks(ids);
        if (!res.ok) { C.toast("删除失败：" + res.message, "error"); return false; }
        var d = res.data || {};
        C.toast("已删除 " + (d.deleted || 0) + " 本图书");
        selected = {};
        cacheReady = false;
        await renderBooks();
        return true;
      }
    });
  }

  function findBook(id) {
    for (var i = 0; i < cache.length; i++) {
      if (String(cache[i].id) === String(id)) return cache[i];
    }
    return null;
  }

  function changeShelfStatus(id, status) {
    var book = findBook(id);
    if (!book) return;
    var run = async function () {
      var res = status === "off_shelf"
        ? await api().removeBook(id)
        : await api().restoreBook(id);
      if (!res.ok) { C.toast(res.message, "error"); return false; }
      C.toast(status === "off_shelf" ? "已下架《" + book.title + "》" : "已上架《" + book.title + "》");
      cacheReady = false;
      await renderBooks();
      return true;
    };
    if (status === "off_shelf") {
      window.TataUI.confirm({
        icon: "archive",
        title: "下架图书",
        desc: "确认将《" + book.title + "》下架？下架后读者端不再展示，借阅记录保留，可随时恢复上架。",
        confirmText: "确认下架",
        danger: true,
        onConfirm: run
      });
      return;
    }
    run();
  }

  function openBookForm(id) {
    var book = id ? findBook(id) : null;
    var coverFile = null;
    var categories = api().categories().map(function (c) { return c.name; });
    var currentCover = book && book.coverUrl ? "/" + book.coverUrl : "";

    var body = [
      '<form class="modal-form" id="bookForm" onsubmit="return false">',
      '  <div class="form-row">',
      '    <label class="field"><span>书名 *</span><input id="bfTitle" value="' + esc(book ? book.title : "") + '" placeholder="例如：数据库系统概论"></label>',
      '    <label class="field"><span>作者 *</span><input id="bfAuthor" value="' + esc(book ? book.author : "") + '" placeholder="作者姓名"></label>',
      "  </div>",
      '  <div class="form-row three">',
      '    <label class="field"><span>分类 *</span><input id="bfCategory" list="bfCategories" value="' + esc(book ? book.category : "") + '" placeholder="选择或输入分类名"></label>',
      '    <label class="field"><span>ISBN *</span><input id="bfIsbn" value="' + esc(book ? book.isbn : "") + '" placeholder="978-..."></label>',
      '    <label class="field"><span>出版社</span><input id="bfPublisher" value="' + esc(book ? book.publisher : "") + '"></label>',
      "  </div>",
      '  <div class="form-row three">',
      '    <label class="field"><span>出版年</span><input id="bfYear" type="number" min="1900" max="2100" value="' + (book && book.year ? book.year : new Date().getFullYear()) + '"></label>',
      '    <label class="field"><span>新增馆藏册数</span><input id="bfCopies" type="number" min="0" max="50" value="' + (book ? 0 : 1) + '"><small>会调用借阅服务登记副本（barcode 自动生成）；已上架的书只能追加，不能减少。</small></label>',
      "  </div>",
      '  <p class="hint">馆藏册数属于借阅模块（loan.book_copy），这里通过借阅服务的接口登记，不直接写 loan 表。</p>',
      '  <label class="field"><span>简介</span><textarea id="bfDesc" rows="3">' + esc(book ? book.desc : "") + "</textarea></label>",
      '  <div class="form-row">',
      '    <label class="field"><span>封面图片</span><input id="bfCover" type="file" accept="image/png,image/jpeg"><small>PNG / JPEG，最大 2 MB；保存后立即生效。</small></label>',
      '    <label class="field"><span>电子书 PDF</span><input id="bfEbook" type="file" accept="application/pdf"><small>上传后所有读者都能下载；已有 PDF 会被覆盖，最大 80 MB。</small></label>',
      '    <div class="field"><span>预览</span><div id="bfPreview" style="min-height:96px">' +
        (currentCover ? '<img src="' + esc(currentCover) + '" alt="" style="width:72px;border-radius:8px">' : '<span class="hint">暂无封面</span>') +
        "</div></div>",
      "  </div>",
      "</form>",
      '<datalist id="bfCategories">' + categories.map(function (c) { return '<option value="' + esc(c) + '">'; }).join("") + "</datalist>"
    ].join("");

    window.TataUI.modal({
      title: book ? "编辑图书" : "新增图书",
      desc: book ? "保存后写入 catalog.book，读者端立即生效。" : "新增图书默认在架，读者可立即检索到。",
      bodyHtml: body,
      wide: true,
      confirmText: "保存",
      onConfirm: async function () {
        var title = document.getElementById("bfTitle").value.trim();
        var author = document.getElementById("bfAuthor").value.trim();
        var category = document.getElementById("bfCategory").value.trim();
        var isbn = document.getElementById("bfIsbn").value.trim();
        if (!title || !author || !category || !isbn) {
          C.toast("书名、作者、分类、ISBN 都不能为空", "error");
          return false;
        }
        var addCopies = Number(document.getElementById("bfCopies").value) || 0;
        var payload = {
          isbn: isbn,
          title: title,
          category: category,
          author: author,
          publisher: document.getElementById("bfPublisher").value.trim(),
          year: Number(document.getElementById("bfYear").value) || null,
          summary: document.getElementById("bfDesc").value.trim(),
          // 馆藏册数落 catalog.book.total_copies；实际副本仍由借阅服务登记
          totalCopies: book ? ((book.total || 0) + addCopies) : addCopies
        };
        var res = await api().saveBook(payload, book ? book.id : null);
        if (!res.ok) { C.toast("保存失败：" + res.message, "error"); return false; }

        var targetId = book ? book.id : (res.data && res.data.bookId);

        // 电子书：选了文件就先上传，失败要明确报出来，不能静默当成功
        var ebookInput = document.getElementById("bfEbook");
        if (targetId && ebookInput && ebookInput.files && ebookInput.files[0]) {
          var up = await api().uploadEbook(targetId, ebookInput.files[0]);
          if (!up.ok) { C.toast("电子书上传失败：" + up.message, "error"); return false; }
          C.toast("电子书已上传，读者可下载");
        }

        // 登记副本：后端 /api/copies/batch 一次补齐到目标册数（含快照 upsert）
        if (targetId && addCopies > 0) {
          var cpRes = await api().batchCopies({
            bookId: targetId, title: title, isbn: isbn,
            copies: book ? ((book.total || 0) + addCopies) : addCopies
          });
          if (!cpRes.ok) C.toast("副本登记失败：" + cpRes.message, "warn");
          else C.toast("已登记 " + ((cpRes.data && cpRes.data.created) || 0) + " 册副本");
        }

        if (coverFile && targetId) {
          var up = await api().uploadCover(targetId, coverFile);
          if (!up.ok) C.toast("封面未上传：" + up.message, "warn");
        }
        C.toast(book ? "已更新《" + title + "》" : "已新增《" + title + "》");
        // 新增/修改后重置筛选，否则新的书可能被当前的分类/状态筛选挡住，看起来像"没保存"
        C.state.bookFilter.q = "";
        C.state.bookFilter.cat = "全部";
        C.state.bookFilter.shelf = "all";
        cacheReady = false;
        await renderBooks();
        return true;
      }
    });

    var fileInput = document.getElementById("bfCover");
    fileInput.addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { C.toast("图片不能超过 2 MB", "error"); this.value = ""; return; }
      coverFile = file;
      document.getElementById("bfPreview").innerHTML =
        '<img src="' + URL.createObjectURL(file) + '" alt="" style="width:72px;border-radius:8px">';
    });
  }

  async function renderBorrows() {
    C.setActions([
      C.can("data:export") ? '<button class="btn btn-ghost btn-sm" type="button" data-hact="exportborrows">' + C.icon("download") + "导出 CSV</button>" : "",
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="refreshborrows">' + C.icon("refresh") + "刷新</button>"
    ].join(""));
    var filter = C.state.borrowFilter;
    // 每次进入借阅页都重新拉一次，否则看到的是登录时的旧快照
    var fresh = await api().refreshLoans();
    C.body().innerHTML = [
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>借阅记录</h2><p>数据来自借阅模块 loan-service（loan.loan_record ⋈ loan.book_snapshot）</p></div></div>',
      '  <div class="toolbar">',
      '    <div class="segmented" id="borrowStatus">',
      ["all|全部", "active|在借", "overdue|逾期", "returned|已归还"].map(function (item) {
        var pair = item.split("|");
        return '<button type="button" data-status="' + pair[0] + '" class="' + (filter.status === pair[0] ? "is-active" : "") + '">' + pair[1] + "</button>";
      }).join(""),
      "    </div>",
      '    <input class="input search" id="borrowSearch" type="search" placeholder="搜索读者 / 图书 / 条码" value="' + esc(filter.q) + '">',
      "  </div>",
      '  <div id="borrowsTableWrap"></div>',
      "</div>"
    ].join("");
    updateBorrowsTable();
    if (!fresh.ok) C.toast("借阅记录刷新失败：" + fresh.message, "warn");
    document.getElementById("borrowStatus").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-status]");
      if (!button) return;
      filter.status = button.getAttribute("data-status");
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (b) {
        b.classList.toggle("is-active", b === button);
      });
      updateBorrowsTable();
    });
    document.getElementById("borrowSearch").addEventListener("input", function () {
      filter.q = this.value;
      updateBorrowsTable();
    });
  }

  function updateBorrowsTable() {
    var wrap = document.getElementById("borrowsTableWrap");
    if (!wrap) return;
    var filter = C.state.borrowFilter;
    var rows = api().listBorrows({ status: filter.status });
    var q = (filter.q || "").trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (r) {
        return [r.book_title, r.barcode, String(r.user_id)].join(" ").toLowerCase().indexOf(q) !== -1;
      });
    }
    var cols = [
      { key: "borrow_id", label: "借阅号", render: function (r) { return '<span class="mono small">' + esc(r.loan_id) + "</span>"; } },
      { key: "user", label: "读者", render: function (r) { return '<span class="strong">#' + esc(r.user_id) + "</span>"; } },
      { key: "book_title", label: "图书", render: function (r) {
        return '<span class="strong">' + esc(r.book_title) + '</span><div class="small muted">' + esc(r.barcode || "") + "</div>";
      } },
      { key: "borrowed_at", label: "借出 / 应还", render: function (r) {
        return '<span class="nowrap">' + C.fmtDate(r.borrowed_at) + " → " + C.fmtDate(r.due_at) + "</span>";
      } },
      { key: "status", label: "状态", render: function (r) {
        var label = r.status === "BORROWED" ? (r.overdue ? "逾期" : "在借") : "已归还";
        var tone = r.status === "BORROWED" ? (r.overdue ? "red" : "blue") : "green";
        return C.badge(label, tone);
      } },
      { key: "returned_at", label: "归还时间", render: function (r) {
        return r.returned_at ? '<span class="nowrap small">' + C.fmtDateTime(r.returned_at) + "</span>" : '<span class="muted small">—</span>';
      } },
      { key: "actions", label: "操作", render: function (r) {
        // 已归还的记录没有可执行动作；没有归还权限的身份只读
        if (r.status !== "BORROWED") return '<span class="muted small">—</span>';
        if (!C.can("borrow:manage")) return '<span class="muted small">只读</span>';
        return '<div class="row-actions">' +
          '<button class="link-btn primary" type="button" data-act="loan-return" data-id="' + esc(r.loan_id) + '">归还</button>' +
          "</div>";
      } }
    ];
    wrap.innerHTML = C.tableHtml(cols, rows, "没有借阅记录");
    wrap.onclick = function (event) {
      var button = event.target.closest("button[data-act]");
      if (!button) return;
      if (button.getAttribute("data-act") === "loan-return") returnLoan(button.getAttribute("data-id"));
    };
  }

  // 归还：走借阅服务的 POST /api/loans/{id}/return（内部调用 loan.sp_return_copy，
  // 归还后副本由存储过程恢复为 AVAILABLE，借阅记录保留）。前端只负责确认与刷新。
  function returnLoan(id) {
    var rows = api().listBorrows({ status: "all" });
    var row = null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].loan_id) === String(id)) { row = rows[i]; break; }
    }
    if (!row) return;
    if (row.status !== "BORROWED") { C.toast("该借阅已归还", "warn"); return; }

    window.TataUI.confirm({
      icon: "refresh",
      title: "确认归还",
      desc: "确认归还《" + row.book_title + "》（条码 " + (row.barcode || "—") + "）？" +
        "归还后该副本立即恢复可借，借阅记录保留可查。",
      confirmText: "确认归还",
      onConfirm: async function () {
        var res = await api().returnBook(row.loan_id);
        if (!res.ok) {
          var msg = String(res.message || "");
          if (/FORBIDDEN/i.test(msg)) msg = "当前身份没有归还他人借阅的权限";
          else if (/LOAN_NOT_FOUND/i.test(msg)) msg = "借阅记录不存在";
          else if (/DATABASE_ERROR/i.test(msg)) msg = "数据库暂时不可用，请稍后重试";
          C.toast("归还失败：" + msg, "error");
          return false;
        }
        C.toast("已归还《" + row.book_title + "》");
        // returnBook 内部已刷新全量缓存，这里只需重画表格
        await api().refreshLoans();
        updateBorrowsTable();
        return true;
      }
    });
  }

  C.registry.books = renderBooks;
  C.registry.borrows = renderBorrows;
  C.onchange.books = function () { updateBooksTable(); };
  C.onchange.borrows = function () { updateBorrowsTable(); };

  /** 并发受限的串行队列：书与书之间并行，同一本书的副本逐个登记（条码要连续） */
  async function mapLimit(list, limit, fn) {
    var cursor = 0;
    var out = new Array(list.length);
    async function worker() {
      while (cursor < list.length) {
        var i = cursor;
        cursor += 1;
        out[i] = await fn(list[i], i);
      }
    }
    var workers = [];
    for (var i = 0; i < Math.min(limit, list.length); i += 1) workers.push(worker());
    await Promise.all(workers);
    return out;
  }

  /**
   * 按 CSV 里的馆藏数登记副本。
   * catalog 侧只写 total_copies；真正能借的册数在 loan.book_copy，
   * 按项目约定由前端调借阅服务的 /api/book-snapshots + /api/copies 登记（与新增图书一致）。
   * 重复导入同一份 CSV 时只补差额，不会重复建副本。
   */
  async function registerCopies(items) {
    var list = (items || []).filter(function (it) {
      return Number(it.copies) > 0 && it.bookId;
    });
    if (!list.length) return { created: 0, failed: 0, books: 0 };

    await api().refreshCopies();   // 先刷新副本缓存，后端再按差额补登

    var results = await mapLimit(list, 4, async function (it) {
      // 后端 /api/copies/batch 一次补齐到 copies 册（已够则一册不加），
      // 比逐册 POST /api/copies 少两个数量级的请求，导入 200 本不会中途断。
      var res = await api().batchCopies(it);
      if (!res.ok) return { added: 0, failed: Number(it.copies) || 0, message: res.message };
      var made = (res.data && Number(res.data.created)) || 0;
      return { added: made, failed: 0 };
    });

    return results.reduce(function (acc, r) {
      acc.created += r.added;
      acc.failed += r.failed;
      if (r.added) acc.books += 1;
      if (r.message && !acc.message) acc.message = r.message;
      return acc;
    }, { created: 0, failed: 0, books: 0 });
  }

  C.handlers.addbook = function () {
    if (!C.can("book:write")) return C.toast("当前角色没有维护图书权限", "warn");
    openBookForm(null);
  };
  C.handlers.exportbooks = function () {
    window.location.href = api().exportBooksUrl("");
  };
  C.handlers.importbooks = function () {
    var old = document.getElementById("bookImportFile");
    if (old) old.remove();
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.id = "bookImportFile";
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      C.toast("正在导入 " + file.name + " …");
      var res = await api().importBooks(file);
      if (!res.ok) { C.toast("导入失败：" + res.message, "error"); return; }
      var d = res.data;

      var msg = "导入完成：新增 " + d.inserted + "，更新 " + d.updated + "，失败 " + d.failed;
      if (d.copiesColumn && d.items && d.items.length) {
        C.toast("正在按馆藏数登记副本…");
        var cp = await registerCopies(d.items);
        if (cp.created || cp.failed) {
          msg += "；登记副本 " + cp.created + " 册" +
            (cp.failed ? "（失败 " + cp.failed + " 册" + (cp.message ? "：" + cp.message : "") + "）" : "");
        }
      } else if (!d.copiesColumn) {
        msg += "；CSV 无 copies 列，未登记副本";
      }
      C.toast(msg, d.failed ? "warn" : "success");

      if (d.errors && d.errors.length) {
        var lines = d.errors.map(function (e) { return "第 " + e.line + " 行 " + e.isbn + "：" + e.reason; }).join("\n");
        window.TataUI.modal({
          title: "导入结果",
          desc: msg,
          bodyHtml: '<pre class="code-block small" style="white-space:pre-wrap">' + esc(lines) + "</pre>",
          confirmText: "知道了",
          cancelText: "",
          onConfirm: function () { return true; }
        });
      }
      C.state.bookFilter.q = "";
      C.state.bookFilter.cat = "全部";
      C.state.bookFilter.shelf = "all";
      C.state.bookFilter.page = 1;
      selected = {};
      cacheReady = false;         // renderBooks → loadBooks 会先刷新副本统计再取书目
      await renderBooks();
      input.remove();
    };
    input.click();
  };
  C.handlers.refreshborrows = function () { renderBorrows(); };
  C.handlers.exportborrows = function () {
    var rows = api().listBorrows({ status: C.state.borrowFilter.status });
    var csv = ["loan_id,user_id,book_id,title,barcode,status,borrowed_at,due_at,returned_at"];
    rows.forEach(function (r) {
      csv.push([r.loan_id, r.user_id, r.book_id, r.book_title, r.barcode || "", r.status,
        r.borrowed_at || "", r.due_at || "", r.returned_at || ""].map(function (v) {
        var s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(","));
    });
    window.TataUI.download("loan-records.csv", "\uFEFF" + csv.join("\n"), "text/csv;charset=utf-8");
  };
})();
