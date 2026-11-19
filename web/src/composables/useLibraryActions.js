import { api } from "../services/api.js";
import { refreshStore } from "../store.js";
import { fmtDate } from "../core/utils.js";
import { toast } from "../core/io.js";
import { confirmAction } from "../core/modal.js";
import { openLogin } from "../core/login.js";
import { requirePerm } from "../core/tata-ui.js";
import { openBookDetail } from "../core/book-detail.js";
import { openReview } from "../core/review.js";
import { route, navigate } from "../router.js";

export function goPopular() {
  if (route.name !== "home") {
    navigate("#popular");
    return;
  }
  const target = document.getElementById("popular");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function requestBorrow(bookId) {
  const book = api.bookById(bookId);
  if (!book) return;
  const user = api.currentUser();
  if (!user) {
    openLogin("登录后即可借阅《" + book.title + "》", function () { requestBorrow(bookId); });
    return;
  }
  if (!requirePerm("borrow:self")) return;
  const active = api.activeBorrowsOf(user.id);
  if (active.some(function (b) { return b.book_id === bookId; })) {
    toast("《" + book.title + "》已经在你的书架里了。", "warn");
    return;
  }
  if (active.length >= api.maxBorrows()) {
    toast("每位读者最多同时借阅 " + api.maxBorrows() + " 本，请先归还一本。", "warn");
    return;
  }
  if (api.availability(book) <= 0) {
    toast("《" + book.title + "》暂时没有可借副本。", "error");
    return;
  }
  const due = new Date(Date.now() + api.loanDays() * 86400000);
  confirmAction({
    icon: "book",
    title: "确认借阅",
    desc: "借期为 " + api.loanDays() + " 天，到期日为 " + fmtDate(due) + "。确认后将调用存储过程 sp_borrow_book，并由触发器更新库存。",
    book: book,
    confirmText: "确认借阅",
    onConfirm: async function () {
      const result = await api.borrowBook(user.id, bookId);
      if (!result.ok) {
        toast(result.message, "error");
        return false;
      }
      toast("已借阅《" + book.title + "》，请在 " + fmtDate(due) + " 前归还。");
      refreshStore();
      return true;
    }
  });
}

export function requestReturn(borrowId) {
  const row = api.listBorrows({ status: "all" }).filter(function (r) { return r.borrow_id === borrowId; })[0];
  if (!row) return;
  const user = api.currentUser();
  if (!user) {
    openLogin("登录后才能归还图书");
    return;
  }
  const canReviewAfter = user.role === "reader" && row.user_id === user.id && api.can("rating:write", user);
  confirmAction({
    icon: "swap",
    title: "确认归还",
    desc: "归还后，《" + row.book_title + "》将重新上架，库存由触发器 trg_after_return 自动恢复。",
    confirmText: "确认归还",
    onConfirm: async function () {
      const result = await api.returnBook(borrowId);
      if (!result.ok) {
        toast(result.message, "error");
        return false;
      }
      toast("已归还《" + row.book_title + "》，感谢你让好书继续流转。");
      refreshStore();
      if (canReviewAfter) {
        window.setTimeout(function () { openReview(row.book_id); }, 320);
      }
      return true;
    }
  });
}

export function openDetail(bookId) {
  openBookDetail(bookId);
}
