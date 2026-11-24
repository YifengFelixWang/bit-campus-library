import { computed, ref, watch } from "../../vendor/vue.esm-browser.prod.js";
import { store } from "../store.js";
import { api } from "../services/api.js";
import { fmtDate, bookScore, scoreText } from "../core/utils.js";
import {
  detailState, closeBookDetail, openBookDetail, openPdfPreview, closePdfPreview
} from "../core/book-detail.js";
import { openLogin } from "../core/login.js";
import { openReview } from "../core/review.js";
import { requestBorrow, requestReturn } from "../composables/useLibraryActions.js";

export default {
  name: "BookDetailModal",
  setup() {
    const book = computed(function () {
      const revision = store.revision;
      if (!detailState.bookId) return null;
      return api.bookById(detailState.bookId);
    });
    const user = computed(function () { return store.user; });
    const active = computed(function () {
      if (!store.user) return [];
      return api.activeBorrowsOf(store.user.id);
    });
    const record = computed(function () {
      if (!book.value) return null;
      return active.value.filter(function (b) { return b.book_id === book.value.id; })[0] || null;
    });
    const left = computed(function () { return book.value ? api.availability(book.value) : 0; });
    const notOnShelf = computed(function () { return Boolean(book.value && book.value.shelf_status && book.value.shelf_status !== "on_shelf"); });
    const shelfLabel = computed(function () {
      if (!book.value) return "已上架";
      return book.value.shelf_status === "warehouse" ? "仓库待上架" : (book.value.shelf_status === "off_shelf" ? "已下架" : "已上架");
    });
    // 电子书：向后端问一次有没有 PDF，有就给下载，没有就明说「后端暂无 PDF 版」
    const ebook = ref(null);
    const ebookLoading = ref(false);
    watch(function () { return detailState.bookId; }, function (id) {
      ebook.value = null;
      if (!id) return;
      ebookLoading.value = true;
      api.ebookMeta(id).then(function (res) {
        if (detailState.bookId === id) ebook.value = res.ok ? res.data : null;
      }).catch(function () { ebook.value = null; }).then(function () { ebookLoading.value = false; });
    }, { immediate: true });
    const ebookAvailable = computed(function () { return Boolean(ebook.value && ebook.value.available); });
    const ebookUrl = computed(function () { return ebook.value && ebook.value.url ? ebook.value.url : "#"; });
    const ebookFileName = computed(function () { return (ebook.value && ebook.value.fileName) || "电子书.pdf"; });
    const ebookSizeText = computed(function () {
      const n = Number(ebook.value && ebook.value.sizeBytes);
      if (!n) return "PDF";
      return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
    });
    const canUploadEbook = computed(function () { return api.can("book:write", store.user); });
    const coverUrl = computed(function () { return book.value ? api.coverUrl(book.value) : ""; });
    const stockText = computed(function () {
      if (!book.value) return "";
      if (record.value) return "在借中";
      if (notOnShelf.value) return shelfLabel.value;
      return left.value > 0 ? "可借 " + left.value + " 本" : "已借完";
    });
    const stockClass = computed(function () {
      if (record.value) return " mine";
      if (notOnShelf.value || left.value <= 0) return " out";
      return "";
    });
    const reviews = computed(function () {
      const revision = store.revision;
      if (!book.value) return [];
      return api.reviewsFor(book.value.id, { type: "review" }).filter(function (r) {
        return r.status === "visible";
      });
    });
    const myReview = computed(function () {
      if (!user.value) return null;
      return reviews.value.filter(function (r) { return r.user_id === user.value.id; })[0] || null;
    });
    const returned = computed(function () {
      return user.value && book.value ? api.hasReturned(user.value.id, book.value.id) : false;
    });
    const canWriteRating = computed(function () {
      return Boolean(user.value && user.value.role === "reader" && api.can("rating:write"));
    });
    const canReview = computed(function () {
      return Boolean(canWriteRating.value && returned.value);
    });
    const score = computed(function () { return book.value ? bookScore(book.value) : null; });
    const scoreLabel = computed(function () {
      return score.value === null ? "暂无" : score.value.toFixed(1);
    });
    const reviewSummary = computed(function () {
      if (!book.value) return "暂无评分";
      return book.value.rating_count ? scoreText(book.value) + " / 10 · " + book.value.rating_count + " 人评价" : "暂无评分";
    });
    const actionsDisabledText = computed(function () {
      return notOnShelf.value ? "暂未上架" : "已借完";
    });

    function close() { closeBookDetail(); }
    function borrow() {
      const id = book.value.id;
      close();
      requestBorrow(id);
    }
    function giveBack() {
      const id = record.value.id;
      close();
      requestReturn(id);
    }
    function preview() { openPdfPreview(book.value.id); }
    function loginToRead() {
      const id = book.value.id;
      close();
      openLogin("登录后即可试读《" + book.value.title + "》前 10 页", function () { openBookDetail(id); });
    }
    function writeReview() {
      const id = book.value.id;
      close();
      openReview(id);
    }
    function loginToReview() {
      const id = book.value.id;
      close();
      openLogin("登录并归还图书后即可评价", function () {
        openBookDetail(id);
      });
    }
    return {
      detailState, book, user, record, left, notOnShelf, shelfLabel,
      coverUrl, stockText, stockClass, reviews, myReview, returned, canWriteRating, canReview, score,
      ebook, ebookLoading, ebookAvailable, ebookUrl, ebookFileName, ebookSizeText, canUploadEbook,
      scoreLabel, reviewSummary, actionsDisabledText, fmtDate,
      close, borrow, giveBack, preview, loginToRead, writeReview, loginToReview,
      closePdfPreview
    };
  },
  template: `
    <div v-if="detailState.visible && book" class="modal-backdrop" id="bookDetailModal" @click.self="close">
      <div class="modal wide" role="dialog" aria-modal="true" aria-label="图书详情">
        <button class="modal-close" type="button" aria-label="关闭" @click="close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
        <div class="book-detail">
          <div class="bd-cover">
            <img v-if="coverUrl" class="bd-cover-img" :src="coverUrl" :alt="book.title + ' 封面'">
            <div v-else class="bd-cover-fallback" :style="{ '--c1': book.colors[0], '--c2': book.colors[1] }">
              <span>{{ book.category }}</span>
              <strong>{{ book.title }}</strong>
              <em>{{ book.author }}</em>
            </div>
          </div>
          <div class="bd-main">
            <span class="badge blue bd-cat">{{ book.category }}</span>
            <h3 class="bd-title">{{ book.title }}</h3>
            <p class="bd-author">{{ book.author }}</p>
            <div class="bd-stats">
              <span class="bd-stat">评分 <b>{{ scoreLabel }} <em v-if="score !== null">/ 10</em></b></span>
              <span class="bd-stat">借阅 <b>{{ book.borrows }}</b></span>
              <span class="bd-stat">库存 <b>{{ left }} / {{ book.total }}</b></span>
              <span class="bd-stat"><span class="stock" :class="stockClass">{{ stockText }}</span></span>
            </div>
            <p class="bd-desc">{{ book.desc || "暂无简介" }}</p>
            <div class="bd-meta">
              <div><span>ISBN</span><b>{{ book.isbn || "—" }}</b></div>
              <div><span>出版社</span><b>{{ book.publisher || "—" }}</b></div>
              <div><span>出版年</span><b>{{ book.year || "—" }}</b></div>
              <div><span>上架状态</span><b>{{ shelfLabel }}</b></div>
              <div><span>评分人数</span><b>{{ book.rating_count || 0 }}</b></div>
              <div><span>电子书</span><b>{{ ebookLoading ? "读取中…" : (ebookAvailable ? "可下载 PDF" : "暂无 PDF") }}</b></div>
            </div>

            <div class="bd-read" :class="{ locked: !ebookAvailable }" id="ebookCard">
              <span class="bd-read-icon" :class="{ unlocked: ebookAvailable }"><svg class="icon" aria-hidden="true"><use href="#i-doc"></use></svg></span>
              <div class="bd-read-text">
                <strong>电子书下载</strong>
                <span v-if="ebookLoading">正在确认后端是否提供 PDF…</span>
                <span v-else-if="ebookAvailable">{{ ebookFileName }} · {{ ebookSizeText }}</span>
                <span v-else>后端暂无 PDF 版<template v-if="canUploadEbook">，可在控制台「图书管理」上传</template></span>
              </div>
              <a v-if="ebookAvailable" class="btn btn-primary btn-sm" id="ebookDownload" :href="ebookUrl" download>下载 PDF</a>
            </div>

            <div class="bd-reviews">
              <div class="bd-reviews-head"><strong>读者评价</strong><span>{{ reviewSummary }}</span></div>
              <div v-if="reviews.length" class="bd-review-list">
                <div v-for="r in reviews.slice(0, 3)" :key="r.review_id || r.id" class="bd-review">
                  <div class="bd-review-top">
                    <strong>{{ r.user_name }}</strong>
                    <span class="stars" role="img" :aria-label="r.rating + ' 星'">
                      <i v-for="n in 5" :key="n" :class="{ on: n <= r.rating }">★</i>
                    </span>
                    <span>{{ fmtDate(r.created_at) }}</span>
                  </div>
                  <p v-if="r.content">{{ r.content }}</p>
                  <p v-else class="muted">（未填写文字）</p>
                </div>
              </div>
              <p v-else class="bd-review-empty">还没有读者评价，归还后可以成为第一个评价的人。</p>
              <div class="bd-review-foot">
                <button v-if="!user" class="btn btn-ghost btn-sm" type="button" data-detail-review-login @click="loginToReview">登录后评价</button>
                <span v-else-if="!canWriteRating" class="bd-review-hint">读者账号可提交评价</span>
                <button v-else-if="canReview" class="btn btn-primary btn-sm" type="button" data-detail-review @click="writeReview">{{ myReview ? '修改我的评价' : '评价本书' }}</button>
                <span v-else class="bd-review-hint">归还本书后即可评价</span>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" @click="close">关闭</button>
          <button v-if="record" class="btn btn-primary" type="button" :data-detail-return="record.id" @click="giveBack">归还本书</button>
          <button v-else-if="!notOnShelf && left > 0" class="btn btn-primary" type="button" :data-detail-borrow="book.id" @click="borrow">{{ user ? '借阅本书' : '登录后借阅' }}</button>
          <button v-else class="btn btn-primary" type="button" disabled>{{ actionsDisabledText }}</button>
        </div>
      </div>
    </div>

    <div v-if="detailState.pdfVisible" class="modal-backdrop" id="pdfPreviewModal" @click.self="closePdfPreview">
      <div class="modal wide" role="dialog" aria-modal="true" aria-label="PDF 试读">
        <button class="modal-close" type="button" aria-label="关闭" @click="closePdfPreview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
        <h2>PDF 试读 · {{ book ? book.title : "" }}</h2>
        <p>正在从数据库读取 PDF，并在前端截取前 10 页…</p>
        <div class="pdf-preview" id="pdfPreview">
          <div v-if="detailState.pdfLoading" class="pdf-loading"><span class="pdf-spinner"></span><span>正在解析 PDF…</span></div>
          <div v-else-if="detailState.pdfError" class="pdf-error"><strong>PDF 解析失败</strong><span>{{ detailState.pdfError }}</span></div>
          <template v-else>
            <iframe class="pdf-frame" :src="detailState.pdfUrl" :title="'《' + book.title + '》前 10 页试读'"></iframe>
            <div class="pdf-note">仅展示前 {{ detailState.pdfShown }} 页，全书共 {{ detailState.pdfTotal }} 页 · 文件读取自数据库 pdf_blob</div>
          </template>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" @click="closePdfPreview">返回详情</button>
          <button class="btn btn-primary" type="button" @click="closePdfPreview">关闭</button>
        </div>
      </div>
    </div>
  `
};
