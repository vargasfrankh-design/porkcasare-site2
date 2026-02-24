/**
 * PorkCasare Trivia - UI Controller
 */

import { CATEGORIES, GAME_CONFIG } from './game-engine.js';

const elements = {
  navCoins: document.getElementById('navCoins'),
  navLives: document.getElementById('navLives'),
  navLevel: document.getElementById('navLevel'),
  playerAvatar: document.getElementById('playerAvatar'),
  playerName: document.getElementById('playerName'),
  playerRank: document.getElementById('playerRank'),
  currentCategory: document.getElementById('currentCategory'),
  currentScore: document.getElementById('currentScore'),
  questionNumber: document.getElementById('questionNumber'),
  gameTimer: document.getElementById('gameTimer'),
  livesContainer: document.getElementById('livesContainer'),
  categorySelection: document.getElementById('categorySelection'),
  categoriesGrid: document.getElementById('categoriesGrid'),
  questionBoard: document.getElementById('questionBoard'),
  progressBar: document.getElementById('progressBar'),
  timerCircle: document.getElementById('timerCircle'),
  timerProgress: document.getElementById('timerProgress'),
  timerText: document.getElementById('timerText'),
  questionCard: document.getElementById('questionCard'),
  questionCategoryBadge: document.getElementById('questionCategoryBadge'),
  questionText: document.getElementById('questionText'),
  answersGrid: document.getElementById('answersGrid'),
  gameControls: document.getElementById('gameControls'),
  btnStartGame: document.getElementById('btnStartGame'),
  btnFiftyFifty: document.getElementById('btnFiftyFifty'),
  btnSkip: document.getElementById('btnSkip'),
  btnExtraTime: document.getElementById('btnExtraTime'),
  fiftyFiftyCount: document.getElementById('fiftyFiftyCount'),
  skipCount: document.getElementById('skipCount'),
  extraTimeCount: document.getElementById('extraTimeCount'),
  // Game over
  gameOverModal: document.getElementById('gameOverModal'),
  gameOverTitle: document.getElementById('gameOverTitle'),
  finalScore: document.getElementById('finalScore'),
  finalCorrect: document.getElementById('finalCorrect'),
  finalStreak: document.getElementById('finalStreak'),
  coinsEarned: document.getElementById('coinsEarned'),
  starsEarned: document.getElementById('starsEarned'),
  btnBackToMenu: document.getElementById('btnBackToMenu'),
  btnPlayAgain: document.getElementById('btnPlayAgain'),
  loadingOverlay: document.getElementById('game-loading-overlay')
};

const ANSWER_COLORS = ['#e74c3c', '#3498db', '#f39c12', '#27ae60'];
const ANSWER_LETTERS = ['A', 'B', 'C', 'D'];

export class TriviaUI {
  constructor(gameEngine, firebaseHandler) {
    this.engine = gameEngine;
    this.firebase = firebaseHandler;
    this.selectedCategory = null;
    this.canAnswer = false;

    this.setupEventListeners();
    this.setupEngineCallbacks();
    this.renderCategories();
  }

  setupEventListeners() {
    elements.btnStartGame.addEventListener('click', () => this.handleStartGame());
    elements.btnFiftyFifty.addEventListener('click', () => this.handleFiftyFifty());
    elements.btnSkip.addEventListener('click', () => this.handleSkip());
    elements.btnExtraTime.addEventListener('click', () => this.handleExtraTime());
    elements.btnBackToMenu.addEventListener('click', () => {
      window.location.href = '/oficina-virtual/';
    });
    elements.btnPlayAgain.addEventListener('click', () => {
      this.closeModal('gameOverModal');
      this.showCategorySelection();
    });

    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal.id);
      });
    });
  }

  setupEngineCallbacks() {
    this.engine.onStateChange = (state) => this.updateUI(state);

    this.engine.onCorrectAnswer = ({ pointsEarned, streak }) => {
      this.showFloatingText(`+${pointsEarned}`, '#7be495');
      if (streak >= 3) {
        this.showFloatingText(`Racha x${streak}!`, '#f5a623');
      }
    };

    this.engine.onWrongAnswer = ({ correctIndex }) => {
      this.showFloatingText('Incorrecto', '#e74c3c');
      this.highlightCorrectAnswer(correctIndex);
    };

    this.engine.onTimeUp = ({ correctIndex }) => {
      this.canAnswer = false;
      this.showFloatingText('Tiempo agotado!', '#e74c3c');
      this.highlightCorrectAnswer(correctIndex);
      setTimeout(() => this.advanceToNext(), 2000);
    };

    this.engine.onRoundComplete = (result) => {
      this.showGameOver(result);
      this.updateMonthlyProgress();
      this.firebase.saveProgress(this.engine.getSaveState());
    };
  }

  renderCategories() {
    elements.categoriesGrid.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const card = document.createElement('div');
      card.className = 'category-card';
      card.style.setProperty('--cat-color', cat.color);
      card.innerHTML = `
        <div class="category-icon">${cat.icon}</div>
        <h4 class="category-name">${cat.name}</h4>
        <p class="category-desc">${cat.description}</p>
      `;
      card.addEventListener('click', () => this.selectCategory(cat.id, card));
      elements.categoriesGrid.appendChild(card);
    });
  }

  selectCategory(categoryId, cardElement) {
    this.selectedCategory = categoryId;
    document.querySelectorAll('.category-card').forEach(c => c.classList.remove('selected'));
    cardElement.classList.add('selected');
    elements.btnStartGame.disabled = false;
    elements.btnStartGame.innerHTML = '<span class="btn-icon">&#x25B6;&#xFE0F;</span><span>Iniciar Trivia</span>';
  }

  handleStartGame() {
    if (!this.selectedCategory) {
      Swal.fire({ icon: 'warning', title: 'Selecciona una categoria', text: 'Elige una categoria antes de iniciar.' });
      return;
    }

    const state = this.engine.getState();
    if (state.lives <= 0) {
      Swal.fire({ icon: 'warning', title: 'Sin vidas', text: 'No tienes vidas disponibles.' });
      return;
    }

    this.engine.selectCategory(this.selectedCategory);
    this.engine.startRound();

    elements.categorySelection.style.display = 'none';
    elements.questionBoard.style.display = 'block';
    elements.gameControls.style.display = 'none';

    const cat = CATEGORIES.find(c => c.id === this.selectedCategory);
    elements.currentCategory.textContent = cat ? cat.name : 'General';
    elements.questionCategoryBadge.textContent = cat ? cat.name : 'General';

    this.renderQuestion();
  }

  renderQuestion() {
    const question = this.engine.getCurrentQuestion();
    if (!question) return;

    this.canAnswer = true;
    const state = this.engine.getState();

    elements.questionText.textContent = question.q;
    elements.questionNumber.textContent = `${state.currentQuestionIndex + 1}/${state.questions.length}`;
    elements.progressBar.style.width = `${state.progress}%`;

    // Render answers
    elements.answersGrid.innerHTML = '';
    question.options.forEach((option, index) => {
      const btn = document.createElement('button');
      btn.className = 'answer-btn';
      btn.style.setProperty('--answer-color', ANSWER_COLORS[index]);
      btn.innerHTML = `
        <span class="answer-letter">${ANSWER_LETTERS[index]}</span>
        <span class="answer-text">${option}</span>
      `;
      btn.addEventListener('click', () => this.handleAnswer(index, btn));
      elements.answersGrid.appendChild(btn);
    });

    // Update powerups
    elements.fiftyFiftyCount.textContent = state.fiftyFiftyRemaining;
    elements.skipCount.textContent = state.skipRemaining;
    elements.extraTimeCount.textContent = state.extraTimeRemaining;
    elements.btnFiftyFifty.disabled = state.fiftyFiftyRemaining <= 0;
    elements.btnSkip.disabled = state.skipRemaining <= 0;
    elements.btnExtraTime.disabled = state.extraTimeRemaining <= 0;
  }

  handleAnswer(index, btnElement) {
    if (!this.canAnswer) return;
    this.canAnswer = false;

    const result = this.engine.answerQuestion(index);
    if (!result) return;

    // Disable all answer buttons
    const allBtns = elements.answersGrid.querySelectorAll('.answer-btn');
    allBtns.forEach(btn => btn.classList.add('disabled'));

    if (result.isCorrect) {
      btnElement.classList.add('correct');
    } else {
      btnElement.classList.add('wrong');
      this.highlightCorrectAnswer(result.correctIndex);
    }

    // Advance after delay
    setTimeout(() => this.advanceToNext(), 1800);
  }

  advanceToNext() {
    const hasNext = this.engine.nextQuestion();
    if (hasNext) {
      this.renderQuestion();
    }
  }

  highlightCorrectAnswer(correctIndex) {
    const allBtns = elements.answersGrid.querySelectorAll('.answer-btn');
    if (allBtns[correctIndex]) {
      allBtns[correctIndex].classList.add('correct');
    }
  }

  handleFiftyFifty() {
    const removed = this.engine.useFiftyFifty();
    if (!removed) return;

    const allBtns = elements.answersGrid.querySelectorAll('.answer-btn');
    removed.forEach(index => {
      if (allBtns[index]) {
        allBtns[index].classList.add('eliminated');
        allBtns[index].disabled = true;
      }
    });
  }

  handleSkip() {
    this.canAnswer = false;
    const hasNext = this.engine.useSkip();
    if (hasNext) {
      this.renderQuestion();
    }
  }

  handleExtraTime() {
    this.engine.useExtraTime();
  }

  updateUI(state) {
    elements.navCoins.textContent = state.coins;
    elements.navLives.textContent = state.lives;
    elements.currentScore.textContent = state.score;

    // Timer update
    elements.gameTimer.textContent = state.timeFormatted;
    elements.timerText.textContent = state.timeRemaining;

    // Timer circle animation
    const circumference = 2 * Math.PI * 45;
    const progress = state.timeRemaining / GAME_CONFIG.timePerQuestion;
    const offset = circumference * (1 - progress);
    elements.timerProgress.style.strokeDasharray = circumference;
    elements.timerProgress.style.strokeDashoffset = offset;

    // Timer color
    if (state.timeRemaining <= 5) {
      elements.timerCircle.classList.add('danger');
    } else if (state.timeRemaining <= 10) {
      elements.timerCircle.classList.add('warning');
      elements.timerCircle.classList.remove('danger');
    } else {
      elements.timerCircle.classList.remove('warning', 'danger');
    }

    // Lives
    const hearts = elements.livesContainer.querySelectorAll('.heart');
    hearts.forEach((heart, index) => {
      heart.classList.toggle('lost', index >= state.lives);
    });
  }

  showGameOver(result) {
    elements.gameOverTitle.textContent = result.isPerfect ? 'Ronda Perfecta!' : 'Fin de la Trivia';
    elements.finalScore.textContent = result.score;
    elements.finalCorrect.textContent = `${result.correctAnswers}/${result.totalQuestions}`;
    elements.finalStreak.textContent = result.maxStreak;
    elements.coinsEarned.textContent = `${result.coinsEarned} &#x1FA99;`;

    const starElements = elements.starsEarned.querySelectorAll('.star');
    starElements.forEach((star, index) => {
      star.classList.remove('earned', 'empty');
      star.classList.add(index < result.stars ? 'earned' : 'empty');
    });

    this.openModal('gameOverModal');
  }

  showCategorySelection() {
    elements.categorySelection.style.display = 'block';
    elements.questionBoard.style.display = 'none';
    elements.gameControls.style.display = 'flex';
    this.selectedCategory = null;
    document.querySelectorAll('.category-card').forEach(c => c.classList.remove('selected'));
  }

  showFloatingText(text, color) {
    const floater = document.createElement('div');
    floater.className = 'floating-text';
    floater.textContent = text;
    floater.style.color = color;
    document.body.appendChild(floater);
    setTimeout(() => floater.remove(), 1200);
  }

  async initializeUI(userData) {
    if (userData) {
      elements.playerName.textContent = userData.usuario || userData.nombre || 'Jugador';
      if (userData.avatar) elements.playerAvatar.src = userData.avatar;
      if (userData.triviaProgress) {
        this.engine.loadState(userData.triviaProgress);
      }
    }
    this.updateUI(this.engine.getState());
    this.updateMonthlyProgress();
    this.hideLoading();
  }

  // Actualizar barra de progreso mensual
  updateMonthlyProgress() {
    const info = this.firebase.getMonthlyInfo();
    const monthlyValues = document.getElementById('monthlyValues');
    const monthlyFill = document.getElementById('monthlyFill');
    const monthlyMultiplier = document.getElementById('monthlyMultiplier');

    if (monthlyValues) {
      monthlyValues.textContent = `${info.earned.toLocaleString()} / ${info.limit.toLocaleString()}`;
    }
    if (monthlyFill) {
      monthlyFill.style.width = `${Math.min(100, info.progress * 100)}%`;
      // Color segun progreso
      if (info.progress >= 1) monthlyFill.style.background = '#e74c3c';
      else if (info.progress >= 0.8) monthlyFill.style.background = '#e67e22';
      else if (info.progress >= 0.6) monthlyFill.style.background = '#f39c12';
      else if (info.progress >= 0.4) monthlyFill.style.background = '#f1c40f';
      else monthlyFill.style.background = '#7be495';
    }
    if (monthlyMultiplier) {
      const pct = Math.round(info.multiplier * 100);
      if (pct === 0) {
        monthlyMultiplier.textContent = 'Limite mensual alcanzado';
        monthlyMultiplier.style.color = '#e74c3c';
      } else {
        monthlyMultiplier.textContent = `Recompensa: ${pct}%`;
        monthlyMultiplier.style.color = pct <= 30 ? '#e67e22' : '#aaa';
      }
    }
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  hideLoading() {
    if (elements.loadingOverlay) {
      elements.loadingOverlay.classList.add('hidden');
      setTimeout(() => {
        if (elements.loadingOverlay.parentNode) elements.loadingOverlay.parentNode.removeChild(elements.loadingOverlay);
      }, 300);
    }
  }
}

export default TriviaUI;
