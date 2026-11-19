(function () {
  "use strict";

  var C = window.TataCore;
  var esc = C.esc;

  function filterState() {
    if (!C.state.reviewFilter) C.state.reviewFilter = { q: "", status: "all" };
    return C.state.reviewFilter;
  }

  function allReviews() {
    return window.TataDB.reviewsFor(null, { type: "review" });
  }

  function stars(rating) {
    var count = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    var out = "";
    for (var i = 1; i <= 5; i++) out += '<i class="' + (i <= count ? "on" : "") + '">★</i>';
    return '<span class="stars" role="img" aria-label="' + count + ' 星">' + out + "</span>" +
      '<div class="small muted">' + count + " 星 · 折合 " + (count * 2).toFixed(1) + " 分</div>";
  }

  function renderReviews() {
    var filter = filterState();
    var rows = allReviews();
    var visible = rows.filter(function (r) { return r.status === "visible"; }).length;
    var hidden = rows.length - visible;
    C.setActions([
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="refreshreviews">' + C.icon("refresh") + "刷新评价</button>"
    ].join(""));
    C.body().innerHTML = [
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>读者评价</h2><p>读者归还图书后可提交 1–5 星评分与选填文字；超级管理员与图书管理员可编辑星级与文字、隐藏或删除评价。图书得分 = 平均星级 × 2（十分制），修改后立即重算。</p></div>',
      '    <span class="pill">' + rows.length + ' 条 · 显示 ' + visible + ' · 隐藏 ' + hidden + "</span>",
      "  </div>",
      '  <div class="hint" style="margin-bottom:12px">评分来源为读者反馈；管理端可执行「编辑」修正星级与文字，「隐藏」暂不参与评分，「删除」则永久移除并按剩余评价重新计算图书得分。</div>',
      '  <div class="toolbar">',
      '    <div class="segmented" id="reviewStatus">',
      ["all|全部", "visible|显示中", "hidden|已隐藏"].map(function (item) {
        var pair = item.split("|");
        return '<button type="button" data-status="' + pair[0] + '" class="' + (filter.status === pair[0] ? "is-active" : "") + '">' + pair[1] + "</button>";
      }).join(""),
      "    </div>",
      '    <input class="input search" id="reviewSearch" type="search" placeholder="搜索图书 / 读者 / 评价内容" value="' + esc(filter.q) + '">',
      "  </div>",
      '  <div id="reviewsTableWrap"></div>',
      "</div>"
    ].join("");
    updateReviewsTable();
    document.getElementById("reviewStatus").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-status]");
      if (!button) return;
      filter.status = button.getAttribute("data-status");
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (b) {
        b.classList.toggle("is-active", b === button);
      });
      updateReviewsTable();
    });
    document.getElementById("reviewSearch").addEventListener("input", function () {
      filter.q = this.value;
      updateReviewsTable();
    });
  }

  function updateReviewsTable() {
    var wrap = document.getElementById("reviewsTableWrap");
    if (!wrap) return;
    var filter = filterState();
    var rows = allReviews();
    if (filter.status !== "all") {
      rows = rows.filter(function (r) { return r.status === filter.status; });
    }
    if (filter.q.trim()) {
      var q = filter.q.trim().toLowerCase();
      rows = rows.filter(function (r) {
        return [r.book_title, r.user_name, r.username, r.content].join(" ").toLowerCase().indexOf(q) !== -1;
      });
    }
    var cols = [
      { key: "book", label: "图书", render: function (r) {
        return '<span class="strong">' + esc(r.book_title) + '</span><div class="small muted">' + esc(r.book_id) + "</div>";
      } },
      { key: "user", label: "读者", render: function (r) {
        return '<span class="strong">' + esc(r.user_name) + '</span><div class="small muted">' + esc(r.username) + "</div>";
      } },
      { key: "rating", label: "星级", render: function (r) { return stars(r.rating); } },
      { key: "content", label: "评价内容", render: function (r) {
        var text = r.content || "（仅评分，未填写文字）";
        return '<span class="small' + (r.content ? "" : " muted") + '">' + esc(text.length > 90 ? text.slice(0, 90) + "…" : text) + "</span>";
      } },
      { key: "status", label: "状态", render: function (r) {
        return r.status === "visible" ? C.badge("显示中", "green") : C.badge("已隐藏", "gray");
      } },
      { key: "created_at", label: "提交时间", render: function (r) {
        return '<span class="nowrap small">' + C.fmtDateTime(r.created_at) + "</span>";
      } },
      { key: "actions", label: "操作", render: function (r) {
        return '<div class="row-actions">' +
          '<button class="link-btn primary" type="button" data-act="review-edit" data-id="' + esc(r.id) + '">编辑</button>' +
          '<button class="link-btn" type="button" data-act="review-toggle" data-id="' + esc(r.id) + '" data-status="' + esc(r.status) + '">' + (r.status === "visible" ? "隐藏" : "恢复") + "</button>" +
          '<button class="link-btn danger" type="button" data-act="review-delete" data-id="' + esc(r.id) + '">删除</button>' +
          "</div>";
      } }
    ];
    wrap.innerHTML = C.tableHtml(cols, rows, "暂无读者评价");
    wrap.onclick = function (event) {
      var button = event.target.closest("button[data-act]");
      if (!button) return;
      var id = button.getAttribute("data-id");
      var act = button.getAttribute("data-act");
      if (act === "review-edit") openReviewEditor(id);
      else if (act === "review-delete") deleteReview(id);
      else if (act === "review-toggle") toggleReview(id, button.getAttribute("data-status"));
    };
  }

  function openReviewEditor(id) {
    var review = allReviews().filter(function (r) { return r.id === id; })[0];
    if (!review) {
      C.toast("评价不存在或已被删除", "error");
      return;
    }
    var selected = Math.max(1, Math.min(5, Math.round(Number(review.rating) || 1)));
    var starButtons = [1, 2, 3, 4, 5].map(function (n) {
      return '<button type="button" class="star-btn' + (n <= selected ? " is-on" : "") + '" data-star="' + n + '" role="radio" aria-checked="' + (n === selected) + '" aria-label="' + n + ' 星">★</button>';
    }).join("");
    var body = [
      '<form class="modal-form" onsubmit="return false">',
      '  <div class="review-book">',
      '    <span class="mini-cover">' + esc((review.book_title || "?").charAt(0)) + "</span>",
      '    <div><strong>' + esc(review.book_title) + '</strong><span>读者 ' + esc(review.user_name) + "（" + esc(review.username) + "）</span></div>",
      "  </div>",
      '  <div class="field">',
      '    <span>评分 *</span>',
      '    <div class="star-picker" id="rvStars" data-value="' + selected + '" role="radiogroup" aria-label="选择 1 到 5 星">' + starButtons + "</div>",
      '    <small id="rvStarHint">当前 ' + selected + " 星，可重新选择</small>",
      "  </div>",
      '  <label class="field"><span>评价内容（选填）</span><textarea id="rvContent" maxlength="500" rows="4" placeholder="可留空，最多 500 字">' + esc(review.content || "") + "</textarea><small>文字内容可选填，用于修正不当内容或补充说明。</small></label>",
      '  <p class="form-error" id="rvError" hidden></p>',
      "</form>"
    ].join("");
    window.TataUI.modal({
      title: "编辑读者评价",
      desc: "图书得分为所有读者可见评价的平均星级 × 2；保存后立即重新计算。",
      bodyHtml: body,
      wide: true,
      confirmText: "保存修改",
      onConfirm: function () {
        var picker = document.getElementById("rvStars");
        var rating = picker ? Number(picker.getAttribute("data-value")) : 0;
        var contentEl = document.getElementById("rvContent");
        var errorEl = document.getElementById("rvError");
        if (!rating) {
          if (errorEl) {
            errorEl.textContent = "评分必填，请选择 1–5 星";
            errorEl.hidden = false;
          }
          return false;
        }
        var result = window.TataDB.updateReview(id, { rating: rating, content: contentEl ? contentEl.value : "" });
        if (!result.ok) {
          if (errorEl) {
            errorEl.textContent = result.message;
            errorEl.hidden = false;
          }
          return false;
        }
        C.toast(result.message);
        window.TataUI.refreshAll();
        renderReviews();
        return true;
      }
    });

    var picker = document.getElementById("rvStars");
    if (!picker) return;
    var buttons = picker.querySelectorAll(".star-btn");
    var paint = function (value) {
      Array.prototype.forEach.call(buttons, function (button) {
        var n = Number(button.getAttribute("data-star"));
        button.classList.toggle("is-on", n <= value);
        button.setAttribute("aria-checked", String(n === value));
      });
      picker.setAttribute("data-value", String(value));
      var hint = document.getElementById("rvStarHint");
      if (hint) hint.textContent = "已选择 " + value + " 星";
    };
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener("click", function () {
        paint(Number(button.getAttribute("data-star")));
        var errorEl = document.getElementById("rvError");
        if (errorEl) errorEl.hidden = true;
      });
      button.addEventListener("mouseenter", function () {
        var value = Number(button.getAttribute("data-star"));
        Array.prototype.forEach.call(buttons, function (b) {
          b.classList.toggle("is-hover", Number(b.getAttribute("data-star")) <= value);
        });
      });
    });
    picker.addEventListener("mouseleave", function () {
      Array.prototype.forEach.call(buttons, function (b) { b.classList.remove("is-hover"); });
    });
    paint(selected);
  }

  function deleteReview(id) {
    window.TataUI.confirm({
      icon: "x",
      title: "删除读者评价",
      desc: "删除后该评价会从图书评分中移除，图书平均星级与十分制得分会立即重新计算。此操作不可撤销。",
      confirmText: "确认删除",
      danger: true,
      onConfirm: function () {
        var result = window.TataDB.deleteReview(id);
        if (!result.ok) {
          C.toast(result.message, "error");
          return false;
        }
        C.toast(result.message);
        window.TataUI.refreshAll();
        renderReviews();
        return true;
      }
    });
  }

  function toggleReview(id, status) {
    var next = status === "visible" ? "hidden" : "visible";
    var result = window.TataDB.setReviewStatus(id, next);
    C.toast(result.message, result.ok ? "success" : "error");
    if (result.ok) {
      window.TataUI.refreshAll();
      renderReviews();
    }
  }

  C.registry.reviews = renderReviews;
  C.onchange.reviews = function () { renderReviews(); };
  C.handlers.refreshreviews = function () { renderReviews(); };
})();
