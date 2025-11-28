import { auth, db } from "/src/firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  increment,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";


// --- helper: normalize avatar path ---
function resolveAvatarPath(p) {
  if (!p) return '/images/avatars/default-avatar.png';
  if (/^https?:\/\//.test(p)) return p;
  p = String(p).trim();
  if (p.startsWith('/')) return p;
  p = p.replace(/^(\.\.\/)+/, '');
  return '/' + p.replace(/^\/+/, '');
}
document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/distribuidor-login.html";
      return;
    }

    try {
      const docRef = doc(db, "usuarios", user.uid);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        alert("No se encontraron datos del usuario.");
        return;
      }

      const userData = docSnap.data();
      // Exponer tipo de registro globalmente para otros scripts
      const userRole = userData.role || userData.tipoRegistro || userData.rol || 'distribuidor';
      window.currentTipoRegistro = userRole.toString().toLowerCase();
      window.currentUserRole = userRole.toString().toLowerCase();

      // Expose user points and Master status globally for product filtering
      const personalPoints = Number(userData.personalPoints ?? userData.puntos ?? 0);
      window.currentUserPoints = personalPoints;
      window.currentUserIsMaster = personalPoints >= 50 || userData.isMaster === true;



      // Disparar personalPointsReady para garantizar que otros scripts (productos, alerta) reaccionen
      const _personalPoints = Number(userData.personalPoints ?? userData.puntos ?? 0);
      document.dispatchEvent(new CustomEvent('personalPointsReady', { detail: { personalPoints: _personalPoints } }));
      
      // Disparar pointsReady para la barra de progreso con comisiones cobradas
      const _groupPoints = Number(userData.groupPoints ?? 0);
      const _totalComisionesCobradas = Number(userData.totalComisionesCobradas ?? 0);
      document.dispatchEvent(new CustomEvent('pointsReady', { 
        detail: { 
          personalPoints: _personalPoints,
          groupPoints: _groupPoints,
          totalComisionesCobradas: _totalComisionesCobradas
        } 
      }));

      // Check if user is active this month
      const isActiveThisMonth = checkIfActiveThisMonth(userData);
      window.currentUserIsActive = isActiveThisMonth;

// Mostrar datos básicos
      const nombreEl = document.getElementById("nombre");
      const usuarioEl = document.getElementById("usuario");
      const emailEl = document.getElementById("email");
      const profileImg = document.getElementById("profileImg");
      const refInput = document.getElementById("refLink");
      const copyBtn = document.getElementById("copyRef");

      if (nombreEl) nombreEl.textContent = userData.nombre || userData.usuario || "";
      if (usuarioEl) usuarioEl.textContent = userData.usuario || "";
      if (emailEl) emailEl.textContent = user.email || userData.email || "";
      if (profileImg) {
        if (userData.fotoURL) profileImg.src = userData.fotoURL.startsWith("http") ? userData.fotoURL : `../${userData.fotoURL}`;
        else profileImg.src = `../images/avatars/avatar_${(Math.floor(Math.random()*6)+1)}.png`;
      }

      // Display active/inactive status below avatar
      displayActiveStatus(isActiveThisMonth);

      // Show notification for inactive users
      showInactiveNotification(isActiveThisMonth);

      if (refInput && copyBtn && userData.usuario) {
        const link = `${window.location.origin}/register.html?patrocinador=${encodeURIComponent(userData.usuario)}`;
        refInput.value = link;

        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(link);
            copyBtn.textContent = "¡Copiado!";
            setTimeout(() => (copyBtn.textContent = "Copiar"), 1500);
          } catch (err) {
            // Fallback
            try {
              refInput.select();
              document.execCommand("copy");
              copyBtn.textContent = "¡Copiado!";
              setTimeout(() => (copyBtn.textContent = "Copiar"), 1500);
            } catch (err2) {
              console.error("Error copiando al portapapeles:", err, err2);
              alert("No se pudo copiar el enlace automáticamente. Seleccione y copie manualmente.");
            }
          }
        });
      }

      // --- Botón Cerrar sesión ---
      const logoutBtn = document.getElementById("logoutBtn");
      if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
          try {
            await signOut(auth);
            localStorage.removeItem("theme");
            window.location.href = "../index.html";
          } catch (error) {
            console.error("❌ Error al cerrar sesión:", error);
            alert("Error cerrando sesión.");
          }
        });
      }

      // --- Avatares ---
      const changeAvatarBtn = document.getElementById("changeAvatarBtn");
      const avatarGrid = document.getElementById("avatarGrid");
      const avatarImgs = document.querySelectorAll(".avatar-img");

      const avatarFromDB = userData.fotoURL;
      if (avatarImgs && avatarImgs.length) {
        avatarImgs.forEach(imgEl => {
          imgEl.addEventListener("click", async () => {
            // prevenir doble-clicks múltiples
            imgEl.disabled = true;
            const selectedAvatar = `images/avatars/${imgEl.dataset.avatar}`;
            try {
              // solo escribir si cambió realmente
              if (userData.fotoURL !== selectedAvatar) {
                await updateDoc(docRef, { fotoURL: selectedAvatar });
              }
              if (profileImg) profileImg.src = resolveAvatarPath(selectedAvatar);
              if (avatarGrid) avatarGrid.style.display = "none";
              if (changeAvatarBtn) changeAvatarBtn.style.display = "inline-block";
              alert("✅ Avatar actualizado correctamente.");
} catch (err) {
              console.error("❌ Error guardando avatar:", err);
              alert("Error al actualizar avatar.");
            } finally {
              imgEl.disabled = false;
            }
          });
        });
      }

      if (changeAvatarBtn) {
        if (avatarFromDB) {
          if (avatarGrid) avatarGrid.style.display = "none";
          changeAvatarBtn.style.display = "inline-block";
        } else {
          changeAvatarBtn.style.display = "none";
        }
        changeAvatarBtn.addEventListener("click", () => {
          if (avatarGrid) avatarGrid.style.display = "grid";
          changeAvatarBtn.style.display = "none";
        });
      }

      // --- Historial ---
let historyWrap = document.getElementById("historyWrap")
               || document.getElementById("history")
               || document.querySelector(".historyWrap")
               || document.querySelector(".history-list");

// crear contenedor si no existe
if (!historyWrap) {
  const userInfo = document.querySelector('.user-info') || document.querySelector('.container') || document.body;
  if (userInfo) {
    historyWrap = document.createElement('div');
    historyWrap.id = 'historyWrap';
    historyWrap.className = 'history-wrap';
    const hTitle = document.createElement('h3');
    hTitle.textContent = 'Historial';
    historyWrap.appendChild(hTitle);
    userInfo.appendChild(historyWrap);
  }
}

if (historyWrap) {
  // compatibilidad con diferentes nombres
  const rawHistory = Array.isArray(userData?.history) ? userData.history
                    : (Array.isArray(userData?.historial) ? userData.historial : []);
  // clonar y ordenar por fecha descendente (más reciente primero)
  const history = rawHistory.slice().sort((a, b) => {
    const ta = new Date(a?.date || a?.fecha || a?.createdAt || 0).getTime() || 0;
    const tb = new Date(b?.date || b?.fecha || b?.createdAt || 0).getTime() || 0;
    return tb - ta;
  });

  historyWrap.innerHTML = "";

  // Filtrar solo las comisiones, excluyendo las compras propias (por tipo y por texto de acción)
  const commissionHistory = history.filter(h => h.type !== 'purchase' && !(h.action || '').includes('Compra confirmada'));

  if (commissionHistory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hist-empty';
    empty.textContent = 'No hay registros de comisiones.';
    historyWrap.appendChild(empty);
  } else {
    // formateadores (miles y fecha)
    const fmtNumber = new Intl.NumberFormat('es-CO');
    
    // Helper para detectar y resaltar nombres en el texto
    function highlightUserName(text) {
      if (!text || typeof text !== 'string') return text || '';
      
      // Patrones comunes para extraer nombres de usuario
      const patterns = [
        /por compra de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i,
        /Por ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/,
        /de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i,
        /Comisión por compra \(nivel \d+\) de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i
      ];
      
      for (const pat of patterns) {
        const m = text.match(pat);
        if (m && m[1]) {
          return text.replace(m[1], `<span class="bold-name">${m[1]}</span>`);
        }
      }
      
      // Fallback: resaltar primera secuencia de palabras capitalizadas
      const cap = text.match(/([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/);
      if (cap && cap[1]) {
        return text.replace(cap[1], `<span class="bold-name">${cap[1]}</span>`);
      }
      return text;
    }
    
    // Función para determinar si es un ingreso (comisión, bono, etc.)
    function isIncome(historyItem) {
      const actionTxt = (historyItem?.action || historyItem?.tipo || '').toLowerCase();
      const incomeKeywords = ['comisión', 'comision', 'bono', 'ingreso', 'ganancia'];
      return incomeKeywords.some(keyword => actionTxt.includes(keyword));
    }
    
    commissionHistory.forEach(h => {
      const li = document.createElement("div");
      const isIncomeEntry = isIncome(h);
      li.className = isIncomeEntry ? "hist-item income" : "hist-item";

      const actionTxt  = h?.action || h?.tipo || "";
      const highlightedAction = highlightUserName(actionTxt);
      const pointsVal  = (h?.points ?? h?.puntos ?? null);
      const pointsTxt  = (pointsVal !== null && pointsVal !== undefined) ? (`${Number(pointsVal).toFixed(2)} pts`) : "";
      const amountVal  = (h?.amount ?? h?.monto ?? null);
      const amountTxt  = (amountVal !== null && amountVal !== undefined) ? (`$${fmtNumber.format(Math.round(Number(amountVal)))}`) : "";
      const dateVal    = h?.date || h?.fecha || h?.createdAt || null;
      const dateTxt    = dateVal ? new Date(dateVal).toLocaleString() : "";
      const orderId    = h?.orderId || h?.orderID || h?.id || "";

      li.innerHTML = `
        <div class="hist-row">
          <div class="hist-left">
            <div class="hist-action">${highlightedAction}</div>
            <div class="hist-info">${escapeHtml(pointsTxt)} ${escapeHtml(amountTxt)}</div>
          </div>
          <div class="hist-right">
            <div class="hist-date">${escapeHtml(dateTxt)}</div>
            ${ orderId ? `<div class="hist-orderid">ID: ${escapeHtml(orderId)}</div>` : "" }
          </div>
        </div>
      `;

      historyWrap.appendChild(li);
    });
  }
} else {
  console.warn('No se encontró (ni se pudo crear) el elemento historyWrap para renderizar el historial.');
}


      // --- Mostrar puntos actuales (puntos personales) ---
      // Preferir personalPoints si existe, fallback a puntos (compatibilidad)
      const puntosEl = document.getElementById("misPuntos");
      const pointsEl = document.getElementById("points");
      const personalPointsValue = Number(userData.personalPoints ?? userData.puntos ?? 0);
      if (puntosEl) puntosEl.textContent = String(personalPointsValue);
      if (pointsEl) pointsEl.textContent = String(personalPointsValue);

      // --- Mostrar groupPoints (puntos grupales) ---
      const teamEl = document.getElementById("teamPoints");
      const groupPointsValue = Number(userData.groupPoints ?? 0);
      if (teamEl) {
        teamEl.textContent = String(groupPointsValue);
      }

      // ----------------------------------------------
      // Ejemplo de asignación de bono inicial que usaba lectura y escritura no atómica:
      // Reemplazado por uso de increment() para evitar condiciones de carrera.
      // NOTA: esta función NO se ejecuta automáticamente aquí; debe invocarse explícitamente desde lógica admin o endpoint.
      // ----------------------------------------------
      async function giveInitialBonusIfApplies(sponsorIdentifier, userId) {
        try {
          if (!sponsorIdentifier) return;

          // sponsorIdentifier puede ser doc.id o username; intentamos resolver a doc.id si parece username
          let sponsorId = sponsorIdentifier;
          // heurística: si sponsorIdentifier no tiene longitud típica de UID, buscar por username
          if (typeof sponsorIdentifier === "string" && sponsorIdentifier.length < 30) {
            // intentar buscar por usuario (username)
            const q = query(collection(db, "usuarios"), where("usuario", "==", sponsorIdentifier), where("rol", "!=", "deleted"));
            const res = await getDocs(q);
            if (!res.empty) sponsorId = res.docs[0].id;
          }

          const sponsorRef = doc(db, "usuarios", sponsorId);
          const sponsorSnap = await getDoc(sponsorRef);
          if (!sponsorSnap.exists()) return;

          // Ejemplo de bono:
          const bonusPoints = 15;
          const bonusPesos = bonusPoints * 3800;

          // IMPORTANTE: usamos increment() para sumar de forma atómica
          await updateDoc(sponsorRef, {
            puntos: increment(bonusPoints),
            bonusHistory: arrayUnion({
              type: "Bono inicial",
              points: bonusPoints,
              amount: bonusPesos,
              date: new Date().toISOString(),
              fromUser: userId
            })
          });
        } catch (err) {
          console.error("🔥 Error asignando bono inicial:", err);
        }
      }

      // ... El resto del código del dashboard permanece igual ...

    } catch (error) {
      console.error("🔥 Error al obtener datos del usuario:", error);
      alert("Error al cargar los datos. Intente más tarde.");
    }
  });
});

document.addEventListener("personalPointsReady", (e) => {
  const personalPoints = Number(e.detail.personalPoints ?? 0);
  const tipo = (window.currentTipoRegistro || 'distribuidor').toString().toLowerCase();
  const threshold = (tipo === 'cliente') ? 70 : 50;
  const alertEl = document.getElementById("activationAlert");
  if (alertEl) {
    if (personalPoints < threshold) {
      const faltan = threshold - personalPoints;
      if (tipo === 'cliente') {
        alertEl.innerHTML = `⚠️ Te faltan ${faltan} puntos. Debes comprar o acumular ${threshold} puntos para pasarte a distribuidor y activar el plan de compensación.`;
      } else {
        alertEl.innerHTML = `⚠️ Te faltan ${faltan} puntos. Debes realizar una compra mínima de ${threshold} puntos para activar tu código y comenzar a recibir bonos y pagos.`;
      }
      alertEl.style.display = "block";
    } else {
      alertEl.style.display = "none";
    }
  }
});

/* -------------------- UTILIDADES LOCALES -------------------- */

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function checkIfActiveThisMonth(userData) {
  const hist = userData?.history;
  if (!Array.isArray(hist)) return false;
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  for (const e of hist) {
    if (!e) continue;
    const dateRaw = e.date || e.fechaCompra || e.fecha_recompra || e.createdAt || e.fecha;
    const d = dateRaw ? (typeof dateRaw.toDate === "function" ? dateRaw.toDate() : new Date(dateRaw)) : null;
    const action = (e.action || "").toLowerCase();
    const type = (e.type || "").toLowerCase();
    
    if (!d || d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) {
      continue;
    }
    
    if (type === "purchase" && /compra confirmada/i.test(action)) {
      return true;
    }
    
    if (!type && /compra confirmada/i.test(action) && !action.includes("comisión") && !action.includes("bono")) {
      return true;
    }
  }
  return false;
}

function displayActiveStatus(isActive) {
  const changeAvatarBtn = document.getElementById('changeAvatarBtn');
  if (!changeAvatarBtn) return;
  
  let statusBadge = document.getElementById('user-status-badge');
  if (!statusBadge) {
    statusBadge = document.createElement('div');
    statusBadge.id = 'user-status-badge';
    statusBadge.className = 'status-badge';
    changeAvatarBtn.parentNode.insertBefore(statusBadge, changeAvatarBtn.nextSibling);
  }
  
  if (isActive) {
    statusBadge.textContent = '✓ Activo este mes';
    statusBadge.style.cssText = `
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      margin-top: 8px;
      display: inline-block;
      text-align: center;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
    `;
  } else {
    statusBadge.textContent = '⚠ Inactivo este mes';
    statusBadge.style.cssText = `
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      margin-top: 8px;
      display: inline-block;
      text-align: center;
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
    `;
  }
}

function showInactiveNotification(isActive) {
  if (isActive) return;
  
  const existingNotification = document.getElementById('monthlyActivationNotification');
  if (existingNotification) {
    existingNotification.style.display = 'block';
    return;
  }
  
  const alertEl = document.getElementById("activationAlert");
  if (!alertEl) return;
  
  const notification = document.createElement('div');
  notification.id = 'monthlyActivationNotification';
  notification.style.cssText = `
    background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
    border-left: 4px solid #dc2626;
    padding: 14px 18px;
    border-radius: 8px;
    margin: 16px 0;
    font-size: 14px;
    color: #991b1b;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(220, 38, 38, 0.15);
    display: flex;
    align-items: center;
    gap: 10px;
  `;
  notification.innerHTML = `
    <span style="font-size: 20px;">⚠️</span>
    <span>Debes activarte este mes, o no recibirás bonos y comisiones del mes en curso.</span>
  `;
  
  alertEl.parentNode.insertBefore(notification, alertEl.nextSibling);
}
