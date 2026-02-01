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

      // Check if user is active this month (needs 10+ points)
      const monthlyPersonalPoints = getMonthlyPersonalPoints(userData);
      const isActiveThisMonth = monthlyPersonalPoints >= MONTHLY_ACTIVATION_POINTS_THRESHOLD;
      window.currentUserIsActive = isActiveThisMonth;
      window.currentUserMonthlyPoints = monthlyPersonalPoints;

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
      displayActiveStatus(isActiveThisMonth, monthlyPersonalPoints);

      // Show notification for inactive users
      showInactiveNotification(isActiveThisMonth, monthlyPersonalPoints);

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
      const avatarOptions = document.getElementById("avatarOptions");
      const avatarGridFromOptions = avatarOptions?.querySelector(".avatar-grid");

      const avatarFromDB = userData.fotoURL;

      // Usar elementos tanto del grid principal como del avatar-options
      const allAvatarImgs = avatarOptions
        ? avatarOptions.querySelectorAll(".avatar-grid img")
        : avatarImgs;

      if (allAvatarImgs && allAvatarImgs.length) {
        allAvatarImgs.forEach(imgEl => {
          imgEl.addEventListener("click", async () => {
            // prevenir doble-clicks múltiples
            imgEl.disabled = true;
            const selectedAvatar = `images/avatars/${imgEl.dataset.avatar}`;
            try {
              // solo escribir si cambió realmente
              if (userData.fotoURL !== selectedAvatar) {
                await updateDoc(docRef, { fotoURL: selectedAvatar });
                userData.fotoURL = selectedAvatar; // actualizar local
              }
              if (profileImg) profileImg.src = resolveAvatarPath(selectedAvatar);

              // Solo actualizar mini-avatar si el usuario NO tiene rango Plata o superior
              // (si tiene rango, el mini-avatar debe seguir mostrando la imagen del rango)
              const miniAvatarEl = document.getElementById("miniAvatar");
              const userTotalComisiones = Number(userData.totalComisionesCobradas ?? 0);
              const userHasSilverOrAbove = userTotalComisiones >= 1400000;
              if (miniAvatarEl && !userHasSilverOrAbove) {
                miniAvatarEl.src = resolveAvatarPath(selectedAvatar);
              }

              if (avatarGrid) avatarGrid.style.display = "none";
              if (avatarOptions) avatarOptions.style.display = "none";
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

      // --- Foto de Perfil (Rango Plata+) ---
      // Umbrales de comisiones para rangos
      const RANK_THRESHOLDS = [
        { name: 'corona', threshold: 28000000 },
        { name: 'diamante', threshold: 14000000 },
        { name: 'stars', threshold: 8400000 },
        { name: 'oro', threshold: 4200000 },
        { name: 'plata', threshold: 1400000 }
      ];

      const SILVER_RANK_THRESHOLD = 1400000;
      const totalComisiones = Number(userData.totalComisionesCobradas ?? 0);
      const hasProfilePhoto = userData.profilePhotoBase64 && userData.profilePhotoBase64.length > 0;
      const isSilverOrAbove = totalComisiones >= SILVER_RANK_THRESHOLD;

      // Determinar el rango actual del usuario
      function getUserRank(commissions) {
        for (const rank of RANK_THRESHOLDS) {
          if (commissions >= rank.threshold) {
            return rank.name;
          }
        }
        return null; // No tiene rango Plata o superior
      }

      const currentUserRank = getUserRank(totalComisiones);

      // Elementos del DOM para foto de perfil
      const profilePhotoWrapper = document.getElementById("profilePhotoWrapper");
      const avatarWrapper = document.getElementById("avatarWrapper");
      const profilePhotoEl = document.getElementById("profilePhoto");
      const miniAvatarEl = document.getElementById("miniAvatar");
      const profilePhotoInput = document.getElementById("profilePhotoInput");

      // Elementos del menú contextual
      const photoContextMenu = document.getElementById("photoContextMenu");
      const avatarContextMenu = document.getElementById("avatarContextMenu");
      const profilePhotoContainer = document.getElementById("profilePhotoContainer");
      const miniAvatarBadge = document.getElementById("miniAvatarBadge");
      const menuChangePhoto = document.getElementById("menuChangePhoto");
      const menuRemovePhoto = document.getElementById("menuRemovePhoto");
      const menuChangeAvatar = document.getElementById("menuChangeAvatar");
      const menuUploadPhoto = document.getElementById("menuUploadPhoto");

      // Función para cerrar todos los menús contextuales
      function closeAllContextMenus() {
        if (photoContextMenu) photoContextMenu.classList.remove("show");
        if (avatarContextMenu) avatarContextMenu.classList.remove("show");
      }

      // Cerrar menús al hacer clic fuera
      document.addEventListener("click", (e) => {
        if (!e.target.closest(".profile-photo-container") && !e.target.closest(".avatar-wrapper")) {
          closeAllContextMenus();
        }
      });

      // Función para obtener la ruta de la imagen del rango
      function getRankImagePath(rankName) {
        if (!rankName) return null;
        return `/images/rango/${rankName}.png`;
      }

      // Función para mostrar la foto de perfil con imagen del rango (en lugar de mini-avatar)
      function showProfilePhotoMode(photoBase64, avatarPath) {
        if (profilePhotoWrapper) profilePhotoWrapper.style.display = "block";
        if (avatarWrapper) avatarWrapper.style.display = "none";
        if (profilePhotoEl) profilePhotoEl.src = photoBase64;

        // Mostrar imagen del rango en lugar del mini-avatar si el usuario tiene rango Plata o superior
        if (miniAvatarEl && currentUserRank) {
          const rankImagePath = getRankImagePath(currentUserRank);
          miniAvatarEl.src = rankImagePath;
          miniAvatarEl.alt = `Rango ${currentUserRank}`;
          miniAvatarEl.title = `Rango: ${currentUserRank.charAt(0).toUpperCase() + currentUserRank.slice(1)}`;
        } else if (miniAvatarEl) {
          miniAvatarEl.src = resolveAvatarPath(avatarPath);
        }
      }

      // Función para mostrar el modo avatar normal
      function showAvatarMode() {
        if (profilePhotoWrapper) profilePhotoWrapper.style.display = "none";
        if (avatarWrapper) avatarWrapper.style.display = "block";
      }

      // Configurar vista según rango y si tiene foto
      if (isSilverOrAbove) {
        if (hasProfilePhoto) {
          // Mostrar foto de perfil con imagen del rango
          showProfilePhotoMode(userData.profilePhotoBase64, userData.fotoURL);
        } else {
          // Mostrar avatar normal pero con opción de subir foto
          showAvatarMode();
          if (menuUploadPhoto) menuUploadPhoto.style.display = "flex";
        }
      } else {
        // Usuario sin rango Plata: solo avatar normal
        showAvatarMode();
        if (menuUploadPhoto) menuUploadPhoto.style.display = "none";
      }

      // Evento: clic en la foto de perfil para mostrar menú
      if (profilePhotoContainer) {
        profilePhotoContainer.addEventListener("click", (e) => {
          // No abrir menú si se hizo clic en el botón de WhatsApp o en el mini-avatar
          if (e.target.closest(".whatsapp-docs-btn") || e.target.closest(".mini-avatar-badge")) {
            return;
          }
          e.stopPropagation();
          closeAllContextMenus();
          if (photoContextMenu) photoContextMenu.classList.toggle("show");
        });
      }

      // Evento: clic en el avatar para mostrar menú
      if (avatarWrapper) {
        avatarWrapper.addEventListener("click", (e) => {
          // No abrir menú si se hizo clic en el botón de WhatsApp
          if (e.target.closest(".whatsapp-docs-btn")) {
            return;
          }
          e.stopPropagation();
          closeAllContextMenus();
          if (avatarContextMenu) avatarContextMenu.classList.toggle("show");
        });
      }

      // Evento: clic en mini-avatar para cambiar avatar
      if (miniAvatarBadge) {
        miniAvatarBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          closeAllContextMenus();
          if (avatarOptions) {
            avatarOptions.style.display = avatarOptions.style.display === "none" ? "block" : "none";
          }
        });
      }

      // Evento: cambiar foto desde menú
      if (menuChangePhoto) {
        menuChangePhoto.addEventListener("click", (e) => {
          e.stopPropagation();
          closeAllContextMenus();
          if (profilePhotoInput) profilePhotoInput.click();
        });
      }

      // Evento: quitar foto desde menú
      if (menuRemovePhoto) {
        menuRemovePhoto.addEventListener("click", async (e) => {
          e.stopPropagation();
          closeAllContextMenus();
          if (!confirm("¿Estás seguro de que deseas quitar tu foto de perfil?")) return;

          try {
            await updateDoc(docRef, { profilePhotoBase64: "" });
            showAvatarMode();
            if (menuUploadPhoto) menuUploadPhoto.style.display = "flex";
            alert("✅ Foto de perfil eliminada.");
          } catch (err) {
            console.error("❌ Error eliminando foto:", err);
            alert("Error al eliminar la foto de perfil.");
          }
        });
      }

      // Evento: cambiar avatar desde menú
      if (menuChangeAvatar) {
        menuChangeAvatar.addEventListener("click", (e) => {
          e.stopPropagation();
          closeAllContextMenus();
          if (avatarOptions) {
            avatarOptions.style.display = avatarOptions.style.display === "none" ? "block" : "none";
          }
        });
      }

      // Evento: subir foto desde menú (solo usuarios Plata+)
      if (menuUploadPhoto) {
        menuUploadPhoto.addEventListener("click", (e) => {
          e.stopPropagation();
          closeAllContextMenus();
          if (profilePhotoInput) profilePhotoInput.click();
        });
      }

      // Evento: procesar archivo seleccionado
      if (profilePhotoInput) {
        profilePhotoInput.addEventListener("change", async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          // Validar tipo de archivo
          const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
          if (!allowedTypes.includes(file.type)) {
            alert("Solo se permiten archivos JPG, PNG o WebP.");
            return;
          }

          // Validar tamaño (máximo 1MB para Firestore)
          const MAX_SIZE = 1 * 1024 * 1024; // 1MB
          if (file.size > MAX_SIZE) {
            alert("La imagen es demasiado grande. El tamaño máximo es 1MB.");
            return;
          }

          // Mostrar indicador de carga
          const loadingMsg = "Subiendo foto...";
          let loadingAlert = null;
          if (typeof Swal !== 'undefined') {
            loadingAlert = Swal.fire({
              title: loadingMsg,
              allowOutsideClick: false,
              didOpen: () => Swal.showLoading()
            });
          }

          try {
            // Redimensionar y convertir a Base64
            const base64 = await resizeAndConvertToBase64(file, 400, 400, 0.85);

            // Guardar en Firestore
            await updateDoc(docRef, { profilePhotoBase64: base64 });

            // Actualizar la vista
            showProfilePhotoMode(base64, userData.fotoURL);

            if (loadingAlert) Swal.close();
            alert("✅ Foto de perfil actualizada correctamente.");
          } catch (err) {
            console.error("❌ Error subiendo foto:", err);
            if (loadingAlert) Swal.close();
            alert("Error al subir la foto de perfil. Inténtalo de nuevo.");
          } finally {
            // Limpiar input
            profilePhotoInput.value = "";
          }
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
        // Round to maximum 2 decimal places and remove trailing zeros
        teamEl.textContent = String(Math.round(groupPointsValue * 100) / 100);
      }

      // --- Botón de documentación (dinámico) ---
      const btnDocumentation = document.getElementById("btnDocumentation");
      const btnDocText = document.getElementById("btnDocText");
      if (btnDocumentation && btnDocText) {
        // Verificar si el usuario tiene documentación subida
        const hasDocumentation = userData.documentacionSubida === true ||
                                 userData.hasDocumentation === true ||
                                 (userData.documentos && Object.keys(userData.documentos).length > 0);

        if (hasDocumentation) {
          btnDocText.textContent = "Ver documentación";
          btnDocumentation.classList.add("docs-uploaded");
          btnDocumentation.title = "Ver tu documentación";
        } else {
          btnDocText.textContent = "Subir documentación";
          btnDocumentation.classList.remove("docs-uploaded");
          btnDocumentation.title = "Subir tu documentación";
        }
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

// Función para redimensionar imagen y convertirla a Base64
// Retorna una Promise con el string Base64
function resizeAndConvertToBase64(file, maxWidth = 400, maxHeight = 400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        // Calcular nuevas dimensiones manteniendo aspecto
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        // Crear canvas y dibujar imagen redimensionada
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Convertir a Base64 (JPEG para mejor compresión)
        const base64 = canvas.toDataURL("image/jpeg", quality);
        resolve(base64);
      };

      img.onerror = () => reject(new Error("Error al cargar la imagen"));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsDataURL(file);
  });
}

// Umbral de puntos personales para activación mensual
const MONTHLY_ACTIVATION_POINTS_THRESHOLD = 10;

// Función para verificar si el usuario está activo en el mes actual.
// Un usuario está ACTIVO solo si acumuló 10 o más puntos personales dentro del mismo mes calendario.
// Esta validación se reinicia automáticamente al inicio de cada nuevo mes.
function checkIfActiveThisMonth(userData) {
  const hist = userData?.history;
  if (!Array.isArray(hist)) return false;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Acumular puntos personales de compras confirmadas en el mes actual
  let monthlyPersonalPoints = 0;

  for (const e of hist) {
    if (!e) continue;
    const dateRaw = e.date || e.fechaCompra || e.fecha_recompra || e.createdAt || e.fecha || e.timestamp;
    let d = null;

    if (dateRaw) {
      if (typeof dateRaw.toDate === "function") {
        d = dateRaw.toDate();
      } else if (typeof dateRaw === 'number') {
        d = new Date(dateRaw);
      } else if (typeof dateRaw.seconds === 'number') {
        d = new Date(dateRaw.seconds * 1000);
      } else {
        d = new Date(dateRaw);
      }
    }

    if (!d || isNaN(d.getTime()) || d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) {
      continue;
    }

    const action = (e.action || "").toLowerCase();
    const type = (e.type || "").toLowerCase();

    // Solo contar puntos de compras personales confirmadas
    const isPurchase = (type === "purchase" && /compra confirmada/i.test(action)) ||
                       (!type && /compra confirmada/i.test(action) && !action.includes("comisión") && !action.includes("bono"));

    if (isPurchase) {
      // Sumar puntos de esta compra
      const points = Number(e.points || e.puntos || 0);
      monthlyPersonalPoints += points;
    }
  }

  // El usuario está activo solo si acumuló 10 o más puntos en el mes
  return monthlyPersonalPoints >= MONTHLY_ACTIVATION_POINTS_THRESHOLD;
}

// Función para obtener los puntos personales acumulados en el mes actual
function getMonthlyPersonalPoints(userData) {
  const hist = userData?.history;
  if (!Array.isArray(hist)) return 0;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  let monthlyPersonalPoints = 0;

  for (const e of hist) {
    if (!e) continue;
    const dateRaw = e.date || e.fechaCompra || e.fecha_recompra || e.createdAt || e.fecha || e.timestamp;
    let d = null;

    if (dateRaw) {
      if (typeof dateRaw.toDate === "function") {
        d = dateRaw.toDate();
      } else if (typeof dateRaw === 'number') {
        d = new Date(dateRaw);
      } else if (typeof dateRaw.seconds === 'number') {
        d = new Date(dateRaw.seconds * 1000);
      } else {
        d = new Date(dateRaw);
      }
    }

    if (!d || isNaN(d.getTime()) || d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) {
      continue;
    }

    const action = (e.action || "").toLowerCase();
    const type = (e.type || "").toLowerCase();

    const isPurchase = (type === "purchase" && /compra confirmada/i.test(action)) ||
                       (!type && /compra confirmada/i.test(action) && !action.includes("comisión") && !action.includes("bono"));

    if (isPurchase) {
      const points = Number(e.points || e.puntos || 0);
      monthlyPersonalPoints += points;
    }
  }

  return monthlyPersonalPoints;
}

function displayActiveStatus(isActive, monthlyPoints = 0) {
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
    statusBadge.textContent = `✓ Activo este mes (${monthlyPoints} pts)`;
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
    const pointsNeeded = MONTHLY_ACTIVATION_POINTS_THRESHOLD - monthlyPoints;
    statusBadge.textContent = `⚠ Inactivo (${monthlyPoints}/${MONTHLY_ACTIVATION_POINTS_THRESHOLD} pts)`;
    statusBadge.title = `Necesitas ${pointsNeeded} punto${pointsNeeded !== 1 ? 's' : ''} más para activarte este mes`;
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
      cursor: help;
    `;
  }
}

function showInactiveNotification(isActive, monthlyPoints = 0) {
  // Si está activo, ocultar la notificación si existe
  const existingNotification = document.getElementById('monthlyActivationNotification');
  if (isActive) {
    if (existingNotification) {
      existingNotification.style.display = 'none';
    }
    return;
  }

  if (existingNotification) {
    const pointsNeeded = MONTHLY_ACTIVATION_POINTS_THRESHOLD - monthlyPoints;
    existingNotification.querySelector('span:last-child').innerHTML =
      `Necesitas acumular <strong>${MONTHLY_ACTIVATION_POINTS_THRESHOLD} puntos personales</strong> para activarte este mes. ` +
      `Actualmente tienes <strong>${monthlyPoints} punto${monthlyPoints !== 1 ? 's' : ''}</strong>. ` +
      `Te faltan <strong>${pointsNeeded} punto${pointsNeeded !== 1 ? 's' : ''}</strong> para recibir bonos y comisiones.`;
    existingNotification.style.display = 'flex';
    return;
  }

  const alertEl = document.getElementById("activationAlert");
  if (!alertEl) return;

  const pointsNeeded = MONTHLY_ACTIVATION_POINTS_THRESHOLD - monthlyPoints;
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
    <span>Necesitas acumular <strong>${MONTHLY_ACTIVATION_POINTS_THRESHOLD} puntos personales</strong> para activarte este mes. ` +
      `Actualmente tienes <strong>${monthlyPoints} punto${monthlyPoints !== 1 ? 's' : ''}</strong>. ` +
      `Te faltan <strong>${pointsNeeded} punto${pointsNeeded !== 1 ? 's' : ''}</strong> para recibir bonos y comisiones.</span>
  `;

  alertEl.parentNode.insertBefore(notification, alertEl.nextSibling);
}
