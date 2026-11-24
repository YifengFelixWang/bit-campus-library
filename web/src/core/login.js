import { reactive } from "../../vendor/vue.esm-browser.prod.js";
import { api } from "../services/api.js";
import { toast } from "./io.js";
import { roleName } from "./utils.js";
import { lockScroll, unlockScroll } from "./overlay.js";
import { store, refreshStore } from "../store.js";

export const loginState = reactive({
  visible: false,
  mode: "login",        // login | register
  username: "",
  password: "",
  loginError: "",
  submitting: false
});

export const registerState = reactive({
  username: "",
  password: "",
  confirm: "",
  displayName: "",
  error: "",
  submitting: false
});

let pendingAfterLogin = null;

export function openLogin(reason, onSuccess) {
  pendingAfterLogin = typeof onSuccess === "function" ? onSuccess : null;
  loginState.visible = true;
  loginState.mode = "login";
  registerState.error = "";
  loginState.username = "";
  loginState.password = "";
  loginState.loginError = "";
  lockScroll("login");
  if (reason) toast(reason, "warn");
}

export function closeLogin() {
  loginState.password = "";
  loginState.visible = false;
  pendingAfterLogin = null;
  loginState.loginError = "";
  unlockScroll("login");
}

export async function submitLogin() {
  if (loginState.submitting) return;
  loginState.submitting = true;
  loginState.loginError = "";
  store.user = null;
  store.borrows = [];
  const result = await api.login(loginState.username.trim(), loginState.password);
  loginState.submitting = false;
  loginState.password = "";
  if (!result.ok) {
    loginState.loginError = result.message;
    return;
  }
  store.user = result.user;
  const callback = pendingAfterLogin;
  pendingAfterLogin = null;
  loginState.visible = false;
  unlockScroll("login");
  toast("欢迎回来，" + result.user.name + "（" + roleName(result.user.role) + "）");
  refreshStore();
  // 在控制台内直接切换账号时，必须重新挂载一次，否则侧栏与 tab 权限还是上一个角色的
  if (window.TataConsole && typeof window.TataConsole.mount === "function"
      && location.hash.indexOf("#console") === 0) {
    window.TataConsole.mount(location.hash.split("/")[1] || "overview");
  }
  if (callback) callback();
}

export async function submitRegister() {
  if (registerState.submitting) return;
  registerState.error = "";
  const username = registerState.username.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(username)) {
    registerState.error = "用户名 3–32 位，字母开头，可以带数字和下划线。";
    return;
  }
  if (registerState.password.length < 8) {
    registerState.error = "密码至少 8 位。";
    return;
  }
  if (registerState.password !== registerState.confirm) {
    registerState.error = "两次输入的密码不一样。";
    return;
  }
  registerState.submitting = true;
  const result = await api.register(username, registerState.password, registerState.displayName.trim());
  registerState.submitting = false;
  if (!result.ok) {
    registerState.error = result.message;
    return;
  }
  toast("注册好了，正在给你登录");
  loginState.username = username;
  loginState.password = registerState.password;
  loginState.mode = "login";
  registerState.username = registerState.password = registerState.confirm = registerState.displayName = "";
  await submitLogin();
}
