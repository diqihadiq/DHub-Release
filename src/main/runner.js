// runner.js — port logika task dari background.js (komentar, like komentar, follow, rem otomatis, resume, verifikasi, screenshot).
// Perbedaan utama dari ekstensi:
//  - "tab" = jendela akun (handle) dengan profil/cookie/proxy sendiri -> tidak perlu hapus-pulihkan cookie antar akun
//  - tidak ada "jalur" per platform: sampai `task.parallel` akun berjalan BERSAMAAN, masing-masing di profilnya sendiri
const fs = require("fs");
const path = require("path");

function create(deps) {
  const { S, lic, prof, W, preloadPath, appVersion, downloadsDir } = deps;
  const { PLATFORMS, platformOfUrl } = prof;

  let jobState = null;
  const MAX_CONSEC_FAIL = 8;
  const FOLLOW_MAX_CONSEC = 6, FOLLOW_PAUSE_MIN = 30, FOLLOW_MAX_PAUSES = 3;
  const RESULTS_MAX = 2000, HISTORY_RESULTS_KEEP = 20, LOG_MAX = 300;
  const GATE_FATAL = /^(Licence|Konfigurasi|Tidak bisa verifikasi licence|Data licence|Jam komputer|Respons server licence)/;
  let onJobChange = function () {};

  // ===================== util: stop, sleep, log =====================
  const userStopped = () => !!(jobState && jobState.userStop);
  const sleepers = new Set(), stopWaiters = new Set();
  function sleep(ms) {
    return new Promise((r) => {
      if (userStopped()) return r();
      const h = { r, t: null };
      h.t = setTimeout(() => { sleepers.delete(h); r(); }, ms);
      sleepers.add(h);
    });
  }
  function wakeStopWaiters() {
    Array.from(sleepers).forEach((h) => { clearTimeout(h.t); sleepers.delete(h); h.r(); });
    Array.from(stopWaiters).forEach((f) => { try { f(); } catch (e) {} });
  }
  const stamp = () => "[" + new Date().toLocaleTimeString("id-ID") + "] ";
  function appendLog(line) {
    const arr = S.get(["job_log"]).job_log || [];
    arr.push(line);
    if (arr.length > LOG_MAX) arr.splice(0, arr.length - LOG_MAX);
    S.set({ job_log: arr });
  }
  const sendProgress = (m) => appendLog(stamp() + m);
  const lg = (acc, m) => sendProgress(((acc && acc.__tag) || "") + m);
  const jit = (ms) => (ms <= 0 ? 0 : Math.round(ms * (0.85 + Math.random() * 0.3)));
  const accKey = (a) => (a.platform || "instagram") + ":" + a.label;
  function normUrl(u) {
    try {
      const x = new URL(u);
      if (/(^|\.)threads\.net$/.test(x.hostname)) x.hostname = "www.threads.com";
      if (/(^|\.)twitter\.com$/.test(x.hostname)) x.hostname = "x.com";
      return x.toString();
    } catch (e) { return u; }
  }
  const itemKey = (acc, kind, url) => accKey(acc) + "|" + kind + "|" + url;
  function rec(acc, kind, url, status, detail, notDone) {
    if (!jobState) return;
    if (jobState.results.length < RESULTS_MAX) jobState.results.push({ at: Date.now(), label: acc.label, username: acc.username || "", platform: acc.platform || "instagram", kind, url, status, detail: String(detail || "").slice(0, 300) });
    if (status !== "gagal" && !notDone) jobState.doneKeys.add(itemKey(acc, kind, url));
  }
  const markNeedsLogin = (acc, reason) => prof.persistAccountFields(acc, { needsLogin: true, needsLoginAt: Date.now(), needsLoginReason: reason });
  const tiktokHandle = (u) => { const m = /tiktok\.com\/@([^\/?#]+)/i.exec(String(u || "")); return m ? m[1] : ""; };
  const tiktokPostId = (u) => { const m = /\/(?:video|photo)\/(\d{8,})/.exec(String(u || "")); return m ? m[1] : ""; };
  // akun yang kena suspend / dinonaktifkan / minta verifikasi: percuma mencoba link lain, sesinya tidak akan bisa dipakai
  const BLOCKED_PAGE_RE = /\/accounts\/suspended|\/accounts\/disabled|\/accounts\/(?:login\/)?challenge|\/challenge(\/|\?|$)/;
  const curUrl = (h) => { try { return String(h.wc.getURL() || ""); } catch (e) { return ""; } };
  const blockedReason = (h) => {
    const u = curUrl(h);
    if (/\/accounts\/suspended/.test(u)) return "akun suspended";
    if (/\/accounts\/disabled/.test(u)) return "akun dinonaktifkan";
    if (BLOCKED_PAGE_RE.test(u)) return "butuh verifikasi (challenge)";
    return "";
  };
  const onLoginPage = (h) => { const u = curUrl(h); return /\/accounts\/login|\/i\/flow\/login|\/login(\/|\?|$)/.test(u) || BLOCKED_PAGE_RE.test(u); };
  const reelAsPost = (u) => { const m = String(u).match(/\/reels?\/([A-Za-z0-9_-]+)/); return m ? "https://www.instagram.com/p/" + m[1] + "/" : null; };
  const slugOf = (url) => { const m = String(url).match(/\/(?:p|reel|reels|tv|video|status|post)\/([^/?#]+)/); return m ? m[1] : "post"; };
  const safeName = (s) => String(s || "x").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
  function pushProgress(label) {
    if (!jobState) return;
    if (label != null) jobState.itemLabel = label;
    const L = jobState.live || { ok: 0, skip: 0, fail: 0 };
    S.set({ job_progress: { name: jobState.task.name, platform: jobState.task.platform || null, acc: jobState.started, accTotal: jobState.accTotal || 0, ok: L.ok, skip: L.skip, fail: L.fail, item: jobState.itemLabel || "", startedAt: jobState.startedAt } });
  }
  function bumpProg(kind, label) { if (!jobState) return; jobState.live = jobState.live || { ok: 0, skip: 0, fail: 0 }; jobState.live[kind]++; pushProgress(label); }
  const taskPart = (task, key, flag) => ((task.actions || {})[flag] === false ? [] : (task[key] || []));
  function gateFatal(resp) {
    if (!resp || resp.ok || !GATE_FATAL.test(String(resp.error || ""))) return false;
    if (jobState && !jobState.stopped) { jobState.stopped = true; sendProgress("Task dihentikan: " + resp.error); }
    return true;
  }
  function parseCommentLink(link, platform) {
    let m;
    if (platform === "x") { m = link.match(/\/status\/(\d+)/); return m ? m[1] : null; }
    if (platform === "threads") { m = link.match(/\/post\/([\w-]+)/); return m ? m[1] : null; }
    m = link.match(/\/c\/(\d+)(?:\/r\/(\d+))?/); if (m) return m[2] || m[1];
    m = link.match(/[?&](?:reply_comment_id|comment_id|cid)=(\d+)/); if (m) return m[1];
    return null;
  }
  function preloaded(opts, h, url) {
    const p = opts && opts.pre;
    if (p && p.ok && p.tab === h.id && p.url === url) { p.ok = false; return true; }
    return false;
  }

  // rem like komentar & follow
  function trackLikeResult(ok) {
    if (!jobState) return;
    if (ok) { jobState.consecFail = 0; return; }
    jobState.consecFail = (jobState.consecFail || 0) + 1;
    if (jobState.consecFail >= MAX_CONSEC_FAIL && !jobState.stopped) {
      jobState.stopped = true;
      sendProgress("Task dihentikan otomatis: " + MAX_CONSEC_FAIL + " like komentar gagal beruntun. Cek link komentar / kondisi platform, lalu jalankan lagi.");
    }
  }
  async function trackFollowResult(ok, blocked) {
    if (!jobState) return;
    if (jobState.followPause) { await jobState.followPause; return; }
    if (ok) { jobState.followFail = 0; return; }
    jobState.followFail = blocked ? FOLLOW_MAX_CONSEC : (jobState.followFail || 0) + 1;
    if (jobState.followFail < FOLLOW_MAX_CONSEC || jobState.stopped) return;
    jobState.followFail = 0;
    jobState.followPauses = (jobState.followPauses || 0) + 1;
    if (jobState.followPauses > FOLLOW_MAX_PAUSES) { jobState.stopped = true; sendProgress("Task dihentikan otomatis: follow masih gagal beruntun setelah " + FOLLOW_MAX_PAUSES + "x jeda panjang. Akun kemungkinan sedang dibatasi; coba lagi besok."); return; }
    sendProgress("REM OTOMATIS: " + FOLLOW_MAX_CONSEC + " follow gagal beruntun" + (blocked ? " / pesan pembatasan muncul" : "") + ". Jeda panjang " + FOLLOW_PAUSE_MIN + " menit (ke-" + jobState.followPauses + "/" + FOLLOW_MAX_PAUSES + "), lalu lanjut otomatis. Tekan Stop untuk berhenti.");
    pushProgress("Jeda panjang " + FOLLOW_PAUSE_MIN + " menit (follow dibatasi)");
    const js = jobState;
    js.followPause = sleep(FOLLOW_PAUSE_MIN * 60000);
    await js.followPause;
    js.followPause = null;
    if (jobState && !jobState.stopped) sendProgress("Jeda panjang selesai, lanjut follow.");
  }

  // ===================== jendela / halaman =====================
  const gotoUrl = (h, url, fast) => W.gotoUrl(h, url, { fast, waiters: stopWaiters, stopped: userStopped });
  const sendToContent = (h, msg, retries, interval) => W.sendToContent(h, msg, retries, interval, userStopped);
  async function ensureContent(h) {
    try { const r = await sendToContent(h, { action: "PING" }, 8, 150); if (r) return true; } catch (e) {}
    try { h.wc.send("dh:inject"); } catch (e) { return false; }
    await sleep(300);
    try { const r = await sendToContent(h, { action: "PING" }, 4, 200); return !!r; } catch (e) { return false; }
  }
  function focusHandle(h, force) {
    try {
      if (h.closed) return;
      if (h.win.isMinimized()) h.win.restore();
      else if (force) h.win.focus();
    } catch (e) {}
  }
  // layar
  const PROFILE_NAME = { laptop: "Laptop / Mac", big: "Monitor besar", single: "Satu jendela" };
  function resolveProfile(pref, area) { if (pref === "laptop" || pref === "big" || pref === "single") return pref; return (area.width >= 2200 && area.height >= 1100) ? "big" : "laptop"; }
  function tabCap(profile, area) {
    const fit = Math.max(1, Math.floor(area.width / W.MIN_WIN_W)) * Math.max(1, Math.floor(area.height / W.MIN_WIN_H));
    return Math.max(1, Math.min(profile === "single" ? 1 : (profile === "laptop" ? 2 : 6), fit, 6));
  }
  function screenPlan(requested) {
    const area = W.getWorkArea(), pf = resolveProfile(S.get(["screen_profile"]).screen_profile || "auto", area), cap = tabCap(pf, area);
    return { profile: pf, cap, n: Math.max(1, Math.min(requested, cap)), area };
  }

  // ===================== cookie / sesi =====================
  async function wipeTikTokStorage(ses) {
    try { await ses.clearStorageData({ origin: "https://www.tiktok.com", storages: ["localstorage", "indexdb", "cachestorage", "serviceworkers"] }); } catch (e) {}
  }
  // kode yang dijalankan DI DALAM halaman (dunia utama), harus berdiri sendiri
  async function pageWaitAvatars() {
    const t0 = Date.now();
    while (Date.now() - t0 < 7000) {
      const imgs = Array.from(document.querySelectorAll('[data-e2e^="comment-level"] img, [data-e2e="comment-input"] img, [class*="Avatar"] img, img[class*="Avatar"]')).filter(function (i) { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (imgs.length && imgs.every(function (i) { return i.complete && i.naturalWidth > 0; })) return true;
      await new Promise(function (r) { setTimeout(r, 250); });
    }
    return false;
  }
  async function pageWaitThreadsPosted(text) {
    const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    const norm = function (s) { return String(s || "").replace(/\s+/g, " ").trim(); };
    const vis = function (el) { try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (e) { return false; } };
    const snip = norm(text).slice(0, 30);
    const findText = function () {
      if (!snip) return null;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (n.nodeValue && norm(n.nodeValue).indexOf(snip) >= 0) {
          const p = n.parentElement;
          if (p && !p.closest('[contenteditable="true"], textarea, [role="textbox"]') && vis(p)) return p;
        }
      }
      return null;
    };
    const dim = function (el) { for (let i = 0, e = el; i < 10 && e && e !== document.body; i++, e = e.parentElement) { const o = parseFloat(getComputedStyle(e).opacity); if (!isNaN(o) && o < 0.85) return true; } return false; };
    const spinning = function (el) {
      const c = el.closest("[data-pressable-container]") || (el.parentElement && el.parentElement.parentElement) || el;
      try { if (c.getAnimations({ subtree: true }).some(function (a) { return a.playState === "running" && a.effect && a.effect.getTiming().iterations === Infinity; })) return true; } catch (e) {}
      return !!c.querySelector("animateTransform, animate");
    };
    const busy = function () {
      for (const n of document.querySelectorAll('[role="progressbar"], [aria-busy="true"], progress')) if (vis(n)) return true;
      for (const n of document.querySelectorAll("span, div")) { if (n.children.length > 2) continue; const t = norm(n.textContent); if (t && t.length < 24 && /^(Posting|Memposting|Mengirim|Sending)\.{0,3}$/i.test(t) && vis(n)) return true; }
      return false;
    };
    const t0 = Date.now(); let calm = 0, last = null;
    while (Date.now() - t0 < 12000) {
      const el = findText();
      if (el && !busy() && !dim(el) && !spinning(el)) { last = el; if (++calm >= 3) break; } else calm = 0;
      await nap(400);
    }
    if (last) { try { last.scrollIntoView({ block: "center" }); } catch (e) {} await nap(300); }
    return !!last && calm >= 3;
  }
  async function prepareShot(h, platform, text) {
    try {
      if (platform === "x") { for (let k = 0; k < 3; k++) { try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {} await sleep(500); } }
      else if (platform === "tiktok") { await sleep(2000); try { await W.execInPage(h, pageWaitAvatars); } catch (e) {} await sleep(500); }
      else if (platform === "threads") {
        for (let k = 0; k < 2; k++) { try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {} await sleep(400); }
        let done = false;
        try { done = !!(await W.execInPage(h, pageWaitThreadsPosted, [text || ""])); } catch (e) {}
        try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {}
        await sleep(done ? 400 : 1500);
      }
    } catch (e) {}
  }
  async function captureProof(h, account, kind, index, url, suffix, text) {
    if (!jobState || !jobState.screenshot || jobState.userStop) return;
    try {
      focusHandle(h);
      await prepareShot(h, account.platform || "instagram", text);
      const png = await W.screenshotPng(h);
      const rel = path.join("DHub", jobState.sessionStamp, safeName(account.username || account.label), String(index).padStart(2, "0") + "_" + kind + "_" + safeName(slugOf(url)) + (suffix || "") + ".png");
      const full = path.join(downloadsDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, png);
      sendProgress("  screenshot: Downloads/" + rel.replace(/\\/g, "/"));
    } catch (e) { sendProgress("  (screenshot gagal: " + e.message + ")"); }
  }

  // ===================== eksekusi per akun =====================
  async function processPostsForAccount(pool, account, comments, urls, delayPost, opts, used) {
    let ok = 0, fail = 0;
    const queue = urls.map((u, idx) => ({ url: u, idx }));
    const platform = account.platform || "instagram", fast = !!opts.fast;
    const send = (h, comment, url) => sendToContent(h, { action: "PROCESS_POST", data: { comment, expectId: platform === "tiktok" ? tiktokPostId(url) : "", expectHandle: platform === "tiktok" ? tiktokHandle(url) : "", autoLike: opts.autoLike, autoRepost: opts.autoRepost, autoFollow: opts.autoFollow, fast, screenshot: !!opts.screenshot } }, 6, 700);
    // TikTok bisa mengalihkan halaman ke video lain (feed). Jangan pernah komen kalau halaman bukan post target.
    const tiktokOffTarget = (h, url) => { const id = platform === "tiktok" ? tiktokPostId(url) : ""; return !!id && curUrl(h).indexOf(id) < 0; };
    const OFF_TARGET_MSG = "Halaman TikTok bukan post target (dialihkan ke video lain), komentar dibatalkan agar tidak salah posting";
    const worker = async (h) => {
      while (queue.length > 0 && !jobState.stopped) {
        const item = queue.shift(), i = item.idx;
        const unused = comments.filter((c) => !opts.skipUsed || !used[c]);
        if (unused.length === 0) { lg(account, "  Semua komentar sudah terpakai."); break; }
        let free = opts.skipUsed ? unused.filter((c) => !opts.reserved.has(c)) : unused;
        // semua draft sisa sedang dikirim jalur lain: tunggu hasilnya, JANGAN pakai draft yang sama (itu yang bikin komentar dobel)
        for (let w = 0; opts.skipUsed && free.length === 0 && opts.reserved.size > 0 && w < 120 && !jobState.stopped; w++) {
          await sleep(500);
          free = comments.filter((c) => !used[c] && !opts.reserved.has(c));
        }
        if (free.length === 0) { lg(account, "  Dilewati: target komentar sudah tercapai (semua draft terpakai)."); jobState.totalSkip++; rec(account, "komentar", item.url, "dilewati", "target komentar tercapai (draft habis)"); continue; }
        const pool2 = free;
        const chosen = pool2[Math.floor(Math.random() * pool2.length)];
        if (opts.skipUsed) opts.reserved.add(chosen);
        lg(account, "  [" + (i + 1) + "/" + urls.length + "] " + item.url);
        try {
          if (preloaded(opts, h, item.url)) lg(account, "  (halaman sudah termuat dari cek login)"); else await gotoUrl(h, item.url, fast);
          if (!(await ensureContent(h))) throw new Error("content script tidak bisa dimuat di halaman ini");
          try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {}
          if (tiktokOffTarget(h, item.url)) {
            lg(account, "  halaman dialihkan ke video lain -> muat ulang post target");
            await gotoUrl(h, item.url, false);
            if (!(await ensureContent(h))) throw new Error("content script tidak bisa dimuat di halaman ini");
            if (tiktokOffTarget(h, item.url)) throw new Error(OFF_TARGET_MSG);
          }
          let resp = await send(h, chosen, item.url);
          if (gateFatal(resp)) break;
          if (resp && !resp.ok && platform !== "instagram" && /tidak ditemukan|Gagal mengetik|tidak termuat/i.test(resp.error || "")) {
            lg(account, "  gagal (" + String(resp.error).slice(0, 80) + ") -> coba ulang 1x");
            await sleep(fast ? 700 : 1500);
            await gotoUrl(h, item.url, false);
            if (await ensureContent(h)) { try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {} resp = tiktokOffTarget(h, item.url) ? { ok: false, error: OFF_TARGET_MSG } : await send(h, chosen, item.url); if (gateFatal(resp)) break; }
          }
          if (resp && !resp.ok && platform === "tiktok" && /meminta login ulang/i.test(resp.error || "") && !jobState.stopped && account.cookies && account.cookies.length) {
            lg(account, "  sesi TikTok dikeluarkan di tengah jalan -> reset data situs, pulihkan cookie, coba ulang 1x");
            try { await wipeTikTokStorage(h.ses); await prof.wipeCookies(h.ses, platform); await sleep(500); await prof.restoreCookies(h.ses, account.cookies); await gotoUrl(h, item.url, false); } catch (e) {}
            if (await ensureContent(h)) { try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {} resp = tiktokOffTarget(h, item.url) ? { ok: false, error: OFF_TARGET_MSG } : await send(h, chosen, item.url); if (gateFatal(resp)) break; }
          }
          let viaAlt = null;
          if (resp && !resp.ok && platform === "instagram" && /Kotak komentar tidak ditemukan/i.test(resp.error || "") && reelAsPost(item.url) && !jobState.stopped) {
            const alt = reelAsPost(item.url);
            lg(account, "  kotak komentar Reel tidak terbuka | " + String(resp.error).replace(/^Kotak komentar tidak ditemukan\s*\|?\s*/i, "").slice(0, 240));
            lg(account, "  -> coba lewat tampilan post biasa: " + alt);
            await sleep(fast ? 500 : 1200);
            await gotoUrl(h, alt, false);
            if (await ensureContent(h)) {
              try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {}
              resp = tiktokOffTarget(h, item.url) ? { ok: false, error: OFF_TARGET_MSG } : await send(h, chosen, item.url);
              if (gateFatal(resp)) break;
              if (resp && resp.ok) { viaAlt = alt; lg(account, "  (berhasil lewat tampilan /p/)"); }
              else lg(account, "  tampilan /p/ juga gagal: " + String((resp && resp.error) || "tidak ada respons").slice(0, 240));
            }
          }
          if (userStopped()) break;
          const flags = (resp && resp.liked ? " + like" : "") + (resp && resp.reposted ? " + repost" : "") + (resp && resp.followed ? " + follow" : "");
          if (resp && resp.ok) {
            ok++; bumpProg("ok", "Komentar " + (i + 1) + " dari " + urls.length);
            used[chosen] = { account: account.username || account.label, timestamp: Date.now(), url: item.url };
            S.set({ used_comments: used });
            let status = "sukses", note = "";
            if (opts.verify && jobState.verifyOff) { note = " | verifikasi dilewati (2x berturut-turut tidak terdeteksi)"; }
            else if (opts.verify && !userStopped()) {
              const v = await verifyComment(h, viaAlt || item.url, chosen, platform);
              if (v === true) { jobState.verifyMiss = 0; jobState.verifyHit = true; status = "sukses terverifikasi"; note = " | verifikasi: TAMPIL setelah reload"; }
              else if (v === false) { status = "terkirim tapi tidak tampil"; jobState.hidden++; jobState.verifyMiss = (jobState.verifyMiss || 0) + 1; if (jobState.verifyMiss >= 2 && !jobState.verifyHit) { jobState.verifyOff = true; sendProgress("Verifikasi komentar dimatikan untuk sisa task: 2x berturut-turut tidak terdeteksi (kemungkinan salah deteksi, bukan shadowban). Cek manual di Instagram."); } note = " | verifikasi: TIDAK tampil setelah reload (kemungkinan disembunyikan / shadowban)"; }
              else note = " | verifikasi tidak bisa dijalankan";
            }
            const netNote = resp && resp.net ? " | server HTTP " + resp.net : (platform === "instagram" && resp && resp.confirmed === false ? " | BELUM TERKONFIRMASI (status server tidak terbaca dan komentar belum tampil)" : "");
            lg(account, "  OK komen: \"" + chosen.slice(0, 40) + "\"" + flags + (viaAlt ? " (via /p/)" : "") + note + netNote);
            rec(account, "komentar", item.url, status, "\"" + chosen.slice(0, 80) + "\"" + flags + (viaAlt ? " (via /p/)" : "") + (netNote && !resp.net ? " [belum terkonfirmasi]" : ""));
            if (opts.screenshot) { await sleep(500); await captureProof(h, account, "komen", i + 1, viaAlt || item.url, "", chosen); }
          } else {
            const err = (resp && resp.error) || "tidak ada respons";
            fail++; bumpProg("fail", "Komentar " + (i + 1) + " dari " + urls.length); lg(account, "  GAGAL: " + err + (flags ? "  (sudah:" + flags + ")" : ""));
            rec(account, "komentar", item.url, "gagal", err);
            if (/meminta login ulang/i.test(err) || onLoginPage(h)) opts.dead = true;
            await captureProof(h, account, "komen", i + 1, item.url, "_FAIL");
          }
        } catch (e) { if (userStopped()) break; fail++; bumpProg("fail", "Komentar " + (i + 1) + " dari " + urls.length); lg(account, "  GAGAL: " + e.message); rec(account, "komentar", item.url, "gagal", e.message); }
        finally { if (opts.skipUsed) opts.reserved.delete(chosen); }
        if (opts.dead) { lg(account, "  sesi akun keluar (diarahkan ke halaman login) -> sisa link akun ini dihentikan"); queue.length = 0; break; }
        if (queue.length > 0 && !jobState.stopped) await sleep(jit(delayPost * 1000));
      }
    };
    await Promise.all(pool.map(worker));
    return { ok, fail };
  }

  async function verifyComment(h, url, text, platform) {
    try {
      await sleep(jobState && jobState.fast ? 1200 : 2500);
      if (userStopped()) return null;
      await gotoUrl(h, url, false);
      if (!(await ensureContent(h))) return null;
      try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {}
      const r = await sendToContent(h, { action: "VERIFY_COMMENT", data: { text } }, 4, 700);
      if (!r || !r.ok) return null;
      return !!r.found;
    } catch (e) { return null; }
  }

  async function processCommentLikes(pool, account, links, delayPost, opts) {
    let ok = 0, fail = 0, skip = 0;
    const queue = links.map((l, i) => ({ link: l, i }));
    const platform = account.platform || "instagram", fast = !!opts.fast;
    const worker = async (h) => {
      let lastCode = null;
      while (queue.length > 0 && !jobState.stopped) {
        const it = queue.shift(), id = parseCommentLink(it.link, platform);
        lg(account, "  [Like komentar " + (it.i + 1) + "/" + links.length + "] " + it.link);
        if (!id) { fail++; bumpProg("fail", "Like komentar " + (it.i + 1) + " dari " + links.length); lg(account, "  GAGAL: ID komentar tidak ada di link"); rec(account, "like komentar", it.link, "gagal", "ID komentar tidak ada di link"); continue; }
        try {
          focusHandle(h);
          const code = platform === "instagram" ? slugOf(it.link) : null;
          let reuse = false;
          if (code && code !== "post" && lastCode === code) { try { reuse = String(h.wc.getURL()).indexOf(code) >= 0; } catch (e) {} }
          const wasPre = preloaded(opts, h, it.link);
          if (reuse && !wasPre) lg(account, "  (post sama, tidak dimuat ulang)");
          if (!wasPre && !reuse) await gotoUrl(h, it.link, fast);
          lastCode = code;
          focusHandle(h);
          if (!(await ensureContent(h))) throw new Error("content script tidak bisa dimuat");
          try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {}
          let resp = await sendToContent(h, { action: "LIKE_COMMENT", data: { commentId: id } }, 6, 700);
          if (gateFatal(resp)) break;
          if (userStopped()) break;
          if (resp && !resp.ok && /komentar tidak ditemukan/i.test(resp.error || "")) {
            lg(account, "  tidak ketemu -> muat ulang halaman, coba 1x lagi");
            await sleep(fast ? 700 : 1500);
            await gotoUrl(h, it.link, false);
            focusHandle(h);
            if (await ensureContent(h)) { try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {} resp = await sendToContent(h, { action: "LIKE_COMMENT", data: { commentId: id } }, 6, 700); if (gateFatal(resp)) break; }
          }
          if (userStopped()) break;
          if (resp && !resp.ok && /^komentar tidak ditemukan/i.test(String(resp.error || ""))) {
            skip++; lastCode = null; bumpProg("skip", "Like komentar " + (it.i + 1) + " dari " + links.length);
            lg(account, "  DILEWATI: komentar tidak ditemukan (mungkin tersembunyi atau sudah dihapus) | " + String(resp.error).replace(/^komentar tidak ditemukan\s*\|?\s*/i, "").slice(0, 400));
            rec(account, "like komentar", it.link, "dilewati", "komentar tidak ditemukan (tersembunyi / dihapus)");
            if (queue.length > 0 && !jobState.stopped) await sleep(jit(delayPost * 1000));
            continue;
          }
          if (!(resp && resp.ok)) lastCode = null;
          trackLikeResult(!!(resp && resp.ok));
          if (resp && resp.ok) {
            ok++; bumpProg("ok", "Like komentar " + (it.i + 1) + " dari " + links.length); lg(account, "  OK like komentar" + (resp.already ? " (sudah di-like)" : "")); rec(account, "like komentar", it.link, "sukses", resp.already ? "sudah di-like" : "");
            if (opts.screenshot) { await sleep(400); await captureProof(h, account, "likekomentar_" + String(id).slice(-6), it.i + 1, it.link, ""); }
          } else {
            const err = (resp && resp.error) || "tidak ada respons";
            fail++; bumpProg("fail", "Like komentar " + (it.i + 1) + " dari " + links.length); lg(account, "  GAGAL: " + err); rec(account, "like komentar", it.link, "gagal", err);
            if (onLoginPage(h)) opts.dead = true;
            await captureProof(h, account, "likekomentar_" + String(id).slice(-6), it.i + 1, it.link, "_FAIL");
          }
        } catch (e) { if (userStopped()) break; fail++; bumpProg("fail", "Like komentar " + (it.i + 1) + " dari " + links.length); trackLikeResult(false); lg(account, "  GAGAL: " + e.message); rec(account, "like komentar", it.link, "gagal", e.message); }
        if (opts.dead) { lg(account, "  sesi akun keluar (diarahkan ke halaman login) -> sisa link akun ini dihentikan"); queue.length = 0; break; }
        if (queue.length > 0 && !jobState.stopped) await sleep(jit(delayPost * 1000));
      }
    };
    await Promise.all(pool.map(worker));
    return { ok, fail, skip };
  }

  async function processFollows(pool, account, links, delayPost, opts) {
    let ok = 0, fail = 0, skip = 0;
    const queue = links.map((l, i) => ({ link: l, i }));
    const fast = !!opts.fast;
    const worker = async (h) => {
      while (queue.length > 0 && !jobState.stopped) {
        const it = queue.shift(), lab = "Follow " + (it.i + 1) + " dari " + links.length;
        lg(account, "  [Follow " + (it.i + 1) + "/" + links.length + "] " + it.link);
        try {
          if (!preloaded(opts, h, it.link)) await gotoUrl(h, it.link, fast);
          if (!(await ensureContent(h))) throw new Error("content script tidak bisa dimuat");
          try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 0, 100); } catch (e) {}
          const resp = await sendToContent(h, { action: "FOLLOW_PROFILE" }, 6, 700);
          if (gateFatal(resp)) break;
          if (userStopped()) break;
          if (resp && resp.ok) {
            ok++; bumpProg("ok", lab); lg(account, "  OK follow" + (resp.already ? (resp.pending ? " (permintaan sudah terkirim)" : " (sudah diikuti)") : ""));
            rec(account, "follow", it.link, "sukses", resp.already ? (resp.pending ? "permintaan sudah terkirim" : "sudah diikuti") : "");
            await trackFollowResult(true);
            if (opts.screenshot) { await sleep(500); await captureProof(h, account, "follow", it.i + 1, it.link, ""); }
          } else if (resp && resp.skipped) {
            skip++; bumpProg("skip", lab); lg(account, "  DILEWATI follow: " + (resp.error || "tombol Follow tidak ada"));
            rec(account, "follow", it.link, "dilewati", resp.error || "tombol Follow tidak ada");
          } else {
            const err = (resp && resp.error) || "tidak ada respons";
            fail++; bumpProg("fail", lab); lg(account, "  GAGAL follow: " + err); rec(account, "follow", it.link, "gagal", err);
            if (onLoginPage(h)) opts.dead = true;
            await captureProof(h, account, "follow", it.i + 1, it.link, "_FAIL");
            if (!opts.dead) await trackFollowResult(false, !!(resp && resp.blocked));
          }
        } catch (e) { if (userStopped()) break; fail++; bumpProg("fail", lab); lg(account, "  GAGAL follow: " + e.message); rec(account, "follow", it.link, "gagal", e.message); await trackFollowResult(false); }
        if (opts.dead) { lg(account, "  sesi akun keluar (diarahkan ke halaman login) -> sisa link akun ini dihentikan"); queue.length = 0; break; }
        if (queue.length > 0 && !jobState.stopped) await sleep(jit(delayPost * 1000));
      }
    };
    await Promise.all(pool.map(worker));
    return { ok, fail, skip };
  }

  async function detectSession(h, platform) {
    await ensureContent(h);
    try { await sendToContent(h, { action: "DISMISS_POPUPS" }, 1, 300); } catch (e) {}
    const cookieOk = await prof.hasSessionCookie(h.ses, platform);
    let loggedIn = false, onLogin = false, loginBtn = false;
    const tries = platform === "tiktok" ? 28 : 14, poll = jobState && jobState.fast ? 250 : 500;
    for (let t = 0; t < tries && !loggedIn; t++) {
      try {
        const c = await sendToContent(h, { action: "CHECK_LOGGED_IN" }, 1, 300);
        if (gateFatal(c)) return false;
        loginBtn = !!(c && c.reason === "login-button");
        if (c && c.loggedIn) loggedIn = true;
        else if (c && c.reason === "di halaman login") { onLogin = true; break; }
      } catch (e) {}
      if (!loggedIn) await sleep(poll);
    }
    if (!loggedIn && cookieOk && !onLogin && !loginBtn) loggedIn = true;
    return loggedIn;
  }

  // ===================== task & riwayat =====================
  const getTasks = () => S.get(["tasks"]).tasks || [];
  function setTaskResult(taskId, result, resume) {
    const tasks = getTasks(), t = tasks.find((x) => x.id === taskId);
    if (t) { t.lastResult = result; if (resume !== undefined) t.resume = resume; S.set({ tasks }); }
  }
  function pushHistory(entry) {
    const h = S.get(["history"]).history || [];
    h.unshift(entry);
    if (h.length > 100) h.length = 100;
    for (let i = HISTORY_RESULTS_KEEP; i < h.length; i++) if (h[i].results) delete h[i].results;
    S.set({ history: h });
  }
  function finishTaskRecord(task, ok, text, extra) {
    const at = Date.now(); extra = extra || {};
    setTaskResult(task.id, { ok, text, at }, extra.resume);
    const entry = { id: String(at), taskId: task.id, name: task.name, platform: task.platform || null, ok, text, at };
    if (extra.results && extra.results.length) entry.results = extra.results;
    pushHistory(entry);
  }

  let stopWatchdog = null;
  async function stopJobNow() {
    if (!jobState) { S.set({ is_running: false, running_task: null, stopping: false }); W.closeAll(); return; }
    if (!jobState.userStop) { jobState.stopped = true; jobState.userStop = true; sendProgress("Stop ditekan. Menghentikan task dan menutup jendela akun..."); }
    S.set({ stopping: true });
    wakeStopWaiters();
    closeJobWindows();
    if (!stopWatchdog) {
      stopWatchdog = setTimeout(() => {
        stopWatchdog = null;
        if (jobState && jobState.userStop) { sendProgress("Alur masih menyelesaikan langkah terakhir; jendela sudah ditutup."); S.set({ is_running: false, running_task: null, stopping: false }); closeJobWindows(); }
      }, 8000);
    }
  }
  const jobHandles = new Set();
  function closeJobWindows() { Array.from(jobHandles).forEach((h) => { W.closeHandle(h); jobHandles.delete(h); }); }

  let licWatcher = null;
  function jobEnd(type, text) {
    if (stopWatchdog) { clearTimeout(stopWatchdog); stopWatchdog = null; }
    S.set({ is_running: false, running_task: null, stopping: false });
    S.remove(["job_progress"]);
    appendLog(stamp() + (type === "error" ? "Error: " : "Selesai. ") + text);
    if (licWatcher) { clearInterval(licWatcher); licWatcher = null; }
    closeJobWindows();
    onJobChange(type, text);
  }

  async function runTask(taskId, isTest, mode) {
    if (jobState && jobState.userStop) { for (let i = 0; i < 50 && jobState; i++) await new Promise((r) => setTimeout(r, 100)); }
    if (jobState) { sendProgress("Masih ada task berjalan. Tunggu selesai atau tekan Stop."); return { ok: false, error: "busy" }; }
    const task = getTasks().find((t) => t.id === taskId);
    if (!task) return { ok: false, error: "Task tidak ditemukan." };
    const l = await lic.verifyLicenseOnce();
    if (!l.ok) { finishTaskRecord(task, false, "Dilewati: " + l.error); jobEnd("error", "Licence: " + l.error); return { ok: false, error: l.error }; }
    const picked = (S.get(["saved_accounts"]).saved_accounts || []).filter((a) => a.enabled !== false && (task.accounts || []).indexOf(accKey(a)) >= 0);
    if (picked.length === 0) { const m = "Task '" + task.name + "': pilih minimal 1 akun."; sendProgress(m); finishTaskRecord(task, false, m); return { ok: false, error: m }; }
    const dead = picked.filter((a) => !!a.needsLogin), accounts = picked.filter((a) => !a.needsLogin);
    if (accounts.length === 0) { const m = "Task '" + task.name + "': semua akun terpilih (" + dead.length + ") berstatus Perlu login ulang. Buka akunnya di tab Akun, login, lalu coba lagi."; sendProgress(m); finishTaskRecord(task, false, m); return { ok: false, error: m }; }
    const skipDone = mode === "failed" && task.resume && Array.isArray(task.resume.doneKeys) ? new Set(task.resume.doneKeys) : null;
    S.set({ is_running: true, running_task: task.id, job_log: [] });
    startJob(task, accounts, { dead, skipDone }).catch((e) => { jobEnd("error", "Fatal: " + e.message); jobState = null; });
    return { ok: true };
  }

  async function processAccount(acc0, slot, ctx) {
    const task = ctx.task, pf = acc0.platform || "instagram", cfg = PLATFORMS[pf];
    const acc = Object.assign({}, acc0, { __tag: ctx.multi ? "[" + acc0.label + "] " : "" });
    const n = ++jobState.started;
    pushProgress("");
    lg(acc, "\n=== Akun " + n + "/" + ctx.total + ": " + acc.label + " (" + cfg.name + (acc.username ? " @" + acc.username : "") + ") ===");
    const pick = (key, flag, kind) => taskPart(task, key, flag).map(normUrl).filter((u) => platformOfUrl(u) === pf && !(ctx.skipDone && ctx.skipDone.has(itemKey(acc, kind, u))));
    const urls = pick("urls", "comment", "komentar"), links = pick("commentLinks", "likeComment", "like komentar"), profiles = pick("profileLinks", "followProfile", "follow");
    if (urls.length === 0 && links.length === 0 && profiles.length === 0) { lg(acc, ctx.skipDone ? "Semua item akun ini sudah sukses di run sebelumnya. Lewati akun." : "Tidak ada URL " + cfg.name + " di task ini. Lewati akun."); return; }
    urls.forEach((u) => ctx.planned.add(itemKey(acc, "komentar", u)));
    links.forEach((u) => ctx.planned.add(itemKey(acc, "like komentar", u)));
    profiles.forEach((u) => ctx.planned.add(itemKey(acc, "follow", u)));
    if (urls.length > 0 && ctx.comments.length === 0) { lg(acc, "Draft komentar kosong. Lewati akun."); jobState.totalFail++; return; }

    // 1) profil akun: proxy di sesinya sendiri. Gagal = akun dilewati supaya tidak memakai IP asli.
    let applied = null;
    try {
      applied = await prof.applyForAccount(acc0, pf);
      if (applied.applied) lg(acc, "  proxy akun aktif (sesi " + applied.sessionId + ")");
    } catch (e) { if (userStopped()) return; lg(acc, "Proxy akun gagal dipasang: " + e.message + ". Akun dilewati supaya tidak memakai IP asli."); jobState.totalFail++; return; }
    const ses = applied.ses;
    // 2) identitas (User-Agent + zona waktu)
    let ident = null;
    try { ident = await prof.identityPrepare(acc0, pf, !!applied.applied, ses); if (ident) lg(acc, "  identitas: " + ident.profileName + " · zona waktu " + (ident.timezone || "bawaan komputer")); } catch (e) { lg(acc, "  identitas tidak bisa disiapkan: " + e.message); }
    // 3) cookie hasil impor dari ekstensi dipulihkan sekali ke profil akun ini
    try { const r = await prof.ensureCookies(acc0, ses, pf); if (r.restored) lg(acc, "  cookie diimpor ke profil akun: " + r.restored); } catch (e) {}

    let nTabs = (pf === "instagram" && (urls.length > 0 || links.length > 0)) ? Math.max(1, Math.min(6, parseInt(task.concurrency || 1, 10))) : 1;
    if (nTabs > 1) {
      const plan = screenPlan(nTabs);
      if (plan.n < nTabs) { if (!jobState.screenNoted) { jobState.screenNoted = true; lg(acc, "Layar " + plan.area.width + "x" + plan.area.height + " (profil " + PROFILE_NAME[plan.profile] + "): Tab per akun diturunkan dari " + nTabs + " ke " + plan.n + "."); } nTabs = plan.n; }
    }
    const pool = [];
    try {
      const cell = W.cellBounds(slot, ctx.slots, W.getWorkArea());
      for (let i = 0; i < nTabs; i++) {
        if (userStopped()) throw new Error("dihentikan");
        const h = await W.openHandle({ ses, acc: acc0, bounds: W.tileBounds(cell, i, nTabs), preloadPath, identity: ident });
        pool.push(h); jobHandles.add(h);
      }
    } catch (e) { if (userStopped()) { pool.forEach((h) => { W.closeHandle(h); jobHandles.delete(h); }); return; } lg(acc, "Gagal membuat jendela: " + e.message); jobState.totalFail++; pool.forEach((h) => { W.closeHandle(h); jobHandles.delete(h); }); return; }

    const fast = !!jobState.fast;
    let aOk = 0, aFail = 0;
    try {
      const first = urls[0] || links[0] || profiles[0];
      await gotoUrl(pool[0], first, fast);
      const pre = { tab: pool[0].id, url: first, ok: true };
      let ok = await detectSession(pool[0], pf);
      if (!ok && !jobState.stopped) { pre.ok = false; await gotoUrl(pool[0], cfg.home, false); ok = await detectSession(pool[0], pf); }
      if (!ok && !jobState.stopped && pf === "tiktok" && acc0.cookies && acc0.cookies.length) {
        for (let attempt = 1; attempt <= 2 && !ok && !jobState.stopped; attempt++) {
          lg(acc, attempt === 1 ? "  sesi ditolak, pulihkan cookie ulang & coba lagi..." : "  masih ditolak, bersihkan data situs TikTok lalu pulihkan cookie...");
          try {
            if (attempt === 2) await wipeTikTokStorage(ses);
            await prof.wipeCookies(ses, pf); await sleep(600); await prof.restoreCookies(ses, acc0.cookies);
            await gotoUrl(pool[0], first, false); ok = await detectSession(pool[0], pf);
            if (ok) lg(acc, "  sesi pulih pada percobaan ke-" + (attempt + 1));
          } catch (e) {}
        }
      }
      let blocked = "";
      if (ok && !jobState.stopped) { blocked = blockedReason(pool[0]); if (blocked) ok = false; }
      if (!ok) {
        if (jobState.stopped) return;
        let where = ""; try { where = " | halaman: " + String(pool[0].wc.getURL()).slice(0, 80); } catch (e) {}
        if (blocked) lg(acc, "Akun tidak bisa dipakai: " + blocked + where + ". Semua item akun ini dilewati. Selesaikan di aplikasi/situsnya lewat tab Akun → Buka, lalu login ulang.");
        else lg(acc, "Login gagal (sesi kedaluwarsa / ditolak)" + where + ". Buka akun ini di tab Akun, login ulang.");
        jobState.totalFail++;
        markNeedsLogin(acc0, blocked ? blocked + where : "login gagal" + where);
        lg(acc, "Akun ditandai \"Perlu login ulang\": dilewati di task berikutnya sampai login ulang.");
        const why = blocked ? blocked + " — perlu dicek manual" : "login gagal — perlu login ulang";
        urls.forEach((u) => rec(acc, "komentar", u, "gagal", why));
        links.forEach((u) => rec(acc, "like komentar", u, "gagal", why));
        profiles.forEach((u) => rec(acc, "follow", u, "gagal", why));
      } else {
        lg(acc, "Sesi aktif untuk " + acc.label + ".");
        const base = { fast, screenshot: jobState.screenshot, pre };
        const popts = { autoLike: task.autoLike !== false, autoRepost: !!task.autoRepost, autoFollow: !!task.autoFollow, fast, screenshot: jobState.screenshot, skipUsed: task.skipUsed !== false, reserved: ctx.reserved, pre, verify: !!jobState.verify };
        const dead = () => !!(popts.dead || base.dead);
        if (urls.length) { const r = await processPostsForAccount(pool, acc, ctx.comments, urls, ctx.delayPost, popts, ctx.used); jobState.totalSuccess += r.ok; jobState.totalFail += r.fail; aOk += r.ok; aFail += r.fail; }
        if (links.length && !jobState.stopped && !dead()) { await sleep(jit(ctx.delayPost * 1000)); const r2 = await processCommentLikes(pool, acc, links, ctx.delayPost, base); jobState.totalSuccess += r2.ok; jobState.totalFail += r2.fail; jobState.totalSkip = (jobState.totalSkip || 0) + (r2.skip || 0); aOk += r2.ok; aFail += r2.fail; }
        if (profiles.length && !jobState.stopped && !dead()) { await sleep(jit(ctx.delayPost * 1000)); const r3 = await processFollows(pool, acc, profiles, ctx.delayPost, base); jobState.totalSuccess += r3.ok; jobState.totalFail += r3.fail; jobState.totalSkip = (jobState.totalSkip || 0) + (r3.skip || 0); aOk += r3.ok; aFail += r3.fail; }
        if (dead() && !userStopped()) { const why = blockedReason(pool[0]) || "sesi keluar di tengah task"; markNeedsLogin(acc0, why); lg(acc, "Akun ditandai \"Perlu login ulang\" (" + why + ")."); }
      }
    } catch (e) { if (!userStopped()) { lg(acc, "Error akun " + acc.label + ": " + e.message); jobState.totalFail++; } }
    finally { pool.forEach((h) => { W.closeHandle(h); jobHandles.delete(h); }); }
  }

  // Target tercapai: task hanya berisi komentar, "skip komentar terpakai" aktif, dan semua draft sudah terkirim
  // (minimal 1 sukses di run ini) -> akun yang tersisa tidak perlu dipakai lagi.
  function goalReached(ctx) {
    if (!jobState) return false;
    if (jobState.goalReached) return true;
    const t = ctx.task;
    if (t.skipUsed === false || !ctx.comments.length || !(jobState.totalSuccess > 0)) return false;
    if (!taskPart(t, "urls", "comment").length) return false;
    if (taskPart(t, "commentLinks", "likeComment").length || taskPart(t, "profileLinks", "followProfile").length) return false;
    if (ctx.comments.some((c) => !ctx.used[c])) return false;
    jobState.goalReached = true;
    return true;
  }
  function skipRestAfterGoal(queue, ctx) {
    if (!queue.length) return;
    if (!jobState.goalNoted) { jobState.goalNoted = true; sendProgress("Target tercapai: semua " + ctx.comments.length + " draft komentar sudah terkirim. Akun yang tersisa tidak dipakai."); }
    while (queue.length) {
      const a = queue.shift(), pf = a.platform || "instagram";
      sendProgress("Dilewati " + a.label + (a.username ? " @" + a.username : "") + ": target komentar sudah tercapai.");
      jobState.totalSkip++;
      taskPart(ctx.task, "urls", "comment").map(normUrl).filter((u) => platformOfUrl(u) === pf).forEach((u) => rec(a, "komentar", u, "dilewati", "target komentar tercapai (draft habis)"));
    }
  }

  // pekerja paralel: tiap pekerja mengambil akun berikutnya dari antrean bersama dan memakai "slot" layarnya sendiri
  async function runWorker(slot, queue, ctx) {
    try {
      while (queue.length > 0 && !jobState.stopped) {
        if (goalReached(ctx)) { skipRestAfterGoal(queue, ctx); break; }
        if (ctx.task.skipUsed !== false && ctx.comments.length) {
          const freeNow = () => ctx.comments.some((c) => !ctx.used[c] && !ctx.reserved.has(c));
          for (let w = 0; w < 240 && ctx.reserved.size > 0 && !freeNow() && !jobState.stopped && !goalReached(ctx); w++) await sleep(500);
          if (goalReached(ctx)) { skipRestAfterGoal(queue, ctx); break; }
        }
        const acc = queue.shift();
        if (!acc) break;
        await processAccount(acc, slot, ctx);
        if (goalReached(ctx)) { skipRestAfterGoal(queue, ctx); break; }
        if (queue.length > 0 && !jobState.stopped && ctx.delayAcc > 0) {
          const d = jit(ctx.delayAcc * 1000);
          if (!ctx.multi) sendProgress("Jeda " + Math.round(d / 100) / 10 + " detik...");
          await sleep(d);
        }
      }
    } catch (e) { if (!userStopped()) sendProgress("Pekerja " + (slot + 1) + " error: " + e.message); }
  }

  async function startJob(task, accounts, extra) {
    extra = extra || {};
    const fast = !!task.fast;
    jobState = { task, stopped: false, totalSuccess: 0, totalFail: 0, totalSkip: 0, hidden: 0, results: [], doneKeys: new Set(), verify: S.get(["verify_comments"]).verify_comments === true, startedAt: Date.now(), screenshot: !!task.screenshot, fast, started: 0, accTotal: accounts.length, live: { ok: 0, skip: 0, fail: 0 }, sessionStamp: new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) };
    const parallel = Math.max(1, Math.min(10, parseInt(task.parallel || 1, 10) || 1, accounts.length));
    sendProgress("Task: " + task.name + " (" + accounts.length + " akun" + (parallel > 1 ? ", " + parallel + " bersamaan" : "") + ")" + (fast ? " · mode cepat" : "") + (jobState.verify ? " · verifikasi komentar" : "") + (extra.skipDone ? " · ulangi yang gagal saja" : ""));
    if (extra.skipDone) sendProgress("Mode \"Ulangi yang gagal saja\": " + extra.skipDone.size + " item yang sudah sukses di run sebelumnya dilewati.");
    const planned = new Set();
    (extra.dead || []).forEach((a) => {
      sendProgress("DILEWATI akun " + a.label + (a.username ? " @" + a.username : "") + ": Perlu login ulang (" + (a.needsLoginReason || "sesi ditolak") + ").");
      jobState.totalSkip++;
      const pf = a.platform || "instagram";
      [["urls", "comment", "komentar"], ["commentLinks", "likeComment", "like komentar"], ["profileLinks", "followProfile", "follow"]].forEach((d) => {
        taskPart(task, d[0], d[1]).map(normUrl).filter((u) => platformOfUrl(u) === pf && !(extra.skipDone && extra.skipDone.has(itemKey(a, d[2], u)))).forEach((u) => { planned.add(itemKey(a, d[2], u)); rec(a, d[2], u, "dilewati", "perlu login ulang", true); });
      });
    });
    if (licWatcher) clearInterval(licWatcher);
    licWatcher = setInterval(async () => {
      try { const v = await lic.verifyLicenseOnce(); if (!v.ok && jobState) { jobState.stopped = true; sendProgress("Licence: " + v.error + " Task dihentikan."); } } catch (e) {}
    }, 30000);

    const used = S.get(["used_comments"]).used_comments || {};
    const comments = task.comments || [];
    let delayPost = task.delayPost == null || isNaN(Number(task.delayPost)) ? 2 : Math.max(0, Number(task.delayPost));
    let delayAcc = task.delayAccount == null || isNaN(Number(task.delayAccount)) ? 3 : Math.max(0, Number(task.delayAccount));
    if (fast) { delayPost = Math.min(delayPost, 1); delayAcc = Math.min(delayAcc, 1); }
    if (task.skipUsed !== false && comments.length) {
      const need = accounts.reduce((n, a) => { const pf = a.platform || "instagram"; return n + taskPart(task, "urls", "comment").map(normUrl).filter((u) => platformOfUrl(u) === pf).length; }, 0);
      const free = comments.filter((c) => !used[c]).length;
      if (free < need) sendProgress("PERINGATAN: " + need + " komentar akan dikirim tapi hanya " + free + " draft yang belum terpakai. Akun/post sisanya akan dilewati. Tambah draft, atau matikan \"Skip komentar yang sudah dipakai\" di task, atau reset di menu Lanjutan.");
    }
    const ctx = { task, used, comments, delayPost, delayAcc, total: accounts.length, reserved: new Set(), multi: parallel > 1, slots: parallel, skipDone: extra.skipDone || null, planned };
    const queue = accounts.slice();
    await Promise.all(Array.from({ length: parallel }, (_, i) => runWorker(i, queue, ctx)));

    const secs = Math.round((Date.now() - jobState.startedAt) / 1000);
    const text = "Sukses " + jobState.totalSuccess + ", gagal " + jobState.totalFail + (jobState.totalSkip ? ", dilewati " + jobState.totalSkip : "") + (jobState.hidden ? ", tidak tampil " + jobState.hidden : "") + " (" + Math.floor(secs / 60) + "m " + (secs % 60) + "s)" + (jobState.userStop ? " — dihentikan pengguna" : (jobState.stopped ? " — dihentikan" : "")) + (jobState.goalReached && !jobState.userStop ? " — target tercapai: semua " + comments.length + " draft komentar terkirim" : "");
    const goal = !!jobState.goalReached && !jobState.userStop && !jobState.stopped;
    // target tercapai = berhasil, walau ada akun yang gagal sebelumnya (kuota komentar sudah dipenuhi akun lain)
    const ok = goal ? true : (jobState.totalFail === 0 && (jobState.totalSuccess > 0 || (jobState.totalSkip || 0) > 0));
    const t = jobState.task, okN = jobState.totalSuccess, failN = jobState.totalFail;
    const done = new Set(Array.from(extra.skipDone || []).concat(Array.from(jobState.doneKeys)));
    const remaining = Array.from(planned).filter((k) => !done.has(k)).length;
    const resume = remaining > 0 && !goal ? { at: Date.now(), remaining, doneKeys: Array.from(done).slice(-5000) } : null;
    const results = jobState.results;
    jobState = null;
    finishTaskRecord(t, ok, text, { results, resume });
    if (resume) appendLog(stamp() + "Sisa " + remaining + " item gagal / belum diproses. Pakai \"Ulangi yang gagal saja\" untuk melanjutkan.");
    jobEnd("done", text);
    await autoReport(t, okN, failN);
  }

  // ===================== laporan error ke owner =====================
  const REPORT_ERR_RE = /GAGAL|Login gagal|Error akun|Fatal|dihentikan otomatis|Task dihentikan/;
  function errorsFromLog(lines) {
    const out = []; let who = "", ctx = "";
    for (const raw of lines) {
      const l = String(raw);
      const mh = l.match(/=== Akun \d+\/\d+: (.*) ===/); if (mh) { who = mh[1]; ctx = ""; continue; }
      const mu = l.match(/\[(?:Like komentar |Follow )?\d+\/\d+\]\s+(https?:\/\/\S+)/); if (mu) { ctx = mu[1]; continue; }
      if (REPORT_ERR_RE.test(l)) out.push({ who, ctx, msg: l.replace(/"[^"]{0,120}"/g, "\"…\"").trim() });
      if (out.length >= 60) break;
    }
    return out;
  }
  function platformsFromLog(lines) { const set = {}; lines.forEach((l) => { const m = String(l).match(/\(([^()@]+?)(?: @[^()]*)?\) ===/); if (m) set[m[1].trim()] = 1; }); return Object.keys(set).join(","); }
  async function autoReport(task, okN, failN) {
    try {
      if (!failN) return;
      const s = S.get(["report_auto", "job_log"]);
      if (s.report_auto === false) return;
      const log = s.job_log || [], errs = errorsFromLog(log);
      if (!errs.length) return;
      const r = await lic.sendReport({ kind: "auto", task: (task && task.name) || "", pf: platformsFromLog(log), ok: okN, fail: failN, errors: errs });
      if (r && r.ok) sendProgress("(ringkasan error dikirim ke owner)");
    } catch (e) {}
  }
  async function sendManualReport() {
    const s = S.get(["job_log", "history"]), log = s.job_log || [];
    if (!log.length) return { ok: false, error: "Log kosong, tidak ada yang dikirim." };
    let okN = 0, failN = 0;
    for (let i = log.length - 1; i >= 0; i--) { const m = String(log[i]).match(/Sukses (\d+), gagal (\d+)/); if (m) { okN = +m[1]; failN = +m[2]; break; } }
    const last = (s.history || [])[0];
    return lic.sendReport({ kind: "manual", task: (last && last.name) || "", pf: platformsFromLog(log), ok: okN, fail: failN, errors: errorsFromLog(log), tail: log.slice(-150).map(String) });
  }

  return {
    runTask, stopJobNow, sendManualReport, appendLog, stamp,
    isRunning: () => !!jobState,
    setOnJobChange: (f) => { onJobChange = f; },
    resetStaleState: () => { S.set({ is_running: false, running_task: null, stopping: false }); S.remove(["job_progress"]); }
  };
}
module.exports = { create };
