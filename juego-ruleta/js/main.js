/**
 * PorkCasare Rueda de la Fortuna - Main Entry Point
 */

import { WheelGameEngine } from './game-engine.js';
import { WheelUI } from './game-ui.js';
import { GameFirebaseHandler } from './game-firebase.js';

const gameEngine = new WheelGameEngine();
const firebaseHandler = new GameFirebaseHandler();
gameEngine.setFirebaseHandler(firebaseHandler);
let gameUI = null;

async function init() {
  console.log('Inicializando Rueda de la Fortuna...');

  try {
    const userData = await firebaseHandler.initAuth();
    gameUI = new WheelUI(gameEngine, firebaseHandler);
    await gameUI.initializeUI(userData);

    console.log('Rueda de la Fortuna inicializada correctamente');
  } catch (error) {
    console.error('Error inicializando ruleta:', error);
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'error',
        title: 'Error al cargar',
        text: 'No se pudo cargar la ruleta. Por favor, inicia sesion nuevamente.',
        confirmButtonText: 'Ir a inicio de sesion'
      }).then(() => {
        window.location.href = '/distribuidor-login.html';
      });
    } else {
      window.location.href = '/distribuidor-login.html';
    }
  }
}

// Save progress periodically
setInterval(() => {
  if (firebaseHandler.getUser()) {
    firebaseHandler.saveProgress(gameEngine.getSaveState());
  }
}, 60000);

window.addEventListener('beforeunload', () => {
  if (firebaseHandler.getUser()) {
    console.log('Guardando progreso de ruleta al salir...');
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.PorkCasareWheel = { engine: gameEngine, firebase: firebaseHandler, getUI: () => gameUI };
