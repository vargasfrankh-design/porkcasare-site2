/**
 * PorkCasare Puzzle - Game Engine
 * Motor del juego de rompecabezas deslizante (sliding puzzle)
 */

// Configuracion de niveles
export const LEVELS_CONFIG = [
  { level: 1, gridSize: 3, timeLimit: 120, minMoves: 20, scoreMultiplier: 1.0 },
  { level: 2, gridSize: 3, timeLimit: 100, minMoves: 25, scoreMultiplier: 1.2 },
  { level: 3, gridSize: 3, timeLimit: 80,  minMoves: 30, scoreMultiplier: 1.5 },
  { level: 4, gridSize: 4, timeLimit: 180, minMoves: 40, scoreMultiplier: 1.8 },
  { level: 5, gridSize: 4, timeLimit: 150, minMoves: 50, scoreMultiplier: 2.0 },
  { level: 6, gridSize: 4, timeLimit: 120, minMoves: 60, scoreMultiplier: 2.3 },
  { level: 7, gridSize: 5, timeLimit: 240, minMoves: 80, scoreMultiplier: 2.5 },
  { level: 8, gridSize: 5, timeLimit: 200, minMoves: 100, scoreMultiplier: 2.8 },
  { level: 9, gridSize: 5, timeLimit: 180, minMoves: 120, scoreMultiplier: 3.0 },
  { level: 10, gridSize: 6, timeLimit: 300, minMoves: 150, scoreMultiplier: 3.5 }
];

// Imagenes para puzzles (emojis como mosaicos de colores)
export const PUZZLE_IMAGES = [
  { id: 'cerdo', name: 'Cerdo PorkCasare', emoji: '&#x1F437;', bgColor: '#FFB6C1', colors: ['#FF69B4','#FFB6C1','#FF1493','#DB7093','#FFC0CB','#FF85A2','#FF6B81','#E75480','#FF4081'] },
  { id: 'carne', name: 'Cortes de Carne', emoji: '&#x1F969;', bgColor: '#CD5C5C', colors: ['#8B0000','#B22222','#DC143C','#CD5C5C','#F08080','#FA8072','#E9967A','#FFA07A','#FF6347'] },
  { id: 'cocina', name: 'Chef en Accion', emoji: '&#x1F468;&#x200D;&#x1F373;', bgColor: '#F0E68C', colors: ['#FFD700','#FFA500','#FF8C00','#F0E68C','#BDB76B','#DAA520','#B8860B','#CD853F','#DEB887'] },
  { id: 'frutas', name: 'Frutas Frescas', emoji: '&#x1F34E;', bgColor: '#90EE90', colors: ['#00FF00','#32CD32','#228B22','#90EE90','#98FB98','#00FA9A','#3CB371','#2E8B57','#66CDAA'] },
  { id: 'tienda', name: 'Nuestra Tienda', emoji: '&#x1F3EA;', bgColor: '#87CEEB', colors: ['#4169E1','#6495ED','#4682B4','#87CEEB','#ADD8E6','#B0C4DE','#5F9EA0','#00CED1','#48D1CC'] },
  { id: 'trofeo', name: 'Campeon', emoji: '&#x1F3C6;', bgColor: '#FFD700', colors: ['#FFD700','#FFA500','#FF8C00','#DAA520','#B8860B','#CD853F','#D2691E','#8B4513','#A0522D'] }
];

// Recompensas
export const REWARDS_CONFIG = {
  baseCoinsPerLevel: 15,
  perfectBonus: 40,
  timeBonus: { excellent: 25, good: 15, normal: 5 },
  starThresholds: { one: 0.5, two: 0.75, three: 0.95 }
};

export class PuzzleGameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.currentLevel = 1;
    this.score = 0;
    this.moves = 0;
    this.lives = 5;
    this.coins = 0;
    this.hints = 3;
    this.timeElapsed = 0;
    this.isPlaying = false;
    this.tiles = [];
    this.emptyIndex = -1;
    this.gridSize = 3;
    this.selectedImage = null;
    this.totalScore = 0;
    this.levelProgress = {};
  }
}

export class PuzzleGameEngine {
  constructor() {
    this.state = new PuzzleGameState();
    this.timerInterval = null;
    this.onStateChange = null;
    this.onLevelComplete = null;
    this.onGameOver = null;
    this.onTileMove = null;
    this.firebaseHandler = null; // Referencia al handler para limite mensual
  }

  // Establecer referencia al firebase handler
  setFirebaseHandler(handler) {
    this.firebaseHandler = handler;
  }

  // Inicializar nivel
  initLevel(level, imageId) {
    const config = LEVELS_CONFIG[level - 1];
    if (!config) return false;

    const image = PUZZLE_IMAGES.find(img => img.id === imageId);
    if (!image) return false;

    this.state.currentLevel = level;
    this.state.gridSize = config.gridSize;
    this.state.selectedImage = image;
    this.state.moves = 0;
    this.state.score = 0;
    this.state.timeElapsed = 0;
    this.state.isPlaying = false;

    // Generar tablero
    this.generateBoard(config.gridSize);

    this.notifyStateChange();
    return true;
  }

  // Generar tablero mezclado
  generateBoard(size) {
    const totalTiles = size * size;
    // Crear tiles en orden: 0 a totalTiles-2 son piezas, totalTiles-1 es vacio
    const tiles = [];
    for (let i = 0; i < totalTiles - 1; i++) {
      tiles.push(i);
    }
    tiles.push(-1); // Espacio vacio

    // Mezclar de forma solucionable
    this.state.tiles = this.shuffleSolvable(tiles, size);
    this.state.emptyIndex = this.state.tiles.indexOf(-1);
  }

  // Mezclar asegurando que sea solucionable
  shuffleSolvable(tiles, size) {
    let shuffled;
    do {
      shuffled = [...tiles];
      // Fisher-Yates shuffle
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
    } while (!this.isSolvable(shuffled, size) || this.isSolved(shuffled));

    return shuffled;
  }

  // Verificar si el puzzle es solucionable
  isSolvable(tiles, size) {
    let inversions = 0;
    const filtered = tiles.filter(t => t !== -1);

    for (let i = 0; i < filtered.length; i++) {
      for (let j = i + 1; j < filtered.length; j++) {
        if (filtered[i] > filtered[j]) inversions++;
      }
    }

    if (size % 2 === 1) {
      return inversions % 2 === 0;
    } else {
      const emptyRow = Math.floor(tiles.indexOf(-1) / size);
      const fromBottom = size - emptyRow;
      return (fromBottom % 2 === 0) === (inversions % 2 === 1);
    }
  }

  // Verificar si esta resuelto
  isSolved(tiles) {
    for (let i = 0; i < tiles.length - 1; i++) {
      if (tiles[i] !== i) return false;
    }
    return true;
  }

  // Iniciar juego
  startGame() {
    if (this.state.lives <= 0) return false;
    this.state.isPlaying = true;
    this.startTimer();
    this.notifyStateChange();
    return true;
  }

  // Mover tile
  moveTile(tileIndex) {
    if (!this.state.isPlaying) return false;

    const emptyIdx = this.state.emptyIndex;
    const size = this.state.gridSize;

    // Verificar si el tile es adyacente al espacio vacio
    const tileRow = Math.floor(tileIndex / size);
    const tileCol = tileIndex % size;
    const emptyRow = Math.floor(emptyIdx / size);
    const emptyCol = emptyIdx % size;

    const isAdjacent =
      (Math.abs(tileRow - emptyRow) === 1 && tileCol === emptyCol) ||
      (Math.abs(tileCol - emptyCol) === 1 && tileRow === emptyRow);

    if (!isAdjacent) return false;

    // Intercambiar tile con espacio vacio
    [this.state.tiles[tileIndex], this.state.tiles[emptyIdx]] =
      [this.state.tiles[emptyIdx], this.state.tiles[tileIndex]];
    this.state.emptyIndex = tileIndex;
    this.state.moves++;

    if (this.onTileMove) {
      this.onTileMove(tileIndex, emptyIdx);
    }

    // Verificar si se completo
    if (this.isSolved(this.state.tiles)) {
      this.levelComplete();
    }

    this.notifyStateChange();
    return true;
  }

  // Usar pista - colocar una pieza en su posicion correcta
  useHint() {
    if (!this.state.isPlaying || this.state.hints <= 0) return false;
    if (this.state.coins < 10) return false;

    // Encontrar una pieza fuera de posicion
    for (let i = 0; i < this.state.tiles.length; i++) {
      if (this.state.tiles[i] !== -1 && this.state.tiles[i] !== i) {
        // Encontrar donde esta esta pieza
        const correctTileValue = i;
        const currentPosOfCorrectTile = this.state.tiles.indexOf(correctTileValue);

        // Mover la pieza correcta y la vacia para resolver esa posicion
        // Simplificado: resaltamos la posicion correcta
        this.state.hints--;
        this.state.coins -= 10;
        this.notifyStateChange();
        return { tileValue: correctTileValue, currentPos: currentPosOfCorrectTile, correctPos: i };
      }
    }
    return false;
  }

  // Nivel completado
  levelComplete() {
    this.stopTimer();
    this.state.isPlaying = false;

    const config = LEVELS_CONFIG[this.state.currentLevel - 1];
    const result = this.calculateResult(config);

    // Aplicar limite mensual a las monedas
    let limitedCoins = result.coinsEarned;
    if (this.firebaseHandler) {
      limitedCoins = this.firebaseHandler.applyMonthlyLimit(result.coinsEarned);
      if (limitedCoins > 0) this.firebaseHandler.addMonthlyCoins(limitedCoins);
    }
    result.coinsEarned = limitedCoins;

    this.state.levelProgress[this.state.currentLevel] = {
      stars: result.stars,
      score: result.score,
      moves: this.state.moves,
      time: this.state.timeElapsed,
      completed: true
    };

    this.state.coins += result.coinsEarned;
    this.state.totalScore += result.score;

    if (this.onLevelComplete) {
      this.onLevelComplete(result);
    }
  }

  calculateResult(config) {
    const maxMoves = config.minMoves * 3;
    const moveEfficiency = Math.max(0, 1 - (this.state.moves - config.minMoves) / (maxMoves - config.minMoves));
    const timeEfficiency = Math.max(0, 1 - this.state.timeElapsed / config.timeLimit);
    const overallEfficiency = (moveEfficiency * 0.6 + timeEfficiency * 0.4);

    const score = Math.round(1000 * config.scoreMultiplier * overallEfficiency);
    let coinsEarned = REWARDS_CONFIG.baseCoinsPerLevel * this.state.currentLevel;

    // Time bonus
    const timePercent = this.state.timeElapsed / config.timeLimit;
    if (timePercent < 0.5) coinsEarned += REWARDS_CONFIG.timeBonus.excellent;
    else if (timePercent < 0.75) coinsEarned += REWARDS_CONFIG.timeBonus.good;
    else coinsEarned += REWARDS_CONFIG.timeBonus.normal;

    // Perfect bonus
    if (this.state.moves <= config.minMoves * 1.5) {
      coinsEarned += REWARDS_CONFIG.perfectBonus;
    }

    let stars = 0;
    if (overallEfficiency >= REWARDS_CONFIG.starThresholds.three) stars = 3;
    else if (overallEfficiency >= REWARDS_CONFIG.starThresholds.two) stars = 2;
    else if (overallEfficiency >= REWARDS_CONFIG.starThresholds.one) stars = 1;

    return {
      score,
      moves: this.state.moves,
      time: this.state.timeElapsed,
      timeFormatted: this.formatTime(this.state.timeElapsed),
      coinsEarned,
      stars,
      efficiency: overallEfficiency
    };
  }

  // Game over (tiempo agotado)
  gameOver() {
    this.stopTimer();
    this.state.isPlaying = false;
    this.state.lives--;

    // Penalty for failing to complete the puzzle
    const penalty = 10;
    const actualPenalty = Math.min(penalty, this.state.coins);
    this.state.coins -= actualPenalty;

    if (this.onGameOver) {
      this.onGameOver({
        score: 0,
        moves: this.state.moves,
        time: this.state.timeElapsed,
        timeFormatted: this.formatTime(this.state.timeElapsed),
        coinsEarned: -actualPenalty,
        penaltyApplied: actualPenalty > 0,
        livesRemaining: this.state.lives
      });
    }
  }

  // Timer
  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.state.timeElapsed++;
      const config = LEVELS_CONFIG[this.state.currentLevel - 1];
      if (this.state.timeElapsed >= config.timeLimit) {
        this.gameOver();
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

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  notifyStateChange() {
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  getState() {
    const config = LEVELS_CONFIG[this.state.currentLevel - 1];
    return {
      ...this.state,
      config,
      timeRemaining: config ? config.timeLimit - this.state.timeElapsed : 0,
      timeFormatted: this.formatTime(this.state.timeElapsed)
    };
  }

  loadState(savedState) {
    if (savedState) {
      this.state.lives = savedState.lives ?? 5;
      this.state.coins = savedState.coins ?? 0;
      this.state.hints = savedState.hints ?? 3;
      this.state.totalScore = savedState.totalScore ?? 0;
      this.state.levelProgress = savedState.levelProgress ?? {};
      this.state.currentLevel = savedState.currentLevel ?? 1;
      this.notifyStateChange();
    }
  }

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

export default PuzzleGameEngine;
