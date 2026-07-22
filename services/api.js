// =====================================================================
// services/api.js
// Seluruh fungsi API murni: Firebase, Firestore, Auth, data negara.
// TIDAK ada manipulasi DOM / UI di file ini.
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  serverTimestamp,
  runTransaction,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------------------------------------------------------------
// DEBUG LOGGER
// Set DEBUG = false untuk mematikan seluruh log di console.
// ---------------------------------------------------------------------
export const DEBUG = true;

export function log(scope, ...args) {
  if (!DEBUG) return;
  console.log(`[${scope}]`, ...args);
}

export function logError(scope, ...args) {
  // Error selalu dicetak walau DEBUG mati, supaya bug production tetap terlihat.
  console.error(`[${scope}]`, ...args);
}

// ---------------------------------------------------------------------
// FIREBASE INITIALIZATION
// Ganti seluruh nilai di bawah ini dengan konfigurasi project
// Firebase kamu sendiri (Firebase Console > Project Settings).
// ---------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyA2UJT5RD7CAcOJR6OTWfpkOEf8l2lhqlw",
  authDomain: "temporaryfileupload-92123.firebaseapp.com",
  projectId: "temporaryfileupload-92123",
  storageBucket: "temporaryfileupload-92123.firebasestorage.app",
  messagingSenderId: "1068057413521",
  appId: "1:1068057413521:web:142ca446afb7cd4dddfc30",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

log("bootstrap", "Firebase initialized", { projectId: firebaseConfig.projectId });

// =====================================================================
// AUTH HELPER
// =====================================================================
export async function signInWithGoogle() {
  log("auth", "signInWithGoogle: opening popup");
  const result = await signInWithPopup(auth, googleProvider);
  log("auth", "signInWithGoogle: success", result.user.uid);
  return result.user;
}

export async function signOutUser() {
  log("auth", "signOutUser");
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, (user) => {
    log("auth", "onAuthChange", user ? user.uid : null);
    callback(user);
  });
}

export function getCurrentUser() {
  return auth.currentUser;
}

// =====================================================================
// PROFILE HELPER — collection "profiles", doc id = uid
// =====================================================================
export async function ensureProfile(user) {
  const ref = doc(db, "profiles", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    log("firestore", "ensureProfile: existing profile", user.uid);
    return snap.data();
  }
  const newProfile = {
    uid: user.uid,
    displayName: user.displayName || "Player",
    photoURL: user.photoURL || "",
    email: user.email || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    highestScore: 0,
    bestAccuracy: 0,
    rating: 1000,
  };
  await setDoc(ref, newProfile);
  log("firestore", "ensureProfile: created new profile", user.uid);
  return newProfile;
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "profiles", uid));
  return snap.exists() ? snap.data() : null;
}

export function listenProfile(uid, callback) {
  return onSnapshot(
    doc(db, "profiles", uid),
    (snap) => {
      if (snap.exists()) {
        log("firestore", "listenProfile: snapshot", uid);
        callback(snap.data());
      }
    },
    (err) => logError("firestore", "listenProfile error", err)
  );
}

export async function updateProfileName(uid, newName) {
  await updateDoc(doc(db, "profiles", uid), {
    displayName: newName,
    updatedAt: serverTimestamp(),
  });
  log("firestore", "updateProfileName", uid, newName);
}

// Update statistik profil sesudah game Solo atau Multiplayer selesai.
export async function applyGameResultToProfile(uid, { score, accuracy, won, isMultiplayer }) {
  const ref = doc(db, "profiles", uid);
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data() : null;

  const patch = {
    updatedAt: serverTimestamp(),
    gamesPlayed: increment(1),
  };

  if (isMultiplayer) {
    if (won === true) patch.wins = increment(1);
    if (won === false) patch.losses = increment(1);
  }

  if (!current || score > (current.highestScore || 0)) {
    patch.highestScore = score;
  }
  if (!current || accuracy > (current.bestAccuracy || 0)) {
    patch.bestAccuracy = accuracy;
  }

  let ratingDelta = 0;
  if (isMultiplayer) {
    ratingDelta = won ? 18 : won === false ? -12 : 0;
  } else {
    ratingDelta = Math.round(accuracy / 10);
  }
  patch.rating = increment(ratingDelta);

  await updateDoc(ref, patch);
  log("firestore", "applyGameResultToProfile", uid, patch);
}

// =====================================================================
// LEADERBOARD HELPER — collection "leaderboard", doc id = uid (SOLO ONLY)
// Satu user hanya satu entry. Skor baru hanya menimpa jika lebih tinggi.
// =====================================================================
export async function upsertLeaderboardEntry({ uid, displayName, photoURL, score, accuracy }) {
  const ref = doc(db, "leaderboard", uid);
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data() : null;

  if (current && current.highestScore >= score) {
    await updateDoc(ref, {
      displayName,
      photoURL,
      gamesPlayed: (current.gamesPlayed || 0) + 1,
      updatedAt: serverTimestamp(),
    });
    log("leaderboard", "upsertLeaderboardEntry: score not higher, refreshed metadata only", uid);
    return;
  }

  await setDoc(
    ref,
    {
      uid,
      displayName,
      photoURL,
      highestScore: score,
      accuracy,
      gamesPlayed: (current?.gamesPlayed || 0) + 1,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  log("leaderboard", "upsertLeaderboardEntry: new high score saved", uid, score);
}

export async function fetchTopLeaderboard(topN = 100) {
  log("leaderboard", "fetchTopLeaderboard: querying", topN);
  const q = query(
    collection(db, "leaderboard"),
    orderBy("highestScore", "desc"),
    orderBy("accuracy", "desc"),
    limit(topN)
  );
  const snap = await getDocs(q);
  const entries = snap.docs.map((d) => d.data());
  log("leaderboard", "fetchTopLeaderboard: got", entries.length, "entries");
  return entries;
}

// =====================================================================
// COUNTRY HELPER — reads services/data.json (local database, no external API)
// =====================================================================
let countryCache = null;

export async function loadCountries() {
  if (countryCache) return countryCache;
  log("firestore", "loadCountries: fetching services/data.json");
  const res = await fetch("./services/data.json");
  if (!res.ok) throw new Error("Gagal memuat data negara");
  countryCache = await res.json();
  log("firestore", "loadCountries: loaded", countryCache.length, "negara");
  return countryCache;
}

export function pickRandomCountry(countries, excludeNames = []) {
  const pool = countries.filter((c) => !excludeNames.includes(c.name));
  const source = pool.length ? pool : countries;
  return source[Math.floor(Math.random() * source.length)];
}

export function buildClueSet(country) {
  const clues = [];
  clues.push(`Negara ini berada di benua ${country.region}${country.subregion ? " (" + country.subregion + ")" : ""}.`);
  clues.push(`Populasinya sekitar ${formatPopulation(country.population)} jiwa.`);
  clues.push(`Mata uang yang digunakan adalah ${country.currency}.`);
  clues.push(`Bahasa yang digunakan antara lain: ${country.languages.slice(0, 3).join(", ")}.`);
  if (country.borders && country.borders.length) {
    clues.push(`Negara ini berbatasan dengan ${country.borders.slice(0, 3).join(", ")}.`);
  } else {
    clues.push(`Negara ini adalah negara kepulauan / tidak berbatasan darat.`);
  }
  clues.push(`Ibu kotanya adalah ${country.capital}.`);
  clues.push(`Kode domain internetnya adalah ${country.tld}. Bendera: ${country.flag}`);
  return clues;
}

function formatPopulation(pop) {
  if (!pop) return "tidak diketahui";
  if (pop >= 1_000_000) return (pop / 1_000_000).toFixed(1) + " juta";
  if (pop >= 1_000) return (pop / 1_000).toFixed(0) + " ribu";
  return String(pop);
}

export function normalizeAnswer(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

export function isAnswerCorrect(input, country) {
  const normalizedInput = normalizeAnswer(input);
  if (!normalizedInput) return false;
  const candidates = [country.name, country.officialName, ...(country.aliases || [])];
  return candidates.some((c) => normalizeAnswer(c) === normalizedInput);
}

export function searchCountryNames(countries, queryStr, max = 6) {
  const q = normalizeAnswer(queryStr);
  if (!q) return [];
  return countries
    .filter((c) => normalizeAnswer(c.name).includes(q))
    .slice(0, max)
    .map((c) => c.name);
}

// =====================================================================
// ROOM HELPER — collection "rooms" (private-room multiplayer)
// Doc id = kode room acak 6 karakter. Tidak ada queue / matchmaking global.
// =====================================================================
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa 0/O/1/I agar tak rancu
const ROOM_CODE_LENGTH = 6;

function generateRoomCode() {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export async function createRoom(hostUser, settings) {
  log("room", "createRoom: settings", settings);
  let code = "";
  let attempts = 0;

  // Pastikan kode belum dipakai room lain yang masih aktif.
  while (attempts < 8) {
    const candidate = generateRoomCode();
    const snap = await getDoc(doc(db, "rooms", candidate));
    if (!snap.exists()) {
      code = candidate;
      break;
    }
    attempts += 1;
  }
  if (!code) throw new Error("Gagal membuat kode room, coba lagi.");

  const roomData = {
    code,
    name: settings.name || "Room",
    settings: {
      totalRounds: settings.totalRounds,
      roundSeconds: settings.roundSeconds,
      difficulty: settings.difficulty,
    },
    host: {
      uid: hostUser.uid,
      displayName: hostUser.displayName || "Host",
      photoURL: hostUser.photoURL || "",
      score: 0,
    },
    guest: null,
    status: "lobby", // lobby | in_progress | finished
    round: 0,
    rounds: [],
    answers: {},
    roundStartAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "rooms", code), roomData);
  log("room", "createRoom: created", code);
  return code;
}

export async function joinRoom(code, guestUser) {
  const normalizedCode = (code || "").trim().toUpperCase();
  log("room", "joinRoom: attempt", normalizedCode);
  const roomRef = doc(db, "rooms", normalizedCode);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) {
      throw new Error("NOT_FOUND");
    }
    const data = snap.data();

    if (data.host.uid === guestUser.uid) {
      throw new Error("OWN_ROOM");
    }
    if (data.guest && data.guest.uid !== guestUser.uid) {
      throw new Error("ROOM_FULL");
    }

    tx.update(roomRef, {
      guest: {
        uid: guestUser.uid,
        displayName: guestUser.displayName || "Guest",
        photoURL: guestUser.photoURL || "",
        score: 0,
      },
      updatedAt: serverTimestamp(),
    });
  });

  log("room", "joinRoom: success", normalizedCode);
  return normalizedCode;
}

export function listenRoom(code, callback) {
  return onSnapshot(
    doc(db, "rooms", code),
    (snap) => {
      if (snap.exists()) {
        log("room", "listenRoom: snapshot", code, snap.data().status);
        callback({ id: snap.id, ...snap.data() });
      } else {
        log("room", "listenRoom: room deleted", code);
        callback(null);
      }
    },
    (err) => logError("room", "listenRoom error", err)
  );
}

export async function startRoomGame(code, rounds) {
  await updateDoc(doc(db, "rooms", code), {
    status: "in_progress",
    round: 0,
    rounds,
    answers: {},
    "host.score": 0,
    "guest.score": 0,
    roundStartAt: Date.now(),
    updatedAt: serverTimestamp(),
  });
  log("game", "startRoomGame", code, "rounds:", rounds.length);
}

export async function submitRoomAnswer(code, uid, payload) {
  await updateDoc(doc(db, "rooms", code), {
    [`answers.${uid}`]: payload,
    updatedAt: serverTimestamp(),
  });
  log("game", "submitRoomAnswer", code, uid, payload);
}

export async function advanceRoomRound(code, patch) {
  await updateDoc(doc(db, "rooms", code), { ...patch, updatedAt: serverTimestamp() });
  log("game", "advanceRoomRound", code, patch);
}

export async function leaveRoom(code, role) {
  log("room", "leaveRoom", code, role);
  if (role === "host") {
    await deleteDoc(doc(db, "rooms", code));
    return;
  }
  await updateDoc(doc(db, "rooms", code), {
    guest: null,
    status: "lobby",
    updatedAt: serverTimestamp(),
  });
}

// =====================================================================
// STORAGE HELPER — thin wrapper around localStorage
// =====================================================================
const STORAGE_PREFIX = "guess-country:";

export function storageSet(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (_) {
    /* storage unavailable */
  }
}

export function storageGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function storageRemove(key) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch (_) {
    /* noop */
  }
}
