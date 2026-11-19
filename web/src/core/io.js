export function toast(message, tone) {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast" + (tone ? " " + tone : "");
  const dot = document.createElement("span");
  dot.className = "dot";
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(dot);
  el.appendChild(text);
  wrap.appendChild(el);
  window.setTimeout(function () {
    el.classList.add("leaving");
    window.setTimeout(function () { el.remove(); }, 260);
  }, 3600);
}

export function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}

export function readTextFile(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || "")); };
    reader.onerror = function () { reject(reader.error || new Error("读取失败")); };
    reader.readAsText(file, "utf-8");
  });
}

export function readDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || "")); };
    reader.onerror = function () { reject(reader.error || new Error("读取失败")); };
    reader.readAsDataURL(file);
  });
}
