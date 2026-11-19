import { reactive } from "../../vendor/vue.esm-browser.prod.js";
import { api } from "../services/api.js";
import { toast } from "./io.js";
import { openLogin } from "./login.js";
import { lockScroll, unlockScroll } from "./overlay.js";

export const detailState = reactive({
  visible: false,
  bookId: null,
  pdfVisible: false,
  pdfLoading: false,
  pdfError: "",
  pdfUrl: "",
  pdfShown: 0,
  pdfTotal: 0
});

export function openBookDetail(bookId) {
  if (!api.bookById(bookId)) return;
  detailState.bookId = bookId;
  detailState.visible = true;
  lockScroll("book-detail");
}

export function closeBookDetail() {
  closePdfPreview();
  detailState.visible = false;
  unlockScroll("book-detail");
}

function releasePdfUrl() {
  if (!detailState.pdfUrl) return;
  try { URL.revokeObjectURL(detailState.pdfUrl); } catch (err) {}
  detailState.pdfUrl = "";
}

function base64ToBytes(base64) {
  const binary = window.atob(String(base64 || ""));
  const bytes = new window.Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildPreviewPdf(book) {
  const bytes = base64ToBytes(book.pdf_blob);
  return window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }).then(function (src) {
    const total = src.getPageCount();
    if (!total) throw new Error("PDF 中没有可预览的页面");
    const shown = Math.min(10, total);
    const indices = new window.Array();
    for (let i = 0; i < shown; i++) indices.push(i);
    return window.PDFLib.PDFDocument.create().then(function (out) {
      return out.copyPages(src, indices).then(function (pages) {
        pages.forEach(function (page) { out.addPage(page); });
        return out.save();
      });
    }).then(function (outBytes) {
      const blob = new window.Blob([outBytes], { type: "application/pdf" });
      return { url: URL.createObjectURL(blob), shown: shown, total: total };
    });
  });
}

export function openPdfPreview(bookId) {
  const book = api.bookById(bookId);
  if (!book) return;
  if (!api.can("pdf:read")) {
    toast("访客不能试读，请先登录读者账号", "warn");
    openLogin("登录后即可试读图书前 10 页", function () { openBookDetail(bookId); });
    return;
  }
  if (!book.pdf_blob) {
    toast("本书暂未上传 PDF 试读文件", "warn");
    return;
  }
  if (typeof window.PDFLib === "undefined" || !window.PDFLib.PDFDocument) {
    toast("PDF 预览组件尚未加载完成，请刷新页面后重试。", "warn");
    return;
  }
  releasePdfUrl();
  detailState.pdfVisible = true;
  detailState.pdfLoading = true;
  detailState.pdfError = "";
  detailState.pdfShown = 0;
  detailState.pdfTotal = 0;
  lockScroll("pdf-preview");
  buildPreviewPdf(book).then(function (result) {
    if (!detailState.pdfVisible) {
      try { URL.revokeObjectURL(result.url); } catch (err) {}
      return;
    }
    detailState.pdfUrl = result.url;
    detailState.pdfShown = result.shown;
    detailState.pdfTotal = result.total;
    detailState.pdfLoading = false;
  }).catch(function (err) {
    detailState.pdfError = err && err.message ? err.message : String(err);
    detailState.pdfLoading = false;
  });
}

export function closePdfPreview() {
  if (!detailState.pdfVisible) return;
  detailState.pdfVisible = false;
  detailState.pdfLoading = false;
  detailState.pdfError = "";
  releasePdfUrl();
  unlockScroll("pdf-preview");
}
