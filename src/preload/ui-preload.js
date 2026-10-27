// ui-preload.js — jembatan untuk halaman UI (dashboard, Manajer Proxy). Menyediakan objek `chrome` yang dipakai
// options.js / proxy.js sehingga kode UI hampir tidak berubah: storage -> file lokal, sendMessage -> proses utama.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

const changeListeners = [];
const msgListeners = [];
ipcRenderer.on("store:changed", function (e, changes) { changeListeners.forEach(function (fn) { try { fn(changes, "local"); } catch (err) {} }); });
ipcRenderer.on("ui:message", function (e, msg) { msgListeners.forEach(function (fn) { try { fn(msg); } catch (err) {} }); });

function maybeCb(promise, cb) { if (typeof cb === "function") { promise.then(cb); return undefined; } return promise; }
const manifest = ipcRenderer.sendSync("app:manifest");

contextBridge.exposeInMainWorld("__dhubChrome", {
  runtime: {
    id: "dhub-desktop",
    sendMessage: function (msg, cb) { return maybeCb(ipcRenderer.invoke("ui:rpc", msg), cb); },
    getManifest: function () { return manifest; },
    getURL: function (p) { return String(p || ""); },
    onMessage: { addListener: function (fn) { msgListeners.push(fn); } }
  },
  storage: {
    local: {
      get: function (keys, cb) { return maybeCb(ipcRenderer.invoke("store:get", keys === undefined ? null : keys), cb); },
      set: function (obj, cb) { return maybeCb(ipcRenderer.invoke("store:set", obj), cb); },
      remove: function (keys, cb) { return maybeCb(ipcRenderer.invoke("store:remove", keys), cb); }
    },
    onChanged: { addListener: function (fn) { changeListeners.push(fn); } }
  },
  tabs: {
    create: function (o) { return ipcRenderer.invoke("ui:open", o && o.url); },
    query: function () { return Promise.resolve([]); }
  },
  system: { display: { getInfo: function () { return ipcRenderer.invoke("ui:displays"); } } }
});
// window.chrome bawaan Chromium sudah ada (objek kosong) sehingga contextBridge tidak bisa menimpanya; pasang manual di dunia utama.
webFrame.executeJavaScript("window.chrome = window.__dhubChrome; try { delete window.__dhubChrome; } catch (e) {}");
