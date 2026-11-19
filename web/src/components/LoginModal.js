import { ref, watch, nextTick } from "../../vendor/vue.esm-browser.prod.js";
import { loginState, closeLogin, submitLogin } from "../core/login.js";

export default {
  setup() {
    const usernameInput = ref(null);
    watch(() => loginState.visible, visible => {
      if (visible) nextTick(() => usernameInput.value?.focus());
    });
    return { loginState, closeLogin, submitLogin, usernameInput };
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
            <h2 id="loginTitle">登录 BIT 书屋</h2>
            <p id="loginSubtitle">请输入图书室账号和密码。</p>
          </div>
        </div>

          <form id="loginForm" class="login-form" autocomplete="on" @submit.prevent="submitLogin">
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
          </form>
      </div>
    </div>
  `
};
