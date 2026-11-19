import { api } from "./services/api.js";
import { toast } from "./core/io.js";
import { openLogin } from "./core/login.js";
import { navigate, syncRoute } from "./router.js";
import { store } from "./store.js";

function replaceHome() {
  window.history.replaceState(null, "", "#home");
  syncRoute();
}

const LOGIN_HINT = "管理控制台需要登录（演示账号：librarian01 / analyst01 / ops01）";

/** 身份留在前端可能过期：进入控制台前强制回库里确认一次角色。 */
async function refreshRole() {
  const res = await api.refreshIdentity();
  if (res.ok && res.user) store.user = res.user;
  return res.ok;
}

export async function goConsole(tab) {
  let user = api.currentUser();
  if (!user && api.hasToken()) {
    await refreshRole();
    user = api.currentUser();
  }
  if (!user) {
    openLogin(LOGIN_HINT, function () { goConsole(tab); });
    return;
  }
  // 用 console:access 判断，而不是 borrow:read ——
  // 分析员与运维没有借阅权限，但需要进入自己的控制台页面
  if (!api.can("console:access")) {
    // 内存里的角色可能是旧的（管理员刚把这个人提成馆员）。
    // 拒绝之前回库里再确认一次，避免「已经提权但前端还按读者拦下来」。
    await refreshRole();
    if (!api.can("console:access")) {
      toast("当前账号没有管理控制台权限（读者账号不含该权限）。", "warn");
      return;
    }
  }
  navigate("#console/" + (tab || "overview"));
}

// 刷新页面后 state.user 要等 /api/me 返回才存在。
// 这里必须等身份加载完再判断，否则「有令牌但还没加载完」会被当成未登录，
// 表现为：直接打开 #console/... 被踢回首页并弹出登录框。
export async function guardConsole(tab) {
  let user = api.currentUser();
  if (!user && api.hasToken()) {
    await refreshRole();
    user = api.currentUser();
  }
  if (!user) {
    replaceHome();
    openLogin(LOGIN_HINT, function () { goConsole(tab); });
    return false;
  }
  if (!api.can("console:access")) {
    // 同上：角色可能刚被改过，判定前再拉一次真实身份
    await refreshRole();
    if (!api.can("console:access")) {
      replaceHome();
      toast("当前角色无权访问管理控制台，已返回首页。", "warn");
      return false;
    }
  }
  return true;
}
