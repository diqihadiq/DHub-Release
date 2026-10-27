// proxy.js — halaman Manajer Proxy DHub
const IS_EXT = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
let STATE = null;
let editingId = null;
const $ = (s) => document.querySelector(s);

function send(action, extra) {
  return new Promise((resolve) => {
    if (!IS_EXT) return demoSend(action, extra).then(resolve);
    try {
      chrome.runtime.sendMessage(Object.assign({ action: action }, extra || {}), (r) => {
        void chrome.runtime.lastError;
        resolve(r || { ok: false, error: "tidak ada respons" });
      });
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}
function toast(msg, ok) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (ok === false ? " err" : "");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 3000);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtTime(ms) {
  try { return new Date(ms).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch (e) { return "—"; }
}
function tidLabel(label) { return String(label || "").replace(/\s+/g, "-").toLowerCase().replace(/[^a-z0-9\-_]/g, ""); }
const PLAT_LABEL = { instagram: "IG", tiktok: "TikTok", x: "X", threads: "Threads" };

let DEMO = null;
function demoDefault() {
  return {
    ok: true,
    settings: { enabled: true, identityEnabled: true, bypassList: ["localhost", "127.0.0.1"] },
    identityProfiles: [{ id: "win10", name: "Windows 10" }, { id: "win11", name: "Windows 11" }, { id: "mac14", name: "macOS 14 (Intel)" }, { id: "mac15", name: "macOS 15 (Apple)" }, { id: "linux", name: "Linux" }],
    timezones: ["Asia/Jakarta", "Asia/Makassar", "Asia/Singapore", "Europe/London", "America/New_York"],
    proxies: [
      { id: "demo1", label: "Gerbang residensial utama", scheme: "http", host: "gate.contoso-residential.com", port: 7000, usernameTemplate: "customer-abc-session-{session}", password: "", assigned: 2 },
      { id: "demo2", label: "Cadangan (bank IPA)", scheme: "socks5", host: "pool2.contoso-residential.com", port: 1080, usernameTemplate: "user-session-{session}", password: "", assigned: 0 }
    ],
    accounts: [
      { label: "Toko Utama", username: "toko.utama", platform: "instagram", enabled: true, proxyId: "demo1", sessionMode: "sticky", cookieCount: 14, identity: { profile: "win11", ua: "", tz: "auto", tzDetected: "Asia/Jakarta" } },
      { label: "Store ID", username: "store.id", platform: "tiktok", enabled: true, proxyId: "demo1", sessionMode: "sticky", cookieCount: 9, identity: { profile: "mac14", ua: "", tz: "Asia/Singapore", tzDetected: null }, needsLogin: true },
      { label: "Akun X Milik Kiki", username: "kikii", platform: "x", enabled: true, proxyId: null, sessionMode: "sticky", cookieCount: 6 }
    ],
    applied: { proxyId: "demo1", label: "Gerbang residensial utama", sessionId: "k29fmq17xa", account: "Toko Utama" },
    lastIp: { ip: "103.24.55.12", ms: 240, at: Date.now() - 60000 },
    switchLog: [
      { at: Date.now() - 60000, type: "switch", platform: "instagram", account: "Toko Utama", proxy: "Gerbang residensial utama", detail: "Sesi diganti via proxy Gerbang residensial utama · sesi k29fmq17xa (IP sticky)" },
      { at: Date.now() - 58000, type: "ip", platform: "instagram", account: "Toko Utama", proxy: "Gerbang residensial utama", detail: "IP keluar: 103.24.55.12 (240 ms)" },
      { at: Date.now() - 3600000, type: "warn", platform: "x", account: "Akun X Milik Kiki", detail: "Akun TANPA proxy: memakai jaringan asli. Tugaskan proxy di Manajer Proxy agar IP-nya konsisten." },
      { at: Date.now() - 7200000, type: "proxy", detail: "Proxy disimpan: Gerbang residensial utama" }
    ]
  };
}

// pratinjau statis (tanpa API chrome): tiruan lokal agar semua tombol tetap bisa dicoba
async function demoSend(action, extra) {
  DEMO = DEMO || demoDefault();
  await new Promise((r) => setTimeout(r, 120));
  const uid2 = () => "demo_" + Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  const log = (type, detail) => DEMO.switchLog.unshift({ at: now, type: type, detail: detail });
  switch (action) {
    case "PROXY_GET_STATE": return Object.assign({ ok: true }, DEMO);
    case "PROXY_TOGGLE": DEMO.settings.enabled = !!extra.enabled; log("proxy", extra.enabled ? "Sistem proxy diaktifkan (pratinjau)." : "Sistem proxy dimatikan (pratinjau)."); return { ok: true };
    case "PROXY_SAVE_PROXY": {
      const p = extra.proxy;
      if (editingId) { const i = DEMO.proxies.findIndex((x) => x.id === editingId); if (i >= 0) DEMO.proxies[i] = Object.assign({}, DEMO.proxies[i], p); }
      else { p.id = uid2(); p.assigned = 0; DEMO.proxies.push(p); }
      log("proxy", "Proxy disimpan: " + (p.label || p.host));
      return { ok: true };
    }
    case "PROXY_DELETE_PROXY": DEMO.proxies = DEMO.proxies.filter((x) => x.id !== extra.id); DEMO.accounts.forEach((a) => { if (a.proxyId === extra.id) a.proxyId = null; }); log("proxy", "Proxy dihapus (pratinjau)."); return { ok: true };
    case "PROXY_ASSIGN": {
      const a = DEMO.accounts.find((x) => x.label === extra.label && x.platform === extra.platform);
      if (a) { a.proxyId = extra.proxyId || null; a.sessionMode = extra.sessionMode || a.sessionMode; }
      log("proxy", extra.proxyId ? "Proxy ditugaskan ke " + extra.label + " (pratinjau)." : "Tugasan dilepas: " + extra.label + " (pratinjau).");
      return { ok: true };
    }
    case "PROXY_ASSIGN_BULK": {
      const ts = DEMO.accounts.filter((a) => (!extra.platform || a.platform === extra.platform) && (!extra.onlyUnassigned || !a.proxyId));
      if (!ts.length) return { ok: false, error: "Tidak ada akun yang cocok dengan filter." };
      ts.forEach((a, i) => {
        if (extra.how === "clear") a.proxyId = null;
        else if (extra.how === "same") { a.proxyId = extra.proxyId; a.sessionMode = extra.sessionMode || a.sessionMode; }
        else { const p = extra.how === "random" ? DEMO.proxies[Math.floor(Math.random() * DEMO.proxies.length)] : DEMO.proxies[i % DEMO.proxies.length]; a.proxyId = p.id; a.sessionMode = extra.sessionMode || a.sessionMode; }
      });
      log("proxy", "Massal (pratinjau): " + ts.length + " akun, " + extra.how);
      return { ok: true, count: ts.length, warn: "" };
    }
    case "PROXY_APPLY_NOW": { const a = DEMO.accounts.find((x) => x.label === extra.label); const p = DEMO.proxies.find((x) => x.id === (a && a.proxyId)); DEMO.applied = p ? { proxyId: p.id, label: p.label || p.host, sessionId: "k29fmq17xa", account: extra.label } : null; return { ok: true }; }
    case "PROXY_TEST": return { ok: true, ip: "103." + (Math.floor(Math.random() * 200) + 10) + "." + (Math.floor(Math.random() * 200) + 10) + "." + (Math.floor(Math.random() * 200) + 10), ms: Math.floor(Math.random() * 400) + 120 };
    case "PROXY_CHECK_IP": return { ok: true, ip: "103.24.55.12", ms: 230 };
    case "PROXY_CLEAR_LOG": DEMO.switchLog = []; return { ok: true };
    case "PROXY_IMPORT": return { ok: false, error: "Impor hanya di dalam extension" };
    case "IDENTITY_TOGGLE": DEMO.settings.identityEnabled = !!extra.enabled; return { ok: true };
    case "IDENTITY_MODE": DEMO.settings.identityMode = extra.mode === "all" ? "all" : "proxy_only"; return { ok: true };
    case "IDENTITY_SET": {
      const a = DEMO.accounts.find((x) => x.label === extra.label && x.platform === extra.platform);
      if (!a) return { ok: false, error: "Akun tidak ditemukan." };
      a.identity = Object.assign({ profile: "win10", ua: "", tz: "auto", tzDetected: null }, a.identity || {});
      if (extra.reroll) a.identity.profile = DEMO.identityProfiles[Math.floor(Math.random() * DEMO.identityProfiles.length)].id;
      if (extra.profile) a.identity.profile = extra.profile;
      if (extra.tz != null) a.identity.tz = extra.tz || "auto";
      log("identity", "Identitas diubah: " + extra.label + " (pratinjau)");
      return { ok: true };
    }
    default: return { ok: false, error: "pratinjau" };
  }
}

async function refresh() {
  if (!IS_EXT) { DEMO = DEMO || demoDefault(); STATE = DEMO; }
  else {
    const r = await send("PROXY_GET_STATE");
    if (!r || !r.ok) { toast((r && r.error) || "Gagal memuat data", false); return; }
    STATE = r;
  }
  renderAll();
}

function renderAll() {
  if (STATE.authUnavailable && !renderAll.warned) { renderAll.warned = true; toast("Browser ini tidak mendukung login proxy (username/password). Pakai proxy dengan whitelist IP, atau aktifkan ulang DHub.", false); }
  renderStatus();
  renderProxies();
  renderAccounts();
  renderBulk();
  renderLog();
  $("#enabledToggle").checked = !!(STATE.settings && STATE.settings.enabled);
  $("#identityToggle").checked = !(STATE.settings && STATE.settings.identityEnabled === false);
  $("#identityMode").value = STATE.settings && STATE.settings.identityMode === "all" ? "all" : "proxy_only";
  $("#identityMode").disabled = !!(STATE.settings && STATE.settings.identityEnabled === false);
}

function renderStatus() {
  const chip = $("#statusChip"), ipChip = $("#ipChip");
  const st = STATE.settings || {};
  if (!st.enabled) {
    chip.textContent = "Proxy: NONAKTIF";
    chip.className = "chip off";
  } else if (STATE.perAccount && (STATE.accounts || []).some((a) => a.proxyId)) {
    const n = STATE.accounts.filter((a) => a.proxyId).length;
    chip.textContent = "Proxy: per akun (" + n + " akun)";
    chip.className = "chip on";
  } else if (STATE.applied) {
    chip.textContent = "Proxy: " + STATE.applied.label;
    chip.className = "chip on";
  } else {
    chip.textContent = "Proxy: jaringan asli";
    chip.className = "chip";
  }
  chip.title = STATE.applied && STATE.applied.sessionId ? "Sesi aktif: " + STATE.applied.sessionId : "";
  if (STATE.lastIp && STATE.lastIp.ip) {
    ipChip.textContent = "IP: " + STATE.lastIp.ip + " (" + STATE.lastIp.ms + "ms)";
    ipChip.title = "Dicek " + fmtTime(STATE.lastIp.at) + (STATE.lastIp.account ? " · akun " + STATE.lastIp.account : "");
  } else {
    ipChip.textContent = "IP: belum dicek";
  }
}

function renderProxies() {
  const box = $("#proxyList");
  if (!STATE.proxies.length) {
    box.innerHTML = '<div class="empty" data-testid="proxy-empty">Belum ada proxy. Klik “+ Tambah proxy”, isi host/port & username dari provider kamu.</div>';
    return;
  }
  box.innerHTML = STATE.proxies.map((p) => (
    '<div class="pcard" data-testid="proxy-card-' + esc(p.id) + '">' +
      '<div class="meta">' +
        '<div class="plabel">' + esc(p.label || "Proxy") + ' <span class="badge ' + esc(p.scheme) + '">' + esc(p.scheme) + '</span></div>' +
        '<div class="paddr">' + esc(p.host) + ':' + esc(p.port) + '</div>' +
        (p.usernameTemplate ? '<div class="ptpl">user: ' + esc(p.usernameTemplate) + (p.password ? " · pass: •••" : "") + '</div>' : '') +
        '<div class="passigned">dipakai <b>' + (p.assigned || 0) + '</b> akun</div>' +
      '</div>' +
      '<div class="btnrow">' +
        '<button class="btn" data-testid="proxy-test-' + esc(p.id) + '" data-act="test" data-id="' + esc(p.id) + '">Tes</button>' +
        '<button class="btn" data-testid="proxy-edit-' + esc(p.id) + '" data-act="edit" data-id="' + esc(p.id) + '">Edit</button>' +
        '<button class="btn btn-ghost danger" data-testid="proxy-delete-' + esc(p.id) + '" data-act="delete" data-id="' + esc(p.id) + '">Hapus</button>' +
      '</div>' +
    '</div>'
  )).join("");
}

function renderAccounts() {
  const box = $("#accountList");
  if (!STATE.accounts.length) {
    box.innerHTML = '<div class="empty" data-testid="account-empty">Belum ada akun tersimpan. Tambah akun lewat Dashboard → tab Akun → Tambah akun, lalu tugaskan proxy-nya di sini.</div>';
    return;
  }
  const opts = (selected) => (
    '<option value=""' + (!selected ? " selected" : "") + '>Tanpa proxy (jaringan asli)</option>' +
    STATE.proxies.map((p) => '<option value="' + esc(p.id) + '"' + (selected === p.id ? " selected" : "") + '>' + esc(p.label || p.host) + '</option>').join("")
  );
  const profs = STATE.identityProfiles || [];
  const tzList = '<datalist id="tzList">' + (STATE.timezones || []).map((z) => '<option value="' + esc(z) + '">').join("") + "</datalist>";
  box.innerHTML = tzList + STATE.accounts.map((a) => {
    const t = tidLabel(a.label);
    const id = a.identity || null;
    const profOpts = '<option value=""' + (!id ? " selected" : "") + '>Otomatis (dibuat saat dipakai)</option>' + profs.map((p) => '<option value="' + esc(p.id) + '"' + (id && id.profile === p.id && !id.ua ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + (id && id.ua ? '<option value="" selected>Kustom</option>' : "");
    const tzVal = id && id.tz && id.tz !== "auto" ? id.tz : "";
    const det = tzVal ? "zona waktu manual: " + tzVal : (id && id.tzDetected ? "terdeteksi: " + id.tzDetected : "zona waktu otomatis ikut IP proxy");
    return (
      '<div class="arow" data-testid="account-row-' + t + '">' +
        '<div class="aident">' +
          '<div class="alabel"><span class="plat ' + esc(a.platform) + '">' + esc(PLAT_LABEL[a.platform] || a.platform) + '</span> ' + esc(a.label) + (a.needsLogin ? ' <span class="badge relogin" data-testid="account-needs-login-' + t + '">Perlu login ulang</span>' : "") + '</div>' +
          '<div class="auser">' + (a.username ? "@" + esc(a.username) : "username tidak terdeteksi") + ' · ' + a.cookieCount + ' cookie</div>' +
        '</div>' +
        '<div class="asel">' +
          '<select data-testid="account-proxy-select-' + t + '" data-act="assign-proxy" data-label="' + esc(a.label) + '" data-platform="' + esc(a.platform) + '">' + opts(a.proxyId) + '</select>' +
          '<select class="mode" data-testid="account-mode-select-' + t + '" data-act="assign-mode" data-label="' + esc(a.label) + '" data-platform="' + esc(a.platform) + '">' +
            '<option value="sticky"' + (a.sessionMode === "sticky" ? " selected" : "") + '>Sticky (IP sama)</option>' +
            '<option value="rotate"' + (a.sessionMode === "rotate" ? " selected" : "") + '>Ganti IP tiap pakai</option>' +
          '</select>' +
          '<button class="btn" data-testid="account-apply-' + t + '" data-act="apply" data-label="' + esc(a.label) + '" data-platform="' + esc(a.platform) + '">Terapkan sekarang</button>' +
        '</div>' +
        '<div class="aid" data-testid="account-identity-' + t + '">' +
          '<span class="k">Identitas</span>' +
          '<select data-testid="account-identity-profile-' + t + '" data-act="id-profile" data-label="' + esc(a.label) + '" data-platform="' + esc(a.platform) + '">' + profOpts + '</select>' +
          '<input list="tzList" data-testid="account-identity-tz-' + t + '" data-act="id-tz" data-label="' + esc(a.label) + '" data-platform="' + esc(a.platform) + '" placeholder="Zona waktu: otomatis" value="' + esc(tzVal) + '" spellcheck="false">' +
          '<button class="btn btn-sm" data-testid="account-identity-save-' + t + '" data-act="id-save" data-label="' + esc(a.label) + '" data-platform="' + esc(a.platform) + '">Simpan</button>' +
          '<button class="btn btn-ghost btn-sm" data-testid="account-identity-reroll-' + t + '" data-act="id-reroll" data-label="' + esc(a.label) + '" data-platform="' + esc(a.platform) + '" title="Pilih sistem operasi acak baru">Acak ulang</button>' +
          '<span class="det">' + esc(det) + '</span>' +
        '</div>' +
      '</div>'
    );
  }).join("");
}

function renderLog() {
  const box = $("#switchLog");
  if (!STATE.switchLog || !STATE.switchLog.length) {
    box.innerHTML = '<li data-testid="log-empty"><span class="lmsg">Belum ada aktivitas. Log terisi otomatis setiap DHub mengganti akun / proxy saat task berjalan.</span></li>';
    return;
  }
  box.innerHTML = STATE.switchLog.map((e) => (
    '<li data-testid="log-entry">' +
      '<span class="lt">' + fmtTime(e.at) + '</span>' +
      '<span class="ltype ' + esc(e.type || "proxy") + '">' + esc(e.type || "proxy") + '</span>' +
      '<span class="lmsg">' + (e.account ? "<b>" + esc(PLAT_LABEL[e.platform] || e.platform || "") + " · " + esc(e.account) + "</b> — " : "") + esc(e.detail || "") + '</span>' +
    '</li>'
  )).join("");
}

// ---------- atur proxy massal ----------
function renderBulk() {
  const sel = $("#bulkProxy"), cur = sel.value;
  sel.innerHTML = STATE.proxies.length
    ? STATE.proxies.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.label || p.host) + "</option>").join("")
    : '<option value="">(belum ada proxy)</option>';
  if (cur && STATE.proxies.some((p) => p.id === cur)) sel.value = cur;
  updateBulkHint();
}
function updateBulkHint() {
  const p = STATE.proxies.find((x) => x.id === $("#bulkProxy").value);
  const h = $("#bulkHint");
  if (!p) { h.textContent = "Tambah proxy dulu di atas, lalu tugaskan ke akun."; return; }
  h.textContent = String(p.usernameTemplate || "").indexOf("{session}") >= 0
    ? "Proxy ini memakai {session}: satu gateway cukup untuk semua akun, tiap akun tetap mendapat IP-nya sendiri."
    : "Proxy ini tanpa {session}: semua akun yang memakainya berbagi IP yang sama. Untuk IP berbeda per akun, pakai gateway dengan {session} atau bagi ke beberapa proxy.";
}
async function bulkAssign(how) {
  const proxyId = $("#bulkProxy").value, platform = $("#bulkPlat").value, only = $("#bulkOnlyNew").checked;
  if (how === "same" && !proxyId) { toast("Pilih proxy dulu", false); return; }
  if ((how === "roundrobin" || how === "random") && !STATE.proxies.length) { toast("Belum ada proxy", false); return; }
  const n = STATE.accounts.filter((a) => (!platform || a.platform === platform) && (!only || !a.proxyId)).length;
  if (!n) { toast("Tidak ada akun yang cocok dengan filter", false); return; }
  const what = { same: "pakai proxy terpilih", roundrobin: "dibagi rata ke semua proxy", random: "diberi proxy acak", clear: "dilepas dari proxy" }[how];
  if (!confirm(n + " akun akan " + what + ". Lanjutkan?")) return;
  const r = await send("PROXY_ASSIGN_BULK", { how, proxyId, sessionMode: $("#bulkMode").value, platform: platform || undefined, onlyUnassigned: only });
  if (!r || !r.ok) { toast((r && r.error) || "Gagal mengatur proxy massal", false); return; }
  toast(r.count + " akun diperbarui" + (r.warn ? " · " + r.warn : ""), !r.warn);
  await refresh();
}
$("#bulkSame").addEventListener("click", () => bulkAssign("same"));
$("#bulkRR").addEventListener("click", () => bulkAssign("roundrobin"));
$("#bulkRandom").addEventListener("click", () => bulkAssign("random"));
$("#bulkClear").addEventListener("click", () => bulkAssign("clear"));
$("#bulkProxy").addEventListener("change", updateBulkHint);

function openForm(p) {
  editingId = p ? p.id : null;
  $("#fLabel").value = p ? (p.label || "") : "";
  $("#fScheme").value = p ? (p.scheme || "http") : "http";
  $("#fHost").value = p ? (p.host || "") : "";
  $("#fPort").value = p ? (p.port || "") : "";
  $("#fUser").value = p ? (p.usernameTemplate || "") : "";
  $("#fPass").value = p ? (p.password || "") : "";
  $("#proxyForm").hidden = false;
  $("#fLabel").focus();
}
function closeForm() { $("#proxyForm").hidden = true; editingId = null; }

$("#btnOpenForm").addEventListener("click", () => openForm(null));
$("#btnFormCancel").addEventListener("click", closeForm);
$("#proxyForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const payload = {
    id: editingId || undefined,
    label: $("#fLabel").value,
    scheme: $("#fScheme").value,
    host: $("#fHost").value.trim(),
    port: Number($("#fPort").value),
    usernameTemplate: $("#fUser").value.trim(),
    password: $("#fPass").value
  };
  if (!payload.host || !payload.port) { toast("Host & port wajib diisi", false); return; }
  const r = await send("PROXY_SAVE_PROXY", { proxy: payload });
  if (!r || !r.ok) { toast((r && r.error) || "Gagal menyimpan", false); return; }
  closeForm();
  toast("Proxy tersimpan" + (IS_EXT ? "" : " (mode pratinjau)"));
  await refresh();
});
$("#proxyList").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === "edit") {
    openForm(STATE.proxies.find((p) => p.id === id));
  } else if (btn.dataset.act === "delete") {
    if (!confirm("Hapus proxy ini? Tugasannya di semua akun juga dilepas.")) return;
    const r = await send("PROXY_DELETE_PROXY", { id });
    if (!r || !r.ok) { toast((r && r.error) || "Gagal menghapus", false); return; }
    toast("Proxy dihapus");
    await refresh();
  } else if (btn.dataset.act === "test") {
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "Menguji…";
    const r = await send("PROXY_TEST", { id });
    btn.disabled = false;
    btn.textContent = old;
    if (r && r.ok) toast("IP lewat proxy: " + r.ip + " (" + r.ms + " ms)");
    else toast((r && r.error) || "Tes gagal", false);
    await refresh();
  }
});
$("#accountList").addEventListener("change", async (ev) => {
  const sel = ev.target.closest("select[data-act]");
  if (!sel || sel.dataset.act === "id-profile") return;
  const label = sel.dataset.label, platform = sel.dataset.platform;
  const row = sel.closest(".arow");
  const modeSel = row.querySelector("select[data-act='assign-mode']");
  const proxySel = row.querySelector("select[data-act='assign-proxy']");
  if (sel.dataset.act === "assign-proxy") {
    const r = await send("PROXY_ASSIGN", { label, platform, proxyId: sel.value || null, sessionMode: modeSel.value });
    if (!r || !r.ok) { toast((r && r.error) || "Gagal menugaskan", false); return; }
    toast(sel.value ? "Proxy ditugaskan ke " + label : "Tugasan dilepas — akun memakai jaringan asli");
    await refresh();
  } else if (sel.dataset.act === "assign-mode") {
    const r = await send("PROXY_ASSIGN", { label, platform, proxyId: proxySel.value || null, sessionMode: sel.value });
    if (!r || !r.ok) { toast((r && r.error) || "Gagal mengubah mode", false); return; }
    toast(sel.value === "sticky" ? "Sticky: 1 akun selalu 1 IP yang sama" : "Ganti IP: IP baru tiap akun dipakai");
    await refresh();
  }
});
$("#accountList").addEventListener("click", async (ev) => {
  const idb = ev.target.closest("button[data-act='id-save'], button[data-act='id-reroll']");
  if (idb) {
    const row = idb.closest(".aid"), label = idb.dataset.label, platform = idb.dataset.platform;
    const payload = idb.dataset.act === "id-reroll" ? { label, platform, reroll: true } : { label, platform, profile: row.querySelector("select").value || undefined, tz: row.querySelector("input").value.trim() || "auto" };
    if (payload.profile === undefined && idb.dataset.act === "id-save") delete payload.profile;
    idb.disabled = true;
    const r = await send("IDENTITY_SET", payload);
    idb.disabled = false;
    if (!r || !r.ok) { toast((r && r.error) || "Gagal menyimpan identitas", false); return; }
    toast(idb.dataset.act === "id-reroll" ? "Identitas baru dibuat untuk " + label : "Identitas " + label + " disimpan");
    await refresh();
    return;
  }
  const btn = ev.target.closest("button[data-act='apply']");
  if (!btn) return;
  btn.disabled = true;
  const r = await send("PROXY_APPLY_NOW", { label: btn.dataset.label, platform: btn.dataset.platform });
  btn.disabled = false;
  if (r && r.ok) toast("Proxy akun “" + btn.dataset.label + "” diterapkan ke browser");
  else toast((r && r.error) || "Gagal menerapkan", false);
  await refresh();
});
$("#enabledToggle").addEventListener("change", async (ev) => {
  const r = await send("PROXY_TOGGLE", { enabled: ev.target.checked });
  if (!r || !r.ok) { toast((r && r.error) || "Gagal mengubah setelan", false); await refresh(); return; }
  toast(ev.target.checked ? "Sistem proxy aktif" : "Sistem proxy mati — jaringan asli dipakai");
  await refresh();
});
$("#identityToggle").addEventListener("change", async (ev) => {
  const r = await send("IDENTITY_TOGGLE", { enabled: ev.target.checked });
  if (!r || !r.ok) { toast((r && r.error) || "Gagal mengubah setelan", false); await refresh(); return; }
  toast(ev.target.checked ? "Identitas per akun aktif" : "Identitas per akun mati — tab memakai identitas asli browser");
  await refresh();
});
$("#identityMode").addEventListener("change", async (ev) => {
  const r = await send("IDENTITY_MODE", { mode: ev.target.value });
  if (!r || !r.ok) { toast((r && r.error) || "Gagal mengubah setelan", false); await refresh(); return; }
  toast(ev.target.value === "all" ? "Identitas acak untuk semua akun" : "Akun tanpa proxy memakai perangkat & zona waktu asli");
  await refresh();
});
$("#btnRefreshIp").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  const r = await send("PROXY_CHECK_IP");
  btn.disabled = false;
  if (r && r.ok) { toast("IP keluar sekarang: " + r.ip + " (" + r.ms + " ms)"); STATE.lastIp = { ip: r.ip, ms: r.ms, at: Date.now() }; renderStatus(); }
  else toast("Cek IP gagal — trafik sedang tidak bisa lewat proxy", false);
});
$("#btnClearLog").addEventListener("click", async () => {
  if (!confirm("Bersihkan semua log aktivitas?")) return;
  await send("PROXY_CLEAR_LOG");
  toast("Log dibersihkan");
  await refresh();
});
$("#btnExportLog").addEventListener("click", () => {
  const data = JSON.stringify({ app: "DHub", kind: "switch_log", exportedAt: new Date().toISOString(), log: STATE.switchLog || [] }, null, 2);
  download("dhub-log-ganti-akun.json", data);
});
$("#btnExportCfg").addEventListener("click", () => {
  const data = JSON.stringify({
    app: "DHub", kind: "proxy_config", exportedAt: new Date().toISOString(),
    proxies: STATE.proxies.map(({ assigned, ...p }) => p),
    assignments: (STATE.accounts || []).filter((a) => a.proxyId).map((a) => ({ label: a.label, platform: a.platform, proxyId: a.proxyId, sessionMode: a.sessionMode }))
  }, null, 2);
  download("dhub-konfigurasi-proxy.json", data);
});
$("#btnImportCfg").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const r = await send("PROXY_IMPORT", { data });
    if (!r || !r.ok) { toast((r && r.error) || "Impor gagal", false); return; }
    toast("Konfigurasi proxy diimpor");
    await refresh();
  } catch (e) { toast("File tidak valid: " + e.message, false); }
  finally { ev.target.value = ""; }
});
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

if (!IS_EXT) { document.title += " (pratinjau)"; }
refresh().catch((e) => toast(String(e), false));
