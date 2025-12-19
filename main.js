// main.js
import { auth, db } from "./src/firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { setDoc, doc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------- Función: Verificar existencia del patrocinador ----------
async function verifySponsorExists(sponsorCode) {
  if (!sponsorCode) return false;
  const usuariosCol = collection(db, 'usuarios');
  const q = query(usuariosCol, where('usuario', '==', sponsorCode));
  const snap = await getDocs(q);
  return !snap.empty;
}

// ---------- Función: Verificar si el nombre de usuario ya existe ----------
async function isUsernameTaken(username) {
  const usuariosCol = collection(db, 'usuarios');
  const q = query(usuariosCol, where('usuario', '==', username));
  const snap = await getDocs(q);
  return !snap.empty;
}

// ---------- Ubicación ahora manejada por location.js con autocomplete ----------
// Los datos de ubicación se cargan desde data/colombia.json
// y el autocompletado se maneja en js/location.js

// ---------- Evento de envío del formulario ----------
const form = document.getElementById("registerForm");
const btnRegistrar = document.getElementById("btnRegistrar");
const loadingOverlay = document.getElementById("loadingOverlay");

if (form) {
  form.addEventListener("submit", async (e) => {
    // Evitar que otros listeners 'submit' se ejecuten (evita el this.submit() inline)
    e.preventDefault();
    e.stopImmediatePropagation();

    // Mostrar loading y deshabilitar botón
    if (loadingOverlay) loadingOverlay.classList.add('active');
    if (btnRegistrar) {
      btnRegistrar.disabled = true;
      btnRegistrar.textContent = 'Registrando...';
    }

    // Obtener datos del formulario
    const tipoRegistro = document.getElementById("tipoRegistro")?.value;
    const pais = document.getElementById("pais")?.value;
    // Obtener departamento y ciudad desde el sistema de autocomplete
    const provincia = window.locationAutocomplete ? window.locationAutocomplete.getDepartment() : "";
    const ciudad = window.locationAutocomplete ? window.locationAutocomplete.getCity() : "";
    const usuario = (document.getElementById("usuario")?.value || "").trim();
    const password = (document.getElementById("password")?.value || "").trim();
    const confirmPassword = (document.getElementById("confirmPassword")?.value || "").trim();
    const nombre = (document.getElementById("nombre")?.value || "").trim();
    const apellido = (document.getElementById("apellido")?.value || "").trim();
    const sexo = document.getElementById("sexo")?.value;
    const fechaNacimiento = document.getElementById("fechaNacimiento")?.value;
    const tipoDocumento = document.getElementById("tipoDocumento")?.value;
    const numeroDocumento = (document.getElementById("numeroDocumento")?.value || "").trim();
    const patrocinador = (document.getElementById("patrocinador")?.value || "").trim();
    const email = (document.getElementById("email")?.value || "").trim();
    const celular = (document.getElementById("celular")?.value || "").trim();
    const direccion = (document.getElementById("direccion")?.value || "").trim();
    const codigoPostal = (document.getElementById("codigoPostal")?.value || "").trim();

    // Validación
    const errores = [];

    if (!tipoRegistro || !pais || !provincia || !ciudad || !usuario || !password || !confirmPassword || !nombre || !apellido || !sexo || !fechaNacimiento || !tipoDocumento || !numeroDocumento || !email || !celular || !direccion) {
      errores.push("Debes completar todos los campos obligatorios.");
    }

    const userRegex = /^[a-zA-Z0-9_]{4,}$/;
    if (!userRegex.test(usuario)) {
      errores.push("El nombre de usuario debe tener al menos 4 caracteres y solo puede contener letras, números o guión bajo.");
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      errores.push("La contraseña debe tener al menos 8 caracteres, una letra y un número.");
    }

    if (password !== confirmPassword) {
      errores.push("Las contraseñas no coinciden.");
    }

    const numericRegex = /^[0-9]+$/;
    if (!numericRegex.test(numeroDocumento)) {
      errores.push("El número de documento debe contener solo números.");
    }
    if (!numericRegex.test(celular)) {
      errores.push("El celular debe contener solo números.");
    }

    // Validar ubicación
    if (!provincia) {
      errores.push("Debes seleccionar un departamento.");
    }
    if (!ciudad) {
      errores.push("Debes seleccionar una ciudad/municipio.");
    }
    if (provincia && ciudad && window.locationAutocomplete && !window.locationAutocomplete.validateCity()) {
      errores.push("La ciudad seleccionada no pertenece al departamento indicado.");
    }

    // Validar patrocinador
    const sponsorOk = await verifySponsorExists(patrocinador);
    if (!sponsorOk) {
      errores.push("El código del patrocinador no es válido.");
    }

    // Validar nombre de usuario único
    const usernameTaken = await isUsernameTaken(usuario);
    if (usernameTaken) {
      errores.push("El nombre de usuario ya está en uso. Elige otro.");
    }

    if (errores.length > 0) {
      // Ocultar loading y rehabilitar botón
      if (loadingOverlay) loadingOverlay.classList.remove('active');
      if (btnRegistrar) {
        btnRegistrar.disabled = false;
        btnRegistrar.textContent = 'Registrar';
      }
      
      Swal.fire({
        icon: 'error',
        title: 'Errores en el formulario',
        html: errores.map(err => `<p>• ${err}</p>`).join('')
      });
      return;
    }

    // Si todo está correcto, registrar
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      await setDoc(doc(db, "usuarios", uid), {
        tipoRegistro,
        pais,
        provincia,
        ciudad,
        usuario,
        nombre,
        apellido,
        sexo,
        fechaNacimiento,
        tipoDocumento,
        numeroDocumento,
        patrocinador,
        email,
        celular,
        direccion,
        codigoPostal,
        role: tipoRegistro === 'administrador' ? 'admin' : tipoRegistro,
        creadoEn: new Date(),
        puntos: 0,
        personalPoints: 0,
        groupPoints: 0,
        balance: 0,
        walletBalance: 0
      });

      // Ocultar loading (mantener botón deshabilitado hasta redirección)
      if (loadingOverlay) loadingOverlay.classList.remove('active');
      
      // Confirmación y redirección
      Swal.fire({
        icon: 'success',
        title: 'Registro exitoso',
        text: 'Tu cuenta ha sido creada correctamente.',
        confirmButtonText: 'Iniciar sesión'
      }).then(() => {
        // ruta relativa: register.html está en raíz y distribuidor-login.html también
        window.location.href = "distribuidor-login.html";
      });

    } catch (error) {
      console.error("Error en el registro:", error);
      
      // Ocultar loading y rehabilitar botón
      if (loadingOverlay) loadingOverlay.classList.remove('active');
      if (btnRegistrar) {
        btnRegistrar.disabled = false;
        btnRegistrar.textContent = 'Registrar';
      }
      
      let msg = "Error al registrar usuario.";

      if (error.code === "auth/email-already-in-use") {
        msg = "El correo electrónico ya está registrado.";
      } else if (error.code === "auth/invalid-email") {
        msg = "El correo electrónico no es válido.";
      } else if (error.code === "auth/weak-password") {
        msg = "La contraseña es demasiado débil.";
      }

      Swal.fire({
        icon: 'error',
        title: 'Error al registrar',
        text: msg
      });
    }
  });
}
