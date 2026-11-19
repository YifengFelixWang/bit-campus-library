import { esc, icon } from "./utils.js";
import { api } from "../services/api.js";
import { lockScroll, unlockScroll } from "./overlay.js";

let lastFocused = null;
let activeConfirm = null;

function modalBookHtml(book) {
  const url = api.coverUrl(book);
  const cover = url
    ? '<img class="thumb" src="' + esc(url) + '" alt="">'
    : '<span class="thumb-fallback">' + esc(book.title.charAt(0)) + "</span>";
  return [
    '<div class="modal-book">',
    cover,
    "<div>",
    "  <h3>" + esc(book.title) + "</h3>",
    "  <p>" + esc(book.author) + " · " + esc(book.category) + " · 可借 " + api.availability(book) + " / " + book.total + " 本</p>",
    "</div>",
    "</div>"
  ].join("");
}

export function openModal(options) {
  const modal = document.getElementById("modal");
  const modalBox = document.getElementById("modalBox");
  const modalContent = document.getElementById("modalContent");
  if (!modal || !modalBox || !modalContent) return;
  lastFocused = document.activeElement;
  activeConfirm = options.onConfirm || null;
  modalBox.classList.toggle("wide", Boolean(options.wide));
  const footer = options.actionsHtml != null
    ? options.actionsHtml
    : [
        '<div class="modal-actions">',
        '  <button class="btn btn-ghost" type="button" data-modal-cancel>' + esc(options.cancelText || "取消") + "</button>",
        '  <button class="btn ' + (options.danger ? "btn-danger" : "btn-primary") + '" type="button" data-modal-confirm>' + esc(options.confirmText || "确认") + "</button>",
        "</div>"
      ].join("");
  modalContent.innerHTML = [
    options.icon ? '<div class="modal-icon">' + icon(options.icon) + "</div>" : "",
    '<h2 id="modalTitle">' + esc(options.title || "确认操作") + "</h2>",
    options.desc ? '<p id="modalDesc">' + esc(options.desc) + "</p>" : "",
    options.book ? modalBookHtml(options.book) : "",
    options.bodyHtml || "",
    footer
  ].join("");
  modal.hidden = false;
  lockScroll("modal");

  // 右上角 ✕：旧版由 app-vanilla.js 绑定，新版没有绑定过，导致点了没反应
  const closeBtn = document.getElementById("modalClose");
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = "1";
    closeBtn.addEventListener("click", closeModal);
  }
  // 点击遮罩空白处关闭（点在弹窗内部不关）
  if (!modal.dataset.backdropBound) {
    modal.dataset.backdropBound = "1";
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal();
    });
  }

  const confirmBtn = modalContent.querySelector("[data-modal-confirm]");
  const cancelBtn = modalContent.querySelector("[data-modal-cancel]");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async function () {
      if (!activeConfirm) {
        closeModal();
        return;
      }
      if (confirmBtn.dataset.busy === "1") return;   // 防重复提交
      confirmBtn.dataset.busy = "1";
      let result;
      try {
        result = activeConfirm(modalContent);
        if (result && typeof result.then === "function") result = await result;   // 支持 async 校验
      } catch (err) {
        console.error(err);
        result = false;
      }
      confirmBtn.dataset.busy = "0";
      if (result === false) return;   // 校验失败保持弹窗打开
      closeModal();
    });
  }
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
  window.requestAnimationFrame(function () {
    const first = modalContent.querySelector("input, select, textarea") || confirmBtn;
    if (first) first.focus();
  });
}

export function closeModal() {
  const modal = document.getElementById("modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  unlockScroll("modal");
  activeConfirm = null;
  if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  lastFocused = null;
}

export function confirmAction(options) {
  openModal({
    icon: options.icon,
    title: options.title,
    desc: options.desc,
    book: options.book,
    confirmText: options.confirmText,
    cancelText: options.cancelText,
    danger: options.danger,
    bodyHtml: options.bodyHtml,
    wide: options.wide,
    onConfirm: options.onConfirm
  });
}
