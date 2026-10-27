// smoke.js — uji integrasi di dalam Electron (jalankan: npm run smoke). Memakai server HTTPS lokal yang disamarkan sebagai instagram.com.
const { app, BrowserWindow, session } = require("electron");
const path = require("path"), fs = require("fs"), https = require("https"), os = require("os");
const PORT = 18443;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "dhub-smoke-"));
process.env.DHUB_DATA_DIR = DATA; process.env.DHUB_ALLOW_MULTI = "1";
app.commandLine.appendSwitch("host-resolver-rules", "MAP www.instagram.com 127.0.0.1");
app.commandLine.appendSwitch("ignore-certificate-errors");
app.commandLine.appendSwitch("no-sandbox"); app.commandLine.appendSwitch("no-proxy-server");
const results = []; const step = (s) => console.log("... " + s); const ok = (n, c, extra) => { results.push([n, !!c]); console.log((c ? "PASS " : "FAIL ") + n + (extra ? " -> " + extra : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = https.createServer({ key: fs.readFileSync(process.env.SMOKE_KEY), cert: fs.readFileSync(process.env.SMOKE_CERT) }, (q, s) => {
  s.setHeader("content-type", "text/html");
  s.end("<html><body><a href='/tester/' role='link'><img alt=\"tester's profile picture\" src='data:image/gif;base64,R0lGODlhAQABAAAAACw='></a><nav>ok</nav></body></html>");
}).listen(PORT);
require(path.join(__dirname, "..", "src", "main", "main.js"));
app.whenReady().then(async () => {
  try {
    await sleep(3500);
    const wins = BrowserWindow.getAllWindows();
    const ui = wins.find((w) => /options\.html/.test(w.webContents.getURL()));
    ok("jendela dashboard terbuka", !!ui);
    if (ui) {
      const info = await ui.webContents.executeJavaScript("(async()=>{const r=await chrome.runtime.sendMessage({action:'APP_INFO'});const s=await chrome.storage.local.get(['tasks']);return {r,body:document.body.innerText.length,hasChrome:typeof chrome.storage.local.set}})()");
      ok("UI -> IPC rpc (APP_INFO)", info.r && info.r.ok && info.r.version, JSON.stringify(info.r && info.r.version));
      ok("UI ter-render", info.body > 100, "len=" + info.body);
      await ui.webContents.executeJavaScript("chrome.storage.local.set({smoke_key:{a:1}})");
      const back = await ui.webContents.executeJavaScript("chrome.storage.local.get('smoke_key')");
      ok("storage set/get", back.smoke_key && back.smoke_key.a === 1);
    }
    // jendela akun dengan content script
    step("buka jendela akun"); const W = require(path.join(__dirname, "..", "src", "main", "windows.js"));
    const ses = session.fromPartition("persist:dh_smoketest");
    const h = await W.openHandle({ ses, acc: { label: "t", platform: "instagram" }, bounds: { x: 0, y: 0, width: 800, height: 600 }, preloadPath: path.join(__dirname, "..", "src", "preload", "page-preload.js"), url: "https://www.instagram.com:" + PORT + "/" });
    step("menunggu halaman"); await sleep(2500);
    ok("jendela akun memuat halaman", /instagram/.test(h.wc.getURL()), h.wc.getURL());
    const pong = await W.sendToContent(h, { action: "PING" }, 5, 500);
    ok("content script terpasang (PING)", pong && pong.ok && pong.platform === "instagram", JSON.stringify(pong));
    const u = await W.sendToContent(h, { action: "GET_USERNAME" }, 3, 500);
    ok("GET_USERNAME dijawab", u && typeof u === "object", JSON.stringify(u));
    const det = await W.execInPage(h, require(path.join(__dirname, "..", "src", "main", "accounts.js")).create({ S: {}, prof: { PLATFORMS: {} }, preloadPath: "", notify() {} }).pageDetect, ["instagram"]);
    ok("deteksi username lewat execInPage", det === "tester", String(det));
    const shot = await W.screenshotPng(h).catch((e) => null);
    ok("screenshot CDP (PNG)", shot && shot.length > 500, shot && shot.length);
    const ua = h.wc.getUserAgent();
    ok("UA bersih (tanpa Electron/nama aplikasi)", !/Electron|dhub|DHub/i.test(ua) && /Chrome\//.test(ua), ua.slice(0, 90));
    const pw = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, "..", "src", "preload", "ui-preload.js"), sandbox: true, contextIsolation: true, session: session.defaultSession } });
    await pw.loadFile(path.join(__dirname, "..", "src", "ui", "proxy.html")); await sleep(1500);
    const pr = await pw.webContents.executeJavaScript("JSON.stringify({bulk:!!document.getElementById('bulkProxy'),mode:!!document.getElementById('identityMode'),txt:document.body.innerText.length})");
    ok("Manajer Proxy memuat (bagian massal & mode identitas)", /"bulk":true,"mode":true/.test(pr), pr);
    W.closeAll();
  } catch (e) { ok("tidak ada exception: " + e.message, false); console.error(e.stack); }
  const fail = results.filter((r) => !r[1]).length;
  console.log("RINGKAS: " + (results.length - fail) + "/" + results.length + " lulus");
  srv.close(); app.exit(fail ? 1 : 0);
});
setTimeout(() => { console.log("TIMEOUT"); app.exit(2); }, 60000);
