import { ref, computed, onMounted, onUnmounted, watch } from "../../vendor/vue.esm-browser.prod.js";
import { store, isStaff, isAdmin, myBorrowCount } from "../store.js";
import { api } from "../services/api.js";
import { roleName } from "../core/utils.js";
import { openLogin } from "../core/login.js";
import { confirmAction } from "../core/modal.js";
import { toast } from "../core/io.js";
import { route, navState, navigate } from "../router.js";
import { goConsole } from "../navigation.js";

export default {
  name: "SiteHeader",
  setup() {
    const menuOpen = ref(false);
    const accountWrap = ref(null);

    const user = computed(function () { return store.user; });
    const staff = computed(function () { return isStaff(); });
    const admin = computed(function () { return isAdmin(); });
    const borrowCount = computed(function () { return myBorrowCount(); });
    // 顶部节点徽标：读 dbops-service 的 /api/ops/status。
    // primary / standby 是节点对象（含 name、role、dbState），不再是字符串。
    const primary = computed(function () {
      const ops = store.ops;
      if (!ops || !ops.primary) return null;
      const name = typeof ops.primary === "string" ? ops.primary : (ops.primary.name || "node-a");
      return {
        id: name,
        status: ops.database && ops.database.reachable === false ? "offline" : "online"
      };
    });
    const nodeState = computed(function () {
      const ops = store.ops;
      if (!ops) return "pending";
      return ops.database && ops.database.reachable === false ? "offline" : "online";
    });
    const clusterText = computed(function () {
      const ops = store.ops;
      if (!ops) return "主节点";
      if (!ops.primary) return nodeState.value === "offline" ? "单实例 · 不可达" : "单实例";
      const name = typeof ops.primary === "string" ? ops.primary : (ops.primary.name || "node-a");
      const letter = String(name).replace(/^node-/, "").toUpperCase();
      return "主节点 " + letter + (nodeState.value === "offline" ? " · 离线" : "");
    });
    const clusterTitle = computed(function () {
      const ops = store.ops;
      if (!ops) return "";
      const db = ops.database || {};
      const m = String(db.version || "").match(/openGauss[\w.\-]*\s+[\w.\-]+/i);
      const parts = [];
      if (m) parts.push(m[0]);
      const primaryName = ops.primary
        ? (typeof ops.primary === "string" ? ops.primary : (ops.primary.name || "node-a"))
        : "";
      parts.push(primaryName ? "主节点 " + primaryName : "单实例部署（未配置备节点）");
      if (db.connections !== undefined && db.connections !== null) parts.push("连接数 " + db.connections);
      return parts.join(" · ");
    });
    const active = computed(function () {
      if (route.name === "notices") return "notices";
      if (route.name === "library") return "library";
      if (route.name === "console") return "console";
      if (route.name === "shelf") return route.tab === "reviews" ? "shelf-reviews" : "shelf-borrows";
      // 首页内的区块（新上架 / 热门 / 公告 / 我的借阅）已没有独立导航项，
      // 滚动到这些区块时统一高亮「首页」，否则会出现导航全不亮的情况。
      const section = navState.section;
      if (section && ["home", "notices", "library"].indexOf(section) < 0) return "home";
      return section;
    });

    function navClass(key) {
      return { "is-active": active.value === key };
    }
    function toggleMenu() {
      menuOpen.value = !menuOpen.value;
    }
    function closeMenu() {
      menuOpen.value = false;
    }
    function onDocumentClick(event) {
      if (!menuOpen.value) return;
      if (accountWrap.value && !accountWrap.value.contains(event.target)) closeMenu();
    }
    function login() { closeMenu(); openLogin(); }
    function switchAccount() {
      closeMenu();
      openLogin();
    }
    function consoleEntry() {
      closeMenu();
      goConsole("overview");
    }
    function clusterEntry() {
      const current = api.currentUser();
      if (!current) {
        openLogin("登录管理员账号可查看主备集群详情", function () { goConsole("servers"); });
        return;
      }
      goConsole("servers");
    }
    function logout() {
      closeMenu();
      confirmAction({
        icon: "logout",
        title: "退出登录",
        desc: "退出后将回到访客状态，仍可浏览图书，但不能借阅。",
        confirmText: "退出登录",
        danger: true,
        onConfirm: function () {
          api.logout();
          // api.logout 只清内部 state，store 里还留着旧用户对象，
          // 不清掉的话顶部会继续显示上一个账号和「管理控制台」入口。
          store.user = null;
          store.borrows = [];
          toast("已退出登录");
          if (route.name === "console") navigate("#home");
          return true;
        }
      });
    }

    watch(function () { return route.hash; }, closeMenu);
    onMounted(function () { document.addEventListener("click", onDocumentClick); });
    onUnmounted(function () { document.removeEventListener("click", onDocumentClick); });

    return {
      store, route, user, staff, admin, borrowCount, primary, nodeState, clusterText, clusterTitle,
      menuOpen, accountWrap, navClass, toggleMenu, login, switchAccount,
      consoleEntry, clusterEntry, logout, roleName
    };
  },
  template: `
    <header class="site-header">
      <div class="container header-inner">
        <a class="brand" href="#home" aria-label="BIT书屋首页">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/>
              <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z"/>
              <path d="M8 7h8M8 10.5h5"/>
            </svg>
          </span>
          <span class="brand-text">BIT书屋<small>BIT BOOKS</small></span>
        </a>

        <nav class="nav" aria-label="主导航">
          <a href="#home" class="nav-link" data-nav="home" :class="navClass('home')">首页</a>
          <a href="#notices" class="nav-link" data-nav="notices" :class="navClass('notices')">馆内公告</a>
          <a href="#library" class="nav-link" data-nav="library" :class="navClass('library')">全部图书</a>
          <a href="#shelf/borrows" class="nav-link" data-nav="shelf-borrows" :class="navClass('shelf-borrows')">我的借阅<span v-if="borrowCount > 0" class="nav-badge" id="navBorrowCount">{{ borrowCount }}</span></a>
          <a href="#shelf/reviews" class="nav-link" data-nav="shelf-reviews" :class="navClass('shelf-reviews')">我的评价</a>
          <a v-if="admin" href="./docs.html" class="nav-link nav-docs" data-admin-only>文档中心</a>
        </nav>

        <div class="header-actions">
          <button v-if="staff" class="cluster-chip" type="button" id="clusterChip" :title="clusterTitle" @click="clusterEntry">
            <i class="status-dot" id="clusterDot" :class="nodeState" aria-hidden="true"></i>
            <span id="clusterChipText">{{ clusterText }}</span>
          </button>
          <a v-if="staff" href="#console/overview" class="console-cta" id="consoleNav" :class="{ 'is-active': route.name === 'console' }" @click.prevent="consoleEntry">
            <svg class="icon" aria-hidden="true"><use href="#i-grid"></use></svg><span>管理控制台</span>
          </a>
          <template v-if="!user">
            <button class="login-btn" type="button" id="loginBtn" @click="login">
              <svg class="icon" aria-hidden="true"><use href="#i-login"></use></svg>登录
            </button>
          </template>
          <div v-else class="account-wrap" id="accountWrap" ref="accountWrap">
            <button class="user-chip" type="button" id="userChip" aria-haspopup="menu" :aria-expanded="menuOpen ? 'true' : 'false'" @click.stop="toggleMenu">
              <span class="avatar" id="userAvatar" aria-hidden="true">{{ user.name.charAt(0) }}</span>
              <span class="user-meta">
                <strong id="userName">{{ user.name }}</strong>
                <small id="userRole" class="role-tag" :class="'role-' + user.role">{{ roleName(user.role) }}</small>
              </span>
              <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="account-menu" id="accountMenu" role="menu" v-show="menuOpen">
              <div class="account-head">
                <strong id="menuUserName">{{ user.name }}</strong>
                <span id="menuUserAccount">{{ user.username }} · {{ user.role }}</span>
                <small v-if="user.database">借阅数据库：{{ user.database.current_user }}</small>
              </div>
              <button v-if="staff" type="button" id="menuConsole" role="menuitem" @click="consoleEntry"><svg class="icon"><use href="#i-grid"></use></svg>管理控制台</button>
              <button type="button" id="menuSwitch" role="menuitem" @click="switchAccount"><svg class="icon"><use href="#i-swap"></use></svg>切换账号</button>
              <button type="button" id="menuLogout" role="menuitem" class="danger" @click="logout"><svg class="icon"><use href="#i-logout"></use></svg>退出登录</button>
            </div>
          </div>
        </div>
      </div>
    </header>
  `
};
