// scheduler.js — pengganti chrome.alarms. Jadwal task sekali jalan; aplikasi harus berjalan (bisa di tray) saat waktunya tiba.
const MAX_TIMEOUT = 2147000000;

function create(S, runner, log) {
  const timers = new Map();
  const getTasks = () => S.get(["tasks"]).tasks || [];

  function clearAll() { timers.forEach((t) => clearTimeout(t)); timers.clear(); }
  function arm(id, at) {
    const tick = () => {
      const d = at - Date.now();
      if (d > 0) { timers.set(id, setTimeout(tick, Math.min(d, MAX_TIMEOUT))); return; }
      timers.delete(id);
      fire(id);
    };
    tick();
  }
  function fire(id) {
    const tasks = getTasks(), t = tasks.find((x) => x.id === id);
    if (!t || !t.scheduleEnabled) return;
    t.scheduleEnabled = false; // sekali jalan
    S.set({ tasks });
    log("Jadwal tiba: menjalankan task '" + t.name + "'.");
    runner.runTask(id, false);
  }
  function reschedule() {
    clearAll();
    const tasks = getTasks(); let changed = false;
    for (const t of tasks) {
      if (!t.scheduleEnabled || !t.scheduleAt) continue;
      if (t.scheduleAt <= Date.now()) {
        if (Date.now() - t.scheduleAt < 60000) { timers.set(t.id, setTimeout(() => { timers.delete(t.id); fire(t.id); }, 1500)); }
        else { t.scheduleEnabled = false; changed = true; } // terlewat lebih dari 1 menit (komputer mati / tidur): dimatikan, tidak dijalankan telat
        continue;
      }
      arm(t.id, t.scheduleAt);
    }
    if (changed) S.set({ tasks });
  }
  const hasPending = () => getTasks().some((t) => t.scheduleEnabled && t.scheduleAt && t.scheduleAt > Date.now());
  S.on("changed", (ch) => { if (ch.tasks) reschedule(); });
  return { reschedule, hasPending };
}
module.exports = { create };
