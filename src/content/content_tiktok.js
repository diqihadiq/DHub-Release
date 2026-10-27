// content_tiktok.js — adapter TikTok (data-e2e selector)
(function () {
  if (window.__ibTikTok) return; window.__ibTikTok = true;
  const IB = window.IB;
  console.log("[DHub][TikTok] loaded", location.pathname);

  function detectUsername() {
    try {
      const s = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
      if (s) {
        const j = JSON.parse(s.textContent);
        const u = j && j.__DEFAULT_SCOPE__ && j.__DEFAULT_SCOPE__["webapp.app-context"] && j.__DEFAULT_SCOPE__["webapp.app-context"].user;
        if (u && u.uniqueId) return u.uniqueId;
      }
    } catch (e) {}
    const p = document.querySelector(IB.S("tiktok.detectUsername.nav-profile"));
    if (p) {
      const a = p.closest(IB.S("tiktok.detectUsername.a")) || p;
      const m = (a.getAttribute("href") || "").match(/\/@([^\/?#]+)/);
      if (m) return m[1];
    }
    return null;
  }
  function checkLoggedIn() {
    if (/\/login/.test(location.pathname)) return { loggedIn: false, reason: "di halaman login" };
    if (document.querySelector(IB.S("tiktok.checkLoggedIn.profile-icon"))) return { loggedIn: true };
    if (document.querySelector(IB.S("tiktok.checkLoggedIn.top-login-button"))) return { loggedIn: false, reason: "login-button" };
    return { loggedIn: false, reason: "indikator login tidak ditemukan" };
  }
  async function dismissPopups() {
    for (let i = 0; i < 5; i++) {
      let hit = IB.clickByText(IB.R("tiktok.dismissPopups.not"));
      if (!hit) { const x = document.querySelector(IB.S("tiktok.dismissPopups.modal-close-inner-butt")); if (x && IB.visible(x)) { x.click(); hit = true; } }
      if (!hit) break;
      await IB.sleep(450);
    }
  }

  // captcha: tidak dilewati otomatis. Ekstensi berhenti dan menunggu kamu menyelesaikannya manual di tab, lalu lanjut.
  function hasCaptcha() {
    const sel = IB.S("tiktok.hasCaptcha.captcha");
    for (const n of document.querySelectorAll(sel)) { if (IB.visible(n)) return true; }
    return false;
  }
  async function waitCaptchaCleared(maxMs) {
    if (!hasCaptcha()) return true;
    IB.bg({ action: "LOG", message: "  TikTok minta captcha. Selesaikan manual di tab TikTok (tunggu maks " + Math.round((maxMs || 180000) / 1000) + " dtk), lanjut otomatis setelah selesai." });
    const t0 = Date.now();
    while (Date.now() - t0 < (maxMs || 180000)) {
      await IB.sleep(1000);
      if (!hasCaptcha()) { await IB.sleep(1500); if (!hasCaptcha()) { IB.bg({ action: "LOG", message: "  Captcha selesai, melanjutkan." }); return true; } }
    }
    return false;
  }

  function likeButton() {
    const i = document.querySelector(IB.S("tiktok.likeButton.like-icon"));
    if (!i) return null;
    return i.closest(IB.S("tiktok.likeButton.button")) || i;
  }
  async function like() {
    const b = likeButton();
    if (!b) return { liked: false, error: "tombol like tidak ditemukan" };
    if (b.getAttribute("aria-pressed") === "true") return { liked: true, already: true };
    await IB.click(b);
    await IB.sleep(500);
    return { liked: true };
  }

  function findEditor() {
    const wrap = document.querySelector(IB.S("tiktok.findEditor.comment-input"));
    if (wrap) {
      const ed = wrap.querySelector(IB.S("tiktok.findEditor.true")) || wrap.querySelector(IB.S("tiktok.findEditor.textarea"));
      if (ed) return ed;
    }
    const eds = document.querySelectorAll(IB.S("tiktok.findEditor.true-2"));
    for (const e of eds) if (IB.visible(e) && !e.closest(IB.S("tiktok.findEditor.search"))) return e;
    return null;
  }

  const isFollowLbl = function (t) { return IB.R("tiktok.isFollowLbl.follow").test(t || ""); };
  function followButton() {
    const sel = IB.S("tiktok.followButton.browse-follow");
    const e = document.querySelector(sel);
    if (e) return e.closest(IB.S("tiktok.followButton.button")) || e;
    for (const n of document.querySelectorAll(IB.S("tiktok.followButton.button-2"))) {
      if ((isFollowLbl(IB.norm(n.textContent)) || isFollowLbl(n.getAttribute("aria-label"))) && IB.visible(n)) return n;
    }
    return null;
  }
  async function follow() {
    const b = followButton();
    if (!b) return { followed: false, skipped: true, error: "tombol follow tidak ada (mungkin sudah diikuti)" };
    const t = IB.norm(b.textContent), al = b.getAttribute("aria-label") || "";
    if (!isFollowLbl(t) && !isFollowLbl(al)) return { followed: true, already: true }; // "Following"/"Friends"/tanpa label follow -> jangan diklik (bisa unfollow)
    await IB.click(b);
    await IB.sleep(800);
    return { followed: true };
  }

  async function comment(text) {
    let ed = findEditor();
    for (let k = 0; k < 3 && !ed; k++) {
      const ci = document.querySelector(IB.S("tiktok.comment.comment-icon"));
      if (ci) await IB.click(ci.closest(IB.S("tiktok.comment.button")) || ci);
      ed = await IB.waitFor(findEditor, 3500, 250);
    }
    if (!ed) {
      if (document.querySelector(IB.S("tiktok.comment.top-login-button"))) throw new Error("TikTok meminta login ulang (cookie akun ditolak). Simpan ulang cookies akun ini.");
      throw new Error("Kotak komentar TikTok tidak ditemukan (pastikan komentar tidak dimatikan)");
    }
    await IB.click(ed);
    await IB.sleep(150 + Math.floor(Math.random() * 200));
    const typed = await IB.typeInto(ed, text, { trustedFirst: true });
    if (!typed) throw new Error("Gagal mengetik komentar TikTok | insert: " + (IB.lastErr || "-"));
    await IB.sleep(200 + Math.floor(Math.random() * 300)); // jitter kecil sebelum kirim
    const isSent = function () { return !ed.isConnected || IB.norm(IB.getText(ed)) === ""; };
    const findBtn = function () {
      return document.querySelector(IB.S("tiktok.comment.findBtn.comment-post")) ||
        Array.from(document.querySelectorAll(IB.S("tiktok.comment.findBtn.button"))).find(function (n) { return IB.R("tiktok.comment.findBtn.post").test(IB.norm(n.textContent)) && IB.visible(n); }) || null;
    };
    const waitBtn = async function (ms) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const b = findBtn();
        if (b && IB.visible(b) && IB.isEnabled(b)) return b;
        await IB.sleep(100);
      }
      return null;
    };
    // kirim bertingkat: klik asli (debugger) -> klik biasa -> Enter asli. Berhenti begitu terkirim (cegah dobel).
    const steps = [
      async function () { const b = await waitBtn(5000); if (b) await IB.trustedClick(b); },
      async function () { const b = findBtn(); if (b) await IB.click(b); },
      async function () { await IB.pressEnter(ed); }
    ];
    let sent = false;
    for (let s = 0; s < steps.length && !sent; s++) {
      try { await steps[s](); } catch (e) {}
      sent = await IB.waitFor(function () { return isSent() || hasCaptcha(); }, s === 0 ? 3000 : 2500, 100);
      if (hasCaptcha()) {
        // captcha tidak dilewati: tunggu kamu selesaikan manual, lalu cek ulang / kirim lagi
        if (!(await waitCaptchaCleared(180000))) throw new Error("Captcha TikTok tidak diselesaikan dalam 3 menit");
        sent = isSent();
        if (!sent) { const b = await waitBtn(3000); if (b) await IB.trustedClick(b); sent = await IB.waitFor(isSent, 5000, 150); }
      } else if (!sent && !findBtn() && !ed.isConnected) { sent = true; }
    }
    if (!sent) throw new Error("Komentar TikTok tidak terkirim (tombol kirim nonaktif / verifikasi captcha) | " + (IB.lastErr || "-"));
    const rendered = await IB.waitRendered(text, 3000);
    return { ok: true, rendered: rendered };
  }

  async function processPost(data) {
    const ready = await IB.waitFor(function () { return document.querySelector(IB.S("tiktok.processPost.browse-video")); }, 25000, 250);
    if (!ready) return { ok: false, error: "halaman video tidak termuat" };
    await IB.nap(600);
    await waitCaptchaCleared(180000);
    // URL saja tidak cukup: TikTok bisa mempertahankan URL target tapi menampilkan video FYP. Cek juga isi halaman:
    // halaman post target harus memuat link ke profil pembuat post (/@handle). Video FYP milik akun lain tidak punya.
    const offTarget = function () {
      if (data.expectId && location.href.indexOf(data.expectId) < 0) return true;
      if (data.expectHandle) {
        const h = ("/@" + data.expectHandle).toLowerCase();
        const ok = Array.from(document.querySelectorAll('a[href*="/@"]')).some(function (a) { return String(a.getAttribute("href") || "").toLowerCase().indexOf(h) >= 0; });
        if (!ok) return true;
      }
      return false;
    };
    if (offTarget()) return { ok: false, error: "Halaman TikTok bukan post target (dialihkan ke video lain), komentar dibatalkan agar tidak salah posting" };
    let liked = false, followed = false;
    if (data.autoLike) { try { liked = !!(await like()).liked; } catch (e) {} }
    await IB.nap(120);
    if (data.autoFollow) { try { followed = !!(await follow()).followed; } catch (e) {} }
    await IB.nap(120);
    if (offTarget()) return { ok: false, liked: liked, followed: followed, error: "Halaman TikTok bukan post target (dialihkan ke video lain), komentar dibatalkan agar tidak salah posting" };
    try {
      const r = await comment(data.comment);
      return { ok: !!r.ok, liked: liked, followed: followed, rendered: r.rendered };
    } catch (e) {
      return { ok: false, liked: liked, followed: followed, error: (e && e.message) || String(e) };
    }
  }

  async function likeComment(id) {
    if (!id) return { ok: false, error: "comment id kosong" };
    await IB.waitFor(function () { return document.querySelector(IB.S("tiktok.likeComment.main")); }, 20000, 250);
    await IB.sleep(1200);
    const ci = document.querySelector(IB.S("tiktok.likeComment.comment-icon"));
    if (ci && !document.querySelector(IB.S("tiktok.likeComment.comment-level-1"))) { await IB.click(ci.closest(IB.S("tiktok.likeComment.button")) || ci); await IB.sleep(1200); }
    let item = null;
    for (let i = 0; i < 8 && !item; i++) {
      item = document.querySelector(IB.S("tiktok.likeComment.x", { id: id }));
      if (item) break;
      const list = document.querySelector(IB.S("tiktok.likeComment.divcommentlistcontaine"));
      if (list) list.scrollTop += 600;
      await IB.sleep(500);
    }
    if (!item) return { ok: false, error: "komentar tidak ditemukan (TikTok tidak menaruh ID komentar di DOM; coba link komentar terbaru)" };
    const cont = item.closest(IB.S("tiktok.likeComment.comment-level")) || item.parentElement;
    const heart = cont && cont.querySelector(IB.S("tiktok.likeComment.comment-like-icon"));
    if (!heart) return { ok: false, error: "ikon like komentar tidak ditemukan" };
    await IB.click(heart.closest(IB.S("tiktok.likeComment.button-2")) || heart);
    return { ok: true };
  }

  // halaman profil: ikuti akun
  async function followProfile() {
    const ready = await IB.waitFor(function () { return document.querySelector(IB.S("tiktok.followProfile.follow-button")); }, 25000, 250);
    if (!ready) return { ok: false, error: "halaman profil TikTok tidak termuat" };
    await IB.sleep(1200);
    const get = function () { return document.querySelector(IB.S("tiktok.followProfile.get.follow-button")); };
    const b = get();
    if (!b) return { ok: false, error: "tombol Follow tidak ditemukan (akun sendiri / tidak ada)" };
    const re = IB.R("tiktok.followProfile.follow"), done = IB.R("tiktok.followProfile.following");
    const t = IB.norm(b.textContent);
    if (done.test(t)) return { ok: true, already: true };
    if (!re.test(t)) return { ok: false, error: "label tombol tidak dikenali: " + t.slice(0, 30) };
    await IB.click(b);
    const ok = await IB.waitFor(function () { const n = get(); return !n || done.test(IB.norm(n.textContent)); }, 6000, 300);
    return ok ? { ok: true } : { ok: false, error: "klik Follow tidak terkonfirmasi (mungkin diminta login/verifikasi)" };
  }

  IB.register({ platform: "tiktok", detectUsername: detectUsername, checkLoggedIn: checkLoggedIn, dismissPopups: dismissPopups, processPost: processPost, likeComment: likeComment, followProfile: followProfile });
})();
