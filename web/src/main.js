import { createApp } from "../vendor/vue.esm-browser.prod.js";
import App from "./App.js";
import { startRouter } from "./router.js";
import { initStore, syncIdentity, store } from "./store.js";
import { installTataUI } from "./core/tata-ui.js";
import { api } from "./services/api.js";

initStore();
installTataUI();
startRouter();

const app = createApp(App);
app.mount("#app");
window.__TATA_VUE_APP__ = app;
// 供旧版控制台复用真实权限判断（控制台自身仍是遗留代码，见 console-loader.js）
window.__TATA_API__ = api;
// 调试用：控制台里可以直接看当前身份状态（只读引用，不要改它）
window.__TATA_STORE__ = store;

// 身份自动同步：管理员改了某人的身份后，被改的人不用重新登录。
// 轮询保持低频，切回标签页时立即拉一次，避免频繁请求。
setInterval(function () { syncIdentity(); }, 15000);
window.addEventListener("focus", function () { syncIdentity(); });
document.addEventListener("visibilitychange", function () {
  if (!document.hidden) syncIdentity();
});
