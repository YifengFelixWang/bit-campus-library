import { installTataUI } from "../core/tata-ui.js";

// 版本号统一提升，避免浏览器继续用旧的 console-*.js 缓存
const V = "?v=20261119w";

let loading = null;

export function loadConsole() {
  if (window.TataConsole) return Promise.resolve(window.TataConsole);
  if (loading) return loading;
  installTataUI();
  loading = import("../../console.js" + V)
    .then(function () { return import("../../console-books.js" + V); })
    .then(function () { return import("../../console-reviews.js" + V); })
    .then(function () { return import("../../console-announcements.js" + V); })
    .then(function () { return import("../../console-users.js" + V); })
    .then(function () { return import("../../console-lab.js" + V); })
    .then(function () { return import("../../console-data.js" + V); })
    .then(function () { return import("../../console-servers.js" + V); })
    .then(function () { return import("../../console-misc.js" + V); })
    // 真实数据页最后加载，覆盖上面几个文件的演示实现
    .then(function () { return import("../../console-real.js" + V); })
    .then(function () { return window.TataConsole; })
    .catch(function (err) {
      loading = null;
      throw err;
    });
  return loading;
}
