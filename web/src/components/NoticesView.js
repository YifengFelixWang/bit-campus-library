import { computed, onMounted } from "../../vendor/vue.esm-browser.prod.js";
import { store, isStaff, refreshAnnouncements } from "../store.js";
import AnnouncementCard from "./AnnouncementCard.js";

export default {
  name: "NoticesView",
  components: { AnnouncementCard },
  setup() {
    // 工作人员刚发布的公告要能立刻看到，进页面时单独刷一次
    onMounted(function () { refreshAnnouncements(true); });
    return {
      announcements: computed(function () { return store.announcements; }),
      staff: computed(function () { return isStaff(); })
    };
  },
  template: `
    <main id="noticesView" class="inner-page">
      <section class="page-hero">
        <div class="container">
          <a class="page-back" href="#home">← 返回首页</a>
          <p class="eyebrow">NOTICE BOARD</p>
          <h1>馆内公告</h1>
          <div class="page-meta">
            <span class="pill" id="noticeTotal">共 {{ announcements.length }} 条公告</span>
            <a v-if="staff" class="btn btn-ghost btn-sm" href="#console/announcements">管理公告</a>
          </div>
        </div>
      </section>
      <section class="section page-section">
        <div class="container">
          <div class="section-head">
            <div>
              <p class="eyebrow">ALL NOTICES</p>
              <h2>全部公告</h2>
            </div>
          </div>
          <div class="announcement-list" id="allAnnouncementList">
            <AnnouncementCard v-for="item in announcements" :key="item.id" :item="item"></AnnouncementCard>
          </div>
          <div v-if="!announcements.length" class="empty-borrows" id="allAnnouncementEmpty">
            <div class="empty-illustration" aria-hidden="true">
              <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 16h40v26H34L22 52V42H12z"/>
                <path d="M22 26h20M22 33h13"/>
              </svg>
            </div>
            <h3>暂时没有公告</h3>
            <p>馆员发布公告后会显示在这里。</p>
          </div>
        </div>
      </section>
    </main>
  `
};
