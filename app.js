// =====================================================================
// app.js
// Seluruh logic aplikasi Guess Country.
// Navigasi, auth (Google + Email), solo, multiplayer (room + matchmaking),
// leaderboard (cached), settings, cache, offline handling.
// =====================================================================

import * as api from "./services/api.js";
import { log, logError } from "./services/api.js";
import { cache, staleWhileRevalidate } from "./services/cache.js";

// =====================================================================
// GLOBAL STATE
// =====================================================================
const EMPTY_PROFILE = {
  displayName: "Player",
  photoURL: "",
  email: "",
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  highestScore: 0,
  bestAccuracy: 0,
  rating: 1000,
};

const state = {
  user: null,
  profile: null,
  countries: [],
  currentPage: "login",
  profileUnsub: null,

  solo: {
    difficulty: null,
    config: null,
    used: [],
    round: 0,
    totalRounds: 0,
    score: 0,
    combo: 0,
    bestStreak: 0,
    correctCount: 0,
    totalAnswered: 0,
    currentCountry: null,
    revealedClues: [],
    allClues: [],
    timeLeft: 0,
    tickInterval: null,
    revealTimer: 0,
  },

  // Private room ATAU matchmaking match — keduanya disimpan di collection
  // "rooms" yang sama, dibedakan lewat roomData.type ("private" | "matchmaking").
  room: {
    role: null, // 'host' | 'guest'
    code: null,
    data: null,
    unsub: null,
    lastRenderedRound: -1,
    lastStatus: null,
    answered: false,
    advancing: false,
    resultApplied: false,
    localTickInterval: null,
  },

  matchmaking: {
    searching: false,
    searchSeconds: 0,
    searchInterval: null,
    queueUnsub: null,
    myQueueUnsub: null,
    attemptingMatch: false,
  },
};

const DIFFICULTY_CONFIG = {
  easy: { label: "Easy", roundSeconds: 40, revealInterval: 7, maxClues: 7, totalRounds: 10, basePoints: 100 },
  medium: { label: "Medium", roundSeconds: 28, revealInterval: 6, maxClues: 5, totalRounds: 10, basePoints: 150 },
  hard: { label: "Hard", roundSeconds: 18, revealInterval: 5, maxClues: 3, totalRounds: 10, basePoints: 200 },
  extreme: { label: "Extreme", roundSeconds: 10, revealInterval: 20, maxClues: 1, totalRounds: 10, basePoints: 320 },
};

const ROOM_DIFFICULTY_CLUE_COUNT = { easy: 5, medium: 4, hard: 3, extreme: 2 };
const ROOM_BASE_POINTS = { easy: 100, medium: 150, hard: 200, extreme: 280 };
const LEADERBOARD_TTL_MS = 60000; // 60 detik, sesuai spesifikasi cache leaderboard.
const LEADERBOARD_CACHE_KEY = "leaderboard:top100";

// =====================================================================
// DOM SHORTCUTS
// =====================================================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function setAvatarSrc(imgEl, url) {
  if (!imgEl) return;
  imgEl.referrerPolicy = "no-referrer"; // browser tetap men-cache foto Google secara normal
  imgEl.src = url || "";
}

// =====================================================================
// BOOTSTRAP
// =====================================================================
async function bootstrap() {
  log("bootstrap", "starting app");

  try {
    state.countries = await api.loadCountries();
    cache.set("countries", state.countries, null); // load sekali, simpan di memory
    log("bootstrap", "countries loaded", state.countries.length);
  } catch (err) {
    logError("error", "failed to load countries", err);
    showToast("Gagal memuat database negara. Cek koneksi kamu.", "error");
  }

  registerNavigation();
  registerConnectionEvents();
  registerLoginViewEvents();
  registerAuthEvents();
  registerSoloEvents();
  registerMultiplayerEvents();
  registerSettingsEvents();
  registerModalEvents();
  restorePersistedPreferences();

  api.onAuthChange(handleAuthChange);
  log("bootstrap", "event listeners registered, waiting for auth state");
}

async function handleAuthChange(user) {
  if (user) {
    state.user = user;
    log("auth", "user signed in", user.uid);
    try {
      const profile = await api.ensureProfile(user);
      state.profile = profile;
      cache.set(`profile:${user.uid}`, profile, null);
      subscribeProfile(user.uid);
      showAuthedUI();
      renderUserBadge();
      navigateTo("home");
    } catch (err) {
      logError("error", "failed to load profile", err);
      showToast("Gagal memuat profil. Coba muat ulang halaman.", "error");
      // Tetap tampilkan Home walau profile gagal dimuat, agar app tidak stuck.
      state.profile = EMPTY_PROFILE;
      showAuthedUI();
      renderUserBadge();
      navigateTo("home");
    }
  } else {
    state.user = null;
    state.profile = null;
    log("auth", "user signed out");
    if (state.profileUnsub) state.profileUnsub();
    cleanupRoomState();
    stopMatchmakingListeners();
    resetLoginForms();
    hideAuthedUI();
    navigateTo("login");
  }
  hideLoadingScreen();
}

function subscribeProfile(uid) {
  if (state.profileUnsub) state.profileUnsub();
  state.profileUnsub = api.listenProfile(uid, (profile) => {
    state.profile = profile;
    cache.set(`profile:${uid}`, profile, null); // cache diperbarui otomatis lewat onSnapshot
    log("render", "profile snapshot received, re-rendering dependent pages");
    if (state.currentPage === "home") renderHomePage();
    if (state.currentPage === "settings") renderSettingsPage();
  });
}

function hideLoadingScreen() {
  $("screen-loading").classList.add("fade-out");
}

// =====================================================================
// NAVIGATION — dispatcher memastikan setiap page SELALU dirender.
// =====================================================================
const PAGE_RENDERERS = {
  home: renderHomePage,
  leaderboard: renderLeaderboardPage,
  settings: renderSettingsPage,
  solo: renderSoloPage,
  multiplayer: renderMultiplayerPage,
};

function registerNavigation() {
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.page));
  });
}

function navigateTo(pageName) {
  if (pageName !== "login" && !state.user) pageName = "login";
  log("navigation", "navigating to", pageName);

  $$(".page").forEach((page) => page.classList.remove("active"));
  const target = $(`page-${pageName}`);
  if (!target) {
    logError("error", "navigateTo: target page not found in DOM", pageName);
    return;
  }
  target.classList.add("active");

  $$(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageName);
  });

  state.currentPage = pageName;

  const renderer = PAGE_RENDERERS[pageName];
  if (renderer) {
    try {
      renderer();
      log("render", `page-${pageName} rendered successfully`);
    } catch (err) {
      logError("error", `render page-${pageName} failed`, err);
      showToast("Terjadi kesalahan saat menampilkan halaman.", "error");
    }
  }
}

function showAuthedUI() {
  $("nav-top").classList.remove("hidden");
  $("nav-bottom").classList.remove("hidden");
}

function hideAuthedUI() {
  $("nav-top").classList.add("hidden");
  $("nav-bottom").classList.add("hidden");
}

// =====================================================================
// CONNECTION (OFFLINE / RECONNECT) INDICATOR
// =====================================================================
function registerConnectionEvents() {
  window.addEventListener("online", handleConnectionOnline);
  window.addEventListener("offline", handleConnectionOffline);
  if (!navigator.onLine) handleConnectionOffline();
}

function handleConnectionOffline() {
  log("render", "connection lost — using cached data");
  const el = $("connection-indicator");
  el.classList.remove("hidden", "is-reconnecting");
  $("connection-indicator-icon").textContent = "🔌";
  $("connection-indicator-text").textContent = "Offline — menampilkan data tersimpan";
}

function handleConnectionOnline() {
  log("render", "connection restored");
  const el = $("connection-indicator");
  el.classList.remove("hidden");
  el.classList.add("is-reconnecting");
  $("connection-indicator-icon").textContent = "🔄";
  $("connection-indicator-text").textContent = "Menyambungkan kembali…";
  setTimeout(() => {
    el.classList.add("hidden");
    if (state.currentPage === "leaderboard") {
      cache.invalidate(LEADERBOARD_CACHE_KEY);
      renderLeaderboardPage();
    }
  }, 1600);
}

// =====================================================================
// LOGIN — Google + Email/Password (sign in, sign up, forgot password)
// =====================================================================
function showLoginView(viewName) {
  $$(".login-view").forEach((v) => v.classList.remove("active"));
  const target = $(`login-view-${viewName}`);
  if (target) target.classList.add("active");
}

function resetLoginForms() {
  showLoginView("signin");
  ["login-signin-form", "login-signup-form", "login-forgot-form"].forEach((id) => $(id).reset());
  ["login-signin-error", "login-signup-error", "login-forgot-error", "login-forgot-success"].forEach((id) =>
    $(id).classList.add("hidden")
  );
}

function registerLoginViewEvents() {
  $("btn-open-forgot").addEventListener("click", () => showLoginView("forgot"));
  $("btn-open-signup").addEventListener("click", () => showLoginView("signup"));
  $("btn-back-to-signin-1").addEventListener("click", () => showLoginView("signin"));
  $("btn-back-to-signin-2").addEventListener("click", () => showLoginView("signin"));

  $("login-signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("login-signin-email").value.trim();
    const password = $("login-signin-password").value;
    const errorEl = $("login-signin-error");
    errorEl.classList.add("hidden");

    if (!validateEmail(email)) return showLoginFieldError(errorEl, "Format email tidak valid.");
    if (!password) return showLoginFieldError(errorEl, "Masukkan password.");

    setButtonLoading("btn-login-signin", true);
    try {
      await api.signInWithEmail(email, password);
      showToast("Berhasil masuk!", "success");
    } catch (err) {
      logError("error", "signInWithEmail failed", err);
      showLoginFieldError(errorEl, api.getFriendlyErrorMessage(err));
    } finally {
      setButtonLoading("btn-login-signin", false);
    }
  });

  $("login-signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("login-signup-name").value.trim();
    const email = $("login-signup-email").value.trim();
    const password = $("login-signup-password").value;
    const errorEl = $("login-signup-error");
    errorEl.classList.add("hidden");

    if (!name) return showLoginFieldError(errorEl, "Masukkan nama tampilan.");
    if (!validateEmail(email)) return showLoginFieldError(errorEl, "Format email tidak valid.");
    if (password.length < 6) return showLoginFieldError(errorEl, "Password minimal 6 karakter.");

    setButtonLoading("btn-login-signup", true);
    try {
      await api.signUpWithEmail(email, password, name);
      showToast("Akun berhasil dibuat!", "success");
    } catch (err) {
      logError("error", "signUpWithEmail failed", err);
      showLoginFieldError(errorEl, api.getFriendlyErrorMessage(err));
    } finally {
      setButtonLoading("btn-login-signup", false);
    }
  });

  $("login-forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("login-forgot-email").value.trim();
    const errorEl = $("login-forgot-error");
    const successEl = $("login-forgot-success");
    errorEl.classList.add("hidden");
    successEl.classList.add("hidden");

    if (!validateEmail(email)) return showLoginFieldError(errorEl, "Format email tidak valid.");

    setButtonLoading("btn-login-forgot", true);
    try {
      await api.resetPassword(email);
      successEl.textContent = "Link reset password telah dikirim. Cek email kamu.";
      successEl.classList.remove("hidden");
    } catch (err) {
      logError("error", "resetPassword failed", err);
      showLoginFieldError(errorEl, api.getFriendlyErrorMessage(err));
    } finally {
      setButtonLoading("btn-login-forgot", false);
    }
  });
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showLoginFieldError(el, message) {
  el.textContent = message;
  el.classList.remove("hidden");
}

function setButtonLoading(btnId, loading) {
  const btn = $(btnId);
  btn.disabled = loading;
  btn.classList.toggle("is-loading", loading);
  const spinner = btn.querySelector(".btn-spinner");
  if (spinner) spinner.classList.toggle("hidden", !loading);
}

// =====================================================================
// AUTH EVENTS
// =====================================================================
function registerAuthEvents() {
  $("btn-google-login").addEventListener("click", async () => {
    try {
      await api.signInWithGoogle();
      showToast("Berhasil masuk!", "success");
    } catch (err) {
      logError("error", "google sign-in failed", err);
      showToast(api.getFriendlyErrorMessage(err), "error");
    }
  });

  $("btn-logout").addEventListener("click", () => {
    openModal(`
      <h3 style="margin-bottom:12px;font-family:var(--font-display)">Keluar dari akun?</h3>
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px;">Kamu bisa masuk lagi kapan saja.</p>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-ghost btn-block" id="modal-cancel-logout">Batal</button>
        <button class="btn btn-danger btn-block" id="modal-confirm-logout">Keluar</button>
      </div>
    `);
    $("modal-cancel-logout").addEventListener("click", closeModal);
    $("modal-confirm-logout").addEventListener("click", async () => {
      closeModal();
      try {
        await api.signOutUser();
        showToast("Kamu telah keluar.", "success");
      } catch (err) {
        logError("error", "logout failed", err);
        showToast("Gagal keluar.", "error");
      }
    });
  });
}

function renderUserBadge() {
  if (!state.user) return;
  setAvatarSrc($("user-avatar"), state.user.photoURL);
  $("user-name").textContent = state.user.displayName || "Player";
  $("home-username").textContent = (state.user.displayName || "Player").split(" ")[0];
}

// =====================================================================
// TOAST
// =====================================================================
function showToast(message, type = "info") {
  const container = $("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

// =====================================================================
// MODAL
// =====================================================================
function registerModalEvents() {
  $("modal-close-btn").addEventListener("click", closeModal);
  $("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
}
function openModal(html) {
  $("modal-content").innerHTML = html;
  $("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  $("modal-overlay").classList.add("hidden");
}

// =====================================================================
// HOME — selalu render, walau profile belum siap (pakai default).
// =====================================================================
function renderHomePage() {
  const p = state.profile || EMPTY_PROFILE;
  $("home-stat-highscore").textContent = p.highestScore || 0;
  $("home-stat-rating").textContent = p.rating || 0;
  const totalMatches = (p.wins || 0) + (p.losses || 0);
  const winRate = totalMatches ? Math.round(((p.wins || 0) / totalMatches) * 100) : 0;
  $("home-stat-winrate").textContent = winRate + "%";
}

// =====================================================================
// SETTINGS PERSISTENCE (localStorage)
// =====================================================================
function restorePersistedPreferences() {
  const savedDifficulty = api.storageGet("lastSoloDifficulty");
  if (savedDifficulty && DIFFICULTY_CONFIG[savedDifficulty]) {
    const card = document.querySelector(`#solo-difficulty-select .difficulty-card[data-difficulty="${savedDifficulty}"]`);
    if (card) {
      card.classList.add("selected");
      state.solo.difficulty = savedDifficulty;
      $("btn-solo-start").disabled = false;
    }
  }

  const savedRoomOptions = api.storageGet("lastRoomOptions");
  if (savedRoomOptions) {
    applyOptionRowValue("mp-rounds-options", savedRoomOptions.totalRounds);
    applyOptionRowValue("mp-duration-options", savedRoomOptions.roundSeconds);
    applyOptionRowValue("mp-difficulty-options", savedRoomOptions.difficulty);
  }
  const savedRoomName = api.storageGet("lastRoomName");
  if (savedRoomName) $("mp-room-name-input").value = savedRoomName;

  log("bootstrap", "restored persisted preferences from localStorage");
}

function applyOptionRowValue(containerId, value) {
  if (value === undefined || value === null) return;
  const container = $(containerId);
  const btn = container.querySelector(`.mp-option-btn[data-value="${value}"]`);
  if (!btn) return;
  container.querySelectorAll(".mp-option-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  container.dataset.value = String(value);
}

// =====================================================================
// SOLO MODE
// =====================================================================
function renderSoloPage() {
  // Pastikan tampilan solo selalu kembali ke setup jika belum ada game aktif.
  if (state.solo.tickInterval) return; // sedang bermain, biarkan apa adanya
  $("solo-game-area").classList.add("hidden");
  $("solo-result").classList.add("hidden");
  $("solo-setup").classList.remove("hidden");
}

function registerSoloEvents() {
  $$("#solo-difficulty-select .difficulty-card").forEach((card) => {
    card.addEventListener("click", () => {
      $$("#solo-difficulty-select .difficulty-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.solo.difficulty = card.dataset.difficulty;
      $("btn-solo-start").disabled = false;
      api.storageSet("lastSoloDifficulty", state.solo.difficulty);
    });
  });

  $("btn-solo-start").addEventListener("click", startSoloGame);

  $("solo-answer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    handleSoloAnswer($("solo-answer-input").value);
  });

  $("solo-skip-btn").addEventListener("click", () => handleSoloAnswer(null));

  $("solo-answer-input").addEventListener("input", () => {
    renderSuggestions("solo-answer-input", "solo-suggestions", (name) => {
      $("solo-answer-input").value = name;
      $("solo-suggestions").classList.add("hidden");
    });
  });

  $("btn-solo-again").addEventListener("click", () => {
    $("solo-result").classList.add("hidden");
    $("solo-setup").classList.remove("hidden");
    $$("#solo-difficulty-select .difficulty-card").forEach((c) => c.classList.remove("selected"));
    $("btn-solo-start").disabled = true;
    state.solo.difficulty = null;
  });

  $("btn-solo-exit").addEventListener("click", () => navigateTo("home"));
}

function startSoloGame() {
  const difficulty = state.solo.difficulty;
  if (!difficulty) return;
  log("game", "solo game started", difficulty);
  const config = DIFFICULTY_CONFIG[difficulty];

  Object.assign(state.solo, {
    config,
    used: [],
    round: 0,
    totalRounds: config.totalRounds,
    score: 0,
    combo: 0,
    bestStreak: 0,
    correctCount: 0,
    totalAnswered: 0,
  });

  $("solo-setup").classList.add("hidden");
  $("solo-result").classList.add("hidden");
  $("solo-game-area").classList.remove("hidden");

  nextSoloRound();
}

function nextSoloRound() {
  const s = state.solo;
  if (s.round >= s.totalRounds) {
    endSoloGame();
    return;
  }
  s.round += 1;
  s.currentCountry = api.pickRandomCountry(state.countries, s.used);
  s.used.push(s.currentCountry.name);
  s.allClues = api.buildClueSet(s.currentCountry);
  s.revealedClues = [s.allClues[0]];
  s.timeLeft = s.config.roundSeconds;
  s.revealTimer = 0;

  $("solo-answer-input").value = "";
  $("solo-suggestions").classList.add("hidden");
  $("solo-progress").textContent = `${s.round}/${s.totalRounds}`;
  $("solo-score").textContent = s.score;
  $("solo-combo").textContent = s.combo;
  renderSoloClue();
  renderSoloTimer();

  if (s.tickInterval) clearInterval(s.tickInterval);
  s.tickInterval = setInterval(soloTick, 1000);
}

function soloTick() {
  const s = state.solo;
  s.timeLeft -= 1;
  s.revealTimer += 1;

  if (s.revealTimer >= s.config.revealInterval && s.revealedClues.length < Math.min(s.config.maxClues, s.allClues.length)) {
    s.revealTimer = 0;
    s.revealedClues.push(s.allClues[s.revealedClues.length]);
    renderSoloClue();
  }

  renderSoloTimer();

  if (s.timeLeft <= 0) {
    clearInterval(s.tickInterval);
    s.tickInterval = null;
    handleSoloAnswer(null);
  }
}

function renderSoloClue() {
  $("solo-clue-text").innerHTML = state.solo.revealedClues.join("<br><br>");
}

function renderSoloTimer() {
  const s = state.solo;
  $("solo-timer").textContent = String(Math.max(s.timeLeft, 0)).padStart(2, "0");
  const pct = Math.max((s.timeLeft / s.config.roundSeconds) * 100, 0);
  const bar = $("solo-timer-bar");
  bar.style.width = pct + "%";
  bar.classList.toggle("warning", s.timeLeft <= s.config.roundSeconds * 0.3);
}

function handleSoloAnswer(rawInput) {
  const s = state.solo;
  if (s.tickInterval) {
    clearInterval(s.tickInterval);
    s.tickInterval = null;
  }

  s.totalAnswered += 1;
  const correct = rawInput ? api.isAnswerCorrect(rawInput, s.currentCountry) : false;

  if (correct) {
    s.correctCount += 1;
    s.combo += 1;
    s.bestStreak = Math.max(s.bestStreak, s.combo);
    const timeBonusFactor = Math.max(s.timeLeft / s.config.roundSeconds, 0.15);
    const cluesPenalty = 1 - (s.revealedClues.length - 1) * 0.08;
    const comboBonus = 1 + Math.min(s.combo, 10) * 0.05;
    const points = Math.round(s.config.basePoints * timeBonusFactor * Math.max(cluesPenalty, 0.4) * comboBonus);
    s.score += points;
    showToast(`Benar! +${points} poin`, "success");
  } else {
    s.combo = 0;
    showToast(`Jawaban: ${s.currentCountry.name}`, "error");
  }

  $("solo-score").textContent = s.score;
  $("solo-combo").textContent = s.combo;

  setTimeout(nextSoloRound, 1100);
}

async function endSoloGame() {
  const s = state.solo;
  log("game", "solo game finished", { score: s.score, correct: s.correctCount, total: s.totalAnswered });
  $("solo-game-area").classList.add("hidden");
  $("solo-result").classList.remove("hidden");

  const accuracy = s.totalAnswered ? Math.round((s.correctCount / s.totalAnswered) * 100) : 0;

  $("solo-result-score").textContent = s.score;
  $("solo-result-accuracy").textContent = accuracy + "%";
  $("solo-result-streak").textContent = s.bestStreak;
  $("solo-result-correct").textContent = `${s.correctCount}/${s.totalAnswered}`;

  if (!state.user) return;
  try {
    await api.upsertLeaderboardEntry({
      uid: state.user.uid,
      displayName: state.user.displayName || "Player",
      photoURL: state.user.photoURL || "",
      score: s.score,
      accuracy,
    });
    cache.invalidate(LEADERBOARD_CACHE_KEY); // skor berubah -> cache leaderboard lama tidak valid lagi
    await api.applyGameResultToProfile(state.user.uid, {
      score: s.score,
      accuracy,
      won: null,
      isMultiplayer: false,
    });
  } catch (err) {
    logError("error", "failed to save solo result", err);
    showToast(api.getFriendlyErrorMessage(err), "error");
  }
}

// =====================================================================
// AUTOCOMPLETE SUGGESTIONS (shared solo + multiplayer)
// =====================================================================
function renderSuggestions(inputId, listId, onPick) {
  const input = $(inputId);
  const list = $(listId);
  const matches = api.searchCountryNames(state.countries, input.value, 6);

  if (!matches.length) {
    list.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  list.innerHTML = matches
    .map((name) => `<div class="suggestion-item" data-name="${escapeHtml(name)}">${escapeHtml(name)}</div>`)
    .join("");
  list.classList.remove("hidden");

  list.querySelectorAll(".suggestion-item").forEach((item) => {
    item.addEventListener("click", () => onPick(item.dataset.name));
  });
}

// =====================================================================
// MULTIPLAYER — HUB (Matchmaking / Room)
// =====================================================================
function renderMultiplayerPage() {
  // Jika sedang berada dalam room/match aktif, tampilkan view sesuai status.
  if (state.room.code && state.room.data) {
    renderRoomByStatus(state.room.data);
    return;
  }
  if (state.matchmaking.searching) {
    showMpView("matchmaking-search");
    return;
  }
  showMpView("hub");
}

function showMpView(viewName) {
  $$(".mp-view").forEach((v) => v.classList.remove("active"));
  const target = $(`mp-view-${viewName}`);
  if (target) target.classList.add("active");
}

function registerMultiplayerEvents() {
  $("btn-mp-hub-matchmaking").addEventListener("click", startMatchmakingFlow);
  $("btn-mp-hub-room").addEventListener("click", () => showMpView("intro"));
  $("btn-mp-intro-back").addEventListener("click", () => showMpView("hub"));
  $("btn-mm-cancel").addEventListener("click", cancelMatchmakingSearch);

  $("btn-mp-create-room").addEventListener("click", () => showMpView("create-form"));
  $("btn-mp-create-cancel").addEventListener("click", () => showMpView("intro"));
  $("btn-mp-join-room-open").addEventListener("click", () => {
    $("mp-join-error").classList.add("hidden");
    $("mp-join-code-input").value = "";
    showMpView("join-form");
  });
  $("btn-mp-join-cancel").addEventListener("click", () => showMpView("intro"));

  registerOptionRow("mp-rounds-options");
  registerOptionRow("mp-duration-options");
  registerOptionRow("mp-difficulty-options");

  $("btn-mp-create-submit").addEventListener("click", createRoomFlow);
  $("btn-mp-join-submit").addEventListener("click", joinRoomFlow);
  $("btn-mp-copy-code").addEventListener("click", copyRoomCode);
  $("btn-mp-share-code").addEventListener("click", shareRoomCode);
  $("btn-mp-cancel-room").addEventListener("click", leaveRoomFlow);
  $("btn-mp-start-game").addEventListener("click", startRoomGameFlow);
  $("btn-mp-leave-lobby").addEventListener("click", leaveRoomFlow);
  $("btn-mp-leave-result").addEventListener("click", leaveRoomFlow);
  $("btn-mp-rematch").addEventListener("click", rematchRoomFlow);

  $("mp-answer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitRoomAnswerFlow();
  });
  $("mp-answer-input").addEventListener("input", () => {
    renderSuggestions("mp-answer-input", "mp-suggestions", (name) => {
      $("mp-answer-input").value = name;
      $("mp-suggestions").classList.add("hidden");
    });
  });
}

function registerOptionRow(containerId) {
  const container = $(containerId);
  container.querySelectorAll(".mp-option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".mp-option-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      container.dataset.value = btn.dataset.value;
      persistRoomOptions();
    });
  });
}

function persistRoomOptions() {
  api.storageSet("lastRoomOptions", {
    totalRounds: $("mp-rounds-options").dataset.value,
    roundSeconds: $("mp-duration-options").dataset.value,
    difficulty: $("mp-difficulty-options").dataset.value,
  });
}

// ---------------------------------------------------------------------
// PRIVATE ROOM: Create / Join
// ---------------------------------------------------------------------
async function createRoomFlow() {
  if (!state.user) return;
  const roomName = $("mp-room-name-input").value.trim() || "Room";
  api.storageSet("lastRoomName", roomName);
  const settings = {
    name: roomName,
    totalRounds: parseInt($("mp-rounds-options").dataset.value, 10),
    roundSeconds: parseInt($("mp-duration-options").dataset.value, 10),
    difficulty: $("mp-difficulty-options").dataset.value,
  };

  try {
    const code = await api.createRoom(state.user, settings);
    resetRoomState();
    state.room.role = "host";
    state.room.code = code;
    subscribeRoom(code);
    $("mp-room-code-display").textContent = code;
    showMpView("waiting");
  } catch (err) {
    logError("error", "createRoomFlow failed", err);
    showToast(api.getFriendlyErrorMessage(err), "error");
  }
}

async function joinRoomFlow() {
  if (!state.user) return;
  const code = $("mp-join-code-input").value.trim().toUpperCase();
  const errorEl = $("mp-join-error");
  errorEl.classList.add("hidden");

  if (!code) {
    errorEl.textContent = "Masukkan kode room.";
    errorEl.classList.remove("hidden");
    return;
  }

  try {
    await api.joinRoom(code, state.user);
    resetRoomState();
    state.room.role = "guest";
    state.room.code = code;
    subscribeRoom(code);
  } catch (err) {
    logError("room", "joinRoomFlow failed", err.message);
    let message = "Gagal bergabung ke room.";
    if (err.message === "NOT_FOUND") message = "Room tidak ditemukan.";
    else if (err.message === "ROOM_FULL") message = "Room sudah penuh.";
    else if (err.message === "OWN_ROOM") message = "Kamu tidak bisa join room milikmu sendiri.";
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }
}

// ---------------------------------------------------------------------
// MATCHMAKING: global queue, random pairing
// ---------------------------------------------------------------------
async function startMatchmakingFlow() {
  if (!state.user) return;
  log("room", "startMatchmakingFlow: joining queue");
  showMpView("matchmaking-search");
  state.matchmaking.searching = true;
  state.matchmaking.searchSeconds = 0;
  state.matchmaking.attemptingMatch = false;
  $("mm-search-timer").textContent = "00";
  $("mm-queue-count").textContent = "0";

  state.matchmaking.searchInterval = setInterval(() => {
    state.matchmaking.searchSeconds += 1;
    $("mm-search-timer").textContent = String(state.matchmaking.searchSeconds).padStart(2, "0");
  }, 1000);

  try {
    await api.joinQueue(state.user);
  } catch (err) {
    logError("error", "joinQueue failed", err);
    showToast(api.getFriendlyErrorMessage(err), "error");
    cancelMatchmakingSearch();
    return;
  }

  state.matchmaking.queueUnsub = api.listenWaitingQueue(handleQueueSnapshot);
  state.matchmaking.myQueueUnsub = api.listenMyQueueDoc(state.user.uid, handleMyQueueUpdate);
}

function handleQueueSnapshot(waitingDocs) {
  $("mm-queue-count").textContent = String(waitingDocs.length);
  if (!state.matchmaking.searching || state.matchmaking.attemptingMatch) return;

  const iAmWaiting = waitingDocs.some((d) => d.uid === state.user.uid);
  const others = waitingDocs.filter((d) => d.uid !== state.user.uid);
  if (!iAmWaiting || others.length === 0) return;

  // Pilih lawan SECARA ACAK dari antrean — bukan selalu yang paling awal.
  const candidate = others[Math.floor(Math.random() * others.length)];
  state.matchmaking.attemptingMatch = true;
  log("room", "attempting random pairing with", candidate.uid);

  api.tryPairRandomOpponent(state.user, candidate, buildMatchmakingRoundsForMatch).catch((err) => {
    // Kandidat sudah dipasangkan client lain, atau keluar antrean — retry di snapshot berikutnya.
    log("room", "pairing attempt failed, will retry", err.message);
    state.matchmaking.attemptingMatch = false;
  });
}

function buildMatchmakingRoundsForMatch() {
  const used = [];
  return api.buildMatchmakingRounds(() => {
    const country = api.pickRandomCountry(state.countries, used);
    used.push(country.name);
    return { countryName: country.name, clues: api.buildClueSet(country) };
  });
}

function handleMyQueueUpdate(data) {
  if (data.status === "matched" && data.matchId) {
    log("room", "matched!", data.matchId);
    stopMatchmakingListeners();
    api.leaveQueue(state.user.uid);
    resetRoomState();
    state.room.code = data.matchId;
    subscribeRoom(data.matchId);
  }
}

function stopMatchmakingListeners() {
  if (state.matchmaking.searchInterval) clearInterval(state.matchmaking.searchInterval);
  if (state.matchmaking.queueUnsub) state.matchmaking.queueUnsub();
  if (state.matchmaking.myQueueUnsub) state.matchmaking.myQueueUnsub();
  state.matchmaking.searchInterval = null;
  state.matchmaking.queueUnsub = null;
  state.matchmaking.myQueueUnsub = null;
  state.matchmaking.searching = false;
  state.matchmaking.attemptingMatch = false;
}

async function cancelMatchmakingSearch() {
  stopMatchmakingListeners();
  if (state.user) {
    try {
      await api.leaveQueue(state.user.uid);
    } catch (_) {
      /* abaikan */
    }
  }
  showMpView("hub");
}

// ---------------------------------------------------------------------
// SHARED ROOM/MATCH ENGINE (dipakai Private Room DAN Matchmaking)
// ---------------------------------------------------------------------
function subscribeRoom(code) {
  if (state.room.unsub) state.room.unsub();
  state.room.unsub = api.listenRoom(code, handleRoomSnapshot);
}

function handleRoomSnapshot(roomData) {
  if (!roomData) {
    if (state.room.code) {
      showToast("Room telah ditutup.", "error");
      const wasMatchmaking = state.room.data && state.room.data.type === "matchmaking";
      cleanupRoomState();
      if (state.currentPage === "multiplayer") showMpView(wasMatchmaking ? "hub" : "intro");
    }
    return;
  }
  state.room.data = roomData;
  if (state.currentPage === "multiplayer") {
    renderRoomByStatus(roomData);
  }
}

function getRoundSeconds(roomData) {
  if (roomData.type === "matchmaking") return roomData.rounds[roomData.round].roundSeconds;
  return roomData.settings.roundSeconds;
}

function getRoundDifficulty(roomData) {
  if (roomData.type === "matchmaking") return roomData.rounds[roomData.round].difficulty;
  return roomData.settings.difficulty;
}

function renderRoomByStatus(roomData) {
  const isHost = roomData.host.uid === state.user.uid;
  state.room.role = isHost ? "host" : "guest";

  if (roomData.status === "lobby") {
    if (!roomData.guest && isHost) {
      $("mp-room-code-display").textContent = roomData.code;
      showMpView("waiting");
      return;
    }
    renderLobby(roomData, isHost);
    showMpView("lobby");
    return;
  }

  if (roomData.status === "opponent_found") {
    if (state.room.lastStatus !== "opponent_found") {
      state.room.lastStatus = "opponent_found";
      renderMatchFound(roomData);
      showMpView("matchmaking-found");
      const matchId = roomData.id;
      setTimeout(() => {
        if (state.room.code === matchId && state.room.data && state.room.data.status === "opponent_found") {
          showMpView("matchmaking-countdown");
          startMatchCountdown(roomData, isHost);
        }
      }, 1400);
    }
    return;
  }

  if (roomData.status === "in_progress") {
    state.room.resultApplied = false;
    state.room.lastStatus = "in_progress";
    renderRoomScoreboard(roomData);
    showMpView("game");
    handleRoomRoundUpdate(roomData, isHost);
    return;
  }

  if (roomData.status === "finished") {
    renderRoomScoreboard(roomData);
    renderRoomResult(roomData, isHost);
    showMpView("result");
  }
}

function renderMatchFound(roomData) {
  setAvatarSrc($("mm-found-host-avatar"), roomData.host.photoURL);
  $("mm-found-host-name").textContent = roomData.host.displayName;
  setAvatarSrc($("mm-found-guest-avatar"), roomData.guest ? roomData.guest.photoURL : "");
  $("mm-found-guest-name").textContent = roomData.guest ? roomData.guest.displayName : "Player 2";
}

function startMatchCountdown(roomData, isHost) {
  if (state.room.localTickInterval) clearInterval(state.room.localTickInterval);

  const tick = () => {
    const elapsed = (Date.now() - roomData.countdownStartAt) / 1000;
    const remaining = Math.max(3 - Math.floor(elapsed), 0);
    $("mm-countdown-number").textContent = remaining > 0 ? String(remaining) : "GO!";

    if (elapsed >= 3) {
      clearInterval(state.room.localTickInterval);
      if (isHost) {
        api.beginMatchAfterCountdown(roomData.id).catch((err) => logError("error", "beginMatchAfterCountdown failed", err));
      }
    }
  };

  tick();
  state.room.localTickInterval = setInterval(tick, 200);
}

function renderLobby(roomData, isHost) {
  $("mp-lobby-room-name").textContent = roomData.name;
  setAvatarSrc($("mp-lobby-host-avatar"), roomData.host.photoURL);
  $("mp-lobby-host-name").textContent = roomData.host.displayName;

  if (roomData.guest) {
    setAvatarSrc($("mp-lobby-guest-avatar"), roomData.guest.photoURL);
    $("mp-lobby-guest-name").textContent = roomData.guest.displayName;
  } else {
    setAvatarSrc($("mp-lobby-guest-avatar"), "");
    $("mp-lobby-guest-name").textContent = "Menunggu…";
  }

  const s = roomData.settings;
  $("mp-lobby-settings-summary").textContent = `${s.totalRounds} Ronde · ${s.roundSeconds}s / ronde · ${capitalize(s.difficulty)}`;

  const startBtn = $("btn-mp-start-game");
  const waitingText = $("mp-lobby-waiting-text");
  if (isHost) {
    startBtn.classList.toggle("hidden", !roomData.guest);
    waitingText.classList.toggle("hidden", !!roomData.guest);
    if (!roomData.guest) waitingText.textContent = "Menunggu pemain kedua bergabung…";
  } else {
    startBtn.classList.add("hidden");
    waitingText.classList.remove("hidden");
    waitingText.textContent = "Menunggu host memulai permainan…";
  }
}

async function startRoomGameFlow() {
  const roomData = state.room.data;
  if (!roomData || state.room.role !== "host") return;
  log("game", "host starting room game", roomData.code);
  const rounds = buildRoomRounds(roomData.settings.totalRounds);
  try {
    await api.startRoomGame(roomData.code, rounds);
  } catch (err) {
    logError("error", "startRoomGameFlow failed", err);
    showToast(api.getFriendlyErrorMessage(err), "error");
  }
}

function buildRoomRounds(totalRounds) {
  const rounds = [];
  const used = [];
  for (let i = 0; i < totalRounds; i++) {
    const country = api.pickRandomCountry(state.countries, used);
    used.push(country.name);
    rounds.push({ countryName: country.name, clues: api.buildClueSet(country) });
  }
  return rounds;
}

function renderRoomScoreboard(roomData) {
  setAvatarSrc($("mp-host-avatar"), roomData.host.photoURL);
  $("mp-host-name").textContent = roomData.host.displayName;
  $("mp-host-score").textContent = roomData.host.score || 0;
  setAvatarSrc($("mp-guest-avatar"), roomData.guest ? roomData.guest.photoURL : "");
  $("mp-guest-name").textContent = roomData.guest ? roomData.guest.displayName : "Guest";
  $("mp-guest-score").textContent = roomData.guest ? roomData.guest.score || 0 : 0;
}

function handleRoomRoundUpdate(roomData, isHost) {
  if (roomData.round !== state.room.lastRenderedRound) {
    state.room.lastRenderedRound = roomData.round;
    state.room.answered = false;

    $("mp-answer-input").value = "";
    $("mp-answer-input").disabled = false;
    $("mp-suggestions").classList.add("hidden");
    $("mp-round-status").textContent = "";
    $("mp-round").textContent = `${roomData.round + 1}/${roomData.rounds.length}`;

    const roundInfo = roomData.rounds[roomData.round];
    const difficulty = getRoundDifficulty(roomData);
    const clueCount = ROOM_DIFFICULTY_CLUE_COUNT[difficulty] || 4;
    $("mp-clue-text").innerHTML = roundInfo.clues.slice(0, clueCount).join("<br><br>");

    startRoomLocalTimer(roomData);
  }

  updateRoomRoundStatus(roomData);
}

function startRoomLocalTimer(roomData) {
  if (state.room.localTickInterval) clearInterval(state.room.localTickInterval);
  const roundSeconds = getRoundSeconds(roomData);

  const tick = () => {
    const elapsed = (Date.now() - roomData.roundStartAt) / 1000;
    const remaining = Math.max(roundSeconds - elapsed, 0);
    $("mp-timer").textContent = String(Math.ceil(remaining)).padStart(2, "0");
    const pct = Math.max((remaining / roundSeconds) * 100, 0);
    const bar = $("mp-timer-bar");
    bar.style.width = pct + "%";
    bar.classList.toggle("warning", remaining <= roundSeconds * 0.3);

    if (remaining <= 0) {
      clearInterval(state.room.localTickInterval);
      if (!state.room.answered) {
        $("mp-answer-input").disabled = true;
        state.room.answered = true;
      }
      const isHost = roomData.host.uid === state.user.uid;
      if (isHost) maybeAdvanceRoomRound(roomData);
    }
  };

  tick();
  state.room.localTickInterval = setInterval(tick, 250);
}

function updateRoomRoundStatus(roomData) {
  const answers = roomData.answers || {};
  const isHost = roomData.host.uid === state.user.uid;
  const oppUid = isHost ? roomData.guest && roomData.guest.uid : roomData.host.uid;

  if (oppUid && answers[oppUid] && !state.room.answered) {
    $("mp-round-status").textContent = "Lawan sudah menjawab — cepat!";
  }
  if (state.room.answered) {
    $("mp-round-status").textContent = "Jawaban terkirim. Menunggu ronde berakhir…";
  }

  const bothAnswered = roomData.guest && answers[roomData.host.uid] && answers[roomData.guest.uid];
  if (bothAnswered && isHost) {
    maybeAdvanceRoomRound(roomData);
  }
}

async function submitRoomAnswerFlow() {
  const roomData = state.room.data;
  if (state.room.answered || !roomData) return;
  const value = $("mp-answer-input").value;
  if (!value.trim()) return;

  state.room.answered = true;
  $("mp-answer-input").disabled = true;

  const roundInfo = roomData.rounds[roomData.round];
  const correct = api.normalizeAnswer(value) === api.normalizeAnswer(roundInfo.countryName);
  const timeMs = Date.now() - roomData.roundStartAt;

  try {
    await api.submitRoomAnswer(roomData.code || roomData.id, state.user.uid, { correct, timeMs, value });
    showToast(correct ? "Jawaban terkirim — benar!" : "Jawaban terkirim.", correct ? "success" : "info");
  } catch (err) {
    logError("error", "submitRoomAnswerFlow failed", err);
  }
}

async function maybeAdvanceRoomRound(roomData) {
  if (state.room.advancing) return;
  state.room.advancing = true;

  try {
    const answers = roomData.answers || {};
    const host = roomData.host;
    const guest = roomData.guest;
    const aHost = answers[host.uid];
    const aGuest = guest ? answers[guest.uid] : null;
    const difficulty = getRoundDifficulty(roomData);
    const basePoints = ROOM_BASE_POINTS[difficulty] || 150;
    const roundMs = getRoundSeconds(roomData) * 1000;

    let hostGain = 0;
    let guestGain = 0;

    if (aHost && aHost.correct) hostGain += Math.round(basePoints * Math.max(1 - aHost.timeMs / roundMs, 0.2));
    if (aGuest && aGuest.correct) guestGain += Math.round(basePoints * Math.max(1 - aGuest.timeMs / roundMs, 0.2));

    if (aHost && aHost.correct && (!aGuest || !aGuest.correct || aHost.timeMs < aGuest.timeMs)) hostGain += 40;
    if (aGuest && aGuest.correct && (!aHost || !aHost.correct || aGuest.timeMs < aHost.timeMs)) guestGain += 40;

    const nextRound = roomData.round + 1;
    const isLastRound = nextRound >= roomData.rounds.length;

    const patch = {
      "host.score": (host.score || 0) + hostGain,
      "guest.score": (guest ? guest.score || 0 : 0) + guestGain,
      answers: {},
      round: isLastRound ? roomData.round : nextRound,
      roundStartAt: Date.now(),
      status: isLastRound ? "finished" : "in_progress",
    };

    await api.advanceRoomRound(roomData.code || roomData.id, patch);
    log("game", "round advanced", roomData.code || roomData.id, patch);
  } catch (err) {
    logError("error", "maybeAdvanceRoomRound failed", err);
  } finally {
    state.room.advancing = false;
  }
}

async function renderRoomResult(roomData, isHost) {
  const hostScore = roomData.host.score || 0;
  const guestScore = roomData.guest ? roomData.guest.score || 0 : 0;
  const isMatchmaking = roomData.type === "matchmaking";

  $("mp-result-host-score").textContent = hostScore;
  $("mp-result-guest-score").textContent = guestScore;

  let title = "Seri!";
  let emoji = "🤝";
  if (hostScore > guestScore) {
    title = "Host Menang!";
    emoji = "🏆";
  } else if (guestScore > hostScore) {
    title = "Guest Menang!";
    emoji = "🏆";
  }
  $("mp-result-title").textContent = title;
  $("mp-result-emoji").textContent = emoji;
  $("btn-mp-rematch").classList.toggle("hidden", !isHost || isMatchmaking);
  $("btn-mp-leave-result").textContent = isMatchmaking ? "Kembali ke Multiplayer" : "Leave Room";

  if (state.room.lastStatus !== "finished") {
    state.room.lastStatus = "finished";
    if (!state.room.resultApplied) {
      state.room.resultApplied = true;
      const myScore = isHost ? hostScore : guestScore;
      const oppScore = isHost ? guestScore : hostScore;
      const won = myScore > oppScore ? true : myScore < oppScore ? false : null;
      try {
        await api.applyGameResultToProfile(state.user.uid, {
          score: myScore,
          accuracy: 0,
          won,
          isMultiplayer: true,
        });
      } catch (err) {
        logError("error", "failed to apply multiplayer result to profile", err);
      }
    }
  }
}

async function rematchRoomFlow() {
  const roomData = state.room.data;
  if (!roomData || state.room.role !== "host" || roomData.type === "matchmaking") return;
  const rounds = buildRoomRounds(roomData.settings.totalRounds);
  try {
    await api.startRoomGame(roomData.code, rounds);
    showToast("Rematch dimulai!", "success");
  } catch (err) {
    logError("error", "rematchRoomFlow failed", err);
    showToast(api.getFriendlyErrorMessage(err), "error");
  }
}

async function copyRoomCode() {
  if (!state.room.code) return;
  try {
    await navigator.clipboard.writeText(state.room.code);
    showToast("Kode room disalin!", "success");
  } catch (err) {
    logError("error", "clipboard copy failed", err);
    showToast("Gagal menyalin kode. Salin manual: " + state.room.code, "error");
  }
}

async function shareRoomCode() {
  if (!state.room.code) return;
  const shareText = `Yuk main Guess Country bareng! Masukkan kode room ini: ${state.room.code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Guess Country", text: shareText });
    } catch (_) {
      /* dibatalkan pengguna, abaikan */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(shareText);
    showToast("Teks ajakan disalin, kirim ke temanmu!", "success");
  } catch (err) {
    logError("error", "shareRoomCode fallback failed", err);
    showToast("Gagal membagikan kode.", "error");
  }
}

async function leaveRoomFlow() {
  const roomData = state.room.data;
  const code = state.room.code;
  const isMatchmaking = roomData && roomData.type === "matchmaking";

  if (!code) {
    showMpView("hub");
    return;
  }

  try {
    if (isMatchmaking) {
      await api.leaveMatch(code);
    } else {
      await api.leaveRoom(code, state.room.role);
    }
  } catch (err) {
    logError("error", "leaveRoomFlow failed", err);
  }
  cleanupRoomState();
  showMpView(isMatchmaking ? "hub" : "intro");
}

function resetRoomState() {
  if (state.room.unsub) state.room.unsub();
  if (state.room.localTickInterval) clearInterval(state.room.localTickInterval);
  state.room = {
    role: null,
    code: null,
    data: null,
    unsub: null,
    lastRenderedRound: -1,
    lastStatus: null,
    answered: false,
    advancing: false,
    resultApplied: false,
    localTickInterval: null,
  };
}

function cleanupRoomState() {
  resetRoomState();
}

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// =====================================================================
// LEADERBOARD — cache TTL 60 detik + Stale-While-Revalidate + skeleton.
// =====================================================================
function leaderboardSkeletonHtml(rows = 6) {
  return Array.from({ length: rows })
    .map(
      () => `
        <div class="skeleton-row">
          <div class="skeleton-block skeleton-avatar"></div>
          <div class="skeleton-lines">
            <div class="skeleton-block skeleton-line w-60"></div>
            <div class="skeleton-block skeleton-line w-35"></div>
          </div>
          <div class="skeleton-block skeleton-score"></div>
        </div>`
    )
    .join("");
}

function leaderboardEntriesHtml(entries) {
  return entries
    .map((entry, index) => {
      const isMe = state.user && entry.uid === state.user.uid;
      return `
        <div class="leaderboard-row ${isMe ? "is-me" : ""}">
          <span class="leaderboard-rank">${index + 1}</span>
          <img class="leaderboard-avatar" referrerpolicy="no-referrer" src="${entry.photoURL || ""}" alt="" />
          <div class="leaderboard-info">
            <div class="leaderboard-name">${escapeHtml(entry.displayName || "Player")}</div>
            <div class="leaderboard-sub">Akurasi ${entry.accuracy || 0}% · ${entry.gamesPlayed || 0} game</div>
          </div>
          <span class="leaderboard-score">${entry.highestScore || 0}</span>
        </div>
      `;
    })
    .join("");
}

async function renderLeaderboardPage() {
  const container = $("leaderboard-list");
  if (!cache.getEntry(LEADERBOARD_CACHE_KEY)) {
    container.innerHTML = leaderboardSkeletonHtml();
  }
  log("leaderboard", "rendering leaderboard page");

  const renderEntries = (entries, meta) => {
    if (state.currentPage !== "leaderboard") return;
    if (!entries.length) {
      container.innerHTML = `<p class="leaderboard-state">Belum ada data. Jadilah yang pertama bermain Solo Mode!</p>`;
      log("leaderboard", "empty state");
      return;
    }
    container.innerHTML = leaderboardEntriesHtml(entries);
    log("leaderboard", meta.stale ? "rendered from cache" : "rendered fresh from Firestore", entries.length, "entries");
  };

  try {
    // TIDAK fetch ke Firestore jika cache (TTL 60 detik) masih valid.
    await staleWhileRevalidate(LEADERBOARD_CACHE_KEY, LEADERBOARD_TTL_MS, () => api.fetchTopLeaderboard(100), renderEntries, true);
  } catch (err) {
    logError("error", "renderLeaderboardPage failed", err);
    if (state.currentPage !== "leaderboard") return;
    const cached = cache.get(LEADERBOARD_CACHE_KEY);
    if (cached && cached.length) {
      renderEntries(cached, { stale: true });
      showToast("Gagal memuat data terbaru, menampilkan cache.", "error");
    } else {
      container.innerHTML = `<p class="leaderboard-state is-error">${escapeHtml(api.getFriendlyErrorMessage(err))}</p>`;
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// =====================================================================
// SETTINGS — selalu render, walau profile belum siap (pakai default).
// =====================================================================
function registerSettingsEvents() {
  $("btn-save-name").addEventListener("click", async () => {
    const newName = $("settings-name-input").value.trim();
    if (!newName || !state.user) return;
    try {
      await api.updateProfileName(state.user.uid, newName);
      showToast("Nama berhasil diperbarui.", "success");
    } catch (err) {
      logError("error", "updateProfileName failed", err);
      showToast(api.getFriendlyErrorMessage(err), "error");
    }
  });
}

function renderSettingsPage() {
  const p = state.profile || EMPTY_PROFILE;
  setAvatarSrc($("settings-avatar"), state.user && state.user.photoURL);
  $("settings-name-input").value = p.displayName || "";
  $("settings-email").textContent = (state.user && state.user.email) || "";

  $("stat-games-played").textContent = p.gamesPlayed || 0;
  $("stat-wins").textContent = p.wins || 0;
  $("stat-losses").textContent = p.losses || 0;
  $("stat-highest-score").textContent = p.highestScore || 0;
  $("stat-best-accuracy").textContent = (p.bestAccuracy || 0) + "%";
  $("stat-rating").textContent = p.rating || 0;
}

// =====================================================================
// START
// =====================================================================
bootstrap();