const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const send = (m) => new Promise((r) => chrome.runtime.sendMessage(m, (x) => { void chrome.runtime.lastError; r(x); }));
const PORDER = ["instagram", "tiktok", "x", "threads"];
const PNAME = { instagram: "Instagram", tiktok: "TikTok", x: "X", threads: "Threads" };
const PSHORT = { instagram: "IG", tiktok: "TT", x: "X", threads: "Th" };
const HOSTS = { instagram: /(^|\.)instagram\.com$/, tiktok: /(^|\.)tiktok\.com$/, x: /(^|\.)(x|twitter)\.com$/, threads: /(^|\.)threads\.(com|net)$/ };
const PH = {
  instagram: { post: "https://www.instagram.com/p/XXXX/", comment: "https://www.instagram.com/p/XXXX/?comment_id=123", profile: "https://www.instagram.com/username/" },
  tiktok: { post: "https://www.tiktok.com/@user/video/123", comment: "https://www.tiktok.com/@user/video/123?cid=456", profile: "https://www.tiktok.com/@username" },
  x: { post: "https://x.com/user/status/123", comment: "https://x.com/user/status/456 (link balasan)", profile: "https://x.com/username" },
  threads: { post: "https://www.threads.com/@user/post/XXXX", comment: "https://www.threads.com/@user/post/YYYY (link balasan)", profile: "https://www.threads.com/@username" }
};
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
};
const MARK = { ok: '<b class="mk ok">OK</b>', bad: '<b class="mk bad">X</b>' };
let S = { tasks: [], accounts: [], history: [], log: [], running: false, stopping: false, runningTask: null, progress: null, license: null, licState: null, licExpired: null, used: {}, reportAuto: true, screen: "auto", disp: { width: 1280, height: 720 }, cap: 1 };
let UI = { q: "", limit: 50 };
let ED = { p: "instagram", id: null };
let dlgOpen = false;

const platOf = (a) => a.platform || "instagram";
const accKey = (a) => platOf(a) + ":" + a.label;
const keyPlat = (k) => String(k).split(":")[0];
const lines = (s) => String(s || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const urlPlat = (u) => { try { const h = new URL(u).hostname; for (const k of PORDER) if (HOSTS[k].test(h)) return k; } catch (e) {} return null; };
const fmtDate = (ts) => new Date(ts).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (ts) => new Date(ts).toLocaleTimeString("id-ID", { hour12: false });
const fmtElapsed = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const toLocalInput = (ts) => { const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

/* ---------- profil layar (logika sama dengan background.js) ---------- */
const PROFILE_LABEL = { auto: "Otomatis", laptop: "Laptop / Mac", big: "Monitor besar", single: "Satu jendela" };
function resolveProfile(p, a) { if (p === "laptop" || p === "big" || p === "single") return p; return (a.width >= 2200 && a.height >= 1100) ? "big" : "laptop"; }
function tabCap(profile, a) {
  const fit = Math.max(1, Math.floor(a.width / 700)) * Math.max(1, Math.floor(a.height / 500));
  return Math.max(1, Math.min(profile === "single" ? 1 : (profile === "laptop" ? 2 : 6), fit, 6));
}
async function getDisp() {
  try { const ds = await chrome.system.display.getInfo(); const d = ds.find((x) => x.isPrimary) || ds[0]; if (d && d.workArea) return { width: d.workArea.width, height: d.workArea.height }; } catch (e) {}
  return { width: 1280, height: 720 };
}
const profLabelNow = () => PROFILE_LABEL[resolveProfile(S.screen, S.disp)];

/* ---------- util murni (dites) ---------- */
function parseRange(text, max) {
  const t = String(text || "").replace(/\s*-\s*/g, "-").trim();
  const nums = new Set();
  if (!t) return { nums, err: "", empty: true };
  for (const tok of t.split(/[,;\s]+/).filter(Boolean)) {
    let m = tok.match(/^(\d+)$/), a, b;
    if (m) { a = b = +m[1]; } else if ((m = tok.match(/^(\d+)-(\d+)$/))) { a = +m[1]; b = +m[2]; } else return { nums, err: "Format tidak dikenali: " + tok };
    if (a < 1 || b < a || b > max) return { nums, err: "Di luar jangkauan (1-" + max + "): " + tok };
    for (let k = a; k <= b; k++) nums.add(k);
  }
  return { nums, err: "" };
}
function compressNums(arr) {
  const a = [...arr].sort((x, y) => x - y), out = [];
  for (let i = 0; i < a.length;) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? a[i] + "-" + a[j] : String(a[i])); i = j + 1; }
  return out.join(", ");
}
function classify(text, p) {
  const ls = lines(text), ok = ls.filter((u) => urlPlat(u) === p);
  return { total: ls.length, ok: ok.length, foreign: ls.length - ok.length };
}

/* ---------- migrasi ke UI v2: tiap task milik satu platform ---------- */
function migrateTasks(tasks) {
  const out = [];
  for (const t of tasks) {
    if (t.platform) { out.push(t); continue; }
    let plats = [...new Set((t.accounts || []).map(keyPlat).filter((p) => PORDER.includes(p)))];
    if (!plats.length) {
      const fu = [...new Set([...(t.urls || []), ...(t.commentLinks || []), ...(t.profileLinks || [])].map(urlPlat).filter(Boolean))];
      plats = fu.length ? fu : ["instagram"];
    }
    plats.forEach((p, idx) => {
      const keep = (arr) => (arr || []).filter((u) => urlPlat(u) === p);
      const urls = keep(t.urls), links = keep(t.commentLinks), prof = keep(t.profileLinks);
      const nt = Object.assign({}, t, { platform: p, accounts: (t.accounts || []).filter((k) => keyPlat(k) === p), urls, commentLinks: links, profileLinks: prof, actions: { comment: urls.length > 0, likeComment: links.length > 0, followProfile: prof.length > 0 } });
      if (!nt.actions.comment && !nt.actions.likeComment && !nt.actions.followProfile) nt.actions.comment = true;
      if (idx > 0) { nt.id = t.id + "_" + p; nt.name = t.name + " · " + PNAME[p]; nt.scheduleEnabled = false; delete nt.lastResult; }
      out.push(nt);
    });
  }
  return out;
}

/* ---------- state & storage ---------- */
async function load() {
  let s = await chrome.storage.local.get(null);
  if (!s.tasks && (s.form_urls || s.form_comments)) { // data format paling lama (sebelum ada daftar task): jadikan satu task
    const lns = (x) => String(x || "").split(/\r?\n/).map((y) => y.trim()).filter(Boolean);
    await chrome.storage.local.set({ tasks: [{ id: "t" + Date.now(), name: "Task dari versi lama", accounts: (s.saved_accounts || []).filter((a) => a.enabled !== false).map(accKey), comments: lns(s.form_comments), urls: lns(s.form_urls), commentLinks: lns(s.form_commentLinks), delayPost: parseFloat(s.form_delayPost) || 2, delayAccount: parseFloat(s.form_delayAccount) || 3, concurrency: s.concurrencyPerAccount || 1, autoLike: s.form_autoLike !== false, skipUsed: s.form_skipUsed !== false, screenshot: !!s.form_autoShot }] });
    s = await chrome.storage.local.get(null);
  }
  if (!s.ui_v2) {
    await chrome.storage.local.set({ tasks: migrateTasks(s.tasks || []), ui_v2: true });
    s = await chrome.storage.local.get(null);
  }
  const disp = await getDisp(); // dihitung SEBELUM menyusun S supaya load() yang tumpang-tindih tidak meninggalkan S setengah jadi
  S = {
    tasks: s.tasks || [], accounts: s.saved_accounts || [], history: s.history || [], log: s.job_log || [],
    running: !!s.is_running, stopping: !!s.stopping, runningTask: s.running_task || null, progress: s.job_progress || null,
    license: s.license_key || null, licState: s.license_state || null, licExpired: s.license_expired || null,
    used: s.used_comments || {}, reportAuto: s.report_auto !== false, verify: s.verify_comments === true, screen: s.screen_profile || "auto", disp
  };
  S.cap = tabCap(resolveProfile(S.screen, disp), disp);
  render();
}
const saveTasks = () => chrome.storage.local.set({ tasks: S.tasks });
const saveAccounts = () => chrome.storage.local.set({ saved_accounts: S.accounts });
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }

/* ---------- status task berjalan ---------- */
function runningPlatform() {
  if (!S.running) return null;
  const t = S.tasks.find((x) => x.id === S.runningTask);
  return (t && t.platform) || (S.progress && S.progress.platform) || null;
}
function runStatus() {
  if (!S.running) return null;
  const pg = S.progress || {}, t = S.tasks.find((x) => x.id === S.runningTask);
  const name = (t && t.name) || pg.name || "task", plat = (t && t.platform) || pg.platform || null;
  const parts = [];
  if (pg.accTotal) parts.push("Akun " + pg.acc + " dari " + pg.accTotal);
  if (pg.item) parts.push(pg.item);
  parts.push(fmtElapsed(pg.startedAt ? Date.now() - pg.startedAt : 0), "sukses " + (pg.ok || 0), "dilewati " + (pg.skip || 0), "gagal " + (pg.fail || 0));
  const pct = pg.accTotal ? Math.max(2, Math.min(100, Math.round((pg.acc / pg.accTotal) * 100))) : 2;
  return { name, plat, detail: parts.join(" · "), pct, title: S.stopping ? "Menghentikan..." : "Sedang berjalan · " + name + (plat ? " (" + PNAME[plat] + ")" : "") };
}
function liveUpdate() {
  const st = runStatus(); if (!st) return;
  document.querySelectorAll('[data-pg="detail"]').forEach((e) => { e.textContent = st.detail; });
  document.querySelectorAll('[data-pg="bar"]').forEach((e) => { e.style.width = st.pct + "%"; });
}
const stopBtn = (cls) => '<button class="btn stop ' + (cls || "") + '" data-act="stop"' + (S.stopping ? " disabled" : "") + ">" + ICON.stop + (S.stopping ? "Menghentikan..." : "Stop sekarang") + "</button>";
function runBar() {
  const st = runStatus(); if (!st) return "";
  return '<div class="runbar"><span class="dot"></span><div class="rb-t"><b>' + esc(st.title) + '</b><small data-pg="detail">' + esc(st.detail) + "</small></div>" + stopBtn() + "</div>";
}

/* ---------- navigasi ---------- */
function route() {
  const h = (location.hash || "#home").slice(1).split("/");
  if (PORDER.includes(h[0])) return { page: "platform", p: h[0], tab: ["tasks", "accounts", "history"].includes(h[1]) ? h[1] : "tasks" };
  if (h[0] === "advanced" || h[0] === "guide") return { page: h[0] };
  return { page: "home" };
}
function renderNav() {
  const r = route(), rp = runningPlatform();
  const item = (href, label, on, dot) => '<a href="' + href + '" class="' + (on ? "on" : "") + '">' + label + (dot ? '<i class="rdot"></i>' : "") + "</a>";
  $("nav").innerHTML = item("#home", "Beranda", r.page === "home") + '<div class="nav-h">Platform</div>' +
    PORDER.map((p) => item("#" + p, PNAME[p], r.page === "platform" && r.p === p, rp === p)).join("") +
    '<div class="nav-h">Lainnya</div>' + item("#advanced", "Lanjutan", r.page === "advanced") + item("#guide", "Panduan", r.page === "guide");
}

/* ---------- halaman ---------- */
function gate() {
  return '<div class="top"><div><h1>Aktivasi licence</h1><p>Masukkan sekali saja. 1 licence untuk 1 device.</p></div></div>' +
    '<div class="panel pad" style="max-width:420px"><input type="text" id="licKey" placeholder="DH-XXXX-XXXX-XXXX" style="text-transform:uppercase" />' +
    '<div class="row"><button class="btn primary" data-act="activate">Aktifkan</button><span class="muted" id="licMsg"></span></div></div>';
}
function histPlat(x) { return x.platform || ((S.tasks.find((t) => t.id === x.taskId) || S.tasks.find((t) => t.name === x.name) || {}).platform) || null; }
function histRow(x, withPlat) {
  const p = histPlat(x), R = x.results || [];
  const acts = R.length ? '<div class="ha"><button class="btn sm" data-act="histdetail" data-id="' + esc(x.id) + '" data-testid="history-detail-btn-' + esc(x.id) + '">' + (OPEN.has(x.id) ? "Tutup tabel" : "Tabel hasil (" + R.length + ")") + '</button><button class="btn sm" data-act="histcsv" data-id="' + esc(x.id) + '" data-testid="history-csv-btn-' + esc(x.id) + '">Export CSV</button></div>' : "";
  return '<div class="hist" data-testid="history-row-' + esc(x.id) + '">' + (x.ok ? MARK.ok : MARK.bad) + '<div class="b"><b>' + esc(x.name) + (withPlat && p ? " · " + PNAME[p] : "") + '</b><span class="t">' + esc(x.text) + "</span>" + acts + '</div><span class="muted mono" style="font-size:11px">' + fmtDate(x.at) + " " + fmtTime(x.at) + "</span></div>" +
    (R.length && OPEN.has(x.id) ? '<div class="rwrap" data-testid="history-table-' + esc(x.id) + '">' + resultsTable(R) + "</div>" : "");
}
/* ---------- tabel hasil per akun & per link + CSV ---------- */
const OPEN = new Set();
const ST_CLS = { "sukses": "ok", "sukses terverifikasi": "ok", "terkirim tapi tidak tampil": "warn", "gagal": "bad", "dilewati": "skip" };
function resultsTable(R) {
  const by = {}, order = [];
  R.forEach((r) => { const k = (r.platform || "") + ":" + r.label; if (!by[k]) { by[k] = []; order.push(k); } by[k].push(r); });
  const body = order.map((k) => {
    const rs = by[k], a = rs[0], n = (f) => rs.filter(f).length;
    const sum = [n((r) => /^sukses/.test(r.status)) + " sukses", n((r) => r.status === "terkirim tapi tidak tampil") + " tidak tampil", n((r) => r.status === "gagal") + " gagal", n((r) => r.status === "dilewati") + " dilewati"].filter((s) => !/^0 /.test(s)).join(" · ");
    return '<tr class="grp"><td colspan="4">' + esc(a.label) + (a.username ? ' <span class="muted">@' + esc(a.username) + "</span>" : "") + '</td><td class="muted">' + esc(sum) + "</td></tr>" +
      rs.map((r) => '<tr><td></td><td>' + esc(r.kind) + '</td><td class="u"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a></td><td><span class="st ' + (ST_CLS[r.status] || "") + '">' + esc(r.status) + '</span></td><td class="d">' + esc(r.detail || "") + "</td></tr>").join("");
  }).join("");
  return '<table class="rtab"><thead><tr><th>Akun</th><th>Aksi</th><th>Link</th><th>Status</th><th>Keterangan</th></tr></thead><tbody>' + body + "</tbody></table>";
}
function resultsCsv(x) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const rows = [["Waktu", "Task", "Akun", "Username", "Platform", "Aksi", "Link", "Status", "Keterangan"]].concat((x.results || []).map((r) => [new Date(r.at).toLocaleString("id-ID"), x.name, r.label, r.username ? "@" + r.username : "", PNAME[r.platform] || r.platform, r.kind, r.url, r.status, r.detail]));
  return "\ufeff" + rows.map((r) => r.map(q).join(";")).join("\r\n");
}

function pageHome(li) {
  const cnt = {}, tcnt = {};
  PORDER.forEach((p) => { cnt[p] = S.accounts.filter((a) => platOf(a) === p).length; tcnt[p] = S.tasks.filter((t) => t.platform === p).length; });
  const rp = runningPlatform(), st = runStatus();
  const cards = PORDER.map((p) => {
    const isRun = rp === p, pg = S.progress || {};
    return '<div class="pcard' + (isRun ? " run" : "") + '"><div class="ph"><span class="pbadge">' + PSHORT[p] + "</span>" + PNAME[p] + "</div>" +
      '<div class="cnt"><span><b>' + cnt[p] + "</b>akun</span><span><b>" + tcnt[p] + "</b>task</span></div>" +
      '<div class="st' + (isRun ? " on" : "") + '"><i class="sdot' + (isRun ? " on" : "") + '"></i>' + (isRun ? "Berjalan" + (pg.accTotal ? " · " + pg.acc + "/" + pg.accTotal : "") : "Siap") + "</div>" +
      '<a class="btn' + (isRun ? " primary" : "") + '" href="#' + p + '">Buka ' + PNAME[p] + "</a></div>";
  }).join("");
  const run = st ? '<div class="runpanel"><span class="sdot on"></span><div class="rp-t"><b>' + esc(st.title) + '</b><small data-pg="detail">' + esc(st.detail) + '</small></div><div class="pbar"><i data-pg="bar" style="width:' + st.pct + '%"></i></div>' + stopBtn() + "</div>" : "";
  const h = S.history.slice(0, 3).map((x) => histRow(x, true)).join("");
  return '<div class="top hero" style="display:block"><div style="display:flex;align-items:center"><div><h1>Mau jalankan di platform mana?</h1></div><div class="chips"><span class="badge">' + esc(li.text) + '</span><span class="mono" data-clock>--:--:--</span></div></div></div>' +
    '<p class="muted" style="margin:-8px 0 18px">Akun, task, dan pengaturan layar dipisah per platform supaya tidak tercampur.</p>' +
    '<div class="cards4">' + cards + "</div>" + run +
    '<div class="two"><div class="panel pad"><h3>Riwayat terbaru</h3>' + (h || '<div class="muted" style="padding:8px 0">Belum ada riwayat.</div>') + '</div>' +
    '<div class="panel pad"><h3>Lainnya</h3><a class="linkbtn" href="#advanced">Lanjutan dan licence</a><a class="linkbtn" href="#guide">Panduan</a></div></div>';
}

function taskMeta(t) {
  const A = t.actions || {};
  const bits = [(S.accounts.filter((a) => (t.accounts || []).includes(accKey(a))).length) + " akun"];
  if (A.comment !== false && (t.urls || []).length) bits.push(t.urls.length + " URL", (t.comments || []).length + " draft komentar");
  if (A.likeComment !== false && (t.commentLinks || []).length) bits.push(t.commentLinks.length + " like komentar");
  if (A.followProfile !== false && (t.profileLinks || []).length) bits.push(t.profileLinks.length + " follow profil");
  if (t.platform === "instagram") bits.push(Math.min(t.concurrency || 1, S.cap) + " tab", "Profil " + profLabelNow());
  return bits.join(" · ");
}
function taskRow(t) {
  const isRun = S.running && S.runningTask === t.id, lr = t.lastResult, st = isRun ? runStatus() : null;
  const when = t.scheduleAt ? '<div class="when' + (t.scheduleEnabled ? "" : " off") + '"><small>' + fmtDate(t.scheduleAt) + '</small><span class="mono">' + fmtTime(t.scheduleAt) + "</span></div>" : '<div class="when off"><small>Manual</small><span class="mono">--:--:--</span></div>';
  const sw = t.scheduleAt ? '<div class="sw"><label class="switch"><input type="checkbox" data-act="sched" data-id="' + t.id + '" ' + (t.scheduleEnabled ? "checked" : "") + '><i></i></label>Jadwal aktif</div>' : "";
  const rs = !isRun && t.resume && t.resume.remaining > 0 ? t.resume : null;
  return '<div class="task"><div class="whenbox">' + when + sw + "</div><div><h4>" + esc(t.name) + (isRun ? ' <span class="badge warn">Berjalan</span>' : (t.scheduleEnabled ? ' <span class="badge dark">Terjadwal</span>' : ' <span class="badge">Manual</span>')) + "</h4>" +
    '<div class="meta">' + esc(taskMeta(t)) + "</div>" +
    (st ? '<div class="tprog"><div class="pbar"><i data-pg="bar" style="width:' + st.pct + '%"></i></div><span data-pg="detail">' + esc(st.detail) + "</span></div>" : (lr ? '<div class="res ' + (lr.ok ? "ok" : "bad") + '" style="margin-top:6px">' + (lr.ok ? MARK.ok : MARK.bad) + '<span class="t">' + esc(lr.text) + "</span></div>" : "")) + "</div>" +
    '<div class="acts">' + (isRun ? stopBtn("sm") : '<button class="btn sm" data-act="run" data-id="' + t.id + '" data-testid="task-run-btn-' + t.id + '"' + (S.running ? " disabled" : "") + (rs ? ' title="Mulai dari awal"' : "") + ">" + ICON.play + (rs ? "Mulai dari awal" : "Jalankan") + "</button>") +
    (rs ? '<button class="btn sm" data-act="runfailed" data-id="' + t.id + '" data-testid="task-resume-failed-btn-' + t.id + '"' + (S.running ? " disabled" : "") + ' title="Lewati item yang sudah sukses; ulangi yang gagal dan yang belum sempat diproses">Ulangi yang gagal saja (' + rs.remaining + ")</button>" : "") +
    '<button class="ibtn" data-act="edit" data-id="' + t.id + '" title="Edit">' + ICON.edit + '</button><button class="ibtn" data-act="del" data-id="' + t.id + '" title="Hapus">' + ICON.trash + "</button></div></div>";
}

function accRows(p) {
  const all = S.accounts.map((a, i) => ({ a, i })).filter((o) => platOf(o.a) === p).map((o, n) => Object.assign(o, { n: n + 1 }));
  const q = UI.q.trim().toLowerCase();
  const f = q ? all.filter((o) => (o.a.label + " " + (o.a.username || "")).toLowerCase().includes(q)) : all;
  const shown = f.slice(0, UI.limit);
  const rows = shown.map((o) => '<div class="acc"><span class="no">' + o.n + '</span><label class="switch"><input type="checkbox" data-act="accon" data-i="' + o.i + '" ' + (o.a.enabled !== false ? "checked" : "") + '><i></i></label><div class="n"><b>' + esc(o.a.label) + "</b> " +
    (o.a.username ? '<span class="muted">@' + esc(o.a.username) + "</span>" : "") + (o.a.enabled === false ? ' <span class="badge warn">Nonaktif</span>' : "") + (o.a.needsLogin ? ' <span class="badge bad" data-testid="acc-needs-login-' + o.i + '" title="' + esc(o.a.needsLoginReason || "") + '">Perlu login ulang</span>' : "") + '</div><span class="muted" style="font-size:12px">' + (o.a.proxyId ? "proxy aktif" : "tanpa proxy") + '</span><button class="btn sm" data-act="openacc" data-i="' + o.i + '" title="Buka jendela profil akun ini (login / cek manual)">Buka</button><button class="ibtn" data-act="accdel" data-i="' + o.i + '" title="Hapus">' + ICON.trash + "</button></div>").join("");
  const more = f.length > shown.length ? '<div class="more"><span>… Menampilkan 1-' + shown.length + " dari " + f.length + ' akun</span><button class="btn sm" data-act="accmore">Muat lebih banyak</button></div>' : (f.length ? '<div class="more"><span>Menampilkan semua ' + f.length + " akun</span></div>" : "");
  return rows ? rows + more : '<div class="empty" style="margin:16px">' + (all.length ? "Tidak ada akun yang cocok." : "Belum ada akun " + PNAME[p] + " tersimpan.") + "</div>";
}

function pagePlatform(p, tab) {
  const accs = S.accounts.filter((a) => platOf(a) === p), tasks = S.tasks.filter((t) => t.platform === p);
  const active = accs.filter((a) => a.enabled !== false).length, here = runningPlatform() === p;
  const tl = { tasks: "", accounts: " / Akun", history: " / Riwayat" }[tab];
  const sub = tab === "tasks" ? accs.length + " akun · " + tasks.length + " task" + (here ? " · 1 berjalan" : "") : tab === "accounts" ? accs.length + " akun · " + active + " aktif" : "Hasil run terakhir dan log langsung";
  const btn = tab === "tasks" ? '<button class="btn primary" data-act="new" data-p="' + p + '">' + ICON.plus + "Tambah task</button>" : tab === "history" ? '<button class="btn danger" data-act="clearhist" data-p="' + p + '">Hapus riwayat</button>' : "";
  const head = '<div class="crumb"><a href="#home">Beranda</a> / ' + (tl ? '<a href="#' + p + '">' + PNAME[p] + "</a>" + tl : PNAME[p]) + "</div>" +
    '<div class="top"><div class="tt"><span class="pbadge">' + PSHORT[p] + "</span><div><h1>" + PNAME[p] + "</h1><p>" + sub + "</p></div></div>" + btn + "</div>" +
    '<div class="tabs"><a href="#' + p + '/tasks" class="' + (tab === "tasks" ? "on" : "") + '">Task</a><a href="#' + p + '/accounts" class="' + (tab === "accounts" ? "on" : "") + '">Akun (' + accs.length + ')</a><a href="#' + p + '/history" class="' + (tab === "history" ? "on" : "") + '">Riwayat</a></div>';
  if (tab === "tasks") return head + '<div class="panel">' + (tasks.map(taskRow).join("") || '<div class="empty" style="margin:16px">Belum ada task ' + PNAME[p] + ". Klik <b>Tambah task</b>, pilih akun, lalu isi link.</div>") + "</div>";
  if (tab === "accounts") {
    return head + '<div class="panel pad addbox"><div><h3>Tambah akun ' + PNAME[p] + '</h3><div class="hint">Klik <b>Tambah akun</b>: jendela login terpisah terbuka (tiap akun punya profil, cookie, proxy, dan identitas sendiri). Login di jendela itu; DHub menyimpan akun otomatis begitu login selesai.</div></div><button class="btn primary" data-act="login" data-p="' + p + '">' + ICON.plus + 'Tambah akun ' + PNAME[p] + "</button></div>" +
      '<div class="accbar"><input type="text" id="accq" placeholder="Cari label atau username" value="' + esc(UI.q) + '" /><div class="sp"><button class="btn sm" data-act="export" data-p="' + p + '">Export akun (backup)</button><button class="btn sm" data-act="import">Import akun</button></div></div>' +
      '<div class="panel" id="acclist">' + accRows(p) + "</div>";
  }
  const h = S.history.filter((x) => histPlat(x) === p).map((x) => histRow(x, false)).join("");
  return head + '<div class="panel">' + (h || '<div class="empty" style="margin:16px">Belum ada riwayat ' + PNAME[p] + ".</div>") + "</div>" +
    '<div class="panel pad"><div class="row" style="margin:0 0 8px"><h3 style="margin:0">Log</h3><span style="margin-left:auto" class="row" style="margin:0"><button class="btn sm" data-act="sendreport">Kirim ke owner</button><button class="btn sm" data-act="clearlog">Bersihkan</button></span></div><div class="logbox" id="logbox">' + esc(S.log.join("\n") || "(kosong)") + "</div></div>";
}

function maskKey(k) { k = String(k || ""); return k.length > 7 ? k.slice(0, 3) + "XXXX-XXXX-" + k.slice(-4) : k; }
function pageAdvanced() {
  const n = Object.keys(S.used).length, a = S.disp, pf = resolveProfile(S.screen, a), cap = tabCap(pf, a);
  const usedList = Object.entries(S.used).slice(-50).reverse().map(([c, m]) => "<div>“" + esc(c) + "” <span class=\"muted\">— @" + esc(m.account || "?") + "</span></div>").join("");
  const opts = [["auto", "Otomatis", "dipilih dari ukuran layar"], ["laptop", "Laptop / Mac", "maks 2 jendela berdampingan"], ["big", "Monitor besar", "sampai 6 jendela"], ["single", "Satu jendela", "paling aman, 1 tab"]];
  return '<div class="crumb"><a href="#home">Beranda</a> / Lanjutan</div><div class="top"><div><h1>Lanjutan</h1><p>Licence, layar, komentar terpakai, dan laporan error. Berlaku untuk semua platform.</p></div></div>' +
    '<div class="panel pad"><h3>Licence</h3><div class="mono" style="font-size:12px;margin:6px 0">' + esc(maskKey(S.license)) + '</div><div class="hint">' + esc(licenseInfo({ license_state: S.licState, license_expired: S.licExpired }).text) + '</div><div class="row"><button class="btn sm" data-act="reclic">Cek ulang</button><button class="btn sm danger" data-act="rmlic">Hapus licence lokal</button></div><div class="hint">Pindah device? Minta admin melepas device dulu, lalu aktifkan di device baru.</div></div>' +
    '<div class="panel pad"><h3>Layar</h3><div class="hint">Berlaku untuk semua task. Jendela DHub tidak dibuat lebih kecil dari 700 × 500 px, dan Tab per akun dibatasi otomatis.</div>' +
    opts.map((o) => '<label class="chk"><input type="radio" name="screenprof" data-act="screenprof" data-v="' + o[0] + '" ' + (S.screen === o[0] ? "checked" : "") + '> <span><b>' + o[1] + '</b> <span class="muted">· ' + o[2] + "</span></span></label>").join("") +
    '<div class="hint" style="margin-top:10px">Layar terdeteksi ' + a.width + " × " + a.height + " · profil aktif: " + PROFILE_LABEL[pf] + " · maks " + cap + " tab per akun.</div></div>" +
    '<div class="panel pad"><h3>Komentar terpakai (' + n + ')</h3><div class="hint">Dipakai fitur “skip komentar yang sudah dipakai”.</div><div class="row"><button class="btn sm" data-act="toggleused">Lihat</button><button class="btn sm danger" data-act="resetused">Reset</button></div><div class="used" id="usedBox" hidden>' + (usedList || '<div class="muted">Kosong.</div>') + "</div></div>" +
    '<div class="panel pad"><h3>Verifikasi komentar</h3><div class="hint">Setelah komentar terkirim, halaman post dimuat ulang lalu dicek apakah komentar benar-benar tampil. Hasil: <b>sukses terverifikasi</b> atau <b>terkirim tapi tidak tampil</b> (kemungkinan disembunyikan / shadowban). Menambah beberapa detik per komentar.</div><label class="chk"><input type="checkbox" data-act="verifyauto" data-testid="verify-comments-toggle" ' + (S.verify ? "checked" : "") + '> Verifikasi komentar setelah kirim (reload halaman)</label></div>' +
    '<div class="panel pad"><h3>Proxy &amp; identitas per akun</h3><div class="hint">Atur proxy residensial (IP sticky) dan identitas (User-Agent + zona waktu) tiap akun. Identitas dibuat otomatis per akun; zona waktu mengikuti negara IP proxy, dan bisa diubah manual.</div><div class="row"><button class="btn sm" data-act="openproxy" data-testid="open-proxy-manager-btn">Buka Manajer Proxy &amp; Identitas</button></div></div>' +
    '<div class="panel pad"><h3>Laporan error ke owner</h3><div class="hint">Kalau task selesai dengan kegagalan, ringkasan error (pesan GAGAL, akun, link) dikirim ke owner. Cookies tidak pernah dikirim. “Kirim log terakhir” mengirim maks. 150 baris log.</div><div class="row"><label class="chk" style="margin:0"><input type="checkbox" data-act="reportauto" ' + (S.reportAuto ? "checked" : "") + '> Kirim ringkasan otomatis</label><button class="btn sm" data-act="sendreport">Kirim log terakhir sekarang</button></div></div>' +
    '<div class="panel pad"><h3>Tentang aplikasi &amp; update</h3><div class="hint" id="aboutInfo">Memuat…</div><div class="row"><button class="btn sm" data-act="chkupd">Cek update</button><button class="btn sm primary" data-act="instupd" id="instUpd" hidden>Pasang update &amp; mulai ulang</button><button class="btn sm" data-act="opendata">Buka folder data</button></div><div class="hint" id="updInfo"></div></div>';
}

function pageGuide() {
  return '<div class="crumb"><a href="#home">Beranda</a> / Panduan</div><div class="top"><div><h1>Panduan</h1><p>Urutan pakai dari nol.</p></div></div><div class="panel pad"><ol class="guide">' +
    "<li>Pilih platform di <b>Beranda</b> (atau di popup). Akun, task, dan riwayat dipisah per platform.</li>" +
    "<li>Tab <b>Akun</b> → <b>Tambah akun</b>: isi label (dan pilih proxy kalau ada), lalu login di jendela yang terbuka. Akun tersimpan otomatis. Tiap akun punya profil sendiri, jadi login satu akun tidak mengeluarkan akun lain. Akun lama dari ekstensi bisa dimasukkan lewat <b>Import akun</b>.</li>" +
    "<li>Tab <b>Task</b> → <b>Tambah task</b>. Centang yang mau dilakukan: <b>Komentar di post</b>, <b>Like komentar</b>, atau <b>Follow profil</b>. Kolom isiannya muncul setelah dicentang; kalau dicentang lagi untuk mematikan, isinya tidak hilang.</li>" +
    "<li>Pilih akun: <b>Pilih cepat berdasarkan jumlah</b> (mis. 20 akun mulai nomor 1) atau tulis nomor/rentang seperti <code>1-20, 25, 30-35</code>. Nomor sama dengan nomor di tab Akun. Akun nonaktif tidak ikut.</li>" +
    "<li>Link dari platform lain dihitung terpisah, diberi tanda, dan diabaikan saat disimpan.</li>" +
    "<li><b>Pengaturan lanjutan</b> berisi jeda, Tab per akun, Mode cepat, Jalur paralel, dan Screenshot. Jeda 5–15 detik lebih aman dari pembatasan; Mode cepat membatasi jeda maksimal 1 detik sehingga lebih berisiko.</li>" +
    "<li><b>Akun bersamaan</b> (Pengaturan lanjutan): beberapa akun diproses sekaligus, masing-masing di jendela, proxy, dan identitas sendiri. Tidak ada lagi batasan satu akun per platform.</li>" +
    "<li>Dengan <b>Skip komentar yang sudah dipakai</b>, jumlah draft harus minimal sebanyak komentar yang akan dikirim (100 akun = 100 draft berbeda), atau matikan opsi itu.</li>" +
    "<li>Klik <b>Jalankan</b> (atau <b>Mulai task</b> di popup). Tombol <b>Stop</b> merah ada di popup, Beranda, dan bar bawah: cukup satu klik, semua jendela yang dibuka DHub langsung ditutup.</li>" +
    "<li>Link komentar Instagram berakhiran <code>?comment_id=...</code>; link di post/Reel yang sama diproses tanpa memuat ulang halaman. Di X dan Threads isi dengan link balasan yang mau di-like.</li></ol></div>" +
    '<div class="panel pad"><h3>Layar dan jendela</h3><ol class="guide">' +
    "<li>Profil layar ada di <b>Lanjutan</b>. Laptop / Mac memakai maks 2 jendela berdampingan; Tab per akun dibatasi otomatis sesuai ukuran layar.</li>" +
    "<li><b>Biarkan jendela akun terbuka</b> selama task jalan. Jangan diminimize atau ditutupi aplikasi lain; Instagram berhenti memuat komentar di jendela tersembunyi.</li>" +
    "<li>Banyak akun? Bagi per batch dan naikkan jeda ke 3–5 detik.</li></ol></div>" +
    '<div class="panel pad"><h3>Kalau ada yang gagal atau dilewati</h3><ol class="guide">' +
    "<li><b>Dilewati: komentar tidak ditemukan</b>: komentar tersembunyi, dihapus, atau tidak termuat. Ini <i>tidak</i> dihitung gagal dan tidak ikut hentian “8 gagal beruntun”. Log memuat diagnostik (<code>anchor_maks</code>, <code>hid</code>, <code>btn</code>) untuk analisis.</li>" +
    "<li><b>vis=hidden</b> di diagnostik: jendela tertutup/tersembunyi. Kurangi Tab per akun dan jangan minimize.</li>" +
    "<li><b>Task dihentikan: 8 gagal beruntun</b>: buka link komentar manual, pastikan masih ada, lalu kurangi jumlah tab.</li>" +
    "<li>Gagal berulang tanpa sebab jelas: klik <b>Kirim ke owner</b> (ringkasan error + maks. 150 baris log, tanpa cookies).</li>" +
    "<li>Login akun gagal: di tab Akun klik <b>Buka</b> pada akun itu, login ulang di jendelanya.</li>" +
    "<li><b>Perlu login ulang</b>: akun yang gagal login ditandai otomatis dan dilewati di semua task. Tanda hilang sendiri setelah akun itu login ulang lewat tombol Buka.</li>" +
    "<li><b>Follow dilewati</b>: profil sendiri atau tombol Follow tidak ada. Tidak dihitung gagal. Kalau follow gagal 6x beruntun (atau muncul pesan pembatasan), DHub jeda 30 menit lalu lanjut otomatis (maks 3x jeda).</li>" +
    "<li><b>Reel</b>: kalau kotak komentar Reel tidak terbuka, DHub otomatis mencoba lewat tampilan post biasa (<code>/p/KODE/</code>).</li>" +
    "<li>Task berhenti / ada yang gagal? Tombol <b>Ulangi yang gagal saja</b> melewati item yang sudah sukses. <b>Mulai dari awal</b> menjalankan semuanya lagi. Tabel hasil per akun ada di tab <b>Riwayat</b> (bisa Export CSV).</li></ol></div>";
}

/* ---------- render ---------- */
function render() {
  renderNav();
  const main = $("main"), r = route();
  if (!S.license) { document.body.classList.remove("running"); main.innerHTML = gate(); return; }
  const li = licenseInfo({ license_state: S.licState, license_expired: S.licExpired });
  const banner = (li.cls === "bad" || li.cls === "warn") ? '<div class="lic top ' + li.cls + '">' + esc(li.text) + "</div>" : "";
  const showBar = S.running && r.page !== "home";
  document.body.classList.toggle("running", showBar);
  main.innerHTML = banner + (r.page === "home" ? pageHome(li) : r.page === "platform" ? pagePlatform(r.p, r.tab) : r.page === "advanced" ? pageAdvanced() : pageGuide()) + (showBar ? runBar() : "");
  const lb = $("logbox"); if (lb) lb.scrollTop = lb.scrollHeight;
  tickClock();
  if (r.page === "advanced") fillAbout();
}
window.addEventListener("hashchange", () => { UI = { q: "", limit: 50 }; render(); });
function tickClock() { const t = new Date().toLocaleTimeString("id-ID", { hour12: false }); $("clock").textContent = t; document.querySelectorAll("[data-clock]").forEach((e) => { e.textContent = t; }); }
setInterval(() => { tickClock(); liveUpdate(); }, 1000);
chrome.storage.onChanged.addListener((c, a) => {
  if (a !== "local" || dlgOpen) return;
  const keys = Object.keys(c);
  if (keys.every((k) => k === "job_progress" || k === "job_log")) {
    if (c.job_log) { S.log = c.job_log.newValue || []; const lb = $("logbox"); if (lb) { const bottom = lb.scrollTop + lb.clientHeight >= lb.scrollHeight - 20; lb.textContent = S.log.join("\n") || "(kosong)"; if (bottom) lb.scrollTop = lb.scrollHeight; } }
    if (c.job_progress) { S.progress = c.job_progress.newValue || null; liveUpdate(); }
    return;
  }
  load();
});

/* ---------- editor task (dialog) ---------- */
function accPicker(p, sel) {
  const items = S.accounts.filter((a) => platOf(a) === p);
  if (!items.length) return '<div class="muted" style="padding:10px">Belum ada akun ' + PNAME[p] + ". Tambah di tab Akun.</div>";
  return items.map((a, n) => '<label class="' + (a.enabled === false ? "off" : "") + '"><input type="checkbox" name="acc" data-n="' + (n + 1) + '" value="' + esc(accKey(a)) + '" ' + (sel.includes(accKey(a)) && a.enabled !== false ? "checked" : "") + (a.enabled === false ? " disabled" : "") + '><span class="num">' + (n + 1) + "</span><span>" + esc(a.label) + (a.username ? ' <span class="muted">@' + esc(a.username) + "</span>" : "") + (a.enabled === false ? ' <span class="badge warn">Nonaktif</span>' : "") + "</span></label>").join("");
}
function openEditor(id, platform) {
  const old = S.tasks.find((x) => x.id === id);
  const p = old ? old.platform : platform; ED = { p, id: old ? old.id : null };
  const t = old || { name: "", accounts: [], comments: [], urls: [], commentLinks: [], profileLinks: [], delayPost: 2, delayAccount: 2, concurrency: 1, autoLike: true, autoRepost: false, autoFollow: false, skipUsed: true, screenshot: false, fast: true, parallel: 1, actions: { comment: false, likeComment: false, followProfile: false } };
  const A = t.actions || { comment: (t.urls || []).length > 0, likeComment: (t.commentLinks || []).length > 0, followProfile: (t.profileLinks || []).length > 0 };
  const ph = PH[p], ck = (v) => (v ? "checked" : "");
  const canRt = p === "x" || p === "threads";
  const act = (key, title, desc, inner) => '<div class="act"><input type="checkbox" id="a_' + key + '" data-pn="' + key + '" ' + ck(A[key]) + '><div style="flex:1"><b>' + title + '</b><p class="s">' + desc + '</p><div class="pn" id="pn_' + key + '"' + (A[key] ? "" : " hidden") + ">" + inner + "</div></div></div>";
  $("taskForm").innerHTML =
    '<div class="dh"><span class="pbadge sm">' + PSHORT[p] + "</span><h2>" + (old ? "Edit task" : "Task baru") + " · " + PNAME[p] + '</h2><button type="button" class="ibtn" data-act="cancel" title="Tutup"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
    '<div class="dbd">' +
    '<div class="sec"><h4>Nama task</h4><input type="text" id="f_name" style="margin-top:6px" value="' + esc(t.name) + '" placeholder="mis. Promo Oktober" /></div>' +
    '<div class="sec"><h4>Apa yang mau dilakukan?</h4><p class="s">Kolom isian muncul setelah dicentang. Kalau dicentang lagi untuk mematikan, isinya tidak hilang.</p>' +
    act("comment", "Komentar di post", "Isi URL post dan draft komentar.",
      '<textarea id="f_urls" placeholder="' + esc(ph.post) + '">' + esc((t.urls || []).join("\n")) + '</textarea><div class="hint" id="cn_urls"></div>' +
      '<textarea id="f_comments" placeholder="Satu draft komentar per baris">' + esc((t.comments || []).join("\n")) + '</textarea><div class="hint" id="cn_comments"></div>' +
      '<div class="opts"><label><input type="checkbox" id="f_like" ' + ck(t.autoLike) + '> Auto like tiap post</label><label><input type="checkbox" id="f_fol" ' + ck(t.autoFollow) + '> Auto follow pemilik post</label>' +
      (canRt ? '<label><input type="checkbox" id="f_rt" ' + ck(t.autoRepost) + '> Auto repost</label>' : "") +
      '<label><input type="checkbox" id="f_skip" ' + ck(t.skipUsed !== false) + '> Skip komentar yang sudah dipakai</label></div>') +
    act("likeComment", "Like komentar", "Isi link komentar yang mau di-like.", '<textarea id="f_links" placeholder="' + esc(ph.comment) + '">' + esc((t.commentLinks || []).join("\n")) + '</textarea><div class="hint" id="cn_links"></div>') +
    act("followProfile", "Follow profil", "Isi link profil yang mau di-follow.", '<textarea id="f_prof" placeholder="' + esc(ph.profile) + '">' + esc((t.profileLinks || []).join("\n")) + '</textarea><div class="hint" id="cn_prof"></div>') +
    "</div>" +
    '<div class="sec"><div class="sum"><div><h4>Akun ' + PNAME[p] + '</h4><p class="s" id="acc_sum"></p></div><div class="bt"><button type="button" class="btn sm" data-act="selall">Pilih semua</button><button type="button" class="btn sm" data-act="selnone">Kosongkan</button><button type="button" class="btn sm" data-act="acclist">Lihat / ubah</button></div></div>' +
    '<div class="qs"><div><label>Jumlah akun</label><input type="number" id="q_n" min="1" value="' + Math.min(20, Math.max(1, S.accounts.filter((a) => platOf(a) === p).length)) + '"></div><div><label>Mulai dari nomor</label><input type="number" id="q_s" min="1" value="1"></div><button type="button" class="btn primary" id="q_btn" data-act="qapply">Terapkan</button>' +
    '<div class="rg"><label>Atau tulis nomor / rentang</label><input type="text" id="r_txt" placeholder="contoh: 1-20, 25, 30-35"></div></div><div class="hint" id="qs_msg"></div><div class="hint" id="qs_lock"></div>' +
    '<div class="qs" style="margin-top:12px"><div><label>Tab per akun</label>' + (p === "instagram" ? '<input type="number" id="f_cc" min="1" max="' + S.cap + '" value="' + Math.min(t.concurrency || 1, S.cap) + '">' : '<input type="number" id="f_cc" value="1" disabled>') + '</div>' +
    '<div class="rg"><div class="hint" style="margin:0" id="tab_hint">' + (p === "instagram" ? "Jumlah jendela Chrome yang dibuka bersamaan untuk tiap akun (maks " + S.cap + " di profil layar " + esc(profLabelNow()) + "). Jendela otomatis ditutup setelah task selesai." : PNAME[p] + " memakai 1 tab per akun (butuh tab aktif untuk mengetik).") + "</div></div></div>" +
    '<div class="accs" id="acc_list" hidden>' + accPicker(p, t.accounts || []) + "</div></div>" +
    '<details class="dd" id="dd_adv"><summary><div><h4>Pengaturan lanjutan</h4><p class="s" id="adv_sum"></p></div></summary><div class="ddb">' +
    '<div class="note">Layar terdeteksi ' + S.disp.width + " × " + S.disp.height + " · profil " + profLabelNow() + " · maks " + S.cap + " tab per akun. Ubah profil di menu Lanjutan.</div>" +
    '<div class="grid3" style="grid-template-columns:1fr 1fr">' +
    '<div><label class="f" style="margin-top:0">Jeda antar post (dtk)</label><input type="number" id="f_dp" min="0" value="' + (t.delayPost != null ? t.delayPost : 2) + '"></div><div><label class="f" style="margin-top:0">Jeda antar akun (dtk)</label><input type="number" id="f_da" min="0" value="' + (t.delayAccount != null ? t.delayAccount : 2) + '"></div></div>' +
    '<label class="chk"><input type="checkbox" id="f_fast" ' + ck(t.fast !== false) + '> Mode cepat (jeda maksimal 1 detik)</label>' +
    '<label class="f">Akun bersamaan</label><input type="number" id="f_par" min="1" max="10" value="' + (t.parallel || 1) + '"><div class="hint">Berapa akun diproses sekaligus. Tiap akun punya profil, proxy, dan jendela sendiri, jadi aman dijalankan paralel. Mulai dari 2–3 dulu dan lihat apakah komputer kuat.</div>' +
    '<label class="chk"><input type="checkbox" id="f_shot" ' + ck(t.screenshot) + '> Screenshot otomatis (bukti)</label></div></details>' +
    '<details class="dd" id="dd_sch"><summary><div><h4>Jadwal</h4><p class="s" id="sch_sum"></p></div></summary><div class="ddb"><label class="f" style="margin-top:0">Jalankan pada (opsional)</label><input type="datetime-local" id="f_sched" value="' + (t.scheduleAt ? toLocalInput(t.scheduleAt) : "") + '"><div class="hint">Kosongkan untuk manual. DHub harus tetap berjalan saat jadwal tiba (boleh ditutup ke tray, jangan Keluar).</div></div></details>' +
    "</div>" +
    '<div class="dft"><span class="sp" id="ft_sum"></span><button type="button" class="btn" data-act="cancel">Batal</button><button type="button" class="btn primary" data-act="save">Simpan task</button></div>';
    dlgOpen = true; refreshEditor(); $("dlg").showModal();
}
function setNums(nums) {
  document.querySelectorAll('input[name="acc"]').forEach((b) => { b.checked = !b.disabled && nums.has(+b.dataset.n); });
}
function refreshEditor() {
  if (!$("taskForm") || !$("f_name")) return;
  const boxes = [...document.querySelectorAll('input[name="acc"]')], sel = boxes.filter((b) => b.checked);
  $("acc_sum").textContent = sel.length + " dipilih dari " + boxes.length + (sel.length ? " (nomor " + compressNums(sel.map((b) => +b.dataset.n)) + ")" : "");
  const cnt = (id, fieldId, noteId, label) => { const el = $(fieldId); if (!el) return; const c = classify(el.value, ED.p); $(noteId).textContent = c.total ? c.ok + " " + label + (c.foreign ? " · " + c.foreign + " dari platform lain akan diabaikan" : "") : ""; $(noteId).style.color = c.foreign ? "var(--warn)" : ""; };
  cnt("a", "f_urls", "cn_urls", "link post"); cnt("a", "f_links", "cn_links", "link komentar"); cnt("a", "f_prof", "cn_prof", "link profil");
  $("cn_comments").textContent = lines($("f_comments").value).length ? lines($("f_comments").value).length + " draft komentar" : "";
  // semua akun terpilih: pilih cepat (jumlah + mulai + Terapkan) tidak ada gunanya, kunci sampai ada yang dikosongkan
  const allSel = boxes.length > 0 && boxes.every((b) => b.disabled || b.checked) && sel.length > 0;
  ["q_n", "q_s", "q_btn"].forEach((id) => { const el = $(id); if (el) el.disabled = allSel; });
  $("qs_lock").textContent = allSel ? "Semua akun terpilih, Terapkan dikunci. Klik Kosongkan atau hapus centang sebagian untuk memakainya." : "";
  const nAct = ["comment", "likeComment", "followProfile"].filter((k) => $("a_" + k).checked).length;
  $("ft_sum").textContent = nAct + " aksi aktif · " + sel.length + " akun";
  const cc = ED.p === "instagram" ? Math.min(parseInt($("f_cc").value, 10) || 1, S.cap) : 1;
  $("adv_sum").textContent = profLabelNow() + " · " + cc + " tab · jeda " + ($("f_dp").value || 0) + "/" + ($("f_da").value || 0) + " dtk" + ($("f_fast").checked ? " · mode cepat" : "") + ($("f_shot").checked ? " · screenshot" : "");
  const at = $("f_sched").value ? new Date($("f_sched").value).getTime() : 0;
  $("sch_sum").textContent = at ? fmtDate(at) + " " + fmtTime(at) : "Manual";
}
async function saveTask() {
  const p = ED.p, name = $("f_name").value.trim();
  const accounts = [...document.querySelectorAll('input[name="acc"]:checked')].map((b) => b.value);
  const A = { comment: $("a_comment").checked, likeComment: $("a_likeComment").checked, followProfile: $("a_followProfile").checked };
  if (!name) return toast("Isi nama task.");
  if (!accounts.length) return toast("Pilih minimal satu akun " + PNAME[p] + ".");
  if (!A.comment && !A.likeComment && !A.followProfile) return toast("Centang minimal satu aksi.");
  const keep = (id) => { const ls = lines($(id).value); const ok = ls.filter((u) => urlPlat(u) === p); return { ok, dropped: ls.length - ok.length }; };
  const U = keep("f_urls"), L = keep("f_links"), P = keep("f_prof"), comments = lines($("f_comments").value);
  if (A.comment && !U.ok.length) return toast("Komentar di post: isi minimal satu URL " + PNAME[p] + ".");
  if (A.comment && !comments.length) return toast("Komentar di post: isi minimal satu draft komentar.");
  if (A.likeComment && !L.ok.length) return toast("Like komentar: isi minimal satu link " + PNAME[p] + ".");
  if (A.followProfile && !P.ok.length) return toast("Follow profil: isi minimal satu link profil " + PNAME[p] + ".");
  const at = $("f_sched").value ? new Date($("f_sched").value).getTime() : null;
  const old = S.tasks.find((x) => x.id === ED.id);
  const t = Object.assign({}, old || { id: "t" + Date.now() }, {
    platform: p, name, accounts, actions: A, urls: U.ok, comments, commentLinks: L.ok, profileLinks: P.ok,
    delayPost: Math.max(0, parseFloat($("f_dp").value) || 0), delayAccount: Math.max(0, parseFloat($("f_da").value) || 0),
    concurrency: p === "instagram" ? Math.max(1, Math.min(S.cap || 6, parseInt($("f_cc").value, 10) || 1)) : 1,
    autoLike: $("f_like").checked, autoFollow: $("f_fol").checked, autoRepost: $("f_rt") ? $("f_rt").checked : false, skipUsed: $("f_skip").checked,
    screenshot: $("f_shot").checked, fast: $("f_fast").checked, parallel: Math.max(1, Math.min(10, parseInt($("f_par").value, 10) || 1)),
    scheduleAt: at, scheduleEnabled: !!at && at > Date.now()
  });
  const i = S.tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) S.tasks[i] = t; else S.tasks.push(t);
  await saveTasks();
  const dropped = U.dropped + L.dropped + P.dropped;
  $("dlg").close();
  toast("Task disimpan." + (dropped ? " " + dropped + " link platform lain diabaikan." : ""));
}
$("dlg").addEventListener("close", () => { dlgOpen = false; load(); });
$("taskForm").addEventListener("submit", (e) => e.preventDefault());

/* ---------- aksi ---------- */
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id, i = parseInt(el.dataset.i, 10), p = el.dataset.p;
  switch (act) {
    case "new": return openEditor(null, p);
    case "edit": return openEditor(id);
    case "cancel": return $("dlg").close();
    case "selall": document.querySelectorAll('input[name="acc"]').forEach((b) => { b.checked = !b.disabled; }); return refreshEditor();
    case "selnone": document.querySelectorAll('input[name="acc"]').forEach((b) => { b.checked = false; }); return refreshEditor();
    case "acclist": $("acc_list").hidden = !$("acc_list").hidden; return;
    case "qapply": {
      const total = document.querySelectorAll('input[name="acc"]').length, n = parseInt($("q_n").value, 10), s = parseInt($("q_s").value, 10), msg = $("qs_msg");
      if (!total) { msg.className = "hint bad"; msg.textContent = "Belum ada akun."; return; }
      if (!(n >= 1) || !(s >= 1) || s > total) { msg.className = "hint bad"; msg.textContent = "Isi jumlah ≥ 1 dan nomor awal 1-" + total + "."; return; }
      const end = Math.min(total, s + n - 1), nums = new Set(); for (let k = s; k <= end; k++) nums.add(k);
      setNums(nums); $("r_txt").value = ""; msg.className = "hint"; msg.textContent = "= akun nomor " + s + " sampai " + end + (end - s + 1 < n ? " (hanya tersisa " + (end - s + 1) + " akun)" : "");
      return refreshEditor();
    }
    case "save": return saveTask();
    case "del": if (confirm("Hapus task ini?")) { S.tasks = S.tasks.filter((t) => t.id !== id); await saveTasks(); } return;
    case "run": { const r = await send({ action: "RUN_TASK", taskId: id }); if (r && !r.ok && r.error !== "busy") toast(r.error); else toast("Task dimulai."); return; }
    case "runfailed": { const r = await send({ action: "RUN_TASK", taskId: id, mode: "failed" }); if (r && !r.ok && r.error !== "busy") toast(r.error); else toast("Mengulangi item yang gagal saja."); return; }
    case "histdetail": { if (OPEN.has(id)) OPEN.delete(id); else OPEN.add(id); return render(); }
    case "histcsv": {
      const x = S.history.find((h) => h.id === id); if (!x || !x.results) return toast("Tidak ada tabel hasil.");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([resultsCsv(x)], { type: "text/csv;charset=utf-8" }));
      a.download = "dhub-hasil-" + String(x.name).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 30) + "-" + new Date(x.at).toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".csv"; a.click(); return;
    }
    case "openproxy": return chrome.tabs.create({ url: chrome.runtime.getURL("proxy.html") });
    case "screenprof": { await chrome.storage.local.set({ screen_profile: el.dataset.v }); toast("Profil layar: " + PROFILE_LABEL[el.dataset.v] + "."); return; }
    case "stop": toast("Menghentikan..."); return send({ action: "STOP_JOB" });
    case "activate": { const k = $("licKey").value.trim(); if (!k) return; $("licMsg").textContent = "Memverifikasi..."; const r = await send({ action: "ACTIVATE_LICENSE", key: k }); if (r && r.ok) load(); else $("licMsg").textContent = (r && r.error) || "Gagal."; return; }
    case "login": return openAddAccount(p);
    case "openacc": { const a = S.accounts[i]; const r = await send({ action: "OPEN_ACCOUNT", platform: platOf(a), label: a.label }); if (r && !r.ok) toast(r.error); return; }
    case "accdel": if (confirm("Hapus akun '" + S.accounts[i].label + "'?")) { S.accounts.splice(i, 1); await saveAccounts(); } return;
    case "accmore": UI.limit += 50; { const r = route(); $("acclist").innerHTML = accRows(r.p); } return;
    case "export": {
      const r = await send({ action: "EXPORT_ACCOUNTS", platform: p });
      const list = (r && r.accounts) || [];
      if (!list.length) return toast("Belum ada akun.");
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: 2, accounts: list }, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "dhub-" + (p || "akun") + "-" + new Date().toISOString().slice(0, 10) + ".json"; a.click(); return;
    }
    case "import": return $("importFile").click();
    case "clearhist": if (confirm("Hapus riwayat " + PNAME[p] + "?")) await chrome.storage.local.set({ history: S.history.filter((x) => histPlat(x) !== p) }); return;
    case "clearlog": return send({ action: "CLEAR_LOG" });
    case "rmlic": if (confirm("Hapus licence lokal? Kamu perlu memasukkan key lagi.")) { await chrome.storage.local.remove(["license_key", "license_state", "license_expired", "license_seen", "license_verified_at", "dhub_cfg"]); } return;
    case "chkupd": { toast("Memeriksa update..."); const r = await send({ action: "CHECK_UPDATE" }); if (r && r.update) { UPD = r.update; paintUpdate(); } return; }
    case "instupd": return send({ action: "INSTALL_UPDATE" });
    case "opendata": return send({ action: "OPEN_DATA_DIR" });
    case "reclic": { toast("Memeriksa licence..."); const r = await send({ action: "CHECK_LICENSE" }); toast(r && r.ok ? "Licence aktif." : ((r && r.error) || "Gagal memeriksa.")); load(); return; }
    case "sendreport": { toast("Mengirim..."); const r = await send({ action: "SEND_REPORT" }); toast(r && r.ok ? "Terkirim ke owner." : ((r && r.error) || "Gagal mengirim.")); return; }
    case "toggleused": $("usedBox").hidden = !$("usedBox").hidden; return;
    case "resetused": if (confirm("Reset riwayat komentar terpakai?")) await chrome.storage.local.set({ used_comments: {} }); return;
  }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "accq") { UI.q = el.value; UI.limit = 50; $("acclist").innerHTML = accRows(route().p); return; }
  if (el.closest && el.closest("#taskForm")) refreshEditor();
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.closest && el.closest("#taskForm")) {
    if (el.dataset.pn) $("pn_" + el.dataset.pn).hidden = !el.checked;
    if (el.id === "r_txt") {
      const total = document.querySelectorAll('input[name="acc"]').length, r = parseRange(el.value, total), msg = $("qs_msg");
      if (r.empty) { msg.className = "hint"; msg.textContent = ""; }
      else if (r.err) { msg.className = "hint bad"; msg.textContent = r.err; }
      else { setNums(r.nums); msg.className = "hint"; msg.textContent = "= " + r.nums.size + " nomor dipilih"; }
    }
    return refreshEditor();
  }
  if (el.dataset.act === "sched") { const t = S.tasks.find((x) => x.id === el.dataset.id); if (t) { if (t.scheduleAt <= Date.now()) { el.checked = false; return toast("Waktu jadwal sudah lewat. Edit task untuk jadwal baru."); } t.scheduleEnabled = el.checked; await saveTasks(); } return; }
  if (el.dataset.act === "reportauto") { await chrome.storage.local.set({ report_auto: el.checked }); toast(el.checked ? "Laporan otomatis aktif." : "Laporan otomatis dimatikan."); return; }
  if (el.dataset.act === "verifyauto") { await chrome.storage.local.set({ verify_comments: el.checked }); toast(el.checked ? "Verifikasi komentar aktif." : "Verifikasi komentar dimatikan."); return; }
  if (el.dataset.act === "accon") { S.accounts[parseInt(el.dataset.i, 10)].enabled = el.checked; await saveAccounts(); return; }
  if (el.id === "importFile") {
    const f = el.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text()); const arr = d.accounts || d; if (!Array.isArray(arr)) throw new Error("Format file tidak valid");
      let add = 0, skip = 0;
      for (const a of arr) {
        if (!a || !a.label || !a.cookies) continue;
        const e2 = Object.assign({ platform: "instagram" }, a);
        if (S.accounts.some((x) => x.username && e2.username && x.username.toLowerCase() === e2.username.toLowerCase() && platOf(x) === e2.platform)) { skip++; continue; }
        let n = 2; const base = e2.label; while (S.accounts.some((x) => x.label === e2.label && platOf(x) === e2.platform)) e2.label = base + "_" + n++;
        S.accounts.push(e2); add++;
      }
      await saveAccounts(); toast("Import: +" + add + ", dilewati " + skip);
    } catch (err) { toast("Gagal import: " + err.message); }
    el.value = "";
  }
});

/* ---------- versi + tombol Admin login (klik versi 5 kali) ---------- */
const ADMIN_URL = "https://instabot-licence.alissyaargani-ed0.workers.dev/admin";
(function () {
  const btn = $("adminBtn"), ver = $("ver"); let n = 0, t = null;
  try { ver.textContent = "v" + chrome.runtime.getManifest().version; } catch (e) {}
  const show = (v) => { btn.hidden = !v; };
  chrome.storage.local.get(["admin_ui"]).then((s) => show(!!s.admin_ui));
  ver.addEventListener("click", () => {
    clearTimeout(t); t = setTimeout(() => { n = 0; }, 2500);
    if (++n < 5) return;
    n = 0;
    chrome.storage.local.get(["admin_ui"]).then(async (s) => { const v = !s.admin_ui; await chrome.storage.local.set({ admin_ui: v }); show(v); toast(v ? "Tombol Admin login ditampilkan." : "Tombol Admin login disembunyikan."); });
  });
  btn.addEventListener("click", () => { window.open(ADMIN_URL, "_blank", "noopener"); });
})();

/* ---------- dialog tambah akun, info aplikasi, pesan dari proses utama ---------- */
let UPD = null;
async function openAddAccount(p) {
  const st = await send({ action: "PROXY_GET_STATE" });
  const proxies = (st && st.proxies) || [];
  $("addForm").innerHTML =
    '<div class="dh"><span class="pbadge sm">' + PSHORT[p] + '</span><h2>Tambah akun · ' + PNAME[p] + '</h2><button type="button" class="ibtn" data-act="addcancel" title="Tutup"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
    '<div class="dbd"><div class="sec"><h4>Label akun</h4><input type="text" id="add_label" style="margin-top:6px" placeholder="mis. akun_budi" /></div>' +
    '<div class="sec"><h4>Proxy (opsional)</h4><p class="s">Dipasang ke profil akun ini sejak login pertama, supaya IP-nya konsisten.</p><select id="add_proxy" style="margin-top:6px"><option value="">Tanpa proxy (jaringan asli)</option>' + proxies.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.label || x.host) + "</option>").join("") + '</select></div>' +
    '<div class="hint" id="add_msg" style="margin-top:10px"></div></div>' +
    '<div class="dft"><span class="sp">Jendela login baru akan terbuka.</span><button type="button" class="btn" data-act="addcancel">Batal</button><button type="button" class="btn primary" data-act="addgo" data-p="' + p + '">Buka jendela login</button></div>';
  $("addDlg").showModal(); $("add_label").focus();
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  if (el.dataset.act === "addcancel") return $("addDlg").close();
  if (el.dataset.act === "addgo") {
    const label = $("add_label").value.trim(); if (!label) { $("add_msg").textContent = "Isi label akun dulu."; return; }
    el.disabled = true; $("add_msg").textContent = "Membuka jendela login...";
    const r = await send({ action: "ADD_ACCOUNT", platform: el.dataset.p, label, proxyId: $("add_proxy").value || null });
    el.disabled = false;
    if (r && r.ok) { $("addDlg").close(); toast("Jendela login dibuka. Login di sana; akun tersimpan otomatis."); } else $("add_msg").textContent = (r && r.error) || "Gagal.";
  }
});
function fillAbout() {
  send({ action: "APP_INFO" }).then((r) => {
    const b = $("aboutInfo"); if (!b || !r) return;
    b.textContent = "DHub Desktop v" + r.version + " · " + ({ win32: "Windows", darwin: "macOS", linux: "Linux" }[r.platform] || r.platform) + " · data: " + r.dataDir;
    UPD = r.update; paintUpdate();
  });
}
function paintUpdate() {
  const u = UPD, i = $("updInfo"), b = $("instUpd"); if (!i || !u) return;
  const m = { idle: "Belum dicek.", dev: "Mode pengembangan: update otomatis hanya aktif di aplikasi terpasang.", checking: "Memeriksa update...", latest: "Sudah versi terbaru.", downloading: "Mengunduh v" + (u.latest || "") + " (" + (u.percent || 0) + "%)...", ready: "Update v" + (u.latest || "") + " siap dipasang.", error: "Gagal cek update: " + (u.error || "") };
  i.textContent = m[u.status] || ""; b.hidden = u.status !== "ready";
}
chrome.runtime.onMessage.addListener((m) => {
  if (!m) return;
  if (m.action === "TOAST") toast(m.text);
  if (m.action === "UPDATE_STATUS") { UPD = m.state; paintUpdate(); }
});

load();
