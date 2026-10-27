# DHub Desktop

Versi aplikasi desktop (Windows `.exe` / macOS `.dmg`) dari ekstensi Chrome DHub (logika setara **ekstensi v1.4.0**). Content script (klik & isi komentar) dipakai **tanpa perubahan**; yang ditulis ulang hanya lapisan Chrome-nya.

| Di ekstensi | Di aplikasi ini |
|---|---|
| Cookie satu browser, ganti akun dengan hapus/pasang cookie | **Satu profil (session) terpisah per akun** — cookie, storage, proxy, identitas tidak bercampur |
| Proxy global browser | **Proxy per akun** (`session.setProxy`), login proxy lewat event `login` |
| User-Agent/zona waktu via debugger (muncul bar "sedang di-debug") | CDP bawaan Electron, **tanpa bar** |
| Lane: 1 akun per platform sekaligus | **Paralel sungguhan**: "Akun bersamaan" di task, tiap akun jendelanya sendiri |
| `chrome.storage` / `chrome.alarms` | File JSON lokal (`dhub-data.json`) / timer di aplikasi |
| Popup + dashboard + Manajer Proxy | Jendela aplikasi (desain sama), tray |
| Lisensi | **Server lisensi yang sama** (token ECDSA diverifikasi lokal) |

## Menjalankan (pengembangan)
```bash
npm install
npm start          # jalankan aplikasi
npm test           # uji unit (Store, Scheduler, platform)
npm run smoke      # uji integrasi di dalam Electron (butuh test/ cert, lihat smoke.js)
```

## Build installer
```bash
npm run dist:win   # di Windows  -> dist/DHub-Setup-<versi>.exe
npm run dist:mac   # di macOS    -> dist/DHub-<versi>-universal.dmg
```
`.dmg` **hanya bisa dibuat di macOS** (atau GitHub Actions `macos-latest`). Workflow siap pakai ada di `.github/workflows/release.yml`.

### Auto-update
1. Jalankan `npm run set-repo -- username/nama-repo` (mengisi `build.publish`). Tanpa ini build tetap jalan, hanya auto-update nonaktif.
2. Naikkan `version`, commit, lalu `git tag v2.0.1 && git push --tags` → Actions membangun dan mengunggah ke GitHub Releases.
3. Aplikasi terpasang mengecek tiap 6 jam, mengunduh otomatis, dan memasang saat keluar (atau tombol di **Lanjutan → Tentang aplikasi**).
Repo privat butuh token; paling mudah pakai repo publik khusus rilis (kode tetap privat).

### Penandatanganan (disarankan sebelum dibagikan)
- **macOS**: tanpa Apple Developer Program (±US$99/tahun) + notarisasi, Gatekeeper memblokir dan **auto-update tidak jalan**. Isi secret `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- **Windows**: tanpa sertifikat code-signing, SmartScreen menampilkan peringatan. Set `CSC_LINK`/`CSC_KEY_PASSWORD` (atau layanan cloud signing).
- Ikon `build/icon.png` dibuat dari ikon 128px (buram) — ganti dengan PNG asli ≥ 512×512 (idealnya 1024).

## Pindah dari ekstensi
Di ekstensi: **Export akun**. Di sini, login ulang tiap akun lewat **Akun → Tambah akun** (jendela login terpisah, tersimpan otomatis). Cookie tidak bisa dipindah mentah-mentah karena sesi IG terikat perangkat; login ulang paling aman.

## Yang harus dites di komputer Anda
Hal berikut tidak bisa diuji di lingkungan pengembangan ini:
1. **Login Instagram/TikTok/X/Threads di Electron** & apakah platform menganggap aplikasinya mencurigakan (Chromium tertanam bisa terdeteksi; mulai dengan 1 akun cadangan).
2. Komentar sungguhan, deteksi komentar muncul, like komentar, follow.
3. Proxy berbayar sungguhan (HTTP/SOCKS dengan login), IP keluar & zona waktu otomatis.
4. Installer `.exe`/`.dmg` tertandatangani dan auto-update dari Releases.
5. Lisensi: server lisensi memeriksa header `Origin`; bila menolak, izinkan permintaan tanpa Origin ekstensi / sesuaikan Worker.

## Catatan perilaku
- Jadwal berjalan hanya saat aplikasi hidup. Bila task berjalan/ada jadwal, menutup jendela menyembunyikan ke tray (Keluar via menu tray).
- Jadwal yang terlewat >1 menit (komputer mati/tidur) dimatikan, tidak dijalankan telat.
- Data: `%APPDATA%/DHub` (Windows) / `~/Library/Application Support/DHub` (macOS); tombol **Buka folder data** ada di Lanjutan. Screenshot bukti: `Downloads/DHub/`.
- Menghapus akun juga menghapus profilnya (cookie/storage).

## Struktur
`src/main` (proses utama: store, license, profiles, windows, runner, accounts, scheduler, updater) · `src/preload` (shim `chrome` untuk UI & content script) · `src/content` (content script asli) · `src/ui` (dashboard & Manajer Proxy) · `test/`.
