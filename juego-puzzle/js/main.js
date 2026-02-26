/**
 * PorkCasare Puzzle - Main Entry Point
 */

import { PuzzleGameEngine } from './game-engine.js';
import { PuzzleUI } from './game-ui.js';
import { GameFirebaseHandler } from './game-firebase.js';

const gameEngine = new PuzzleGameEngine();
const firebaseHandler = new GameFirebaseHandler();
gameEngine.setFirebaseHandler(firebaseHandler);
let gameUI = null;

async function init() {
  console.log('Inicializando PorkCasare Puzzle...');

  try {
    firebaseHandler.onUserReady = (userData) => {
      console.log('Usuario autenticado:', userData.usuario || userData.email);
      if (userData.puzzleProgress) {
        gameEngine.loadState(userData.puzzleProgress);
      }
    };

    const userData = await firebaseHandler.initAuth();
    gameUI = new PuzzleUI(gameEngine, firebaseHandler);
    await gameUI.initializeUI(userData);

    console.log('Puzzle inicializado correctamente');
  } catch (error) {
    console.error('Error inicializando puzzle:', error);
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'error',
        title: 'Error al cargar',
        text: 'No se pudo cargar el puzzle. Por favor, inicia sesion nuevamente.',
        confirmButtonText: 'Ir a inicio de sesion'
      }).then(() => {
        window.location.href = '/distribuidor-login.html';
      });
    } else {
      window.location.href = '/distribuidor-login.html';
    }
  }
}

setInterval(() => {
  if (gameEngine.state.isPlaying && firebaseHandler.getUser()) {
    firebaseHandler.saveProgress(gameEngine.getSaveState());
  }
}, 30000);

window.addEventListener('beforeunload', () => {
  if (firebaseHandler.getUser()) {
    console.log('Guardando progreso de puzzle al salir...');
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.PorkCasarePuzzle = { engine: gameEngine, firebase: firebaseHandler, getUI: () => gameUI };
