// license.js — port apa adanya dari blok LICENCE di background.js. Server lisensi yang sama (Cloudflare Worker).
const crypto = require("crypto");
const subtle = crypto.webcrypto.subtle;

const LICENSE_SERVER = "https://instabot-licence.alissyaargani-ed0.workers.dev";
const LICENSE_GRACE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 10 * 60 * 1000;
const EXPIRED_MSG = "Licence habis, hubungi admin.";
// Public key (ECDSA P-256) pasangan dari SIGNING_KEY di Worker.
const LICENSE_PUBKEY = { "kty": "EC", "x": "W8FTjhwClJulCw6z1KD9XVbrXulB9oP8QILQMFfT18c", "y": "29UxiJ4rmkquEuaLFNW449yhmOpE7X52rC5Iugs2Epk", "crv": "P-256" };
const LICENSE_REJECT_CODES = ["notfound", "revoked", "device", "inactive"];

function create(store, appVersion) {
  const S = store;
  const get = (k) => S.get(k);

  function getDeviceId() {
    const s = get(["device_id"]);
    if (s.device_id) return s.device_id;
    const id = crypto.randomUUID();
    S.set({ device_id: id });
    return id;
  }
  async function callLicense(path, key, nonce, extra) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(LICENSE_SERVER + path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ key, deviceId: getDeviceId(), nonce }, extra || {})), signal: ctrl.signal
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!data || typeof data !== "object") throw new Error("respons server tidak valid");
      return data;
    } finally { clearTimeout(timer); }
  }
  const b64uToBytes = (s) => new Uint8Array(Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  let pubP = null;
  const getPub = () => pubP || (pubP = subtle.importKey("jwk", LICENSE_PUBKEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));

  async function verifyToken(token, expect) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 2) return null;
      const ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await getPub(), b64uToBytes(parts[1]), new TextEncoder().encode(parts[0]));
      if (!ok) return null;
      const p = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0])));
      if (!p || p.v !== 1 || p.k !== expect.key || p.d !== expect.deviceId) return null;
      if (expect.nonce !== undefined && p.n !== expect.nonce) return null;
      return p;
    } catch (e) { return null; }
  }
  function storeLicense(key, p, token) {
    const s = get(["license_seen"]);
    S.set({ license_key: key, license_state: { token, plan: p.p, expiresAt: p.e == null ? null : p.e, serverTime: p.t }, license_expired: null, license_seen: Math.max(Date.now(), s.license_seen || 0) });
    S.remove(["license_verified_at"]);
  }
  function clearLicense() { S.remove(["license_key", "license_state", "license_expired", "license_seen", "license_verified_at", "dhub_cfg"]); }

  async function syncConfig(key, lp) {
    try {
      if (lp.c == null) return;
      const have = get(["dhub_cfg"]).dhub_cfg;
      if (have && have.version === lp.c) return;
      const nonce = crypto.randomUUID();
      const d = await callLicense("/config", key, nonce);
      if (!d.ok) return;
      const p = await verifyToken(d.token, { key, deviceId: getDeviceId(), nonce });
      if (p && p.cfg && typeof p.cfg === "object") S.set({ dhub_cfg: { version: p.c, token: d.token } });
    } catch (e) {}
  }
  function offlineCheck(key) {
    return (async () => {
      const s = get(["license_state", "license_seen"]);
      const st = s.license_state;
      if (!st || !st.token) return { ok: false, error: "Tidak bisa verifikasi licence (server tidak terjangkau)." };
      const p = await verifyToken(st.token, { key, deviceId: getDeviceId() });
      if (!p) return { ok: false, error: "Data licence lokal tidak valid. Hubungkan internet lalu coba lagi." };
      const now = Date.now();
      if (now < p.t - CLOCK_SKEW_MS || (s.license_seen && now < s.license_seen - CLOCK_SKEW_MS)) return { ok: false, error: "Jam komputer tidak wajar. Perbaiki jam lalu hubungkan internet." };
      if (now - p.t > LICENSE_GRACE_MS) return { ok: false, error: "Tidak bisa verifikasi licence (offline terlalu lama)." };
      if (p.e && now > p.e) return { ok: false, expired: true, error: EXPIRED_MSG };
      if (now > (s.license_seen || 0)) S.set({ license_seen: now });
      return { ok: true, offline: true, plan: p.p, expiresAt: p.e == null ? null : p.e };
    })();
  }
  async function verifyLicenseOnce() {
    const key = get(["license_key"]).license_key;
    if (!key) return { ok: false, error: "Belum ada licence." };
    const nonce = crypto.randomUUID();
    let data;
    try { data = await callLicense("/verify", key, nonce); } catch (e) { return offlineCheck(key); }
    if (data.ok) {
      const p = await verifyToken(data.token, { key, deviceId: getDeviceId(), nonce });
      if (!p) return { ok: false, error: "Respons server licence tidak valid." };
      storeLicense(key, p, data.token);
      await syncConfig(key, p);
      return { ok: true, plan: p.p, expiresAt: p.e == null ? null : p.e };
    }
    if (data.code === "expired") {
      S.set({ license_expired: { expiresAt: data.expiresAt || null, at: Date.now() } });
      return { ok: false, expired: true, error: data.error || EXPIRED_MSG };
    }
    if (LICENSE_REJECT_CODES.indexOf(data.code) >= 0) { clearLicense(); return { ok: false, error: data.error || "Licence ditolak server." }; }
    return offlineCheck(key);
  }
  async function activateLicense(key) {
    key = (key || "").trim().toUpperCase();
    if (!key) return { ok: false, error: "Licence masih kosong." };
    const nonce = crypto.randomUUID();
    let data;
    try { data = await callLicense("/activate", key, nonce); } catch (e) { return { ok: false, error: "Tidak bisa terhubung ke server licence." }; }
    if (data.ok) {
      const p = await verifyToken(data.token, { key, deviceId: getDeviceId(), nonce });
      if (!p) return { ok: false, error: "Respons server licence tidak valid." };
      storeLicense(key, p, data.token);
      await syncConfig(key, p);
      return { ok: true, plan: p.p, expiresAt: p.e };
    }
    return { ok: false, error: data.error || "Licence tidak valid." };
  }
  // selector config untuk content script — hanya diberikan kalau licence lokal masih valid
  async function getConfig() {
    const s = get(["license_key", "dhub_cfg"]);
    if (!s.license_key) return { ok: false, error: "Licence belum aktif." };
    let lic = await offlineCheck(s.license_key);
    if (!lic.ok && !lic.expired) lic = await verifyLicenseOnce();
    if (!lic.ok) return { ok: false, error: lic.error };
    let c = get(["dhub_cfg"]).dhub_cfg;
    if (!c || !c.token) { await verifyLicenseOnce(); c = get(["dhub_cfg"]).dhub_cfg; }
    if (!c || !c.token) return { ok: false, error: "Konfigurasi belum tersedia dari server. Hubungkan internet lalu buka DHub." };
    const p = await verifyToken(c.token, { key: s.license_key, deviceId: getDeviceId() });
    if (!p || !p.cfg) return { ok: false, error: "Konfigurasi lokal tidak valid. Hubungkan internet lalu coba lagi." };
    return { ok: true, cfg: p.cfg, version: p.c };
  }
  async function sendReport(payload) {
    const key = get(["license_key"]).license_key;
    if (!key) return { ok: false, error: "Licence belum aktif." };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const body = Object.assign({ key, deviceId: getDeviceId(), v: appVersion }, payload);
      const res = await fetch(LICENSE_SERVER + "/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      let d = null; try { d = await res.json(); } catch (e) {}
      return d && typeof d === "object" ? d : { ok: false, error: "respons server tidak valid" };
    } catch (e) { return { ok: false, error: e.message || String(e) }; } finally { clearTimeout(timer); }
  }
  return { activateLicense, verifyLicenseOnce, getConfig, sendReport, getDeviceId, clearLicense, LICENSE_SERVER };
}
module.exports = { create };
