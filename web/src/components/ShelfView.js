import { computed } from "../../vendor/vue.esm-browser.prod.js";
import { store } from "../store.js";
import { api } from "../services/api.js";
import { fmtDate } from "../core/utils.js";
import { openLogin } from "../core/login.js";
import { openReview } from "../core/review.js";
import { requestReturn, goPopular } from "../composables/useLibraryActions.js";

export default {
  name: "ShelfView",
  props: {
    tab: { type: String, default: "borrows" }
  },
  setup() {
    const user = computed(function () { return store.user; });
    const activeEntries = computed(function () {
      if (!user.value) return [];
      return store.borrows.filter(function (row) {
        // 后端状态是大写 BORROWED / RETURNED，用大小写无关比较，避免把已归还的算进来
        return row.user_id === user.value.id && String(row.status).toUpperCase() === "BORROWED";
      });
    });
    const feedbackItems = computed(function () {
      if (!user.value || user.value.role !== "reader" || !api.can("rating:write")) return [];
      const returnedRows = store.borrows.filter(function (row) {
        return row.user_id === user.value.id && String(row.status).toUpperCase() === "RETURNED";
      });
      const latestByBook = {};
      returnedRows.forEach(function (row) {
        const old = latestByBook[row.book_id];
        if (!old || new Date(row.returned_at) > new Date(old.returned_at)) latestByBook[row.book_id] = row;
      });
      const reviewByBook = {};
      store.reviews.filter(function (r) { return r.user_id === user.value.id; }).forEach(function (r) {
        reviewByBook[r.book_id] = r;
      });
      const items = Object.keys(latestByBook).map(function (bookId) {
        return {
          book: api.bookById(bookId),
          borrow: latestByBook[bookId],
          review: reviewByBook[bookId] || null
        };
      }).filter(function (item) { return Boolean(item.book); });
      items.sort(function (a, b) {
        const aa = a.review ? 1 : 0;
        const bb = b.review ? 1 : 0;
        if (aa !== bb) return aa - bb;
        return new Date(b.borrow.returned_at) - new Date(a.borrow.returned_at);
      });
      return items;
    });
    const pendingReviews = computed(function () {
      return feedbackItems.value.filter(function (item) { return !item.review; }).length;
    });
    const borrowSummary = computed(function () {
      return user.value ? "共 " + activeEntries.value.length + " 本" : "未登录";
    });
    const feedbackSummary = computed(function () {
      if (!user.value) return "登录后评价";
      if (user.value.role !== "reader" || !api.can("rating:write")) return "仅读者";
      return "已归还 " + feedbackItems.value.length + " 本 · 待评价 " + pendingReviews.value + " 本";
    });
    const borrowEmpty = computed(function () {
      if (!user.value) {
        return { title: "登录后查看你的书架", text: "登录读者账号即可借阅图书，并在这里查看借期与归还入口。", button: "登录并借阅" };
      }
      return { title: "你的书架还空着", text: "从热门图书里挑一本，开启一段新的阅读旅程。", button: "去借一本" };
    });
    const feedbackEmpty = computed(function () {
      if (!user.value) {
        return { title: "登录后查看可评价的图书", text: "读者归还图书后，可以在评价区为这本书打星并写下阅读感受。", button: "登录读者账号", mode: "login" };
      }
      if (user.value.role !== "reader" || !api.can("rating:write")) {
        const roleText = api.roleLabel(user.value.role);
        return {
          title: "当前账号（" + roleText + "）不能提交评价",
          text: "评分与评价仅对读者账号开放。馆员可在控制台的「读者评价」页查看与管理全部评价。",
          button: "切换读者账号",
          mode: "switch"
        };
      }
      return { title: "还没有可评价的图书", text: "先借一本好书，读完后归还，就能在这里打星评价。", button: "去借一本书", mode: "books" };
    });

    function goBorrow() {
      if (!user.value) openLogin("登录后即可借阅图书", goPopular);
      else goPopular();
    }
    function feedbackAction() {
      const mode = feedbackItems.value.length ? "login" : feedbackEmpty.value.mode;
      if (mode === "books") goPopular();
      else if (mode === "switch") openLogin("请切换到读者账号后再评价");
      else openLogin("登录读者账号后即可打星评价");
    }
    function giveBack(row) { requestReturn(row.borrow_id); }
    function review(item) { openReview(item.book.id); }
    function daysInfo(row) {
      const due = new Date(row.due_at);
      const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
      const dayText = days > 0 ? "剩余 " + days + " 天" : (days === 0 ? "今天到期" : "已逾期 " + Math.abs(days) + " 天");
      const dayClass = days <= 0 ? " overdue" : (days <= 5 ? " warn" : "");
      return { text: dayText, cls: dayClass };
    }
    function reviewScore(rating) {
      return (Number(rating) * 2).toFixed(1);
    }
    return {
      user, activeEntries, feedbackItems, pendingReviews, borrowSummary, feedbackSummary,
      borrowEmpty, feedbackEmpty, goBorrow, feedbackAction, giveBack, review, daysInfo,
      fmtDate, reviewScore
    };
  },
  template: `
    <main id="shelfView" class="inner-page">
      <section class="page-hero">
        <div class="container">
          <a class="page-back" href="#home">← 返回首页</a>
          <p class="eyebrow">MY LIBRARY</p>
          <h1>我的书库</h1>
          <div class="shelf-tabs" role="tablist" aria-label="我的书库">
            <a href="#shelf/borrows" class="shelf-tab" :class="{ 'is-active': tab === 'borrows' }" data-shelf-tab="borrows" role="tab" :aria-selected="tab === 'borrows'">我的借阅<span class="tab-count" id="tabBorrowCount">{{ activeEntries.length }}</span></a>
            <a href="#shelf/reviews" class="shelf-tab" :class="{ 'is-active': tab === 'reviews' }" data-shelf-tab="reviews" role="tab" :aria-selected="tab === 'reviews'">我的评价<span class="tab-count" id="tabReviewCount">{{ pendingReviews }}</span></a>
          </div>
        </div>
      </section>
      <section class="section page-section">
        <div class="container">
          <div class="shelf-panel" id="shelfBorrowPanel" v-show="tab === 'borrows'">
            <div class="section-head">
              <div>
                <p class="eyebrow">MY SHELF</p>
                <h2>我的借阅</h2>
              </div>
              <span class="pill" id="borrowSummary">{{ borrowSummary }}</span>
            </div>

            <div class="borrow-list" id="borrowList">
              <div v-for="row in activeEntries" :key="row.borrow_id" class="borrow-item">
                <div class="mini-cover">{{ row.book_title.charAt(0) }}</div>
                <div class="borrow-main">
                  <h3>{{ row.book_title }}</h3>
                  <p>{{ row.book_author }} · 借阅于 {{ fmtDate(row.borrowed_at) }} · 借阅号 {{ row.borrow_id }}</p>
                </div>
                <div class="due">
                  <span class="due-label">到期日</span>
                  <strong>{{ fmtDate(row.due_at) }}</strong>
                  <span class="days" :class="daysInfo(row).cls">{{ daysInfo(row).text }}</span>
                </div>
                <div class="borrow-actions">
                  <button type="button" class="btn-return" :data-borrow="row.borrow_id" @click="giveBack(row)">归还</button>
                </div>
              </div>
            </div>

            <div v-if="!activeEntries.length" class="empty-borrows" id="emptyBorrows">
              <div class="empty-illustration" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 14.5A4.5 4.5 0 0 1 14.5 10H54v40H14.5A4.5 4.5 0 0 0 10 54.5v-40Z"/>
                  <path d="M10 54.5A4.5 4.5 0 0 1 14.5 50H54v4H14.5A4.5 4.5 0 0 1 10 54.5Z"/>
                  <path d="M22 20h18M22 28h12"/>
                </svg>
              </div>
              <h3 id="emptyBorrowTitle">{{ borrowEmpty.title }}</h3>
              <p id="emptyBorrowText">{{ borrowEmpty.text }}</p>
              <button class="btn btn-primary" type="button" id="goBorrow" @click="goBorrow">{{ borrowEmpty.button }}</button>
            </div>
          </div>

          <div class="shelf-panel" id="shelfReviewPanel" v-show="tab === 'reviews'">
            <div class="section-head">
              <div>
                <p class="eyebrow">READER REVIEWS</p>
                <h2>我的评价</h2>
              </div>
              <span class="pill" id="feedbackSummary">{{ feedbackSummary }}</span>
            </div>

            <div class="feedback-list" id="feedbackList">
              <article v-for="item in feedbackItems" :key="item.book.id" class="feedback-item">
                <div class="mini-cover" :style="{ '--c1': item.book.colors[0], '--c2': item.book.colors[1] }">{{ item.book.title.charAt(0) }}</div>
                <div class="feedback-main">
                  <h3>{{ item.book.title }}</h3>
                  <p>{{ item.book.author }} · 归还于 {{ fmtDate(item.borrow.returned_at) }}</p>
                  <template v-if="item.review">
                    <div class="feedback-review-stars">
                      <span class="stars" role="img" :aria-label="item.review.rating + ' 星'">
                        <i v-for="n in 5" :key="n" :class="{ on: n <= item.review.rating }">★</i>
                      </span>
                      <span class="feedback-score">{{ reviewScore(item.review.rating) }} 分</span>
                    </div>
                    <p v-if="item.review.content" class="feedback-content">{{ item.review.content }}</p>
                    <p v-else class="feedback-content muted">仅评分，未填写文字。</p>
                  </template>
                  <div v-else class="feedback-review-stars">
                    <span class="badge amber">待评价</span>
                    <span class="muted small">归还后即可打星评价，文字选填</span>
                  </div>
                </div>
                <div class="feedback-actions">
                  <button class="btn btn-sm" :class="item.review ? 'btn-ghost' : 'btn-primary'" type="button"
                          :data-review-book="item.book.id" @click="review(item)">{{ item.review ? '修改评价' : '写评价' }}</button>
                </div>
              </article>
            </div>

            <div v-if="!feedbackItems.length" class="empty-borrows" id="feedbackEmpty">
              <div class="empty-illustration" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m32 8 6.9 14 15.4 2.2-11.1 10.9 2.6 15.3L32 43.2 17.2 50.4l2.6-15.3L8.7 24.2 24.1 22 32 8Z"/>
                </svg>
              </div>
              <h3 id="feedbackEmptyTitle">{{ feedbackEmpty.title }}</h3>
              <p id="feedbackEmptyText">{{ feedbackEmpty.text }}</p>
              <button class="btn btn-primary" type="button" id="feedbackAction" @click="feedbackAction">{{ feedbackEmpty.button }}</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  `
};
