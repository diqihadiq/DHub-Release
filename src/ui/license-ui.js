// license-ui.js — teks status licence untuk popup dan halaman options (hanya tampilan; keputusan ada di server)
const PLAN_LABEL = { trial: "Trial", weekly: "Mingguan", monthly: "Bulanan", yearly: "Tahunan", lifetime: "Lifetime", custom: "Kustom", legacy: "Lama" };
function licenseInfo(s) {
  const st = s.license_state || null, ex = s.license_expired || null;
  const fmt = (ts) => new Date(ts).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const expired = (ts) => ({ cls: "bad", expired: true, text: "Licence habis" + (ts ? " sejak " + fmt(ts) : "") + ". Hubungi admin untuk perpanjang." });
  if (ex) return expired(ex.expiresAt);
  if (!st) return { cls: "", expired: false, text: "Memverifikasi licence..." };
  const plan = PLAN_LABEL[st.plan] || st.plan || "";
  if (st.expiresAt == null) return { cls: "", expired: false, text: "Paket " + plan + " · tanpa batas waktu" };
  const days = Math.ceil((st.expiresAt - Date.now()) / 86400000);
  if (days <= 0) return expired(st.expiresAt);
  return { cls: days <= 3 ? "warn" : "", expired: false, text: "Paket " + plan + " · aktif sampai " + fmt(st.expiresAt) + " (" + days + " hari lagi)" + (days <= 3 ? ". Segera perpanjang." : "") };
}
