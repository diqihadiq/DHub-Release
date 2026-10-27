// accounts.js — tambah akun / login ulang lewat jendela profil terpisah, deteksi login otomatis, ekspor backup.
// Pengganti alur ekstensi "login di tab -> klik ikon -> Simpan cookies": di sini jendela login punya profil sendiri
// dan akun tersimpan otomatis begitu cookie sesi muncul.
const W = require("./windows");

// jalan DI DALAM halaman (dunia utama): cari username akun yang sedang login
function pageDetect(platform) {
  try {
    if (platform === "x") {
      const p = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      if (p) { const m = (p.getAttribute("href") || "").match(/^\/([A-Za-z0-9_]{1,15})\/?$/); if (m) return m[1]; }
      const s = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      if (s) { const m = (s.textContent || "").match(/@([A-Za-z0-9_]{1,15})/); if (m) return m[1]; }
    } else if (platform === "threads") {
      for (const a of document.querySelectorAll('a[href^="/@"]')) {
        const lab = (a.getAttribute("aria-label") || "").toLowerCase();
        if (a.closest("nav") || /profile|profil/.test(lab)) { const m = (a.getAttribute("href") || "").match(/^\/@([^\/?#]+)/); if (m) return m[1]; }
      }
    } else if (platform === "tiktok") {
      const s = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
      if (s) { const j = JSON.parse(s.textContent); const u = j.__DEFAULT_SCOPE__["webapp.app-context"].user; if (u && u.uniqueId) return u.uniqueId; }
      const p = document.querySelector('a[data-e2e="nav-profile"], [data-e2e="profile-icon"]');
      if (p) { const a = p.closest("a") || p; const m = (a.getAttribute("href") || "").match(/\/@([^\/?#]+)/); if (m) return m[1]; }
    } else {
      const m = document.querySelector('a[href^="/"][role="link"] img[alt*="profile picture"]');
      if (m) { const a = m.closest("a"); const mm = (a.getAttribute("href") || "").match(/^\/([^\/]+)\/?$/); if (mm) return mm[1]; }
    }
  } catch (e) {}
  return null;
}

function create(deps) {
  const { S, prof, preloadPath, notify } = deps;
  const { PLATFORMS } = prof;
  const open = new Map(); // "platform:label" -> handle

  async function openLoginWindow(acc, startUrl) {
    const pf = acc.platform || "instagram", key = pf + ":" + acc.label;
    const prev = open.get(key);
    if (prev && !prev.closed) { try { prev.win.show(); prev.win.focus(); } catch (e) {} return prev; }
    const applied = await prof.applyForAccount(acc, pf);
    const ident = await prof.identityPrepare(acc, pf, !!applied.applied, applied.ses);
    const b = W.getWorkArea();
    const h = await W.openHandle({ ses: applied.ses, acc, bounds: { x: b.left + 40, y: b.top + 30, width: Math.min(1100, b.width - 80), height: Math.min(820, b.height - 60) }, preloadPath, identity: ident, url: startUrl || PLATFORMS[pf].login });
    open.set(key, h);
    h.win.on("closed", () => { if (open.get(key) === h) open.delete(key); });
    watchLogin(h, acc);
    return h;
  }

  // tunggu cookie sesi muncul (tanda login selesai), lalu simpan username & buang tanda "perlu login"
  function watchLogin(h, acc) {
    const pf = acc.platform || "instagram";
    let seen = 0, tries = 0, finished = false;
    const iv = setInterval(async () => {
      if (h.closed || finished) return clearInterval(iv);
      try {
        if (!(await prof.hasSessionCookie(h.ses, pf))) { seen = 0; return; }
        if (++seen < 2) return; // cookie harus terlihat 2 kali berturut-turut (login benar-benar selesai)
        let username = null;
        try { username = await W.execInPage(h, pageDetect, [pf]); } catch (e) {}
        if (!username) { try { const r = await W.sendToContent(h, { action: "GET_USERNAME" }, 0, 100); if (r && r.username) username = r.username; } catch (e) {} }
        if (!username && ++tries < 8) return; // beri waktu halaman memuat (~16 dtk), lalu simpan tanpa username
        finished = true; clearInterval(iv);
        username = username ? String(username).replace(/^@/, "").trim() : null;
        const list = prof.accList();
        const dup = username ? list.find((a) => a.username && a.username.toLowerCase() === username.toLowerCase() && (a.platform || "instagram") === pf && a.label !== acc.label) : null;
        if (dup) {
          notify("Akun @" + username + " sudah tersimpan sebagai '" + dup.label + "'. Akun baru '" + acc.label + "' dibatalkan.");
          S.set({ saved_accounts: list.filter((a) => !(a.label === acc.label && (a.platform || "instagram") === pf)) });
          try { await h.ses.clearStorageData(); } catch (e) {}
          setTimeout(() => W.closeHandle(h), 800);
          return;
        }
        const patch = { savedAt: Date.now(), enabled: true };
        if (username) patch.username = username;
        const cur = prof.findAcc(pf, acc.label) || acc;
        ["needsLogin", "needsLoginAt", "needsLoginReason"].forEach((k) => { delete cur[k]; });
        const all = prof.accList(), i = all.findIndex((a) => a.label === acc.label && (a.platform || "instagram") === pf);
        if (i >= 0) { ["needsLogin", "needsLoginAt", "needsLoginReason"].forEach((k) => { delete all[i][k]; }); Object.assign(all[i], patch); S.set({ saved_accounts: all }); }
        notify("Akun " + PLATFORMS[pf].name + " '" + acc.label + "'" + (username ? " (@" + username + ")" : "") + " tersimpan.");
        setTimeout(() => W.closeHandle(h), 1500);
      } catch (e) {}
    }, 2000);
    h.win.on("closed", () => clearInterval(iv));
  }

  async function addAccount(req) {
    const platform = PLATFORMS[req.platform] ? req.platform : "instagram";
    const label = String(req.label || "").trim();
    if (!label) return { ok: false, error: "Isi label akun dulu." };
    if (prof.findAcc(platform, label)) return { ok: false, error: "Label '" + label + "' sudah dipakai di " + PLATFORMS[platform].name + "." };
    const list = prof.accList();
    const acc = { label, platform, enabled: true, createdAt: Date.now(), needsLogin: true, needsLoginReason: "belum login", sessionMode: "sticky" };
    if (req.proxyId) { acc.proxyId = req.proxyId; acc.sessionId = prof.newSessionId(); }
    list.push(acc);
    S.set({ saved_accounts: list });
    prof.ensurePid(acc);
    prof.identityPrepare; // identitas dibuat saat jendela dibuka
    try { await openLoginWindow(prof.findAcc(platform, label)); }
    catch (e) { return { ok: false, error: "Gagal membuka jendela login: " + e.message }; }
    return { ok: true };
  }
  async function openAccount(req) {
    const acc = prof.findAcc(req.platform, req.label);
    if (!acc) return { ok: false, error: "Akun tidak ditemukan." };
    const pf = acc.platform || "instagram";
    try { await openLoginWindow(acc, (await prof.hasSessionCookie(prof.sessionOf(acc), pf)) ? PLATFORMS[pf].home : PLATFORMS[pf].login); }
    catch (e) { return { ok: false, error: e.message }; }
    return { ok: true };
  }

  // backup: cookie dibaca langsung dari profil akun, format sama dengan ekspor ekstensi
  async function exportAccounts(req) {
    const out = [];
    for (const a of prof.accList()) {
      const pf = a.platform || "instagram";
      if (req && req.platform && pf !== req.platform) continue;
      let cookies = a.cookies || [];
      try {
        if (a.pid) {
          const cs = await prof.platformCookies(prof.sessionOf(a), pf);
          if (cs.length) cookies = cs.map((c) => { const o = { name: c.name, value: c.value, domain: c.domain, path: c.path, secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite || "unspecified", session: !c.expirationDate }; if (c.expirationDate) o.expirationDate = c.expirationDate; return o; });
        }
      } catch (e) {}
      const e2 = { label: a.label, username: a.username || null, platform: pf, enabled: a.enabled !== false, cookies, sessionMode: a.sessionMode || "sticky" };
      if (a.identity) e2.identity = a.identity;
      out.push(e2);
    }
    return { ok: true, accounts: out };
  }

  return { addAccount, openAccount, exportAccounts, pageDetect };
}
module.exports = { create };
