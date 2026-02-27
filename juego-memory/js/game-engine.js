/**
 * PorkCasare Memory Game - Game Engine
 * Motor del juego que maneja la lógica principal del Memory
 */

// Configuración de niveles
export const LEVELS_CONFIG = [
  { level: 1, pairs: 4, gridCols: 4, gridRows: 2, timeLimit: 60, minMoves: 8, scoreMultiplier: 1 },
  { level: 2, pairs: 6, gridCols: 4, gridRows: 3, timeLimit: 90, minMoves: 12, scoreMultiplier: 1.2 },
  { level: 3, pairs: 8, gridCols: 4, gridRows: 4, timeLimit: 120, minMoves: 16, scoreMultiplier: 1.4 },
  { level: 4, pairs: 10, gridCols: 5, gridRows: 4, timeLimit: 150, minMoves: 20, scoreMultiplier: 1.6 },
  { level: 5, pairs: 12, gridCols: 6, gridRows: 4, timeLimit: 180, minMoves: 24, scoreMultiplier: 1.8 },
  { level: 6, pairs: 15, gridCols: 6, gridRows: 5, timeLimit: 210, minMoves: 30, scoreMultiplier: 2.0 },
  { level: 7, pairs: 18, gridCols: 6, gridRows: 6, timeLimit: 240, minMoves: 36, scoreMultiplier: 2.2 },
  { level: 8, pairs: 20, gridCols: 8, gridRows: 5, timeLimit: 270, minMoves: 40, scoreMultiplier: 2.5 },
  { level: 9, pairs: 24, gridCols: 8, gridRows: 6, timeLimit: 300, minMoves: 48, scoreMultiplier: 2.8 },
  { level: 10, pairs: 30, gridCols: 10, gridRows: 6, timeLimit: 360, minMoves: 60, scoreMultiplier: 3.0 }
];

// Emojis para las cartas (categorías temáticas)
export const CARD_THEMES = {
  animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🦄', '🐔', '🐧', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦓', '🦒', '🦘', '🦛', '🐘'],
  food: ['🍎', '🍊', '🍋', '🍇', '🍓', '🍑', '🍒', '🥝', '🍅', '🥑', '🌽', '🥕', '🍕', '🍔', '🌮', '🍣', '🍩', '🍪', '🎂', '🍦', '🍿', '🥤', '☕', '🍵', '🍺', '🍷', '🥐', '🥨', '🧀', '🥚'],
  nature: ['🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '🌴', '🌵', '🍀', '🍁', '🍂', '🌾', '🌿', '☘️', '🌱', '🌲', '🌳', '🌊', '🔥', '⭐', '🌙', '☀️', '⛅', '🌈', '❄️', '💧', '🌸', '🏔️', '🌋', '🏝️'],
  objects: ['⚽', '🏀', '🎾', '🎱', '🎯', '🎮', '🎧', '🎸', '🎹', '🎺', '🚗', '🚕', '🚌', '🚎', '🚀', '✈️', '🚁', '🛸', '⛵', '🚢', '🏠', '🏰', '🎪', '🎡', '🎢', '⛱️', '🎁', '🎈', '🎉', '🏆'],
  pork: ['🐷', '🐖', '🥓', '🍖', '🥩', '🌭', '🍔', '🌮', '🥪', '🥙', '🍳', '🧀', '🥚', '🥛', '🍺', '🎉', '💰', '⭐', '🏆', '👑', '💎', '🎯', '🚀', '💪', '🔥', '✨', '🌟', '💫', '🎊', '🎁']
};

// Configuración de recompensas
export const REWARDS_CONFIG = {
  baseCoinsPerLevel: 10,
  perfectBonus: 50, // Bonus por completar sin errores
  timeBonus: {
    excellent: 30, // < 50% del tiempo
    good: 20,      // < 75% del tiempo
    normal: 10     // resto
  },
  streakBonus: 5, // Por cada pareja consecutiva
  starThresholds: {
    one: 0.6,   // 60% del puntaje máximo
    two: 0.8,   // 80% del puntaje máximo
    three: 1.0  // 100% (o cercano)
  }
};

// Estado del juego
export class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.currentLevel = 1;
    this.score = 0;
    this.moves = 0;
    this.matchedPairs = 0;
    this.lives = 5;
    this.coins = 0;
    this.hints = 3;
    this.streak = 0;
    this.timeElapsed = 0;
    this.isPlaying = false;
    this.isPaused = false;
    this.cards = [];
    this.flippedCards = [];
    this.matchedCards = [];
    this.levelProgress = {};
    this.totalScore = 0;
  }
}

// Motor del juego
export class MemoryGameEngine {
  constructor() {
    this.state = new GameState();
    this.timerInterval = null;
    this.onStateChange = null;
    this.onGameOver = null;
    this.onLevelComplete = null;
    this.onMatch = null;
    this.onMismatch = null;
    this.firebaseHandler = null; // Referencia al handler para limite mensual
  }

  // Establecer referencia al firebase handler
  setFirebaseHandler(handler) {
    this.firebaseHandler = handler;
  }

  // Inicializar nivel
  initLevel(level) {
    const config = LEVELS_CONFIG[level - 1];
    if (!config) {
      console.error('Nivel no encontrado:', level);
      return false;
    }

    this.state.currentLevel = level;
    this.state.score = 0;
    this.state.moves = 0;
    this.state.matchedPairs = 0;
    this.state.streak = 0;
    this.state.timeElapsed = 0;
    this.state.flippedCards = [];
    this.state.matchedCards = [];
    this.state.isPlaying = false;
    this.state.isPaused = false;

    // Generar cartas para este nivel
    this.state.cards = this.generateCards(config.pairs);

    this.notifyStateChange();
    return true;
  }

  // Generar cartas aleatorias
  generateCards(pairs) {
    // Seleccionar tema aleatorio
    const themeKeys = Object.keys(CARD_THEMES);
    const randomTheme = themeKeys[Math.floor(Math.random() * themeKeys.length)];
    const themeEmojis = CARD_THEMES[randomTheme];

    // Seleccionar emojis aleatorios para las parejas
    const shuffledEmojis = [...themeEmojis].sort(() => Math.random() - 0.5);
    const selectedEmojis = shuffledEmojis.slice(0, pairs);

    // Crear parejas de cartas
    const cards = [];
    selectedEmojis.forEach((emoji, index) => {
      // Crear dos cartas con el mismo emoji
      cards.push({
        id: `${index}-a`,
        emoji: emoji,
        pairId: index,
        isFlipped: false,
        isMatched: false
      });
      cards.push({
        id: `${index}-b`,
        emoji: emoji,
        pairId: index,
        isFlipped: false,
        isMatched: false
      });
    });

    // Mezclar cartas
    return cards.sort(() => Math.random() - 0.5);
  }

  // Iniciar juego
  startGame() {
    if (this.state.lives <= 0) {
      console.warn('No hay vidas disponibles');
      return false;
    }

    this.state.isPlaying = true;
    this.state.isPaused = false;
    this.startTimer();
    this.notifyStateChange();
    return true;
  }

  // Pausar juego
  pauseGame() {
    this.state.isPaused = true;
    this.stopTimer();
    this.notifyStateChange();
  }

  // Reanudar juego
  resumeGame() {
    this.state.isPaused = false;
    this.startTimer();
    this.notifyStateChange();
  }

  // Voltear carta
  flipCard(cardId) {
    if (!this.state.isPlaying || this.state.isPaused) return false;
    if (this.state.flippedCards.length >= 2) return false;

    const card = this.state.cards.find(c => c.id === cardId);
    if (!card || card.isFlipped || card.isMatched) return false;

    card.isFlipped = true;
    this.state.flippedCards.push(card);

    if (this.state.flippedCards.length === 2) {
      this.state.moves++;
      this.checkMatch();
    }

    this.notifyStateChange();
    return true;
  }

  // Verificar si hay match
  checkMatch() {
    const [card1, card2] = this.state.flippedCards;

    setTimeout(() => {
      if (card1.pairId === card2.pairId) {
        // Match encontrado
        card1.isMatched = true;
        card2.isMatched = true;
        this.state.matchedCards.push(card1.id, card2.id);
        this.state.matchedPairs++;
        this.state.streak++;

        // Calcular puntos
        const config = LEVELS_CONFIG[this.state.currentLevel - 1];
        let points = 100 * config.scoreMultiplier;
        points += this.state.streak * REWARDS_CONFIG.streakBonus;
        this.state.score += Math.round(points);

        if (this.onMatch) {
          this.onMatch(card1, card2, Math.round(points));
        }

        // Verificar si completó el nivel
        if (this.state.matchedPairs === config.pairs) {
          this.levelComplete();
        }
      } else {
        // No match
        card1.isFlipped = false;
        card2.isFlipped = false;
        this.state.streak = 0;

        if (this.onMismatch) {
          this.onMismatch(card1, card2);
        }
      }

      this.state.flippedCards = [];
      this.notifyStateChange();
    }, 1000);
  }

  // Usar pista
  useHint() {
    if (!this.state.isPlaying || this.state.isPaused) return null;
    if (this.state.hints <= 0) return null;

    // Encontrar una pareja no descubierta
    const unmatchedCards = this.state.cards.filter(c => !c.isMatched && !c.isFlipped);
    if (unmatchedCards.length < 2) return null;

    // Agrupar por pairId
    const pairs = {};
    unmatchedCards.forEach(card => {
      if (!pairs[card.pairId]) {
        pairs[card.pairId] = [];
      }
      pairs[card.pairId].push(card);
    });

    // Encontrar una pareja completa
    const pairIds = Object.keys(pairs);
    for (const pairId of pairIds) {
      if (pairs[pairId].length === 2) {
        this.state.hints--;
        this.state.coins -= 10; // Costo de la pista
        this.notifyStateChange();
        return pairs[pairId];
      }
    }

    return null;
  }

  // Nivel completado
  levelComplete() {
    this.stopTimer();
    this.state.isPlaying = false;

    const config = LEVELS_CONFIG[this.state.currentLevel - 1];
    const result = this.calculateLevelResult(config);

    // Aplicar limite mensual a las monedas
    if (this.firebaseHandler) {
      result.coinsEarned = this.firebaseHandler.applyMonthlyLimit(result.coinsEarned);
      if (result.coinsEarned > 0) this.firebaseHandler.addMonthlyCoins(result.coinsEarned);
    }

    // Guardar progreso del nivel
    this.state.levelProgress[this.state.currentLevel] = {
      stars: result.stars,
      score: result.finalScore,
      moves: this.state.moves,
      time: this.state.timeElapsed,
      completed: true
    };

    // Otorgar recompensas
    this.state.coins += result.coinsEarned;
    this.state.totalScore += result.finalScore;

    if (this.onLevelComplete) {
      this.onLevelComplete(result);
    }
  }

  // Calcular resultado del nivel
  calculateLevelResult(config) {
    let coinsEarned = REWARDS_CONFIG.baseCoinsPerLevel * this.state.currentLevel;
    let bonus = 0;

    // Bonus por tiempo
    const timePercent = this.state.timeElapsed / config.timeLimit;
    if (timePercent < 0.5) {
      bonus += REWARDS_CONFIG.timeBonus.excellent;
    } else if (timePercent < 0.75) {
      bonus += REWARDS_CONFIG.timeBonus.good;
    } else {
      bonus += REWARDS_CONFIG.timeBonus.normal;
    }

    // Bonus por movimientos perfectos
    if (this.state.moves <= config.minMoves) {
      bonus += REWARDS_CONFIG.perfectBonus;
    }

    coinsEarned += bonus;

    // Calcular estrellas
    const maxScore = config.pairs * 100 * config.scoreMultiplier +
                     (config.pairs * REWARDS_CONFIG.streakBonus);
    const scoreRatio = this.state.score / maxScore;

    let stars = 0;
    if (scoreRatio >= REWARDS_CONFIG.starThresholds.three) {
      stars = 3;
    } else if (scoreRatio >= REWARDS_CONFIG.starThresholds.two) {
      stars = 2;
    } else if (scoreRatio >= REWARDS_CONFIG.starThresholds.one) {
      stars = 1;
    }

    return {
      finalScore: this.state.score,
      moves: this.state.moves,
      time: this.state.timeElapsed,
      timeFormatted: this.formatTime(this.state.timeElapsed),
      coinsEarned,
      bonus,
      stars,
      isPerfect: this.state.moves <= config.minMoves
    };
  }

  // Game over (sin vidas o tiempo agotado)
  gameOver(reason = 'time') {
    this.stopTimer();
    this.state.isPlaying = false;
    this.state.lives--;

    // Game over penalty
    const penalty = 15; // Penalty for failing to complete
    const actualPenalty = Math.min(penalty, this.state.coins);
    this.state.coins -= actualPenalty;

    const result = {
      reason,
      score: this.state.score,
      moves: this.state.moves,
      time: this.state.timeElapsed,
      timeFormatted: this.formatTime(this.state.timeElapsed),
      coinsEarned: -actualPenalty,
      penaltyApplied: actualPenalty > 0,
      livesRemaining: this.state.lives
    };

    if (this.onGameOver) {
      this.onGameOver(result);
    }
  }

  // Timer
  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.state.timeElapsed++;

      const config = LEVELS_CONFIG[this.state.currentLevel - 1];
      if (this.state.timeElapsed >= config.timeLimit) {
        this.gameOver('time');
      }

      this.notifyStateChange();
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // Formatear tiempo
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Notificar cambio de estado
  notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  // Obtener estado actual
  getState() {
    const config = LEVELS_CONFIG[this.state.currentLevel - 1];
    return {
      ...this.state,
      config,
      timeRemaining: config ? config.timeLimit - this.state.timeElapsed : 0,
      timeFormatted: this.formatTime(this.state.timeElapsed),
      progress: config ? (this.state.matchedPairs / config.pairs) * 100 : 0
    };
  }

  // Comprar vidas con monedas
  buyLives(amount, cost) {
    if (this.state.coins < cost) {
      return false;
    }
    this.state.coins -= cost;
    this.state.lives += amount;
    this.notifyStateChange();
    return true;
  }

  // Comprar pistas con monedas
  buyHints(amount, cost) {
    if (this.state.coins < cost) {
      return false;
    }
    this.state.coins -= cost;
    this.state.hints += amount;
    this.notifyStateChange();
    return true;
  }

  // Cargar estado guardado
  loadState(savedState) {
    if (savedState) {
      Object.assign(this.state, savedState);
      this.notifyStateChange();
    }
  }

  // Obtener estado para guardar
  getSaveState() {
    return {
      currentLevel: this.state.currentLevel,
      lives: this.state.lives,
      coins: this.state.coins,
      hints: this.state.hints,
      totalScore: this.state.totalScore,
      levelProgress: this.state.levelProgress
    };
  }
}

export default MemoryGameEngine;
