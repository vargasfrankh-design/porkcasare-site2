// oficina-virtual/js/productos.js (parcheado)
// Versión: la creación de orden solo ocurre cuando el usuario confirma en el modal grande.
// No hay writes en la BD al pulsar 'Aceptar' del modal pequeño ni al cerrar el modal grande.
// Autor: parche aplicado por asistente
//
// === FÓRMULAS DE COMISIONES Y PUNTOS ===
//
// SISTEMA BASE:
//   - Paquete base: 3 kg = 10 puntos = 60,000 COP
//   - Por lo tanto: 1 kg = 10/3 ≈ 3.333 puntos
//   - Valor de cada punto: 2,800 COP
//
// CLIENTES:
//   - Pagan 25% más que el precio distribuidor por 3 kg → 60,000 × 1.25 = 75,000 por paquete
//   - No generan puntos ni comisiones
//
// DISTRIBUIDORES:
//   - Compran paquete de 3 kg = 10 puntos = 60,000 COP
//   - Comisiones:
//     - Cada uno de los 5 uplines recibe 1 punto
//     - Pago por upline = 1 × 2,800 = 2,800 COP
//     - Pago total sistema = 5 × 2,800 = 14,000 COP
//
// RESTAURANTES:
//   - Pueden comprar kilos arbitrarios, ejemplo: 2 kg
//   - Conversión kilos → puntos: 2 kg × 10/3 = 6.6667 puntos
//   - Cada upline recibe 0.05 puntos por cada punto generado:
//     - 6.6667 × 0.05 = 0.3333 puntos
//     - Pago por upline = 0.3333 × 2,800 ≈ 933.33 COP
//     - Pago total sistema = 5 × 933.33 ≈ 4,666.67 COP
//
// FÓRMULAS UNIVERSALES:
//   - Puntos totales = kilos × 10/3
//   - Puntos por upline (restaurantes) = puntos_totales × 0.05
//   - Pago por upline = puntos_por_upline × 2800
//   - Pago total sistema = pago_por_upline × 5

import { auth, db } from "/src/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  getDocs,
  arrayUnion,
  increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const POINT_VALUE = 2800;
const POINTS_PER_PACKAGE = 10;
const POINTS_PER_KG = 10 / 3;
const POINTS_PER_UPLINE_DISTRIBUTOR = 1;
const POINTS_PER_UPLINE_RESTAURANT_RATE = 0.05;
const MAX_UPLINE_LEVELS = 5;

let productos = [];

async function loadProductsFromFirestore() {
  try {
    const productsSnap = await getDocs(collection(db, "productos"));
    productos = productsSnap.docs
      .map(d => ({ docId: d.id, ...d.data() }))
      .filter(p => !p.deleted && !p.hidden);
    
    console.log('Productos cargados desde Firestore:', productos.length);
  } catch (err) {
    console.error('Error loading products from Firestore:', err);
    productos = [];
  }
}

async function loadCategoriesIntoSelector() {
  try {
    const categoriesSnap = await getDocs(collection(db, "categorias"));
    const categorySelector = document.getElementById('categorySelector');
    
    if (!categorySelector) return;
    
    const categories = categoriesSnap.docs.map(d => d.data());
    
    categorySelector.innerHTML = '<option value="todas">Todas las categorías</option>';
    
    categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.slug;
      option.textContent = cat.nombre;
      categorySelector.appendChild(option);
    });
    
    console.log('Categorías cargadas:', categories.length);
  } catch (err) {
    console.error('Error loading categories:', err);
  }
}

function formatCOP(num) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0
  }).format(num);
}

function onQuantityChange(e) {
  const prodId = e.currentTarget.dataset.id;
  const prod = productos.find((p) => p.id === prodId);
  if (!prod) return;

  const card = document.querySelector(`.product-card[data-id="${prodId}"]`);
  const input = card.querySelector('.qty-input');
  let quantity = parseInt(input.value) || 1;

  if (e.currentTarget.classList.contains('qty-minus')) {
    quantity = Math.max(1, quantity - 1);
  } else if (e.currentTarget.classList.contains('qty-plus')) {
    quantity = Math.min(99, quantity + 1);
  } else {
    quantity = Math.max(1, Math.min(99, quantity));
  }

  input.value = quantity;

  const unitPrice = getDisplayPrice(prod);
  const totalPrice = unitPrice * quantity;
  const totalPriceEl = card.querySelector('.total-price');
  totalPriceEl.innerHTML = `<strong>Total: ${formatCOP(totalPrice)}</strong>`;
}

const CLIENTE_PRICE_MULTIPLIER = 1.25;
const DISTRIBUIDOR_PRICE_MULTIPLIER = 1.0;

function getDisplayPrice(prod){
  const tipo = (window.currentTipoRegistro || 'distribuidor').toLowerCase();
  if(tipo === 'restaurante'){
    if(typeof prod.precioRestaurante === 'number') return prod.precioRestaurante;
    return prod.precio;
  }
  if(tipo === 'distribuidor'){
    if(typeof prod.precioDistribuidor === 'number') return prod.precioDistribuidor;
    return Math.round(prod.precio * DISTRIBUIDOR_PRICE_MULTIPLIER);
  }
  if(tipo === 'cliente'){
    if(typeof prod.precioCliente === 'number') return prod.precioCliente;
    return Math.round(prod.precio * CLIENTE_PRICE_MULTIPLIER);
  }
  return prod.precio;
}

function getFilteredProducts(){
  const tipo = (window.currentTipoRegistro || 'distribuidor').toLowerCase();
  const selectedCategory = window.selectedCategory || 'todas';
  
  return productos.filter(prod => {
    if (!prod.availableFor) return true;
    const matchesType = prod.availableFor.includes(tipo);
    const matchesCategory = selectedCategory === 'todas' || prod.categoria === selectedCategory;
    return matchesType && matchesCategory;
  });
}

async function findUserByUsername(username) {
  if (!username) return null;
  const usuariosCol = collection(db, "usuarios");
  const q = query(usuariosCol, where("usuario", "==", username));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, data: docSnap.data() };
}

async function distributePointsUpline(startSponsorCode, pointsEarned, buyerUsername, orderId, buyerType = 'distribuidor') {
  try {
    let sponsorCode = startSponsorCode;
    const isRestaurant = buyerType === 'restaurante';
    
    for (let level = 0; level < MAX_UPLINE_LEVELS; level++) {
      if (!sponsorCode) break;
      const sponsor = await findUserByUsername(sponsorCode);
      if (!sponsor) break;

      const sponsorRef = doc(db, "usuarios", sponsor.id);

      let pointsToDistribute;
      if (isRestaurant) {
        pointsToDistribute = Math.round((pointsEarned * POINTS_PER_UPLINE_RESTAURANT_RATE) * 100) / 100;
      } else {
        pointsToDistribute = POINTS_PER_UPLINE_DISTRIBUTOR;
      }
      
      const commissionValue = Math.round(pointsToDistribute * POINT_VALUE);

      await updateDoc(sponsorRef, {
        groupPoints: increment(pointsToDistribute),
        balance: increment(commissionValue),
        history: arrayUnion({
          action: `Comisión nivel ${level + 1} por compra de ${buyerUsername}`,
          amount: commissionValue,
          points: pointsToDistribute,
          orderId,
          date: new Date().toISOString(),
          originMs: Date.now()
        })
      });

      sponsorCode = sponsor.data.patrocinador || null;
    }
  } catch (err) {
    console.error("Error distribuyendo puntos:", err);
  }
}

function renderProductos() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  const filteredProducts = getFilteredProducts();
  const tipo = (window.currentTipoRegistro || 'distribuidor').toLowerCase();
  const unitLabel = tipo === 'restaurante' ? 'kilo' : 'paquete';

  if (filteredProducts.length === 0) {
    grid.innerHTML = '<p style="text-align:center;color:#666;padding:20px;">No hay productos disponibles en esta categoría.</p>';
    return;
  }

  grid.innerHTML = filteredProducts.map((prod) => {
    const isOutOfStock = prod.outOfStock || false;
    const outOfStockBadge = isOutOfStock ? '<span style="position:absolute;top:12px;right:12px;background:#fd7e14;color:white;padding:4px 8px;border-radius:4px;font-size:11px;font-weight:600;">AGOTADO</span>' : '';
    const disabledStyle = isOutOfStock ? 'opacity:0.6;pointer-events:none;' : '';
    const buttonText = isOutOfStock ? 'No Disponible' : 'Comprar';
    
    return `
      <div class="product-card" data-id="${prod.id}" style="position:relative;${disabledStyle}">
        ${outOfStockBadge}
        <img src="${prod.imagen}" alt="${prod.nombre}">
        <h4>${prod.nombre}</h4>
        <p>${prod.descripcion}</p>
        <p class="unit-price"><strong>${formatCOP(getDisplayPrice(prod))}</strong> por ${prod.unit || 'paquete'}</p>
        <div class="quantity-selector">
          <button class="qty-btn qty-minus" data-id="${prod.id}" aria-label="Disminuir cantidad" ${isOutOfStock ? 'disabled' : ''}>−</button>
          <input type="number" class="qty-input" data-id="${prod.id}" value="1" min="1" max="99" readonly ${isOutOfStock ? 'disabled' : ''}>
          <button class="qty-btn qty-plus" data-id="${prod.id}" aria-label="Aumentar cantidad" ${isOutOfStock ? 'disabled' : ''}>+</button>
        </div>
        <p class="total-price" data-id="${prod.id}"><strong>Total: ${formatCOP(getDisplayPrice(prod))}</strong></p>
        <button class="btn small btn-buy" data-id="${prod.id}" ${isOutOfStock ? 'disabled' : ''}>${buttonText}</button>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".qty-minus").forEach((btn) => {
    btn.addEventListener("click", onQuantityChange);
  });
  
  document.querySelectorAll(".qty-plus").forEach((btn) => {
    btn.addEventListener("click", onQuantityChange);
  });
  
  document.querySelectorAll(".qty-input").forEach((input) => {
    input.addEventListener("change", onQuantityChange);
  });

  document.querySelectorAll(".btn-buy").forEach((btn) => {
    btn.addEventListener("click", onBuyClick);
  });
}

// --- Modal grande para que el cliente edite y confirme sus datos ---
// Incluye opción de 'A domicilio' o 'Recoger en oficina'
function showCustomerFormModal(initial = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.style.zIndex = '10000';
    overlay.style.backdropFilter = 'blur(3px)';

    const box = document.createElement('div');
    box.style.width = 'min(900px, 96%)';
    box.style.maxHeight = '90vh';
    box.style.overflow = 'auto';
    box.style.padding = '22px';
    box.style.borderRadius = '14px';
    box.style.boxShadow = '0 18px 50px rgba(0,0,0,0.35)';
    box.style.background = 'linear-gradient(180deg,#ffffff,#f8fafc)';
    box.style.fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';

    const title = document.createElement('h2');
    title.textContent = 'Completa tus datos para finalizar la compra';
    title.style.margin = '0 0 10px 0';
    title.style.fontSize = '20px';
    title.style.fontWeight = '700';
    box.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Revisa o edita la información que usaremos para procesar tu pedido.';
    subtitle.style.margin = '0 0 12px 0';
    subtitle.style.color = '#374151';
    box.appendChild(subtitle);

    // --- Delivery method radios ---
    const deliveryWrapper = document.createElement('div');
    deliveryWrapper.style.display = 'flex';
    deliveryWrapper.style.alignItems = 'center';
    deliveryWrapper.style.gap = '12px';
    deliveryWrapper.style.marginBottom = '12px';

    const labelDM = document.createElement('span');
    labelDM.textContent = 'Entrega:';
    labelDM.style.fontWeight = '600';
    labelDM.style.color = '#111827';
    deliveryWrapper.appendChild(labelDM);

    const createRadio = (value, text) => {
      const id = `dm-${value}-${Date.now() + Math.floor(Math.random()*1000)}`;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'deliveryMethod';
      radio.value = value;
      radio.id = id;

      const lab = document.createElement('label');
      lab.htmlFor = id;
      lab.textContent = text;
      lab.style.marginRight = '8px';
      lab.style.cursor = 'pointer';

      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.gap = '6px';
      container.appendChild(radio);
      container.appendChild(lab);
      return { container, radio };
    };

    const dmHome = createRadio('home', 'A domicilio');
    const dmPickup = createRadio('pickup', 'Recoger en oficina');

    deliveryWrapper.appendChild(dmHome.container);
    deliveryWrapper.appendChild(dmPickup.container);
    box.appendChild(deliveryWrapper);

    // --- Form ---
    const form = document.createElement('form');
    form.style.display = 'grid';
    form.style.gridTemplateColumns = '1fr 1fr';
    form.style.gap = '12px';

    const createField = (name, label, value = '', placeholder = '') => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';

      const lab = document.createElement('label');
      lab.textContent = label;
      lab.style.fontSize = '13px';
      lab.style.marginBottom = '6px';
      lab.style.color = '#111827';
      wrapper.appendChild(lab);

      const input = document.createElement('input');
      input.name = name;
      input.value = value || '';
      input.placeholder = placeholder;
      input.style.padding = '10px 12px';
      input.style.border = '1px solid rgba(15,23,42,0.08)';
      input.style.borderRadius = '8px';
      input.style.fontSize = '14px';
      input.style.outline = 'none';
      input.addEventListener('focus', () => input.style.boxShadow = '0 6px 18px rgba(16,185,129,0.12)');
      input.addEventListener('blur', () => input.style.boxShadow = 'none');
      wrapper.appendChild(input);

      return { wrapper, input };
    };

    const fNombre = createField('firstName', 'Nombre', initial.firstName || initial.nombre || '', 'Tu nombre');
    const fApellido = createField('lastName', 'Apellido', initial.lastName || initial.apellido || '', 'Tu apellido');
    const fEmail = createField('email', 'Correo electrónico', initial.email || '', 'tucorreo@ejemplo.com');
    const fTelefono = createField('phone', 'Teléfono', initial.phone || initial.telefono || '', '+57 300 0000000');
    const fDireccion = createField('address', 'Dirección', initial.address || initial.direccion || '', 'Calle, número, barrio');
    const fCiudad = createField('city', 'Ciudad', initial.city || '', 'Ciudad');

    form.appendChild(fNombre.wrapper);
    form.appendChild(fApellido.wrapper);
    form.appendChild(fEmail.wrapper);
    form.appendChild(fTelefono.wrapper);
    form.appendChild(fDireccion.wrapper);
    form.appendChild(fCiudad.wrapper);

    const notasWrapper = document.createElement('div');
    notasWrapper.style.gridColumn = '1 / -1';
    const labNotas = document.createElement('label');
    labNotas.textContent = 'Notas (opcional)';
    labNotas.style.fontSize = '13px';
    labNotas.style.marginBottom = '6px';
    notasWrapper.appendChild(labNotas);
    const ta = document.createElement('textarea');
    ta.name = 'notes';
    ta.placeholder = 'Instrucciones para la entrega, referencia, etc.';
    ta.value = initial.notes || '';
    ta.style.minHeight = '84px';
    ta.style.padding = '10px 12px';
    ta.style.borderRadius = '8px';
    ta.style.border = '1px solid rgba(15,23,42,0.08)';
    ta.style.fontSize = '14px';
    notasWrapper.appendChild(ta);
    form.appendChild(notasWrapper);

    box.appendChild(form);

    // Pickup info area (hidden unless pickup)
    const pickupInfo = document.createElement('div');
    pickupInfo.style.marginTop = '10px';
    pickupInfo.style.padding = '10px';
    pickupInfo.style.borderRadius = '8px';
    pickupInfo.style.background = 'rgba(15,23,42,0.03)';
    pickupInfo.style.fontSize = '13px';
    pickupInfo.style.color = '#111827';
    pickupInfo.innerHTML = `
      <strong>Recoger en oficina:</strong> Puedes recoger tu pedido en nuestra oficina principal.
      <br>Dirección: Carrera 14 #21 04, Ciudad Yopal.
      <br>Horario: Lun-Sab 7:00 - 17:00.
    `;
    pickupInfo.style.display = 'none';
    box.appendChild(pickupInfo);

    // Determine initial delivery method
    const initialDM = initial.deliveryMethod || initial.delivery || 'home';
    if (initialDM === 'pickup') {
      dmPickup.radio.checked = true;
      pickupInfo.style.display = 'block';
      fDireccion.wrapper.style.display = 'none';
      fCiudad.wrapper.style.display = 'none';
    } else {
      dmHome.radio.checked = true;
      pickupInfo.style.display = 'none';
      fDireccion.wrapper.style.display = '';
      fCiudad.wrapper.style.display = '';
    }

    // When delivery method changes, show/hide address fields
    const updateDeliveryUI = (method) => {
      if (method === 'pickup') {
        pickupInfo.style.display = 'block';
        fDireccion.wrapper.style.display = 'none';
        fCiudad.wrapper.style.display = 'none';
      } else {
        pickupInfo.style.display = 'none';
        fDireccion.wrapper.style.display = '';
        fCiudad.wrapper.style.display = '';
      }
    };
    dmHome.radio.addEventListener('change', () => updateDeliveryUI('home'));
    dmPickup.radio.addEventListener('change', () => updateDeliveryUI('pickup'));

    // Buttons
    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.justifyContent = 'flex-end';
    buttons.style.gap = '10px';
    buttons.style.marginTop = '16px';

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.textContent = 'Cancelar';
    btnCancel.style.padding = '10px 14px';
    btnCancel.style.borderRadius = '10px';
    btnCancel.style.border = '1px solid rgba(15,23,42,0.06)';
    btnCancel.style.background = 'transparent';
    btnCancel.style.cursor = 'pointer';
    btnCancel.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(null);
    });

    const btnConfirm = document.createElement('button');
    btnConfirm.type = 'button';
    btnConfirm.textContent = 'Confirmar y pagar (Efectivo/Transferencia)';
    btnConfirm.style.padding = '10px 16px';
    btnConfirm.style.border = 'none';
    btnConfirm.style.borderRadius = '10px';
    btnConfirm.style.background = 'linear-gradient(90deg,#34D399,#10B981)';
    btnConfirm.style.color = 'white';
    btnConfirm.style.cursor = 'pointer';
    btnConfirm.style.fontWeight = '700';

    btnConfirm.addEventListener('click', () => {
      const deliveryMethod = dmPickup.radio.checked ? 'pickup' : 'home';

      const payload = {
        firstName: fNombre.input.value.trim(),
        lastName: fApellido.input.value.trim(),
        email: fEmail.input.value.trim(),
        phone: fTelefono.input.value.trim(),
        address: fDireccion.input.value.trim(),
        city: fCiudad.input.value.trim(),
        notes: ta.value.trim(),
        deliveryMethod
      };

      // Validaciones
      if (!payload.firstName) { alert('Por favor ingresa tu nombre.'); fNombre.input.focus(); return; }
      if (!payload.email || !/\S+@\S+\.\S+/.test(payload.email)) { alert('Por favor ingresa un correo válido.'); fEmail.input.focus(); return; }
      if (!payload.phone) { alert('Por favor ingresa un teléfono de contacto.'); fTelefono.input.focus(); return; }
      if (deliveryMethod === 'home' && !payload.address) { alert('Por favor ingresa la dirección de entrega.'); fDireccion.input.focus(); return; }
      if (deliveryMethod === 'home' && !payload.city) { alert('Por favor ingresa la ciudad.'); fCiudad.input.focus(); return; }

      // Si es pickup, opcionalmente crear un campo que marque la oficina
      if (deliveryMethod === 'pickup') {
        payload.pickupLocation = {
          name: 'Oficina PorkCasaRe',
          address: 'Calle 123 #45-67, Ciudad',
          hours: 'Lun-Vie 9:00 - 17:00'
        };
        // limpiar address fields o mantener para registro
        // payload.address = payload.address || '';
      }

      document.body.removeChild(overlay);
      resolve(payload);
    });

    buttons.appendChild(btnCancel);
    buttons.appendChild(btnConfirm);
    box.appendChild(buttons);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    setTimeout(() => fNombre.input.focus(), 120);
  });
}

async function onBuyClick(e) {
  if (!auth.currentUser) {
    alert("Debes iniciar sesión para comprar.");
    window.location.href = "distribuidor-login.html";
    return;
  }

  const prodId = e.currentTarget.dataset.id;
  const prod = productos.find((p) => p.id === prodId);
  if (!prod) return;

  const card = document.querySelector(`.product-card[data-id="${prodId}"]`);
  const quantityInput = card.querySelector('.qty-input');
  const quantity = parseInt(quantityInput.value) || 1;

  const buyerUid = auth.currentUser.uid;

  // Intentar obtener perfil para prefill (NO crear orden aquí)
  let initialBuyerProfile = {};
  try {
    const userDoc = await getDoc(doc(db, "usuarios", buyerUid));
    if (userDoc.exists()) initialBuyerProfile = userDoc.data();
  } catch (err) {
    console.warn("No se pudo leer perfil del usuario para prefill:", err);
  }

  // ---------- Modal pequeño (Aceptar = Efectivo/Transferencia). Solo visual, NO DB ----------
  await new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('id','payment-modal-overlay');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.style.zIndex = '9999';
    overlay.style.backdropFilter = 'blur(2px)';

    const box = document.createElement('div');
    box.style.maxWidth = '420px';
    box.style.width = '90%';
    box.style.padding = '20px';
    box.style.borderRadius = '12px';
    box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
    box.style.background = 'linear-gradient(180deg, #ffffff, #fbfbfb)';
    box.style.textAlign = 'center';
    box.style.fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';

    const h = document.createElement('h3');
    h.textContent = 'Confirmar compra';
    h.style.margin = '0 0 8px 0';
    h.style.fontSize = '18px';
    h.style.fontWeight = '700';
    box.appendChild(h);

    const p = document.createElement('p');
    p.innerHTML = 'Método de pago: <strong>Efectivo o Transferencia</strong>';
    p.style.margin = '0 0 18px 0';
    p.style.fontSize = '14px';
    p.style.color = '#333';
    box.appendChild(p);

    const btn = document.createElement('button');
    btn.textContent = 'Aceptar';
    btn.style.padding = '10px 18px';
    btn.style.border = 'none';
    btn.style.borderRadius = '10px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = '600';
    btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)';
    btn.style.background = 'linear-gradient(90deg,#34D399,#10B981)';
    btn.style.color = 'white';
    btn.addEventListener('mouseenter', ()=> btn.style.transform='translateY(-1px)');
    btn.addEventListener('mouseleave', ()=> btn.style.transform='translateY(0)');
    btn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve();
    });

    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });

  // ---------- Modal grande: pedir/editar datos del cliente (devuelve payload o null) ----------
  const customerData = await showCustomerFormModal(initialBuyerProfile);
  if (!customerData) {
    // usuario canceló en modal grande -> NO guardamos nada
    return;
  }

  // ---------- Aquí SÍ creamos la orden en Firestore (único punto) ----------
  try {
    const buyerDocSnap = await getDoc(doc(db, "usuarios", buyerUid));
    const buyerData = buyerDocSnap.exists() ? buyerDocSnap.data() : null;
    const buyerUsername = buyerData?.usuario || buyerData?.nombre || 'Usuario desconocido';
    const buyerType = (buyerData?.tipoRegistro || 'distribuidor').toLowerCase();
    
    const unitPrice = getDisplayPrice(prod);
    const totalPrice = unitPrice * quantity;
    const totalPoints = prod.puntos * quantity;

    const orderObj = {
      productId: prod.id,
      productName: prod.nombre,
      price: unitPrice,
      quantity: quantity,
      totalPrice: totalPrice,
      points: prod.puntos,
      totalPoints: totalPoints,
      buyerUid,
      buyerUsername,
      buyerType,
      buyerInfo: customerData,
      deliveryMethod: customerData.deliveryMethod === 'pickup' ? 'pickup' : 'home',
      entrega: customerData.deliveryMethod === 'pickup' ? 'oficina' : 'domicilio',
      direccion: customerData.deliveryMethod === 'pickup' ? null : (customerData.address || null),
      telefono: customerData.deliveryMethod === 'pickup' ? (customerData.phone || null) : (customerData.phone || null),
      observaciones: customerData.notes || '',
      status: "pending_delivery",
      createdAt: new Date().toISOString(),
      isInitial: prod.id === "paquete-inicio",
      initialBonusPaid: false,
      paymentMethod: "efectivo_transferencia"
    };

    // Si pickup, añadir pickupInfo
    if (customerData.deliveryMethod === 'pickup') {
      orderObj.pickupInfo = customerData.pickupLocation || {
        name: 'Oficina PorkCasaRe',
        address: 'Calle 123 #45-67, Ciudad',
        hours: 'Lun-Vie 9:00 - 17:00'
      };
      orderObj.buyerInfo.address = orderObj.pickupInfo.address;
    }

    // Crear la orden (AQUÍ se crea la doc)
    const orderRef = await addDoc(collection(db, "orders"), orderObj);

    // ------ Post-procesamiento: bono rápido, distribute points, historial ------
    try {
      const sponsorCode = buyerData ? buyerData.patrocinador : null;

      // NO agregamos puntos aquí - solo se agregan cuando el admin confirma la compra
      // Solo guardamos el historial de la compra pendiente
      await updateDoc(doc(db, "usuarios", buyerUid), {
        history: arrayUnion({
          action: `Compra pendiente: ${prod.nombre} (x${quantity})`,
          amount: totalPrice,
          points: totalPoints,
          quantity: quantity,
          orderId: orderRef.id,
          date: new Date().toISOString(),
          type: "pending_purchase"
        })
      });
    } catch (err) {
      console.error("Error en post-procesamiento de la orden:", err);
    }

    // Éxito: redirigir a página de éxito (puedes ajustar la ruta)
    alert("✅ Pedido creado correctamente.");
    window.location.href = `/oficina-virtual/index.html?orderId=${encodeURIComponent(orderRef.id)}`;
    return;
  } catch (err) {
    console.error("Error creando la orden:", err);
    alert("Ocurrió un error al crear la orden. Intenta de nuevo.");
    return;
  }
}


// Asegurar que los productos se rendericen también cuando se dispare personalPointsReady
document.addEventListener('personalPointsReady', async (e) => {
  try {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      await loadProductsFromFirestore();
      renderProductos();
    }
  } catch (err) {
    console.warn('personalPointsReady listener error:', err);
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadProductsFromFirestore();
  await loadCategoriesIntoSelector();
  renderProductos();
  
  const categorySelector = document.getElementById('categorySelector');
  if (categorySelector) {
    categorySelector.addEventListener('change', (e) => {
      window.selectedCategory = e.target.value;
      renderProductos();
    });
  }
});

export { renderProductos };
