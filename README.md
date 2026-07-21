# 🌍 Guess Country

Website tebak-negara dengan mode **Solo** dan **Multiplayer** (random match, matchmaking global),
**Leaderboard** (solo only), dan **Settings**. Dibangun murni dengan **HTML, CSS, dan JavaScript
(ES Module)** — tanpa framework — plus **Firebase Authentication** dan **Firestore**.

## Struktur Project

```
index.html      → struktur UI saja, tanpa logic
style.css        → seluruh styling (dark glassmorphism, responsive)
app.js           → seluruh logic aplikasi (navigasi, auth, solo, multiplayer, dst.)
api/
  api.js         → seluruh fungsi API (Firebase, Firestore, data negara) — tanpa DOM
  data.json      → database lokal ±194 negara (name, capital, currency, region, subregion,
                    population, languages, flag, tld, timezones, borders, aliases)
README.md
```

## 1. Buat Project Firebase

1. Buka [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. Di project baru, buka **Build → Authentication → Sign-in method**, aktifkan
   provider **Google**.
3. Buka **Build → Firestore Database → Create database** (mode production).
4. Buka **Project settings → General → Your apps → Web app (</>)**, daftarkan app,
   lalu salin objek `firebaseConfig` yang muncul.

## 2. Isi Konfigurasi Firebase

Buka `api/api.js`, cari blok berikut di bagian atas file dan ganti dengan konfigurasi
project kamu:

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

Buka **Firestore Database → Rules** dan gunakan aturan berikut sebagai titik awal:

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

    match /queue/{uid} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == uid;
      allow delete: if request.auth != null;
      allow update: if request.auth != null;
    }

    match /games/{gameId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null &&
        (request.auth.uid == resource.data.player1.uid ||
         request.auth.uid == resource.data.player2.uid);
    }
  }
}
```

> Catatan: rules di atas cukup permisif agar matchmaking client-side (tanpa Cloud
> Functions) bisa berjalan. Untuk produksi nyata, pertimbangkan memindahkan
> pairing/scoring ke Cloud Functions agar tidak bisa dimanipulasi client.

## 4. Firestore Index

Leaderboard diurutkan berdasarkan `highestScore DESC, accuracy DESC`, yang butuh
composite index. Saat pertama kali fitur Leaderboard dijalankan, Firestore akan
menampilkan error di console berisi **link otomatis** untuk membuat index tersebut —
tinggal klik link itu. Atau buat manual di **Firestore → Indexes**:

- Collection: `leaderboard`
- Fields: `highestScore` (Descending), `accuracy` (Descending)

Query queue (`status == "waiting"`, order by `joinedAt asc`) juga mungkin meminta
composite index dengan cara yang sama.

## 5. Menjalankan di Localhost

Karena `app.js` memakai ES Module dan `fetch()` untuk `api/data.json`, file harus
disajikan lewat HTTP server (bukan dibuka langsung sebagai `file://`).

```bash
npx serve .
# atau
python3 -m http.server 5500
```

Lalu buka `http://localhost:5500` (sesuaikan port).

Tambahkan `localhost` ke **Authentication → Settings → Authorized domains** di
Firebase Console agar Google Sign-In popup berfungsi.

## 6. Deploy ke Vercel

1. Push project ini ke repository GitHub.
2. Buka [vercel.com](https://vercel.com) → **New Project** → import repository.
3. Framework preset: **Other** (static site) — tidak perlu build command.
4. Deploy.
5. Setelah dapat domain (`xxx.vercel.app`), tambahkan domain tersebut ke
   **Authentication → Settings → Authorized domains** di Firebase Console.

## Cara Kerja Fitur

- **Login** — Google Sign-In (popup). Profil Firestore otomatis dibuat saat login pertama.
- **Solo** — pilih difficulty (Easy/Medium/Hard/Extreme), 10 ronde, clue terungkap
  bertahap, skor berdasarkan kecepatan + jumlah clue yang dipakai + combo streak.
  Hasil akhir langsung meng-upsert dokumen `leaderboard/{uid}` dan update `profiles/{uid}`.
- **Multiplayer** — klik "Cari Lawan" untuk masuk **antrean global** (`queue`
  collection, bukan room). Client yang berada di posisi pertama antrean bertugas
  memasangkan dirinya dengan pemain kedua lewat Firestore **transaction** (mencegah
  race condition), lalu membuat dokumen `games/{gameId}` dan mengosongkan `queue`
  kedua pemain. Kedua negara/petunjuk/waktu sama untuk kedua pemain; skor lebih
  besar untuk jawaban benar yang lebih cepat. Hasil akhir mengupdate `profiles/{uid}`
  masing-masing (bukan leaderboard).
- **Leaderboard** — Top 100 dari collection `leaderboard`, urut `highestScore DESC`,
  lalu `accuracy DESC`. Hanya solo mode.
- **Settings** — ubah nama tampilan (avatar tetap dari Google), lihat statistik
  lengkap dari `profiles/{uid}`.

## Batasan yang Diketahui

- Matchmaking & penentuan skor multiplayer dijalankan di client (tanpa Cloud
  Functions), jadi secara teori bisa dimanipulasi pengguna yang mengubah kode
  sendiri. Cukup aman untuk penggunaan kasual/hobi.
- Timer multiplayer memakai `Date.now()` client, sehingga sedikit bergantung pada
  jam perangkat masing-masing pemain.
