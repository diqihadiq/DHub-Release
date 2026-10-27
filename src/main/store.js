// store.js — pengganti chrome.storage.local: satu file JSON di folder data aplikasi.
// API sengaja dibuat mirip (get/set/remove + event "changed") supaya logika lama dan UI tidak perlu diubah.
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

class Store extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.data = {};
    this._t = null;
    this._writing = Promise.resolve();
    this.load();
  }
  load() {
    try { this.data = JSON.parse(fs.readFileSync(this.file, "utf8")) || {}; }
    catch (e) {
      this.data = {};
      // file rusak: simpan salinannya, jangan ditimpa diam-diam
      try { if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + ".rusak-" + Date.now()); } catch (e2) {}
      try { const b = this.file + ".bak"; if (fs.existsSync(b)) this.data = JSON.parse(fs.readFileSync(b, "utf8")) || {}; } catch (e3) {}
    }
  }
  _clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  get(keys) {
    if (keys == null) return this._clone(this.data);
    const out = {};
    if (typeof keys === "string") keys = [keys];
    if (Array.isArray(keys)) { keys.forEach((k) => { if (k in this.data) out[k] = this._clone(this.data[k]); }); return out; }
    Object.keys(keys).forEach((k) => { out[k] = k in this.data ? this._clone(this.data[k]) : keys[k]; });
    return out;
  }
  set(obj) {
    const changes = {};
    Object.keys(obj).forEach((k) => {
      const nv = this._clone(obj[k]);
      if (nv === undefined) return;
      const ov = this.data[k];
      if (JSON.stringify(ov) === JSON.stringify(nv)) return;
      changes[k] = { oldValue: ov, newValue: nv };
      this.data[k] = nv;
    });
    this._changed(changes);
  }
  remove(keys) {
    if (typeof keys === "string") keys = [keys];
    const changes = {};
    keys.forEach((k) => { if (k in this.data) { changes[k] = { oldValue: this.data[k] }; delete this.data[k]; } });
    this._changed(changes);
  }
  _changed(changes) {
    if (!Object.keys(changes).length) return;
    this._schedule();
    this.emit("changed", changes);
  }
  _schedule() {
    if (this._t) return;
    this._t = setTimeout(() => { this._t = null; this.flush(); }, 400);
  }
  // tulis atomik: file sementara -> rename; salinan .bak dari versi sebelumnya
  flush() {
    if (this._t) { clearTimeout(this._t); this._t = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      try { if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + ".bak"); } catch (e) {}
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error("[DHub] gagal menulis data:", e.message); }
  }
}
module.exports = { Store };
