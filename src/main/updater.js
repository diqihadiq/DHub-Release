// updater.js — update otomatis lewat electron-updater (hanya di aplikasi terpasang, bukan saat `npm start`).
// Sumber rilis dibaca dari konfigurasi "publish" di package.json (GitHub Releases).
const { app } = require("electron");

function create(broadcast) {
  let au = null, state = { status: "idle", version: app.getVersion() };
  const push = (patch) => { state = Object.assign({}, state, patch); broadcast({ action: "UPDATE_STATUS", state }); };
  function init() {
    if (!app.isPackaged) { state = { status: "dev", version: app.getVersion() }; return; }
    try { au = require("electron-updater").autoUpdater; } catch (e) { push({ status: "error", error: "electron-updater tidak ada" }); return; }
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    au.on("checking-for-update", () => push({ status: "checking" }));
    au.on("update-available", (i) => push({ status: "downloading", latest: i && i.version, percent: 0 }));
    au.on("update-not-available", () => push({ status: "latest", checkedAt: Date.now() }));
    au.on("download-progress", (p) => push({ status: "downloading", percent: Math.round(p.percent || 0) }));
    au.on("update-downloaded", (i) => push({ status: "ready", latest: i && i.version }));
    au.on("error", (e) => push({ status: "error", error: String((e && e.message) || e).slice(0, 200) }));
    setTimeout(check, 15000);
    setInterval(check, 6 * 3600 * 1000);
  }
  function check() {
    if (!au) return state;
    try { au.checkForUpdates().catch((e) => push({ status: "error", error: String((e && e.message) || e).slice(0, 200) })); } catch (e) {}
    return state;
  }
  function install() { if (au && state.status === "ready") { setImmediate(() => au.quitAndInstall(false, true)); return true; } return false; }
  return { init, check, install, getState: () => state };
}
module.exports = { create };
