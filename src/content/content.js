// content.js — Instagram adapter (diperbarui, lebih robust)
// Menangani pesan: GET_USERNAME, CHECK_LOGGED_IN, DISMISS_POPUPS, PROCESS_POST, LIKE_COMMENT

(function () {
if (window.__ibIG) return; window.__ibIG = true;

console.log("[DHub] content loaded on", location.pathname);

chrome.runtime.onMessage.addListener(function(req, sender, sendResponse) {
  (async function() {
    try {
      if (!req || !req.action) { sendResponse({ ok: false, error: "no action" }); return; }

      if (req.action === "PING") { sendResponse({ ok: true, platform: "instagram" }); return; }
      if (!(await IB.loadCfg())) { sendResponse({ ok: false, loggedIn: false, username: null, reason: IB.cfgErr, error: IB.cfgErr }); return; }

      if (req.action === "GET_USERNAME") {
        try {
          const u = await detectUsernameAsync();
          sendResponse({ username: u || null });
        } catch (e) {
          console.error("[DHub] GET_USERNAME error", e);
          sendResponse({ username: null });
        }
        return;
      }

      if (req.action === "CHECK_LOGGED_IN") {
        try {
          sendResponse(checkLoggedIn());
        } catch (e) {
          console.error("[DHub] CHECK_LOGGED_IN error", e);
          sendResponse({ loggedIn: false, reason: "error" });
        }
        return;
      }

      if (req.action === "DISMISS_POPUPS") {
        try {
          await dismissPopups();
          sendResponse({ ok: true });
        } catch (e) {
          console.error("[DHub] DISMISS_POPUPS error", e);
          sendResponse({ ok: false, error: e.message });
        }
        return;
      }

      if (req.action === "PROCESS_POST") {
        try {
          IB.fast = !!(req.data && req.data.fast); IB.shot = !!(req.data && req.data.screenshot);
          const r = await processPost(req.data || {});
          sendResponse(r);
        } catch (e) {
          console.error("[DHub] PROCESS_POST error", e);
          sendResponse({ ok: false, error: e.message || String(e) });
        }
        return;
      }

      if (req.action === "LIKE_COMMENT") {
        try {
          const r = await likeCommentById(req.data && req.data.commentId);
          sendResponse(r);
        } catch (e) {
          console.error("[DHub] LIKE_COMMENT error", e);
          sendResponse({ ok: false, error: e.message || String(e) });
        }
        return;
      }

      if (req.action === "FOLLOW_PROFILE") {
        try { sendResponse(await followProfile()); }
        catch (e) { console.error("[DHub] FOLLOW_PROFILE error", e); sendResponse({ ok: false, error: e.message || String(e) }); }
        return;
      }

      if (req.action === "VERIFY_COMMENT") {
        try { sendResponse(await verifyComment(req.data && req.data.text)); }
        catch (e) { sendResponse({ ok: false, error: e.message || String(e) }); }
        return;
      }

      // unknown action
      sendResponse({ ok: false, error: "unknown action" });
    } catch (outer) {
      console.error("[DHub] onMessage outer error", outer);
      try { sendResponse({ ok: false, error: outer && outer.message }); } catch(e){}
    }
  })();
  return true; // keep message channel open for async responses
});

// ---------- small utilities ----------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(fn, timeoutMs = 15000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = fn(); if (v) return v; } catch(e){}
    await sleep(intervalMs);
  }
  return null;
}

function isVisible(el) {
  try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch(e){ return false; }
}

function reactSetValue(el, value) {
  if (!el) return;
  try {
    if (el.isContentEditable) {
      el.focus();
      try { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); } catch(e){}
      try { document.execCommand("insertText", false, value); } catch(e) { el.textContent = value; el.dispatchEvent(new InputEvent("input", { bubbles:true, data: value, inputType: "insertText" })); }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (e) { console.warn("[DHub] reactSetValue error", e); }
}

// ---------- username detection ----------
function detectUsername() {
  try {
    // try shared script data patterns
    const scripts = document.querySelectorAll(IB.S("ig.detectUsername.script"));
    for (const s of scripts) {
      const t = s.textContent || "";
      const m1 = t.match(/"viewer":\s*\{[^}]*"username":"([^"]+)"/);
      if (m1) return m1[1];
      const m2 = t.match(/"viewerId":"[^"]+","username":"([^"]+)"/);
      if (m2) return m2[1];
    }

    // try meta tags
    const meta = document.querySelector(IB.S("ig.detectUsername.og-description"));
    if (meta) {
      const c = meta.getAttribute("content") || "";
      const m = c.match(/@?([A-Za-z0-9._-]{1,50})/);
      if (m) return m[1];
    }

    // try profile links
    const links = document.querySelectorAll(IB.S("ig.detectUsername.x"));
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
      if (m && (a.querySelector(IB.S("ig.detectUsername.profile")) || a.querySelector(IB.S("ig.detectUsername.foto-profil")))) return m[1];
    }
  } catch (e) {
    console.warn("[DHub] detectUsername error", e);
  }
  return null;
}

async function detectUsernameAsync() {
  // direct detection first
  const u = detectUsername();
  if (u) return u;

  // try API endpoint (works on web sessions)
  try {
    const r = await fetch("/api/v1/accounts/current_user/?edit=true", {
      credentials: "include",
      headers: { "X-IG-App-ID": "936619743392459", "X-Requested-With": "XMLHttpRequest" }
    });
    if (r && r.ok) {
      const j = await r.json();
      if (j && j.user && j.user.username) return j.user.username;
    }
  } catch (e) {
    // ignore
  }

  // fallback: try window._sharedData or window.__initialData
  try {
    const sd = window._sharedData || window.__initialData || null;
    if (sd) {
      // common path
      const candidate = (sd.config && sd.config.viewer && sd.config.viewer.username) || (sd.entry_data && sd.entry_data.ProfilePage && sd.entry_data.ProfilePage[0] && sd.entry_data.ProfilePage[0].graphql && sd.entry_data.ProfilePage[0].graphql.user && sd.entry_data.ProfilePage[0].graphql.user.username);
      if (candidate) return candidate;
    }
  } catch(e){}

  return null;
}

// ---------- popup dismissal ----------
async function dismissPopups() {
  for (let i = 0; i < 6; i++) {
    let clicked = false;
    const candidates = Array.from(document.querySelectorAll(IB.S("ig.dismissPopups.button")));
    for (const el of candidates) {
      try {
        const txt = (el.textContent || "").trim();
        const aria = (el.getAttribute && el.getAttribute("aria-label")) || "";
        if (!txt && !aria) continue;
        if (IB.R("ig.dismissPopups.not").test(txt) ||
            IB.R("ig.dismissPopups.close").test(aria)) {
          try { el.click(); } catch(e){}
          clicked = true;
          break;
        }
      } catch(e){}
    }
    if (!clicked) break;
    await sleep(500);
  }
}

// ---------- login check ----------
function checkLoggedIn() {
  try {
    if (/\/accounts\/login\/?$/.test(location.pathname)) return { loggedIn: false, reason: "di halaman login" };
    if (/challenge|two_factor|checkpoint|auth_platform/.test(location.pathname + location.href)) return { loggedIn: false, reason: "checkpoint" };
    if (document.querySelector(IB.S("ig.checkLoggedIn.home"))) return { loggedIn: true };
    if (/\/accounts\/onetap/.test(location.pathname)) return { loggedIn: true };
    if (document.querySelector(IB.S("ig.checkLoggedIn.direct-inbox"))) return { loggedIn: true };
    if (document.querySelector(IB.S("ig.checkLoggedIn.direct"))) return { loggedIn: true };
  } catch (e) {
    console.warn("[DHub] checkLoggedIn error", e);
  }
  return { loggedIn: false, reason: "indikator login tidak ditemukan" };
}

// ---------- like & comment helpers ----------



function svgSize(svg) {
  try { const r = svg.getBoundingClientRect(); return Math.max(r.width, r.height); } catch(e){ return 0; }
}

function btnOf(svg) {
  let el = svg;
  for (let i = 0; i < 8 && el; i++) {
    if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") return el;
    el = el.parentElement;
  }
  return svg.parentElement;
}

function findMainLikeSvg() {
  let best = null, bestSize = -1;
  document.querySelectorAll(IB.S("ig.findMainLikeSvg.svg")).forEach(function(svg) {
    const label = svg.getAttribute("aria-label");
    if (!label || !IB.R("ig.LIKE_LABEL_RE.like").test(label)) return;
    const sz = svgSize(svg);
    if (sz > bestSize) { best = svg; bestSize = sz; }
  });
  return best;
}

function isAlreadyLiked() {
  const s = findMainLikeSvg();
  return !!s && IB.R("ig.UNLIKE_LABEL_RE.unlike").test(s.getAttribute("aria-label"));
}

function findLikeButton() {
  const s = findMainLikeSvg();
  return s ? btnOf(s) : null;
}

function openCommentPanel() {
  let best = null, bestSize = -1;
  document.querySelectorAll(IB.S("ig.openCommentPanel.svg")).forEach(function(svg) {
    const label = svg.getAttribute("aria-label");
    if (!label || !IB.R("ig.openCommentPanel.comment").test(label)) return;
    const sz = svgSize(svg);
    if (sz > bestSize) { best = svg; bestSize = sz; }
  });
  if (!best) return false;
  try {
    const b = btnOf(best);
    ["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(t){
      b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    });
    return true;
  } catch(e) { return false; }
}

function findCommentBox() {
  const scopes = [ document.querySelector(IB.S("ig.findCommentBox.dialog")), document.querySelector(IB.S("ig.findCommentBox.article")), document ];
  for (const scope of scopes) {
    if (!scope) continue;
    // textarea that looks like comments
    for (const t of scope.querySelectorAll(IB.S("ig.findCommentBox.textarea"))) {
      const label = (t.getAttribute("aria-label") || "") + " " + (t.getAttribute("placeholder") || "");
      if (IB.R("ig.findCommentBox.comment").test(label) && isVisible(t)) return t;
    }
    // contenteditable often used in Reels
    for (const ed of scope.querySelectorAll(IB.S("ig.findCommentBox.true"))) {
      const al = (ed.getAttribute("aria-label") || "") + " " + (ed.getAttribute("aria-placeholder") || "") + " " + (ed.getAttribute("placeholder") || "");
      if (IB.R("ig.findCommentBox.comment-2").test(al) && isVisible(ed)) return ed;
    }
    // input text fallback
    for (const i of scope.querySelectorAll(IB.S("ig.findCommentBox.text"))) {
      const al = (i.getAttribute("aria-label") || "") + " " + (i.getAttribute("placeholder") || "");
      if (IB.R("ig.findCommentBox.comment").test(al) && isVisible(i)) return i;
    }
  }
  // final fallback: any visible textarea or contenteditable textbox
  for (const t of document.querySelectorAll(IB.S("ig.findCommentBox.textarea"))) if (isVisible(t)) return t;
  for (const ed of document.querySelectorAll(IB.S("ig.findCommentBox.true-2"))) if (isVisible(ed)) return ed;
  return null;
}

function findPostButton() {
  const scopes = [ document.querySelector(IB.S("ig.findPostButton.dialog")), document.querySelector(IB.S("ig.findPostButton.article")), document ];
  for (const scope of scopes) {
    if (!scope) continue;
    const btns = scope.querySelectorAll(IB.S("ig.findPostButton.button"));
    for (const b of btns) {
      const text = (b.textContent || "").trim();
      if (IB.R("ig.findPostButton.post").test(text)) {
        if (b.getAttribute("aria-disabled") === "true") continue;
        if (b.disabled) continue;
        return b;
      }
    }
  }
  return null;
}

async function likePost() {
  try {
    if (isAlreadyLiked()) return { liked: true };
    const btn = findLikeButton();
    if (!btn) return { liked: false, error: "like button not found" };
    btn.click();
    await sleep(300);
    return { liked: true };
  } catch (e) { return { liked:false, error: e && e.message }; }
}

function normText(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function findCommentNodes(text) {
  const t = normText(text);
  if (!t) return [];
  const out = [];
  document.querySelectorAll(IB.S("ig.findCommentNodes.auto")).forEach(function(el) {
    if (el.closest(IB.S("ig.findCommentNodes.true"))) return;
    if (normText(el.textContent) !== t) return;
    if (Array.from(el.children).some(function(c){ return normText(c.textContent) === t; })) return;
    if (!isVisible(el)) return;
    out.push(el);
  });
  return out;
}

// Konfirmasi dari server: kotak komentar yang kosong belum berarti komentar tersimpan (Instagram menampilkan komentar
// "optimis" lebih dulu, lalu bisa menolaknya). Pantau request POST .../comments/<id>/add/ lewat Resource Timing
// (tidak mengubah fetch/XHR halaman). Kalau status tidak terbaca, hasilnya null dan alur memakai pengecekan tampilan seperti biasa.
function watchCommentRequest() {
  const re = /\/comments\/\d+\/add\/?(?:\?|$)/;
  let hit = null, obs = null;
  try {
    obs = new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        if (!re.test(String(e.name || ""))) return;
        const st = Number(e.responseStatus) || 0;
        if (st > 0) hit = { status: st, ok: st >= 200 && st < 300 };
      });
    });
    obs.observe({ type: "resource" });
  } catch (e) { obs = null; }
  return {
    result: function () { return hit; },
    wait: function (ms) { return obs ? waitFor(function () { return hit; }, ms, 100) : Promise.resolve(null); },
    stop: function () { try { if (obs) obs.disconnect(); } catch (e) {} }
  };
}

// Ketik komentar lalu PASTIKAN teksnya benar-benar ada di kotak (dan diterima React). Kotak yang kosong sejak awal
// dulu dianggap "sudah terkirim". Urutan: ketik biasa -> kalau tidak masuk, ketik lewat input asli (debugger) -> kalau tetap tidak, gagal.
async function typeComment(box, text) {
  const want = normText(text).slice(0, 25);
  const cur = function () { return box && box.isConnected ? box : findCommentBox(); };
  const has = function () { const b = cur(); return !!b && normText(getBoxText(b)).indexOf(want) >= 0; };
  const accepted = async function () { return has() && !!(await waitFor(function () { return findPostButton(); }, 1500, 100)); };
  try { box.focus(); } catch (e) {}
  reactSetValue(box, text);
  if (!box.isContentEditable) box.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
  await sleep(150);
  if (await accepted()) return cur();
  for (let k = 0; k < 2; k++) {
    const b = cur(); if (!b) break;
    try { b.scrollIntoView({ block: "center" }); b.focus(); b.click(); } catch (e) {}
    await sleep(120);
    try { await IB.bg({ action: "TRUSTED_INSERT", text: text, clear: true }); } catch (e) {}
    await sleep(200);
    if (await accepted()) return cur();
    if (has() && k === 1) return cur(); // teks ada tapi tombol Post tidak terdeteksi: lanjut (Enter sebagai cadangan)
  }
  return null;
}

async function commentPost(text) {
  const clickPlaceholder = function() {
    const els = document.querySelectorAll(IB.S("ig.commentPost.clickPlaceholder.span"));
    for (const s of els) {
      const t = (s.textContent || "").trim();
      if (IB.R("ig.commentPost.clickPlaceholder.add").test(t) && t.length < 40) {
        try { s.click(); } catch(e){}
        return true;
      }
    }
    return false;
  };

  let box = findCommentBox();
  for (let k = 0; k < 4 && !box; k++) {
    openCommentPanel();
    box = await waitFor(() => findCommentBox(), 2500, 100);
    if (!box) { clickPlaceholder(); box = await waitFor(() => findCommentBox(), 1500, 100); }
  }
  if (!box) box = await waitFor(() => findCommentBox(), 6000);
  if (!box) throw new Error("Kotak komentar tidak ditemukan | " + debugCommentUI());

  try { box.scrollIntoView({ block: "center" }); } catch(e){}
  box.focus();
  await sleep(60);
  const countBefore = findCommentNodes(text).length;
  const typedBox = await typeComment(box, text);
  if (!typedBox) throw new Error("Gagal mengetik komentar: teks tidak masuk ke kotak komentar (halaman mungkin tidak fokus)");
  box = typedBox;

  const isReelPage = /\/reels?\//.test(location.pathname);
  const postBtn = await waitFor(() => findPostButton(), isReelPage ? 500 : 2500, 100);
  const net = watchCommentRequest();
  try {
  if (postBtn) postBtn.click(); else await submitWithEnter(box);

  const boxEmpty = () => { const b = box.isConnected ? box : findCommentBox(); return !b || getBoxText(b) === ""; };
  let sent = await waitFor(boxEmpty, 4000, 100);
  if (!sent) {
    const btn2 = findPostButton();
    if (btn2) btn2.click(); else await submitWithEnter(box);
    sent = await waitFor(boxEmpty, 3000, 100);
  }
  const early = net.result();
  if (!sent && early && !early.ok) throw new Error("Instagram menolak komentar (HTTP " + early.status + ")");
  if (!sent) throw new Error("Komentar tidak terkirim (kotak komentar masih terisi)" + (lastEnterError ? " | enter: " + lastEnterError : ""));

  // tunggu jawaban server: komentar baru dianggap terkirim kalau server menerimanya (bukan sekadar kotak yang kosong).
  // Tab juga tidak boleh dipindah / ditutup sebelum request selesai, kalau tidak komentar bisa batal di tengah jalan.
  const verdict = await net.wait(IB.fast ? 5000 : 9000);
  if (verdict && !verdict.ok) throw new Error("Instagram menolak komentar (HTTP " + verdict.status + ")" + (verdict.status === 400 || verdict.status === 403 ? " — kemungkinan dibatasi / dianggap spam" : verdict.status === 429 ? " — terlalu cepat, kena batas" : ""));

  // menunggu komentar tampil: untuk bukti screenshot, dan sebagai cadangan kalau status server tidak terbaca
  const shown = await waitFor(() => findCommentNodes(text).length > countBefore, IB.shot ? 12000 : (verdict ? (IB.fast ? 600 : 1500) : (IB.fast ? 3000 : 6000)), 150);
  if (shown && IB.shot) {
    const nodes = findCommentNodes(text);
    try { nodes[0].scrollIntoView({ block: "center" }); } catch(e){}
    await sleep(600);
  }
  return { ok: true, confirmed: !!(verdict || shown), net: verdict ? verdict.status : null };
  } finally { net.stop(); }
}

function debugCommentUI() {
  const ta = document.querySelectorAll(IB.S("ig.debugCommentUI.textarea")).length;
  const ce = Array.from(document.querySelectorAll(IB.S("ig.debugCommentUI.true"))).map(e => (e.getAttribute("aria-label") || e.getAttribute("role") || "?").slice(0,25));
  const icons = Array.from(new Set(Array.from(document.querySelectorAll(IB.S("ig.debugCommentUI.svg"))).map(s => s.getAttribute("aria-label")))).slice(0,15);
  return "path=" + location.pathname + " textarea=" + ta + " editable=[" + ce.join("|") + "] icons=[" + icons.join("|") + "]";
}

let lastEnterError = "";
async function submitWithEnter(el) {
  try { el.focus(); } catch(e){}
  const r = await new Promise(function(res) {
    try { chrome.runtime.sendMessage({ action: "TRUSTED_ENTER" }, function(x){ void chrome.runtime.lastError; res(x); }); }
    catch(e) { res(null); }
  });
  if (r && r.ok) { lastEnterError = ""; return; }
  lastEnterError = (r && r.error) || "no response";
  pressEnter(el);
}

function getBoxText(el) { return ((el.isContentEditable ? el.textContent : el.value) || "").trim(); }
function pressEnter(el) {
  try { el.focus(); } catch(e){}
  ["keydown","keypress","keyup"].forEach(function(t) {
    el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  });
}

async function followAuthor() {
  const scope = document.querySelector(IB.S("ig.followAuthor.dialog")) || document.querySelector(IB.S("ig.followAuthor.article")) || document.querySelector(IB.S("ig.followAuthor.dialog-2"));
  if (!scope) return { followed: false, error: "post tidak ditemukan" };
  const head = scope.querySelector(IB.S("ig.followAuthor.header")) || scope;
  const btns = head.querySelectorAll(IB.S("ig.followAuthor.button"));
  for (const b of btns) {
    const t = normText(b.textContent);
    if (IB.R("ig.followAuthor.following").test(t)) return { followed: true, already: true };
  }
  for (const b of btns) {
    const t = normText(b.textContent);
    if (IB.R("ig.followAuthor.follow").test(t) && isVisible(b)) { try { b.click(); } catch (e) {} await sleep(900); return { followed: true }; }
  }
  return { followed: false, skipped: true, error: "tombol follow tidak ada (mungkin sudah diikuti)" };
}

async function processPost(data) {
  if (!isPostOrReelPath()) return { ok: false, error: "bukan halaman post/reel: " + location.pathname };

  const ready = await waitFor(function(){
    return document.querySelector(IB.S("ig.processPost.article")) ||
           document.querySelector(IB.S("ig.processPost.dialog")) ||
           document.querySelector(IB.S("ig.processPost.dialog-2")) ||
           findLikeButton() ||
           findCommentBox() ||
           document.querySelector(IB.S("ig.processPost.main"));
  }, 25000, 150);
  if (!ready) return { ok: false, error: "halaman post tidak termuat" };

  await sleep(200);

  let likedFlag = false;
  if (data.autoLike) {
    try {
      const r = await likePost();
      likedFlag = !!r.liked;
    } catch(e) { console.warn("[DHub] likePost error", e); }
  }

  let followedFlag = false;
  if (data.autoFollow) { try { followedFlag = !!(await followAuthor()).followed; } catch (e) {} }

  const box = findCommentBox();
  if (box) { try { box.scrollIntoView({ block: "center" }); } catch(e){} await sleep(100); }

  const cr = await commentPost(data.comment);
  return { ok: true, liked: likedFlag, followed: followedFlag, confirmed: cr.confirmed, net: cr.net };
}

function isPostOrReelPath() { return /\/(p|reel|reels|tv)\//.test(location.pathname); }

// ---------- like comment by id ----------
function findCommentAnchor(id) {
  const re = new RegExp("/(c|r)/" + id + "(/|\\?|$)");
  const anchors = document.querySelectorAll(IB.S("ig.findCommentAnchor.c"));
  for (const a of anchors) {
    const h = a.getAttribute("href") || "";
    if (re.test(h)) return a;
  }
  return null;
}

function commentIdsIn(el) {
  const ids = {};
  el.querySelectorAll(IB.S("ig.commentIdsIn.c")).forEach(function(a) {
    const m = (a.getAttribute("href") || "").match(/\/(?:c|r)\/(\d+)(?:\/r\/(\d+))?/);
    if (m) ids[m[2] || m[1]] = true;
  });
  return Object.keys(ids).length;
}

function findCommentHeart(anchor) {
  let el = anchor;
  for (let i = 0; i < 14 && el && el.parentElement; i++) {
    el = el.parentElement;
    if (commentIdsIn(el) > 1) return null;
    const hearts = Array.from(el.querySelectorAll(IB.S("ig.findCommentHeart.svg"))).filter(function(s) {
      const l = s.getAttribute("aria-label");
      return l && IB.R("ig.LIKE_LABEL_RE.like").test(l);
    });
    if (hearts.length > 0) return hearts[0];
  }
  return null;
}

function clickByText(re) {
  const els = document.querySelectorAll(IB.S("ig.clickByText.button"));
  for (const b of els) {
    const t = (b.textContent || "").trim();
    if (t.length < 50 && re.test(t)) { try { b.click(); } catch(e){} return true; }
  }
  return false;
}

function clickLoadMoreIcon() {
  const svgs = document.querySelectorAll(IB.S("ig.clickLoadMoreIcon.load-more-comments"));
  if (svgs.length) { try { btnOf(svgs[0]).click(); } catch(e){} return true; }
  return false;
}

function scrollableParent(el) {
  for (let p = el && el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    try {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 20) return p;
    } catch(e){}
  }
  return null;
}

// diagnostik: teks tombol pendek yang terlihat di halaman (untuk melihat apakah ada tombol "komentar tersembunyi" dan apa labelnya)
function diagButtons() {
  const out = [];
  try {
    for (const b of document.querySelectorAll(IB.S("ig.clickByText.button"))) {
      if (out.length >= 8) break;
      const t = (b.textContent || "").trim().replace(/\s+/g, " ");
      if (t && t.length < 32 && isVisible(b) && out.indexOf(t) < 0) out.push(t);
    }
  } catch (e) {}
  return out.join("|");
}

async function likeCommentById(id) {
  if (!id) return { ok: false, error: "comment id kosong" };
  if (!isPostOrReelPath()) return { ok: false, error: "bukan halaman post/reel: " + location.pathname };

  await waitFor(function(){ return document.querySelector(IB.S("ig.likeCommentById.article")) || document.querySelector(IB.S("ig.likeCommentById.dialog")) || document.querySelector(IB.S("ig.likeCommentById.main")) || findMainLikeSvg(); }, 25000, 150);
  await sleep(250);

  // cari komentar target: scroll & muat komentar sampai ketemu, maks 25 dtk.
  // berhenti lebih awal kalau ~8 dtk tidak ada komentar baru yang termuat (komentar dihapus / sudah habis).
  let anchor = null, lastCount = -1, stall = 0, attempt = 0, maxSeen = 0, hiddenClicks = 0;
  const hidRe = IB.Ropt("ig.likeCommentById.hidden"); // tombol "lihat komentar tersembunyi"; null kalau kuncinya belum ada di server
  const tSearch = Date.now();
  while (Date.now() - tSearch < (maxSeen > 0 ? 90000 : 25000)) { // post ber-komentar ribuan: selama daftar masih bertambah, beri waktu sampai 90 dtk
    anchor = findCommentAnchor(id);
    if (anchor) break;
    // tab tersembunyi = Instagram berhenti memuat komentar & timer melambat: minta background memunculkan jendela ini
    if ((document.visibilityState === "hidden" && attempt % 5 === 0) || (maxSeen === 0 && !document.hasFocus() && attempt === 10)) { await IB.bg({ action: "FOCUS_TAB" }); }
    // tombol Comment di Reel = buka/tutup: klik hanya kalau belum ada komentar di layar (jangan menutup panel yang sudah terbuka)
    if ((attempt === 1 || attempt === 6 || attempt === 15) && !document.querySelector(IB.S("ig.likeCommentById.c"))) openCommentPanel();
    clickByText(IB.R("ig.likeCommentById.view"));
    if (hidRe && hiddenClicks < 8 && attempt % 4 === 2) { if (clickByText(hidRe)) { hiddenClicks++; await sleep(700); } } // ikut memuat komentar tersembunyi kalau tombolnya ada
    clickLoadMoreIcon();
    const all = document.querySelectorAll(IB.S("ig.likeCommentById.c"));
    if (all.length > maxSeen) maxSeen = all.length;
    if (all.length !== lastCount) { lastCount = all.length; stall = 0; } else stall++;
    if (all.length) {
      const last = all[all.length - 1];
      try { last.scrollIntoView({ block: "center" }); } catch(e){}
      const sp = scrollableParent(last);
      try { if (sp) sp.scrollTop = sp.scrollHeight; else window.scrollBy(0, 900); } catch(e){}
    } else {
      try { window.scrollBy(0, 900); } catch(e){}
    }
    attempt++;
    if (maxSeen > 0 && stall >= 20 && attempt > 20) break; // berhenti dini hanya kalau sudah ada komentar termuat; kalau masih 0, tunggu sampai batas 25 dtk
    await sleep(400);
  }
  if (!anchor) {
    // diagnostik: awalan "komentar tidak ditemukan" dipertahankan agar logika retry di background.js tetap jalan
    const hs = Array.from(document.querySelectorAll(IB.S("ig.likeCommentById.c"))).map(function (a) { return a.getAttribute("href") || ""; });
    return { ok: false, error: "komentar tidak ditemukan | vis=" + document.visibilityState + " focus=" + document.hasFocus() +
      " anchor_akhir=" + hs.length + " anchor_maks=" + maxSeen + " putaran=" + attempt + " dtk=" + Math.round((Date.now() - tSearch) / 1000) +
      " last=" + (hs[hs.length - 1] || "-").slice(-28) + " url=" + (location.pathname + location.search).slice(0, 60) +
      " hid=" + (hidRe ? "klik" + hiddenClicks : "cfg-kosong") + " btn=[" + diagButtons() + "]" };
  }

  try { anchor.scrollIntoView({ block: "center" }); } catch(e){}
  await sleep(120);

  let heart = findCommentHeart(anchor);
  if (!heart) return { ok: false, error: "ikon like komentar tidak ditemukan" };
  try {
    if (IB.R("ig.UNLIKE_LABEL_RE.unlike").test(heart.getAttribute("aria-label"))) return { ok: true, already: true };
  } catch(e){}
  const state = function () {
    const a2 = findCommentAnchor(id);
    const h2 = a2 ? findCommentHeart(a2) : null;
    if (!h2) return "hilang";
    return IB.R("ig.UNLIKE_LABEL_RE.unlike").test(h2.getAttribute("aria-label") || "") ? "liked" : "notliked";
  };
  btnOf(heart).click();
  await sleep(500);
  let st = state();
  if (st === "liked") return { ok: true };
  // klik biasa kadang diabaikan Instagram: ulangi dengan klik asli (hanya kalau hati masih belum aktif, supaya tidak jadi unlike)
  if (st === "notliked") {
    const a3 = findCommentAnchor(id), h3 = a3 ? findCommentHeart(a3) : null;
    if (h3) {
      await IB.trustedClick(btnOf(h3));
      await sleep(600);
      st = state();
      if (st === "liked") return { ok: true };
    }
  }
  return { ok: false, error: "klik like komentar tidak terkonfirmasi (" + st + ")" };
}

// ---------- follow profil ----------
async function followProfile() {
  const re = IB.R("ig.followProfile.follow"), done = IB.R("ig.followProfile.following");
  const header = await waitFor(function () { return document.querySelector(IB.S("ig.followProfile.header")); }, 20000, 250);
  if (!header) return { ok: false, error: "halaman profil tidak termuat" };
  await sleep(1200);
  const first = function () {
    for (const b of document.querySelectorAll(IB.S("ig.followProfile.first.button"))) {
      const t = normText(b.textContent);
      if (t && isVisible(b) && (re.test(t) || done.test(t))) return { el: b, followed: done.test(t) };
    }
    return null;
  };
  const st = first();
  if (!st) {
    // tidak ada tombol Follow: profil sendiri / tidak tersedia -> DILEWATI (bukan gagal, tidak ikut rem gagal beruntun)
    if (isOwnProfile()) return { ok: false, skipped: true, error: "profil sendiri (tidak bisa follow diri sendiri)" };
    return { ok: false, skipped: true, error: "tombol Follow tidak ada (akun tidak ada / dibatasi / profil sendiri)" };
  }
  if (st.followed) return { ok: true, already: true };
  try { st.el.click(); } catch (e) {}
  const ok = await waitFor(function () { const s2 = first(); return (s2 && s2.followed) || blockDialog(); }, 6000, 300);
  const blk = blockDialog();
  if (blk) { dismissBlock(); return { ok: false, blocked: true, error: "Instagram membatasi follow: \"" + blk + "\"" }; }
  return ok ? { ok: true } : { ok: false, error: "klik Follow tidak terkonfirmasi (mungkin dibatasi sementara oleh Instagram)" };
}

const OWN_PROFILE_RE = /^(Edit profile|Edit profil|Ubah profil|Edit Profil|View archive|Lihat arsip)$/i;
function isOwnProfile() {
  try {
    const path = (location.pathname.match(/^\/([^\/?#]+)/) || [])[1];
    const me = detectUsername();
    if (path && me && path.toLowerCase() === String(me).toLowerCase()) return true;
    if (document.querySelector('a[href="/accounts/edit/"]')) return true;
    for (const b of document.querySelectorAll('header a, header button, header div[role="button"], main a[role="link"]')) {
      if (OWN_PROFILE_RE.test(normText(b.textContent)) && isVisible(b)) return true;
    }
  } catch (e) {}
  return false;
}
// dialog pembatasan Instagram ("Coba Lagi Nanti" / "Action Blocked" / "We restrict certain activity")
const BLOCK_RE = /(Try Again Later|Coba Lagi Nanti|Action Blocked|Tindakan Diblokir|restrict certain activity|membatasi aktivitas tertentu|limit how often|membatasi seberapa sering)/i;
function blockDialog() {
  for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    const t = normText(d.textContent);
    if (t && BLOCK_RE.test(t) && isVisible(d)) return t.slice(0, 140);
  }
  return null;
}
function dismissBlock() {
  for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    for (const b of d.querySelectorAll('button, div[role="button"]')) {
      if (/^(OK|Oke|Tutup|Close|Report a problem|Laporkan masalah)$/i.test(normText(b.textContent))) { try { b.click(); } catch (e) {} return; }
    }
  }
}

// ---------- verifikasi komentar setelah reload ----------
async function verifyComment(text) {
  await waitFor(function () {
    return document.querySelector(IB.S("ig.processPost.article")) || document.querySelector(IB.S("ig.processPost.dialog")) || findCommentBox() || document.querySelector(IB.S("ig.processPost.main"));
  }, 20000, 200);
  const isReel = /\/reels?\//.test(location.pathname);
  const snip = verifySnippet(text);
  // cocokkan potongan awal teks (tahan terhadap emoji / teks yang dipotong "selengkapnya"), bukan seluruh isi elemen
  const find = function () {
    const exact = findCommentNodes(text)[0];
    if (exact) return exact;
    if (!snip) return null;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeValue && normText(n.nodeValue).indexOf(snip) >= 0) {
        const p = n.parentElement;
        if (p && !p.closest('[contenteditable="true"], textarea, [role="textbox"]') && isVisible(p)) return p;
      }
    }
    return null;
  };
  const t0 = Date.now(); let opened = 0, spin = 0;
  while (Date.now() - t0 < 20000) {
    const el = find();
    if (el) { try { el.scrollIntoView({ block: "center" }); } catch (e) {} return { ok: true, found: true }; }
    if (isReel && opened < 2 && Date.now() - t0 > opened * 5000) { openCommentPanel(); opened++; }
    if (document.visibilityState === "hidden" && spin % 5 === 0) { await IB.bg({ action: "FOCUS_TAB" }); }
    try { clickByText(IB.R("ig.likeCommentById.view")); } catch (e) {}
    try { clickLoadMoreIcon(); } catch (e) {}
    // daftar komentar Instagram dimuat bertahap: komentar baru sering ada di bawah layar, jadi scroll daftarnya
    const all = document.querySelectorAll(IB.S("ig.likeCommentById.c"));
    if (all.length) {
      const last = all[all.length - 1];
      try { last.scrollIntoView({ block: "center" }); } catch (e) {}
      const sp = scrollableParent(last);
      try { if (sp) sp.scrollTop = sp.scrollHeight; else window.scrollBy(0, 900); } catch (e) {}
    } else { try { window.scrollBy(0, 700); } catch (e) {} }
    spin++;
    await sleep(400);
  }
  return { ok: true, found: false, diag: debugCommentUI() };
}
// potongan awal komentar yang aman dicocokkan: berhenti sebelum emoji / karakter non-Latin pertama
function verifySnippet(text) {
  const t = normText(text);
  const m = t.match(/^[\x20-\x7E\u00A0-\u024F]+/);
  let s = (m ? m[0] : "").trim();
  if (s.length < 10) s = t;
  return s.slice(0, 30);
}

})();
