import { ref, watch, nextTick } from "../../vendor/vue.esm-browser.prod.js";
import { loginState, registerState, closeLogin, submitLogin, submitRegister } from "../core/login.js";

export default {
  setup() {
    const usernameInput = ref(null);
    const registerInput = ref(null);
    watch(() => loginState.visible, visible => {
      if (visible) nextTick(() => usernameInput.value?.focus());
    });
    watch(() => loginState.mode, mode => {
      if (mode === "register") nextTick(() => registerInput.value?.focus());
    });
    function toRegister() {
      loginState.mode = "register";
      registerState.error = "";
      registerState.username = loginState.username || "";
    }
    function toLogin() {
      loginState.mode = "login";
      loginState.loginError = "";
    }
    return { loginState, registerState, closeLogin, submitLogin, submitRegister, usernameInput, registerInput, toRegister, toLogin };
  },
  template: `
    <div class="modal-backdrop" id="loginModal" v-show="loginState.visible" @click.self="closeLogin">
      <div class="modal login-modal" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
        <button class="modal-close" type="button" id="loginClose" aria-label="关闭" @click="closeLogin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
        <div class="login-head">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z"/></svg>
          </span>
          <div>
            <h2 id="loginTitle">{{ loginState.mode === "register" ? "注册读者账号" : "登录 BIT 书屋" }}</h2>
            <p id="loginSubtitle">{{ loginState.mode === "register" ? "填个用户名和密码就行，注册后直接进入书屋。" : "请输入图书室账号和密码。" }}</p>
          </div>
        </div>

        <form v-if="loginState.mode === 'login'" id="loginForm" class="login-form" autocomplete="on" @submit.prevent="submitLogin">
          <label class="field">
            <span>账号</span>
            <input ref="usernameInput" id="loginUsername" name="username" v-model="loginState.username" type="text" placeholder="reader01 / reader02" autocomplete="username" required>
          </label>
          <label class="field">
            <span>密码</span>
            <input id="loginPassword" name="password" v-model="loginState.password" type="password" placeholder="请输入账号密码" autocomplete="current-password" required>
          </label>
          <p v-if="loginState.loginError" class="form-error" id="loginError">{{ loginState.loginError }}</p>
          <button type="submit" class="btn btn-primary btn-block" :disabled="loginState.submitting">登录</button>
          <p class="login-switch">还没有账号？<button type="button" id="toRegister" @click="toRegister">注册一个</button></p>
        </form>

        <form v-else id="registerForm" class="login-form" autocomplete="off" @submit.prevent="submitRegister">
          <label class="field">
            <span>用户名</span>
            <input ref="registerInput" id="registerUsername" name="username" v-model="registerState.username" type="text" placeholder="字母开头，3–32 位" autocomplete="username" required>
          </label>
          <label class="field">
            <span>显示名（可不填）</span>
            <input id="registerName" name="displayName" v-model="registerState.displayName" type="text" placeholder="同学们怎么称呼你" autocomplete="nickname">
          </label>
          <label class="field">
            <span>密码</span>
            <input id="registerPassword" name="password" v-model="registerState.password" type="password" placeholder="至少 8 位" autocomplete="new-password" required>
          </label>
          <label class="field">
            <span>再输一次</span>
            <input id="registerConfirm" name="confirm" v-model="registerState.confirm" type="password" placeholder="确认密码" autocomplete="new-password" required>
          </label>
          <p v-if="registerState.error" class="form-error" id="registerError">{{ registerState.error }}</p>
          <button type="submit" class="btn btn-primary btn-block" :disabled="registerState.submitting">注册并登录</button>
          <p class="login-switch">已经有账号了？<button type="button" id="toLogin" @click="toLogin">返回登录</button></p>
        </form>
      </div>
    </div>
  `
};
