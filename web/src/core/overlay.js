const locks = new Set();

function sync() {
  document.body.style.overflow = locks.size ? "hidden" : "";
}

export function lockScroll(key) {
  locks.add(key);
  sync();
}

export function unlockScroll(key) {
  locks.delete(key);
  sync();
}

export function isScrollLocked(key) {
  return locks.has(key);
}
