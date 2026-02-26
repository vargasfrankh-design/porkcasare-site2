/**
 * PorkCasare Rueda de la Fortuna - UI Controller
 */

import { WHEEL_SEGMENTS, GAME_CONFIG } from './game-engine.js';

const elements = {
  navCoins: document.getElementById('navCoins'),
  navSpins: document.getElementById('navSpins'),
  navTotalWins: document.getElementById('navTotalWins'),
  playerAvatar: document.getElementById('playerAvatar'),
  playerName: document.getElementById('playerName'),
  playerRank: document.getElementById('playerRank'),
  spinsToday: document.getElementById('spinsToday'),
  bestPrize: document.getElementById('bestPrize'),
  totalWon: document.getElementById('totalWon'),
  wheelCanvas: document.getElementById('wheelCanvas'),
  wheelInner: document.getElementById('wheelInner'),
  btnSpin: document.getElementById('btnSpin'),
  spinCost: document.getElementById('spinCost'),
  spinsRemaining: document.getElementById('spinsRemaining'),
  spinsInfo: document.getElementById('spinsInfo'),
  prizeHistory: document.getElementById('prizeHistory'),
  // Prize modal
  prizeModal: document.getElementById('prizeModal'),
  prizeTitle: document.getElementById('prizeTitle'),
  prizeIconLarge: document.getElementById('prizeIconLarge'),
  prizeAmount: document.getElementById('prizeAmount'),
  prizeLabel: document.getElementById('prizeLabel'),
  prizeMessage: document.getElementById('prizeMessage'),
  btnClaimPrize: document.getElementById('btnClaimPrize'),
  btnSpinAgain: document.getElementById('btnSpinAgain'),
  multiplierBadge: document.getElementById('multiplierBadge'),
  loadingOverlay: document.getElementById('game-loading-overlay')
};

export class WheelUI {
  constructor(gameEngine, firebaseHandler) {
    this.engine = gameEngine;
    this.firebase = firebaseHandler;
    this.currentRotation = 0;

    this.drawWheel();
    this.setupEventListeners();
    this.setupEngineCallbacks();
  }

  drawWheel() {
    const canvas = elements.wheelCanvas;
    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2 - 5;
    const segments = WHEEL_SEGMENTS;
    const segmentAngle = (2 * Math.PI) / segments.length;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    segments.forEach((segment, index) => {
      const startAngle = index * segmentAngle - Math.PI / 2;
      const endAngle = startAngle + segmentAngle;

      // Draw segment
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = segment.color;
      ctx.fill();

      // Segment border
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw text
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(startAngle + segmentAngle / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px Inter, system-ui, sans-serif';
      ctx.fillText(segment.label, radius * 0.65, 0);

      ctx.restore();
    });

    // Inner circle decoration
    ctx.beginPath();
    ctx.arc(centerX, centerY, 30, 0, 2 * Math.PI);
    ctx.fillStyle = '#1a1c20';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  setupEventListeners() {
    elements.btnSpin.addEventListener('click', () => this.handleSpin());

    elements.btnClaimPrize.addEventListener('click', () => {
      this.closeModal('prizeModal');
    });

    elements.btnSpinAgain.addEventListener('click', () => {
      this.closeModal('prizeModal');
      setTimeout(() => this.handleSpin(), 300);
    });

    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal.id);
      });
    });
  }

  setupEngineCallbacks() {
    this.engine.onStateChange = (state) => this.updateUI(state);

    this.engine.onSpinStart = (angle, duration) => {
      this.animateWheel(angle, duration);
    };

    this.engine.onSpinComplete = (prize) => {
      this.showPrize(prize);
      this.updateMonthlyProgress();
      this.firebase.saveProgress(this.engine.getSaveState());
    };
  }

  async handleSpin() {
    const state = this.engine.getState();

    if (state.isSpinning) return;

    if (!state.canSpin) {
      Swal.fire({
        icon: 'warning',
        title: 'Sin giros disponibles',
        text: `Necesitas ${GAME_CONFIG.extraSpinCost} monedas para un giro extra, o espera hasta manana para giros gratis.`,
        confirmButtonText: 'Entendido'
      });
      return;
    }

    elements.btnSpin.disabled = true;
    elements.btnSpin.classList.add('spinning');

    await this.engine.spin();

    elements.btnSpin.disabled = false;
    elements.btnSpin.classList.remove('spinning');
  }

  animateWheel(segmentIndex, duration) {
    const numSegments = WHEEL_SEGMENTS.length;
    const segmentAngle = 360 / numSegments;
    const segmentCenterDeg = segmentIndex * segmentAngle + segmentAngle / 2;
    const targetInCircle = (360 - segmentCenterDeg + 360) % 360;
    const currentInCircle = ((this.currentRotation % 360) + 360) % 360;
    let delta = targetInCircle - currentInCircle;
    if (delta <= 0) delta += 360;
    const fullRotations = (GAME_CONFIG.minRotations + Math.floor(Math.random() * (GAME_CONFIG.maxRotations - GAME_CONFIG.minRotations + 1))) * 360;
    const newAngle = this.currentRotation + fullRotations + delta;

    elements.wheelInner.style.transition = `transform ${duration}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)`;
    this.currentRotation = newAngle;
    elements.wheelInner.style.transform = `rotate(${newAngle}deg)`;
  }

  showPrize(prize) {
    let title = 'Felicidades!';
    let icon = '&#x1FA99;';
    let amount = '';
    let label = '';
    let message = '';

    switch (prize.type) {
      case 'coins':
        icon = prize.value >= 100 ? '&#x1F4B0;' : '&#x1FA99;';
        amount = `+${prize.value}`;
        label = 'Monedas';
        message = prize.value >= 100 ? 'Un premio increible!' : 'Buen giro!';
        if (prize.multiplier > 1) {
          message = `Multiplicador x${prize.multiplier} aplicado!`;
        }
        break;
      case 'multiplier':
        title = 'Multiplicador!';
        icon = '&#x1F680;';
        amount = `x${prize.value}`;
        label = 'Multiplicador';
        message = 'Tu proximo premio de monedas sera multiplicado!';
        break;
      case 'spin':
        title = 'Giro Extra!';
        icon = '&#x1F3B0;';
        amount = `+${prize.value}`;
        label = 'Giro Gratis';
        message = 'Has ganado un giro adicional!';
        break;
    }

    elements.prizeTitle.textContent = title;
    elements.prizeIconLarge.innerHTML = icon;
    elements.prizeAmount.textContent = amount;
    elements.prizeLabel.textContent = label;
    elements.prizeMessage.textContent = message;

    // Show/hide spin again button
    const canSpin = this.engine.canSpin();
    elements.btnSpinAgain.style.display = canSpin ? 'inline-flex' : 'none';

    this.openModal('prizeModal');
    this.renderPrizeHistory();
  }

  renderPrizeHistory() {
    const history = this.engine.state.prizeHistory;

    if (history.length === 0) {
      elements.prizeHistory.innerHTML = '<div class="history-empty">Gira la rueda para ganar premios</div>';
      return;
    }

    elements.prizeHistory.innerHTML = '';
    history.forEach(prize => {
      const item = document.createElement('div');
      item.className = 'history-item';

      const segColor = prize.segment.color;
      item.innerHTML = `
        <div class="history-icon" style="background: ${segColor};">${prize.segment.icon}</div>
        <div class="history-details">
          <span class="history-prize">${prize.display}</span>
          <span class="history-time">${this.formatTimeAgo(prize.timestamp)}</span>
        </div>
      `;
      elements.prizeHistory.appendChild(item);
    });
  }

  formatTimeAgo(timestamp) {
    const now = new Date();
    const then = new Date(timestamp);
    const diff = Math.floor((now - then) / 1000);

    if (diff < 60) return 'Hace un momento';
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} horas`;
    return `Hace ${Math.floor(diff / 86400)} dias`;
  }

  updateUI(state) {
    elements.navCoins.textContent = state.coins;
    elements.navSpins.textContent = state.spinsRemaining;
    elements.navTotalWins.textContent = state.totalWon;

    elements.spinsToday.textContent = state.spinsUsedToday;
    elements.bestPrize.textContent = state.bestPrize;
    elements.totalWon.textContent = state.totalWon;

    elements.spinsRemaining.textContent = state.spinsRemaining;

    // Update spin button
    if (state.isSpinning) {
      elements.btnSpin.disabled = true;
      elements.spinCost.textContent = 'Girando...';
    } else if (state.spinsRemaining > 0) {
      elements.btnSpin.disabled = false;
      elements.spinCost.textContent = 'Gratis';
    } else if (state.coins >= GAME_CONFIG.extraSpinCost) {
      elements.btnSpin.disabled = false;
      elements.spinCost.textContent = `${GAME_CONFIG.extraSpinCost} monedas`;
    } else {
      elements.btnSpin.disabled = true;
      elements.spinCost.textContent = 'Sin giros';
    }

    // Multiplier indicator
    if (elements.multiplierBadge) {
      if (state.pendingMultiplier > 1) {
        elements.multiplierBadge.textContent = `x${state.pendingMultiplier} activo!`;
        elements.multiplierBadge.style.display = '';
      } else {
        elements.multiplierBadge.style.display = 'none';
      }
    }
  }

  async initializeUI(userData) {
    if (userData) {
      elements.playerName.textContent = userData.usuario || userData.nombre || 'Jugador';
      if (userData.avatar) elements.playerAvatar.src = userData.avatar;
      if (userData.wheelProgress) {
        this.engine.loadState(userData.wheelProgress);
      }
    }
    this.engine.checkDailyReset();
    this.updateUI(this.engine.getState());
    this.renderPrizeHistory();
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

export default WheelUI;
