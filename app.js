// =====================================================================
// app.js
// Seluruh logic aplikasi Guess Country.
// Mengatur navigasi, auth, solo, multiplayer, leaderboard, settings.
// =====================================================================

import * as api from "./api/api.js";

// =====================================================================
// GLOBAL STATE
// =====================================================================
const state = {
  user: null,
  profile: null,
  countries: [],
  currentPage: "login",
  profileUnsub: null,

  solo: {
    difficulty: null,
    config: null,
    countries: [],
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

  multiplayer: {
    searching: false,
    searchSeconds: 0,
    searchInterval: null,
    queueUnsub: null,
    myQueueUnsub: null,
    gameUnsub: null,
    gameId: null,
    gameData: null,
    isPlayer1: false,
    lastRenderedRound: -1,
    answered: false,
    localTickInterval: null,
    advancing: false,
    attemptingMatch: false,
  },
};

const MP_TOTAL_ROUNDS = 8;
const MP_ROUND_SECONDS = 25;

const DIFFICULTY_CONFIG = {
  easy: { label: "Easy", roundSeconds: 40, revealInterval: 7, maxClues: 7, totalRounds: 10, basePoints: 100 },
  medium: { label: "Medium", roundSeconds: 28, revealInterval: 6, maxClues: 5, totalRounds: 10, basePoints: 150 },
  hard: { label: "Hard", roundSeconds: 18, revealInterval: 5, maxClues: 3, totalRounds: 10, basePoints: 200 },
  extreme: { label: "Extreme", roundSeconds: 10, revealInterval: 20, maxClues: 1, totalRounds: 10, basePoints: 320 },
};

// =====================================================================
// DOM SHORTCUTS
// =====================================================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// =====================================================================
// BOOTSTRAP
// =====================================================================
async function bootstrap() {
  try {
    state.countries = await api.loadCountries();
  } catch (err) {
    showToast("Gagal memuat database negara. Cek koneksi kamu.", "error");
    console.error(err);
  }

  registerNavigation();
  registerAuthEvents();
  registerSoloEvents();
  registerMultiplayerEvents();
  registerSettingsEvents();
  registerModalEvents();

  api.onAuthChange(handleAuthChange);
}

async function handleAuthChange(user) {
  if (user) {
    state.user = user;
    try {
      const profile = await api.ensureProfile(user);
      state.profile = profile;
      subscribeProfile(user.uid);
      showAuthedUI();
      renderUserBadge();
      navigateTo("home");
    } catch (err) {
      console.error(err);
      showToast("Gagal memuat profil.", "error");
    }
  } else {
    state.user = null;
    state.profile = null;
    if (state.profileUnsub) state.profileUnsub();
    hideAuthedUI();
    navigateTo("login");
  }
  hideLoadingScreen();
}

function subscribeProfile(uid) {
  if (state.profileUnsub) state.profileUnsub();
  state.profileUnsub = api.listenProfile(uid, (profile) => {
    state.profile = profile;
    renderHomeStats();
    renderSettingsPage();
  });
}

function hideLoadingScreen() {
  $("screen-loading").classList.add("fade-out");
}

// =====================================================================
// NAVIGATION
// =====================================================================
function registerNavigation() {
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.page));
  });
}

function navigateTo(pageName) {
  if (pageName !== "login" && !state.user) pageName = "login";

  $$(".page").forEach((page) => page.classList.remove("active"));
  const target = $(`page-${pageName}`);
  if (target) target.classList.add("active");

  $$(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageName);
  });

  state.currentPage = pageName;

  if (pageName === "leaderboard") renderLeaderboard();
  if (pageName === "settings") renderSettingsPage();
  if (pageName === "home") renderHomeStats();

  // Leaving multiplayer mid-match cleans up listeners to avoid leaks.
  if (pageName !== "multiplayer") {
    cleanupSearching(false);
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
      console.error(err);
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
      await api.signOutUser();
      showToast("Kamu telah keluar.", "success");
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
// HOME
// =====================================================================
function renderHomeStats() {
  if (!state.profile) return;
  const p = state.profile;
  $("home-stat-highscore").textContent = p.highestScore || 0;
  $("home-stat-rating").textContent = p.rating || 0;
  const totalMatches = (p.wins || 0) + (p.losses || 0);
  const winRate = totalMatches ? Math.round(((p.wins || 0) / totalMatches) * 100) : 0;
  $("home-stat-winrate").textContent = winRate + "%";
}

// =====================================================================
// SOLO MODE
// =====================================================================
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
    const value = $("solo-answer-input").value;
    handleSoloAnswer(value);
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
  if (s.tickInterval) clearInterval(s.tickInterval);

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
    console.error(err);
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
    .map((name) => `<div class="suggestion-item" data-name="${name}">${name}</div>`)
    .join("");
  list.classList.remove("hidden");

  list.querySelectorAll(".suggestion-item").forEach((item) => {
    item.addEventListener("click", () => onPick(item.dataset.name));
  });
}

// =====================================================================
// MULTIPLAYER MODE
// =====================================================================
function registerMultiplayerEvents() {
  $("btn-find-match").addEventListener("click", startSearching);
  $("btn-cancel-search").addEventListener("click", () => cleanupSearching(true));

  $("mp-answer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitMultiplayerAnswer();
  });

  $("mp-answer-input").addEventListener("input", () => {
    renderSuggestions("mp-answer-input", "mp-suggestions", (name) => {
      $("mp-answer-input").value = name;
      $("mp-suggestions").classList.add("hidden");
    });
  });

  $("btn-mp-rematch").addEventListener("click", () => {
    $("multiplayer-result").classList.add("hidden");
    $("multiplayer-intro").classList.remove("hidden");
  });

  $("btn-mp-exit").addEventListener("click", () => {
    $("multiplayer-result").classList.add("hidden");
    $("multiplayer-intro").classList.remove("hidden");
    navigateTo("home");
  });
}

async function startSearching() {
  if (!state.user) return;
  const mp = state.multiplayer;
  mp.searching = true;
  mp.searchSeconds = 0;
  mp.attemptingMatch = false;

  $("multiplayer-intro").classList.add("hidden");
  $("multiplayer-searching").classList.remove("hidden");
  $("search-timer").textContent = "00";
  $("queue-count").textContent = "0";

  mp.searchInterval = setInterval(() => {
    mp.searchSeconds += 1;
    $("search-timer").textContent = String(mp.searchSeconds).padStart(2, "0");
  }, 1000);

  try {
    await api.joinQueue(state.user);
  } catch (err) {
    console.error(err);
    showToast("Gagal bergabung ke antrean.", "error");
    cleanupSearching(true);
    return;
  }

  mp.queueUnsub = api.listenWaitingQueue(handleQueueSnapshot);
  mp.myQueueUnsub = api.listenMyQueueDoc(state.user.uid, handleMyQueueUpdate);
}

async function handleQueueSnapshot(waitingDocs) {
  const mp = state.multiplayer;
  $("queue-count").textContent = String(api.countWaitingPlayers(waitingDocs));

  if (!mp.searching || mp.attemptingMatch) return;
  if (waitingDocs.length < 2) return;
  if (waitingDocs[0].uid !== state.user.uid) return;

  mp.attemptingMatch = true;
  const [playerA, playerB] = waitingDocs;

  try {
    await api.tryPairPlayers(playerA, playerB, (gameId) => buildMultiplayerGamePayload(playerA, playerB));
  } catch (err) {
    // Another client may have matched first, or a player left — safe to retry on next snapshot.
    mp.attemptingMatch = false;
  }
}

function buildMultiplayerGamePayload(playerA, playerB) {
  const rounds = [];
  const used = [];
  for (let i = 0; i < MP_TOTAL_ROUNDS; i++) {
    const country = api.pickRandomCountry(state.countries, used);
    used.push(country.name);
    rounds.push({
      countryName: country.name,
      clues: api.buildClueSet(country),
    });
  }

  return {
    player1: { uid: playerA.uid, displayName: playerA.displayName, photoURL: playerA.photoURL, score: 0 },
    player2: { uid: playerB.uid, displayName: playerB.displayName, photoURL: playerB.photoURL, score: 0 },
    difficulty: "Medium",
    totalRounds: MP_TOTAL_ROUNDS,
    roundSeconds: MP_ROUND_SECONDS,
    round: 0,
    rounds,
    status: "in_progress",
    answers: {},
    roundStartAt: Date.now(),
    createdAt: Date.now(),
  };
}

function handleMyQueueUpdate(data) {
  const mp = state.multiplayer;
  if (data.status === "matched" && data.gameId) {
    if (mp.queueUnsub) mp.queueUnsub();
    if (mp.myQueueUnsub) mp.myQueueUnsub();
    if (mp.searchInterval) clearInterval(mp.searchInterval);
    api.leaveQueue(state.user.uid);

    mp.searching = false;
    mp.gameId = data.gameId;
    mp.lastRenderedRound = -1;

    $("multiplayer-searching").classList.add("hidden");
    $("multiplayer-game").classList.remove("hidden");

    mp.gameUnsub = api.listenGame(mp.gameId, handleGameSnapshot);
  }
}

function cleanupSearching(navigateBack) {
  const mp = state.multiplayer;
  if (mp.searchInterval) clearInterval(mp.searchInterval);
  if (mp.queueUnsub) mp.queueUnsub();
  if (mp.myQueueUnsub) mp.myQueueUnsub();
  mp.searchInterval = null;
  mp.queueUnsub = null;
  mp.myQueueUnsub = null;

  if (mp.searching && state.user) {
    api.leaveQueue(state.user.uid);
  }
  mp.searching = false;
  mp.attemptingMatch = false;

  if (navigateBack) {
    $("multiplayer-searching").classList.add("hidden");
    $("multiplayer-intro").classList.remove("hidden");
  }
}

function handleGameSnapshot(gameData) {
  const mp = state.multiplayer;
  mp.gameData = gameData;
  mp.isPlayer1 = gameData.player1.uid === state.user.uid;

  renderMultiplayerScoreboard(gameData);

  if (gameData.status === "finished") {
    if (mp.localTickInterval) clearInterval(mp.localTickInterval);
    finishMultiplayerLocally(gameData);
    return;
  }

  if (gameData.round !== mp.lastRenderedRound) {
    mp.lastRenderedRound = gameData.round;
    mp.answered = false;
    $("mp-answer-input").value = "";
    $("mp-answer-input").disabled = false;
    $("mp-suggestions").classList.add("hidden");
    $("mp-round-status").textContent = "";
    $("mp-round").textContent = `${gameData.round + 1}/${gameData.totalRounds}`;

    const roundInfo = gameData.rounds[gameData.round];
    $("mp-clue-text").innerHTML = roundInfo.clues.slice(0, 3).join("<br><br>");

    startMultiplayerLocalTimer(gameData);
  }

  updateMultiplayerRoundStatus(gameData);
}

function startMultiplayerLocalTimer(gameData) {
  const mp = state.multiplayer;
  if (mp.localTickInterval) clearInterval(mp.localTickInterval);

  const tick = () => {
    const elapsed = (Date.now() - gameData.roundStartAt) / 1000;
    const remaining = Math.max(gameData.roundSeconds - elapsed, 0);
    $("mp-timer").textContent = String(Math.ceil(remaining)).padStart(2, "0");
    const pct = Math.max((remaining / gameData.roundSeconds) * 100, 0);
    const bar = $("mp-timer-bar");
    bar.style.width = pct + "%";
    bar.classList.toggle("warning", remaining <= gameData.roundSeconds * 0.3);

    if (remaining <= 0) {
      clearInterval(mp.localTickInterval);
      if (!mp.answered) {
        $("mp-answer-input").disabled = true;
        mp.answered = true;
      }
      if (mp.isPlayer1) maybeAdvanceRound(mp.gameData);
    }
  };

  tick();
  mp.localTickInterval = setInterval(tick, 250);
}

function updateMultiplayerRoundStatus(gameData) {
  const answers = gameData.answers || {};
  const oppUid = state.multiplayer.isPlayer1 ? gameData.player2.uid : gameData.player1.uid;
  if (answers[oppUid] && !state.multiplayer.answered) {
    $("mp-round-status").textContent = "Lawan sudah menjawab — cepat!";
  }
  if (state.multiplayer.answered) {
    $("mp-round-status").textContent = "Jawaban terkirim. Menunggu ronde berakhir…";
  }

  const bothAnswered = answers[gameData.player1.uid] && answers[gameData.player2.uid];
  if (bothAnswered && state.multiplayer.isPlayer1) {
    maybeAdvanceRound(gameData);
  }
}

async function submitMultiplayerAnswer() {
  const mp = state.multiplayer;
  if (mp.answered || !mp.gameData) return;
  const value = $("mp-answer-input").value;
  if (!value.trim()) return;

  mp.answered = true;
  $("mp-answer-input").disabled = true;

  const roundInfo = mp.gameData.rounds[mp.gameData.round];
  const correct = api.normalizeAnswer(value) === api.normalizeAnswer(roundInfo.countryName);
  const timeMs = Date.now() - mp.gameData.roundStartAt;

  try {
    await api.submitMultiplayerAnswer(mp.gameId, state.user.uid, { correct, timeMs, value });
    showToast(correct ? "Jawaban terkirim — benar!" : "Jawaban terkirim.", correct ? "success" : "info");
  } catch (err) {
    console.error(err);
  }
}

async function maybeAdvanceRound(gameData) {
  const mp = state.multiplayer;
  if (mp.advancing) return;
  mp.advancing = true;

  try {
    const answers = gameData.answers || {};
    const p1 = gameData.player1;
    const p2 = gameData.player2;
    const a1 = answers[p1.uid];
    const a2 = answers[p2.uid];

    let score1 = 0;
    let score2 = 0;
    const basePoints = 150;

    if (a1 && a1.correct) score1 += Math.round(basePoints * Math.max(1 - a1.timeMs / (gameData.roundSeconds * 1000), 0.2));
    if (a2 && a2.correct) score2 += Math.round(basePoints * Math.max(1 - a2.timeMs / (gameData.roundSeconds * 1000), 0.2));
    if (a1 && a1.correct && (!a2 || !a2.correct || a1.timeMs < a2.timeMs)) score1 += 40;
    if (a2 && a2.correct && (!a1 || !a1.correct || a2.timeMs < a1.timeMs)) score2 += 40;

    const nextRound = gameData.round + 1;
    const isLastRound = nextRound >= gameData.totalRounds;

    const patch = {
      "player1.score": (p1.score || 0) + score1,
      "player2.score": (p2.score || 0) + score2,
      answers: {},
      round: isLastRound ? gameData.round : nextRound,
      roundStartAt: Date.now(),
      status: isLastRound ? "finished" : "in_progress",
    };

    await api.advanceGameRound(mp.gameId, patch);
  } catch (err) {
    console.error(err);
  } finally {
    mp.advancing = false;
  }
}

function renderMultiplayerScoreboard(gameData) {
  $("mp-player1-avatar").src = gameData.player1.photoURL || "";
  $("mp-player1-name").textContent = gameData.player1.displayName;
  $("mp-player1-score").textContent = gameData.player1.score || 0;
  $("mp-player2-avatar").src = gameData.player2.photoURL || "";
  $("mp-player2-name").textContent = gameData.player2.displayName;
  $("mp-player2-score").textContent = gameData.player2.score || 0;
}

let finishedHandled = false;
async function finishMultiplayerLocally(gameData) {
  if (finishedHandled) return;
  finishedHandled = true;

  if (state.multiplayer.gameUnsub) state.multiplayer.gameUnsub();

  const isPlayer1 = gameData.player1.uid === state.user.uid;
  const myScore = isPlayer1 ? gameData.player1.score : gameData.player2.score;
  const oppScore = isPlayer1 ? gameData.player2.score : gameData.player1.score;
  const won = myScore > oppScore ? true : myScore < oppScore ? false : null;

  $("multiplayer-game").classList.add("hidden");
  $("multiplayer-result").classList.remove("hidden");
  $("mp-result-emoji").textContent = won === true ? "🏆" : won === false ? "😔" : "🤝";
  $("mp-result-title").textContent = won === true ? "Kamu Menang!" : won === false ? "Kamu Kalah" : "Seri!";
  $("mp-result-myscore").textContent = myScore;
  $("mp-result-oppscore").textContent = oppScore;

  try {
    await api.applyGameResultToProfile(state.user.uid, {
      score: myScore,
      accuracy: 0,
      won,
      isMultiplayer: true,
    });
  } catch (err) {
    console.error(err);
  }

  setTimeout(() => {
    finishedHandled = false;
  }, 500);
}

// =====================================================================
// LEADERBOARD
// =====================================================================
async function renderLeaderboard() {
  const container = $("leaderboard-list");
  container.innerHTML = `<p class="leaderboard-empty">Memuat leaderboard…</p>`;
  try {
    const entries = await api.fetchTopLeaderboard(100);
    if (!entries.length) {
      container.innerHTML = `<p class="leaderboard-empty">Belum ada data. Jadilah yang pertama!</p>`;
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
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="leaderboard-empty">Gagal memuat leaderboard.</p>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// =====================================================================
// SETTINGS
// =====================================================================
function registerSettingsEvents() {
  $("btn-save-name").addEventListener("click", async () => {
    const newName = $("settings-name-input").value.trim();
    if (!newName || !state.user) return;
    try {
      await api.updateProfileName(state.user.uid, newName);
      showToast("Nama berhasil diperbarui.", "success");
    } catch (err) {
      console.error(err);
      showToast("Gagal memperbarui nama.", "error");
    }
  });
}

function renderSettingsPage() {
  if (!state.user || !state.profile) return;
  const p = state.profile;
  $("settings-avatar").src = state.user.photoURL || "";
  $("settings-name-input").value = p.displayName || "";
  $("settings-email").textContent = state.user.email || "";

  $("stat-games-played").textContent = p.gamesPlayed || 0;
  $("stat-wins").textContent = p.wins || 0;
  $("stat-losses").textContent = p.losses || 0;
  $("stat-highest-score").textContent = p.highestScore || 0;
  $("stat-best-accuracy").textContent = (p.bestAccuracy || 0) + "%";
  $("stat-rating").textContent = p.rating || 0;
  $("stat-total-points").textContent = p.totalPoints || 0;
}

// =====================================================================
// START
// =====================================================================
bootstrap();
