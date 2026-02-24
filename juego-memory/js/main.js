/**
 * PorkCasare Memory Game - Main Entry Point
 * Punto de entrada principal que inicializa todos los componentes
 */

import { MemoryGameEngine } from './game-engine.js';
import { GameUI } from './game-ui.js';
import { GameFirebaseHandler } from './game-firebase.js';

// Instancias principales
const gameEngine = new MemoryGameEngine();
const firebaseHandler = new GameFirebaseHandler();
gameEngine.setFirebaseHandler(firebaseHandler);
let gameUI = null;

// Inicialización
async function init() {
  console.log('🎮 Inicializando PorkCasare Memory Game...');

  try {
    // Configurar callback para cuando el usuario esté listo
    firebaseHandler.onUserReady = (userData) => {
      console.log('✅ Usuario autenticado:', userData.usuario || userData.email);

      // Cargar progreso guardado si existe
      if (userData.gameProgress) {
        gameEngine.loadState(userData.gameProgress);
      }
    };

    // Configurar callback para error de auth
    firebaseHandler.onAuthError = (error) => {
      console.error('❌ Error de autenticación:', error);
    };

    // Iniciar autenticación y esperar datos del usuario
    const userData = await firebaseHandler.initAuth();

    // Crear UI después de tener los datos
    gameUI = new GameUI(gameEngine, firebaseHandler);

    // Inicializar UI con datos del usuario
    await gameUI.initializeUI(userData);

    // Inicializar primer nivel
    gameEngine.initLevel(userData.gameProgress?.currentLevel || 1);

    console.log('✅ Juego inicializado correctamente');

  } catch (error) {
    console.error('❌ Error inicializando juego:', error);

    // Mostrar error al usuario
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'error',
        title: 'Error al cargar',
        text: 'No se pudo cargar el juego. Por favor, inicia sesión nuevamente.',
        confirmButtonText: 'Ir a inicio de sesión'
      }).then(() => {
        window.location.href = '/distribuidor-login.html';
      });
    } else {
      alert('Error al cargar el juego. Por favor, inicia sesión nuevamente.');
      window.location.href = '/distribuidor-login.html';
    }
  }
}

// Auto-save cada 30 segundos si está jugando
setInterval(() => {
  if (gameEngine.state.isPlaying && firebaseHandler.getUser()) {
    firebaseHandler.saveProgress(gameEngine.getSaveState());
  }
}, 30000);

// Guardar al salir de la página
window.addEventListener('beforeunload', () => {
  if (firebaseHandler.getUser()) {
    // Usar sendBeacon para guardar de forma asíncrona
    const saveData = gameEngine.getSaveState();
    const userData = firebaseHandler.getUserData();
    if (userData) {
      // El save real se hace via Firebase SDK, pero al menos logueamos
      console.log('Guardando progreso al salir...', saveData);
    }
  }
});

// Manejar visibilidad de la página (pausar si se cambia de pestaña)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && gameEngine.state.isPlaying && !gameEngine.state.isPaused) {
    gameEngine.pauseGame();
    if (gameUI) {
      gameUI.openModal('pauseModal');
    }
  }
});

// Prevenir zoom accidental en móviles
document.addEventListener('gesturestart', (e) => {
  e.preventDefault();
});

// Iniciar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Exportar para debugging
window.PorkCasareMemory = {
  engine: gameEngine,
  firebase: firebaseHandler,
  getUI: () => gameUI
};
