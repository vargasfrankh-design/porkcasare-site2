// comisiones_reparado_both_styled.js
// Versión con estilos diferenciados y manejo de puntos grupales.
// Reemplaza tu JS anterior por este.
// Ajusta la ruta a firebase-config.js si es necesaria.

console.log("comisiones_reparado_both_styled.js cargado");

import {
  doc, collection, addDoc, serverTimestamp, arrayUnion,
  onSnapshot, query, orderBy, limit, runTransaction, updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { auth, db } from "/src/firebase-config.js"; // ajustar ruta si es distinto

// DOM elements — ajusta IDs a tu HTML
const elTotal = document.getElementById("totalCommissions");
const elComisionesCobradas = document.getElementById("totalComisionesCobradas");
const elPending = document.getElementById("pendingCommissions");
const elWallet = document.getElementById("walletBalance");
const elGroupPoints = document.getElementById("groupPoints"); // elemento que mostrará puntos grupales
const btnCobrar = document.getElementById("btnCobrar");
const historyEl = document.getElementById("history");

// Inject CSS styles for entries
(function injectStyles(){
  const css = `
  /* Contenedor general de historial */
  #history { font-family: Inter, Roboto, Arial, sans-serif; }
  .entry { padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,0.06); display: flex; flex-direction: column; gap:6px; }
  .entry .amount { font-size: 16px; }
  .entry .meta { color: #6b7280; font-size: 13px; }
  .entry.history-field { background: #ffffff; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 1px 0 rgba(0,0,0,0.02); }
  .entry.transactions-collection { background: transparent; }
  .entry.withdraw .amount { color: #166534; } /* green-700 */
  .entry.earning .amount { color: #111827; }
  .entry .source { color: #9ca3af; font-size: 12px; margin-left: 8px; }
  .entry .bold-name { font-weight: 700; }

  /* Badge de notificación para comisiones del mes */
  .comision-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 12px;
    margin-left: 8px;
    white-space: nowrap;
    position: relative;
    overflow: hidden;
  }
  /* Estado INACTIVO: color rojizo actual */
  .comision-badge.inactive {
    background: linear-gradient(135deg, #ff6b35, #f44336);
    color: #fff;
    box-shadow: 0 2px 6px rgba(244, 67, 54, 0.35);
    animation: badge-pulse 2s ease-in-out infinite;
  }
  /* Estado ACTIVO: color verde clarito con animación de $ */
  .comision-badge.active {
    background: linear-gradient(135deg, #a8e6cf, #56c596);
    color: #1b5e20;
    box-shadow: 0 2px 6px rgba(86, 197, 150, 0.4);
    animation: badge-pulse-active 2s ease-in-out infinite;
  }
  .comision-badge.hidden { display: none; }
  @keyframes badge-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }
  @keyframes badge-pulse-active {
    0%, 100% { transform: scale(1); box-shadow: 0 2px 6px rgba(86, 197, 150, 0.4); }
    50% { transform: scale(1.03); box-shadow: 0 3px 10px rgba(86, 197, 150, 0.5); }
  }
  /* Animación sutil de signos $ para usuarios activos */
  .comision-badge.active::before {
    content: '$';
    position: absolute;
    font-size: 9px;
    opacity: 0;
    animation: float-dollar 3s ease-in-out infinite;
    left: 5px;
    top: -2px;
    color: #2e7d32;
  }
  .comision-badge.active::after {
    content: '$';
    position: absolute;
    font-size: 8px;
    opacity: 0;
    animation: float-dollar 3s ease-in-out 1.5s infinite;
    right: 8px;
    top: -3px;
    color: #388e3c;
  }
  @keyframes float-dollar {
    0% { opacity: 0; transform: translateY(8px) scale(0.6); }
    20% { opacity: 0.7; transform: translateY(2px) scale(0.9); }
    40% { opacity: 0.4; transform: translateY(-5px) scale(0.7); }
    60% { opacity: 0; transform: translateY(-12px) scale(0.5); }
    100% { opacity: 0; transform: translateY(-15px) scale(0.4); }
  }
  /* Mensaje de advertencia para usuarios inactivos */
  .comision-warning {
    display: block;
    font-size: 9px;
    color: #e53935;
    font-weight: 600;
    margin-top: 2px;
    animation: warning-blink 2.5s ease-in-out infinite;
  }
  .comision-warning.hidden { display: none; }
  @keyframes warning-blink {
    0%, 100% { opacity: 0.8; }
    50% { opacity: 1; }
  }
  /* Wrapper para posicionar el badge */
  .comision-label-wrapper {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
  `;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
})();

// Función para calcular comisiones del mes en curso
function calculateCurrentMonthCommissions(historyArray) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  let monthlyTotal = 0;

  if (!Array.isArray(historyArray)) return 0;

  for (const entry of historyArray) {
    // Solo contar entradas tipo earning (comisiones ganadas)
    const entryType = entry.type || '';
    const isEarning = entryType === 'earning' || entryType === 'group_points' || entryType === 'quick_start_bonus' || entryType === 'quick_start_upper_level';

    if (!isEarning) continue;

    // Obtener timestamp de la entrada
    let entryDate = null;
    if (entry.timestamp) {
      if (typeof entry.timestamp === 'number') {
        entryDate = new Date(entry.timestamp);
      } else if (entry.timestamp && typeof entry.timestamp.toDate === 'function') {
        entryDate = entry.timestamp.toDate();
      } else if (entry.timestamp && typeof entry.timestamp.seconds === 'number') {
        entryDate = new Date(entry.timestamp.seconds * 1000);
      } else if (typeof entry.timestamp === 'string') {
        entryDate = new Date(entry.timestamp);
      }
    } else if (entry.date) {
      entryDate = new Date(entry.date);
    } else if (entry.originMs) {
      entryDate = new Date(Number(entry.originMs));
    }

    if (!entryDate || isNaN(entryDate.getTime())) continue;

    // Verificar si es del mes actual
    if (entryDate.getMonth() === currentMonth && entryDate.getFullYear() === currentYear) {
      monthlyTotal += Number(entry.amount ?? 0);
    }
  }

  return monthlyTotal;
}

// Función para verificar si el usuario está activo en el mes actual
// Un usuario está ACTIVO solo si acumuló 10 o más puntos personales dentro del mismo mes calendario.
// Esta validación se reinicia automáticamente al inicio de cada nuevo mes.
const MONTHLY_ACTIVATION_POINTS_THRESHOLD = 10;

function getMonthlyPersonalPointsFromHistory(historyArray) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  if (!Array.isArray(historyArray)) return 0;

  let monthlyPersonalPoints = 0;

  for (const entry of historyArray) {
    const entryType = entry.type || '';
    const action = (entry.action || '').toLowerCase();
    const isPurchase = entryType === 'purchase' ||
                       (entry.orderId && entry.action && entry.action.includes('Compra')) ||
                       (entry.meta && entry.meta.action && entry.meta.action.includes('compra'));

    if (!isPurchase) continue;

    // Obtener timestamp de la entrada
    let entryDate = null;
    if (entry.timestamp) {
      if (typeof entry.timestamp === 'number') {
        entryDate = new Date(entry.timestamp);
      } else if (entry.timestamp && typeof entry.timestamp.toDate === 'function') {
        entryDate = entry.timestamp.toDate();
      } else if (entry.timestamp && typeof entry.timestamp.seconds === 'number') {
        entryDate = new Date(entry.timestamp.seconds * 1000);
      } else if (typeof entry.timestamp === 'string') {
        entryDate = new Date(entry.timestamp);
      }
    } else if (entry.date) {
      entryDate = new Date(entry.date);
    } else if (entry.originMs) {
      entryDate = new Date(Number(entry.originMs));
    }

    if (!entryDate || isNaN(entryDate.getTime())) continue;

    // Verificar si es del mes actual
    if (entryDate.getMonth() === currentMonth && entryDate.getFullYear() === currentYear) {
      const points = Number(entry.points || entry.puntos || 0);
      monthlyPersonalPoints += points;
    }
  }

  return monthlyPersonalPoints;
}

function checkUserActiveThisMonth(historyArray, userData) {
  // Calcular puntos personales acumulados en el mes actual
  const monthlyPoints = getMonthlyPersonalPointsFromHistory(historyArray);

  // El usuario está activo solo si acumuló 10 o más puntos en el mes
  return monthlyPoints >= MONTHLY_ACTIVATION_POINTS_THRESHOLD;
}

// Función para verificar si estamos en la última semana del mes
function isLastWeekOfMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const currentDay = now.getDate();

  // Obtener el último día del mes
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  // La última semana es cuando faltan 7 días o menos para terminar el mes
  const daysUntilEndOfMonth = lastDayOfMonth - currentDay;
  return daysUntilEndOfMonth < 7;
}

// Función para actualizar o crear el badge de comisiones del mes
// isActive: true si el usuario tiene actividad (puntos personales) en el mes actual
// El badge solo se muestra en la última semana del mes
function updateMonthlyCommissionBadge(monthlyAmount, isActive = false) {
  // Buscar el elemento "Comisiones por cobrar"
  const porCobrarLabel = document.querySelector('.comision-item.por-cobrar .comision-label');
  if (!porCobrarLabel) return;

  // Solo mostrar el badge en la última semana del mes
  const showBadge = isLastWeekOfMonth();

  // Verificar si ya existe un wrapper
  let wrapper = porCobrarLabel.querySelector('.comision-label-wrapper');
  if (!wrapper) {
    // Crear wrapper y mover el texto dentro
    wrapper = document.createElement('span');
    wrapper.className = 'comision-label-wrapper';
    const labelText = porCobrarLabel.textContent;
    porCobrarLabel.textContent = '';
    const textSpan = document.createElement('span');
    textSpan.textContent = labelText;
    wrapper.appendChild(textSpan);
    porCobrarLabel.appendChild(wrapper);
  }

  // Buscar o crear el badge
  let badge = wrapper.querySelector('.comision-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'comision-badge';
    wrapper.appendChild(badge);
  }

  // Buscar o crear el mensaje de advertencia para usuarios inactivos
  let warningMsg = porCobrarLabel.querySelector('.comision-warning');
  if (!warningMsg) {
    warningMsg = document.createElement('span');
    warningMsg.className = 'comision-warning hidden';
    warningMsg.textContent = '¡Actívate, o perderás estas comisiones!';
    porCobrarLabel.appendChild(warningMsg);
  }

  // Actualizar contenido del badge
  if (monthlyAmount > 0 && showBadge) {
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const now = new Date();
    const monthName = monthNames[now.getMonth()];
    badge.textContent = `${monthName}: ${formatCurrency(monthlyAmount)}`;
    badge.classList.remove('hidden');

    // Aplicar estilo según estado activo/inactivo
    if (isActive) {
      badge.classList.add('active');
      badge.classList.remove('inactive');
      warningMsg.classList.add('hidden');
    } else {
      badge.classList.add('inactive');
      badge.classList.remove('active');
      warningMsg.classList.remove('hidden');
    }
  } else {
    badge.classList.add('hidden');
    warningMsg.classList.add('hidden');
  }
}

// Utilidades
function formatCurrency(amount = 0) {
  try {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
      .format(Number(amount));
  } catch {
    return "$" + Number(amount).toLocaleString();
  }
}

// ---- Manejo combinado de historiales ----
let unsubscribeUserDoc = null;
let unsubscribeTxs = null;

let userHistoryArray = []; // entries desde usuarios/{uid}.history (campo array)
let txDocsArray = [];      // entries desde usuarios/{uid}/transactions (subcolección)

// Intenta detectar y poner en negrilla el nombre de usuario dentro de la descripción.
// Estrategia:
// 1) Si existe entry.meta.byName o entry.meta.by, lo usa.
// 2) Si no, busca patrones comunes: "por compra de NAME", "Por NAME", "de NAME", "por compra: NAME".
// 3) Si no encuentra, aplica heurística de palabras capitalizadas.
function highlightNameInText(text, entry) {
  if (!text || typeof text !== 'string') return text || '';
  // 1) meta.byName or meta.by
  const byName = entry.meta && (entry.meta.byName || entry.meta.by);
  if (byName && typeof byName === 'string') {
    // replace exact occurrence(s)
    const nameEsc = escapeRegExp(byName.trim());
    return text.replace(new RegExp('(' + nameEsc + ')', 'g'), '<span class="bold-name">$1</span>');
  }

  // 2) common patterns
  // pattern: "por compra de NAME" or "por compra: NAME"
  const patterns = [
    /por compra de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i,
    /Por ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/,
    /de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      return text.replace(m[1], `<span class="bold-name">${m[1]}</span>`);
    }
  }

  // 3) fallback: bold first capitalized token sequence (heurística)
  const cap = text.match(/([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/);
  if (cap && cap[1]) {
    return text.replace(cap[1], `<span class="bold-name">${cap[1]}</span>`);
  }
  return text;
}

function escapeRegExp(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normaliza entrada a formato común
function normalizeEntry(entry, source, docId = null) {
  let ts = entry.timestamp ?? entry.date ?? null;
  if (ts && typeof ts.toDate === "function") {
    ts = ts.toDate();
  } else if (ts && typeof ts.seconds === "number") {
    ts = new Date(ts.seconds * 1000);
  } else if (typeof ts === "string" || typeof ts === "number") {
    ts = new Date(ts);
  } else {
    ts = new Date();
  }

  // Prefer explicit IDs if present (earningId, withdrawId), then docId from transactions collection,
  // otherwise fallback to timestamp-based id for history entries.
  let id = null;
  if (entry && entry.earningId) {
    id = `e_${entry.earningId}`;
  } else if (entry && entry.withdrawId) {
    id = `w_${entry.withdrawId}`;
  } else if (docId) {
    id = `tx_${docId}`;
  } else {
    id = `h_${ts.getTime()}_${entry.type || 'x'}_${entry.amount ?? 0}`;
  }

  return {
    _id: id,
    source,
    type: entry.type || "unknown",
    amount: Number(entry.amount ?? 0),
    ts,
    meta: entry.meta || {},
    note: entry.note || entry.action || "",
    points: entry.points ?? entry.pointsUsed ?? null,
    raw: entry
  };
}


function buildCombinedList() {
  const all = [];
  userHistoryArray.forEach(e => all.push(normalizeEntry(e, "historyField", null)));
  txDocsArray.forEach(e => all.push(normalizeEntry(e.data, "transactionsCollection", e.id)));

  // Deduplicate by _id
  const map = new Map();
  for (const it of all) map.set(it._id, it);
  const merged = Array.from(map.values());

  // Sort desc by timestamp
  merged.sort((a, b) => b.ts - a.ts);
  return merged;
}

function renderCombinedHistory() {
  const merged = buildCombinedList();
  if (!historyEl) return;
  if (!merged.length) {
    historyEl.innerHTML = '<div class="history-empty">No hay transacciones aún.</div>';
    return;
  }

  historyEl.innerHTML = merged.map(entry => {
    const when = entry.ts.toLocaleString();
    // For withdraws, show PLUS sign and green style; for earnings show normal
    const isWithdraw = entry.type === "withdraw";
    const isEarning = entry.type === "earning";
    const sign = isWithdraw ? '+' : (isEarning ? '' : '');
    const amountHTML = `<div class="amount ${entry.type}">${sign} ${formatCurrency(entry.amount)}</div>`;

    // Description: try highlight name
    const rawNote = entry.note || (entry.meta && entry.meta.action) || entry.type;
    const noteWithBold = highlightNameInText(rawNote, entry);

    const containerClass = entry.source === "historyField" ? 'entry history-field' : 'entry transactions-collection';
    const typeClass = entry.type === "withdraw" ? " withdraw" : (entry.type === "earning" ? " earning income" : "");

    return `
      <div class="${containerClass}${typeClass}" data-id="${entry._id}">
        ${amountHTML}
        <div class="meta">${when} • ${noteWithBold} <span class="source">(${entry.source})</span></div>
      </div>
    `;
  }).join("");
}

// Función para limpiar todos los listeners activos
function cleanupListeners() {
  if (unsubscribeUserDoc) {
    try { unsubscribeUserDoc(); } catch (e) { console.warn('Error al desuscribir userDoc:', e); }
    unsubscribeUserDoc = null;
  }
  if (unsubscribeTxs) {
    try { unsubscribeTxs(); } catch (e) { console.warn('Error al desuscribir txs:', e); }
    unsubscribeTxs = null;
  }
  console.log('🔄 Listeners de Firebase desuscriptos correctamente');
}

// Limpieza de listeners al cerrar la página o cuando cambia la visibilidad
window.addEventListener('beforeunload', cleanupListeners);
window.addEventListener('pagehide', cleanupListeners);

// Optimización: NO reconectar automáticamente al volver a la pestaña
// Esto evita lecturas excesivas. El usuario puede recargar manualmente si necesita datos frescos.
// Se mantiene el cleanup al ocultar para liberar recursos.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    console.log('📋 Pestaña oculta - pausando listeners');
    cleanupListeners();
  }
  // Eliminado: reconexión automática al volver visible
  // Los datos se cargarán en el próximo inicio de sesión o recarga de página
});

// Attach listeners para ambas fuentes
function attachRealtimeForUserBoth(uid) {
  if (!uid) return;

  // Limpiar listeners existentes antes de crear nuevos
  cleanupListeners();

const uRef = doc(db, "usuarios", uid);
  unsubscribeUserDoc = onSnapshot(uRef, async (snap) => {
    const data = snap.exists() ? snap.data() : {};
    // guardar snapshot para que listeners usen la fuente de verdad
    window.__lastUserData = data;
    if (Array.isArray(data.history)) {
      userHistoryArray = data.history.slice();
    } else {
      userHistoryArray = [];
    }

    // Actualiza balances visibles si existen
    if (elPending) elPending.textContent = formatCurrency(Number(data.balance ?? 0));
    // Actualizar estado del botón Cobrar: verificar balance, si es Master, y mínimo 20,000 pesos
    try {
      const pendingAmountNumber = Number(data.balance ?? 0);
      const personalPoints = Number(data.personalPoints ?? data.puntos ?? 0);
      const isMaster = !data.patrocinador || data.patrocinador === '' || data.patrocinador === null;
      const canWithdraw = isMaster || personalPoints >= 50;
      const MIN_WITHDRAW_AMOUNT = 20000; // Mínimo 20,000 pesos para cobrar
      const meetsMinimum = pendingAmountNumber >= MIN_WITHDRAW_AMOUNT;

      if (btnCobrar) {
        if (pendingAmountNumber > 0 && canWithdraw && meetsMinimum) {
          btnCobrar.removeAttribute('title');
          btnCobrar.disabled = false;
        } else if (pendingAmountNumber > 0 && !canWithdraw) {
          btnCobrar.setAttribute('title', 'Solo los Masters o distribuidores con 50+ puntos personales pueden cobrar');
          btnCobrar.disabled = true;
        } else if (pendingAmountNumber > 0 && !meetsMinimum) {
          btnCobrar.setAttribute('title', `El monto mínimo para cobrar es ${formatCurrency(MIN_WITHDRAW_AMOUNT)}`);
          btnCobrar.disabled = true;
        } else {
          btnCobrar.setAttribute('title', 'No tienes comisiones por cobrar');
          btnCobrar.disabled = true;
        }
      }
    } catch (e) { console.warn('Error actualizando estado de btnCobrar', e); }

    if (elTotal) elTotal.textContent = formatCurrency(Number(data.totalComisiones ?? data.totalCommissions ?? 0));
    if (elComisionesCobradas) elComisionesCobradas.textContent = formatCurrency(Number(data.totalComisionesCobradas ?? 0));
    if (elWallet) elWallet.textContent = formatCurrency(Number(data.walletBalance ?? 0));
    // Round group points to remove excessive decimals (max 2 decimal places)
    const groupPointsRaw = Number(data.groupPoints !== undefined ? data.groupPoints : (data.puntosGrupales !== undefined ? data.puntosGrupales : 0));
    const groupPointsRounded = Math.round(groupPointsRaw * 100) / 100;
    if (elGroupPoints) elGroupPoints.textContent = String(groupPointsRounded);

    renderCombinedHistory();

    // Actualizar badge de comisiones del mes actual
    try {
      const monthlyCommissions = calculateCurrentMonthCommissions(userHistoryArray);
      const isUserActiveThisMonth = checkUserActiveThisMonth(userHistoryArray, data);
      updateMonthlyCommissionBadge(monthlyCommissions, isUserActiveThisMonth);
    } catch (e) { console.warn('Error actualizando badge de comisiones mensuales', e); }

    // --- Actualización automática de puntos grupales basada en el historial ---
    // Este proceso se ejecuta automáticamente cada vez que se actualiza el documento del usuario
    // y calcula los puntos comisionables disponibles SIN mezclar los ya cobrados
    try {
      const consumedAt = data.groupPointsConsumedAt ? (data.groupPointsConsumedAt.toMillis ? data.groupPointsConsumedAt.toMillis() : (typeof data.groupPointsConsumedAt === 'number' ? data.groupPointsConsumedAt : null)) : null;
      let computedGroupPoints = 0;

      if (Array.isArray(userHistoryArray)) {
        for (const e of userHistoryArray) {
          const entryType = e.type || '';
          const isWithdraw = entryType === 'withdraw';
          const isPurchase = entryType === 'purchase' || (!entryType && e.orderId && e.action && e.action.includes('Compra'));

          const isCommission = entryType === 'group_points' || entryType === 'quick_start_bonus' || entryType === 'quick_start_upper_level' || entryType === 'earning';

          if (isPurchase) continue;

          // Use the correct field based on entry type:
          // - For withdrawals: use pointsUsed (points that were deducted)
          // - For commissions: use points (points that were earned)
          let pts = 0;
          if (isWithdraw) {
            pts = e.pointsUsed ? Number(e.pointsUsed) : 0;
          } else if (isCommission) {
            pts = e.points ? Number(e.points) : 0;
          }

          if (!pts || pts <= 0) continue;

          let entryTs = null;
          if (e.originMs !== undefined && e.originMs !== null) {
            entryTs = Number(e.originMs);
          } else if (e.timestamp !== undefined && e.timestamp !== null) {
            if (typeof e.timestamp === 'number') entryTs = Number(e.timestamp);
            else if (e.timestamp && typeof e.timestamp.getTime === 'function') entryTs = e.timestamp.getTime();
            else if (typeof e.timestamp === 'string') {
              const parsed = Date.parse(e.timestamp);
              if (!isNaN(parsed)) entryTs = parsed;
            }
          } else if (e.date !== undefined && e.date !== null) {
            const parsed = Date.parse(e.date);
            if (!isNaN(parsed)) entryTs = parsed;
          }

          if (consumedAt) {
            if (entryTs && entryTs > consumedAt) {
              if (isWithdraw) {
                computedGroupPoints -= pts;
              } else if (isCommission) {
                computedGroupPoints += pts;
              }
            }
          } else {
            if (isWithdraw) {
              computedGroupPoints -= pts;
            } else if (isCommission) {
              computedGroupPoints += pts;
            }
          }
        }
      }
      
      computedGroupPoints = Math.max(0, computedGroupPoints);

      const dbGroupPoints = Number(data.groupPoints ?? data.puntosGrupales ?? 0);

      // Only auto-update groupPoints if:
      // 1. The computed value is greater than the DB value (user earned more points)
      // 2. OR the computed value is significantly different AND the computed value is > 0
      //    (don't auto-reduce to 0 as it may indicate incomplete history data)
      // This prevents accidentally resetting groupPoints to 0 due to missing/malformed history entries
      const shouldUpdate = computedGroupPoints > dbGroupPoints ||
        (computedGroupPoints > 0 && Math.abs(dbGroupPoints - computedGroupPoints) > 0.01);

      if (shouldUpdate) {
        try {
          await runTransaction(db, async (tx) => {
            const s = await tx.get(uRef);
            if (!s.exists()) return;
            const d = s.data();
            const currentDbGroup = Number(d.groupPoints ?? d.puntosGrupales ?? 0);
            // Same protection inside transaction
            const shouldUpdateInTx = computedGroupPoints > currentDbGroup ||
              (computedGroupPoints > 0 && Math.abs(currentDbGroup - computedGroupPoints) > 0.01);
            if (shouldUpdateInTx) {
              tx.update(uRef, { groupPoints: computedGroupPoints });
              console.log(`✅ groupPoints actualizado automáticamente: ${currentDbGroup} → ${computedGroupPoints}`);
            }
          });
        } catch (e) {
          console.warn("No se pudo actualizar groupPoints automáticamente:", e);
        }
      }
    } catch (e) {
      console.warn("Error al calcular puntos grupales:", e);
    }
    
  }, (err) => console.error("onSnapshot usuarios error:", err));

  const txCol = collection(db, "usuarios", uid, "transactions");
  const txQ = query(txCol, orderBy("timestamp", "desc"), limit(200));
  unsubscribeTxs = onSnapshot(txQ, (snap) => {
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, data: d.data() }));
    txDocsArray = arr;
    renderCombinedHistory();
  }, (err) => console.error("onSnapshot transactions error:", err));
}

// ---- Funciones para crear transacciones (escriben en subcolección y actualizan el campo history[]) ----

/*
  addEarnings(uid, amount, meta)
    meta: { action, by, byName, points }
*/
async function addEarnings(uid, amount = 0, meta = {}) {
  if (!uid) throw new Error("Usuario no autenticado");
  amount = Number(amount);
  if (isNaN(amount) || amount <= 0) throw new Error("Monto inválido");

  const uRef = doc(db, "usuarios", uid);
  const earningId = (uid || 'u') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
  const now = Date.now();
  const entry = {
    earningId,
    type: "earning",
    amount,
    timestamp: now,
    originMs: meta && meta.originMs ? Number(meta.originMs) : now,
    meta,
    note: meta.action || "",
    by: meta.by || (auth.currentUser ? auth.currentUser.uid : "system"),
    points: meta.points ?? null
  };

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    const data = snap.exists() ? snap.data() : {};
    window.__lastUserData = data;
    const oldBalance = Number(data.balance ?? 0);
    const oldTotal = Number(data.totalCommissions ?? 0);
    const oldGroupPoints = Number(data.groupPoints ?? data.puntosGrupales ?? 0);

    const newBalance = oldBalance + amount;
    const newTotal = oldTotal + amount;
    let newGroupPoints = oldGroupPoints;
    
    const consumedAt = data.groupPointsConsumedAt ? (data.groupPointsConsumedAt.toMillis ? data.groupPointsConsumedAt.toMillis() : null) : null;
    const originMs = entry.originMs;
    
    if (entry.points && !isNaN(Number(entry.points))) {
      if (consumedAt && originMs && originMs <= consumedAt) {
        newGroupPoints = oldGroupPoints;
      } else {
        newGroupPoints = oldGroupPoints + Number(entry.points);
      }
    }

    tx.update(uRef, {
      balance: newBalance,
      totalCommissions: newTotal,
      groupPoints: newGroupPoints,
      history: arrayUnion(entry)
    });
  });

  const txCol = collection(db, "usuarios", uid, "transactions");
  await addDoc(txCol, {
    earningId: earningId,
    type: "earning",
    amount,
    timestamp: serverTimestamp(),
    originMs: now,
    meta,
    ownerUid: uid,
    points: meta.points ?? null
  });

  return { success: true };
}

/*
  cobrarPending(uid, amount = null, options = {})
    options: { pointsToUse: number|null, clearGroupPoints: bool }
*/

async function cobrarPending(uid, amount = null, options = {}) {
  if (!uid) throw new Error("Usuario no autenticado");
  const { pointsToUse = null, clearGroupPoints = false } = options;
  const withdrawId = (uid || 'u') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);

  const uRef = doc(db, "usuarios", uid);
  let result = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    if (!snap.exists()) throw new Error("Usuario no encontrado");
    const data = snap.data();
    const currentBalance = Number(data.balance ?? 0);
    const wallet = Number(data.walletBalance ?? 0);
    const currentGroupPoints = Number(data.groupPoints ?? data.puntosGrupales ?? 0);

    const toWithdraw = (amount === null || amount === undefined) ? currentBalance : Number(amount);
    if (isNaN(toWithdraw) || toWithdraw <= 0) throw new Error("Monto inválido");
    if (toWithdraw > currentBalance) throw new Error("Saldo insuficiente");

    // mover de balance -> wallet
    const newBalance = currentBalance - toWithdraw;
    const newWallet = wallet + toWithdraw;

    // calcular y registrar puntos usados basado en el monto cobrado
    // Cada punto equivale a $2,800 pesos
    const POINT_VALUE_FOR_WITHDRAWAL = 2800;
    let newGroupPoints = currentGroupPoints;
    let pointsUsed = null;
    
    // Calcular puntos a descontar basado en el monto a cobrar
    const calculatedPoints = Math.floor(toWithdraw / POINT_VALUE_FOR_WITHDRAWAL);
    
    if (clearGroupPoints) {
      pointsUsed = currentGroupPoints;
      newGroupPoints = 0;
    } else if (pointsToUse !== null && !isNaN(Number(pointsToUse))) {
      pointsUsed = Number(pointsToUse);
      newGroupPoints = Math.max(0, currentGroupPoints - Number(pointsToUse));
    } else if (calculatedPoints > 0) {
      // Usar puntos calculados basados en el monto
      pointsUsed = Math.min(calculatedPoints, currentGroupPoints);
      newGroupPoints = Math.max(0, currentGroupPoints - pointsUsed);
    } else if (data.lastPoints && !isNaN(Number(data.lastPoints))) {
      pointsUsed = Number(data.lastPoints);
      newGroupPoints = Math.max(0, currentGroupPoints - Number(data.lastPoints));
    } else {
      // no se usan puntos
      pointsUsed = null;
      newGroupPoints = currentGroupPoints;
    }

    const entry = {
      withdrawId,
      type: "withdraw",
      amount: toWithdraw,
      timestamp: Date.now(),
      note: "Cobro desde UI",
      by: (auth.currentUser && auth.currentUser.uid) ? auth.currentUser.uid : "system",
      pointsUsed: pointsUsed
    };

    tx.update(uRef, {
      balance: newBalance,
      walletBalance: newWallet,
      groupPoints: newGroupPoints,
      history: arrayUnion(entry),
      groupPointsConsumedAt: serverTimestamp(),
    });

    result = { withdrawn: toWithdraw, newBalance, newWallet, newGroupPoints, pointsUsed };
  });

  // Registrar en subcolección de transacciones
  const txCol = collection(db, "usuarios", uid, "transactions");
  await addDoc(txCol, {
    withdrawId: withdrawId ?? null,
    type: "withdraw",
    amount: result.withdrawn,
    timestamp: serverTimestamp(),
    originMs: Date.now(),
    note: "Cobro desde UI",
    ownerUid: uid,
    pointsUsed: result.pointsUsed !== undefined ? result.pointsUsed : null
  });

  return result;
}


// ---- Hook de autenticación: conectar listeners y botón cobrar ----
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (btnCobrar) btnCobrar.disabled = true;
    cleanupListeners();
    return;
  }
  const uid = user.uid;

  // Inicializa campos mínimos si es necesario
  try {
    await runTransaction(db, async (tx) => {
      const uRef = doc(db, "usuarios", uid);
      const s = await tx.get(uRef);
      if (!s.exists()) {
        tx.set(uRef, { balance: 0, totalCommissions: 0, walletBalance: 0, groupPoints: 0, history: [], createdAt: serverTimestamp() });
      } else {
        const data = s.data();
        const updates = {};
        if (data.balance === undefined) updates.balance = 0;
        if (data.totalCommissions === undefined) updates.totalCommissions = 0;
        if (data.walletBalance === undefined) updates.walletBalance = 0;
        if (data.groupPoints === undefined && data.puntosGrupales === undefined) updates.groupPoints = 0;
        if (!Array.isArray(data.history)) updates.history = [];
        if (Object.keys(updates).length) tx.update(uRef, updates);
      }
    });
  } catch (e) {
    console.warn("initializeUserDoc failed:", e);
  }

  // Attach listeners for both sources
  attachRealtimeForUserBoth(uid);

  // Conectar botón cobrar (clonar para evitar múltiples listeners)
  if (btnCobrar && btnCobrar.parentNode) {
    const newBtn = btnCobrar.cloneNode(true);
    btnCobrar.parentNode.replaceChild(newBtn, btnCobrar);
    newBtn.disabled = false;
    newBtn.addEventListener("click", async () => {
      newBtn.disabled = true;
      const originalText = newBtn.textContent;
      newBtn.textContent = "Procesando...";
      try {
        // Aquí calculamos automáticamente los puntos grupales basado en el monto a cobrar
        // (1 punto = $2,800 pesos), sin forzar clearGroupPoints
        const amt = (window.__lastUserData && typeof window.__lastUserData.balance !== 'undefined') ? Number(window.__lastUserData.balance) : null;
        await cobrarPending(uid, amt, { });
        console.log("Cobro realizado y puntos grupales actualizados");
      } catch (e) {
        console.error("Error cobrando:", e);
        if (window.Swal) Swal.fire("Error", e.message || "Error al cobrar", "error");
      } finally {
        newBtn.disabled = false;
        newBtn.textContent = originalText || "Cobrar";
      }
    });
  }
});

// Exportar funciones útiles
export { addEarnings, cobrarPending, attachRealtimeForUserBoth, normalizeEntry, cleanupListeners };

// NOTE: couldn't locate original cobrar listener; added confirmation handler separately.



// --- OVERRIDE: mejorar comportamiento de Cobrar ---
// Este bloque asegura que al pulsar 'Cobrar' se muestre una confirmación bonita
// y se envíe un documento a la colección 'payouts' para que el panel admin lo vea,
// antes de invocar la función cobrarPending existente.

(function() {
  const setup = () => {
    const btn = document.getElementById('btnCobrar');
    if (!btn) return;
    // replace to remove previous listeners
    const newBtn = btn.cloneNode(true);
    if (btn.parentNode) btn.parentNode.replaceChild(newBtn, btn); else console.warn('btn.parentNode is null — skip replaceChild');
    newBtn.disabled = false;
    newBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();

      // Verificar si el usuario es Master o tiene 50+ puntos personales
      const userData = window.__lastUserData || {};
      const personalPoints = Number(userData.personalPoints ?? userData.puntos ?? 0);
      const isMaster = !userData.patrocinador || userData.patrocinador === '' || userData.patrocinador === null;
      const canWithdraw = isMaster || personalPoints >= 50;
      const MIN_WITHDRAW_AMOUNT = 20000; // Mínimo 20,000 pesos para cobrar
      const currentBalance = Number(userData.balance ?? 0);
      const meetsMinimum = currentBalance >= MIN_WITHDRAW_AMOUNT;

      if (!canWithdraw) {
        if (window.Swal) {
          await Swal.fire({
            title: 'No puedes cobrar aún',
            html: `<p>Para desbloquear bonos pagos y cobros, debes ser <strong>Master</strong> o tener más de <strong>50 puntos personales</strong>.</p>
                   <p><small>Actualmente tienes <strong>${personalPoints.toFixed(2)} puntos personales</strong></small></p>`,
            icon: 'warning',
            confirmButtonText: 'Entendido'
          });
        } else {
          alert(`No puedes cobrar aún para desbloquear bonos pagos y cobros, debes ser Master o tener más de 50 puntos personales. Actualmente tienes ${personalPoints.toFixed(2)} puntos.`);
        }
        return;
      }

      // Verificar monto mínimo de 20,000 pesos
      if (!meetsMinimum) {
        const prettyMin = (typeof formatCurrency === 'function') ? formatCurrency(MIN_WITHDRAW_AMOUNT) : ('$' + MIN_WITHDRAW_AMOUNT.toLocaleString());
        const prettyBalance = (typeof formatCurrency === 'function') ? formatCurrency(currentBalance) : ('$' + currentBalance.toLocaleString());
        if (window.Swal) {
          await Swal.fire({
            title: 'Monto mínimo no alcanzado',
            html: `<p>El monto mínimo para cobrar es <strong>${prettyMin}</strong>.</p>
                   <p><small>Actualmente tienes <strong>${prettyBalance}</strong> en comisiones por cobrar.</small></p>`,
            icon: 'warning',
            confirmButtonText: 'Entendido'
          });
        } else {
          alert(`El monto mínimo para cobrar es ${prettyMin}. Actualmente tienes ${prettyBalance} en comisiones.`);
        }
        return;
      }

      // Preferir balance directo desde el último snapshot si está disponible
      let amount = 0;
      if (window.__lastUserData && typeof window.__lastUserData.balance !== 'undefined') {
        amount = Number(window.__lastUserData.balance) || 0;
        console.log('Override: usando balance desde __lastUserData =>', amount);
      } else {
        const pendingEl = document.getElementById('pendingCommissions') || document.getElementById('totalCommissions');
        const raw = pendingEl ? (pendingEl.textContent || '') : '';
        amount = Number((raw.replace(/[^0-9.-]+/g,'') || 0));
        console.log('Override: fallback leyendo DOM =>', amount);
      }
      const pretty = (typeof formatCurrency === 'function') ? formatCurrency(amount) : ('$' + amount);
      if (window.Swal) {
        const r = await Swal.fire({
          title: 'Estás a punto de cobrar',
          html: `Se te reflejarán <b>${pretty}</b> en tu cuenta.<br><small>Los pagos se procesan los días 15 y 30 de cada mes.</small>`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Aceptar y enviar a administración',
          cancelButtonText: 'Cancelar'
        });
        if (!r.isConfirmed) return;
      } else {
        if (!confirm('Estás a punto de cobrar ' + pretty + '. Continuar?')) return;
      }
      // create payouts record for admin panel (with auth check)
      // determine authenticated uid safely
      const currentUserForPayout = (auth && auth.currentUser) ? auth.currentUser : (window.auth && window.auth.currentUser) ? window.auth.currentUser : null;
      const uidForAction = currentUserForPayout ? currentUserForPayout.uid : (window.uid || (window.__lastUserData && window.__lastUserData.uid) || null);
      if (!uidForAction) {
        console.warn('No hay usuario autenticado. Se requiere iniciar sesión para crear la solicitud de cobro.');
        if (window.Swal) {
          await Swal.fire('Error', 'Debes iniciar sesión para solicitar un cobro.', 'error');
        } else {
          alert('Debes iniciar sesión para solicitar un cobro.');
        }
      } else {
        try {
          const payoutsCol = collection(db, 'payouts');
          const now = new Date();
          let scheduledFor;
          if (now.getDate() <= 15) scheduledFor = new Date(now.getFullYear(), now.getMonth(), 15);
          else if (now.getDate() <= 30) scheduledFor = new Date(now.getFullYear(), now.getMonth(), 30);
          else scheduledFor = new Date(now.getFullYear(), now.getMonth()+1, 15);
          await addDoc(payoutsCol, {
            userId: uidForAction,
            amount: amount,
            scheduled_for: scheduledFor.toISOString().slice(0,10),
            status: 'scheduled',
            createdAt: serverTimestamp
              ? serverTimestamp()
              : new Date().toISOString()
          });
          console.log('Payout registrado (payouts collection).');
        } catch (err) {
          console.warn('No se pudo crear registro en payouts:', err);
          // user-friendly message for permission issues
          if (err && err.code && err.code === 'permission-denied') {
            if (window.Swal) {
              await Swal.fire('Error', 'No tienes permisos para solicitar cobros. Contacta al administrador.', 'error');
            } else {
              alert('No tienes permisos para solicitar cobros. Contacta al administrador.');
            }
          }
        }
      }

      // call existing cobrarPending if available
      try {
        if (typeof cobrarPending === 'function') {
          newBtn.disabled = true;
          const originalText = newBtn.textContent;
          newBtn.textContent = 'Procesando...';
          await cobrarPending(uidForAction, amount, { });
          newBtn.textContent = originalText || 'Cobrar';
          newBtn.disabled = false;
        } else {
          console.warn('cobrarPending no disponible en este contexto.');
        }
      } catch(e) {
        console.error('Error al ejecutar cobrarPending:', e);
        if (window.Swal) Swal.fire('Error', e.message || 'Error al cobrar', 'error');
      }
    });
  };

  // Try to setup now, or after DOM loaded
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(setup, 200);
  } else {
    window.addEventListener('DOMContentLoaded', setup);
  }
})();
