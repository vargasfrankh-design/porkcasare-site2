/**
 * PorkCasare Trivia - Main Entry Point
 */

import { TriviaGameEngine } from './game-engine.js';
import { TriviaUI } from './game-ui.js';
import { GameFirebaseHandler } from './game-firebase.js';

const gameEngine = new TriviaGameEngine();
const firebaseHandler = new GameFirebaseHandler();
gameEngine.setFirebaseHandler(firebaseHandler);
let gameUI = null;

async function init() {
  console.log('&#x2753; Inicializando PorkCasare Trivia...');

  try {
    firebaseHandler.onUserReady = (userData) => {
      console.log('Usuario autenticado:', userData.usuario || userData.email);
      if (userData.triviaProgress) {
        gameEngine.loadState(userData.triviaProgress);
      }
    };

    const userData = await firebaseHandler.initAuth();
    gameUI = new TriviaUI(gameEngine, firebaseHandler);
    await gameUI.initializeUI(userData);

    console.log('Trivia inicializada correctamente');
  } catch (error) {
    console.error('Error inicializando trivia:', error);
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'error',
        title: 'Error al cargar',
        text: 'No se pudo cargar la trivia. Por favor, inicia sesion nuevamente.',
        confirmButtonText: 'Ir a inicio de sesion'
      }).then(() => {
        window.location.href = '/distribuidor-login.html';
      });
    } else {
      window.location.href = '/distribuidor-login.html';
    }
  }
}

// Auto-save cada 30 segundos
setInterval(() => {
  if (gameEngine.state.isPlaying && firebaseHandler.getUser()) {
    firebaseHandler.saveProgress(gameEngine.getSaveState());
  }
}, 30000);

window.addEventListener('beforeunload', () => {
  if (firebaseHandler.getUser()) {
    console.log('Guardando progreso de trivia al salir...');
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.PorkCasareTrivia = { engine: gameEngine, firebase: firebaseHandler, getUI: () => gameUI };
