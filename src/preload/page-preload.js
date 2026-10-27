// page-preload.js — jalan di jendela akun (Instagram/TikTok/X/Threads).
// Meniru bagian chrome.runtime yang dipakai content script, lalu memuat content script yang SAMA dengan ekstensi.
// Semua berjalan di "isolated world": halaman tidak melihat objek chrome ini.
const { ipcRenderer } = require("electron");
const path = require("path");

const listeners = [];
globalThis.chrome = {
  runtime: {
    id: "dhub-desktop",
    lastError: undefined,
    sendMessage: function (msg, cb) {
      ipcRenderer.invoke("page:rpc", msg).then(function (r) { if (typeof cb === "function") cb(r); }, function () { if (typeof cb === "function") cb(undefined); });
    },
    onMessage: { addListener: function (fn) { listeners.push(fn); } }
  }
};

ipcRenderer.on("dh:msg", function (e, id, msg) {
  let responded = false;
  const respond = function (r) { if (responded) return; responded = true; ipcRenderer.send("page:resp", id, r === undefined ? {} : r); };
  let keep = false;
  for (const fn of listeners) {
    try { if (fn(msg, { tab: { id: 0 } }, respond) === true) keep = true; } catch (err) { respond({ ok: false, error: String((err && err.message) || err) }); }
  }
  if (!keep && !responded) respond({ __none: true });
});

const HOSTS = [
  [/(^|\.)instagram\.com$/, ["common.js", "content.js"]],
  [/(^|\.)tiktok\.com$/, ["common.js", "content_tiktok.js"]],
  [/(^|\.)(x|twitter)\.com$/, ["common.js", "content_x.js"]],
  [/(^|\.)threads\.(com|net)$/, ["common.js", "content_threads.js"]]
];
function inject() {
  if (location.protocol !== "https:") return;
  const hit = HOSTS.find(function (h) { return h[0].test(location.hostname); });
  if (!hit) return;
  for (const f of hit[1]) {
    try { require(path.join(__dirname, "..", "content", f)); }
    catch (e) { console.error("[DHub] gagal memuat " + f + ": " + e.message); }
  }
}
ipcRenderer.on("dh:inject", inject);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true }); else inject();
