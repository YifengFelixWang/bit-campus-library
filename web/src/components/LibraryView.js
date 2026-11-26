import { ref, reactive, computed, watch, onMounted } from "../../vendor/vue.esm-browser.prod.js";
import { store } from "../store.js";
import { api } from "../services/api.js";
import BookCard from "./BookCard.js";

/**
 * 全部图书 · 多条件联动查询
 *
 * 页面上所有条件都原样发给 GET /api/catalog/books/search，
 * 前端不做过滤也不拼 SQL——过滤和分页都在数据库侧完成，
 * 一次请求关联 book / category / book_author / author / media 五张表。
 */
const CURRENT_YEAR = new Date().getFullYear();

export default {
  name: "LibraryView",
  components: { BookCard },
  setup() {
    const PAGE_SIZE = 12;
    const DEFAULT_STATUS = "ON_SHELF";

    const form = reactive({
      title: "",
      author: "",
      publisher: "",
      isbn: "",
      categoryId: "",
      yearFrom: 0,
      yearTo: CURRENT_YEAR,
      status: DEFAULT_STATUS,
      hasPdf: "",
      sortBy: "updatedAt",
      sortOrder: "desc"
    });

    const result = ref({
      items: [], total: 0, page: 1, size: PAGE_SIZE, totalPages: 0,
      joinTables: [], appliedConditions: 0
    });
    const loading = ref(false);
    const error = ref("");
    const expanded = ref(true);
    const searched = ref(false);

    const categories = computed(function () {
      return ["全部"].concat(store.categories.map(function (c) { return c.name; }));
    });

    const activeCategory = computed(function () {
      if (!form.categoryId) return "全部";
      const hit = store.categories.filter(function (c) { return String(c.id) === String(form.categoryId); })[0];
      return hit ? hit.name : "全部";
    });

    const page = computed(function () { return result.value.page || 1; });
    const totalPages = computed(function () { return result.value.totalPages || 0; });

    /**
     * 「已应用 N 个条件」按用户实际填的内容数，不含默认的「在架」——
     * 后端返回的 appliedConditions 把默认状态也算一个条件，直接展示会让人以为
     * 自己没填却"已应用 1 个条件"。这里以表单为准，后端字段留给接口调用方。
     */
    const conditionCount = computed(function () {
      let n = 0;
      if (form.title.trim()) n += 1;
      if (form.author.trim()) n += 1;
      if (form.publisher.trim()) n += 1;
      if (form.isbn.trim()) n += 1;
      if (form.categoryId !== "") n += 1;
      if (form.yearFrom !== "" || form.yearTo !== "") n += 1;
      if (form.status !== DEFAULT_STATUS) n += 1;
      return n;
    });

    /** 分页按钮：当前页居中，最多 7 个，两端用 1 / 末页兜住 */
    const pageList = computed(function () {
      const total = totalPages.value;
      const cur = page.value;
      if (total <= 7) {
        const all = [];
        for (let i = 1; i <= total; i += 1) all.push(i);
        return all;
      }
      const list = [1];
      const start = Math.max(2, cur - 2);
      const end = Math.min(total - 1, cur + 2);
      if (start > 2) list.push("…");
      for (let i = start; i <= end; i += 1) list.push(i);
      if (end < total - 1) list.push("…");
      list.push(total);
      return list;
    });

    function payload(targetPage) {
      return {
        title: form.title.trim(),
        author: form.author.trim(),
        publisher: form.publisher.trim(),
        isbn: form.isbn.trim(),
        categoryId: form.categoryId === "" ? "" : form.categoryId,
        // 默认范围就是「公元 0 年 ~ 今年」，这两个边界等于不设限，不必发给后端
        yearFrom: Number(form.yearFrom) > 0 ? form.yearFrom : "",
        yearTo: Number(form.yearTo) < CURRENT_YEAR ? form.yearTo : "",
        status: form.status,
        hasPdf: form.hasPdf,
        sortBy: form.sortBy,
        sortOrder: form.sortOrder,
        page: targetPage,
        size: PAGE_SIZE
      };
    }

    async function run(targetPage) {
      loading.value = true;
      error.value = "";
      const res = await api.searchBooks(payload(targetPage));
      loading.value = false;
      if (!res.ok) {
        error.value = res.message || "查询失败";
        result.value = { items: [], total: 0, page: 1, size: PAGE_SIZE, totalPages: 0, joinTables: [], appliedConditions: 0 };
        searched.value = true;
        return;
      }
      result.value = res;
      searched.value = true;
    }

    function submit() { run(1); }
    function goPage(target) {
      if (typeof target !== "number" || loading.value) return;
      if (target < 1 || (totalPages.value && target > totalPages.value) || target === page.value) return;
      run(target);
    }

    function setPdfFilter(value) {
      form.hasPdf = value;
      run(1);
    }

    function setCategory(name) {
      if (name === "全部") {
        form.categoryId = "";
      } else {
        const hit = store.categories.filter(function (c) { return c.name === name; })[0];
        form.categoryId = hit ? hit.id : "";
      }
      run(1);
    }

    function reset() {
      form.title = "";
      form.author = "";
      form.publisher = "";
      form.isbn = "";
      form.categoryId = "";
      form.yearFrom = 0;
      form.yearTo = CURRENT_YEAR;
      form.hasPdf = "";
      form.status = DEFAULT_STATUS;
      form.sortBy = "updatedAt";
      form.sortOrder = "desc";
      run(1);
    }

    function togglePanel() { expanded.value = !expanded.value; }

    // 首次进入要等 store 预加载完（副本数量、分类都在里面），
    // 否则卡片上的「可借 N 本」会先显示 0 再跳变。
    onMounted(function () {
      if (store.ready) run(1);
    });
    watch(function () { return store.ready; }, function (ok) {
      if (ok && !searched.value) run(1);
    });

    return {
      store, currentYear: CURRENT_YEAR,
      form, result, loading, error, expanded, searched,
      categories, activeCategory, page, totalPages, pageList, conditionCount,
      submit, goPage, setCategory, setPdfFilter, reset, togglePanel
    };
  },
  template: `
    <main id="libraryView" class="inner-page">
      <section class="page-hero">
        <div class="container">
          <a class="page-back" href="#home">← 返回首页</a>
          <p class="eyebrow">ALL BOOKS</p>
          <h1>全部图书</h1>

          <form class="query-panel" id="bookQueryForm" role="search" @submit.prevent="submit">
            <div class="query-panel-head">
              <div>
                <h2>多条件查询</h2>
                <p class="query-hint">书名、作者、出版社、ISBN、分类、出版年份可任意组合，条件之间是「同时满足」。</p>
              </div>
              <button class="query-toggle" type="button" @click="togglePanel">
                {{ expanded ? '收起条件' : '展开条件' }}
              </button>
            </div>

            <div class="query-grid" v-show="expanded">
              <label class="qfield">
                <span>书名</span>
                <input v-model="form.title" type="text" placeholder="如：数据库" maxlength="100">
              </label>
              <label class="qfield">
                <span>作者</span>
                <input v-model="form.author" type="text" placeholder="如：王珊" maxlength="100">
              </label>
              <label class="qfield">
                <span>出版社</span>
                <input v-model="form.publisher" type="text" placeholder="如：清华大学出版社" maxlength="100">
              </label>
              <label class="qfield">
                <span>ISBN</span>
                <input v-model="form.isbn" type="text" placeholder="如：978-7" maxlength="100">
              </label>

              <label class="qfield">
                <span>分类</span>
                <select v-model="form.categoryId">
                  <option value="">全部分类</option>
                  <option v-for="c in store.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </label>
              <label class="qfield">
                <span>出版年份（起）</span>
                <input v-model="form.yearFrom" type="number" inputmode="numeric" min="0" max="2100" placeholder="0">
              </label>
              <label class="qfield">
                <span>出版年份（止）</span>
                <input v-model="form.yearTo" type="number" inputmode="numeric" min="0" max="2100" :placeholder="String(currentYear)">
              </label>
              <label class="qfield">
                <span>上架状态</span>
                <select v-model="form.status">
                  <option value="ON_SHELF">在架</option>
                  <option value="OFF_SHELF">已下架</option>
                  <option value="ALL">全部</option>
                </select>
              </label>
            </div>

            <div class="query-foot">
              <label class="qfield qfield-inline">
                <span>排序</span>
                <select v-model="form.sortBy" @change="submit">
                  <option value="updatedAt">最近更新</option>
                  <option value="title">书名</option>
                  <option value="publishYear">出版年份</option>
                  <option value="bookId">入库顺序</option>
                </select>
              </label>
              <label class="qfield qfield-inline">
                <span>方向</span>
                <select v-model="form.sortOrder" @change="submit">
                  <option value="desc">降序</option>
                  <option value="asc">升序</option>
                </select>
              </label>
              <div class="query-actions">
                <button class="btn btn-ghost btn-sm" type="button" id="allResetFilters" @click="reset">清空筛选</button>
                <button class="btn btn-primary" type="submit" id="allSearchSubmit" :disabled="loading">
                  {{ loading ? '查询中…' : '查询' }}
                </button>
              </div>
            </div>
          </form>

          <div class="page-meta">
            <span class="pill" id="allBookTotal">共 {{ result.total }} 种图书</span>
            <span class="pill pill-soft" v-if="conditionCount > 0" id="allConditionCount">已应用 {{ conditionCount }} 个条件</span>
            <span class="pill pill-soft" v-if="totalPages > 1">第 {{ page }} / {{ totalPages }} 页</span>
          </div>
        </div>
      </section>

      <section class="section page-section">
        <div class="container">
          <div class="section-head">
            <div>
              <p class="eyebrow">COLLECTION</p>
              <h2>馆藏图书</h2>
              <p class="section-sub">
                按书名、作者、分类与出版年组合筛选，条件之间是「且」的关系；只填一项就是单条件查询。
              </p>
            </div>
            <div class="filters" id="allFilters" role="group" aria-label="按分类筛选全部图书">
              <button v-for="item in categories" :key="item" type="button" class="chip"
                      :class="{ 'is-active': item === activeCategory }"
                      :data-category="item" @click="setCategory(item)">{{ item }}</button>
            </div>
          </div>

          <div class="filters pdf-filters" id="pdfFilters" role="group" aria-label="按是否带 PDF 原文件筛选">
            <button type="button" class="chip" :class="{ 'is-active': form.hasPdf === '' }" @click="setPdfFilter('')">全部</button>
            <button type="button" class="chip" :class="{ 'is-active': form.hasPdf === 'true' }" @click="setPdfFilter('true')">有 PDF</button>
            <button type="button" class="chip" :class="{ 'is-active': form.hasPdf === 'false' }" @click="setPdfFilter('false')">无 PDF</button>
            <span class="hint-inline">「有 PDF」= 已上传电子书或本地有原文件；「无 PDF」= 两者都没有</span>
          </div>

          <p v-if="error" class="query-error" id="bookQueryError">查询失败：{{ error }}</p>

          <div class="book-grid" id="allBookGrid" :class="{ 'is-loading': loading }">
            <BookCard v-for="(book, i) in result.items" :key="book.id" :book="book" :index="i"></BookCard>
          </div>

          <div v-if="!loading && !result.items.length" class="empty-state" id="allBookEmpty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>
            </svg>
            <h3>没有找到匹配的图书</h3>
            <p>试试放宽条件，或清空筛选重新查询。</p>
            <button class="btn btn-ghost" type="button" id="allEmptyReset" @click="reset">清空筛选</button>
          </div>

          <nav class="pager" v-if="totalPages > 1" aria-label="分页">
            <button type="button" class="pager-btn" :disabled="page <= 1 || loading" @click="goPage(page - 1)">上一页</button>
            <template v-for="(p, i) in pageList" :key="'p' + i">
              <span v-if="p === '…'" class="pager-gap">…</span>
              <button v-else type="button" class="pager-num" :class="{ 'is-active': p === page }"
                      :disabled="loading" @click="goPage(p)">{{ p }}</button>
            </template>
            <button type="button" class="pager-btn" :disabled="page >= totalPages || loading" @click="goPage(page + 1)">下一页</button>
            <span class="pager-info">共 {{ result.total }} 种 · 每页 {{ result.size }} 种</span>
          </nav>
        </div>
      </section>
    </main>
  `
};
