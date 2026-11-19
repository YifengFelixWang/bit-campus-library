/**
 * 站点页脚。当前**未挂载**：按要求去掉了页面底部的小字说明，
 * 需要恢复时在 App.js 里重新 import 并放回模板 `<SiteFooter></SiteFooter>` 即可。
 */
import { computed } from "../../vendor/vue.esm-browser.prod.js";
import { isStaff, isAdmin } from "../store.js";

export default {
  name: "SiteFooter",
  setup() {
    return {
      staff: computed(function () { return isStaff(); }),
      admin: computed(function () { return isAdmin(); })
    };
  },
  template: `
    <footer class="site-footer">
      <div class="container footer-inner">
        <div class="footer-brand">
          <span class="brand-mark small" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z"/><path d="M8 7h8M8 10.5h5"/></svg>
          </span>
          <span>BIT书屋 · 让每一本书都找到它的读者</span>
        </div>
        <div class="footer-links">
          <a v-if="staff" href="#console/overview">管理控制台</a>
          <a v-if="admin" href="./docs.html">设计文档</a>
          <a v-if="staff" href="#console/dblab">数据库实验台</a>
        </div>
        <p class="footer-meta">数据库课程设计 · Vue 3 前端 · 数据保存在浏览器本地</p>
      </div>
    </footer>
  `
};
