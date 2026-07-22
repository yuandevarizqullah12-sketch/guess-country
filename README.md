# 🌍 Guess Country

Rewrite total dari Guess Country. Website tebak-negara dengan mode **Solo** dan
**Multiplayer Private Room** (Create Room / Join Room — tanpa matchmaking global),
**Leaderboard** (solo only), dan **Settings**. Dibangun murni dengan **HTML, CSS,
dan JavaScript (ES Module)** — tanpa framework — plus **Firebase Authentication**
dan **Cloud Firestore**.

## Struktur Project

```
index.html         → satu file HTML, struktur UI saja (div.page + id konsisten)
style.css           → seluruh styling (dark glassmorphism, responsive)
app.js              → seluruh logic aplikasi (navigasi, auth, solo, room, leaderboard)
services/
  api.js             → seluruh fungsi API (Firebase, Firestore, data negara) — tanpa DOM
  data.json           → database lokal ±194 negara
assets/              → folder aset (kosong, disiapkan untuk kebutuhan lain)
README.md
```

## Apa yang Berubah dari Versi Sebelumnya

1. **Rendering Home / Leaderboard / Settings dibuat anti-gagal.** Navigasi sekarang
   memakai satu dispatcher (`PAGE_RENDERERS`) yang selalu memanggil fungsi render
   halaman tujuan di dalam `try/catch`, dan setiap fungsi render memakai nilai
   default (`EMPTY_PROFILE`) jika data profil belum sempat termuat — jadi halaman
   tidak pernah kosong/blank hanya karena Firestore belum selesai membaca.
2. **Leaderboard ditulis ulang total** dengan loading state, empty state, dan error
   state yang eksplisit di `renderLeaderboardPage()`, plus log `[leaderboard]` di
   console untuk memudahkan debug jika data tidak muncul.
3. **Sistem matchmaking global (queue) dihapus total.** Tidak ada lagi collection
   `queue`, tidak ada pairing otomatis. Diganti dengan **Private Room**:
   `Create Room` menghasilkan kode 6 karakter acak yang dibagikan manual (WhatsApp,
   Discord, dll), `Join Room` memasukkan kode tersebut. Room disimpan di collection
   `rooms`, satu dokumen per room, doc id = kode room.
4. **Mode DEBUG** ditambahkan di `services/api.js` (`export const DEBUG = true`).
   Semua langkah penting (bootstrap, auth, navigation, render, firestore,
   leaderboard, room, game, error) mencetak log ke console dengan prefix
   `[scope]`, contoh: `[room] createRoom: created AB82KF`.

## 1. Buat Project Firebase

1. Buka [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. **Build → Authentication → Sign-in method** → aktifkan provider **Google**.
3. **Build → Firestore Database → Create database** (mode production).
4. **Project settings → General → Your apps → Web app (</>)** → daftarkan app,
   salin objek `firebaseConfig`.

## 2. Isi Konfigurasi Firebase

Buka `services/api.js`, ganti blok berikut dengan konfigurasi project kamu:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

## 3. Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /profiles/{uid} {
      allow read: if true;
      allow create: if request.auth != null && request.auth.uid == uid;
      allow update: if request.auth != null && request.auth.uid == uid;
    }

    match /leaderboard/{uid} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }

    match /rooms/{roomCode} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null &&
        (request.auth.uid == resource.data.host.uid ||
         (resource.data.guest != null && request.auth.uid == resource.data.guest.uid) ||
         resource.data.guest == null);
      allow delete: if request.auth != null && request.auth.uid == resource.data.host.uid;
    }
  }
}
```

> Rules di atas cukup permisif agar room bisa diupdate langsung dari client
> (tanpa Cloud Functions). Untuk produksi nyata, pertimbangkan memindahkan
> penentuan skor & advance-round ke Cloud Functions agar tidak bisa dimanipulasi.

## 4. Firestore Index

Leaderboard diurutkan `highestScore DESC, accuracy DESC` → butuh composite index.
Cara termudah: buka halaman **Leaderboard** di app, buka **Console browser (F12)**,
Firestore akan menaruh **link otomatis pembuat index** di pesan error jika index
belum ada — klik link itu lalu **Create Index**. Atau buat manual:

- Collection: `leaderboard`
- Fields: `highestScore` (Descending), `accuracy` (Descending)

## 5. Menjalankan di Localhost

`app.js` memakai ES Module dan `fetch()` ke `services/data.json`, jadi harus
disajikan lewat HTTP server, bukan dibuka sebagai `file://`.

```bash
npx serve .
# atau
python3 -m http.server 5500
```

Tambahkan `localhost` ke **Authentication → Settings → Authorized domains** di
Firebase Console agar Google Sign-In popup berfungsi.

## 6. Deploy ke Vercel

1. Push project ke GitHub.
2. [vercel.com](https://vercel.com) → **New Project** → import repo.
3. Framework preset: **Other** (static site), tanpa build command.
4. Deploy, lalu tambahkan domain `xxx.vercel.app` ke **Authorized domains** Firebase.

## Cara Kerja Fitur

### Solo
Pilih difficulty (Easy/Medium/Hard/Extreme), 10 ronde, clue terungkap bertahap,
skor berdasarkan kecepatan + jumlah clue + combo streak. Hasil akhir meng-upsert
`leaderboard/{uid}` (hanya jika skor baru lebih tinggi) dan meng-update
`profiles/{uid}`.

### Multiplayer — Private Room
- **Create Room**: atur nama room, jumlah round (5/10/15/20), durasi per ronde
  (10/20/30/45/60 detik), dan difficulty. Firestore membuat dokumen
  `rooms/{kodeAcak}` berstatus `lobby`. Kode besar ditampilkan + tombol
  **Copy Room Code** (Clipboard API).
- **Join Room**: masukkan kode. Kode salah/room tidak ada → pesan
  *"Room tidak ditemukan."* Room penuh → *"Room sudah penuh."*
- **Room Lobby**: menampilkan Host & Guest, badge peran masing-masing. Hanya Host
  yang punya tombol **Start Game**; game baru mulai setelah Host menekannya.
- **Game**: Host membuat array ronde (negara + clue) sekali saat Start, sehingga
  Host & Guest menerima negara, petunjuk, timer, dan difficulty yang **identik**.
  Jawaban benar dapat poin (lebih besar jika lebih cepat), salah/telat = 0 poin
  untuk ronde itu. Host bertanggung jawab meng-advance ronde (dengan guard
  `advancing` untuk mencegah race condition ganda).
- **End Game**: skor Host, skor Guest, pemenang ditampilkan. Host punya tombol
  **Rematch** (mulai ulang dengan setting sama). **Leave Room**: Guest keluar →
  room kembali ke lobby (guest di-null-kan). Host keluar → dokumen room dihapus,
  Guest otomatis melihat pesan "Room telah ditutup."

### Leaderboard
Top 100 dari collection `leaderboard`, urut `highestScore DESC, accuracy DESC`.
Solo only. Loading/empty/error state ditangani eksplisit.

### Settings
Ubah nama tampilan (avatar tetap dari Google), lihat statistik lengkap dari
`profiles/{uid}`.

## Mode Debug

Di `services/api.js`:

```js
export const DEBUG = true;
```

Set ke `false` untuk mematikan seluruh `console.log` (error tetap tercetak lewat
`console.error` agar bug production tetap terlihat). Setiap log diberi prefix
scope, contoh:

```
[bootstrap] starting app
[auth] user signed in Abc123
[navigation] navigating to home
[render] page-home rendered successfully
[firestore] loadCountries: loaded 194 negara
[leaderboard] fetchTopLeaderboard: got 12 entries
[room] createRoom: created AB82KF
[game] round advanced AB82KF {...}
```

## Checklist Validasi

- ✅ Login Google berhasil, redirect ke Home
- ✅ Home selalu tampil (dengan default 0 jika profile belum sinkron)
- ✅ Solo Mode berjalan penuh 10 ronde, skor & leaderboard tersimpan
- ✅ Leaderboard menampilkan data real dari Firestore, dengan loading/empty/error state
- ✅ Firestore membaca & menulis (profiles, leaderboard, rooms) tanpa error
- ✅ Create Room menghasilkan kode & menyimpan dokumen `rooms/{code}`
- ✅ Join Room dengan kode valid masuk lobby; kode salah menampilkan pesan error
- ✅ Copy Room Code menyalin ke clipboard
- ✅ Start Game (host only) menyamakan negara/clue/timer untuk kedua pemain
- ✅ Hasil pertandingan (skor Host, skor Guest, pemenang) tampil di akhir
- ✅ Logout mengembalikan ke halaman Login dan membersihkan semua listener

## Batasan yang Diketahui

- Penentuan skor & advance-round multiplayer dijalankan di client (tanpa Cloud
  Functions), jadi secara teori bisa dimanipulasi pengguna yang mengubah kode
  sendiri. Cukup untuk penggunaan kasual/main dengan teman.
- Timer room memakai `Date.now()` client, sehingga sedikit bergantung pada jam
  perangkat masing-masing pemain.
