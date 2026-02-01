/**
 * PorkCasare Memory Game - UI Controller
 * Controlador de la interfaz de usuario
 */

import { LEVELS_CONFIG } from './game-engine.js';

// Elementos del DOM
const elements = {
  // Navigation
  navCoins: document.getElementById('navCoins'),
  navLives: document.getElementById('navLives'),
  navLevel: document.getElementById('navLevel'),

  // Player info
  playerAvatar: document.getElementById('playerAvatar'),
  playerName: document.getElementById('playerName'),
  playerRank: document.getElementById('playerRank'),

  // Game stats
  currentLevel: document.getElementById('currentLevel'),
  currentScore: document.getElementById('currentScore'),
  currentMoves: document.getElementById('currentMoves'),
  gameTimer: document.getElementById('gameTimer'),
  livesContainer: document.getElementById('livesContainer'),

  // Game board
  gameBoard: document.getElementById('gameBoard'),

  // Controls
  btnStartGame: document.getElementById('btnStartGame'),
  btnPauseGame: document.getElementById('btnPauseGame'),
  btnHint: document.getElementById('btnHint'),
  btnBuyLives: document.getElementById('btnBuyLives'),

  // Modals
  levelSelectModal: document.getElementById('levelSelectModal'),
  gameOverModal: document.getElementById('gameOverModal'),
  shopModal: document.getElementById('shopModal'),
  pauseModal: document.getElementById('pauseModal'),

  // Level select
  closeLevelModal: document.getElementById('closeLevelModal'),
  levelsGrid: document.getElementById('levelsGrid'),

  // Game over
  gameOverTitle: document.getElementById('gameOverTitle'),
  finalScore: document.getElementById('finalScore'),
  finalMoves: document.getElementById('finalMoves'),
  finalTime: document.getElementById('finalTime'),
  coinsEarned: document.getElementById('coinsEarned'),
  starsEarned: document.getElementById('starsEarned'),
  btnBackToMenu: document.getElementById('btnBackToMenu'),
  btnNextLevel: document.getElementById('btnNextLevel'),
  btnRetryLevel: document.getElementById('btnRetryLevel'),

  // Shop
  closeShopModal: document.getElementById('closeShopModal'),
  shopBalance: document.getElementById('shopBalance'),
  shopItems: document.getElementById('shopItems'),

  // Pause
  btnExitGame: document.getElementById('btnExitGame'),
  btnResumeGame: document.getElementById('btnResumeGame'),

  // Loading
  loadingOverlay: document.getElementById('game-loading-overlay')
};

// Shop items configuration
const SHOP_ITEMS = {
  lives: [
    { id: 'life1', name: '1 Vida', description: 'Una vida extra', icon: '❤️', amount: 1, price: 20 },
    { id: 'life3', name: '3 Vidas', description: 'Paquete de 3 vidas', icon: '❤️❤️❤️', amount: 3, price: 50 },
    { id: 'life5', name: '5 Vidas', description: 'Paquete de 5 vidas', icon: '💖', amount: 5, price: 80 }
  ],
  hints: [
    { id: 'hint1', name: '1 Pista', description: 'Revela una pareja', icon: '💡', amount: 1, price: 10 },
    { id: 'hint3', name: '3 Pistas', description: 'Paquete de 3 pistas', icon: '💡💡💡', amount: 3, price: 25 },
    { id: 'hint5', name: '5 Pistas', description: 'Paquete de 5 pistas', icon: '✨', amount: 5, price: 40 }
  ],
  boosts: [
    { id: 'time30', name: '+30 Segundos', description: 'Tiempo extra', icon: '⏱️', type: 'time', amount: 30, price: 15 },
    { id: 'double', name: 'Puntos x2', description: 'Siguiente nivel', icon: '🚀', type: 'multiplier', amount: 2, price: 100 }
  ]
};

// Ranks based on level
const RANKS = [
  { minLevel: 1, name: 'Novato', color: '#888' },
  { minLevel: 3, name: 'Aprendiz', color: '#4CAF50' },
  { minLevel: 5, name: 'Jugador', color: '#2196F3' },
  { minLevel: 7, name: 'Experto', color: '#9C27B0' },
  { minLevel: 10, name: 'Maestro', color: '#FF9800' },
  { minLevel: 15, name: 'Leyenda', color: '#F44336' }
];

export class GameUI {
  constructor(gameEngine, firebaseHandler) {
    this.engine = gameEngine;
    this.firebase = firebaseHandler;
    this.currentShopTab = 'lives';
    this.hintCards = null;

    this.setupEventListeners();
    this.setupEngineCallbacks();
  }

  // Configurar event listeners
  setupEventListeners() {
    // Start game
    elements.btnStartGame.addEventListener('click', () => this.handleStartGame());

    // Pause/Resume
    elements.btnPauseGame.addEventListener('click', () => this.handlePauseGame());
    elements.btnResumeGame.addEventListener('click', () => this.handleResumeGame());
    elements.btnExitGame.addEventListener('click', () => this.handleExitGame());

    // Hint
    elements.btnHint.addEventListener('click', () => this.handleUseHint());

    // Shop
    elements.btnBuyLives.addEventListener('click', () => this.openShop());
    elements.closeShopModal.addEventListener('click', () => this.closeModal('shopModal'));

    // Level select
    elements.closeLevelModal.addEventListener('click', () => this.closeModal('levelSelectModal'));

    // Game over buttons
    elements.btnBackToMenu.addEventListener('click', () => this.handleBackToMenu());
    elements.btnNextLevel.addEventListener('click', () => this.handleNextLevel());
    elements.btnRetryLevel.addEventListener('click', () => this.handleRetryLevel());

    // Shop tabs
    document.querySelectorAll('.shop-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.currentShopTab = tab.dataset.tab;
        document.querySelectorAll('.shop-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.renderShopItems();
      });
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal(modal.id);
        }
      });
    });
  }

  // Configurar callbacks del engine
  setupEngineCallbacks() {
    this.engine.onStateChange = (state) => this.updateUI(state);

    this.engine.onMatch = (card1, card2, points) => {
      this.animateMatch(card1.id);
      this.animateMatch(card2.id);
      this.showFloatingPoints(points);
    };

    this.engine.onMismatch = (card1, card2) => {
      this.animateMismatch(card1.id);
      this.animateMismatch(card2.id);
    };

    this.engine.onLevelComplete = (result) => {
      this.showLevelComplete(result);
      this.firebase.saveProgress(this.engine.getSaveState());
    };

    this.engine.onGameOver = (result) => {
      this.showGameOver(result);
      this.firebase.saveProgress(this.engine.getSaveState());
    };
  }

  // Inicializar UI con datos del usuario
  async initializeUI(userData) {
    // Cargar datos del usuario
    if (userData) {
      elements.playerName.textContent = userData.usuario || userData.nombre || 'Jugador';
      if (userData.avatar) {
        elements.playerAvatar.src = userData.avatar;
      }

      // Cargar progreso del juego si existe
      if (userData.gameProgress) {
        this.engine.loadState(userData.gameProgress);
      }
    }

    // Actualizar UI inicial
    this.updateUI(this.engine.getState());

    // Ocultar loading
    this.hideLoading();
  }

  // Actualizar toda la UI
  updateUI(state) {
    // Navigation stats
    elements.navCoins.textContent = state.coins;
    elements.navLives.textContent = state.lives;
    elements.navLevel.textContent = state.currentLevel;

    // Game stats
    elements.currentLevel.textContent = state.currentLevel;
    elements.currentScore.textContent = state.score;
    elements.currentMoves.textContent = state.moves;
    elements.gameTimer.textContent = state.timeFormatted;

    // Lives display
    this.updateLivesDisplay(state.lives);

    // Button states
    elements.btnPauseGame.disabled = !state.isPlaying;
    elements.btnHint.disabled = !state.isPlaying || state.hints <= 0;

    // Update hint button text
    elements.btnHint.innerHTML = `<span class="btn-icon">💡</span><span>Pista (${state.hints})</span>`;

    // Update player rank
    const rank = this.getRank(state.currentLevel);
    elements.playerRank.textContent = rank.name;
    elements.playerRank.style.color = rank.color;
  }

  // Actualizar display de vidas
  updateLivesDisplay(lives) {
    const hearts = elements.livesContainer.querySelectorAll('.heart');
    hearts.forEach((heart, index) => {
      if (index < lives) {
        heart.classList.remove('lost');
      } else {
        heart.classList.add('lost');
      }
    });
  }

  // Obtener rango basado en nivel
  getRank(level) {
    let currentRank = RANKS[0];
    for (const rank of RANKS) {
      if (level >= rank.minLevel) {
        currentRank = rank;
      }
    }
    return currentRank;
  }

  // Renderizar tablero de juego
  renderGameBoard(state) {
    const config = state.config;
    if (!config) return;

    elements.gameBoard.innerHTML = '';
    elements.gameBoard.style.gridTemplateColumns = `repeat(${config.gridCols}, 1fr)`;

    state.cards.forEach(card => {
      const cardElement = this.createCardElement(card);
      elements.gameBoard.appendChild(cardElement);
    });
  }

  // Crear elemento de carta
  createCardElement(card) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'memory-card';
    cardDiv.dataset.id = card.id;

    if (card.isFlipped || card.isMatched) {
      cardDiv.classList.add('flipped');
    }
    if (card.isMatched) {
      cardDiv.classList.add('matched');
    }

    cardDiv.innerHTML = `
      <div class="card-face card-back"></div>
      <div class="card-face card-front">
        <span class="card-emoji">${card.emoji}</span>
      </div>
    `;

    cardDiv.addEventListener('click', () => {
      if (!card.isMatched && !card.isFlipped) {
        this.handleCardClick(card.id);
      }
    });

    return cardDiv;
  }

  // Manejar click en carta
  handleCardClick(cardId) {
    const flipped = this.engine.flipCard(cardId);
    if (flipped) {
      const cardElement = elements.gameBoard.querySelector(`[data-id="${cardId}"]`);
      if (cardElement) {
        cardElement.classList.add('flipped');
      }
    }
  }

  // Animación de match
  animateMatch(cardId) {
    const cardElement = elements.gameBoard.querySelector(`[data-id="${cardId}"]`);
    if (cardElement) {
      cardElement.classList.add('matched');
    }
  }

  // Animación de mismatch
  animateMismatch(cardId) {
    const cardElement = elements.gameBoard.querySelector(`[data-id="${cardId}"]`);
    if (cardElement) {
      cardElement.classList.add('shake');
      setTimeout(() => {
        cardElement.classList.remove('flipped', 'shake');
      }, 500);
    }
  }

  // Mostrar puntos flotantes
  showFloatingPoints(points) {
    const floater = document.createElement('div');
    floater.className = 'floating-points';
    floater.textContent = `+${points}`;
    floater.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 32px;
      font-weight: bold;
      color: #7be495;
      pointer-events: none;
      animation: floatUp 1s ease forwards;
      z-index: 100;
    `;

    // Add animation keyframes if not exists
    if (!document.getElementById('float-animation')) {
      const style = document.createElement('style');
      style.id = 'float-animation';
      style.textContent = `
        @keyframes floatUp {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(0.5); }
          50% { opacity: 1; transform: translate(-50%, -100%) scale(1.2); }
          100% { opacity: 0; transform: translate(-50%, -150%) scale(1); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(floater);
    setTimeout(() => floater.remove(), 1000);
  }

  // Handlers
  handleStartGame() {
    const state = this.engine.getState();

    if (state.lives <= 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Sin vidas',
        text: 'No tienes vidas disponibles. ¿Deseas comprar más?',
        showCancelButton: true,
        confirmButtonText: 'Ir a tienda',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (result.isConfirmed) {
          this.openShop();
        }
      });
      return;
    }

    // Initialize level and render board
    this.engine.initLevel(state.currentLevel);
    this.renderGameBoard(this.engine.getState());

    // Start the game
    this.engine.startGame();

    // Update button
    elements.btnStartGame.innerHTML = '<span class="btn-icon">🔄</span><span>Reiniciar</span>';
  }

  handlePauseGame() {
    this.engine.pauseGame();
    this.openModal('pauseModal');
  }

  handleResumeGame() {
    this.closeModal('pauseModal');
    this.engine.resumeGame();
  }

  handleExitGame() {
    this.closeModal('pauseModal');
    this.engine.stopTimer();
    this.engine.state.isPlaying = false;
    this.firebase.saveProgress(this.engine.getSaveState());
    window.location.href = '/oficina-virtual/';
  }

  handleUseHint() {
    const hintPair = this.engine.useHint();
    if (hintPair) {
      hintPair.forEach(card => {
        const cardElement = elements.gameBoard.querySelector(`[data-id="${card.id}"]`);
        if (cardElement) {
          cardElement.classList.add('hint');
          setTimeout(() => cardElement.classList.remove('hint'), 2000);
        }
      });
    } else if (this.engine.state.coins < 10) {
      Swal.fire({
        icon: 'warning',
        title: 'Monedas insuficientes',
        text: 'Necesitas al menos 10 monedas para usar una pista.',
        confirmButtonText: 'Entendido'
      });
    }
  }

  handleBackToMenu() {
    this.closeModal('gameOverModal');
    window.location.href = '/oficina-virtual/';
  }

  handleNextLevel() {
    this.closeModal('gameOverModal');
    const currentLevel = this.engine.state.currentLevel;
    if (currentLevel < LEVELS_CONFIG.length) {
      this.engine.state.currentLevel = currentLevel + 1;
      this.handleStartGame();
    } else {
      Swal.fire({
        icon: 'success',
        title: '¡Felicidades!',
        text: 'Has completado todos los niveles disponibles.',
        confirmButtonText: 'Genial'
      });
    }
  }

  handleRetryLevel() {
    this.closeModal('gameOverModal');
    this.handleStartGame();
  }

  // Level complete modal
  showLevelComplete(result) {
    elements.gameOverTitle.textContent = '¡Nivel Completado!';
    elements.finalScore.textContent = result.finalScore;
    elements.finalMoves.textContent = result.moves;
    elements.finalTime.textContent = result.timeFormatted;
    elements.coinsEarned.textContent = `${result.coinsEarned} 🪙`;

    // Update stars
    const starElements = elements.starsEarned.querySelectorAll('.star');
    starElements.forEach((star, index) => {
      star.classList.remove('earned', 'empty');
      if (index < result.stars) {
        star.classList.add('earned');
      } else {
        star.classList.add('empty');
      }
    });

    // Show/hide next level button
    const isLastLevel = this.engine.state.currentLevel >= LEVELS_CONFIG.length;
    elements.btnNextLevel.style.display = isLastLevel ? 'none' : 'inline-flex';

    this.openModal('gameOverModal');
  }

  // Game over modal
  showGameOver(result) {
    elements.gameOverTitle.textContent = result.reason === 'time' ? '¡Tiempo Agotado!' : 'Game Over';
    elements.finalScore.textContent = result.score;
    elements.finalMoves.textContent = result.moves;
    elements.finalTime.textContent = result.timeFormatted;
    elements.coinsEarned.textContent = `${result.coinsEarned} 🪙`;

    // Reset stars
    const starElements = elements.starsEarned.querySelectorAll('.star');
    starElements.forEach(star => {
      star.classList.remove('earned');
      star.classList.add('empty');
    });

    elements.btnNextLevel.style.display = 'none';

    this.openModal('gameOverModal');
  }

  // Shop
  openShop() {
    elements.shopBalance.textContent = `${this.engine.state.coins} 🪙`;
    this.renderShopItems();
    this.openModal('shopModal');
  }

  renderShopItems() {
    const items = SHOP_ITEMS[this.currentShopTab];
    elements.shopItems.innerHTML = '';

    items.forEach(item => {
      const canAfford = this.engine.state.coins >= item.price;
      const itemDiv = document.createElement('div');
      itemDiv.className = 'shop-item';
      itemDiv.innerHTML = `
        <div class="shop-item-info">
          <span class="shop-item-icon">${item.icon}</span>
          <div class="shop-item-details">
            <h4>${item.name}</h4>
            <p>${item.description}</p>
          </div>
        </div>
        <button class="shop-item-price" ${!canAfford ? 'disabled' : ''}>
          ${item.price} 🪙
        </button>
      `;

      const buyBtn = itemDiv.querySelector('.shop-item-price');
      buyBtn.addEventListener('click', () => this.handlePurchase(item));

      elements.shopItems.appendChild(itemDiv);
    });
  }

  handlePurchase(item) {
    let success = false;

    if (this.currentShopTab === 'lives') {
      success = this.engine.buyLives(item.amount, item.price);
    } else if (this.currentShopTab === 'hints') {
      success = this.engine.buyHints(item.amount, item.price);
    } else if (this.currentShopTab === 'boosts') {
      // Handle boosts (future implementation)
      success = false;
    }

    if (success) {
      elements.shopBalance.textContent = `${this.engine.state.coins} 🪙`;
      this.renderShopItems();
      this.firebase.saveProgress(this.engine.getSaveState());

      Swal.fire({
        icon: 'success',
        title: '¡Compra exitosa!',
        text: `Has comprado ${item.name}`,
        timer: 1500,
        showConfirmButton: false
      });
    }
  }

  // Level selection
  openLevelSelect() {
    this.renderLevelGrid();
    this.openModal('levelSelectModal');
  }

  renderLevelGrid() {
    elements.levelsGrid.innerHTML = '';

    LEVELS_CONFIG.forEach((config, index) => {
      const level = index + 1;
      const progress = this.engine.state.levelProgress[level];
      const isUnlocked = level === 1 || this.engine.state.levelProgress[level - 1]?.completed;

      const levelBtn = document.createElement('button');
      levelBtn.className = `level-btn ${level === this.engine.state.currentLevel ? 'current' : ''} ${!isUnlocked ? 'locked' : ''}`;
      levelBtn.disabled = !isUnlocked;

      const stars = progress?.stars || 0;
      levelBtn.innerHTML = `
        <span>${level}</span>
        <div class="level-stars">
          ${[1, 2, 3].map(s => s <= stars ? '⭐' : '☆').join('')}
        </div>
      `;

      levelBtn.addEventListener('click', () => {
        if (isUnlocked) {
          this.engine.state.currentLevel = level;
          this.closeModal('levelSelectModal');
          this.updateUI(this.engine.getState());
        }
      });

      elements.levelsGrid.appendChild(levelBtn);
    });
  }

  // Modal helpers
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  }

  // Loading
  hideLoading() {
    if (elements.loadingOverlay) {
      elements.loadingOverlay.classList.add('hidden');
      setTimeout(() => {
        if (elements.loadingOverlay.parentNode) {
          elements.loadingOverlay.parentNode.removeChild(elements.loadingOverlay);
        }
      }, 300);
    }
  }

  showLoading() {
    if (elements.loadingOverlay) {
      elements.loadingOverlay.classList.remove('hidden');
    }
  }
}

export default GameUI;
