import { reactive } from "../vendor/vue.esm-browser.prod.js";
import { api } from "./services/api.js";

export const store = reactive({
  ready: false,
  user: null,
  books: [],
  hot: [],
  newArrivals: [],
  categories: [],
  announcements: [],
  borrows: [],
  reviews: [],
  stats: null,
  cluster: null,
  // 真实数据库节点状态（/api/catalog/ops/status），控件台侧栏与顶部徽标共用
  ops: null,
  revision: 0,
  identityEpoch: 0,
  lastChange: ""
});

let changeHandler = null;

export function onStoreChange(handler) {
  changeHandler = handler;
}

/** 只刷新公告：进入公告页、工作人员发布后调用，不必整库重拉。 */
export async function refreshAnnouncements(publishedOnly) {
  const res = await api.consoleAnnouncements(publishedOnly !== false);
  if (!res || !res.ok) return;
  const items = (res.data && res.data.items) || [];
  store.announcements = items.map(function (x) {
    return {
      id: x.announcementId,
      title: x.title,
      content: x.content,
      author: "librarian",
      created_at: x.createdAt,
      updated_at: x.updatedAt,
      pinned: Boolean(x.pinned)
    };
  });
}

export async function refreshStore() {
  await api.preload();
  store.user = api.currentUser();
  store.books = api.books();
  // 热门图书：每种分类各取借阅量最高的 8 本（详见 api.hotByCategory）
  store.hot = api.hotByCategory("全部", 8);
  store.newArrivals = api.newArrivals(6);
  store.categories = api.categories();
  await refreshAnnouncements(true);
  store.borrows = api.listBorrows({ status: "all" });
  store.reviews = api.reviewsFor(null, { type: "review" });
  store.stats = api.stats();
  store.cluster = api.clusterSnapshot();
  // 节点状态不阻塞首屏：先返回，接口回来再填充（响应式，徽标会自动刷新）
  if (api.hasToken()) {
    api.opsStatus().then(function (res) {
      store.ops = res && res.ok ? res.data : null;
    }).catch(function () { store.ops = null; });
  } else {
    // 节点状态需要登录，匿名访问必然 401，不如不发
    store.ops = null;
  }
  store.revision += 1;
  store.ready = true;
}

export function initStore() {
  // 首屏先渲染空态，数据到了由响应式自动更新
  refreshStore();
}

export function myBorrowCount() {
  if (!store.user) return 0;
  // 必须读响应式的 store.borrows：api 内部的 loans 是普通数组，
  // 读它不会建立依赖，借书/还书后徽标会一直停在登录时那个数字。
  const uid = Number(store.user.id);
  return store.borrows.filter(function (row) {
    return Number(row.user_id) === uid && row.status === "BORROWED";
  }).length;
}

export function isStaff() {
  return api.can("console:access", store.user);
}

/**
 * 把库里的身份同步到前端。运维在控制台改完别人的身份后，
 * 对方无需重新登录：下一次轮询 / 切回标签页就会拿到新角色，
 * 控制台入口与控制台内各标签随之更新。
 */
export async function syncIdentity() {
  if (!api.hasToken()) return false;
  const before = store.user ? store.user.role : null;
  const res = await api.refreshIdentity();
  if (!res.ok || !res.user) {
    if (!api.hasToken()) { store.user = null; store.borrows = []; }
    return false;
  }
  const after = res.user.role;
  store.user = res.user;
  if (before && after && before !== after) {
    store.identityEpoch += 1;
    store.revision += 1;
    // 角色变了，可见数据范围也变了（例如读者 → 馆员要能看到全馆借阅）
    await refreshStore();
    return true;
  }
  return false;
}

export function isAdmin() {
  return Boolean(store.user && store.user.role === "admin");
}
