import { reactive } from "../../vendor/vue.esm-browser.prod.js";
import { api } from "../services/api.js";
import { refreshStore } from "../store.js";
import { toast } from "./io.js";
import { openLogin } from "./login.js";
import { lockScroll, unlockScroll } from "./overlay.js";

export const reviewState = reactive({
  visible: false,
  bookId: null,
  rating: 0,
  content: "",
  error: "",
  hover: 0,
  existing: false,
  submitting: false
});

export function openReview(bookId) {
  const book = api.bookById(bookId);
  if (!book) return;
  const user = api.currentUser();
  if (!user) {
    openLogin("登录并归还图书后即可评价", function () { openReview(bookId); });
    return;
  }
  if (user.role !== "reader" || !api.can("rating:write")) {
    toast("只有读者账号可以提交评分与评价", "warn");
    return;
  }
  if (!api.hasReturned(user.id, bookId)) {
    toast("归还《" + book.title + "》后才能评价", "warn");
    return;
  }
  const existing = api.reviewsFor(bookId, { type: "review" }).filter(function (r) {
    return r.user_id === user.id && r.status === "visible";
  })[0] || null;
  reviewState.bookId = bookId;
  reviewState.rating = existing ? Number(existing.rating) || 0 : 0;
  reviewState.content = existing ? existing.content : "";
  reviewState.error = "";
  reviewState.hover = 0;
  reviewState.existing = Boolean(existing);
  reviewState.visible = true;
  lockScroll("review");
}

export function closeReview() {
  reviewState.visible = false;
  reviewState.error = "";
  reviewState.hover = 0;
  unlockScroll("review");
}

export function setReviewRating(value) {
  reviewState.rating = value;
  reviewState.error = "";
}

export async function submitReview() {
  if (reviewState.submitting) return false;
  reviewState.error = "";
  if (!reviewState.rating) {
    reviewState.error = "请先选择 1–5 颗星的评分";
    return false;
  }
  reviewState.submitting = true;
  // 这里必须 await：以前漏了，拿到的是 Promise，result.ok 恒为 undefined，
  // 于是点「提交评价」既不报错也不关闭，看起来像没反应。
  const result = await api.addReview({
    bookId: reviewState.bookId,
    rating: reviewState.rating,
    content: reviewState.content
  });
  reviewState.submitting = false;
  if (!result.ok) {
    reviewState.error = result.message || "提交失败，请稍后再试";
    return false;
  }
  toast(reviewState.existing ? "评价已更新" : "评价已提交");
  closeReview();
  await refreshStore();
  return true;
}
