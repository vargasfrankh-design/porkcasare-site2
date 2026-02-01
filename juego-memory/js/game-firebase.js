/**
 * PorkCasare Memory Game - Firebase Handler
 * Integración con Firebase para autenticación y persistencia de datos
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
  updateDoc,
  setDoc,
  collection,
  addDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// Firebase configuration (MUST match main app in src/firebase-config.js)
const firebaseConfig = {
  apiKey: "AIzaSyA" + "jj3AluF19BBbPfafimJoK7SJbdMrvhWY",
  authDomain: "porkcasare-915ff.firebaseapp.com",
  projectId: "porkcasare-915ff",
  storageBucket: "porkcasare-915ff.firebasestorage.app",
  messagingSenderId: "147157887309",
  appId: "1:147157887309:web:5c6db76a20474f172def04",
  measurementId: "G-X0DJ5Y1S6X"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export class GameFirebaseHandler {
  constructor() {
    this.user = null;
    this.userData = null;
    this.onUserReady = null;
    this.onAuthError = null;
  }

  // Iniciar monitoreo de autenticación
  initAuth() {
    return new Promise((resolve, reject) => {
      // Flag to prevent multiple redirects
      let redirecting = false;

      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.user = user;
          try {
            await this.loadUserData();
            if (this.onUserReady) {
              this.onUserReady(this.userData);
            }
            resolve(this.userData);
          } catch (error) {
            console.error('Error loading user data:', error);
            reject(error);
          }
        } else {
          // Usuario no autenticado - redirigir a login silenciosamente
          // No rechazar la promesa ni mostrar error, solo redirigir
          if (!redirecting) {
            redirecting = true;
            console.log('Usuario no autenticado, redirigiendo a login...');
            window.location.href = '/distribuidor-login.html?redirect=/juego-memory/';
          }
          // No llamar a onAuthError ni reject - el redirect maneja todo
        }
      });
    });
  }

  // Cargar datos del usuario
  async loadUserData() {
    if (!this.user) return null;

    const userRef = doc(db, 'usuarios', this.user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      this.userData = {
        uid: this.user.uid,
        ...userSnap.data()
      };

      // Cargar o inicializar datos del juego
      if (!this.userData.gameProgress) {
        this.userData.gameProgress = this.getDefaultGameProgress();
        await this.saveProgress(this.userData.gameProgress);
      }

      return this.userData;
    } else {
      throw new Error('Usuario no encontrado en la base de datos');
    }
  }

  // Progreso por defecto para nuevos jugadores
  getDefaultGameProgress() {
    return {
      currentLevel: 1,
      lives: 5,
      coins: 100, // Monedas iniciales de regalo
      hints: 3,
      totalScore: 0,
      levelProgress: {},
      lastPlayed: new Date().toISOString(),
      gamesPlayed: 0,
      totalPairsMatched: 0
    };
  }

  // Guardar progreso del juego
  async saveProgress(gameState) {
    if (!this.user) return false;

    try {
      const userRef = doc(db, 'usuarios', this.user.uid);
      await updateDoc(userRef, {
        gameProgress: {
          ...gameState,
          lastPlayed: new Date().toISOString()
        }
      });
      console.log('Progreso guardado');
      return true;
    } catch (error) {
      console.error('Error guardando progreso:', error);
      return false;
    }
  }

  // Registrar compra en el juego (para monetización futura)
  async logGamePurchase(purchaseData) {
    if (!this.user) return null;

    try {
      const purchaseRef = collection(db, 'game_purchases');
      const docRef = await addDoc(purchaseRef, {
        userId: this.user.uid,
        userName: this.userData?.usuario || 'Usuario',
        ...purchaseData,
        timestamp: serverTimestamp(),
        createdAt: new Date().toISOString()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error registrando compra:', error);
      return null;
    }
  }

  // Registrar logro desbloqueado
  async logAchievement(achievementData) {
    if (!this.user) return null;

    try {
      const achievementRef = collection(db, 'game_achievements');
      const docRef = await addDoc(achievementRef, {
        userId: this.user.uid,
        userName: this.userData?.usuario || 'Usuario',
        ...achievementData,
        timestamp: serverTimestamp()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error registrando logro:', error);
      return null;
    }
  }

  // Obtener ranking global (futuro)
  async getLeaderboard(limit = 10) {
    // Implementación futura para torneos
    return [];
  }

  // Obtener información del patrocinador para distribución de ingresos
  async getSponsorChain() {
    if (!this.userData || !this.userData.patrocinador) {
      return [];
    }

    const chain = [];
    let currentSponsor = this.userData.patrocinador;
    let level = 0;
    const maxLevels = 5;

    while (currentSponsor && level < maxLevels) {
      const sponsorQuery = await this.findUserByUsername(currentSponsor);
      if (sponsorQuery) {
        chain.push({
          level: level + 1,
          username: sponsorQuery.usuario,
          uid: sponsorQuery.uid
        });
        currentSponsor = sponsorQuery.patrocinador;
        level++;
      } else {
        break;
      }
    }

    return chain;
  }

  // Buscar usuario por username
  async findUserByUsername(username) {
    if (!username) return null;

    try {
      const usersRef = collection(db, 'usuarios');
      const q = query(usersRef, where('usuario', '==', username), limit(1));
      const snap = await getDocs(q);

      if (!snap.empty) {
        const doc = snap.docs[0];
        return {
          uid: doc.id,
          ...doc.data()
        };
      }
      return null;
    } catch (error) {
      console.error('Error buscando usuario:', error);
      return null;
    }
  }

  // Getters
  getUser() {
    return this.user;
  }

  getUserData() {
    return this.userData;
  }

  getGameProgress() {
    return this.userData?.gameProgress || this.getDefaultGameProgress();
  }
}

// Import query helpers for findUserByUsername
import { query, where, limit, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export { auth, db };
export default GameFirebaseHandler;
