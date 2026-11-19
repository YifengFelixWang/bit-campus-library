import { esc, fmtDate, fmtDateTime, fmtBytes, roleName, icon, bookScore, scoreText } from "./utils.js";
import { openModal, closeModal, confirmAction } from "./modal.js";
import { toast, download, readTextFile, readDataUrl } from "./io.js";
import { openLogin } from "./login.js";
import { api } from "../services/api.js";
import { refreshStore } from "../store.js";

export function requirePerm(permission, message) {
  if (api.can(permission)) return true;
  toast(message || "当前账号没有该操作权限", "warn");
  return false;
}

export function installTataUI() {
  window.TataUI = {
    esc: esc,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    fmtBytes: fmtBytes,
    roleName: roleName,
    icon: icon,
    toast: toast,
    modal: openModal,
    closeModal: closeModal,
    confirm: confirmAction,
    openLogin: openLogin,
    requirePerm: requirePerm,
    currentUser: function () { return api.currentUser(); },
    bookScore: bookScore,
    scoreText: scoreText,
    refreshAll: refreshStore,
    download: download,
    readTextFile: readTextFile,
    readDataUrl: readDataUrl
  };
}
