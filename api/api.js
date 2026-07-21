// =====================================================================
// api/api.js
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
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  serverTimestamp,
  runTransaction,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
  appId: "1:1068057413521:web:142ca446afb7cd4dddfc30"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// =====================================================================
// AUTH HELPER
// =====================================================================
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
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
    totalPoints: 0,
  };
  await setDoc(ref, newProfile);
  return newProfile;
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "profiles", uid));
  return snap.exists() ? snap.data() : null;
}

export function listenProfile(uid, callback) {
  return onSnapshot(doc(db, "profiles", uid), (snap) => {
    if (snap.exists()) callback(snap.data());
  });
}

export async function updateProfileName(uid, newName) {
  await updateDoc(doc(db, "profiles", uid), {
    displayName: newName,
    updatedAt: serverTimestamp(),
  });
}

// Update profile statistics after a Solo or Multiplayer game finishes.
export async function applyGameResultToProfile(uid, { score, accuracy, won, isMultiplayer }) {
  const ref = doc(db, "profiles", uid);
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data() : null;

  const patch = {
    updatedAt: serverTimestamp(),
    gamesPlayed: increment(1),
    totalPoints: increment(score),
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

  // Simple rating adjustment: solo contributes small gains, multiplayer wins/losses shift more.
  let ratingDelta = 0;
  if (isMultiplayer) {
    ratingDelta = won ? 18 : -12;
  } else {
    ratingDelta = Math.round(accuracy / 10);
  }
  patch.rating = increment(ratingDelta);

  await updateDoc(ref, patch);
}

// =====================================================================
// LEADERBOARD HELPER — collection "leaderboard", doc id = uid (SOLO ONLY)
// =====================================================================
export async function upsertLeaderboardEntry({ uid, displayName, photoURL, score, accuracy, gamesPlayed }) {
  const ref = doc(db, "leaderboard", uid);
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data() : null;

  if (current && current.highestScore >= score) {
    // Keep existing higher score, but refresh secondary fields.
    await updateDoc(ref, {
      displayName,
      photoURL,
      gamesPlayed: (current.gamesPlayed || 0) + 1,
      updatedAt: serverTimestamp(),
    });
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
}

export async function fetchTopLeaderboard(topN = 100) {
  const q = query(
    collection(db, "leaderboard"),
    orderBy("highestScore", "desc"),
    orderBy("accuracy", "desc"),
    limit(topN)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

// =====================================================================
// COUNTRY HELPER — reads api/data.json (local database, no external API)
// =====================================================================
let countryCache = null;

export async function loadCountries() {
  if (countryCache) return countryCache;
  const res = await fetch("./api/data.json");
  if (!res.ok) throw new Error("Gagal memuat data negara");
  countryCache = await res.json();
  return countryCache;
}

export function pickRandomCountry(countries, excludeNames = []) {
  const pool = countries.filter((c) => !excludeNames.includes(c.name));
  const source = pool.length ? pool : countries;
  return source[Math.floor(Math.random() * source.length)];
}

// Build a progressive list of clues for a country, ordered from vague to specific.
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
// QUEUE HELPER — collection "queue", doc id = uid (GLOBAL MATCHMAKING)
// =====================================================================
export async function joinQueue(user) {
  await setDoc(doc(db, "queue", user.uid), {
    uid: user.uid,
    displayName: user.displayName || "Player",
    photoURL: user.photoURL || "",
    joinedAt: serverTimestamp(),
    status: "waiting",
    gameId: null,
  });
}

export async function leaveQueue(uid) {
  try {
    await deleteDoc(doc(db, "queue", uid));
  } catch (_) {
    /* already removed */
  }
}

export function listenWaitingQueue(callback) {
  const q = query(collection(db, "queue"), where("status", "==", "waiting"), orderBy("joinedAt", "asc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => d.data()));
  });
}

export function listenMyQueueDoc(uid, callback) {
  return onSnapshot(doc(db, "queue", uid), (snap) => {
    if (snap.exists()) callback(snap.data());
  });
}

// Attempt to pair the two earliest waiting players. Only the client that is
// itself first-in-line performs this, keeping writes low. A transaction
// guards against double-matching if two clients race.
export async function tryPairPlayers(candidateA, candidateB, buildGamePayload) {
  const gameRef = doc(collection(db, "games"));
  await runTransaction(db, async (tx) => {
    const qaRef = doc(db, "queue", candidateA.uid);
    const qbRef = doc(db, "queue", candidateB.uid);
    const qaSnap = await tx.get(qaRef);
    const qbSnap = await tx.get(qbRef);

    if (!qaSnap.exists() || !qbSnap.exists()) throw new Error("PLAYER_LEFT_QUEUE");
    if (qaSnap.data().status !== "waiting" || qbSnap.data().status !== "waiting") {
      throw new Error("ALREADY_MATCHED");
    }

    const gamePayload = buildGamePayload(gameRef.id);
    tx.set(gameRef, gamePayload);
    tx.update(qaRef, { status: "matched", gameId: gameRef.id });
    tx.update(qbRef, { status: "matched", gameId: gameRef.id });
  });
  return gameRef.id;
}

export function countWaitingPlayers(waitingDocs) {
  return waitingDocs.length;
}

// =====================================================================
// GAME HELPER — collection "games" (multiplayer match state)
// =====================================================================
export function listenGame(gameId, callback) {
  return onSnapshot(doc(db, "games", gameId), (snap) => {
    if (snap.exists()) callback({ id: snap.id, ...snap.data() });
  });
}

export async function submitMultiplayerAnswer(gameId, uid, payload) {
  await updateDoc(doc(db, "games", gameId), {
    [`answers.${uid}`]: payload,
  });
}

export async function advanceGameRound(gameId, patch) {
  await updateDoc(doc(db, "games", gameId), patch);
}

export async function addScoreToPlayer(gameId, playerKey, points) {
  await updateDoc(doc(db, "games", gameId), {
    [`${playerKey}.score`]: increment(points),
  });
}

export async function finishGame(gameId, patch) {
  await updateDoc(doc(db, "games", gameId), { status: "finished", ...patch });
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
