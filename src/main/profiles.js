// profiles.js — profil terpisah per akun (partisi sesi Electron), proxy per akun, dan identitas (User-Agent + zona waktu).
// Pengganti proxy_core.js + identity_core.js: di ekstensi proxy itu global untuk seluruh browser; di sini tiap akun
// punya session sendiri, jadi proxy, cookie, dan identitas benar-benar terpisah dan akun bisa jalan paralel.
const { session, net } = require("electron");
const crypto = require("crypto");

const PLATFORMS = {
  instagram: { name: "Instagram", domains: ["instagram.com"], hosts: /(^|\.)instagram\.com$/, home: "https://www.instagram.com/", login: "https://www.instagram.com/accounts/login/", session: /^sessionid$/, content: ["common.js", "content.js"] },
  tiktok: { name: "TikTok", domains: ["tiktok.com"], hosts: /(^|\.)tiktok\.com$/, home: "https://www.tiktok.com/", login: "https://www.tiktok.com/login", session: /^(sessionid|sessionid_ss|sid_tt)$/, content: ["common.js", "content_tiktok.js"] },
  x: { name: "X", domains: ["x.com", "twitter.com"], hosts: /(^|\.)(x|twitter)\.com$/, home: "https://x.com/home", login: "https://x.com/i/flow/login", session: /^auth_token$/, content: ["common.js", "content_x.js"] },
  threads: { name: "Threads", domains: ["threads.com", "threads.net"], hosts: /(^|\.)threads\.(com|net)$/, home: "https://www.threads.com/", login: "https://www.threads.com/login", session: /^(sessionid|ds_user_id)$/, content: ["common.js", "content_threads.js"] }
};
const platformOfUrl = (u) => { try { const h = new URL(u).hostname; for (const k in PLATFORMS) if (PLATFORMS[k].hosts.test(h)) return k; } catch (e) {} return null; };
const platformOfHost = (h) => { for (const k in PLATFORMS) if (PLATFORMS[k].hosts.test(h)) return k; return null; };

// ---------- profil identitas (isi sama dengan identity_core.js) ----------
const ID_PROFILES = [
  { id: "win10", name: "Windows 10", os: "Windows NT 10.0; Win64; x64", platform: "Windows", pv: "10.0.0", nav: "Win32", arch: "x86" },
  { id: "win11", name: "Windows 11", os: "Windows NT 10.0; Win64; x64", platform: "Windows", pv: "15.0.0", nav: "Win32", arch: "x86" },
  { id: "mac14", name: "macOS 14 (Intel)", os: "Macintosh; Intel Mac OS X 10_15_7", platform: "macOS", pv: "14.6.1", nav: "MacIntel", arch: "x86" },
  { id: "mac15", name: "macOS 15 (Apple)", os: "Macintosh; Intel Mac OS X 10_15_7", platform: "macOS", pv: "15.3.0", nav: "MacIntel", arch: "arm" },
  { id: "linux", name: "Linux", os: "X11; Linux x86_64", platform: "Linux", pv: "6.5.0", nav: "Linux x86_64", arch: "x86" }
];
const ID_TZ_COMMON = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "Asia/Kuala_Lumpur", "Asia/Bangkok", "Asia/Manila", "Asia/Tokyo", "Asia/Kolkata", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];
const idValidTz = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; } };
const idRandomProfile = () => ID_PROFILES[crypto.randomInt(ID_PROFILES.length)].id;
const chromeMajor = () => String(process.versions.chrome || "130").split(".")[0];

function create(store, log) {
  const S = store;
  const credsBySession = new Map(); // Session -> { username, password, host, port }
  const L = log || function () {};

  // ---------- data akun ----------
  const accList = () => S.get(["saved_accounts"]).saved_accounts || [];
  const findAcc = (platform, label) => accList().find((a) => a.label === label && (a.platform || "instagram") === (platform || "instagram"));
  function persistAccountFields(acc, patch) {
    const list = accList();
    const i = list.findIndex((a) => a.label === acc.label && (a.platform || "instagram") === (acc.platform || "instagram"));
    if (i >= 0) { Object.assign(list[i], patch); S.set({ saved_accounts: list }); }
    Object.assign(acc, patch);
  }
  function ensurePid(acc) {
    if (acc.pid) return acc.pid;
    const pid = "p" + crypto.randomBytes(6).toString("hex");
    persistAccountFields(acc, { pid });
    return pid;
  }
  const partitionOf = (acc) => "persist:dh_" + ensurePid(acc);
  const sessionOf = (acc) => session.fromPartition(partitionOf(acc));

  // ---------- proxy ----------
  const uid = () => "px_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  const newSessionId = () => { const abc = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; crypto.randomBytes(10).forEach((b) => { s += abc[b % abc.length]; }); return s; };
  const getSettings = () => Object.assign({ enabled: true, identityEnabled: true, identityMode: "proxy_only", bypassList: ["localhost", "127.0.0.1"] }, S.get(["proxy_settings"]).proxy_settings || {});
  const setSettings = (patch) => { const next = Object.assign(getSettings(), patch || {}); S.set({ proxy_settings: next }); return next; };
  const proxyList = () => S.get(["dhub_proxies"]).dhub_proxies || [];
  const saveProxyList = (l) => S.set({ dhub_proxies: l });
  function buildUsername(p, sessionId) {
    const tpl = String(typeof p === "string" ? p : ((p && (p.usernameTemplate || p.username)) || "")).trim();
    if (!tpl) return "";
    return tpl.indexOf("{session}") >= 0 ? tpl.split("{session}").join(sessionId || "dhub") : tpl;
  }
  const proxyRules = (p) => (p.scheme || "http") + "://" + String(p.host).trim() + ":" + Number(p.port);

  async function setDirect(ses) { await ses.setProxy({ mode: "direct" }); credsBySession.delete(ses); }

  // pasang proxy akun ke sesinya sendiri. Dipanggil SEBELUM jendela akun dibuka / menavigasi.
  async function applyForAccount(acc, platformKey, opts) {
    opts = opts || {};
    const ses = sessionOf(acc), st = getSettings();
    if (!st.enabled) { await setDirect(ses); return { ok: true, applied: null, ses }; }
    const proxy = acc.proxyId ? (proxyList().find((p) => p.id === acc.proxyId) || null) : null;
    if (!proxy) {
      await setDirect(ses);
      if (!opts.quiet) logEntry({ type: "warn", platform: platformKey, account: acc.label, detail: "Akun TANPA proxy: memakai jaringan asli. Tugaskan proxy di Manajer Proxy agar IP-nya konsisten." });
      return { ok: true, applied: null, ses };
    }
    const mode = acc.sessionMode === "rotate" ? "rotate" : "sticky";
    let sessionId = acc.sessionId;
    if (mode === "rotate" || !sessionId) { sessionId = newSessionId(); persistAccountFields(acc, { sessionId }); }
    const username = buildUsername(proxy, sessionId);
    credsBySession.set(ses, { username, password: proxy.password || "", host: proxy.host, port: Number(proxy.port) });
    await ses.setProxy({ mode: "fixed_servers", proxyRules: proxyRules(proxy), proxyBypassRules: (st.bypassList || []).join(";") });
    try { await ses.closeAllConnections(); } catch (e) {}
    const name = proxy.label || (proxy.host + ":" + proxy.port);
    if (!opts.quiet) logEntry({ type: "switch", platform: platformKey, account: acc.label, proxy: name, detail: "Proxy akun aktif: " + name + (username ? " · sesi " + sessionId : "") + (mode === "rotate" ? " (IP baru)" : " (IP sticky)") });
    return { ok: true, applied: proxy.id, sessionId, proxyName: name, ses, proxy };
  }

  // jawab tantangan 407 proxy dengan kredensial milik sesi (akun) yang bersangkutan
  function onAppLogin(event, webContents, authInfo, callback) {
    if (!authInfo || !authInfo.isProxy) return;
    let c = webContents && webContents.session ? credsBySession.get(webContents.session) : null;
    if (!c) { for (const v of credsBySession.values()) if (v.host === authInfo.host && v.port === authInfo.port) { c = v; break; } }
    if (!c) return;
    event.preventDefault();
    callback(c.username, c.password);
  }

  // GET lewat sesi tertentu (dengan proxy-nya) -> JSON
  function getJson(ses, url, timeoutMs, creds) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
      let req;
      try { req = net.request({ url, session: ses, useSessionCookies: false }); } catch (e) { return resolve({ error: e.message }); }
      const t = setTimeout(() => { try { req.abort(); } catch (e) {} fin({ error: "timeout (tidak ada balasan)" }); }, timeoutMs || 8000);
      req.on("login", (info, cb) => { const c = creds || credsBySession.get(ses); if (info.isProxy && c) cb(c.username, c.password); else cb(); });
      req.on("response", (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; });
        res.on("end", () => { try { fin({ data: JSON.parse(buf) }); } catch (e) { fin({ error: "respons bukan JSON (HTTP " + res.statusCode + ")" }); } });
        res.on("error", (e) => fin({ error: e.message }));
      });
      req.on("error", (e) => fin({ error: e.message }));
      req.end();
    });
  }
  async function checkExitIp(ses, timeoutMs, creds) {
    const t0 = Date.now();
    const r = await getJson(ses, "https://api.ipify.org/?format=json", timeoutMs || 8000, creds);
    return r.data && r.data.ip ? { ip: r.data.ip, ms: Date.now() - t0 } : { error: r.error || "tanpa detail" };
  }
  async function testProxy(id) {
    const proxy = proxyList().find((p) => p.id === id);
    if (!proxy) return { ok: false, error: "Proxy tidak ditemukan." };
    const ses = session.fromPartition("dhtest_" + id + "_" + Date.now()); // sesi sementara: tidak menyentuh akun mana pun
    const creds = { username: buildUsername(proxy, newSessionId()), password: proxy.password || "" };
    const t0 = Date.now();
    try {
      await ses.setProxy({ mode: "fixed_servers", proxyRules: proxyRules(proxy) });
      const r = await checkExitIp(ses, 12000, creds);
      if (r.ip) return { ok: true, ip: r.ip, ms: Date.now() - t0 };
      return { ok: false, error: "Tes gagal: " + r.error + (proxy.scheme === "socks5" && (creds.username || creds.password) ? " | catatan: Chromium tidak mendukung login username/password untuk SOCKS5, pakai HTTP/HTTPS atau whitelist IP" : "") };
    } catch (e) { return { ok: false, error: e.message }; }
    finally { try { await ses.clearStorageData(); await ses.closeAllConnections(); } catch (e) {} }
  }

  // ---------- log aktivitas ----------
  const LOG_MAX = 300;
  let onLogEntry = null;
  function logEntry(e) {
    try {
      const arr = S.get(["switch_log"]).switch_log || [];
      arr.unshift(Object.assign({ at: Date.now() }, e));
      if (arr.length > LOG_MAX) arr.length = LOG_MAX;
      S.set({ switch_log: arr });
    } catch (e2) {}
  }

  // ---------- identitas ----------
  const identityEnabled = () => getSettings().identityEnabled !== false;
  // "proxy_only" (default): akun TANPA proxy memakai perangkat & zona waktu asli (cocok dengan IP aslinya); "all": semua akun diacak
  const identityMode = () => (getSettings().identityMode === "all" ? "all" : "proxy_only");
  function identityEnsure(acc) {
    if (acc.identity && acc.identity.profile) return acc.identity;
    const ident = { profile: idRandomProfile(), ua: "", tz: "auto", tzDetected: null, createdAt: Date.now() };
    persistAccountFields(acc, { identity: ident });
    return ident;
  }
  function identityBuild(ident) {
    const p = ID_PROFILES.find((x) => x.id === ident.profile) || ID_PROFILES[0];
    const major = chromeMajor(), full = major + ".0.0.0";
    const custom = String(ident.ua || "").trim();
    const ua = custom || ("Mozilla/5.0 (" + p.os + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + full + " Safari/537.36");
    const brands = [{ brand: "Chromium", version: major }, { brand: "Google Chrome", version: major }, { brand: "Not.A/Brand", version: "99" }];
    return {
      profile: p.id, profileName: custom ? "Kustom" : p.name, userAgent: ua, navPlatform: p.nav,
      metadata: custom ? null : { brands, fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.brand === "Not.A/Brand" ? "99.0.0.0" : full })), fullVersion: full, platform: p.platform, platformVersion: p.pv, architecture: p.arch, model: "", mobile: false, bitness: "64", wow64: false }
    };
  }
  // dua layanan ditanya BERSAMAAN, yang tercepat dan valid dipakai (berurutan bisa 2x timeout)
  async function lookupTz(ses, timeoutMs) {
    const one = async (u) => {
      const r = await getJson(ses, u, timeoutMs || 5000);
      const d = r.data;
      const tz = d && ((d.timezone && d.timezone.id) || (typeof d.timezone === "string" ? d.timezone : null));
      if (tz && idValidTz(tz)) return { tz, country: d.country_code || d.country || "", ip: d.ip || "" };
      throw new Error("zona waktu tidak valid");
    };
    try { return await Promise.any(["https://ipwho.is/", "https://ipapi.co/json/"].map(one)); } catch (e) { return null; }
  }
  // siapkan identitas akun (dipanggil setelah proxy akun terpasang). Hasil null = identitas dimatikan.
  async function identityPrepare(acc, platformKey, proxyApplied, ses) {
    if (!identityEnabled()) return null;
    // tanpa proxy: jangan menyamar. UA/OS/zona waktu tetap bawaan perangkat supaya konsisten dengan IP asli
    if (!proxyApplied && identityMode() !== "all") {
      logEntry({ type: "identity", platform: platformKey, account: acc.label, detail: "Identitas: bawaan perangkat (akun tanpa proxy)" });
      return null;
    }
    const ident = identityEnsure(acc);
    const built = identityBuild(ident);
    let tz = ident.tz && ident.tz !== "auto" && idValidTz(ident.tz) ? ident.tz : null, src = "manual";
    if (!tz) {
      // sticky: IP akun ini tetap sama selama sesinya sama, jadi zona waktu hasil deteksi dipakai ulang (tanpa request lagi)
      const sessKey = (acc.proxyId || "") + ":" + (acc.sessionId || "");
      if (proxyApplied && acc.sessionMode !== "rotate" && ident.tzDetected && ident.tzSessionKey === sessKey && idValidTz(ident.tzDetected)) {
        tz = ident.tzDetected; src = "cache sesi sticky";
      } else if (proxyApplied) {
        const r = await lookupTz(ses, 5000);
        if (r) { tz = r.tz; src = "IP proxy " + (r.country || ""); if (ident.tzDetected !== tz || ident.tzSessionKey !== sessKey) { ident.tzDetected = tz; ident.tzSessionKey = sessKey; persistAccountFields(acc, { identity: ident }); } }
      }
      if (!tz && proxyApplied && ident.tzDetected) { tz = ident.tzDetected; src = "deteksi terakhir"; }
      if (!tz) src = "bawaan komputer";
    }
    built.timezone = tz;
    ses.setUserAgent(built.userAgent); // header HTTP ikut identitas sejak request pertama
    logEntry({ type: "identity", platform: platformKey, account: acc.label, detail: "Identitas: " + built.profileName + " · zona waktu " + (tz || "bawaan komputer") + " (" + src.trim() + ")" });
    return built;
  }
  function identitySet(req) {
    const a = findAcc(req.platform, req.label);
    if (!a) return { ok: false, error: "Akun tidak ditemukan." };
    const cur = Object.assign({ profile: idRandomProfile(), ua: "", tz: "auto", tzDetected: null }, a.identity || {});
    if (req.reroll) { const others = ID_PROFILES.filter((p) => p.id !== cur.profile); cur.profile = others[crypto.randomInt(others.length)].id; cur.ua = ""; }
    if (req.profile && ID_PROFILES.some((p) => p.id === req.profile)) { cur.profile = req.profile; cur.ua = ""; }
    if (req.ua != null) cur.ua = String(req.ua).trim();
    if (req.tz != null) {
      const tz = String(req.tz).trim();
      if (tz && tz !== "auto" && !idValidTz(tz)) return { ok: false, error: "Zona waktu tidak dikenal: " + tz + " (contoh: Asia/Jakarta)" };
      cur.tz = tz || "auto";
    }
    persistAccountFields(a, { identity: cur });
    logEntry({ type: "identity", platform: req.platform, account: req.label, detail: "Identitas diubah: " + identityBuild(cur).profileName + " · zona waktu " + (cur.tz === "auto" ? "otomatis (ikut IP proxy)" : cur.tz) });
    return { ok: true, identity: cur };
  }

  // ---------- cookie sesi ----------
  async function platformCookies(ses, platform) {
    const out = [], seen = {};
    for (const d of PLATFORMS[platform].domains) {
      for (const c of await ses.cookies.get({ domain: d })) { const k = c.name + "|" + c.domain + "|" + c.path; if (!seen[k]) { seen[k] = 1; out.push(c); } }
    }
    return out;
  }
  async function hasSessionCookie(ses, platform) {
    const re = PLATFORMS[platform].session;
    return (await platformCookies(ses, platform)).some((c) => re.test(c.name) && c.value && c.value.length > 5);
  }
  async function wipeCookies(ses, platform) {
    for (let k = 0; k < 3; k++) {
      for (const c of await platformCookies(ses, platform)) {
        try { await ses.cookies.remove("https://" + c.domain.replace(/^\./, "") + (c.path || "/"), c.name); } catch (e) {}
      }
      if ((await platformCookies(ses, platform)).length === 0) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }
  // cookie format ekstensi Chrome (hasil "Export akun") -> sesi Electron
  async function restoreCookies(ses, list) {
    let n = 0;
    for (const c of list || []) {
      try {
        const bare = String(c.domain || "").replace(/^\./, "");
        if (!bare) continue;
        const o = { url: (c.secure !== false ? "https" : "http") + "://" + bare + (c.path || "/"), name: c.name, value: c.value, path: c.path || "/", secure: c.secure !== false, httpOnly: !!c.httpOnly };
        if (c.domain && c.domain.charAt(0) === ".") o.domain = c.domain;
        const ss = c.sameSite || "no_restriction";
        o.sameSite = ["no_restriction", "lax", "strict", "unspecified"].indexOf(ss) >= 0 ? ss : "no_restriction";
        if (!c.session && c.expirationDate) o.expirationDate = c.expirationDate;
        await ses.cookies.set(o); n++;
      } catch (e) {}
    }
    return n;
  }
  // akun hasil impor dari ekstensi: pulihkan cookie ke profilnya sendiri sekali, lalu buang salinan dari data
  async function ensureCookies(acc, ses, platform) {
    if (await hasSessionCookie(ses, platform)) return { restored: 0 };
    if (!acc.cookies || !acc.cookies.length) return { restored: 0 };
    const n = await restoreCookies(ses, acc.cookies);
    return { restored: n };
  }

  // ---------- state & handler pesan Manajer Proxy ----------
  function getState() {
    const accs = accList(), proxies = proxyList(), used = {};
    proxies.forEach((p) => { used[p.id] = 0; });
    accs.forEach((a) => { if (a.proxyId && used[a.proxyId] != null) used[a.proxyId]++; });
    const s = S.get(["switch_log", "proxy_last_exit_ip"]);
    return {
      ok: true, settings: getSettings(),
      proxies: proxies.map((p) => Object.assign({}, p, { usernameTemplate: p.usernameTemplate || p.username || "", password: p.password || "", assigned: used[p.id] || 0 })),
      accounts: accs.map((a) => ({ label: a.label, username: a.username || null, platform: a.platform || "instagram", enabled: a.enabled !== false, proxyId: a.proxyId || null, sessionMode: a.sessionMode === "rotate" ? "rotate" : "sticky", hasSession: !!a.sessionId, cookieCount: (a.cookies || []).length, identity: a.identity || null, needsLogin: !!a.needsLogin })),
      identityProfiles: ID_PROFILES.map((p) => ({ id: p.id, name: p.name })), timezones: ID_TZ_COMMON,
      applied: null, perAccount: true, lastIp: (s.proxy_last_exit_ip) || null, switchLog: (s.switch_log || []).slice(0, 150)
    };
  }
  const sanitize = (p) => ({
    id: p.id || uid(), label: String(p.label || "").trim() || "Proxy", scheme: ["http", "https", "socks5"].indexOf(p.scheme) >= 0 ? p.scheme : "http",
    host: String(p.host || "").trim(), port: Math.max(1, Math.min(65535, parseInt(p.port, 10) || 0)),
    usernameTemplate: String(p.usernameTemplate || p.username || "").trim(), password: String(p.password || ""), note: String(p.note || "")
  });

  async function handle(req) {
    switch (req.action) {
      case "PROXY_GET_STATE": return getState();
      case "PROXY_TOGGLE": {
        const st = setSettings({ enabled: !!req.enabled });
        logEntry({ type: "proxy", detail: st.enabled ? "Sistem proxy diaktifkan." : "Sistem proxy dimatikan — semua akun memakai jaringan asli." });
        return { ok: true, settings: st };
      }
      case "PROXY_SAVE_PROXY": {
        const p = sanitize(req.proxy || {});
        if (!p.host || !p.port) return { ok: false, error: "Host & port wajib diisi." };
        const list = proxyList(), i = list.findIndex((x) => x.id === p.id);
        if (i >= 0) list[i] = Object.assign({}, list[i], p); else list.push(p);
        saveProxyList(list);
        logEntry({ type: "proxy", detail: "Proxy disimpan: " + (p.label || p.host + ":" + p.port) });
        return { ok: true, id: p.id };
      }
      case "PROXY_DELETE_PROXY": {
        saveProxyList(proxyList().filter((x) => x.id !== req.id));
        const accs = accList(); let ch = false;
        accs.forEach((a) => { if (a.proxyId === req.id) { a.proxyId = null; ch = true; } });
        if (ch) S.set({ saved_accounts: accs });
        logEntry({ type: "proxy", detail: "Proxy dihapus & tugasannya dilepas dari semua akun." });
        return { ok: true };
      }
      case "PROXY_ASSIGN": {
        const accs = accList();
        const a = accs.find((x) => x.label === req.label && (x.platform || "instagram") === (req.platform || "instagram"));
        if (!a) return { ok: false, error: "Akun tidak ditemukan." };
        a.proxyId = req.proxyId || null;
        if (req.sessionMode) a.sessionMode = req.sessionMode === "rotate" ? "rotate" : "sticky";
        if (!a.sessionId) a.sessionId = newSessionId();
        S.set({ saved_accounts: accs });
        logEntry({ type: "proxy", platform: req.platform, account: req.label, detail: a.proxyId ? "Proxy ditugaskan ke akun (mode " + a.sessionMode + ")." : "Tugasan proxy akun dilepas (pakai jaringan asli)." });
        return { ok: true };
      }
      case "PROXY_ASSIGN_BULK": {
        // how: same = satu proxy untuk semua | roundrobin = bagi rata berurutan | random = acak | clear = lepas semua
        const accs = accList(), proxies = proxyList(), how = req.how;
        const targets = accs.filter((a) => (!req.platform || (a.platform || "instagram") === req.platform) && (!req.onlyUnassigned || !a.proxyId));
        if (!targets.length) return { ok: false, error: "Tidak ada akun yang cocok dengan filter." };
        let pool = [];
        if (how === "same") {
          const px = proxies.find((x) => x.id === req.proxyId);
          if (!px) return { ok: false, error: "Pilih proxy dulu." };
          pool = [px];
        } else if (how === "roundrobin" || how === "random") {
          pool = proxies.slice();
          if (!pool.length) return { ok: false, error: "Belum ada proxy." };
        } else if (how !== "clear") return { ok: false, error: "Mode bagi proxy tidak dikenal." };
        targets.forEach((a, i) => {
          if (how === "clear") { a.proxyId = null; return; }
          a.proxyId = (how === "random" ? pool[crypto.randomInt(pool.length)] : pool[i % pool.length]).id;
          if (req.sessionMode) a.sessionMode = req.sessionMode === "rotate" ? "rotate" : "sticky";
          if (!a.sessionId) a.sessionId = newSessionId();
        });
        S.set({ saved_accounts: accs });
        // peringatan: proxy tanpa {session} yang dipakai lebih dari satu akun = akun-akun itu berbagi IP yang sama
        let warn = "";
        if (how !== "clear") {
          const count = {};
          targets.forEach((a) => { count[a.proxyId] = (count[a.proxyId] || 0) + 1; });
          const shared = pool.filter((px) => (count[px.id] || 0) > 1 && String(px.usernameTemplate || px.username || "").indexOf("{session}") < 0);
          if (shared.length) warn = shared.length + " proxy tanpa {session} dipakai >1 akun (IP-nya akan dibagi bersama)";
        }
        logEntry({ type: "proxy", detail: how === "clear" ? "Massal: tugasan proxy dilepas dari " + targets.length + " akun." : "Massal: " + targets.length + " akun ditugaskan proxy (" + how + ", mode " + (req.sessionMode === "rotate" ? "ganti IP" : "sticky") + ")." + (warn ? " " + warn + "." : "") });
        return { ok: true, count: targets.length, warn };
      }
      case "PROXY_APPLY_NOW": { // pasang proxy akun ke profilnya & ukur IP keluar akun itu
        const a = findAcc(req.platform, req.label);
        if (!a) return { ok: false, error: "Akun tidak ditemukan." };
        const r = await applyForAccount(a, req.platform);
        if (r.applied) {
          const ip = await checkExitIp(r.ses, 10000);
          if (ip.ip) { S.set({ proxy_last_exit_ip: { ip: ip.ip, ms: ip.ms, at: Date.now(), account: a.label } }); logEntry({ type: "ip", platform: req.platform, account: a.label, proxy: r.proxyName, detail: "IP keluar: " + ip.ip + " (" + ip.ms + " ms)" }); }
          else logEntry({ type: "error", platform: req.platform, account: a.label, proxy: r.proxyName, detail: "Cek IP keluar GAGAL — proxy mati / kredensial salah / kuota habis. Jalankan Tes proxy. (" + ip.error + ")" });
        }
        return { ok: true };
      }
      case "PROXY_TEST": return testProxy(req.id);
      case "PROXY_CHECK_IP": { const r = await checkExitIp(session.defaultSession, 10000); return r.ip ? { ok: true, ip: r.ip, ms: r.ms } : { ok: false }; }
      case "PROXY_CLEAR_LOG": S.set({ switch_log: [] }); return { ok: true };
      case "PROXY_IMPORT": {
        const d = req.data || {};
        if (!Array.isArray(d.proxies)) return { ok: false, error: "Format tidak dikenal (butuh proxies[])." };
        saveProxyList(d.proxies.map(sanitize));
        if (Array.isArray(d.assignments)) {
          const accs = accList();
          d.assignments.forEach((asg) => {
            const a = accs.find((x) => x.label === asg.label && (x.platform || "instagram") === (asg.platform || "instagram"));
            if (a) { a.proxyId = asg.proxyId || null; if (asg.sessionMode) a.sessionMode = asg.sessionMode; if (!a.sessionId) a.sessionId = newSessionId(); }
          });
          S.set({ saved_accounts: accs });
        }
        logEntry({ type: "proxy", detail: "Data proxy diimpor (" + d.proxies.length + " proxy)." });
        return { ok: true };
      }
      case "IDENTITY_MODE": return { ok: true, settings: setSettings({ identityMode: req.mode === "all" ? "all" : "proxy_only" }) };
      case "IDENTITY_TOGGLE": return { ok: true, settings: setSettings({ identityEnabled: !!req.enabled }) };
      case "IDENTITY_SET": return identitySet(req);
      case "IDENTITY_PROFILES": return { ok: true, profiles: ID_PROFILES.map((p) => ({ id: p.id, name: p.name })), timezones: ID_TZ_COMMON };
    }
    return { ok: false, error: "Aksi tidak dikenal." };
  }

  return {
    PLATFORMS, platformOfUrl, platformOfHost,
    accList, findAcc, persistAccountFields, ensurePid, partitionOf, sessionOf,
    getSettings, applyForAccount, onAppLogin, checkExitIp, logEntry,
    identityPrepare, identityBuild, platformCookies, hasSessionCookie, wipeCookies, restoreCookies, ensureCookies,
    newSessionId, handle
  };
}
module.exports = { create, PLATFORMS, platformOfUrl, platformOfHost, ID_PROFILES };
