// =====================================================================
// app.js
// Seluruh logic aplikasi Guess Country.
// Navigasi, auth, solo, multiplayer (private room), leaderboard, settings.
// =====================================================================

import * as api from "./services/api.js";
import { log, logError } from "./services/api.js";

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
    createOptions: { totalRounds: 10, roundSeconds: 30, difficulty: "medium" },
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

// =====================================================================
// DOM SHORTCUTS
// =====================================================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// =====================================================================
// BOOTSTRAP
// =====================================================================
async function bootstrap() {
  log("bootstrap", "starting app");

  try {
    state.countries = await api.loadCountries();
    log("bootstrap", "countries loaded", state.countries.length);
  } catch (err) {
    logError("error", "failed to load countries", err);
    showToast("Gagal memuat database negara. Cek koneksi kamu.", "error");
  }

  registerNavigation();
  registerAuthEvents();
  registerSoloEvents();
  registerMultiplayerEvents();
  registerSettingsEvents();
  registerModalEvents();

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
    hideAuthedUI();
    navigateTo("login");
  }
  hideLoadingScreen();
}

function subscribeProfile(uid) {
  if (state.profileUnsub) state.profileUnsub();
  state.profileUnsub = api.listenProfile(uid, (profile) => {
    state.profile = profile;
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
// AUTH EVENTS
// =====================================================================
function registerAuthEvents() {
  $("btn-google-login").addEventListener("click", async () => {
    try {
      await api.signInWithGoogle();
      showToast("Berhasil masuk!", "success");
    } catch (err) {
      logError("error", "google sign-in failed", err);
      showToast("Gagal masuk dengan Google.", "error");
    }
  });

  $("btn-logout").addEventListener("click", () => {
    openModal(`
      <h3 style="margin-bottom:12px;font-family:var(--font-display)">Keluar dari akun?</h3>
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px;">Kamu bisa masuk lagi kapan saja dengan akun Google yang sama.</p>
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
  $("user-avatar").src = state.user.photoURL || "";
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
    await api.applyGameResultToProfile(state.user.uid, {
      score: s.score,
      accuracy,
      won: null,
      isMultiplayer: false,
    });
  } catch (err) {
    logError("error", "failed to save solo result", err);
    showToast("Gagal menyimpan hasil ke server.", "error");
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
// MULTIPLAYER — PRIVATE ROOM (tanpa queue / matchmaking global)
// =====================================================================
function renderMultiplayerPage() {
  // Jika sedang berada dalam room aktif, tampilkan view sesuai status room.
  if (state.room.code && state.room.data) {
    renderRoomByStatus(state.room.data);
    return;
  }
  showMpView("intro");
}

function showMpView(viewName) {
  $$(".mp-view").forEach((v) => v.classList.remove("active"));
  const target = $(`mp-view-${viewName}`);
  if (target) target.classList.add("active");
}

function registerMultiplayerEvents() {
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
    });
  });
}

async function createRoomFlow() {
  if (!state.user) return;
  const settings = {
    name: $("mp-room-name-input").value.trim() || "Room",
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
    showToast("Gagal membuat room. Coba lagi.", "error");
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

function subscribeRoom(code) {
  if (state.room.unsub) state.room.unsub();
  state.room.unsub = api.listenRoom(code, handleRoomSnapshot);
}

function handleRoomSnapshot(roomData) {
  if (!roomData) {
    if (state.room.code) {
      showToast("Room telah ditutup.", "error");
      cleanupRoomState();
      if (state.currentPage === "multiplayer") showMpView("intro");
    }
    return;
  }
  state.room.data = roomData;
  if (state.currentPage === "multiplayer") {
    renderRoomByStatus(roomData);
  }
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

function renderLobby(roomData, isHost) {
  $("mp-lobby-room-name").textContent = roomData.name;
  $("mp-lobby-host-avatar").src = roomData.host.photoURL || "";
  $("mp-lobby-host-name").textContent = roomData.host.displayName;

  if (roomData.guest) {
    $("mp-lobby-guest-avatar").src = roomData.guest.photoURL || "";
    $("mp-lobby-guest-name").textContent = roomData.guest.displayName;
  } else {
    $("mp-lobby-guest-avatar").src = "";
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
    showToast("Gagal memulai permainan.", "error");
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
  $("mp-host-avatar").src = roomData.host.photoURL || "";
  $("mp-host-name").textContent = roomData.host.displayName;
  $("mp-host-score").textContent = roomData.host.score || 0;
  $("mp-guest-avatar").src = roomData.guest ? roomData.guest.photoURL || "" : "";
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
    const clueCount = ROOM_DIFFICULTY_CLUE_COUNT[roomData.settings.difficulty] || 4;
    $("mp-clue-text").innerHTML = roundInfo.clues.slice(0, clueCount).join("<br><br>");

    startRoomLocalTimer(roomData);
  }

  updateRoomRoundStatus(roomData);
}

function startRoomLocalTimer(roomData) {
  if (state.room.localTickInterval) clearInterval(state.room.localTickInterval);

  const tick = () => {
    const elapsed = (Date.now() - roomData.roundStartAt) / 1000;
    const remaining = Math.max(roomData.settings.roundSeconds - elapsed, 0);
    $("mp-timer").textContent = String(Math.ceil(remaining)).padStart(2, "0");
    const pct = Math.max((remaining / roomData.settings.roundSeconds) * 100, 0);
    const bar = $("mp-timer-bar");
    bar.style.width = pct + "%";
    bar.classList.toggle("warning", remaining <= roomData.settings.roundSeconds * 0.3);

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
  const oppUid = isHost ? (roomData.guest && roomData.guest.uid) : roomData.host.uid;

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
    await api.submitRoomAnswer(roomData.code, state.user.uid, { correct, timeMs, value });
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
    const basePoints = ROOM_BASE_POINTS[roomData.settings.difficulty] || 150;
    const roundMs = roomData.settings.roundSeconds * 1000;

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

    await api.advanceRoomRound(roomData.code, patch);
    log("game", "round advanced", roomData.code, patch);
  } catch (err) {
    logError("error", "maybeAdvanceRoomRound failed", err);
  } finally {
    state.room.advancing = false;
  }
}

async function renderRoomResult(roomData, isHost) {
  const hostScore = roomData.host.score || 0;
  const guestScore = roomData.guest ? roomData.guest.score || 0 : 0;

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
  $("btn-mp-rematch").classList.toggle("hidden", !isHost);

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
  if (!roomData || state.room.role !== "host") return;
  const rounds = buildRoomRounds(roomData.settings.totalRounds);
  try {
    await api.startRoomGame(roomData.code, rounds);
    showToast("Rematch dimulai!", "success");
  } catch (err) {
    logError("error", "rematchRoomFlow failed", err);
    showToast("Gagal memulai rematch.", "error");
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

async function leaveRoomFlow() {
  const code = state.room.code;
  const role = state.room.role;
  if (!code) {
    showMpView("intro");
    return;
  }
  try {
    await api.leaveRoom(code, role);
  } catch (err) {
    logError("error", "leaveRoomFlow failed", err);
  }
  cleanupRoomState();
  showMpView("intro");
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
    createOptions: { totalRounds: 10, roundSeconds: 30, difficulty: "medium" },
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
// LEADERBOARD — loading / empty / error state selalu ditangani eksplisit.
// =====================================================================
async function renderLeaderboardPage() {
  const container = $("leaderboard-list");
  container.innerHTML = `<p class="leaderboard-state">Memuat leaderboard…</p>`;
  log("leaderboard", "rendering leaderboard page");

  try {
    const entries = await api.fetchTopLeaderboard(100);

    if (state.currentPage !== "leaderboard") return; // pengguna sudah pindah halaman

    if (!entries.length) {
      container.innerHTML = `<p class="leaderboard-state">Belum ada data. Jadilah yang pertama bermain Solo Mode!</p>`;
      log("leaderboard", "empty state");
      return;
    }

    container.innerHTML = entries
      .map((entry, index) => {
        const isMe = state.user && entry.uid === state.user.uid;
        return `
          <div class="leaderboard-row ${isMe ? "is-me" : ""}">
            <span class="leaderboard-rank">${index + 1}</span>
            <img class="leaderboard-avatar" src="${entry.photoURL || ""}" alt="" />
            <div class="leaderboard-info">
              <div class="leaderboard-name">${escapeHtml(entry.displayName || "Player")}</div>
              <div class="leaderboard-sub">Akurasi ${entry.accuracy || 0}% · ${entry.gamesPlayed || 0} game</div>
            </div>
            <span class="leaderboard-score">${entry.highestScore || 0}</span>
          </div>
        `;
      })
      .join("");
    log("leaderboard", "rendered", entries.length, "entries");
  } catch (err) {
    logError("error", "renderLeaderboardPage failed", err);
    if (state.currentPage !== "leaderboard") return;
    container.innerHTML = `<p class="leaderboard-state is-error">Gagal memuat leaderboard. Periksa koneksi atau Firestore rules/index kamu.</p>`;
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
      showToast("Gagal memperbarui nama.", "error");
    }
  });
}

function renderSettingsPage() {
  const p = state.profile || EMPTY_PROFILE;
  $("settings-avatar").src = (state.user && state.user.photoURL) || "";
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
