// unit.js — uji tanpa Electron (npm test): Store, Scheduler, konfigurasi platform & profil identitas.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { Store } = require("../src/main/store");
const Scheduler = require("../src/main/scheduler");
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log("PASS " + name); } catch (e) { console.log("FAIL " + name + "\n  " + e.message); process.exitCode = 1; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dhub-u-"));

(async () => {
  await t("Store: set/get/remove + event changed", () => {
    const s = new Store(path.join(tmp(), "d.json")); const ev = [];
    s.on("changed", (c) => ev.push(c));
    s.set({ a: { x: 1 }, b: 2 }); s.set({ b: 2 }); // set yang sama tidak memicu event
    assert.deepStrictEqual(s.get(["a"]), { a: { x: 1 } });
    assert.strictEqual(ev.length, 1); assert.deepStrictEqual(ev[0].a.newValue, { x: 1 });
    assert.deepStrictEqual(s.get({ zz: 5 }), { zz: 5 });
    s.remove("a"); assert.deepStrictEqual(s.get(["a"]), {}); assert.strictEqual(ev.length, 2);
    s.flush();
  });
  await t("Store: get mengembalikan salinan (mutasi tidak bocor)", () => {
    const s = new Store(path.join(tmp(), "d.json")); s.set({ l: [1] });
    s.get(["l"]).l.push(2); assert.deepStrictEqual(s.get(["l"]).l, [1]); s.flush();
  });
  await t("Store: tersimpan ke file & dimuat ulang", () => {
    const f = path.join(tmp(), "d.json"); const s = new Store(f); s.set({ k: "v" }); s.flush();
    assert.strictEqual(new Store(f).get(["k"]).k, "v");
  });
  await t("Store: file rusak -> pulih dari .bak & salinan rusak disimpan", () => {
    const f = path.join(tmp(), "d.json"); const s = new Store(f); s.set({ k: 1 }); s.flush(); s.set({ k: 2 }); s.flush();
    fs.writeFileSync(f, "{rusak");
    const s2 = new Store(f); assert.strictEqual(s2.get(["k"]).k, 1);
    assert.ok(fs.readdirSync(path.dirname(f)).some((x) => /rusak-/.test(x)));
  });
  await t("Scheduler: jadwal tiba -> task dijalankan sekali & dimatikan", async () => {
    const s = new Store(path.join(tmp(), "d.json")); const ran = [];
    s.set({ tasks: [{ id: "T1", name: "uji", scheduleEnabled: true, scheduleAt: Date.now() + 300 }] });
    const sc = Scheduler.create(s, { runTask: (id) => ran.push(id) }, () => {});
    sc.reschedule(); assert.ok(sc.hasPending());
    await new Promise((r) => setTimeout(r, 700));
    assert.deepStrictEqual(ran, ["T1"]); assert.strictEqual(s.get(["tasks"]).tasks[0].scheduleEnabled, false); assert.ok(!sc.hasPending()); s.flush();
  });
  await t("Scheduler: jadwal terlewat >1 menit dimatikan, tidak dijalankan", () => {
    const s = new Store(path.join(tmp(), "d.json")); const ran = [];
    s.set({ tasks: [{ id: "T2", scheduleEnabled: true, scheduleAt: Date.now() - 120000 }] });
    Scheduler.create(s, { runTask: (id) => ran.push(id) }, () => {}).reschedule();
    assert.deepStrictEqual(ran, []); assert.strictEqual(s.get(["tasks"]).tasks[0].scheduleEnabled, false); s.flush();
  });
  await t("Scheduler: ubah task memicu penjadwalan ulang", async () => {
    const s = new Store(path.join(tmp(), "d.json")); const ran = [];
    const sc = Scheduler.create(s, { runTask: (id) => ran.push(id) }, () => {}); sc.reschedule();
    s.set({ tasks: [{ id: "T3", scheduleEnabled: true, scheduleAt: Date.now() + 200 }] });
    await new Promise((r) => setTimeout(r, 600)); assert.deepStrictEqual(ran, ["T3"]); s.flush();
  });
  await t("Platform: pola host & cookie sesi", () => {
    const P = require("../src/main/profiles");
    assert.ok(P.PLATFORMS.instagram.hosts.test("www.instagram.com"));
    assert.ok(P.PLATFORMS.x.hosts.test("twitter.com") && P.PLATFORMS.x.hosts.test("x.com"));
    assert.ok(!P.PLATFORMS.x.hosts.test("evilx.com"));
    assert.ok(P.PLATFORMS.x.session.test("auth_token") && !P.PLATFORMS.x.session.test("ct0"));
    assert.ok(P.ID_PROFILES.length >= 3 && P.ID_PROFILES.every((p) => p.id && p.name));
  });
  await t("Proxy massal: roundrobin / same / clear / filter / peringatan IP bersama", async () => {
    const P = require("../src/main/profiles");
    const st = new Store(path.join(tmp(), "d.json"));
    st.set({ dhub_proxies: [{ id: "p1", host: "a", port: 1, usernameTemplate: "u" }, { id: "p2", host: "b", port: 2, usernameTemplate: "u-{session}" }],
      saved_accounts: [{ label: "a1", platform: "instagram" }, { label: "a2", platform: "instagram" }, { label: "a3", platform: "instagram" }, { label: "t1", platform: "tiktok" }] });
    const pr = P.create(st);
    let r = await pr.handle({ action: "PROXY_ASSIGN_BULK", how: "roundrobin", platform: "instagram" });
    assert.ok(r.ok && r.count === 3);
    const ig = st.get(["saved_accounts"]).saved_accounts;
    assert.deepStrictEqual(ig.slice(0, 3).map((a) => a.proxyId), ["p1", "p2", "p1"]);
    assert.ok(!ig[3].proxyId, "akun TikTok tidak tersentuh filter platform");
    assert.ok(/tanpa \{session\}/.test(r.warn), "p1 dipakai 2 akun tanpa {session} -> peringatan");
    r = await pr.handle({ action: "PROXY_ASSIGN_BULK", how: "same", proxyId: "p2", onlyUnassigned: true });
    assert.ok(r.ok && r.count === 1 && st.get(["saved_accounts"]).saved_accounts[3].proxyId === "p2");
    r = await pr.handle({ action: "PROXY_ASSIGN_BULK", how: "clear" });
    assert.ok(r.ok && st.get(["saved_accounts"]).saved_accounts.every((a) => !a.proxyId));
    r = await pr.handle({ action: "PROXY_ASSIGN_BULK", how: "same", proxyId: "zzz" });
    assert.ok(!r.ok);
    st.flush();
  });
  await t("Identitas: mode proxy_only default, bisa diubah ke all", async () => {
    const P = require("../src/main/profiles");
    const st = new Store(path.join(tmp(), "d.json")); const pr = P.create(st);
    let r = await pr.handle({ action: "IDENTITY_MODE", mode: "all" }); assert.strictEqual(r.settings.identityMode, "all");
    r = await pr.handle({ action: "IDENTITY_MODE", mode: "apa-saja" }); assert.strictEqual(r.settings.identityMode, "proxy_only");
    const acc = { label: "x", platform: "instagram" };
    assert.strictEqual(await pr.identityPrepare(acc, "instagram", false, null), null, "tanpa proxy -> perangkat asli");
    st.flush();
  });
  console.log(n + " tes lulus"); setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
