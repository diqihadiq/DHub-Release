// content_x.js — adapter X (Twitter). Selector mengikuti pola yang dipakai ekstensi X open-source (data-testid).
(function () {
  if (window.__ibX) return; window.__ibX = true;
  const IB = window.IB;
  console.log("[DHub][X] loaded", location.pathname);

  function statusId() { const m = location.pathname.match(/\/status\/(\d+)/); return m ? m[1] : null; }
  function mainArticle() {
    const arts = Array.from(document.querySelectorAll(IB.S("x.mainArticle.tweet")));
    const id = statusId();
    if (id) {
      const a = arts.find(function (x) { return x.querySelector(IB.S("x.mainArticle.status", { id: id })); });
      if (a) return a;
    }
    return arts[0] || null;
  }

  function detectUsername() {
    const p = document.querySelector(IB.S("x.detectUsername.apptabbar-profile-link"));
    if (p) { const m = (p.getAttribute("href") || "").match(/^\/([A-Za-z0-9_]{1,15})\/?$/); if (m) return m[1]; }
    const sw = document.querySelector(IB.S("x.detectUsername.sidenav-accountswitche"));
    if (sw) { const m = (sw.textContent || "").match(/@([A-Za-z0-9_]{1,15})/); if (m) return m[1]; }
    return null;
  }
  function checkLoggedIn() {
    if (/\/(i\/flow\/)?login/.test(location.pathname) || /\/i\/flow\/login/.test(location.pathname)) return { loggedIn: false, reason: "di halaman login" };
    if (document.querySelector(IB.S("x.checkLoggedIn.apptabbar-profile-link"))) return { loggedIn: true };
    return { loggedIn: false, reason: "indikator login tidak ditemukan" };
  }
  async function dismissPopups() {
    for (let i = 0; i < 4; i++) {
      if (!IB.clickByText(IB.R("x.dismissPopups.got"))) break;
      await IB.sleep(300);
    }
  }

  function findEditor() {
    const dialogs = document.querySelectorAll(IB.S("x.findEditor.dialog"));
    for (const d of dialogs) {
      const ed = d.querySelector(IB.S("x.findEditor.tweettextarea-0"));
      if (ed && IB.visible(ed)) return ed;
    }
    const inl = document.querySelector(IB.S("x.findEditor.tweettextarea-0"));
    return inl && IB.visible(inl) ? inl : null;
  }
  function findPostButton(editor) {
    const scope = editor.closest(IB.S("x.findPostButton.dialog")) || document;
    const btns = scope.querySelectorAll(IB.S("x.findPostButton.tweetbuttoninline"));
    for (const b of btns) if (IB.visible(b)) return b;
    return null;
  }

  async function like() {
    const art = mainArticle();
    if (!art) return { liked: false, error: "tweet tidak ditemukan" };
    if (art.querySelector(IB.S("x.like.unlike"))) return { liked: true, already: true };
    const b = art.querySelector(IB.S("x.like.like"));
    if (!b) return { liked: false, error: "tombol like tidak ditemukan" };
    await IB.click(b);
    const ok = await IB.waitFor(function () { return art.querySelector(IB.S("x.like.unlike")); }, 3000, 200);
    return { liked: !!ok };
  }

  async function repost() {
    const art = mainArticle();
    if (!art) return { reposted: false, error: "tweet tidak ditemukan" };
    if (art.querySelector(IB.S("x.repost.unretweet"))) return { reposted: true, already: true };
    const b = art.querySelector(IB.S("x.repost.retweet"));
    if (!b) return { reposted: false, error: "tombol retweet tidak ditemukan" };
    await IB.click(b);
    const c = await IB.waitFor(function () { return document.querySelector(IB.S("x.repost.retweetconfirm")); }, 3500, 200);
    if (!c) return { reposted: false, error: "menu retweet tidak muncul" };
    await IB.click(c);
    const ok = await IB.waitFor(function () { return art.querySelector(IB.S("x.repost.unretweet")); }, 3500, 200);
    return { reposted: !!ok };
  }

  async function follow() {
    const art = mainArticle();
    if (!art) return { followed: false, error: "tweet tidak ditemukan" };
    if (art.querySelector(IB.S("x.follow.unfollow"))) return { followed: true, already: true };
    let b = art.querySelector(IB.S("x.follow.follow"));
    if (!b) for (const n of art.querySelectorAll(IB.S("x.follow.button"))) { if (IB.R("x.follow.follow").test(IB.norm(n.textContent)) && IB.visible(n)) { b = n; break; } }
    if (!b) return { followed: false, skipped: true, error: "tombol follow tidak ada (mungkin sudah diikuti)" };
    await IB.click(b);
    const ok = await IB.waitFor(function () { return art.querySelector(IB.S("x.follow.unfollow")); }, 3500, 200);
    return { followed: !!ok };
  }

  async function comment(text) {
    let ed = findEditor();
    if (!ed) {
      const art = mainArticle();
      const rb = art && art.querySelector(IB.S("x.comment.reply"));
      if (rb) await IB.click(rb);
      ed = await IB.waitFor(findEditor, 6000, 250);
    }
    if (!ed) throw new Error("Kotak reply X tidak ditemukan");
    await IB.click(ed);
    const typed = await IB.typeInto(ed, text);
    if (!typed) throw new Error("Gagal mengetik di kotak reply X");
    let btn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      btn = findPostButton(ed);
      if (btn && IB.isEnabled(btn)) break;
      await IB.sleep(200);
    }
    if (btn && IB.isEnabled(btn)) await IB.click(btn);
    else await IB.pressEnter(ed); // fallback
    const sent = await IB.waitFor(function () {
      if (!ed.isConnected) return true;
      return IB.norm(IB.getText(ed)) === "";
    }, 8000, 250);
    if (!sent) throw new Error("Reply tidak terkirim (tombol Reply tidak aktif / dibatasi X)");
    await IB.nap(300);
    await dismissPopups();                       // tutup modal "Unlock more on X" dll.
    const rendered = await IB.waitRendered(text, 8000); // tunggu komentar benar-benar tampil
    await dismissPopups();
    return { ok: true, rendered: rendered };
  }

  async function processPost(data) {
    const ready = await IB.waitFor(function () { return document.querySelector(IB.S("x.processPost.article")); }, 20000, 250);
    if (!ready) return { ok: false, error: "halaman tweet tidak termuat" };
    await IB.nap(600);
    let liked = false, reposted = false, followed = false;
    if (data.autoLike) { try { liked = !!(await like()).liked; } catch (e) {} }
    await IB.nap(300);
    if (data.autoRepost) { try { reposted = !!(await repost()).reposted; } catch (e) {} }
    await IB.nap(300);
    if (data.autoFollow) { try { followed = !!(await follow()).followed; } catch (e) {} }
    await IB.nap(300);
    try {
      const r = await comment(data.comment);
      return { ok: !!r.ok, liked: liked, reposted: reposted, followed: followed, rendered: r.rendered };
    } catch (e) {
      return { ok: false, liked: liked, reposted: reposted, followed: followed, error: (e && e.message) || String(e) };
    }
  }
  // link komentar di X = link ke tweet reply → like tweet utama di halaman itu
  async function likeComment() {
    const ready = await IB.waitFor(function () { return document.querySelector(IB.S("x.likeComment.article")); }, 20000, 250);
    if (!ready) return { ok: false, error: "halaman tidak termuat" };
    await IB.sleep(500);
    const r = await like();
    return r.liked ? { ok: true, already: !!r.already } : { ok: false, error: r.error || "gagal like" };
  }

  // halaman profil: ikuti akun
  async function followProfile() {
    const ready = await IB.waitFor(function () { return document.querySelector(IB.S("x.followProfile.primarycolumn")); }, 20000, 250);
    if (!ready) return { ok: false, error: "halaman profil tidak termuat (akun tidak ada / ditangguhkan?)" };
    await IB.sleep(900);
    const pick = function () {
      const col = document.querySelector(IB.S("x.followProfile.pick.primarycolumn")) || document;
      for (const n of col.querySelectorAll(IB.S("x.followProfile.pick.follow"))) if (IB.visible(n)) return n;
      return null;
    };
    const b = pick();
    if (!b) return { ok: false, error: "tombol Follow tidak ditemukan (mungkin akun sendiri / diblokir)" };
    const id = b.getAttribute("data-testid") || "";
    if (IB.R("x.followProfile.unfollow").test(id)) return { ok: true, already: true };
    if (IB.R("x.followProfile.cancel").test(id)) return { ok: true, already: true, pending: true };
    await IB.click(b);
    const ok = await IB.waitFor(function () { const n = pick(); return n && IB.R("x.followProfile.unfollow-2").test(n.getAttribute("data-testid") || ""); }, 5000, 250);
    await dismissPopups();
    return ok ? { ok: true } : { ok: false, error: "klik Follow tidak terkonfirmasi" };
  }

  IB.register({ platform: "x", detectUsername: detectUsername, checkLoggedIn: checkLoggedIn, dismissPopups: dismissPopups, processPost: processPost, likeComment: likeComment, followProfile: followProfile });
})();
