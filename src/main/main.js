// main.js — proses utama DHub Desktop: jendela dashboard, IPC, tray, jadwal, update.
const { app, BrowserWindow, ipcMain, Menu, Tray, shell, screen, nativeImage, powerMonitor } = require("electron");
const path = require("path");

// folder data bisa dipindah (dipakai untuk uji otomatis / mode portabel)
if (process.env.DHUB_DATA_DIR) app.setPath("userData", process.env.DHUB_DATA_DIR);
// jendela akun yang tertutup / tidak di depan tidak boleh "tertidur" (Instagram berhenti memuat komentar di halaman tersembunyi)
// UA bawaan Electron memuat "Electron/x" dan nama aplikasi: buang supaya tampil seperti Chrome biasa (berlaku untuk semua profil akun)
try { app.userAgentFallback = app.userAgentFallback.replace(/\s(?:Electron|dhub-desktop|DHub)\/\S+/gi, ""); } catch (e) {}
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

if (!process.env.DHUB_ALLOW_MULTI && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const { Store } = require("./store");
const License = require("./license");
const Profiles = require("./profiles");
const W = require("./windows");
const Runner = require("./runner");
const Accounts = require("./accounts");
const Scheduler = require("./scheduler");
const Updater = require("./updater");

const ROOT = path.join(__dirname, "..");
const UI_DIR = path.join(ROOT, "ui");
const UI_PRELOAD = path.join(ROOT, "preload", "ui-preload.js");
const PAGE_PRELOAD = path.join(ROOT, "preload", "page-preload.js");
const ICON = path.join(UI_DIR, "icons", "icon-128.png");

let store, lic, prof, runner, accounts, scheduler, updater;
let mainWin = null, proxyWin = null, tray = null, quitting = false;
const uiWindows = new Set();

// ---------- jendela UI ----------
function makeUiWindow(file, opts) {
  const win = new BrowserWindow(Object.assign({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: "#f4f4ef", autoHideMenuBar: true, icon: ICON, show: false,
    webPreferences: { preload: UI_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  }, opts || {}));
  uiWindows.add(win);
  win.on("closed", () => uiWindows.delete(win));
  win.once("ready-to-show", () => win.show());
  // tautan keluar -> browser bawaan; UI tidak boleh berpindah ke situs lain
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.loadFile(path.join(UI_DIR, file));
  return win;
}
function showMain() {
  if (mainWin && !mainWin.isDestroyed()) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); return; }
  mainWin = makeUiWindow("options.html");
  mainWin.on("close", (e) => {
    // task berjalan / ada jadwal: jangan keluar, sembunyikan ke tray supaya terus jalan
    if (!quitting && (runner.isRunning() || scheduler.hasPending())) { e.preventDefault(); mainWin.hide(); ensureTray(); }
  });
  mainWin.on("closed", () => { mainWin = null; });
}
function showProxy() {
  if (proxyWin && !proxyWin.isDestroyed()) { proxyWin.show(); proxyWin.focus(); return; }
  proxyWin = makeUiWindow("proxy.html", { width: 1100, height: 900, minWidth: 720 });
  proxyWin.on("closed", () => { proxyWin = null; });
}
function broadcastUi(msg) { uiWindows.forEach((w) => { try { if (!w.isDestroyed()) w.webContents.send("ui:message", msg); } catch (e) {} }); }
const toast = (text) => broadcastUi({ action: "TOAST", text });

function ensureTray() {
  if (tray) return;
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 18, height: 18 }));
    tray.setToolTip("DHub — berjalan di latar belakang");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Buka DHub", click: showMain },
      { label: "Manajer Proxy", click: showProxy },
      { type: "separator" },
      { label: "Keluar", click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on("click", showMain);
  } catch (e) {}
}

// ---------- IPC ----------
function setupIpc() {
  ipcMain.on("app:manifest", (e) => { e.returnValue = { version: app.getVersion(), name: "DHub" }; });
  ipcMain.handle("store:get", (e, keys) => store.get(keys));
  ipcMain.handle("store:set", (e, obj) => { store.set(obj || {}); return true; });
  ipcMain.handle("store:remove", (e, keys) => { store.remove(keys); return true; });
  store.on("changed", (changes) => uiWindows.forEach((w) => { try { if (!w.isDestroyed()) w.webContents.send("store:changed", changes); } catch (e) {} }));

  ipcMain.handle("ui:displays", () => screen.getAllDisplays().map((d) => ({ isPrimary: d.id === screen.getPrimaryDisplay().id, workArea: { left: d.workArea.x, top: d.workArea.y, width: d.workArea.width, height: d.workArea.height } })));
  ipcMain.handle("ui:open", (e, url) => {
    url = String(url || "");
    if (/proxy\.html$/.test(url)) { showProxy(); return true; }
    if (/^https?:/i.test(url)) { shell.openExternal(url); return true; }
    return false;
  });

  ipcMain.handle("ui:rpc", async (e, msg) => {
    if (!msg || !msg.action) return { ok: false, error: "no action" };
    const a = String(msg.action);
    try {
      if (a.indexOf("PROXY_") === 0 || a.indexOf("IDENTITY_") === 0) return await prof.handle(msg);
      switch (a) {
        case "ACTIVATE_LICENSE": return await lic.activateLicense(msg.key);
        case "CHECK_LICENSE": return await lic.verifyLicenseOnce();
        case "RUN_TASK": return await runner.runTask(msg.taskId, !!msg.test, msg.mode === "failed" ? "failed" : "full");
        case "STOP_JOB": await runner.stopJobNow(); return { ok: true };
        case "SEND_REPORT": return await runner.sendManualReport();
        case "CLEAR_LOG": store.set({ job_log: [] }); return { ok: true };
        case "ADD_ACCOUNT": return await accounts.addAccount(msg);
        case "OPEN_ACCOUNT": return await accounts.openAccount(msg);
        case "EXPORT_ACCOUNTS": return await accounts.exportAccounts(msg);
        case "APP_INFO": return { ok: true, version: app.getVersion(), dataDir: app.getPath("userData"), platform: process.platform, packaged: app.isPackaged, update: updater.getState() };
        case "OPEN_DATA_DIR": shell.openPath(app.getPath("userData")); return { ok: true };
        case "CHECK_UPDATE": return { ok: true, update: updater.check() };
        case "INSTALL_UPDATE": return { ok: updater.install() };
      }
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
    return { ok: false, error: "Aksi tidak dikenal: " + a };
  });

  // pesan dari content script di jendela akun (pengganti chrome.runtime.sendMessage -> background)
  ipcMain.handle("page:rpc", async (e, msg) => {
    if (!msg || !msg.action) return { ok: false, error: "no action" };
    const h = W.handleOf(e.sender);
    try {
      switch (msg.action) {
        case "GET_CONFIG": return await lic.getConfig();
        case "LOG": runner.appendLog(runner.stamp() + msg.message); return { ok: true };
        case "FOCUS_TAB": if (h) { try { if (h.win.isMinimized()) h.win.restore(); h.win.focus(); } catch (x) {} } return { ok: true };
        case "TRUSTED_ENTER": if (!h) return { ok: false, error: "no tab" }; await W.trustedEnter(h, !!msg.ctrl); return { ok: true };
        case "TRUSTED_CLICK": if (!h) return { ok: false, error: "no tab" }; await W.trustedClick(h, Number(msg.x), Number(msg.y)); return { ok: true };
        case "TRUSTED_INSERT": if (!h) return { ok: false, error: "no tab" }; await W.trustedInsert(h, msg.text || "", !!msg.clear); return { ok: true };
      }
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
    return { ok: false, error: "unknown action" };
  });
}

// ---------- menu ----------
function setupMenu() {
  const isMac = process.platform === "darwin";
  const tpl = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "DHub", submenu: [
      { label: "Dashboard", click: showMain },
      { label: "Manajer Proxy & Log Ganti Akun", accelerator: "Alt+Shift+P", click: showProxy },
      { type: "separator" }, isMac ? { role: "close" } : { role: "quit", label: "Keluar" }
    ] },
    { role: "editMenu" },
    { label: "Tampilan", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath("userData"), "dhub-data.json"));
  lic = License.create(store, app.getVersion());
  prof = Profiles.create(store);
  app.on("login", prof.onAppLogin);
  runner = Runner.create({ S: store, lic, prof, W, preloadPath: PAGE_PRELOAD, appVersion: app.getVersion(), downloadsDir: app.getPath("downloads") });
  accounts = Accounts.create({ S: store, prof, preloadPath: PAGE_PRELOAD, notify: toast });
  scheduler = Scheduler.create(store, runner, (m) => runner.appendLog(runner.stamp() + m));
  updater = Updater.create(broadcastUi);

  // akun dihapus dari daftar -> hapus juga data profilnya (cookie, storage) supaya tidak menumpuk
  store.on("changed", (ch) => {
    if (!ch.saved_accounts || !Array.isArray(ch.saved_accounts.oldValue)) return;
    const now = new Set((ch.saved_accounts.newValue || []).map((a) => a.pid).filter(Boolean));
    ch.saved_accounts.oldValue.forEach((a) => {
      if (a.pid && !now.has(a.pid)) { try { require("electron").session.fromPartition("persist:dh_" + a.pid).clearStorageData(); } catch (e) {} }
    });
  });
  runner.resetStaleState(); // sisa status "berjalan" dari penutupan paksa sebelumnya
  setupIpc(); setupMenu(); showMain();
  scheduler.reschedule(); updater.init();
  powerMonitor.on("resume", () => scheduler.reschedule());
  app.on("activate", showMain);
  app.on("second-instance", showMain);
}).catch((e) => { console.error(e); app.exit(1); });

app.on("before-quit", () => { quitting = true; try { store && store.flush(); } catch (e) {} });
app.on("window-all-closed", () => { if (process.platform !== "darwin" && !tray) app.quit(); });
