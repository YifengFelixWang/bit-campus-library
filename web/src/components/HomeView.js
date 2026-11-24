import { ref, computed, onMounted, onUnmounted } from "../../vendor/vue.esm-browser.prod.js";
import { store, myBorrowCount, isStaff } from "../store.js";
import { api } from "../services/api.js";
import { filterBooks, fmtDate } from "../core/utils.js";
import { navState, route, navigate } from "../router.js";
import { openLogin } from "../core/login.js";
import { requestReturn, goPopular, openDetail } from "../composables/useLibraryActions.js";
import AnnouncementCard from "./AnnouncementCard.js";
import BookCard from "./BookCard.js";
import NewArrivalsCarousel from "./NewArrivalsCarousel.js";

export default {
  name: "HomeView",
  components: { AnnouncementCard, BookCard, NewArrivalsCarousel },
  setup() {
    const category = ref("全部");
    let observer = null;

    const stats = computed(function () { return store.stats || {}; });
    const mine = computed(function () { return myBorrowCount(); });
    const staff = computed(function () { return isStaff(); });
    const homeAnnouncements = computed(function () { return store.announcements.slice(0, 3); });
    const noticeMoreText = computed(function () {
      return store.announcements.length > 3 ? "查看全部 " + store.announcements.length + " 条公告 →" : "查看全部公告 →";
    });
    const categories = computed(function () {
      return ["全部"].concat(store.categories.map(function (c) { return c.name; }));
    });
    const books = computed(function () {
      // 每个分类（含「全部」）都只取借阅量最高的 8 本；
      // 读一下 store.revision 才能让借书/还书后的刷新带动榜单重排。
      const revision = store.revision;
      return api.hotByCategory(category.value, 8);
    });
    const borrowTitle = computed(function () {
      if (!store.stats) return "";
      return "在借 " + store.stats.activeBorrows + " 本 / 逾期 " + store.stats.overdue + " 条";
    });
    const activeLoans = computed(function () {
      if (!store.user) return [];
      return store.borrows.filter(function (row) {
        // 与后端状态 BORROWED / RETURNED 对齐，已归还的不算「在借」
        return row.user_id === store.user.id && String(row.status).toUpperCase() === "BORROWED";
      });
    });
    const loansSummary = computed(function () {
      if (!store.user) return "未登录";
      return "在借 " + activeLoans.value.length + " / " + api.maxBorrows() + " 本";
    });
    const popularTotal = computed(function () {
      return filterBooks(store.hot, "全部", "").length;
    });
    const loanRuleText = computed(function () {
      return "借期 " + api.loanDays() + " 天，每位读者最多同时借阅 " + api.maxBorrows() + " 本";
    });

    // ——— 首屏两张浮动卡片：都改成真实数据 + 可点击跳转 ———
    // 之前数字来自不存在的 stats.availableCopies，评分是写死的 4.9，
    // 现在可借册数 = 各书（馆藏 − 已借出）之和，口碑最高 = 近 7 天评价平均分最高。
    const heroAvailable = computed(function () {
      const revision = store.revision;
      return api.availableCopies();
    });
    // 只报一个「可借 6 册」容易被误读成丢书：把馆藏总数与在借册数一起放进说明
    const heroTotal = computed(function () {
      const revision = store.revision;
      return store.books.reduce(function (n, b) { return n + (Number(b.total) || 0); }, 0);
    });
    const availableTitle = computed(function () {
      const borrowed = Math.max(0, heroTotal.value - heroAvailable.value);
      return "全馆馆藏 " + heroTotal.value + " 册，当前可借 " + heroAvailable.value
        + " 册（" + borrowed + " 册在借），点击跳到热门图书";
    });
    const topRated = computed(function () {
      const revision = store.revision;
      return api.topRated(7);
    });
    const topScore = computed(function () {
      const top = topRated.value;
      return top ? top.score.toFixed(1) : "暂无";
    });
    const topLabel = computed(function () {
      const top = topRated.value;
      if (!top) return "暂无读者评分";
      return top.recent ? "本周口碑最高" : "馆内口碑最高";
    });
    const topTitle = computed(function () {
      const top = topRated.value;
      if (!top) return "还没有读者评分，归还图书后可以评价";
      return "《" + top.book.title + "》 · 平均 " + top.score.toFixed(1) + " 分（" + top.count + " 人评价） · 点击查看这本书";
    });
    function openTopRated() {
      const top = topRated.value;
      if (!top) {
        navigate("#library");
        return;
      }
      openDetail(top.book.id);
    }
    function browsePopularFromHero() {
      goPopular();
    }
    const loanEmpty = computed(function () {
      if (!store.user) {
        return { title: "登录后开始借阅", text: "登录读者账号即可借阅热门图书，借阅记录和还书入口会显示在这里。", button: "登录 / 注册" };
      }
      return { title: "还没有在借图书", text: "从热门图书里挑一本，借阅进度与还书入口都会显示在这里。", button: "查看热门图书" };
    });
    function loanEmptyAction() {
      if (!store.user) loginForLoans();
      else browsePopular();
    }
    function daysInfo(row) {
      const due = new Date(row.due_at);
      const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
      const dayText = days > 0 ? "剩余 " + days + " 天" : (days === 0 ? "今天到期" : "已逾期 " + Math.abs(days) + " 天");
      const dayClass = days <= 0 ? " overdue" : (days <= 5 ? " warn" : "");
      return { text: dayText, cls: dayClass };
    }
    function returnLoan(row) {
      requestReturn(row.borrow_id);
    }
    function loginForLoans() {
      openLogin("登录后即可借阅图书，并在首页一键还书");
    }
    function browsePopular() {
      goPopular();
    }
    function openShelf() {
      navigate("#shelf/borrows");
    }
    function setCategory(value) {
      category.value = value;
    }
    function resetFilters() {
      category.value = "全部";
    }
    function setupSpy() {
      if (!("IntersectionObserver" in window)) return;
      observer = new IntersectionObserver(function (entries) {
        if (route.name !== "home") return;
        entries.forEach(function (entry) {
          if (entry.isIntersecting) navState.section = entry.target.id;
        });
      }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
      ["home", "new-arrivals", "popular", "my-loans", "announcements"].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      });
    }
    onMounted(setupSpy);
    onUnmounted(function () {
      if (observer) observer.disconnect();
    });
    return {
      store, stats, mine, staff, homeAnnouncements, noticeMoreText,
      categories, books, category, setCategory, resetFilters, borrowTitle,
      activeLoans, loansSummary, popularTotal, daysInfo, returnLoan, loginForLoans,
      browsePopular, openShelf, fmtDate, loanRuleText, loanEmpty, loanEmptyAction,
      heroAvailable, heroTotal, availableTitle, topRated, topScore, topLabel, topTitle,
      openTopRated, browsePopularFromHero
    };
  },
  template: `
    <main id="publicView">
      <section class="hero" id="home">
        <div class="container hero-inner">
          <div class="hero-copy">
            <p class="eyebrow">BIT BOOKS · DATABASE COURSE PROJECT</p>
            <h1>在BIT书屋，<br><span class="accent">遇见更大的世界</span></h1>
            <div class="hero-cta">
              <a class="btn btn-primary hero-cta-main" href="#popular">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>
                </svg>
                查看热门图书
              </a>
              <a class="hero-cta-link" href="#my-loans">我的借阅 · 还书 →</a>
              <a class="hero-cta-link" href="#library">进入全部图书搜索 →</a>
            </div>
          </div>

          <div class="hero-visual">
            <div class="glow" aria-hidden="true"></div>
            <div class="cover-stack" aria-hidden="true">
              <div class="stack-item stack-1"><span class="stack-cat">历史</span><span class="stack-title">人类简史</span></div>
              <div class="stack-item stack-2"><span class="stack-cat">文学</span><span class="stack-title">活着</span></div>
              <div class="stack-item stack-3"><span class="stack-cat">科幻</span><span class="stack-title">三体</span></div>
            </div>
            <button type="button" class="floating-card fc-top" :title="topTitle" :aria-label="topTitle" @click="openTopRated">
              <span class="fc-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/></svg>
              </span>
              <span><strong>{{ topScore }}</strong><small>{{ topLabel }}<i class="fc-arrow" aria-hidden="true">→</i></small></span>
            </button>
            <button type="button" class="floating-card fc-bottom" :title="availableTitle" :aria-label="availableTitle" @click="browsePopularFromHero">
              <span class="fc-icon warm" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 9.5 4 4l4.2 2.3a8.3 8.3 0 0 1 7.6 0L20 4l-1.2 5.5v2.8a6.8 6.8 0 0 1-13.6 0V9.5Z"/><path d="M9.3 12h.01M14.7 12h.01"/><path d="M10.4 15.2c1 .9 2.2.9 3.2 0"/></svg>
              </span>
              <span><strong id="heroAvailable">{{ heroAvailable }}<em class="fc-unit">册</em></strong><small>可借图书<i class="fc-arrow" aria-hidden="true">→</i></small></span>
            </button>
          </div>
        </div>
      </section>

      <section class="section section-notice" id="announcements">
        <div class="container">
          <div class="section-head">
            <div>
              <p class="eyebrow">NOTICE BOARD</p>
              <h2>馆内公告</h2>
            </div>
            <div class="notice-actions">
              <a class="notice-link" href="#notices" id="homeNoticeMore">{{ noticeMoreText }}</a>
              <a v-if="staff" class="notice-link" href="#console/announcements">管理公告 →</a>
            </div>
          </div>

          <div class="announcement-list" id="announcementList">
            <AnnouncementCard v-for="item in homeAnnouncements" :key="item.id" :item="item"></AnnouncementCard>
          </div>

          <div v-if="!homeAnnouncements.length" class="empty-borrows" id="announcementEmpty">
            <div class="empty-illustration" aria-hidden="true">
              <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 16h40v26H34L22 52V42H12z"/>
                <path d="M22 26h20M22 33h13"/>
              </svg>
            </div>
            <h3>暂时没有公告</h3>
            <p>馆员发布公告后会显示在这里。</p>
          </div>
        </div>
      </section>

      <section class="section section-new" id="new-arrivals">
        <div class="container">
          <div class="section-head">
            <div>
              <p class="eyebrow">JUST ARRIVED</p>
              <h2>新上架图书</h2>
            </div>
          </div>
          <NewArrivalsCarousel></NewArrivalsCarousel>
        </div>
      </section>

      <section class="section" id="popular">
        <div class="container">
          <div class="section-head">
            <div>
              <p class="eyebrow">MOST POPULAR</p>
              <h2>热门图书</h2>
            </div>
            <div class="filters" id="filters" role="group" aria-label="按分类筛选">
              <button v-for="item in categories" :key="item" type="button" class="chip" :class="{ 'is-active': item === category }"
                      :data-category="item" @click="setCategory(item)">{{ item }}</button>
            </div>
          </div>

          <div class="book-grid" id="bookGrid">
            <BookCard v-for="(book, i) in books" :key="book.id" :book="book" :index="i" :rank="i + 1"></BookCard>
          </div>

          <div v-if="!books.length" class="empty-state" id="emptyState">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>
            </svg>
            <h3>没有找到匹配的图书</h3>
            <p>试试其他关键词，或清空筛选条件。</p>
            <button class="btn btn-ghost" type="button" id="resetFilters" @click="resetFilters">清空筛选</button>
          </div>
        </div>
      </section>

      <section class="section section-alt section-shelf" id="my-loans">
        <div class="container">
          <div class="section-head">
            <div>
              <p class="eyebrow">BORROW &amp; RETURN</p>
              <h2>我的借阅 · 一键还书</h2>
            </div>
            <div class="notice-actions">
              <span class="pill" id="homeLoanSummary">{{ loansSummary }}</span>
              <button v-if="activeLoans.length" type="button" class="notice-link" id="homeLoanMore" @click="openShelf">查看全部借阅 →</button>
            </div>
          </div>

          <div v-if="activeLoans.length" class="borrow-list" id="homeLoanList">
            <div v-for="row in activeLoans" :key="row.borrow_id" class="borrow-item">
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
                <button type="button" class="btn-return" :data-borrow="row.borrow_id" @click="returnLoan(row)">归还</button>
              </div>
            </div>
          </div>

          <div v-else class="empty-borrows" id="homeLoanEmpty">
            <div class="empty-illustration" aria-hidden="true">
              <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 14.5A4.5 4.5 0 0 1 14.5 10H54v40H14.5A4.5 4.5 0 0 0 10 54.5v-40Z"/>
                <path d="M10 54.5A4.5 4.5 0 0 1 14.5 50H54v4H14.5A4.5 4.5 0 0 1 10 54.5Z"/>
                <path d="M22 20h18M22 28h12"/>
              </svg>
            </div>
            <h3>{{ loanEmpty.title }}</h3>
            <p>{{ loanEmpty.text }}</p>
            <button class="btn btn-primary" type="button" id="homeLoanAction" @click="loanEmptyAction">{{ loanEmpty.button }}</button>
          </div>
        </div>
      </section>
    </main>
  `
};
