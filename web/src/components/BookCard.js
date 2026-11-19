import { api } from "../services/api.js";
import { store } from "../store.js";
import { scoreShort } from "../core/utils.js";
import { requestBorrow, requestReturn, openDetail } from "../composables/useLibraryActions.js";

export default {
  name: "BookCard",
  props: {
    book: { type: Object, required: true },
    index: { type: Number, default: 0 },
    rank: { type: Number, default: 0 }
  },
  computed: {
    user: function () { return store.user; },
    active: function () {
      const revision = store.revision;
      return this.user ? api.activeBorrowsOf(this.user.id) : [];
    },
    record: function () {
      const id = this.book.id;
      return this.active.filter(function (b) { return b.book_id === id; })[0] || null;
    },
    left: function () {
      const revision = store.revision;
      return api.availability(this.book);
    },
    notOnShelf: function () { return this.book.shelf_status && this.book.shelf_status !== "on_shelf"; },
    shelfText: function () { return this.book.shelf_status === "warehouse" ? "仓库待上架" : "已下架"; },
    soldOut: function () { return this.left <= 0 && !this.record; },
    stockText: function () {
      if (this.notOnShelf) return this.shelfText;
      if (this.record) return "在借中";
      return this.left > 0 ? "可借 " + this.left + " 本" : "已借完";
    },
    stockClass: function () {
      if (this.notOnShelf) return " out";
      if (this.record) return "mine";
      return this.left > 0 ? "" : " out";
    },
    coverUrl: function () { return api.coverUrl(this.book); },
    score: function () { return scoreShort(this.book); }
  },
  methods: {
    open: function () { openDetail(this.book.id); },
    borrow: function () { requestBorrow(this.book.id); },
    giveBack: function () { if (this.record) requestReturn(this.record.id); }
  },
  template: `
    <article class="book-card" :data-book-id="book.id" tabindex="0"
             :aria-label="'查看《' + book.title + '》详情'"
             :style="{ animationDelay: (index * 35) + 'ms' }"
             @click="open" @keydown.enter.prevent="open" @keydown.space.prevent="open">
      <div class="cover" :class="{ 'has-img': coverUrl }" :style="{ '--c1': book.colors[0], '--c2': book.colors[1] }">
        <span v-if="rank > 0 && rank <= 3" class="rank-badge" :class="'rank-' + rank" aria-hidden="true">
          <em>TOP</em>{{ rank }}
        </span>
        <img v-if="coverUrl" class="cover-img" :src="coverUrl" :alt="book.title + ' 封面'" loading="lazy">
        <template v-else>
          <span class="cover-category">{{ book.category }}</span>
          <span class="cover-title">{{ book.title }}</span>
          <span class="cover-author">{{ book.author }}</span>
        </template>
        <span class="cover-shine"></span>
      </div>
      <div class="book-body">
        <div class="book-meta">
          <span class="rating" title="十分制评分">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/></svg>
            <em>{{ score }}</em>
          </span>
          <span class="hot"><svg class="icon" aria-hidden="true"><use href="#i-swap"></use></svg>借阅 {{ book.borrows }}</span>
        </div>
        <h3>{{ book.title }}</h3>
        <p class="book-author">{{ book.author }} · {{ book.category }}</p>
        <div class="book-foot">
          <span class="stock" :class="stockClass">{{ stockText }}</span>
          <div class="book-actions">
            <button type="button" class="card-detail" :data-detail="book.id" @click.stop="open">详情</button>
            <button v-if="record" type="button" class="card-btn return" :data-borrow="record.id" @click.stop="giveBack">归还</button>
            <button v-else-if="notOnShelf" type="button" class="card-btn borrow" disabled>{{ shelfText }}</button>
            <button v-else-if="soldOut" type="button" class="card-btn borrow" disabled>已借完</button>
            <button v-else type="button" class="card-btn borrow" :data-id="book.id" @click.stop="borrow">借阅</button>
          </div>
        </div>
      </div>
    </article>
  `
};
