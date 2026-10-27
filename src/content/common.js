// common.js — helper bersama untuk adapter X / Threads / TikTok
(function () {
  if (window.IB) return;
  const IB = {};
  // ===== konfigurasi selector dari server (hanya diberikan untuk licence valid) =====
  IB.CFG_SCHEMA = 1;
  IB.cfg = null; IB.cfgVer = null; IB.cfgErr = ""; IB._cfgAt = 0; IB._re = {};
  IB.loadCfg = async function () {
    if (IB.cfg && Date.now() - IB._cfgAt < 15000) return true;
    const r = await IB.bg({ action: "GET_CONFIG" });
    if (r && r.ok && r.cfg && r.cfg.schema === IB.CFG_SCHEMA) {
      if (IB.cfgVer !== r.version) IB._re = {};
      IB.cfg = r.cfg; IB.cfgVer = r.version; IB._cfgAt = Date.now(); IB.cfgErr = "";
      return true;
    }
    IB.cfg = null;
    IB.cfgErr = (r && r.ok && r.cfg) ? "Konfigurasi tidak cocok dengan versi ekstensi. Perbarui DHub." : ((r && r.error) || "Konfigurasi tidak tersedia.");
    return false;
  };
  IB._cv = function (kind, id) {
    const v = IB.cfg && IB.cfg[kind] && IB.cfg[kind][id];
    if (v == null) throw new Error("Konfigurasi tidak lengkap: " + id);
    return v;
  };
  // kunci konfigurasi OPSIONAL: kembali null kalau server belum punya kuncinya (tidak melempar "Konfigurasi tidak lengkap")
  IB.Ropt = function (id) { try { return IB.R(id); } catch (e) { return null; } };
  IB.Sopt = function (id, vars) { try { return IB.S(id, vars); } catch (e) { return null; } };
  IB.S = function (id, vars) {
    const v = IB._cv("sel", id);
    return vars ? String(v).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; }) : v;
  };
  IB.L = function (id) { return IB._cv("lst", id); };
  IB.R = function (id) {
    if (IB._re[id]) return IB._re[id];
    const v = IB._cv("re", id);
    return (IB._re[id] = new RegExp(v[0], v[1] || ""));
  };
  IB.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  // mode cepat: jeda "tunggu tenang" antar langkah dipersingkat; IB.shot = screenshot aktif (butuh komentar sudah tampil)
  IB.fast = false; IB.shot = false;
  IB.nap = function (ms) { return IB.sleep(IB.fast ? Math.round(ms * 0.35) : ms); };
  IB.norm = function (s) { return String(s || "").replace(/\s+/g, " ").trim(); };
  IB.waitFor = async function (fn, timeout, interval) {
    timeout = timeout || 15000; interval = interval || 250;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { const v = fn(); if (v) return v; } catch (e) {}
      await IB.sleep(interval);
    }
    return null;
  };
  IB.visible = function (el) {
    try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (e) { return false; }
  };
  IB.bg = function (msg) {
    return new Promise(function (res) {
      try { chrome.runtime.sendMessage(msg, function (r) { void chrome.runtime.lastError; res(r); }); }
      catch (e) { res(null); }
    });
  };
  // klik dengan urutan pointer lengkap, lalu satu kali click() (tidak double-toggle)
  IB.click = async function (el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    try {
      ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(function (t) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      });
    } catch (e) {}
    try { el.click(); } catch (e) { return false; }
    await IB.sleep(150);
    return true;
  };
  IB.getText = function (el) {
    if (!el) return "";
    return (el.isContentEditable || el.getAttribute("contenteditable") === "true") ? (el.textContent || "") : (el.value || "");
  };
  IB.isEnabled = function (el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    return true;
  };
  // ketik ke editor (Draft.js / Lexical / textarea). opts.trustedFirst: pakai input asli (debugger) dulu,
  // karena TikTok/Threads tidak mengenali teks hasil execCommand (tombol kirim tetap nonaktif).
  IB.typeInto = async function (el, text, opts) {
    opts = opts || {};
    const want = IB.norm(text).slice(0, 12);
    const has = function () { return IB.norm(IB.getText(el)).indexOf(want) >= 0; };
    el.focus(); await IB.sleep(80);
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      if (d && d.set) d.set.call(el, text); else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await IB.sleep(150);
      return has();
    }
    const viaExec = async function () {
      try { el.focus(); document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); document.execCommand("insertText", false, text); } catch (e) {}
      await IB.sleep(250); return has();
    };
    const viaTrusted = async function () {
      el.focus();
      const r = await IB.bg({ action: "TRUSTED_INSERT", text: text, clear: true });
      IB.lastErr = (r && r.ok) ? "" : ((r && r.error) || "tidak ada respons");
      await IB.sleep(250); return has();
    };
    const order = opts.trustedFirst ? [viaTrusted, viaExec] : [viaExec, viaTrusted];
    for (const f of order) { if (await f()) return true; }
    try { el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true, composed: true })); } catch (e) {}
    await IB.sleep(250);
    return has();
  };
  // cari teks komentar yang sudah tampil di halaman (di luar editor), lalu scroll ke sana
  IB.findRendered = function (text) {
    const snip = IB.norm(text).slice(0, 30);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeValue && IB.norm(n.nodeValue).indexOf(snip) >= 0) {
        const p = n.parentElement;
        if (p && !p.closest('[contenteditable="true"], textarea, [role="textbox"]') && IB.visible(p)) return p;
      }
    }
    return null;
  };
  IB.waitRendered = async function (text, timeout) {
    // hanya untuk bukti screenshot: tanpa screenshot cukup tunggu sebentar, hasil kirim sudah dipastikan di langkah sebelumnya
    timeout = IB.shot ? (timeout || 8000) : Math.min(timeout || 8000, IB.fast ? 800 : 2000);
    const el = await IB.waitFor(function () { return IB.findRendered(text); }, timeout || 8000, 250);
    if (el) { try { el.scrollIntoView({ block: "center" }); } catch (e) {} await IB.sleep(250); }
    return !!el;
  };
  // klik asli (isTrusted) lewat debugger di titik tengah elemen; untuk tombol yang mengabaikan klik sintetis
  IB.trustedClick = async function (el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    await IB.sleep(60);
    let r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    if (!r || !r.width || !r.height) return false;
    const res = await IB.bg({ action: "TRUSTED_CLICK", x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    IB.lastErr = (res && res.ok) ? "" : ((res && res.error) || "tidak ada respons");
    return !!(res && res.ok);
  };
  IB.pressEnter = async function (el, ctrl) {
    try { el.focus(); } catch (e) {}
    const r = await IB.bg({ action: "TRUSTED_ENTER", ctrl: !!ctrl });
    if (r && r.ok) return true;
    try {
      ["keydown", "keyup"].forEach(function (t) {
        el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      });
    } catch (e) {}
    return false;
  };
  IB.clickByText = function (re, scope) {
    const nodes = (scope || document).querySelectorAll('button, div[role="button"], a[role="button"], span');
    for (const n of nodes) {
      const t = IB.norm(n.textContent);
      if (t && t.length < 40 && re.test(t) && IB.visible(n)) { try { n.click(); } catch (e) {} return true; }
    }
    return false;
  };
  IB.register = function (a) {
    chrome.runtime.onMessage.addListener(function (req, sender, send) {
      if (!req || !req.action) return false;
      const map = {
        PING: async function () { return { ok: true, platform: a.platform }; },
        GET_USERNAME: async function () { return { username: a.detectUsername() || null }; },
        CHECK_LOGGED_IN: async function () { return a.checkLoggedIn(); },
        DISMISS_POPUPS: async function () { try { await a.dismissPopups(); } catch (e) {} return { ok: true }; },
        PROCESS_POST: async function () { IB.fast = !!(req.data && req.data.fast); IB.shot = !!(req.data && req.data.screenshot); return a.processPost(req.data || {}); },
        LIKE_COMMENT: async function () { return a.likeComment(req.data && req.data.commentId); },
        FOLLOW_PROFILE: async function () { return a.followProfile ? a.followProfile() : { ok: false, error: "follow profil belum didukung" }; },
        // verifikasi komentar setelah reload: cari teks komentar di halaman (scroll pelan), maks ~12 dtk
        VERIFY_COMMENT: async function () {
          const text = req.data && req.data.text;
          if (a.verifyComment) return a.verifyComment(text);
          const t0 = Date.now();
          while (Date.now() - t0 < 12000) {
            const el = IB.findRendered(text);
            if (el) { try { el.scrollIntoView({ block: "center" }); } catch (e) {} return { ok: true, found: true }; }
            try { window.scrollBy(0, 500); } catch (e) {}
            await IB.sleep(600);
          }
          return { ok: true, found: false };
        }
      };
      const fn0 = map[req.action];
      if (!fn0) return false;
      const fn = async function () {
        if (req.action !== "PING" && !(await IB.loadCfg()))
          return { ok: false, loggedIn: false, username: null, reason: IB.cfgErr, error: IB.cfgErr };
        return fn0();
      };
      fn().then(send).catch(function (e) { send({ ok: false, error: (e && e.message) || String(e) }); });
      return true;
    });
  };
  window.IB = IB;
})();
