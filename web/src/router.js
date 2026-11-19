import { reactive } from "../vendor/vue.esm-browser.prod.js";

export const route = reactive({
  name: "home",
  tab: "borrows",
  section: "home",
  hash: "#home"
});

export const navState = reactive({
  section: "home",
  epoch: 0
});

const HOME_SECTIONS = ["home", "new-arrivals", "popular", "my-loans", "announcements"];

export function parseHash(raw) {
  let hash = raw || (window.location.hash || "#home");
  if (hash === "#" || hash === "") hash = "#home";
  if (hash === "#my-borrows") {
    hash = "#shelf/borrows";
    window.history.replaceState(null, "", hash);
  } else if (hash === "#feedback") {
    hash = "#shelf/reviews";
    window.history.replaceState(null, "", hash);
  }
  if (hash.indexOf("#console") === 0) {
    const parts = hash.split("/");
    return { name: "console", tab: parts[1] || "overview", section: "", hash: hash };
  }
  if (hash.indexOf("#notices") === 0) {
    return { name: "notices", tab: "", section: "", hash: hash };
  }
  if (hash.indexOf("#library") === 0) {
    return { name: "library", tab: "", section: "", hash: hash };
  }
  if (hash.indexOf("#shelf") === 0) {
    const parts = hash.split("/");
    return { name: "shelf", tab: parts[1] === "reviews" ? "reviews" : "borrows", section: "", hash: hash };
  }
  let section = hash.replace("#", "");
  if (HOME_SECTIONS.indexOf(section) === -1) section = "home";
  return { name: "home", tab: "", section: section, hash: hash };
}

export function syncRoute() {
  const next = parseHash();
  route.name = next.name;
  route.tab = next.tab;
  route.section = next.section;
  route.hash = next.hash;
  if (next.name === "home") navState.section = next.section;
  navState.epoch += 1;
}

export function startRouter() {
  window.addEventListener("hashchange", syncRoute);
  syncRoute();
}

export function navigate(hash) {
  if (window.location.hash === hash) {
    syncRoute();
    return;
  }
  window.location.hash = hash;
}
