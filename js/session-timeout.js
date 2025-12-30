// session-timeout.js
// Cierre automático de sesión por inactividad
// Tiempo de inactividad: 1.5 minutos (90 segundos)

import { auth } from "/src/firebase-config.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// Configuración
const INACTIVITY_TIMEOUT_MS = 90000; // 1.5 minutos = 90 segundos = 90000 ms
const WARNING_BEFORE_LOGOUT_MS = 15000; // Mostrar advertencia 15 segundos antes

// Variables de control
let inactivityTimer = null;
let warningTimer = null;
let isUserLoggedIn = false;
let warningShown = false;

// Función para cerrar sesión
async function performLogout() {
  console.log('🔒 Cerrando sesión por inactividad...');
  try {
    // Limpiar listeners de comisiones si existen
    if (typeof window.cleanupListeners === 'function') {
      window.cleanupListeners();
    }

    await signOut(auth);

    // Mostrar mensaje si SweetAlert está disponible
    if (window.Swal) {
      await Swal.fire({
        title: 'Sesión cerrada',
        text: 'Tu sesión ha sido cerrada por inactividad.',
        icon: 'info',
        confirmButtonText: 'Entendido',
        timer: 5000,
        timerProgressBar: true
      });
    } else {
      alert('Tu sesión ha sido cerrada por inactividad.');
    }

    // Redirigir al login
    window.location.href = 'distribuidor-login.html';
  } catch (error) {
    console.error('Error al cerrar sesión:', error);
    window.location.href = 'distribuidor-login.html';
  }
}

// Función para mostrar advertencia de cierre de sesión
function showInactivityWarning() {
  if (warningShown || !isUserLoggedIn) return;
  warningShown = true;

  console.log('⚠️ Mostrando advertencia de inactividad...');

  if (window.Swal) {
    Swal.fire({
      title: 'Sesión por expirar',
      html: 'Tu sesión se cerrará en <strong>15 segundos</strong> por inactividad.<br>Mueve el mouse o presiona una tecla para continuar.',
      icon: 'warning',
      showConfirmButton: true,
      confirmButtonText: 'Continuar sesión',
      timer: WARNING_BEFORE_LOGOUT_MS,
      timerProgressBar: true,
      allowOutsideClick: true,
      allowEscapeKey: true
    }).then((result) => {
      warningShown = false;
      if (result.isConfirmed || result.dismiss === Swal.DismissReason.timer) {
        // Si el usuario interactuó, resetear el timer
        // Si expiró el timer, la función performLogout ya se habrá ejecutado
      }
    });
  }
}

// Función para resetear el temporizador de inactividad
function resetInactivityTimer() {
  // Ocultar advertencia si está visible
  if (warningShown && window.Swal) {
    Swal.close();
    warningShown = false;
  }

  // Solo resetear si el usuario está logueado
  if (!isUserLoggedIn) return;

  // Limpiar timers existentes
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }
  if (warningTimer) {
    clearTimeout(warningTimer);
  }

  // Configurar timer de advertencia (se muestra 15 segundos antes del logout)
  warningTimer = setTimeout(() => {
    showInactivityWarning();
  }, INACTIVITY_TIMEOUT_MS - WARNING_BEFORE_LOGOUT_MS);

  // Configurar timer de logout
  inactivityTimer = setTimeout(() => {
    performLogout();
  }, INACTIVITY_TIMEOUT_MS);
}

// Función para iniciar el monitoreo de inactividad
function startInactivityMonitoring() {
  // Eventos que indican actividad del usuario
  const activityEvents = [
    'mousedown',
    'mousemove',
    'keydown',
    'keypress',
    'scroll',
    'touchstart',
    'touchmove',
    'click',
    'wheel'
  ];

  // Agregar listeners para cada evento de actividad
  activityEvents.forEach(eventType => {
    document.addEventListener(eventType, resetInactivityTimer, { passive: true });
  });

  // También resetear cuando la ventana recupera el foco
  window.addEventListener('focus', resetInactivityTimer);

  // Iniciar el primer temporizador
  resetInactivityTimer();

  console.log(`🕐 Monitoreo de inactividad iniciado (timeout: ${INACTIVITY_TIMEOUT_MS / 1000}s)`);
}

// Función para detener el monitoreo de inactividad
function stopInactivityMonitoring() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (warningTimer) {
    clearTimeout(warningTimer);
    warningTimer = null;
  }

  // Cerrar advertencia si está visible
  if (warningShown && window.Swal) {
    Swal.close();
    warningShown = false;
  }

  console.log('🕐 Monitoreo de inactividad detenido');
}

// Escuchar cambios de autenticación
onAuthStateChanged(auth, (user) => {
  if (user) {
    // Usuario logueado - iniciar monitoreo
    isUserLoggedIn = true;
    startInactivityMonitoring();
  } else {
    // Usuario no logueado - detener monitoreo
    isUserLoggedIn = false;
    stopInactivityMonitoring();
  }
});

// Exportar funciones para uso externo si es necesario
export {
  resetInactivityTimer,
  startInactivityMonitoring,
  stopInactivityMonitoring,
  INACTIVITY_TIMEOUT_MS
};
