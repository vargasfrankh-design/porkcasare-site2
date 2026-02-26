/**
 * PorkCasare Puzzle - UI Controller
 */

import { LEVELS_CONFIG, PUZZLE_IMAGES } from './game-engine.js';

const elements = {
  navCoins: document.getElementById('navCoins'),
  navLives: document.getElementById('navLives'),
  navLevel: document.getElementById('navLevel'),
  playerAvatar: document.getElementById('playerAvatar'),
  playerName: document.getElementById('playerName'),
  playerRank: document.getElementById('playerRank'),
  currentLevel: document.getElementById('currentLevel'),
  currentMoves: document.getElementById('currentMoves'),
  gameTimer: document.getElementById('gameTimer'),
  livesContainer: document.getElementById('livesContainer'),
  imageSelection: document.getElementById('imageSelection'),
  imagesGrid: document.getElementById('imagesGrid'),
  puzzleBoardWrapper: document.getElementById('puzzleBoardWrapper'),
  puzzleBoard: document.getElementById('puzzleBoard'),
  referenceImage: document.getElementById('referenceImage'),
  refPreview: document.getElementById('refPreview'),
  btnToggleRef: document.getElementById('btnToggleRef'),
  gameControls: document.getElementById('gameControls'),
  btnStartGame: document.getElementById('btnStartGame'),
  btnHint: document.getElementById('btnHint'),
  // Game over
  gameOverModal: document.getElementById('gameOverModal'),
  gameOverTitle: document.getElementById('gameOverTitle'),
  completedImage: document.getElementById('completedImage'),
  finalMoves: document.getElementById('finalMoves'),
  finalTime: document.getElementById('finalTime'),
  finalScore: document.getElementById('finalScore'),
  coinsEarned: document.getElementById('coinsEarned'),
  starsEarned: document.getElementById('starsEarned'),
  btnBackToMenu: document.getElementById('btnBackToMenu'),
  btnNextLevel: document.getElementById('btnNextLevel'),
  btnRetryLevel: document.getElementById('btnRetryLevel'),
  loadingOverlay: document.getElementById('game-loading-overlay')
};

export class PuzzleUI {
  constructor(gameEngine, firebaseHandler) {
    this.engine = gameEngine;
    this.firebase = firebaseHandler;
    this.selectedImage = null;
    this.showRef = false;

    this.setupEventListeners();
    this.setupEngineCallbacks();
    this.renderImageSelection();
  }

  setupEventListeners() {
    elements.btnStartGame.addEventListener('click', () => this.handleStartGame());
    elements.btnHint.addEventListener('click', () => this.handleHint());
    elements.btnToggleRef.addEventListener('click', () => this.toggleReference());
    elements.btnBackToMenu.addEventListener('click', () => {
      window.location.href = '/oficina-virtual/';
    });
    elements.btnNextLevel.addEventListener('click', () => this.handleNextLevel());
    elements.btnRetryLevel.addEventListener('click', () => this.handleRetry());

    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal.id);
      });
    });
  }

  setupEngineCallbacks() {
    this.engine.onStateChange = (state) => this.updateUI(state);

    this.engine.onTileMove = () => {
      this.renderPuzzleBoard();
    };

    this.engine.onLevelComplete = (result) => {
      this.showLevelComplete(result);
      this.updateMonthlyProgress();
      this.firebase.saveProgress(this.engine.getSaveState());
    };

    this.engine.onGameOver = (result) => {
      this.showGameOver(result);
      this.updateMonthlyProgress();
      this.firebase.saveProgress(this.engine.getSaveState());
    };
  }

  renderImageSelection() {
    elements.imagesGrid.innerHTML = '';
    PUZZLE_IMAGES.forEach(img => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.style.setProperty('--img-bg', img.bgColor);
      card.innerHTML = `
        <div class="image-preview" style="background: ${img.bgColor};">
          <span class="image-emoji">${img.emoji}</span>
        </div>
        <span class="image-name">${img.name}</span>
      `;
      card.addEventListener('click', () => this.selectImage(img.id, card));
      elements.imagesGrid.appendChild(card);
    });
  }

  selectImage(imageId, cardElement) {
    this.selectedImage = imageId;
    document.querySelectorAll('.image-card').forEach(c => c.classList.remove('selected'));
    cardElement.classList.add('selected');
    elements.btnStartGame.disabled = false;
  }

  handleStartGame() {
    if (!this.selectedImage) {
      Swal.fire({ icon: 'warning', title: 'Selecciona una imagen', text: 'Elige una imagen para armar el puzzle.' });
      return;
    }

    const state = this.engine.getState();
    if (state.lives <= 0) {
      Swal.fire({ icon: 'warning', title: 'Sin vidas', text: 'No tienes vidas disponibles.' });
      return;
    }

    this.engine.initLevel(state.currentLevel, this.selectedImage);
    this.engine.startGame();

    elements.imageSelection.style.display = 'none';
    elements.puzzleBoardWrapper.style.display = 'flex';
    elements.btnHint.style.display = 'flex';
    elements.btnStartGame.innerHTML = '<span class="btn-icon">&#x1F504;</span><span>Reiniciar</span>';

    this.renderReferenceImage();
    this.renderPuzzleBoard();
  }

  renderReferenceImage() {
    const image = PUZZLE_IMAGES.find(img => img.id === this.selectedImage);
    if (!image) return;

    const size = this.engine.state.gridSize;
    elements.refPreview.innerHTML = '';
    elements.refPreview.style.gridTemplateColumns = `repeat(${size}, 1fr)`;

    const totalTiles = size * size;
    for (let i = 0; i < totalTiles - 1; i++) {
      const tile = document.createElement('div');
      tile.className = 'ref-tile';
      tile.style.background = image.colors[i % image.colors.length];
      tile.innerHTML = `<span>${i + 1}</span>`;
      elements.refPreview.appendChild(tile);
    }
    // Empty space
    const emptyTile = document.createElement('div');
    emptyTile.className = 'ref-tile empty';
    elements.refPreview.appendChild(emptyTile);
  }

  renderPuzzleBoard() {
    const state = this.engine.getState();
    const image = state.selectedImage;
    if (!image) return;

    const size = state.gridSize;
    elements.puzzleBoard.innerHTML = '';
    elements.puzzleBoard.style.gridTemplateColumns = `repeat(${size}, 1fr)`;

    state.tiles.forEach((tileValue, index) => {
      const tile = document.createElement('div');

      if (tileValue === -1) {
        tile.className = 'puzzle-tile empty';
      } else {
        tile.className = 'puzzle-tile';
        const isCorrect = tileValue === index;
        if (isCorrect) tile.classList.add('correct');

        tile.style.background = image.colors[tileValue % image.colors.length];
        tile.innerHTML = `<span class="tile-number">${tileValue + 1}</span>`;

        tile.addEventListener('click', () => {
          const moved = this.engine.moveTile(index);
          if (moved) {
            tile.classList.add('moving');
            setTimeout(() => tile.classList.remove('moving'), 200);
          }
        });
      }

      elements.puzzleBoard.appendChild(tile);
    });
  }

  toggleReference() {
    this.showRef = !this.showRef;
    elements.refPreview.style.display = this.showRef ? 'grid' : 'none';
    elements.btnToggleRef.textContent = this.showRef ? 'Ocultar' : 'Ver referencia';
  }

  handleHint() {
    const result = this.engine.useHint();
    if (result) {
      // Highlight the tile that should be moved
      const tiles = elements.puzzleBoard.querySelectorAll('.puzzle-tile');
      if (tiles[result.currentPos]) {
        tiles[result.currentPos].classList.add('hint-highlight');
        setTimeout(() => tiles[result.currentPos].classList.remove('hint-highlight'), 2000);
      }
    } else if (this.engine.state.coins < 10) {
      Swal.fire({ icon: 'warning', title: 'Monedas insuficientes', text: 'Necesitas 10 monedas para una pista.' });
    }
  }

  handleNextLevel() {
    this.closeModal('gameOverModal');
    const currentLevel = this.engine.state.currentLevel;
    if (currentLevel < LEVELS_CONFIG.length) {
      this.engine.state.currentLevel = currentLevel + 1;
      this.showImageSelection();
    } else {
      Swal.fire({ icon: 'success', title: 'Felicidades!', text: 'Has completado todos los niveles.' });
    }
  }

  handleRetry() {
    this.closeModal('gameOverModal');
    this.showImageSelection();
  }

  showImageSelection() {
    elements.imageSelection.style.display = 'block';
    elements.puzzleBoardWrapper.style.display = 'none';
    elements.btnHint.style.display = 'none';
    elements.btnStartGame.innerHTML = '<span class="btn-icon">&#x25B6;&#xFE0F;</span><span>Iniciar Puzzle</span>';
    this.selectedImage = null;
    document.querySelectorAll('.image-card').forEach(c => c.classList.remove('selected'));
  }

  updateUI(state) {
    elements.navCoins.textContent = state.coins;
    elements.navLives.textContent = state.lives;
    elements.navLevel.textContent = state.currentLevel;
    elements.currentLevel.textContent = state.currentLevel;
    elements.currentMoves.textContent = state.moves;
    elements.gameTimer.textContent = state.timeFormatted;

    const hearts = elements.livesContainer.querySelectorAll('.heart');
    hearts.forEach((heart, index) => {
      heart.classList.toggle('lost', index >= state.lives);
    });

    // Update hint button
    elements.btnHint.innerHTML = `<span class="btn-icon">&#x1F4A1;</span><span>Pista ${state.hints > 0 ? `(${state.hints})` : ''} 10&#x1FA99;</span>`;
    elements.btnHint.disabled = state.hints <= 0 || state.coins < 10;
  }

  showLevelComplete(result) {
    elements.gameOverTitle.textContent = 'Puzzle Completado!';
    elements.finalMoves.textContent = result.moves;
    elements.finalTime.textContent = result.timeFormatted;
    elements.finalScore.textContent = result.score;
    elements.coinsEarned.textContent = `${result.coinsEarned} &#x1FA99;`;

    // Show completed image
    const image = this.engine.state.selectedImage;
    if (image) {
      elements.completedImage.innerHTML = `<span class="completed-emoji">${image.emoji}</span>`;
      elements.completedImage.style.background = image.bgColor;
    }

    const starElements = elements.starsEarned.querySelectorAll('.star');
    starElements.forEach((star, index) => {
      star.classList.remove('earned', 'empty');
      star.classList.add(index < result.stars ? 'earned' : 'empty');
    });

    const isLastLevel = this.engine.state.currentLevel >= LEVELS_CONFIG.length;
    elements.btnNextLevel.style.display = isLastLevel ? 'none' : 'inline-flex';

    this.openModal('gameOverModal');
  }

  showGameOver(result) {
    elements.gameOverTitle.textContent = 'Tiempo Agotado!';
    elements.finalMoves.textContent = result.moves;
    elements.finalTime.textContent = result.timeFormatted;
    elements.finalScore.textContent = 0;
    elements.coinsEarned.textContent = `${result.coinsEarned} &#x1FA99;`;
    elements.completedImage.innerHTML = '';

    const starElements = elements.starsEarned.querySelectorAll('.star');
    starElements.forEach(star => { star.classList.remove('earned'); star.classList.add('empty'); });

    elements.btnNextLevel.style.display = 'none';
    this.openModal('gameOverModal');
  }

  async initializeUI(userData) {
    if (userData) {
      elements.playerName.textContent = userData.usuario || userData.nombre || 'Jugador';
      if (userData.avatar) elements.playerAvatar.src = userData.avatar;
      if (userData.puzzleProgress) {
        this.engine.loadState(userData.puzzleProgress);
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

export default PuzzleUI;
