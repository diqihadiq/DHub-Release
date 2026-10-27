// windows.js — jendela akun (satu BrowserWindow = satu "tab" lama), pesan ke content script, input tepercaya via CDP.
// CDP (webContents.debugger) di Electron tidak menampilkan bar "sedang di-debug" seperti di Chrome.
const { BrowserWindow, screen, ipcMain } = require("electron");
const path = require("path");

const MIN_WIN_W = 700, MIN_WIN_H = 500;
const handles = new Map(); // webContents.id -> handle
let seq = 0;
const pending = new Map(); // id pesan -> { resolve, reject, wcId }

ipcMain.on("page:resp", (e, id, resp) => {
  const p = pending.get(id);
  if (p) { pending.delete(id); p.resolve(resp); }
});
function rejectPending(wcId, why) {
  for (const [id, p] of pending) if (p.wcId === wcId) { pending.delete(id); p.reject(new Error(why)); }
}

function handleOf(wc) { return handles.get(wc.id) || null; }

// ---------- layar ----------
function getWorkArea() {
  try { const d = screen.getPrimaryDisplay(); return { left: d.workArea.x, top: d.workArea.y, width: d.workArea.width, height: d.workArea.height }; }
  catch (e) { return { left: 0, top: 0, width: 1280, height: 720 }; }
}
// sel (cell) = jatah area untuk satu akun yang berjalan; di dalamnya n jendela berjajar
function cellBounds(slot, slots, area) {
  const cols = slots <= 1 ? 1 : (slots <= 4 ? 2 : 3), rows = Math.ceil(slots / cols);
  const w = Math.floor(area.width / cols), h = Math.floor(area.height / rows);
  return { x: area.left + (slot % cols) * w, y: area.top + Math.floor(slot / cols) * h, width: w, height: h };
}
function tileBounds(cell, i, n) {
  const cols = n <= 1 ? 1 : (n <= 3 ? n : (n === 4 ? 2 : 3)), rows = Math.ceil(n / cols);
  const w = Math.max(MIN_WIN_W, Math.floor(cell.width / cols)), h = Math.max(MIN_WIN_H, Math.floor(cell.height / rows));
  // kalau jatah terlalu kecil, jendela dibuat menumpuk dengan geseran (tetap terlihat; setFocusEmulation mencegah halaman dianggap tersembunyi)
  const x = cell.x + (i % cols) * Math.min(w, Math.floor(cell.width / cols)) + (cell.width < MIN_WIN_W * cols ? i * 36 : 0);
  const y = cell.y + Math.floor(i / cols) * Math.min(h, Math.floor(cell.height / rows)) + (cell.height < MIN_WIN_H * rows ? i * 36 : 0);
  return { x, y, width: w, height: h };
}

// ---------- membuat jendela akun ----------
// o: { ses, acc, bounds, preloadPath, identity, url }
async function openHandle(o) {
  const win = new BrowserWindow({
    show: false, width: (o.bounds && o.bounds.width) || 1100, height: (o.bounds && o.bounds.height) || 820,
    x: o.bounds && o.bounds.x, y: o.bounds && o.bounds.y, minWidth: 480, minHeight: 360,
    title: "DHub · " + (o.acc ? o.acc.label : ""), autoHideMenuBar: true, backgroundColor: "#ffffff",
    webPreferences: { session: o.ses, preload: o.preloadPath, contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, webviewTag: false }
  });
  const wc = win.webContents;
  const h = { id: ++seq, win, wc, ses: o.ses, acc: o.acc, identity: o.identity || null, dbg: false, closed: false };
  handles.set(wc.id, h);
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("did-start-navigation", (e, url, isInPlace, isMain) => { if (isMain && !isInPlace) rejectPending(wc.id, "halaman berpindah"); });
  wc.on("render-process-gone", () => rejectPending(wc.id, "halaman crash"));
  win.on("closed", () => { h.closed = true; handles.delete(wc.id); rejectPending(wc.id, "jendela ditutup"); });
  wc.debugger.on("detach", () => { h.dbg = false; });
  if (o.identity) wc.setUserAgent(o.identity.userAgent);
  win.showInactive();
  // perintah CDP pertama bisa menunggu renderer yang belum memuat apa pun: jangan menahan pembukaan jendela lebih dari 2 dtk
  // (perintah tetap berjalan di latar dan identitas/zona waktu terpasang sebelum halaman akun selesai dimuat)
  await Promise.race([cdpAttach(h).catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
  if (o.url) { try { await gotoUrl(h, o.url, { fast: false }); } catch (e) {} }
  return h;
}

// ---------- CDP ----------
async function cdpAttach(h) {
  if (h.closed) throw new Error("jendela ditutup");
  if (!h.dbg) { try { h.wc.debugger.attach("1.3"); } catch (e) { if (!/already attached/i.test(e.message)) throw e; } h.dbg = true; }
  await cdp(h, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {}); // halaman dianggap fokus walau jendela tidak di depan
  await applyIdentity(h);
}
function cdp(h, method, params) {
  if (h.closed) return Promise.reject(new Error("jendela ditutup"));
  return h.wc.debugger.sendCommand(method, params || {});
}
async function applyIdentity(h) {
  const ident = h.identity;
  if (!ident) return;
  const p = { userAgent: ident.userAgent, platform: ident.navPlatform };
  if (ident.metadata) p.userAgentMetadata = ident.metadata;
  try { await cdp(h, "Emulation.setUserAgentOverride", p); } catch (e) {}
  if (ident.timezone) { try { await cdp(h, "Emulation.setTimezoneOverride", { timezoneId: ident.timezone }); } catch (e) {} }
}
async function withCdp(h, fn) {
  if (!h.dbg) await cdpAttach(h);
  try { return await fn(); }
  catch (e) { if (/not attached|detached|No target|Cannot access/i.test(String(e && e.message))) { h.dbg = false; await cdpAttach(h); return fn(); } throw e; }
}
function trustedEnter(h, ctrl) {
  return withCdp(h, async () => {
    const m = ctrl ? 2 : 0;
    await cdp(h, "Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", modifiers: m, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" });
    await cdp(h, "Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", modifiers: m, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  });
}
function trustedInsert(h, text, clear) {
  return withCdp(h, async () => {
    if (clear) {
      await cdp(h, "Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, commands: ["selectAll"] });
      await cdp(h, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
      await cdp(h, "Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await cdp(h, "Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    }
    await cdp(h, "Input.insertText", { text });
  });
}
function trustedClick(h, x, y) {
  return withCdp(h, async () => {
    await cdp(h, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp(h, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await cdp(h, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  });
}
async function screenshotPng(h) {
  const r = await withCdp(h, () => cdp(h, "Page.captureScreenshot", { format: "png" }));
  if (r && r.data) return Buffer.from(r.data, "base64");
  const img = await h.wc.capturePage();
  return img.toPNG();
}

// ---------- navigasi & pesan ----------
// stopWaiters: dipakai runner supaya Stop membangunkan penantian
function gotoUrl(h, url, o) {
  o = o || {};
  const timeout = o.timeout || 15000;
  return new Promise((resolve) => {
    if (h.closed) return resolve();
    const wc = h.wc;
    let done = false, timer = null;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(timer);
      wc.removeListener("did-finish-load", onDone); wc.removeListener("did-fail-load", onFail);
      if (o.waiters) o.waiters.delete(finish);
      setTimeout(resolve, o.fast ? 50 : 100);
    };
    const onDone = () => finish();
    const onFail = (e, code, desc, u, isMain) => { if (isMain && code !== -3) finish(); }; // -3 = ERR_ABORTED (navigasi diganti)
    timer = setTimeout(finish, timeout);
    wc.on("did-finish-load", onDone); wc.on("did-fail-load", onFail);
    if (o.waiters) { o.waiters.add(finish); if (o.stopped && o.stopped()) return finish(); }
    wc.loadURL(url).catch(() => {}); // kegagalan muat dilaporkan lewat did-fail-load; yang lain ditangani timeout
  });
}
function sendToContent(h, msg, retries, intervalMs, stopped) {
  retries = retries == null ? 6 : retries; intervalMs = intervalMs || 1000;
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      if (stopped && stopped()) return reject(new Error("dihentikan"));
      if (h.closed) return reject(new Error("jendela ditutup"));
      const id = ++seq;
      pending.set(id, {
        wcId: h.wc.id,
        resolve: (resp) => {
          if (resp && resp.__none) { if (n <= 0) return reject(new Error("content script belum aktif di halaman ini")); return setTimeout(() => attempt(n - 1), intervalMs); }
          resolve(resp);
        },
        reject: (err) => { if (n <= 0) return reject(err); setTimeout(() => attempt(n - 1), intervalMs); }
      });
      try { h.wc.send("dh:msg", id, msg); } catch (e) { pending.delete(id); if (n <= 0) return reject(e); setTimeout(() => attempt(n - 1), intervalMs); }
    };
    attempt(retries);
  });
}
function closeHandle(h) {
  if (!h || h.closed) return;
  try { if (h.dbg) h.wc.debugger.detach(); } catch (e) {}
  try { h.win.destroy(); } catch (e) {}
}
function closeAll() { for (const h of Array.from(handles.values())) closeHandle(h); }
function execInPage(h, fn, args) {
  return h.wc.executeJavaScript("(" + fn.toString() + ").apply(null, " + JSON.stringify(args || []) + ")", true);
}

module.exports = { openHandle, cdp, cdpAttach, trustedEnter, trustedInsert, trustedClick, screenshotPng, gotoUrl, sendToContent, closeHandle, closeAll, handleOf, execInPage, getWorkArea, cellBounds, tileBounds, MIN_WIN_W, MIN_WIN_H, handles };
