import { ref, computed, onMounted, watch } from "../../vendor/vue.esm-browser.prod.js";
import { route } from "../router.js";
import { loadConsole } from "../legacy/console-loader.js";
import { toast } from "../core/io.js";
import { roleName } from "../core/utils.js";
import { store } from "../store.js";
import { api } from "../services/api.js";

export default {
  name: "ConsoleView",
  setup() {
    const ready = ref(false);
    const error = ref("");

    // 侧栏底部的数据库连接标识：库名取自真实配置（library），
    // 当前连接账号来自 /api/me 的 database.current_user（按角色不同而不同），
    // 不再写死成演示用的库名 + 账户名。
    const dbUser = computed(function () {
      const u = store.user;
      const db = u && u.database ? u.database : null;
      if (!db) return "";
      return db.current_user || db.currentUser || db.session_user || db.sessionUser || "";
    });
    const dbLabel = computed(function () {
      return dbUser.value ? "library · 已连接" : "library · 未连接";
    });
    const dbTitle = computed(function () {
      return dbUser.value
        ? "数据库 library · 当前连接账号 " + dbUser.value
        : "尚未建立数据库连接";
    });

    // 侧栏节点状态：读 dbops-service 的 /api/ops/status。
    // 以前这行是 console.js 从浏览器本地演示层（localStorage 里的 tata-db-v6）
    // 取的「GaussDB 节点 A · 在线」，跟服务器真实拓扑无关，属于假数据，已断开。
    // 服务不可达时明确显示「运维服务不可达」，不沿用旧状态。
    const ops = ref(null);
    const opsError = ref("");

    const nodeLabel = computed(function () {
      if (opsError.value) return "运维服务不可达";
      const o = ops.value;
      if (!o) return "节点状态读取中";
      const db = o.database || {};
      if (db.reachable === false) return "数据库 · 不可达";
      if (!o.primary) return "单实例 · 在线";
      const primaryName = typeof o.primary === "string" ? o.primary : (o.primary.name || "node-a");
      const letter = String(primaryName).replace(/^node-/, "").toUpperCase();
      return "主节点 " + letter + " · " + (o.standby ? "备节点在线" : "无备节点");
    });
    const nodeState = computed(function () {
      if (opsError.value) return "offline";
      const o = ops.value;
      if (!o) return "pending";
      return (o.database && o.database.reachable === false) ? "offline" : "online";
    });
    const nodeTitle = computed(function () {
      if (opsError.value) return "运维服务不可达：" + opsError.value;
      const o = ops.value;
      if (!o) return "正在读取数据库节点状态";
      const db = o.database || {};
      const version = shortVersion(db.version);
      const parts = [];
      if (version) parts.push(version);
      if (o.primary) {
        const primaryName = typeof o.primary === "string" ? o.primary : (o.primary.name || "node-a");
        parts.push("主备部署 · 主节点 " + primaryName);
      } else {
        parts.push("单实例部署（未配置备节点）");
      }
      if (db.connections !== undefined && db.connections !== null) parts.push("连接数 " + db.connections);
      return parts.join(" · ");
    });

    function shortVersion(text) {
      const s = String(text || "");
      const m = s.match(/openGauss[\w.\-]*\s+[\w.\-]+/i);
      return m ? m[0].replace(/\s+/, " ") : "";
    }

    function loadOpsStatus() {
      api.opsStatus().then(function (res) {
        // opsStatus() 返回的是 { ok, data } 信封，真正的状态在 data 里
        if (!res || res.ok === false) {
          opsError.value = (res && res.message) || "dbops-service 未响应";
          ops.value = null;
          return;
        }
        const data = res.data ? res.data : res;
        opsError.value = "";
        ops.value = data && typeof data === "object" ? data : null;
      }).catch(function (err) {
        opsError.value = err && err.message ? err.message : "dbops-service 未响应";
        ops.value = null;
      });
    }

    function mount(tab) {
      if (!ready.value || route.name !== "console") return;
      if (!window.TataConsole || typeof window.TataConsole.mount !== "function") return;
      try {
        window.TataConsole.mount(tab || "overview");
      } catch (err) {
        error.value = err && err.message ? err.message : String(err);
      }
    }

    function ensure(tab) {
      // 身份（/api/me）还没回来时不要挂载控制台：
      // 旧版控制台按当前角色决定侧栏与首屏，此时会误判为「无权限」并弹回首页。
      // store.ready 变 true 后由下面的 watch 补一次挂载。
      if (!store.ready) return;
      if (ready.value) {
        mount(tab);
        return;
      }
      loadConsole().then(function () {
        ready.value = true;
        error.value = "";
        mount(route.tab);
      }).catch(function (err) {
        error.value = err && err.message ? err.message : String(err);
        toast("管理控制台加载失败，请刷新页面重试", "error");
      });
    }

    onMounted(function () {
      if (route.name === "console") {
        ensure(route.tab);
        loadOpsStatus();
      }
    });
    watch(function () { return store.ready; }, function (ok) {
      if (ok && route.name === "console") ensure(route.tab);
    });
    // 身份被管理员改掉后，控制台要跟着变：能进的就重挂载换侧栏，
    // 不能进的就退出，而不是停留在上一个角色的界面上。
    // 顺带重取一次节点状态：不同角色连的数据库账号不同。
    watch(function () { return store.user ? store.user.role : ""; }, function (role, prev) {
      if (!prev || !role || role === prev || route.name !== "console") return;
      loadOpsStatus();
      if (!api.can("console:access")) {
        toast("身份已变更为「" + roleName(role) + "」，该身份没有管理控制台权限", "warn");
        window.location.hash = "#home";
        return;
      }
      if (ready.value) mount(route.tab);
      toast("身份已更新为「" + roleName(role) + "」，控制台已同步", "success");
    });
    watch(function () { return route.name; }, function (name) {
      if (name === "console") {
        ensure(route.tab);
        loadOpsStatus();
      }
    });
    watch(function () { return route.tab; }, function (tab) {
      if (route.name === "console") mount(tab);
    });

    return { route, ready, error, dbLabel, dbTitle, dbUser, nodeLabel, nodeTitle, nodeState };
  },
  template: `
    <section class="console" id="consoleView">
      <div class="console-shell">
        <aside class="console-side">
          <div class="console-brand">
            <span class="brand-mark small" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z"/></svg>
            </span>
            <div>
              <strong>BIT书屋控制台</strong>
              <small>DATABASE COURSE DESIGN</small>
            </div>
          </div>
          <nav v-show="ready" class="side-nav" id="consoleNavList" aria-label="控制台导航">
            <button type="button" class="side-link" data-tab="overview" data-perm="borrow:read"><svg class="icon"><use href="#i-grid"></use></svg>运营概览</button>
            <button type="button" class="side-link" data-tab="books" data-perm="book:read"><svg class="icon"><use href="#i-book"></use></svg>图书管理</button>
            <button type="button" class="side-link" data-tab="borrows" data-perm="borrow:read"><svg class="icon"><use href="#i-swap"></use></svg>借阅管理</button>
            <button type="button" class="side-link" data-tab="reviews" data-perm="review:manage"><svg class="icon"><use href="#i-doc"></use></svg>读者评价</button>
            <button type="button" class="side-link" data-tab="announcements" data-perm="announcement:write"><svg class="icon"><use href="#i-log"></use></svg>公告管理</button>
            <button type="button" class="side-link" data-tab="users" data-perm="user:read"><svg class="icon"><use href="#i-users"></use></svg>用户与权限</button>
            <button type="button" class="side-link" data-tab="dblab" data-perm="db:query"><svg class="icon"><use href="#i-db"></use></svg>数据库实验台</button>
            <button type="button" class="side-link" data-tab="report-query" data-perm="report:read"><svg class="icon"><use href="#i-doc"></use></svg>报表查询</button>
            <button type="button" class="side-link" data-tab="report-stats" data-perm="report:read"><svg class="icon"><use href="#i-grid"></use></svg>借阅统计</button>
            <button type="button" class="side-link" data-tab="report-export" data-perm="report:read"><svg class="icon"><use href="#i-data"></use></svg>统计导出</button>
            <button type="button" class="side-link" data-tab="data" data-perm="data:export"><svg class="icon"><use href="#i-data"></use></svg>导入导出</button>
            <button type="button" class="side-link" data-tab="backup" data-perm="backup:manage"><svg class="icon"><use href="#i-archive"></use></svg>备份与恢复</button>
            <button type="button" class="side-link" data-tab="servers" data-perm="server:manage"><svg class="icon"><use href="#i-server"></use></svg>主备服务器</button>
            <button type="button" class="side-link" data-tab="audit" data-perm="audit:read"><svg class="icon"><use href="#i-log"></use></svg>审计日志</button>
          </nav>
          <div class="console-side-foot">
            <div class="side-db" :title="dbTitle">
              <i class="status-dot" :class="dbUser ? 'online' : 'offline'" aria-hidden="true"></i>
              <span>{{ dbLabel }}</span>
            </div>
            <div class="side-user" id="consoleSideUser">未登录</div>
            <div class="side-node" :title="nodeTitle">
              <i class="status-dot" :class="nodeState" aria-hidden="true"></i>
              <span>{{ nodeLabel }}</span>
            </div>
          </div>
        </aside>

        <div class="console-main">
          <div class="console-topbar">
            <div>
              <p class="eyebrow" id="consoleEyebrow">DATABASE CONSOLE</p>
              <div class="console-heading">
                <h1 id="consoleTitle">运营概览</h1>
                <span class="console-role role-admin" id="consoleRole">超级管理员</span>
              </div>
            </div>
            <div class="console-actions" id="consoleActions"></div>
          </div>
          <div class="console-body" id="consoleBody"></div>
          <div v-if="error" class="empty-panel">
            <h3>控制台加载失败</h3>
            <p>{{ error }}</p>
          </div>
        </div>
      </div>
    </section>
  `
};
