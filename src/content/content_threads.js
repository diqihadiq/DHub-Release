// content_threads.js — adapter Threads (threads.com / threads.net). Selector dari pola ThreadsAutoComment (role=dialog, role=textbox).
(function () {
  if (window.__ibThreads) return; window.__ibThreads = true;
  const IB = window.IB;
  console.log("[DHub][Threads] loaded", location.pathname);

  function detectUsername() {
    const links = document.querySelectorAll(IB.S("threads.detectUsername.x"));
    for (const a of links) {
      const lab = (a.getAttribute("aria-label") || "").toLowerCase();
      const inNav = a.closest(IB.S("threads.detectUsername.nav")) || IB.R("threads.detectUsername.profile").test(lab);
      if (inNav) { const m = (a.getAttribute("href") || "").match(/^\/@([^\/?#]+)/); if (m) return m[1]; }
    }
    return null;
  }
  function checkLoggedIn() {
    if (/\/login/.test(location.pathname)) return { loggedIn: false, reason: "di halaman login" };
    if (document.querySelector(IB.S("threads.checkLoggedIn.login")) && !detectUsername()) return { loggedIn: false, reason: "di halaman login" };
    if (detectUsername() || document.querySelector(IB.S("threads.checkLoggedIn.home"))) return { loggedIn: true };
    return { loggedIn: false, reason: "indikator login tidak ditemukan" };
  }
  async function dismissPopups() {
    for (let i = 0; i < 4; i++) {
      if (!IB.clickByText(IB.R("threads.dismissPopups.not"))) break;
      await IB.sleep(300);
    }
  }

  // Threads versi baru tidak selalu memakai <main>; anggap siap jika ada main/role=main/kontainer post/ikon like
  function pageReady() {
    if (document.querySelector(IB.S("threads.pageReady.main"))) return true;
    if (btnBySvg(document, IB.L("threads.pageReady.like"))) return true;
    if (document.querySelector(IB.S("threads.pageReady.post"))) return true;
    // terakhir: halaman sudah punya isi teks yang cukup (UI baru Threads sering tanpa penanda di atas)
    const body = document.body;
    return !!(body && document.readyState !== "loading" && (body.innerText || "").length > 150 && !/\/login/.test(location.pathname));
  }
  function btnBySvg(scope, labels) {
    const svgs = scope.querySelectorAll(IB.S("threads.btnBySvg.svg"));
    for (const s of svgs) {
      const l = (s.getAttribute("aria-label") || "").toLowerCase();
      if (labels.indexOf(l) >= 0) return { svg: s, btn: s.closest(IB.S("threads.btnBySvg.button")) || s.parentElement };
    }
    return null;
  }
  // postingan utama = container pertama yang punya tombol Like/Reply
  function mainScope() {
    const main = document.querySelector(IB.S("threads.mainScope.main")) || document.body;
    const cont = main.querySelectorAll(IB.S("threads.mainScope.data-pressable-contain"));
    for (const c of cont) if (btnBySvg(c, IB.L("threads.mainScope.like"))) return c;
    return main;
  }

  async function like() {
    const sc = mainScope();
    const already = btnBySvg(sc, IB.L("threads.like.unlike"));
    if (already) return { liked: true, already: true };
    const f = btnBySvg(sc, IB.L("threads.like.like"));
    if (!f) return { liked: false, error: "tombol like tidak ditemukan" };
    await IB.click(f.btn);
    const ok = await IB.waitFor(function () { return btnBySvg(mainScope(), IB.L("threads.like.unlike")); }, 3000, 200);
    return { liked: !!ok };
  }

  
  async function repost() {
    const sc = mainScope();
    if (btnBySvg(sc, IB.L("threads.REPOSTED.reposted"))) return { reposted: true, already: true };
    const f = btnBySvg(sc, IB.L("threads.repost.repost"));
    if (!f) return { reposted: false, error: "tombol repost tidak ditemukan" };
    await IB.click(f.btn);
    const nodes = function () { return document.querySelectorAll(IB.S("threads.repost.nodes.menuitem")); };
    const item = await IB.waitFor(function () {
      for (const n of nodes()) {
        const t = IB.norm(n.textContent);
        if (t && t.length < 30 && IB.R("threads.repost.repost").test(t) && IB.visible(n) && !f.btn.contains(n)) return n;
      }
      return null;
    }, 3500, 200);
    if (!item) {
      // menu hanya menawarkan "Remove" -> sudah di-repost
      for (const n of nodes()) { const t = IB.norm(n.textContent); if (t && t.length < 30 && IB.R("threads.repost.remove").test(t) && IB.visible(n)) {
        try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (e) {}
        return { reposted: true, already: true };
      } }
      return { reposted: false, error: "menu repost tidak muncul" };
    }
    await IB.click(item.closest(IB.S("threads.repost.menuitem")) || item);
    const ok = await IB.waitFor(function () { return btnBySvg(mainScope(), IB.L("threads.REPOSTED.reposted")); }, 3500, 250);
    return { reposted: true, confirmed: !!ok };
  }

  async function follow() {
    const sc = mainScope();
    let el = null;
    for (const n of sc.querySelectorAll(IB.S("threads.follow.aria-label"))) { if (IB.R("threads.follow.follow").test(n.getAttribute("aria-label") || "") && IB.visible(n)) { el = n; break; } }
    if (!el) for (const n of sc.querySelectorAll(IB.S("threads.follow.button"))) { if (IB.R("threads.follow.follow").test(IB.norm(n.textContent)) && IB.visible(n)) { el = n; break; } }
    if (!el) return { followed: false, skipped: true, error: "tombol follow tidak ada (mungkin sudah diikuti)" };
    await IB.click(el.closest(IB.S("threads.follow.button")) || el);
    await IB.sleep(900);
    return { followed: true };
  }

  // pil "Reply to xxx..." di bawah postingan; klik untuk membuka kotak reply
  function findReplyPlaceholder() {
    const main = document.querySelector(IB.S("threads.findReplyPlaceholder.main")) || document.body;
    for (const n of main.querySelectorAll(IB.S("threads.findReplyPlaceholder.button"))) {
      if (n.children.length > 4) continue;
      const t = IB.norm(n.textContent);
      if (t && t.length < 90 && IB.R("threads.findReplyPlaceholder.reply").test(t) && IB.visible(n)) return n.closest(IB.S("threads.findReplyPlaceholder.button-2")) || n;
    }
    return null;
  }
  function debugUI() {
    const icons = Array.from(new Set(Array.from(document.querySelectorAll(IB.S("threads.debugUI.svg"))).map(function (x) { return x.getAttribute("aria-label"); }))).slice(0, 15);
    const eds = Array.from(document.querySelectorAll(IB.S("threads.debugUI.true"))).map(function (e) { return (e.getAttribute("role") || "?") + (IB.visible(e) ? "+" : "-"); });
    return "path=" + location.pathname + " dialog=" + document.querySelectorAll(IB.S("threads.debugUI.dialog")).length + " editable=[" + eds.join("|") + "] icons=[" + icons.join("|") + "]";
  }

  function findEditor() {
    const dialogs = document.querySelectorAll(IB.S("threads.findEditor.dialog"));
    for (const d of dialogs) {
      const ed = d.querySelector(IB.S("threads.findEditor.textbox"));
      if (ed && IB.visible(ed)) return ed;
    }
    const eds = document.querySelectorAll(IB.S("threads.findEditor.textbox"));
    for (const e of eds) if (IB.visible(e)) return e;
    return null;
  }
  
  function isPostCandidate(c, ed) {
    if (!IB.visible(c) || c === ed || c.contains(ed) || ed.contains(c)) return false;
    const t = IB.norm(c.textContent);
    const al = IB.norm(c.getAttribute("aria-label") || "");
    return IB.R("threads.POST_RE.post").test(t) || IB.R("threads.POST_RE.post").test(al);
  }
  // tombol Post baru muncul setelah ada teks, jadi dicari ulang tiap polling: dialog dulu, lalu naik dari editor, lalu seluruh halaman
  function findPostButton(ed) {
    const sel = IB.S("threads.findPostButton.button");
    const dlg = ed.closest(IB.S("threads.findPostButton.dialog"));
    const scopes = [];
    if (dlg) scopes.push(dlg);
    let el = ed;
    for (let i = 0; i < 14 && el; i++) { el = el.parentElement; if (el) scopes.push(el); }
    scopes.push(document);
    for (const sc of scopes) {
      for (const c of sc.querySelectorAll(sel)) if (isPostCandidate(c, ed)) return c;
    }
    return null;
  }
  function debugButtons(ed) {
    const out = [];
    let el = ed.closest(IB.S("threads.debugButtons.dialog")) || ed.parentElement;
    for (let i = 0; i < 8 && el && el.parentElement; i++) el = el.parentElement;
    (el || document).querySelectorAll(IB.S("threads.debugButtons.button")).forEach(function (b) {
      if (!IB.visible(b)) return;
      const t = IB.norm(b.textContent) || IB.norm(b.getAttribute("aria-label") || "");
      if (t && t.length < 20 && out.length < 12) out.push(t + (IB.isEnabled(b) ? "" : "(off)"));
    });
    return "tombol=[" + out.join("|") + "]";
  }

  async function comment(text) {
    let ed = findEditor();
    for (let k = 0; k < 3 && !ed; k++) {
      const ph = findReplyPlaceholder();
      const target = ph || (btnBySvg(mainScope(), IB.L("threads.comment.reply")) || {}).btn;
      if (target) { if (k === 0) await IB.click(target); else await IB.trustedClick(target); } // percobaan ke-2+ pakai klik asli
      ed = await IB.waitFor(findEditor, 2500, 100);
    }
    if (!ed) throw new Error("Kotak reply Threads tidak ditemukan | " + debugUI());
    await IB.click(ed);
    // klik kotak inline membuka dialog reply baru (elemen lama bisa hilang): tunggu dialognya, jangan tidur buta
    const dlgEd = await IB.waitFor(function () {
      const d = document.querySelector(IB.S("threads.comment.dialog"));
      return d && IB.visible(d) ? d : null;
    }, 1200, 80);
    let cur = dlgEd || findEditor() || ed;
    let typed = await IB.typeInto(cur, text, { trustedFirst: true });
    if (!typed) {
      await IB.sleep(300);
      const again = findEditor();
      if (again) { await IB.trustedClick(again); await IB.sleep(200); cur = again; typed = await IB.typeInto(cur, text, { trustedFirst: true }); }
    }
    if (!typed) throw new Error("Gagal mengetik di kotak reply Threads | insert: " + (IB.lastErr || "-") + " | " + debugUI());
    ed = cur;

    // tombol Post baru muncul/aktif setelah ada teks: polling cepat
    const waitBtn = async function (ms) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const live = findEditor();
        if (live && live !== ed && IB.norm(IB.getText(live)).length) ed = live; // React bisa mengganti editor
        const b = findPostButton(ed);
        if (b && IB.isEnabled(b) && b.getAttribute("aria-disabled") !== "true") return b;
        await IB.sleep(120);
      }
      return null;
    };
    const isSent = function () { return !ed.isConnected || IB.norm(IB.getText(ed)) === ""; };
    let btn = await waitBtn(8000);
    if (!btn) throw new Error("Tombol Post Threads tidak ditemukan | " + debugButtons(ed));

    // kirim bertingkat: klik asli -> klik biasa -> Ctrl+Enter. Berhenti begitu terkirim (cegah dobel).
    const steps = [
      async function () { await IB.trustedClick(btn); },
      async function () { const b = findPostButton(ed) || btn; await IB.click(b); },
      async function () { await IB.pressEnter(ed, true); }
    ];
    let sent = false;
    for (let s = 0; s < steps.length && !sent; s++) {
      try { await steps[s](); } catch (e) {}
      sent = await IB.waitFor(isSent, s === 0 ? 3500 : 2500, 120);
      if (!sent && s < steps.length - 1) {
        const b2 = findPostButton(ed);
        if (!b2) { sent = true; break; } // tombol hilang = dialog menutup = terkirim
        btn = b2;
      }
    }
    if (!sent) throw new Error("Reply Threads tidak terkirim (tombol Post tidak aktif) | " + (IB.lastErr || "-") + " | " + debugButtons(ed));
    const rendered = await IB.waitRendered(text, 3000);
    return { ok: true, rendered: rendered };
  }

  async function processPost(data) {
    const ready = await IB.waitFor(pageReady, 30000, 300);
    if (!ready) return { ok: false, error: "halaman Threads tidak termuat | " + debugUI() };
    await IB.nap(700);
    let liked = false, reposted = false, followed = false;
    if (data.autoLike) { try { liked = !!(await like()).liked; } catch (e) {} }
    await IB.nap(120);
    if (data.autoRepost) { try { reposted = !!(await repost()).reposted; } catch (e) {} }
    await IB.nap(120);
    if (data.autoFollow) { try { followed = !!(await follow()).followed; } catch (e) {} }
    await IB.nap(150);
    try {
      const r = await comment(data.comment);
      return { ok: !!r.ok, liked: liked, reposted: reposted, followed: followed, rendered: r.rendered };
    } catch (e) {
      return { ok: false, liked: liked, reposted: reposted, followed: followed, error: (e && e.message) || String(e) };
    }
  }
  async function likeComment() {
    const ready = await IB.waitFor(pageReady, 20000, 250);
    if (!ready) return { ok: false, error: "halaman tidak termuat" };
    await IB.sleep(800);
    const r = await like();
    return r.liked ? { ok: true, already: !!r.already } : { ok: false, error: r.error || "gagal like" };
  }

  // halaman profil: ikuti akun
  async function followProfile() {
    const ready = await IB.waitFor(pageReady, 20000, 250);
    if (!ready) return { ok: false, error: "halaman profil Threads tidak termuat" };
    await IB.sleep(1500);
    const re = IB.R("threads.followProfile.follow"), done = IB.R("threads.followProfile.following");
    const first = function () {
      const root = document.querySelector(IB.S("threads.followProfile.first.main")) || document.body;
      for (const n of root.querySelectorAll(IB.S("threads.followProfile.first.button"))) {
        const t = IB.norm(n.textContent);
        if (t && IB.visible(n) && (re.test(t) || done.test(t))) return { el: n, followed: done.test(t) };
      }
      return null;
    };
    const st = first();
    if (!st) return { ok: false, error: "tombol Follow tidak ditemukan (akun tidak ada / halaman beda)" };
    if (st.followed) return { ok: true, already: true };
    await IB.click(st.el);
    const ok = await IB.waitFor(function () { const s2 = first(); return s2 && s2.followed; }, 6000, 300);
    return ok ? { ok: true } : { ok: false, error: "klik Follow tidak terkonfirmasi" };
  }

  IB.register({ platform: "threads", detectUsername: detectUsername, checkLoggedIn: checkLoggedIn, dismissPopups: dismissPopups, processPost: processPost, likeComment: likeComment, followProfile: followProfile });
})();
