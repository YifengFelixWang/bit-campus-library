import { ref, computed, watch, onMounted, onUnmounted } from "../../vendor/vue.esm-browser.prod.js";
import { store } from "../store.js";
import { api } from "../services/api.js";
import { scoreShort } from "../core/utils.js";
import { requestBorrow, requestReturn, openDetail } from "../composables/useLibraryActions.js";

export default {
  name: "NewArrivalsCarousel",
  setup() {
    const index = ref(0);
    let timer = null;
    const rows = computed(function () { return store.newArrivals; });

    function activeUser() {
      return api.currentUser();
    }

    function recordOf(book) {
      const user = activeUser();
      if (!user) return null;
      return api.activeBorrowsOf(user.id).filter(function (b) { return b.book_id === book.id; })[0] || null;
    }

    function leftOf(book) { return api.availability(book); }
    function notOnShelf(book) { return book.shelf_status && book.shelf_status !== "on_shelf"; }
    function shelfText(book) { return book.shelf_status === "warehouse" ? "仓库待上架" : "已下架"; }

    function stockText(book) {
      if (notOnShelf(book)) return shelfText(book);
      const record = recordOf(book);
      if (record) return "在借中";
      return leftOf(book) > 0 ? "可借 " + leftOf(book) + " 本" : "已借完";
    }

    function stockClass(book) {
      if (notOnShelf(book)) return " out";
      if (recordOf(book)) return " mine";
      return leftOf(book) > 0 ? "" : " out";
    }

    function coverUrl(book) { return api.coverUrl(book); }
    function score(book) { return scoreShort(book); }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function start() {
      stop();
      if (rows.value.length <= 1) return;
      timer = setInterval(function () {
        index.value = (index.value + 1) % rows.value.length;
      }, 4000);
    }

    function restart() {
      start();
    }

    function prev() {
      const count = rows.value.length || 1;
      index.value = (index.value - 1 + count) % count;
      restart();
    }

    function next() {
      const count = rows.value.length || 1;
      index.value = (index.value + 1) % count;
      restart();
    }

    function go(i) {
      index.value = i;
      restart();
    }

    function borrow(book) { requestBorrow(book.id); }
    function giveBack(book) {
      const record = recordOf(book);
      if (record) requestReturn(record.id);
    }
    function open(book) { openDetail(book.id); }

    watch(rows, function (list) {
      if (index.value >= list.length) index.value = 0;
      start();
    });

    onMounted(start);
    onUnmounted(stop);

    return {
      rows, index, stop, restart, prev, next, go,
      stockText, stockClass, coverUrl, score,
      recordOf, notOnShelf, shelfText, leftOf,
      borrow, giveBack, open
    };
  },
  template: `
    <div class="carousel" id="newArrivalsCarousel" role="region" aria-roledescription="轮播图" aria-label="新上架图书"
         @mouseenter="stop" @mouseleave="restart">
      <button class="carousel-arrow carousel-prev" type="button" aria-label="上一本" @click="prev">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>
      </button>
      <div class="carousel-track" id="carouselTrack" :style="{ transform: 'translateX(-' + index * 100 + '%)' }">
        <div v-for="book in rows" :key="book.id" class="carousel-slide" :data-book-id="book.id" tabindex="0"
             :aria-label="'查看《' + book.title + '》详情'"
             @click="open(book)" @keydown.enter.prevent="open(book)" @keydown.space.prevent="open(book)">
          <div class="new-cover" :class="{ 'has-img': coverUrl(book) }" :style="{ '--c1': book.colors[0], '--c2': book.colors[1] }">
            <img v-if="coverUrl(book)" class="cover-img" :src="coverUrl(book)" :alt="book.title + ' 封面'">
            <template v-else>
              <span class="cover-category">{{ book.category }}</span>
              <span class="cover-title">{{ book.title }}</span>
              <span class="cover-author">{{ book.author }}</span>
            </template>
          </div>
          <div class="new-info">
            <span class="new-tag">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.2 7.2 16.9l.9-5.4L4.2 7.7l5.4-.8L12 2Z"/></svg>
              新品上架
            </span>
            <h3>{{ book.title }}</h3>
            <p class="new-author">{{ book.author }} · {{ book.category }}</p>
            <p class="new-desc">{{ book.desc || "" }}</p>
            <div class="new-rating" title="十分制评分"><span class="rating-star">★</span> {{ score(book) }}</div>
            <div class="new-foot">
              <span class="stock" :class="stockClass(book)">{{ stockText(book) }}</span>
              <div class="book-actions">
                <button type="button" class="card-detail" :data-detail="book.id" @click.stop="open(book)">详情</button>
                <button v-if="recordOf(book)" type="button" class="cbtn return" :data-borrow="recordOf(book).id" @click.stop="giveBack(book)">归还</button>
                <button v-else-if="notOnShelf(book)" type="button" class="cbtn" disabled>{{ shelfText(book) }}</button>
                <button v-else-if="leftOf(book) <= 0" type="button" class="cbtn" disabled>已借完</button>
                <button v-else type="button" class="cbtn borrow" :data-id="book.id" @click.stop="borrow(book)">借阅</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <button class="carousel-arrow carousel-next" type="button" aria-label="下一本" @click="next">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>
      </button>
      <div class="carousel-dots" id="carouselDots" aria-label="轮播指示器">
        <button v-for="(book, i) in rows" :key="book.id" type="button" class="carousel-dot" :class="{ active: i === index }"
                :aria-label="'第 ' + (i + 1) + ' 张'" @click="go(i)"></button>
      </div>
    </div>
  `
};
