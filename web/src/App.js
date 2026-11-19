import { watch, nextTick, onUnmounted } from "../vendor/vue.esm-browser.prod.js";
import { route, navState } from "./router.js";
import { onStoreChange } from "./store.js";
import { guardConsole } from "./navigation.js";
import { closeModal } from "./core/modal.js";
import { loginState, closeLogin } from "./core/login.js";
import { detailState, closeBookDetail, closePdfPreview } from "./core/book-detail.js";
import { reviewState, closeReview } from "./core/review.js";
import SiteHeader from "./components/SiteHeader.js";
import HomeView from "./components/HomeView.js";
import NoticesView from "./components/NoticesView.js";
import LibraryView from "./components/LibraryView.js";
import ShelfView from "./components/ShelfView.js";
import ConsoleView from "./components/ConsoleView.js";
import LoginModal from "./components/LoginModal.js";
import BookDetailModal from "./components/BookDetailModal.js";
import ReviewModal from "./components/ReviewModal.js";

export default {
  name: "App",
  components: {
    SiteHeader, HomeView, NoticesView, LibraryView, ShelfView, ConsoleView,
    LoginModal, BookDetailModal, ReviewModal
  },
  setup() {
    onStoreChange(function (type) {
      if (route.name !== "console") return;
      if (window.TataConsole && typeof window.TataConsole.onDataChange === "function") {
        window.TataConsole.onDataChange(type);
      }
    });

    watch(function () { return [route.name, route.tab]; }, function () {
      if (route.name === "console") guardConsole(route.tab);
    }, { immediate: true, flush: "sync" });

    watch(function () { return [route.name, route.section, navState.epoch]; }, function () {
      nextTick(function () {
        if (route.name === "home") {
          if (route.section === "home") {
            window.scrollTo({ top: 0, behavior: navState.epoch > 1 ? "smooth" : "auto" });
          } else {
            const target = document.getElementById(route.section);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        } else {
          window.scrollTo({ top: 0, behavior: "auto" });
        }
      });
    }, { immediate: true });

    watch(function () { return route.name; }, function (name) {
      document.body.classList.toggle("console-open", name === "console");
    }, { immediate: true });

    function onKeydown(event) {
      if (event.key !== "Escape") return;
      const modal = document.getElementById("modal");
      if (modal && !modal.hidden) { closeModal(); return; }
      if (reviewState.visible) { closeReview(); return; }
      if (detailState.pdfVisible) { closePdfPreview(); return; }
      if (detailState.visible) { closeBookDetail(); return; }
      if (loginState.visible) closeLogin();
    }
    window.addEventListener("keydown", onKeydown);
    onUnmounted(function () {
      window.removeEventListener("keydown", onKeydown);
      onStoreChange(null);
    });

    return { route, loginState };
  },
  template: `
    <div>
      <SiteHeader></SiteHeader>
      <HomeView v-show="route.name === 'home'"></HomeView>
      <NoticesView v-if="route.name === 'notices'"></NoticesView>
      <LibraryView v-if="route.name === 'library'"></LibraryView>
      <ShelfView v-if="route.name === 'shelf'" :tab="route.tab"></ShelfView>
      <ConsoleView v-show="route.name === 'console'"></ConsoleView>
      <LoginModal></LoginModal>
      <BookDetailModal></BookDetailModal>
      <ReviewModal></ReviewModal>
    </div>
  `
};
