/**
 * PorkCasare Rueda de la Fortuna - Game Engine
 */

// Segmentos de la rueda
export const WHEEL_SEGMENTS = [
  { label: '10', value: 10, type: 'coins', color: '#3498db', icon: '&#x1FA99;', probability: 20 },
  { label: '25', value: 25, type: 'coins', color: '#27ae60', icon: '&#x1FA99;', probability: 18 },
  { label: '50', value: 50, type: 'coins', color: '#f39c12', icon: '&#x1FA99;', probability: 15 },
  { label: '100', value: 100, type: 'coins', color: '#e74c3c', icon: '&#x1FA99;', probability: 10 },
  { label: 'x2', value: 2, type: 'multiplier', color: '#9b59b6', icon: '&#x1F680;', probability: 8 },
  { label: '200', value: 200, type: 'coins', color: '#1abc9c', icon: '&#x1F4B0;', probability: 5 },
  { label: '+1 Giro', value: 1, type: 'spin', color: '#e67e22', icon: '&#x1F3B0;', probability: 10 },
  { label: '5', value: 5, type: 'coins', color: '#95a5a6', icon: '&#x1FA99;', probability: 14 }
];

export const GAME_CONFIG = {
  freeSpinsPerDay: 3,
  extraSpinCost: 20, // monedas
  spinDuration: 4000, // milisegundos
  minRotations: 5,    // rotaciones minimas
  maxRotations: 8     // rotaciones maximas
};

export class WheelGameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.coins = 0;
    this.spinsRemaining = GAME_CONFIG.freeSpinsPerDay;
    this.spinsUsedToday = 0;
    this.totalSpins = 0;
    this.totalWon = 0;
    this.bestPrize = 0;
    this.isSpinning = false;
    this.lastSpinDate = null;
    this.prizeHistory = [];
    this.pendingMultiplier = 1;
  }
}

export class WheelGameEngine {
  constructor() {
    this.state = new WheelGameState();
    this.onStateChange = null;
    this.onSpinComplete = null;
    this.onSpinStart = null;
    this.firebaseHandler = null; // Referencia al handler para limite mensual
  }

  // Establecer referencia al firebase handler
  setFirebaseHandler(handler) {
    this.firebaseHandler = handler;
  }

  // Verificar y resetear giros diarios
  checkDailyReset() {
    const today = new Date().toDateString();
    if (this.state.lastSpinDate !== today) {
      this.state.spinsRemaining = GAME_CONFIG.freeSpinsPerDay;
      this.state.spinsUsedToday = 0;
      this.state.lastSpinDate = today;
      this.state.pendingMultiplier = 1;
      this.notifyStateChange();
    }
  }

  // Puede girar?
  canSpin() {
    if (this.state.isSpinning) return false;
    if (this.state.spinsRemaining > 0) return true;
    if (this.state.coins >= GAME_CONFIG.extraSpinCost) return true;
    return false;
  }

  // Costo del giro actual
  getSpinCost() {
    return this.state.spinsRemaining > 0 ? 0 : GAME_CONFIG.extraSpinCost;
  }

  // Girar la rueda
  spin() {
    if (!this.canSpin()) return null;

    // Cobrar si es necesario
    const cost = this.getSpinCost();
    if (cost > 0) {
      this.state.coins -= cost;
    } else {
      this.state.spinsRemaining--;
    }

    this.state.isSpinning = true;
    this.state.spinsUsedToday++;
    this.state.totalSpins++;

    // Determinar resultado basado en probabilidades
    const segment = this.getWeightedRandom();

    // Determinar indice del segmento ganador
    const segmentIndex = WHEEL_SEGMENTS.indexOf(segment);

    if (this.onSpinStart) {
      this.onSpinStart(segmentIndex, GAME_CONFIG.spinDuration);
    }

    this.notifyStateChange();

    // Programar resultado
    return new Promise((resolve) => {
      setTimeout(() => {
        this.state.isSpinning = false;
        const prize = this.applyPrize(segment);
        resolve(prize);
      }, GAME_CONFIG.spinDuration + 500);
    });
  }

  // Seleccion ponderada aleatoria
  getWeightedRandom() {
    const totalWeight = WHEEL_SEGMENTS.reduce((sum, s) => sum + s.probability, 0);
    let random = Math.random() * totalWeight;

    for (const segment of WHEEL_SEGMENTS) {
      random -= segment.probability;
      if (random <= 0) return segment;
    }
    return WHEEL_SEGMENTS[0];
  }

  // Aplicar premio
  applyPrize(segment) {
    let prizeValue = segment.value;
    let prizeDisplay = '';
    let prizeType = segment.type;
    let appliedMultiplier = 1;

    switch (segment.type) {
      case 'coins':
        appliedMultiplier = this.state.pendingMultiplier;
        let rawCoins = segment.value * appliedMultiplier;
        // Aplicar limite mensual a las monedas
        if (this.firebaseHandler) {
          prizeValue = this.firebaseHandler.applyMonthlyLimit(rawCoins);
          if (prizeValue > 0) this.firebaseHandler.addMonthlyCoins(prizeValue);
        } else {
          prizeValue = rawCoins;
        }
        this.state.coins += prizeValue;
        this.state.totalWon += prizeValue;
        if (prizeValue > this.state.bestPrize) {
          this.state.bestPrize = prizeValue;
        }
        prizeDisplay = appliedMultiplier > 1
          ? `+${prizeValue} monedas (x${appliedMultiplier})`
          : `+${prizeValue} monedas`;
        this.state.pendingMultiplier = 1;
        break;

      case 'multiplier':
        this.state.pendingMultiplier *= segment.value;
        prizeDisplay = `Multiplicador x${this.state.pendingMultiplier}`;
        break;

      case 'spin':
        this.state.spinsRemaining += segment.value;
        prizeDisplay = `+${segment.value} giro gratis`;
        break;
    }

    const prizeRecord = {
      type: prizeType,
      segment: { ...segment },
      value: prizeValue,
      display: prizeDisplay,
      multiplier: appliedMultiplier,
      timestamp: new Date().toISOString()
    };

    this.state.prizeHistory.unshift(prizeRecord);
    if (this.state.prizeHistory.length > 10) {
      this.state.prizeHistory = this.state.prizeHistory.slice(0, 10);
    }

    if (this.onSpinComplete) {
      this.onSpinComplete(prizeRecord);
    }

    this.notifyStateChange();
    return prizeRecord;
  }

  notifyStateChange() {
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  getState() {
    return {
      ...this.state,
      canSpin: this.canSpin(),
      spinCost: this.getSpinCost()
    };
  }

  loadState(savedState) {
    if (savedState) {
      this.state.coins = savedState.coins ?? 0;
      this.state.spinsRemaining = savedState.spinsRemaining ?? GAME_CONFIG.freeSpinsPerDay;
      this.state.spinsUsedToday = savedState.spinsUsedToday ?? 0;
      this.state.totalSpins = savedState.totalSpins ?? 0;
      this.state.totalWon = savedState.totalWon ?? 0;
      this.state.bestPrize = savedState.bestPrize ?? 0;
      this.state.lastSpinDate = savedState.lastSpinDate ?? null;
      this.state.prizeHistory = savedState.prizeHistory ?? [];
      this.state.pendingMultiplier = savedState.pendingMultiplier ?? 1;
      this.checkDailyReset();
      this.notifyStateChange();
    }
  }

  getSaveState() {
    return {
      coins: this.state.coins,
      spinsRemaining: this.state.spinsRemaining,
      spinsUsedToday: this.state.spinsUsedToday,
      totalSpins: this.state.totalSpins,
      totalWon: this.state.totalWon,
      bestPrize: this.state.bestPrize,
      lastSpinDate: this.state.lastSpinDate,
      prizeHistory: this.state.prizeHistory.slice(0, 10),
      pendingMultiplier: this.state.pendingMultiplier
    };
  }
}

export default WheelGameEngine;
