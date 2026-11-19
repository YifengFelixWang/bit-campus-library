import { fmtDate, announcementAuthor } from "../core/utils.js";

export default {
  name: "AnnouncementCard",
  props: {
    item: { type: Object, required: true }
  },
  methods: {
    fmtDate: fmtDate,
    authorLabel: function () {
      return announcementAuthor(this.item.author);
    }
  },
  template: `
    <article class="announcement" :class="{ pinned: item.pinned }">
      <div class="announcement-head">
        <div class="announcement-title">
          <span v-if="item.pinned" class="pin-badge">置顶</span>
          <h3>{{ item.title }}</h3>
        </div>
        <span class="announcement-date">{{ fmtDate(item.updated_at || item.created_at) }}</span>
      </div>
      <p class="announcement-content">{{ item.content }}</p>
      <div class="announcement-foot"><span>{{ authorLabel() }}</span><span>馆内公告</span></div>
    </article>
  `
};
