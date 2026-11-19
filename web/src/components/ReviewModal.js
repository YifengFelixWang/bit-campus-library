import { computed } from "../../vendor/vue.esm-browser.prod.js";
import { store } from "../store.js";
import { api } from "../services/api.js";
import { reviewState, closeReview, setReviewRating, submitReview } from "../core/review.js";

export default {
  name: "ReviewModal",
  setup() {
    const book = computed(function () {
      const revision = store.revision;
      return reviewState.bookId ? api.bookById(reviewState.bookId) : null;
    });
    const displayRating = computed(function () {
      return reviewState.hover || reviewState.rating;
    });
    const hint = computed(function () {
      if (reviewState.hover) return "已选择 " + reviewState.hover + " 星";
      return reviewState.rating ? "已选择 " + reviewState.rating + " 星，可重新选择" : "请选择 1–5 颗星（必填）";
    });
    function setHover(value) { reviewState.hover = value; }
    function leave() { reviewState.hover = 0; }
    function choose(value) { setReviewRating(value); }
    return {
      reviewState, book, displayRating, hint, closeReview, submitReview, setHover, leave, choose
    };
  },
  template: `
    <div v-if="reviewState.visible && book" class="modal-backdrop" id="reviewModal" @click.self="closeReview">
      <div class="modal wide" role="dialog" aria-modal="true" aria-label="评价图书">
        <button class="modal-close" type="button" aria-label="关闭" @click="closeReview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
        <h2>{{ reviewState.existing ? '修改我的评价' : '评价图书' }}</h2>
        <p>图书得分为所有读者平均星级折算成的十分制；评分必填，文字内容选填。</p>
        <form class="review-form" @submit.prevent="submitReview">
          <div class="review-book">
            <span class="mini-cover">{{ book.title.charAt(0) }}</span>
            <div><strong>{{ book.title }}</strong><span>{{ book.author }} · {{ book.category }}</span></div>
          </div>
          <div class="field">
            <span>评分 *</span>
            <div class="star-picker" id="reviewStars" :data-value="reviewState.rating" role="radiogroup" aria-label="选择 1 到 5 星" @mouseleave="leave">
              <button v-for="n in 5" :key="n" type="button" class="star-btn" :class="{ 'is-on': n <= displayRating }"
                      :data-star="n" role="radio" :aria-checked="n === reviewState.rating" :aria-label="n + ' 星'"
                      @click="choose(n)" @mouseenter="setHover(n)">★</button>
            </div>
            <small id="reviewStarHint">{{ hint }}</small>
          </div>
          <label class="field">
            <span>评价内容（选填）</span>
            <textarea id="reviewContent" v-model="reviewState.content" maxlength="500" rows="4" placeholder="写下你的阅读感受，最多 500 字"></textarea>
            <small>文字内容可以留空，最多 500 字。</small>
          </label>
          <p v-if="reviewState.error" class="form-error" id="reviewError">{{ reviewState.error }}</p>
        </form>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" @click="closeReview">取消</button>
          <button class="btn btn-primary" type="button" @click="submitReview">{{ reviewState.existing ? '更新评价' : '提交评价' }}</button>
        </div>
      </div>
    </div>
  `
};
