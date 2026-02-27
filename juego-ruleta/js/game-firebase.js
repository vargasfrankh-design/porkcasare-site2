/**
 * PorkCasare Rueda de la Fortuna - Firebase Handler
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyA" + "jj3AluF19BBbPfafimJoK7SJbdMrvhWY",
  authDomain: "porkcasare-915ff.firebaseapp.com",
  projectId: "porkcasare-915ff",
  storageBucket: "porkcasare-915ff.firebasestorage.app",
  messagingSenderId: "147157887309",
  appId: "1:147157887309:web:5c6db76a20474f172def04",
  measurementId: "G-X0DJ5Y1S6X"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Configuracion del limite mensual de monedas (limite interno real: 20,000 por usuario)
const MONTHLY_COINS_LIMIT = 20000;

export class GameFirebaseHandler {
  constructor() {
    this.user = null;
    this.userData = null;
    this.onUserReady = null;
    this.monthlyCoinsEarned = 0;
    this.currentMonth = '';
  }

  initAuth() {
    return new Promise((resolve, reject) => {
      let redirecting = false;
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.user = user;
          try {
            await this.loadUserData();
            if (this.onUserReady) this.onUserReady(this.userData);
            resolve(this.userData);
          } catch (error) {
            console.error('Error loading user data:', error);
            reject(error);
          }
        } else {
          if (!redirecting) {
            redirecting = true;
            window.location.href = '/distribuidor-login.html?redirect=/juego-ruleta/';
          }
        }
      });
    });
  }

  async loadUserData() {
    if (!this.user) return null;
    const userRef = doc(db, 'usuarios', this.user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      this.userData = { uid: this.user.uid, ...userSnap.data() };
      if (!this.userData.wheelProgress) {
        this.userData.wheelProgress = this.getDefaultProgress();
        await this.saveProgress(this.userData.wheelProgress);
      }
      // Cargar tracker mensual
      this.loadMonthlyTracker();
      return this.userData;
    } else {
      throw new Error('Usuario no encontrado en la base de datos');
    }
  }

  loadMonthlyTracker() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.currentMonth = currentMonth;

    const tracker = this.userData.monthlyCoinsTracker;
    if (tracker && tracker.month === currentMonth) {
      this.monthlyCoinsEarned = tracker.totalCoinsEarned || 0;
    } else {
      this.monthlyCoinsEarned = 0;
    }
  }

  getRewardMultiplier() {
    const progress = this.monthlyCoinsEarned / MONTHLY_COINS_LIMIT;
    if (progress >= 1.0) return 0;
    if (progress >= 0.8) return 0.15;
    if (progress >= 0.6) return 0.30;
    if (progress >= 0.4) return 0.50;
    if (progress >= 0.2) return 0.75;
    return 1.0;
  }

  applyMonthlyLimit(rawCoins) {
    const multiplier = this.getRewardMultiplier();
    if (multiplier === 0) return 0;
    const adjusted = Math.floor(rawCoins * multiplier);
    const remaining = MONTHLY_COINS_LIMIT - this.monthlyCoinsEarned;
    return Math.min(adjusted, Math.max(0, remaining));
  }

  addMonthlyCoins(coins) {
    this.monthlyCoinsEarned += coins;
  }

  // Validar monedas con el backend (enforcing del límite real de 20,000)
  async validateCoinsWithBackend(coins, gameType, level) {
    if (!this.user) return { approved: false, coinsApproved: 0 };
    try {
      const token = await this.user.getIdToken();
      const res = await fetch('/.netlify/functions/check-monthly-coins-limit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'earn',
          coins: coins,
          gameType: gameType || 'ruleta',
          level: level || 0
        })
      });
      if (!res.ok) return { approved: false, coinsApproved: 0 };
      const data = await res.json();
      if (data.blocked) {
        this.monthlyCoinsEarned = data.limit;
      } else if (data.totalEarned !== undefined) {
        this.monthlyCoinsEarned = data.totalEarned;
      }
      return data;
    } catch (err) {
      console.error('Error validando monedas con backend:', err);
      return { approved: true, coinsApproved: coins };
    }
  }

  getMonthlyInfo() {
    return {
      earned: this.monthlyCoinsEarned,
      limit: MONTHLY_COINS_LIMIT,
      multiplier: this.getRewardMultiplier(),
      progress: Math.min(1, this.monthlyCoinsEarned / MONTHLY_COINS_LIMIT),
      remaining: Math.max(0, MONTHLY_COINS_LIMIT - this.monthlyCoinsEarned)
    };
  }

  getDefaultProgress() {
    return {
      coins: 50,
      spinsRemaining: 3,
      spinsUsedToday: 0,
      totalSpins: 0,
      totalWon: 0,
      bestPrize: 0,
      lastSpinDate: null,
      prizeHistory: [],
      pendingMultiplier: 1
    };
  }

  async saveProgress(gameState) {
    if (!this.user) return false;
    try {
      const userRef = doc(db, 'usuarios', this.user.uid);
      await updateDoc(userRef, {
        wheelProgress: {
          ...gameState,
          lastSaved: new Date().toISOString()
        },
        monthlyCoinsTracker: {
          month: this.currentMonth,
          totalCoinsEarned: this.monthlyCoinsEarned,
          limit: MONTHLY_COINS_LIMIT,
          lastUpdated: new Date().toISOString()
        }
      });
      return true;
    } catch (error) {
      console.error('Error guardando progreso:', error);
      return false;
    }
  }

  getUser() { return this.user; }
  getUserData() { return this.userData; }
  getGameProgress() { return this.userData?.wheelProgress || this.getDefaultProgress(); }
}

export { auth, db };
export default GameFirebaseHandler;
