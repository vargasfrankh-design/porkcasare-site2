// oficina-virtual/js/productos.js (parcheado)
// Versión: la creación de orden solo ocurre cuando el usuario confirma en el modal grande.
// No hay writes en la BD al pulsar 'Aceptar' del modal pequeño ni al cerrar el modal grande.
// Autor: parche aplicado por asistente
//
// === SISTEMA DE BONOS Y COMISIONES ===
//
// IMPORTANTE: Los bonos y comisiones se calculan y distribuyen SOLO en el backend
// (netlify/functions/confirm-order.js) cuando el administrador confirma la orden.
// Este archivo frontend solo crea la orden con status "pending_delivery".
//
// SISTEMA BASE:
//   - Valor por punto: 2,800 COP
//   - Cada producto tiene su propio precio y puntos configurados por el administrador
//   - No existe un precio base universal
//
// CLIENTES:
//   - Pagan el precio de cliente configurado en el producto
//   - Generan comisión por diferencia de precio solo al patrocinador directo
//   - Comisión = (Precio Cliente - Precio Distribuidor) × cantidad
//   - Se convierte a puntos usando: diferencia / 2,800
//
// DISTRIBUIDORES:
//   - Pagan el precio de distribuidor configurado
//   - Compras normales: cada upline recibe 10% del valor total
//   - Primera compra ≥50 puntos: Quick Start Bonus (21 puntos al directo, 1 a cada uno de 4 niveles superiores)
//
// RESTAURANTES:
//   - Compran por kilos con precio y puntos por kilo configurados
//   - Cada upline recibe 5% de los puntos totales (no se divide, cada uno recibe el 5% completo)
//   - Ejemplo: 18 kg × 3.333 pts/kg = 60 pts → 5% = 3 pts por upline → 3 × 2,800 = 8,400 COP c/u

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
import { initializeCartUI, cart } from "./cart.js";
import { createPayment, handlePaymentReturn, formatCurrency } from "/src/mercadopago-client.js";

const POINT_VALUE = 2800;
const POINTS_PER_PACKAGE = 10;
const POINTS_PER_KG = 10 / 3;

// MercadoPago payment gateway fee configuration
// This percentage is added to the total when the customer selects MercadoPago as payment method
// The fee ensures the merchant receives 100% of the product value
const MERCADOPAGO_FEE_PERCENTAGE = 5.8; // 5.8% - easily modifiable for future adjustments

/**
 * Calculate MercadoPago payment gateway fee
 * @param {number} amount - The base amount to calculate the fee for
 * @returns {number} The fee amount (rounded to nearest integer)
 */
function calculateMercadoPagoFee(amount) {
  return Math.round(amount * (MERCADOPAGO_FEE_PERCENTAGE / 100));
}

// Shipping cost constants (legacy fallbacks)
const SHIPPING_COST_YOPAL = 5000;      // $5,000 COP for Yopal (legacy)
const SHIPPING_COST_OTHER = 16000;     // $16,000 COP for other cities (legacy)
const SHIPPING_COST_PICKUP = 0;        // Free for office pickup

// Default UE-based shipping rates
const DEFAULT_SHIPPING_RATES = {
  yopal: {
    '1_5': 5000,
    '6_10': 8000,
    '11_plus': 12000
  },
  other: {
    '1_3': 16000,
    '4_6': 22000,
    '7_10': 30000,
    '11_15': 40000,
    '16_plus': 50000
  }
};

// Global shipping rates (loaded from Firestore)
let shippingRates = { ...DEFAULT_SHIPPING_RATES };

// Promotional codes cache
let promoCodes = [];

/**
 * Load promotional codes from Firestore config
 */
async function loadPromoCodes() {
  try {
    const configRef = doc(db, "config", "promoCodes");
    const configSnap = await getDoc(configRef);

    if (configSnap.exists()) {
      const data = configSnap.data();
      promoCodes = data.codes || [];
      console.log('✅ Promotional codes loaded:', promoCodes.length);
    } else {
      promoCodes = [];
      console.log('ℹ️ No promotional codes configured');
    }
  } catch (err) {
    console.warn('Error loading promo codes:', err);
    promoCodes = [];
  }
}

/**
 * Validate a promotional code
 * @param {string} code - The promotional code to validate
 * @param {string} city - The delivery city (optional, for city-specific codes)
 * @param {Array} cartItems - Cart items for product-specific validation (optional)
 * @returns {Object} - { valid: boolean, message: string, code: object|null }
 */
function validatePromoCode(code, city = '', cartItems = []) {
  if (!code || code.trim() === '') {
    return { valid: false, message: 'Ingresa un código promocional', code: null };
  }

  const normalizedCode = code.trim().toUpperCase();
  const promoCode = promoCodes.find(p => p.code.toUpperCase() === normalizedCode && p.active);

  if (!promoCode) {
    return { valid: false, message: 'Código inválido o expirado', code: null };
  }

  // Check expiration date
  if (promoCode.expirationDate) {
    const expDate = new Date(promoCode.expirationDate);
    if (expDate < new Date()) {
      return { valid: false, message: 'Este código ha expirado', code: null };
    }
  }

  // Check usage limit (global)
  if (promoCode.usageLimit && promoCode.usageCount >= promoCode.usageLimit) {
    return { valid: false, message: 'Este código ha alcanzado su límite de uso', code: null };
  }

  // Check city restrictions
  if (promoCode.cities && promoCode.cities.length > 0) {
    const normalizedCity = (city || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const allowedCities = promoCode.cities.map(c => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim());

    if (!allowedCities.some(c => normalizedCity.includes(c) || c.includes(normalizedCity))) {
      return { valid: false, message: 'Este código no aplica para tu ciudad', code: null };
    }
  }

  // Check product restrictions
  if (promoCode.products && promoCode.products.length > 0 && cartItems.length > 0) {
    const cartProductIds = cartItems.map(item => item.product?.id || item.productId || item.id);
    const hasValidProduct = promoCode.products.some(pid => cartProductIds.includes(pid));

    if (!hasValidProduct) {
      return { valid: false, message: 'Este código no aplica para los productos seleccionados', code: null };
    }
  }

  return {
    valid: true,
    message: 'Envío gratuito aplicado',
    code: promoCode
  };
}

/**
 * Load shipping rates from Firestore config
 */
async function loadShippingRates() {
  try {
    const configRef = doc(db, "config", "shippingRates");
    const configSnap = await getDoc(configRef);

    if (configSnap.exists()) {
      const data = configSnap.data();
      shippingRates = {
        yopal: data.yopal || DEFAULT_SHIPPING_RATES.yopal,
        other: data.other || DEFAULT_SHIPPING_RATES.other
      };
      console.log('✅ Shipping rates loaded from config');
    } else {
      shippingRates = { ...DEFAULT_SHIPPING_RATES };
      console.log('ℹ️ Using default shipping rates');
    }
  } catch (err) {
    console.warn('Error loading shipping rates, using defaults:', err);
    shippingRates = { ...DEFAULT_SHIPPING_RATES };
  }
}

/**
 * Calculate shipping cost based on total UE and city
 * @param {number} totalUE - Total shipping units for the order
 * @param {string} city - Destination city
 * @param {string} deliveryMethod - 'home' or 'pickup'
 * @returns {number} - Shipping cost in COP
 */
function calculateShippingCostByUE(totalUE, city, deliveryMethod) {
  if (deliveryMethod === 'pickup') {
    return SHIPPING_COST_PICKUP;
  }

  // If totalUE is 0 or invalid, use legacy calculation
  if (!totalUE || totalUE <= 0) {
    return calculateShippingCost(city, deliveryMethod);
  }

  // Normalize city name for comparison (remove accents, lowercase)
  const normalizedCity = (city || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const isYopal = normalizedCity === 'yopal' || normalizedCity.includes('yopal');

  if (isYopal) {
    // Yopal rates based on UE
    if (totalUE <= 5) return shippingRates.yopal['1_5'];
    if (totalUE <= 10) return shippingRates.yopal['6_10'];
    return shippingRates.yopal['11_plus'];
  } else {
    // Other cities rates based on UE
    if (totalUE <= 3) return shippingRates.other['1_3'];
    if (totalUE <= 6) return shippingRates.other['4_6'];
    if (totalUE <= 10) return shippingRates.other['7_10'];
    if (totalUE <= 15) return shippingRates.other['11_15'];
    return shippingRates.other['16_plus'];
  }
}

/**
 * Calculate total UE for a single product and quantity
 * @param {Object} product - Product object with shippingUnits field
 * @param {number} quantity - Quantity of the product
 * @returns {number} - Total UE for this product
 */
function getProductUE(product, quantity = 1) {
  const ue = product.shippingUnits || 2; // Default to 2 if not set
  return ue * quantity;
}

/**
 * Calculate total UE for multiple cart items
 * @param {Array} items - Array of cart items with product and quantity
 * @returns {number} - Total UE for all items
 */
function calculateTotalUE(items) {
  return items.reduce((total, item) => {
    const product = item.product || item;
    const quantity = item.quantity || 1;
    return total + getProductUE(product, quantity);
  }, 0);
}

/**
 * Get shipping message based on city
 * @param {string} city - Destination city
 * @returns {string} - Shipping message to display
 */
function getShippingMessage(city) {
  const normalizedCity = (city || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const isYopal = normalizedCity === 'yopal' || normalizedCity.includes('yopal');

  if (isYopal) {
    return 'Envío local Yopal – tarifa según pedido';
  }
  return 'Envío nacional calculado según ciudad de destino';
}

/**
 * Legacy: Calculate shipping cost based on user's city and delivery method
 * Used as fallback when UE is not available
 * @param {string} city - User's city
 * @param {string} deliveryMethod - 'home' or 'pickup'
 * @returns {number} - Shipping cost in COP
 */
function calculateShippingCost(city, deliveryMethod) {
  if (deliveryMethod === 'pickup') {
    return SHIPPING_COST_PICKUP;
  }

  // Normalize city name for comparison (remove accents, lowercase)
  const normalizedCity = (city || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  // Check if city is Yopal (with various possible spellings)
  if (normalizedCity === 'yopal' || normalizedCity.includes('yopal')) {
    return SHIPPING_COST_YOPAL;
  }

  return SHIPPING_COST_OTHER;
}

// NOTE: The following constants are LEGACY and NOT USED in the actual commission system
// All commission calculations happen server-side in netlify/functions/confirm-order.js
// These are kept for reference only
const POINTS_PER_UPLINE_DISTRIBUTOR = 1; // Legacy - not used
const POINTS_PER_UPLINE_RESTAURANT_RATE = 0.05; // Legacy - not used
const MAX_UPLINE_LEVELS = 5; // Legacy - not used

let productos = [];

// === OPTIMIZACIÓN: Cache de productos y categorías en sessionStorage ===
// Reduce lecturas de Firestore al navegar entre páginas en la misma sesión
const PRODUCTS_CACHE_KEY = 'productos_cache';
const CATEGORIES_CACHE_KEY = 'categorias_cache';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos de cache

function getFromSessionCache(key) {
  try {
    const cached = sessionStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[productos.js] Error leyendo cache:', e);
    return null;
  }
}

function setSessionCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) {
    console.warn('[productos.js] Error escribiendo cache:', e);
  }
}

async function loadProductsFromFirestore() {
  try {
    // Intentar obtener de cache primero
    const cachedProducts = getFromSessionCache(PRODUCTS_CACHE_KEY);
    if (cachedProducts && cachedProducts.length > 0) {
      productos = cachedProducts;
      console.log('[productos.js] Productos cargados desde cache:', productos.length);
      return;
    }

    // Si no hay cache, cargar de Firestore
    const productsSnap = await getDocs(collection(db, "productos"));
    productos = productsSnap.docs
      .map(d => ({ ...d.data(), docId: d.id, id: d.id }))
      .filter(p => !p.deleted && !p.hidden)
      .sort((a, b) => {
        // Priority 1: Launch products (Super Destacados) go first
        const aIsLaunch = a.isLaunchProduct && a.launchDate && new Date(a.launchDate).getTime() > Date.now();
        const bIsLaunch = b.isLaunchProduct && b.launchDate && new Date(b.launchDate).getTime() > Date.now();
        if (aIsLaunch && !bIsLaunch) return -1;
        if (!aIsLaunch && bIsLaunch) return 1;

        // Priority 2: Featured products come next
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return 0;
      });

    console.log('Productos cargados desde Firestore:', productos.length);
    // Guardar en cache para la próxima navegación
    setSessionCache(PRODUCTS_CACHE_KEY, productos);
    // Log unique categories for debugging
    const uniqueCategories = [...new Set(productos.map(p => p.categoria).filter(Boolean))];
    console.log('Categorías encontradas en productos:', uniqueCategories);
  } catch (err) {
    console.error('Error loading products from Firestore:', err);
    productos = [];
  }
}

async function loadCategoriesIntoSelector() {
  try {
    // Intentar obtener categorías de cache primero
    const cachedCategories = getFromSessionCache(CATEGORIES_CACHE_KEY);
    let categories;

    if (cachedCategories && cachedCategories.length > 0) {
      categories = cachedCategories;
      console.log('[productos.js] Categorías cargadas desde cache:', categories.length);
    } else {
      // Si no hay cache, cargar de Firestore
      const categoriesSnap = await getDocs(collection(db, "categorias"));
      categories = categoriesSnap.docs.map(d => d.data());
      // Guardar en cache
      setSessionCache(CATEGORIES_CACHE_KEY, categories);
      console.log('Categorías cargadas desde Firestore:', categories.length);
    }

    const categorySelector = document.getElementById('categorySelector');
    const categoryFiltersContainer = document.getElementById('categoryFilters');

    console.log('Categorías:', categories.map(c => ({ nombre: c.nombre, slug: c.slug })));

    if (categorySelector) {
      categorySelector.innerHTML = '<option value="todas">Todas las categorías</option>';

      categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.slug;
        option.textContent = cat.nombre;
        categorySelector.appendChild(option);
      });
    }

    // Also update the visual category filter buttons to match the database categories
    if (categoryFiltersContainer) {
      const categoryEmojis = {
        'carnes': '🥩', 'carnesf': '🥩',
        'bebidas': '🍷',
        'alimentos': '🍚',
        'aseo': '🧴',
        'higiene-personal': '🧼', 'higiene': '🧼',
        'abarrotes': '🛒'
      };

      // Update existing buttons to match database slugs
      const existingBtns = categoryFiltersContainer.querySelectorAll('.category-filter-btn[data-category]');
      existingBtns.forEach(btn => {
        const btnCategory = btn.getAttribute('data-category');
        if (btnCategory === 'todas') return; // Skip "Todas" button

        // Find matching category in database
        const matchingCat = categories.find(cat => {
          const slug = (cat.slug || '').toLowerCase();
          const btnCat = btnCategory.toLowerCase();
          return slug === btnCat || slug.startsWith(btnCat) || btnCat.startsWith(slug);
        });

        if (matchingCat) {
          // Update button's data-category to match the database slug
          btn.setAttribute('data-category', matchingCat.slug);
          console.log(`Actualizado botón ${btnCategory} a ${matchingCat.slug}`);
        }
      });
    }

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

/**
 * Get the selected variant price adjustment for a product card
 * @param {HTMLElement} card - The product card element
 * @returns {number} - The price difference from the variant (can be 0, positive, or negative)
 */
function getSelectedVariantPriceDiff(card) {
  const variantSelect = card.querySelector('.variant-select');
  if (!variantSelect) return 0;

  const selectedOption = variantSelect.options[variantSelect.selectedIndex];
  return parseFloat(selectedOption.dataset.priceDiff) || 0;
}

/**
 * Get the selected variant name for a product card
 * @param {HTMLElement} card - The product card element
 * @returns {string|null} - The variant name or null if no variant selected
 */
function getSelectedVariantName(card) {
  const variantSelect = card.querySelector('.variant-select');
  if (!variantSelect) return null;
  return variantSelect.value || null;
}

function onVariantChange(e) {
  const prodId = e.currentTarget.dataset.id;
  const prod = productos.find((p) => p.id === prodId);
  if (!prod) return;

  const card = document.querySelector(`.product-card[data-id="${prodId}"]`);
  const input = card.querySelector('.qty-input');
  const quantity = parseInt(input.value) || 1;

  // Get variant price adjustment
  const variantPriceDiff = getSelectedVariantPriceDiff(card);

  // Update unit price display
  const basePrice = getDisplayPrice(prod);
  const adjustedPrice = basePrice + variantPriceDiff;
  const unitPriceEl = card.querySelector('.unit-price strong');
  if (unitPriceEl) {
    unitPriceEl.textContent = formatCOP(adjustedPrice);
  }

  // Update total price
  const totalPrice = adjustedPrice * quantity;
  const totalPriceEl = card.querySelector('.total-price');
  totalPriceEl.innerHTML = `<strong>Total: ${formatCOP(totalPrice)}</strong>`;
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

  // Get variant price adjustment
  const variantPriceDiff = getSelectedVariantPriceDiff(card);

  const unitPrice = getDisplayPrice(prod) + variantPriceDiff;
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

function getDisplayPoints(prod){
  const tipo = (window.currentTipoRegistro || 'distribuidor').toLowerCase();
  if(tipo === 'restaurante'){
    // For restaurants, use puntosRestaurante if available, otherwise fallback to puntos
    if(typeof prod.puntosRestaurante === 'number') return prod.puntosRestaurante;
    return prod.puntos || 0;
  }
  if(tipo === 'distribuidor'){
    // For distributors, use puntosDistribuidor if available, otherwise fallback to puntos
    if(typeof prod.puntosDistribuidor === 'number') return prod.puntosDistribuidor;
    return prod.puntos || 0;
  }
  if(tipo === 'cliente'){
    // Clients don't earn points directly from products, but we need a value for display
    // Use distributor points as reference
    if(typeof prod.puntosDistribuidor === 'number') return prod.puntosDistribuidor;
    return prod.puntos || 0;
  }
  // Default fallback
  return prod.puntos || 0;
}

// ==========================================
// LAUNCH PRODUCT FUNCTIONS
// ==========================================

/**
 * Check if a product is in launch countdown state
 * @param {Object} prod - The product object
 * @returns {boolean} - True if product is in launch state (countdown active)
 */
function isLaunchProduct(prod) {
  if (!prod.isLaunchProduct || !prod.launchDate) return false;
  const launchTime = new Date(prod.launchDate).getTime();
  const now = Date.now();
  return now < launchTime;
}

/**
 * Calculate time remaining until launch
 * @param {string} launchDate - ISO date string
 * @returns {Object} - Object with days, hours, minutes, seconds
 */
function getTimeRemaining(launchDate) {
  const launchTime = new Date(launchDate).getTime();
  const now = Date.now();
  const diff = Math.max(0, launchTime - now);

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { days, hours, minutes, seconds, total: diff };
}

/**
 * Format countdown display
 * @param {Object} time - Object with days, hours, minutes, seconds
 * @returns {string} - Formatted countdown string
 */
function formatCountdown(time) {
  const pad = (n) => String(n).padStart(2, '0');
  if (time.days > 0) {
    return `${time.days}d ${pad(time.hours)}:${pad(time.minutes)}:${pad(time.seconds)}`;
  }
  return `${pad(time.hours)}:${pad(time.minutes)}:${pad(time.seconds)}`;
}

// Store interval references for cleanup
let countdownIntervals = [];

/**
 * Start countdown timers for all launch products
 */
function startCountdownTimers() {
  // Clear existing intervals
  countdownIntervals.forEach(interval => clearInterval(interval));
  countdownIntervals = [];

  const launchProducts = productos.filter(p => isLaunchProduct(p));

  launchProducts.forEach(prod => {
    const countdownEl = document.getElementById(`countdown-${prod.id}`);
    if (!countdownEl) return;

    const updateCountdown = () => {
      const time = getTimeRemaining(prod.launchDate);

      if (time.total <= 0) {
        // Countdown finished - reload products to show normal state
        clearInterval(interval);
        countdownEl.innerHTML = '<span style="color:#28a745;font-weight:600;">¡Disponible ahora!</span>';
        // Reload products after a short delay
        setTimeout(() => {
          loadProductsFromFirestore().then(() => renderProductos());
        }, 1500);
        return;
      }

      countdownEl.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:11px;color:rgba(255,255,255,0.9);margin-bottom:4px;">🚀 LANZAMIENTO EN</div>
          <div style="font-family:monospace;font-size:18px;font-weight:700;color:white;letter-spacing:1px;">
            ${formatCountdown(time)}
          </div>
        </div>
      `;
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    countdownIntervals.push(interval);
  });
}

function getFilteredProducts(){
  const tipo = (window.currentTipoRegistro || 'distribuidor').toLowerCase();
  const selectedCategory = window.selectedCategory || 'todas';

  return productos.filter(prod => {
    if (!prod.availableFor) return true;
    const matchesType = prod.availableFor.includes(tipo);

    // Normalize category matching to handle database variations (e.g., "carnesf" vs "carnes")
    const prodCategoria = (prod.categoria || '').toLowerCase().trim();
    const selectedCat = selectedCategory.toLowerCase().trim();
    const matchesCategory = selectedCat === 'todas' ||
                            prodCategoria === selectedCat ||
                            prodCategoria.startsWith(selectedCat) ||
                            selectedCat.startsWith(prodCategoria);

    // Hide "Paquete Master" for Master distributors (those with 50+ points)
    if (prod.id === 'paquete-master' && tipo === 'distribuidor') {
      const userPersonalPoints = window.currentUserPoints || 0;
      const isMaster = window.currentUserIsMaster || false;
      if (userPersonalPoints >= 50 || isMaster) {
        return false; // Hide product for Master distributors
      }
    }

    return matchesType && matchesCategory;
  }).sort((a, b) => {
    // Priority 1: Launch products (Super Destacados) go first
    const aIsLaunch = isLaunchProduct(a);
    const bIsLaunch = isLaunchProduct(b);
    if (aIsLaunch && !bIsLaunch) return -1;
    if (!aIsLaunch && bIsLaunch) return 1;

    // Priority 2: Featured products come next
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;

    return 0;
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

// LEGACY FUNCTION - NOT USED
// This function is kept for backward compatibility but is NOT called anywhere
// All commission distribution is handled server-side in netlify/functions/confirm-order.js
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

let currentProductPage = 1;
const PRODUCTS_PER_PAGE = 4;

function renderProductos() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  const filteredProducts = getFilteredProducts();
  const tipo = (window.currentTipoRegistro || 'distribuidor').toLowerCase();

  if (filteredProducts.length === 0) {
    grid.innerHTML = '<p style="text-align:center;color:#666;padding:20px;">No hay productos disponibles en esta categoría.</p>';
    // Remove pagination if exists
    const existingPagination = document.getElementById('productPagination');
    if (existingPagination) existingPagination.remove();
    return;
  }

  const totalPages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE);
  const startIdx = (currentProductPage - 1) * PRODUCTS_PER_PAGE;
  const endIdx = startIdx + PRODUCTS_PER_PAGE;
  const productsToShow = filteredProducts.slice(startIdx, endIdx);

  grid.innerHTML = productsToShow.map((prod) => {
    // Check if product is in launch state
    const inLaunchState = isLaunchProduct(prod);

    // For launch products, render a special locked card
    if (inLaunchState) {
      return `
        <div class="product-card product-launch" data-id="${prod.id}" style="position:relative;overflow:hidden;">
          <span style="position:absolute;top:12px;right:12px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;z-index:2;">🚀 PRÓXIMAMENTE</span>
          <div style="position:relative;">
            <img src="${prod.imagen}" alt="${prod.nombre}" style="filter:blur(6px) grayscale(30%);opacity:0.7;">
            <div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(102,126,234,0.85) 0%,rgba(118,75,162,0.85) 100%);display:flex;align-items:center;justify-content:center;border-radius:8px;">
              <div id="countdown-${prod.id}" style="text-align:center;padding:10px;">
                <div style="font-size:11px;color:rgba(255,255,255,0.9);margin-bottom:4px;">🚀 LANZAMIENTO EN</div>
                <div style="font-family:monospace;font-size:18px;font-weight:700;color:white;letter-spacing:1px;">--:--:--</div>
              </div>
            </div>
          </div>
          <h4 style="font-size:15px;margin:8px 0;min-height:40px;">${prod.nombre}</h4>
          <p style="font-size:13px;color:#999;min-height:36px;margin:4px 0;font-style:italic;">Información disponible al momento del lanzamiento</p>
          <p class="unit-price" style="color:#999;"><strong>Precio próximamente</strong></p>
          <div class="quantity-selector" style="opacity:0.4;pointer-events:none;">
            <button class="qty-btn qty-minus" disabled>−</button>
            <input type="number" class="qty-input" value="1" min="1" max="99" readonly disabled>
            <button class="qty-btn qty-plus" disabled>+</button>
          </div>
          <p class="total-price" style="color:#999;"><strong>Espera el lanzamiento</strong></p>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="btn small" disabled style="flex:1;background:#ccc;color:#666;cursor:not-allowed;">🛒 Agregar</button>
            <button class="btn small" disabled style="flex:1;background:#ccc;color:#666;cursor:not-allowed;">Próximamente</button>
          </div>
        </div>
      `;
    }

    const isOutOfStock = prod.outOfStock || false;
    const outOfStockBadge = isOutOfStock ? '<span style="position:absolute;top:12px;right:12px;background:#fd7e14;color:white;padding:4px 8px;border-radius:4px;font-size:11px;font-weight:600;">AGOTADO</span>' : '';
    const disabledStyle = isOutOfStock ? 'opacity:0.6;pointer-events:none;' : '';
    const buttonText = isOutOfStock ? 'No Disponible' : 'Comprar';

    // Get the correct unit label based on user type with quantity
    let unitLabel;
    let quantityLabel = '';
    if (tipo === 'restaurante') {
      unitLabel = prod.unitRestaurant || prod.unit || 'kilo';
      if (prod.quantityRestaurant) {
        quantityLabel = `${prod.quantityRestaurant} ${unitLabel}${prod.quantityRestaurant !== 1 ? 's' : ''}`;
      } else {
        quantityLabel = unitLabel;
      }
    } else {
      unitLabel = prod.unit || 'paquete';
      if (prod.quantityDistributor) {
        quantityLabel = `${prod.quantityDistributor} ${unitLabel}${prod.quantityDistributor !== 1 ? 's' : ''}`;
      } else {
        quantityLabel = unitLabel;
      }
    }

    // Get the correct points display based on user type
    const displayPoints = getDisplayPoints(prod);
    let pointsDisplay = '';
    if (displayPoints && displayPoints > 0) {
      // Format points with up to 3 decimals for restaurants, 2 for others
      const formattedPoints = tipo === 'restaurante'
        ? displayPoints.toFixed(3).replace(/\.?0+$/, '')
        : displayPoints.toFixed(2).replace(/\.?0+$/, '');

      // Different styling based on user type - only show points, no quantity (quantity is shown with price)
      if (tipo === 'distribuidor') {
        pointsDisplay = `<p style="font-size:12px;color:#007bff;margin:4px 0 8px 0;font-weight:500;">
          <span style="background:#e7f5ff;padding:2px 6px;border-radius:4px;">
            ${formattedPoints} punto${parseFloat(formattedPoints) !== 1 ? 's' : ''}
          </span>
        </p>`;
      } else if (tipo === 'restaurante') {
        pointsDisplay = `<p style="font-size:12px;color:#fd7e14;margin:4px 0 8px 0;font-weight:500;">
          <span style="background:#fff8e6;padding:2px 6px;border-radius:4px;">
            ${formattedPoints} punto${parseFloat(formattedPoints) !== 1 ? 's' : ''}
          </span>
        </p>`;
      } else if (tipo === 'cliente') {
        // For clients, show reference points (distributor points)
        pointsDisplay = `<p style="font-size:11px;color:#999;margin:4px 0 8px 0;">
          Genera ${formattedPoints} punto${parseFloat(formattedPoints) !== 1 ? 's' : ''}
        </p>`;
      }
    }

    // Variants selector HTML
    const variants = prod.variants || [];
    let variantSelectorHtml = '';
    if (variants.length > 0) {
      const defaultVariant = variants.find(v => v.isDefault) || variants[0];
      variantSelectorHtml = `
        <div class="variant-selector" style="margin:8px 0;">
          <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Variante:</label>
          <select class="variant-select" data-id="${prod.id}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;background:white;">
            ${variants.map(v => `
              <option value="${v.name}" data-price-diff="${v.priceDiff || 0}" ${v.name === defaultVariant.name ? 'selected' : ''}>
                ${v.name}${v.priceDiff ? ` (${v.priceDiff > 0 ? '+' : ''}${formatCOP(v.priceDiff)})` : ''}
              </option>
            `).join('')}
          </select>
        </div>
      `;
    }

    return `
      <div class="product-card" data-id="${prod.id}" style="position:relative;${disabledStyle}">
        ${outOfStockBadge}
        <img src="${prod.imagen}" alt="${prod.nombre}">
        <h4 style="font-size:15px;margin:8px 0;min-height:40px;">${prod.nombre}</h4>
        <p style="font-size:13px;color:#666;min-height:36px;margin:4px 0;">${prod.descripcion}</p>
        ${variantSelectorHtml}
        <p class="unit-price"><strong>${formatCOP(getDisplayPrice(prod))}</strong> — ${quantityLabel}</p>
        ${pointsDisplay}
        <div class="quantity-selector">
          <button class="qty-btn qty-minus" data-id="${prod.id}" aria-label="Disminuir cantidad" ${isOutOfStock ? 'disabled' : ''}>−</button>
          <input type="number" class="qty-input" data-id="${prod.id}" value="1" min="1" max="99" readonly ${isOutOfStock ? 'disabled' : ''}>
          <button class="qty-btn qty-plus" data-id="${prod.id}" aria-label="Aumentar cantidad" ${isOutOfStock ? 'disabled' : ''}>+</button>
        </div>
        <p class="total-price" data-id="${prod.id}"><strong>Total: ${formatCOP(getDisplayPrice(prod))}</strong></p>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn small btn-add-cart" data-id="${prod.id}" ${isOutOfStock ? 'disabled' : ''} style="flex:1;background:#667eea;color:white;">🛒 Agregar</button>
          <button class="btn small btn-buy" data-id="${prod.id}" ${isOutOfStock ? 'disabled' : ''} style="flex:1;">${buttonText}</button>
        </div>
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

  // Add event listeners for variant selectors
  document.querySelectorAll(".variant-select").forEach((select) => {
    select.addEventListener("change", onVariantChange);
  });

  document.querySelectorAll(".btn-buy").forEach((btn) => {
    btn.addEventListener("click", onBuyClick);
  });

  document.querySelectorAll(".btn-add-cart").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const productId = e.currentTarget.dataset.id;
      window.addToCart(productId, productos);
    });
  });

  renderProductPagination(totalPages);

  // Start countdown timers for launch products
  startCountdownTimers();
}

function renderProductPagination(totalPages) {
  const grid = document.getElementById("productGrid");
  if (!grid || totalPages <= 1) return;
  
  let paginationEl = document.getElementById('productPagination');
  if (!paginationEl) {
    paginationEl = document.createElement('div');
    paginationEl.id = 'productPagination';
    paginationEl.style.display = 'flex';
    paginationEl.style.justifyContent = 'center';
    paginationEl.style.alignItems = 'center';
    paginationEl.style.gap = '10px';
    paginationEl.style.marginTop = '20px';
    paginationEl.style.padding = '10px';
    grid.parentElement.appendChild(paginationEl);
  }
  
  paginationEl.innerHTML = '';
  
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '← Anterior';
  prevBtn.className = 'btn small';
  prevBtn.disabled = currentProductPage === 1;
  prevBtn.style.opacity = currentProductPage === 1 ? '0.5' : '1';
  prevBtn.style.cursor = currentProductPage === 1 ? 'not-allowed' : 'pointer';
  prevBtn.addEventListener('click', () => {
    if (currentProductPage > 1) {
      currentProductPage--;
      renderProductos();
      window.scrollTo({ top: document.getElementById('productGrid').offsetTop - 100, behavior: 'smooth' });
    }
  });
  
  const pageInfo = document.createElement('span');
  pageInfo.textContent = `Página ${currentProductPage} de ${totalPages}`;
  pageInfo.style.fontWeight = '600';
  pageInfo.style.color = '#333';
  
  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Siguiente →';
  nextBtn.className = 'btn small';
  nextBtn.disabled = currentProductPage === totalPages;
  nextBtn.style.opacity = currentProductPage === totalPages ? '0.5' : '1';
  nextBtn.style.cursor = currentProductPage === totalPages ? 'not-allowed' : 'pointer';
  nextBtn.addEventListener('click', () => {
    if (currentProductPage < totalPages) {
      currentProductPage++;
      renderProductos();
      window.scrollTo({ top: document.getElementById('productGrid').offsetTop - 100, behavior: 'smooth' });
    }
  });
  
  paginationEl.appendChild(prevBtn);
  paginationEl.appendChild(pageInfo);
  paginationEl.appendChild(nextBtn);
}

// --- Modal grande para que el cliente edite y confirme sus datos ---
// Incluye opción de 'A domicilio' o 'Recoger en oficina'
// Con cálculo dinámico de costo de envío basado en UE (Unidades de Envío)
function showCustomerFormModal(initial = {}, subtotal = 0, totalUE = 0, paymentMethod = 'efectivo_transferencia') {
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
    const cedulaLabel = paymentMethod === 'mercadopago' ? 'Cédula de Ciudadanía (requerido para MercadoPago)' : 'Cédula de Ciudadanía (opcional)';
    const fIdentificacion = createField('identification', cedulaLabel, initial.identification || initial.cedula || '', 'Número de cédula');
    const fDireccion = createField('address', 'Dirección', initial.address || initial.direccion || '', 'Calle, número, barrio');
    const fCiudad = createField('city', 'Ciudad', initial.city || '', 'Ciudad');

    form.appendChild(fNombre.wrapper);
    form.appendChild(fApellido.wrapper);
    form.appendChild(fEmail.wrapper);
    form.appendChild(fTelefono.wrapper);
    form.appendChild(fIdentificacion.wrapper);
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
      <br>Dirección: Calle 24a 11 68, Ciudad Yopal.
      <br>Horario: Lun-Sab 7:00 - 17:00.
    `;
    pickupInfo.style.display = 'none';
    box.appendChild(pickupInfo);

    // --- Promotional code section (only for home delivery) ---
    const promoCodeSection = document.createElement('div');
    promoCodeSection.id = 'promoCodeSection';
    promoCodeSection.style.marginTop = '16px';
    promoCodeSection.style.padding = '16px';
    promoCodeSection.style.borderRadius = '10px';
    promoCodeSection.style.background = '#f8f9fa';
    promoCodeSection.style.border = '1px solid #dee2e6';

    const promoLabel = document.createElement('label');
    promoLabel.textContent = '🎁 ¿Tienes un código promocional?';
    promoLabel.style.display = 'block';
    promoLabel.style.fontWeight = '600';
    promoLabel.style.marginBottom = '10px';
    promoLabel.style.color = '#333';
    promoCodeSection.appendChild(promoLabel);

    const promoInputWrapper = document.createElement('div');
    promoInputWrapper.style.display = 'flex';
    promoInputWrapper.style.gap = '10px';
    promoInputWrapper.style.alignItems = 'center';

    const promoInput = document.createElement('input');
    promoInput.type = 'text';
    promoInput.id = 'promoCodeInput';
    promoInput.placeholder = 'Ingresa tu código';
    promoInput.style.flex = '1';
    promoInput.style.padding = '10px 12px';
    promoInput.style.border = '1px solid #ddd';
    promoInput.style.borderRadius = '8px';
    promoInput.style.fontSize = '14px';
    promoInput.style.textTransform = 'uppercase';
    promoInputWrapper.appendChild(promoInput);

    const promoApplyBtn = document.createElement('button');
    promoApplyBtn.type = 'button';
    promoApplyBtn.textContent = 'Aplicar';
    promoApplyBtn.style.padding = '10px 16px';
    promoApplyBtn.style.border = 'none';
    promoApplyBtn.style.borderRadius = '8px';
    promoApplyBtn.style.background = '#667eea';
    promoApplyBtn.style.color = 'white';
    promoApplyBtn.style.fontWeight = '600';
    promoApplyBtn.style.cursor = 'pointer';
    promoInputWrapper.appendChild(promoApplyBtn);

    promoCodeSection.appendChild(promoInputWrapper);

    const promoMessage = document.createElement('div');
    promoMessage.id = 'promoCodeMessage';
    promoMessage.style.marginTop = '10px';
    promoMessage.style.padding = '8px 12px';
    promoMessage.style.borderRadius = '6px';
    promoMessage.style.fontSize = '13px';
    promoMessage.style.display = 'none';
    promoCodeSection.appendChild(promoMessage);

    box.appendChild(promoCodeSection);

    // Track applied promo code state
    let appliedPromoCode = null;

    // --- Shipping cost display section ---
    const shippingCostSection = document.createElement('div');
    shippingCostSection.style.marginTop = '16px';
    shippingCostSection.style.padding = '16px';
    shippingCostSection.style.borderRadius = '10px';
    shippingCostSection.style.background = 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)';
    shippingCostSection.style.border = '1px solid #86efac';

    const updateShippingDisplay = () => {
      const deliveryMethod = dmPickup.radio.checked ? 'pickup' : 'home';
      const city = fCiudad.input.value.trim();
      // Calculate base shipping cost
      let baseShippingCost = totalUE > 0 ? calculateShippingCostByUE(totalUE, city, deliveryMethod) : calculateShippingCost(city, deliveryMethod);
      // Apply promo code if valid
      let shippingCost = appliedPromoCode ? 0 : baseShippingCost;
      const total = subtotal + shippingCost;

      // Show/hide promo code section based on delivery method
      promoCodeSection.style.display = deliveryMethod === 'pickup' ? 'none' : 'block';

      if (deliveryMethod === 'pickup') {
        shippingCostSection.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-weight:600;color:#166534;">📦 Subtotal productos:</span>
            <span style="font-weight:700;color:#166534;">${formatCOP(subtotal)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="color:#166534;">🏢 Recoger en oficina:</span>
            <span style="font-weight:600;color:#16a34a;">GRATIS</span>
          </div>
          <div style="border-top:1px solid #86efac;padding-top:8px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:700;font-size:16px;color:#166534;">💰 TOTAL A PAGAR:</span>
            <span style="font-weight:700;font-size:18px;color:#166534;">${formatCOP(total)}</span>
          </div>
        `;
      } else {
        const cityDisplay = city || '(ingresa la ciudad)';
        const isYopal = city && (city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes('yopal'));
        const shippingMessage = getShippingMessage(city);
        const shippingLabel = `🚚 ${shippingMessage}:`;

        // Build promo code applied message if applicable
        const promoAppliedLine = appliedPromoCode ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;background:#d4edda;padding:8px 10px;border-radius:6px;margin-top:4px;">
            <span style="color:#155724;font-weight:600;">✅ Envío gratuito aplicado</span>
            <span style="font-weight:600;color:#155724;text-decoration:line-through;margin-right:8px;">${formatCOP(baseShippingCost)}</span>
            <span style="font-weight:700;color:#28a745;">GRATIS</span>
          </div>
        ` : '';

        shippingCostSection.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-weight:600;color:#166534;">📦 Subtotal productos:</span>
            <span style="font-weight:700;color:#166534;">${formatCOP(subtotal)}</span>
          </div>
          ${!appliedPromoCode ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="color:#166534;">${shippingLabel}</span>
            <span style="font-weight:600;color:#ea580c;">${formatCOP(shippingCost)}</span>
          </div>
          ` : promoAppliedLine}
          ${!city && !appliedPromoCode ? '<p style="font-size:12px;color:#9ca3af;margin:4px 0 8px 0;">ℹ️ El costo de envío se calcula automáticamente según la ciudad de destino</p>' : ''}
          <div style="border-top:1px solid #86efac;padding-top:8px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:700;font-size:16px;color:#166534;">💰 TOTAL A PAGAR:</span>
            <span style="font-weight:700;font-size:18px;color:#166534;">${formatCOP(total)}</span>
          </div>
        `;
      }
    };

    box.appendChild(shippingCostSection);

    // Initialize shipping display
    updateShippingDisplay();

    // Update shipping display when city changes
    fCiudad.input.addEventListener('input', updateShippingDisplay);
    fCiudad.input.addEventListener('change', updateShippingDisplay);

    // Promo code apply button handler
    promoApplyBtn.addEventListener('click', () => {
      const code = promoInput.value.trim();
      const city = fCiudad.input.value.trim();
      const result = validatePromoCode(code, city, []);

      if (result.valid) {
        appliedPromoCode = result.code;
        promoMessage.style.display = 'block';
        promoMessage.style.background = '#d4edda';
        promoMessage.style.color = '#155724';
        promoMessage.innerHTML = `✅ ${result.message} <button type="button" id="removePromoBtn" style="margin-left:10px;background:none;border:none;color:#dc3545;cursor:pointer;font-weight:600;">Quitar</button>`;
        promoInput.disabled = true;
        promoApplyBtn.disabled = true;
        promoApplyBtn.style.background = '#6c757d';

        // Add remove button handler
        document.getElementById('removePromoBtn').addEventListener('click', () => {
          appliedPromoCode = null;
          promoMessage.style.display = 'none';
          promoInput.disabled = false;
          promoInput.value = '';
          promoApplyBtn.disabled = false;
          promoApplyBtn.style.background = '#667eea';
          updateShippingDisplay();
        });

        updateShippingDisplay();
      } else {
        appliedPromoCode = null;
        promoMessage.style.display = 'block';
        promoMessage.style.background = '#f8d7da';
        promoMessage.style.color = '#721c24';
        promoMessage.textContent = `❌ ${result.message}`;
        updateShippingDisplay();
      }
    });

    // Also validate promo code on Enter key
    promoInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        promoApplyBtn.click();
      }
    });

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

    // When delivery method changes, show/hide address fields and update shipping
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
      updateShippingDisplay();
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
      const city = fCiudad.input.value.trim();

      // Calculate shipping cost using UE if available
      let baseShippingCost = totalUE > 0 ? calculateShippingCostByUE(totalUE, city, deliveryMethod) : calculateShippingCost(city, deliveryMethod);
      // Apply promo code discount if valid
      const shippingCost = appliedPromoCode ? 0 : baseShippingCost;

      const payload = {
        firstName: fNombre.input.value.trim(),
        lastName: fApellido.input.value.trim(),
        email: fEmail.input.value.trim(),
        phone: fTelefono.input.value.trim(),
        identification: fIdentificacion.input.value.trim(),
        address: fDireccion.input.value.trim(),
        city: city,
        notes: ta.value.trim(),
        deliveryMethod,
        shippingCost,
        baseShippingCost, // Original shipping cost before discount
        totalUE: totalUE, // Include total UE in payload
        promoCode: appliedPromoCode ? appliedPromoCode.code : null,
        promoCodeApplied: appliedPromoCode !== null,
        promoCodeData: appliedPromoCode ? {
          code: appliedPromoCode.code,
          discount: baseShippingCost // Amount discounted
        } : null
      };

      // Validaciones
      if (!payload.firstName) { alert('Por favor ingresa tu nombre.'); fNombre.input.focus(); return; }
      if (!payload.email || !/\S+@\S+\.\S+/.test(payload.email)) { alert('Por favor ingresa un correo válido.'); fEmail.input.focus(); return; }
      if (!payload.phone) { alert('Por favor ingresa un teléfono de contacto.'); fTelefono.input.focus(); return; }
      if (paymentMethod === 'mercadopago' && !payload.identification) { alert('Por favor ingresa tu número de cédula (requerido para pago con MercadoPago).'); fIdentificacion.input.focus(); return; }
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

  // Prevent buying launch products that haven't been released yet
  if (isLaunchProduct(prod)) {
    alert("Este producto aún no está disponible. Por favor espera al lanzamiento.");
    return;
  }

  const card = document.querySelector(`.product-card[data-id="${prodId}"]`);
  const quantityInput = card.querySelector('.qty-input');
  const quantity = parseInt(quantityInput.value) || 1;

  // Get selected variant info
  const selectedVariant = getSelectedVariantName(card);
  const variantPriceDiff = getSelectedVariantPriceDiff(card);

  const buyerUid = auth.currentUser.uid;

  // Intentar obtener perfil para prefill (NO crear orden aquí)
  let initialBuyerProfile = {};
  try {
    const userDoc = await getDoc(doc(db, "usuarios", buyerUid));
    if (userDoc.exists()) initialBuyerProfile = userDoc.data();
  } catch (err) {
    console.warn("No se pudo leer perfil del usuario para prefill:", err);
  }

  // ---------- Modal pequeño: selección de método de pago ----------
  const unitPricePreview = getDisplayPrice(prod) + variantPriceDiff;
  const totalPricePreview = unitPricePreview * quantity;
  const productPointsPreview = getDisplayPoints(prod);
  const totalPointsPreview = productPointsPreview * quantity;

  const selectedPaymentMethod = await new Promise((resolve) => {
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
    h.style.margin = '0 0 12px 0';
    h.style.fontSize = '22px';
    h.style.color = '#212529';
    box.appendChild(h);

    const productInfo = document.createElement('p');
    productInfo.textContent = `${prod.nombre} x${quantity}`;
    productInfo.style.margin = '0 0 16px 0';
    productInfo.style.fontSize = '15px';
    productInfo.style.color = '#6c757d';
    box.appendChild(productInfo);

    const totalDiv = document.createElement('div');
    totalDiv.style.cssText = 'background:#f8f9fa;padding:16px;border-radius:8px;margin-bottom:20px;';
    totalDiv.innerHTML = `
      <div style="font-size:14px;color:#666;margin-bottom:4px;">Total a pagar</div>
      <div style="font-size:24px;font-weight:700;color:#333;">$${totalPricePreview.toLocaleString()}</div>
      <div style="font-size:14px;color:#28a745;margin-top:4px;">${totalPointsPreview} puntos</div>
    `;
    box.appendChild(totalDiv);

    const paymentMethodDiv = document.createElement('div');
    paymentMethodDiv.style.cssText = 'margin-bottom:20px;text-align:left;';
    paymentMethodDiv.innerHTML = `
      <label style="display:block;margin-bottom:10px;font-weight:600;color:#333;">Método de pago:</label>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <label style="display:flex;align-items:center;padding:12px;border:2px solid #009ee3;border-radius:8px;cursor:pointer;background:#f0f9ff;transition:all 0.2s;">
          <input type="radio" name="paymentMethodSingle" value="mercadopago" checked style="margin-right:10px;accent-color:#009ee3;">
          <div>
            <span style="font-weight:600;color:#009ee3;">💳 MercadoPago</span>
            <span style="display:block;font-size:12px;color:#666;margin-top:2px;">Tarjeta, PSE, Nequi, Efecty y más</span>
          </div>
        </label>
        <label style="display:flex;align-items:center;padding:12px;border:2px solid #ddd;border-radius:8px;cursor:pointer;transition:all 0.2s;">
          <input type="radio" name="paymentMethodSingle" value="efectivo_transferencia" style="margin-right:10px;">
          <div>
            <span style="font-weight:600;color:#333;">💵 Efectivo o Transferencia</span>
            <span style="display:block;font-size:12px;color:#666;margin-top:2px;">Recogida en bodega/oficina · Nequi/Daviplata 3125929316</span>
          </div>
        </label>
      </div>
    `;
    box.appendChild(paymentMethodDiv);

    // Style radio buttons on selection
    const radios = paymentMethodDiv.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => {
      radio.addEventListener('change', () => {
        paymentMethodDiv.querySelectorAll('label').forEach(label => {
          label.style.borderColor = '#ddd';
          label.style.background = 'white';
        });
        if (radio.checked) {
          const label = radio.closest('label');
          label.style.borderColor = radio.value === 'mercadopago' ? '#009ee3' : '#28a745';
          label.style.background = radio.value === 'mercadopago' ? '#f0f9ff' : '#f0fff4';
        }
      });
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Continuar';
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.style.cssText = 'width:100%;padding:12px;font-size:16px;font-weight:600;background:#667eea;border:none;border-radius:8px;color:white;cursor:pointer;';
    confirmBtn.addEventListener('click', () => {
      const selectedMethod = paymentMethodDiv.querySelector('input[name="paymentMethodSingle"]:checked').value;
      document.body.removeChild(overlay);
      resolve(selectedMethod);
    });
    box.appendChild(confirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.style.cssText = 'width:100%;padding:10px;font-size:14px;margin-top:10px;background:transparent;border:1px solid #ddd;border-radius:8px;color:#666;cursor:pointer;';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(null);
    });
    box.appendChild(cancelBtn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });

  // If user cancelled, exit
  if (selectedPaymentMethod === null) {
    return;
  }

  // ---------- Modal grande: pedir/editar datos del cliente (devuelve payload o null) ----------
  // Calculate subtotal for shipping display
  const unitPriceForSubtotal = getDisplayPrice(prod) + variantPriceDiff;
  const subtotal = unitPriceForSubtotal * quantity;

  // Calculate total UE (Shipping Units) for this product
  const totalUE = getProductUE(prod, quantity);

  const customerData = await showCustomerFormModal(initialBuyerProfile, subtotal, totalUE, selectedPaymentMethod);
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

    // Calculate price including variant adjustment
    const unitPrice = getDisplayPrice(prod) + variantPriceDiff;
    const totalPrice = unitPrice * quantity;
    const productPoints = getDisplayPoints(prod);
    const totalPoints = productPoints * quantity;

    // Get shipping cost from customer data
    const shippingCost = customerData.shippingCost || 0;
    const grandTotal = totalPrice + shippingCost;

    const orderObj = {
      productId: prod.id,
      productName: prod.nombre,
      price: unitPrice,
      quantity: quantity,
      totalPrice: totalPrice,
      shippingCost: shippingCost,
      grandTotal: grandTotal,
      points: productPoints,
      totalPoints: totalPoints,
      // UE (Shipping Units) data
      shippingUnits: prod.shippingUnits || 2, // UE per unit
      totalShippingUnits: totalUE, // Total UE for this order
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
      paymentMethod: selectedPaymentMethod,
      // Variant information
      selectedVariant: selectedVariant || null,
      variantPriceDiff: variantPriceDiff || 0,
      // Promotional code data
      promoCode: customerData.promoCode || null,
      promoCodeApplied: customerData.promoCodeApplied || false,
      baseShippingCost: customerData.baseShippingCost || shippingCost,
      shippingDiscount: customerData.promoCodeApplied ? (customerData.baseShippingCost || 0) : 0
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
      const historyAction = selectedVariant
        ? `Compra pendiente: ${prod.nombre} - ${selectedVariant} (x${quantity})`
        : `Compra pendiente: ${prod.nombre} (x${quantity})`;

      await updateDoc(doc(db, "usuarios", buyerUid), {
        history: arrayUnion({
          action: historyAction,
          amount: grandTotal,
          subtotal: totalPrice,
          shippingCost: shippingCost,
          points: totalPoints,
          quantity: quantity,
          orderId: orderRef.id,
          date: new Date().toISOString(),
          type: "pending_purchase",
          variant: selectedVariant || null
        })
      });
    } catch (err) {
      console.error("Error en post-procesamiento de la orden:", err);
    }

    // Handle payment based on selected method
    if (selectedPaymentMethod === 'mercadopago') {
      // Build items array for MercadoPago
      const mpItems = [{
        id: prod.id,
        title: selectedVariant ? `${prod.nombre} - ${selectedVariant}` : prod.nombre,
        description: prod.descripcion || '',
        quantity: quantity,
        unit_price: unitPrice
      }];

      // Add shipping cost as a separate item if applicable
      if (shippingCost > 0) {
        mpItems.push({
          id: 'shipping',
          title: 'Costo de envío',
          description: `Envío a ${customerData.city || 'domicilio'}`,
          quantity: 1,
          unit_price: shippingCost
        });
      }

      try {
        // Show loading indicator
        const loadingOverlay = document.createElement('div');
        loadingOverlay.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(255,255,255,0.95);z-index:10001;';
        loadingOverlay.innerHTML = `
          <div style="text-align:center;">
            <div style="width:50px;height:50px;border:4px solid #e0e0e0;border-top:4px solid #009ee3;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
            <p style="font-size:18px;color:#333;margin:0;">Redirigiendo a MercadoPago...</p>
            <p style="font-size:14px;color:#666;margin-top:8px;">Por favor espera</p>
          </div>
          <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
        document.body.appendChild(loadingOverlay);

        // Create MercadoPago preference
        const paymentResult = await createPayment({
          uid: buyerUid,
          items: mpItems,
          type: 'compra_producto',
          description: `PorKCasare - ${prod.nombre}${selectedVariant ? ` - ${selectedVariant}` : ''} (x${quantity})`,
          payer: {
            name: customerData.firstName,
            surname: customerData.lastName,
            email: customerData.email,
            phone: {
              area_code: '57',
              number: customerData.phone
            },
            identification: {
              type: 'CC', // Cédula de Ciudadanía (Colombia)
              number: customerData.identification
            }
          }
        });

        if (paymentResult && paymentResult.init_point) {
          // Store order ID in localStorage to update after payment
          localStorage.setItem('porkcasare_pending_orders', JSON.stringify({
            orderIds: [orderRef.id],
            preferenceId: paymentResult.preference_id,
            timestamp: Date.now()
          }));

          // Redirect to MercadoPago checkout
          window.location.href = paymentResult.init_point;
        } else {
          document.body.removeChild(loadingOverlay);
          throw new Error('No se pudo crear la preferencia de pago');
        }
      } catch (mpError) {
        console.error("Error creando preferencia de MercadoPago:", mpError);
        alert(`❌ Error al procesar el pago con MercadoPago: ${mpError.message}\n\nEl pedido se ha creado como pendiente de pago. Puedes intentar pagar desde tu historial de pedidos.`);
        window.location.href = `/oficina-virtual/index.html`;
      }
    } else {
      // Cash/transfer payment - show detailed success message with payment info
      const deliveryInfo = customerData.deliveryMethod === 'pickup'
        ? '🏢 <strong>Recogida en bodega/oficina:</strong><br>Calle 24a 11 68, Ciudad Yopal<br>Horario: Lun-Sab 7:00 - 17:00'
        : '🚚 <strong>Envío a domicilio:</strong><br>Te contactaremos para coordinar la entrega';

      const paymentInfoHtml = `
        <div style="text-align:left;margin-top:15px;">
          <h4 style="margin:0 0 10px 0;color:#28a745;">✅ Pedido creado correctamente</h4>

          <div style="background:#f8f9fa;padding:12px;border-radius:8px;margin-bottom:12px;">
            <p style="margin:0 0 8px 0;font-weight:600;color:#333;">💳 Cuentas autorizadas para transferencia:</p>
            <p style="margin:0;color:#666;">
              <strong>Nequi:</strong> 3125929316<br>
              <strong>Daviplata:</strong> 3125929316
            </p>
          </div>

          <div style="background:#e8f5e9;padding:12px;border-radius:8px;margin-bottom:12px;">
            ${deliveryInfo}
          </div>

          <p style="margin:0;font-size:13px;color:#666;">
            📱 Una vez realices el pago, envía el comprobante por WhatsApp al <strong>3125929316</strong> indicando tu usuario o código.
          </p>
        </div>
      `;

      // Use SweetAlert2 if available, otherwise fallback to custom modal
      if (typeof Swal !== 'undefined') {
        await Swal.fire({
          title: '¡Pedido Creado!',
          html: paymentInfoHtml,
          icon: 'success',
          confirmButtonText: 'Entendido',
          confirmButtonColor: '#28a745',
          allowOutsideClick: false
        });
      } else {
        // Fallback: show custom modal
        const modalOverlay = document.createElement('div');
        modalOverlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);z-index:10002;';
        const modalBox = document.createElement('div');
        modalBox.style.cssText = 'max-width:450px;width:90%;background:white;border-radius:12px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.3);';
        modalBox.innerHTML = `
          <div style="text-align:center;margin-bottom:15px;">
            <div style="font-size:48px;">✅</div>
            <h3 style="margin:10px 0 0 0;color:#333;">¡Pedido Creado!</h3>
          </div>
          ${paymentInfoHtml}
          <button id="closePaymentInfoModal" style="width:100%;margin-top:15px;padding:12px;background:#28a745;color:white;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">Entendido</button>
        `;
        modalOverlay.appendChild(modalBox);
        document.body.appendChild(modalOverlay);

        await new Promise(resolve => {
          modalBox.querySelector('#closePaymentInfoModal').addEventListener('click', () => {
            document.body.removeChild(modalOverlay);
            resolve();
          });
        });
      }

      window.location.href = `/oficina-virtual/index.html?orderId=${encodeURIComponent(orderRef.id)}`;
    }
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
  await loadShippingRates(); // Load UE shipping rates
  await loadPromoCodes(); // Load promotional codes
  renderProductos();

  // Initialize shopping cart UI
  initializeCartUI(getDisplayPrice, getDisplayPoints);

  const categorySelector = document.getElementById('categorySelector');
  if (categorySelector) {
    categorySelector.addEventListener('change', (e) => {
      window.selectedCategory = e.target.value;
      currentProductPage = 1;
      renderProductos();
    });
  }
});

// Handle cart checkout
window.proceedToCheckout = async function() {
  if (!auth.currentUser) {
    alert("Debes iniciar sesión para comprar.");
    window.location.href = "distribuidor-login.html";
    return;
  }

  const cartItems = cart.getItems();
  if (cartItems.length === 0) {
    alert("El carrito está vacío");
    return;
  }

  const buyerUid = auth.currentUser.uid;

  // Get user profile for prefill
  let initialBuyerProfile = {};
  let buyerData = null;
  try {
    const userDoc = await getDoc(doc(db, "usuarios", buyerUid));
    if (userDoc.exists()) {
      initialBuyerProfile = userDoc.data();
      buyerData = userDoc.data();
    }
  } catch (err) {
    console.warn("No se pudo leer perfil del usuario para prefill:", err);
  }

  const buyerType = initialBuyerProfile.tipoRegistro || 'distribuidor';
  const buyerUsername = initialBuyerProfile.usuario || '';

  // Calculate totals
  const { totalPrice, totalPoints } = cart.getTotals(getDisplayPrice, getDisplayPoints);

  // Calculate total UE (Shipping Units) for entire cart
  const cartTotalUE = calculateTotalUE(cartItems);
  console.log(`Cart total UE: ${cartTotalUE}`);

  // Calculate MercadoPago fee for display
  const mercadoPagoFee = calculateMercadoPagoFee(totalPrice);

  // Show payment method selection modal
  const selectedPaymentMethod = await new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('id','payment-modal-overlay');
    overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);z-index:9999;backdrop-filter:blur(2px);';

    const box = document.createElement('div');
    box.style.cssText = 'max-width:420px;width:90%;padding:20px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.25);background:linear-gradient(180deg,#ffffff,#fbfbfb);text-align:center;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial';

    const h = document.createElement('h3');
    h.textContent = 'Confirmar compra';
    h.style.cssText = 'margin:0 0 12px 0;font-size:22px;color:#212529;';

    const p = document.createElement('p');
    p.textContent = `${cartItems.length} producto${cartItems.length !== 1 ? 's' : ''} en el carrito`;
    p.style.cssText = 'margin:0 0 16px 0;font-size:15px;color:#6c757d;';

    const totalDiv = document.createElement('div');
    totalDiv.setAttribute('id', 'payment-summary-div');
    totalDiv.style.cssText = 'background:#f8f9fa;padding:16px;border-radius:8px;margin-bottom:20px;';

    // Function to update the total display based on payment method
    const updateTotalDisplay = (paymentMethod) => {
      if (paymentMethod === 'mercadopago') {
        const totalWithFee = totalPrice + mercadoPagoFee;
        totalDiv.innerHTML = `
          <div style="font-size:14px;color:#666;margin-bottom:8px;">Resumen de compra</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:14px;color:#555;">Subtotal productos:</span>
            <span style="font-size:14px;font-weight:600;color:#333;">$${totalPrice.toLocaleString()}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding:6px 8px;background:#fff3cd;border-radius:4px;">
            <span style="font-size:13px;color:#856404;">Logística pasarela de pago (Mercado Pago):</span>
            <span style="font-size:13px;font-weight:600;color:#856404;">+$${mercadoPagoFee.toLocaleString()}</span>
          </div>
          <div style="border-top:1px solid #dee2e6;padding-top:8px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:14px;font-weight:600;color:#333;">Total a pagar:</span>
            <span style="font-size:22px;font-weight:700;color:#333;">$${totalWithFee.toLocaleString()}</span>
          </div>
          <div style="font-size:14px;color:#28a745;margin-top:4px;text-align:right;">${totalPoints} puntos</div>
        `;
      } else {
        totalDiv.innerHTML = `
          <div style="font-size:14px;color:#666;margin-bottom:4px;">Total a pagar</div>
          <div style="font-size:24px;font-weight:700;color:#333;">$${totalPrice.toLocaleString()}</div>
          <div style="font-size:14px;color:#28a745;margin-top:4px;">${totalPoints} puntos</div>
        `;
      }
    };

    // Initialize with MercadoPago selected (default)
    updateTotalDisplay('mercadopago');

    const paymentMethodDiv = document.createElement('div');
    paymentMethodDiv.style.cssText = 'margin-bottom:20px;text-align:left;';
    paymentMethodDiv.innerHTML = `
      <label style="display:block;margin-bottom:10px;font-weight:600;color:#333;">Método de pago:</label>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <label style="display:flex;align-items:center;padding:12px;border:2px solid #009ee3;border-radius:8px;cursor:pointer;background:#f0f9ff;transition:all 0.2s;">
          <input type="radio" name="paymentMethod" value="mercadopago" checked style="margin-right:10px;accent-color:#009ee3;">
          <div>
            <span style="font-weight:600;color:#009ee3;">💳 MercadoPago</span>
            <span style="display:block;font-size:12px;color:#666;margin-top:2px;">Tarjeta, PSE, Nequi, Efecty y más</span>
          </div>
        </label>
        <label style="display:flex;align-items:center;padding:12px;border:2px solid #ddd;border-radius:8px;cursor:pointer;transition:all 0.2s;">
          <input type="radio" name="paymentMethod" value="efectivo_transferencia" style="margin-right:10px;">
          <div>
            <span style="font-weight:600;color:#333;">💵 Efectivo o Transferencia</span>
            <span style="display:block;font-size:12px;color:#666;margin-top:2px;">Recogida en bodega/oficina · Nequi/Daviplata 3125929316</span>
          </div>
        </label>
      </div>
    `;

    // Style radio buttons on selection and update total display
    const radios = paymentMethodDiv.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => {
      radio.addEventListener('change', () => {
        paymentMethodDiv.querySelectorAll('label').forEach(label => {
          label.style.borderColor = '#ddd';
          label.style.background = 'white';
        });
        if (radio.checked) {
          const label = radio.closest('label');
          label.style.borderColor = radio.value === 'mercadopago' ? '#009ee3' : '#28a745';
          label.style.background = radio.value === 'mercadopago' ? '#f0f9ff' : '#f0fff4';
          // Update total display based on selected payment method
          updateTotalDisplay(radio.value);
        }
      });
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Continuar';
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.style.cssText = 'width:100%;padding:12px;font-size:16px;font-weight:600;background:#667eea;border:none;border-radius:8px;color:white;cursor:pointer;';
    confirmBtn.addEventListener('click', () => {
      const selectedMethod = paymentMethodDiv.querySelector('input[name="paymentMethod"]:checked').value;
      document.body.removeChild(overlay);
      resolve(selectedMethod);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.style.cssText = 'width:100%;padding:10px;font-size:14px;margin-top:10px;background:transparent;border:1px solid #ddd;border-radius:8px;color:#666;cursor:pointer;';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(null);
    });

    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(totalDiv);
    box.appendChild(paymentMethodDiv);
    box.appendChild(confirmBtn);
    box.appendChild(cancelBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });

  // If user cancelled, exit
  if (selectedPaymentMethod === null) {
    return;
  }

  // Show customer info form modal
  await new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('id','customer-form-overlay');
    overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);z-index:10000;backdrop-filter:blur(3px);overflow-y:auto;padding:20px;';

    const box = document.createElement('div');
    box.style.cssText = 'max-width:600px;width:100%;background:white;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-height:90vh;overflow-y:auto;';

    const header = document.createElement('div');
    header.style.cssText = 'padding:24px;border-bottom:2px solid #eee;position:sticky;top:0;background:white;z-index:1;border-radius:16px 16px 0 0;';
    header.innerHTML = '<h2 style="margin:0;font-size:24px;color:#333;">Datos de Entrega</h2>';

    const content = document.createElement('div');
    content.style.cssText = 'padding:24px;';

    const form = document.createElement('form');
    form.id = 'customerForm';
    form.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div>
          <label style="display:block;margin-bottom:6px;font-weight:500;color:#333;">Nombre</label>
          <input type="text" name="firstName" required value="${initialBuyerProfile.nombre || ''}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
        </div>
        <div>
          <label style="display:block;margin-bottom:6px;font-weight:500;color:#333;">Apellido</label>
          <input type="text" name="lastName" required style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:6px;font-weight:500;color:#333;">Email</label>
        <input type="email" name="email" required value="${initialBuyerProfile.email || ''}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div>
          <label style="display:block;margin-bottom:6px;font-weight:500;color:#333;">Teléfono</label>
          <input type="tel" name="phone" required value="${initialBuyerProfile.celular || ''}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
        </div>
        <div>
          <label style="display:block;margin-bottom:6px;font-weight:500;color:#333;">Cédula de Ciudadanía ${selectedPaymentMethod === 'mercadopago' ? '<span style="font-size:11px;color:#ea580c;">(requerido para MercadoPago)</span>' : '<span style="font-size:11px;color:#666;">(opcional)</span>'}</label>
          <input type="text" name="identification" ${selectedPaymentMethod === 'mercadopago' ? 'required' : ''} value="${initialBuyerProfile.cedula || ''}" placeholder="Número de cédula" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:10px;font-weight:500;color:#333;">Método de Entrega</label>
        <div style="display:flex;gap:12px;">
          <label style="flex:1;padding:12px;border:2px solid #ddd;border-radius:6px;cursor:pointer;text-align:center;transition:all 0.2s;">
            <input type="radio" name="deliveryMethod" value="home" checked style="margin-right:6px;">
            Envío a domicilio
          </label>
          <label style="flex:1;padding:12px;border:2px solid #ddd;border-radius:6px;cursor:pointer;text-align:center;transition:all 0.2s;">
            <input type="radio" name="deliveryMethod" value="pickup" style="margin-right:6px;">
            Recoger en oficina
          </label>
        </div>
      </div>
      <div id="addressField" style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:6px;font-weight:500;color:#333;">Dirección</label>
        <input type="text" name="address" required style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
      </div>
      <div id="cityField" style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:6px;font-weight:500;color:#333;">Ciudad</label>
        <input type="text" name="city" required value="${initialBuyerProfile.ciudad || ''}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
      </div>
      <div id="pickupInfoSection" style="display:none;margin-bottom:16px;padding:12px;background:#f0fdf4;border-radius:8px;border:1px solid #86efac;">
        <strong style="color:#166534;">📍 Recoger en oficina:</strong><br>
        <span style="color:#166534;">Dirección: Calle 24a 11 68, Ciudad Yopal.</span><br>
        <span style="color:#166534;">Horario: Lun-Sab 7:00 - 17:00.</span>
      </div>
      <div id="promoCodeSection" style="margin-bottom:16px;padding:16px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:10px;">
        <label style="display:block;font-weight:600;margin-bottom:10px;color:#333;">🎁 ¿Tienes un código promocional?</label>
        <div style="display:flex;gap:10px;align-items:center;">
          <input type="text" name="promoCode" placeholder="Ingresa tu código" style="flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;text-transform:uppercase;">
          <button type="button" id="applyPromoCodeBtn" style="padding:10px 16px;border:none;border-radius:8px;background:#667eea;color:white;font-weight:600;cursor:pointer;">Aplicar</button>
        </div>
        <div id="promoCodeMessage" style="margin-top:10px;padding:8px 12px;border-radius:6px;font-size:13px;display:none;"></div>
      </div>
      <div id="shippingCostSection" style="margin-bottom:20px;padding:16px;background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border-radius:10px;border:1px solid #86efac;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:600;color:#166534;">📦 Subtotal productos:</span>
          <span style="font-weight:700;color:#166534;">$${totalPrice.toLocaleString()}</span>
        </div>
        <div id="shippingCostLine" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="color:#166534;">🚚 ${getShippingMessage('')}:</span>
          <span id="shippingCostValue" style="font-weight:600;color:#ea580c;">$${calculateShippingCostByUE(cartTotalUE, '', 'home').toLocaleString()}</span>
        </div>
        <div id="mercadoPagoFeeLine" style="display:${selectedPaymentMethod === 'mercadopago' ? 'flex' : 'none'};justify-content:space-between;align-items:center;margin-bottom:8px;padding:6px 8px;background:#fff3cd;border-radius:4px;">
          <span style="font-size:13px;color:#856404;">💳 Logística pasarela de pago (Mercado Pago):</span>
          <span id="mercadoPagoFeeValue" style="font-size:13px;font-weight:600;color:#856404;">+$${mercadoPagoFee.toLocaleString()}</span>
        </div>
        <p id="shippingHint" style="font-size:12px;color:#9ca3af;margin:4px 0 8px 0;">ℹ️ El costo de envío se calcula automáticamente según la ciudad de destino</p>
        <div style="border-top:1px solid #86efac;padding-top:8px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:700;font-size:16px;color:#166534;">💰 TOTAL A PAGAR:</span>
          <span id="grandTotalValue" style="font-weight:700;font-size:18px;color:#166534;">$${(totalPrice + calculateShippingCostByUE(cartTotalUE, '', 'home') + (selectedPaymentMethod === 'mercadopago' ? mercadoPagoFee : 0)).toLocaleString()}</span>
        </div>
      </div>
      <div style="margin-bottom:20px;">
        <label style="display:block;margin-bottom:6px;font-weight:500;color:#333;">Notas adicionales (opcional)</label>
        <textarea name="notes" rows="3" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:12px;">
        <button type="button" id="cancelCustomerForm" style="flex:1;padding:12px;background:#6c757d;color:white;border:none;border-radius:6px;font-size:16px;font-weight:600;cursor:pointer;">Cancelar</button>
        <button type="submit" style="flex:2;padding:12px;background:#28a745;color:white;border:none;border-radius:6px;font-size:16px;font-weight:600;cursor:pointer;">Confirmar Pedido</button>
      </div>
    `;

    // Track applied promo code state for cart checkout
    let cartAppliedPromoCode = null;

    // Toggle address/city fields based on delivery method and update shipping cost
    const toggleAddressFields = () => {
      const deliveryMethod = form.querySelector('input[name="deliveryMethod"]:checked').value;
      const addressField = form.querySelector('#addressField');
      const cityField = form.querySelector('#cityField');
      const addressInput = form.querySelector('input[name="address"]');
      const cityInput = form.querySelector('input[name="city"]');
      const pickupInfoSection = form.querySelector('#pickupInfoSection');
      const promoCodeSection = form.querySelector('#promoCodeSection');
      const shippingCostLine = form.querySelector('#shippingCostLine');
      const shippingCostValue = form.querySelector('#shippingCostValue');
      const shippingHint = form.querySelector('#shippingHint');
      const grandTotalValue = form.querySelector('#grandTotalValue');
      const mercadoPagoFeeLine = form.querySelector('#mercadoPagoFeeLine');

      // Calculate MercadoPago fee for grand total
      const mpFee = selectedPaymentMethod === 'mercadopago' ? mercadoPagoFee : 0;

      if (deliveryMethod === 'pickup') {
        addressField.style.display = 'none';
        cityField.style.display = 'none';
        addressInput.required = false;
        cityInput.required = false;
        pickupInfoSection.style.display = 'block';
        promoCodeSection.style.display = 'none';
        shippingCostLine.innerHTML = '<span style="color:#166534;">🏢 Recoger en oficina:</span><span style="font-weight:600;color:#16a34a;">GRATIS</span>';
        shippingHint.style.display = 'none';
        // Include MercadoPago fee in total for pickup
        grandTotalValue.textContent = '$' + (totalPrice + mpFee).toLocaleString();
      } else {
        addressField.style.display = 'block';
        cityField.style.display = 'block';
        addressInput.required = true;
        cityInput.required = true;
        pickupInfoSection.style.display = 'none';
        promoCodeSection.style.display = 'block';
        shippingHint.style.display = 'block';
        updateShippingCost();
      }
    };

    // Update shipping cost based on city using UE calculation
    const updateShippingCost = () => {
      const deliveryMethod = form.querySelector('input[name="deliveryMethod"]:checked').value;
      if (deliveryMethod === 'pickup') return;

      const cityInput = form.querySelector('input[name="city"]');
      const city = cityInput.value.trim();
      // Use UE-based shipping calculation
      const baseShippingCost = calculateShippingCostByUE(cartTotalUE, city, deliveryMethod);
      const shippingCost = cartAppliedPromoCode ? 0 : baseShippingCost;
      // Include MercadoPago fee if that payment method is selected
      const mpFee = selectedPaymentMethod === 'mercadopago' ? mercadoPagoFee : 0;
      const grandTotal = totalPrice + shippingCost + mpFee;

      const shippingCostValue = form.querySelector('#shippingCostValue');
      const grandTotalValue = form.querySelector('#grandTotalValue');
      const shippingHint = form.querySelector('#shippingHint');
      const shippingCostLine = form.querySelector('#shippingCostLine');

      // Update shipping label with appropriate message
      const shippingMessage = getShippingMessage(city);

      if (cartAppliedPromoCode) {
        shippingCostLine.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;background:#d4edda;padding:8px 10px;border-radius:6px;">
            <span style="color:#155724;font-weight:600;">✅ Envío gratuito aplicado</span>
            <span style="font-weight:600;color:#155724;text-decoration:line-through;margin-right:8px;">$${baseShippingCost.toLocaleString()}</span>
            <span style="font-weight:700;color:#28a745;">GRATIS</span>
          </div>
        `;
        shippingHint.style.display = 'none';
      } else {
        shippingCostLine.innerHTML = `<span style="color:#166534;">🚚 ${shippingMessage}:</span><span id="shippingCostValue" style="font-weight:600;color:#ea580c;">$${shippingCost.toLocaleString()}</span>`;
        if (city) {
          shippingHint.style.display = 'none';
        } else {
          shippingHint.style.display = 'block';
        }
      }

      grandTotalValue.textContent = '$' + grandTotal.toLocaleString();
    };

    // Add event listener for city input
    form.querySelector('input[name="city"]').addEventListener('input', updateShippingCost);
    form.querySelector('input[name="city"]').addEventListener('change', updateShippingCost);

    // Promo code apply button handler for cart checkout
    form.querySelector('#applyPromoCodeBtn').addEventListener('click', () => {
      const promoInput = form.querySelector('input[name="promoCode"]');
      const code = promoInput.value.trim();
      const city = form.querySelector('input[name="city"]').value.trim();
      const promoMessage = form.querySelector('#promoCodeMessage');

      const result = validatePromoCode(code, city, cartItems);

      if (result.valid) {
        cartAppliedPromoCode = result.code;
        promoMessage.style.display = 'block';
        promoMessage.style.background = '#d4edda';
        promoMessage.style.color = '#155724';
        promoMessage.innerHTML = `✅ ${result.message} <button type="button" class="remove-promo-btn" style="margin-left:10px;background:none;border:none;color:#dc3545;cursor:pointer;font-weight:600;">Quitar</button>`;
        promoInput.disabled = true;
        form.querySelector('#applyPromoCodeBtn').disabled = true;
        form.querySelector('#applyPromoCodeBtn').style.background = '#6c757d';

        // Add remove button handler
        promoMessage.querySelector('.remove-promo-btn').addEventListener('click', () => {
          cartAppliedPromoCode = null;
          promoMessage.style.display = 'none';
          promoInput.disabled = false;
          promoInput.value = '';
          form.querySelector('#applyPromoCodeBtn').disabled = false;
          form.querySelector('#applyPromoCodeBtn').style.background = '#667eea';
          updateShippingCost();
        });

        updateShippingCost();
      } else {
        cartAppliedPromoCode = null;
        promoMessage.style.display = 'block';
        promoMessage.style.background = '#f8d7da';
        promoMessage.style.color = '#721c24';
        promoMessage.textContent = `❌ ${result.message}`;
        updateShippingCost();
      }
    });

    // Allow Enter key to apply promo code
    form.querySelector('input[name="promoCode"]').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        form.querySelector('#applyPromoCodeBtn').click();
      }
    });

    form.querySelectorAll('input[name="deliveryMethod"]').forEach(radio => {
      radio.addEventListener('change', toggleAddressFields);
    });

    toggleAddressFields();

    form.querySelector('#cancelCustomerForm').addEventListener('click', () => {
      document.body.removeChild(overlay);
      reject(new Error('Cancelled by user'));
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const deliveryMethod = formData.get('deliveryMethod');
      const city = formData.get('city');
      // Use UE-based shipping calculation
      const baseShippingCost = calculateShippingCostByUE(cartTotalUE, city, deliveryMethod);
      const shippingCost = cartAppliedPromoCode ? 0 : baseShippingCost;

      const customerData = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        identification: formData.get('identification'),
        deliveryMethod: deliveryMethod,
        address: formData.get('address'),
        city: city,
        notes: formData.get('notes'),
        shippingCost: shippingCost,
        baseShippingCost: baseShippingCost,
        totalUE: cartTotalUE, // Include total UE in customer data
        promoCode: cartAppliedPromoCode ? cartAppliedPromoCode.code : null,
        promoCodeApplied: cartAppliedPromoCode !== null,
        promoCodeData: cartAppliedPromoCode ? {
          code: cartAppliedPromoCode.code,
          discount: baseShippingCost
        } : null
      };
      document.body.removeChild(overlay);
      resolve(customerData);
    });

    content.appendChild(form);
    box.appendChild(header);
    box.appendChild(content);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }).then(async (customerData) => {
    // Create orders for each item in cart
    try {
      const orderIds = [];
      const shippingCost = customerData.shippingCost || 0;
      // Calculate MercadoPago fee for order records (only applies if MercadoPago selected)
      const orderMpFee = selectedPaymentMethod === 'mercadopago' ? mercadoPagoFee : 0;
      let isFirstOrder = true;

      for (const item of cartItems) {
        const prod = item.product;
        const unitPrice = getDisplayPrice(prod);
        const productPoints = getDisplayPoints(prod);
        const quantity = item.quantity;
        const itemTotalPrice = unitPrice * quantity;
        const totalPoints = productPoints * quantity;

        // Calculate UE for this item
        const itemUE = getProductUE(prod, quantity);

        // Only add shipping cost and MercadoPago fee to the first order
        const orderShippingCost = isFirstOrder ? shippingCost : 0;
        const orderPaymentGatewayFee = isFirstOrder ? orderMpFee : 0;
        const grandTotal = itemTotalPrice + orderShippingCost + orderPaymentGatewayFee;

        // Determine payment status based on selected method
        const orderStatus = selectedPaymentMethod === 'mercadopago' ? 'pending_payment' : 'pending_delivery';

        const orderObj = {
          productId: prod.id,
          productName: prod.nombre,
          price: unitPrice,
          quantity: quantity,
          totalPrice: itemTotalPrice,
          shippingCost: orderShippingCost,
          grandTotal: grandTotal,
          points: productPoints,
          totalPoints: totalPoints,
          // UE (Shipping Units) data
          shippingUnits: prod.shippingUnits || 2, // UE per unit
          totalShippingUnits: itemUE, // Total UE for this product
          cartTotalUE: isFirstOrder ? cartTotalUE : null, // Store cart total UE only on first order
          buyerUid,
          buyerUsername,
          buyerType,
          buyerInfo: customerData,
          deliveryMethod: customerData.deliveryMethod === 'pickup' ? 'pickup' : 'home',
          entrega: customerData.deliveryMethod === 'pickup' ? 'oficina' : 'domicilio',
          direccion: customerData.deliveryMethod === 'pickup' ? null : (customerData.address || null),
          telefono: customerData.phone || null,
          observaciones: customerData.notes || '',
          status: orderStatus,
          createdAt: new Date().toISOString(),
          isInitial: prod.id === "paquete-inicio",
          initialBonusPaid: false,
          paymentMethod: selectedPaymentMethod,
          fromCart: true,
          // Promotional code data (only on first order)
          promoCode: isFirstOrder ? (customerData.promoCode || null) : null,
          promoCodeApplied: isFirstOrder ? (customerData.promoCodeApplied || false) : false,
          baseShippingCost: isFirstOrder ? (customerData.baseShippingCost || orderShippingCost) : 0,
          shippingDiscount: isFirstOrder && customerData.promoCodeApplied ? (customerData.baseShippingCost || 0) : 0,
          // MercadoPago payment gateway fee data (only on first order)
          paymentGatewayFee: orderPaymentGatewayFee,
          paymentGatewayFeePercentage: isFirstOrder && selectedPaymentMethod === 'mercadopago' ? MERCADOPAGO_FEE_PERCENTAGE : 0,
          paymentGatewayFeeName: isFirstOrder && selectedPaymentMethod === 'mercadopago' ? 'Logística pasarela de pago (Mercado Pago)' : null
        };

        if (customerData.deliveryMethod === 'pickup') {
          orderObj.pickupInfo = {
            name: 'Oficina PorkCasaRe',
            address: 'Calle 123 #45-67, Ciudad',
            hours: 'Lun-Vie 9:00 - 17:00'
          };
          orderObj.buyerInfo.address = orderObj.pickupInfo.address;
        }

        const orderRef = await addDoc(collection(db, "orders"), orderObj);
        orderIds.push(orderRef.id);

        // Add to user history
        try {
          await updateDoc(doc(db, "usuarios", buyerUid), {
            history: arrayUnion({
              action: `Compra pendiente: ${prod.nombre} (x${quantity})`,
              amount: grandTotal,
              subtotal: itemTotalPrice,
              shippingCost: orderShippingCost,
              paymentGatewayFee: orderPaymentGatewayFee,
              points: totalPoints,
              quantity: quantity,
              orderId: orderRef.id,
              date: new Date().toISOString(),
              type: "pending_purchase"
            })
          });
        } catch (err) {
          console.error("Error actualizando historial:", err);
        }

        isFirstOrder = false;
      }

      // Clear cart
      cart.clear();

      // Close cart modal if open
      const cartModal = document.getElementById('cartModal');
      if (cartModal) cartModal.remove();

      // Handle MercadoPago payment
      if (selectedPaymentMethod === 'mercadopago') {
        // Build items array for MercadoPago
        const mpItems = cartItems.map(item => ({
          id: item.product.id,
          title: item.product.nombre,
          description: item.product.descripcion || '',
          quantity: item.quantity,
          unit_price: getDisplayPrice(item.product)
        }));

        // Add shipping cost as a separate item if applicable
        if (shippingCost > 0) {
          mpItems.push({
            id: 'shipping',
            title: 'Costo de envío',
            description: `Envío a ${customerData.city || 'domicilio'}`,
            quantity: 1,
            unit_price: shippingCost
          });
        }

        // Add MercadoPago payment gateway fee as a separate line item
        // This ensures the merchant receives 100% of the product value
        if (mercadoPagoFee > 0) {
          mpItems.push({
            id: 'mp_fee',
            title: 'Logística pasarela de pago (Mercado Pago)',
            description: `Comisión del ${MERCADOPAGO_FEE_PERCENTAGE}% por uso de pasarela de pago`,
            quantity: 1,
            unit_price: mercadoPagoFee
          });
        }

        try {
          // Show loading indicator
          const loadingOverlay = document.createElement('div');
          loadingOverlay.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(255,255,255,0.95);z-index:10001;';
          loadingOverlay.innerHTML = `
            <div style="text-align:center;">
              <div style="width:50px;height:50px;border:4px solid #e0e0e0;border-top:4px solid #009ee3;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
              <p style="font-size:18px;color:#333;margin:0;">Redirigiendo a MercadoPago...</p>
              <p style="font-size:14px;color:#666;margin-top:8px;">Por favor espera</p>
            </div>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
          `;
          document.body.appendChild(loadingOverlay);

          // Create MercadoPago preference
          const paymentResult = await createPayment({
            uid: buyerUid,
            items: mpItems,
            type: 'compra_carrito',
            description: `PorKCasare - Compra de ${cartItems.length} producto${cartItems.length !== 1 ? 's' : ''}`,
            payer: {
              name: customerData.firstName,
              surname: customerData.lastName,
              email: customerData.email,
              phone: {
                area_code: '57',
                number: customerData.phone
              },
              identification: {
                type: 'CC', // Cédula de Ciudadanía (Colombia)
                number: customerData.identification
              }
            }
          });

          if (paymentResult && paymentResult.init_point) {
            // Store order IDs in localStorage to update after payment
            localStorage.setItem('porkcasare_pending_orders', JSON.stringify({
              orderIds,
              preferenceId: paymentResult.preference_id,
              timestamp: Date.now()
            }));

            // Redirect to MercadoPago checkout
            window.location.href = paymentResult.init_point;
          } else {
            document.body.removeChild(loadingOverlay);
            throw new Error('No se pudo crear la preferencia de pago');
          }
        } catch (mpError) {
          console.error("Error creando preferencia de MercadoPago:", mpError);
          alert(`❌ Error al procesar el pago con MercadoPago: ${mpError.message}\n\nLos pedidos se han creado como pendientes de pago. Puedes intentar pagar desde tu historial de pedidos.`);
          window.location.href = `/oficina-virtual/index.html`;
        }
      } else {
        // Cash/transfer payment - show detailed success message with payment info
        const deliveryInfo = customerData.deliveryMethod === 'pickup'
          ? '🏢 <strong>Recogida en bodega/oficina:</strong><br>Calle 24a 11 68, Ciudad Yopal<br>Horario: Lun-Sab 7:00 - 17:00'
          : '🚚 <strong>Envío a domicilio:</strong><br>Te contactaremos para coordinar la entrega';

        const paymentInfoHtml = `
          <div style="text-align:left;margin-top:15px;">
            <h4 style="margin:0 0 10px 0;color:#28a745;">✅ ${orderIds.length} pedido${orderIds.length !== 1 ? 's' : ''} creado${orderIds.length !== 1 ? 's' : ''} correctamente</h4>

            <div style="background:#f8f9fa;padding:12px;border-radius:8px;margin-bottom:12px;">
              <p style="margin:0 0 8px 0;font-weight:600;color:#333;">💳 Cuentas autorizadas para transferencia:</p>
              <p style="margin:0;color:#666;">
                <strong>Nequi:</strong> 3125929316<br>
                <strong>Daviplata:</strong> 3125929316
              </p>
            </div>

            <div style="background:#e8f5e9;padding:12px;border-radius:8px;margin-bottom:12px;">
              ${deliveryInfo}
            </div>

            <p style="margin:0;font-size:13px;color:#666;">
              📱 Una vez realices el pago, envía el comprobante por WhatsApp al <strong>3125929316</strong> indicando tu usuario o código.
            </p>
          </div>
        `;

        // Use SweetAlert2 if available, otherwise fallback to custom modal
        if (typeof Swal !== 'undefined') {
          await Swal.fire({
            title: '¡Pedido Creado!',
            html: paymentInfoHtml,
            icon: 'success',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#28a745',
            allowOutsideClick: false
          });
        } else {
          // Fallback: show custom modal
          const modalOverlay = document.createElement('div');
          modalOverlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);z-index:10002;';
          const modalBox = document.createElement('div');
          modalBox.style.cssText = 'max-width:450px;width:90%;background:white;border-radius:12px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.3);';
          modalBox.innerHTML = `
            <div style="text-align:center;margin-bottom:15px;">
              <div style="font-size:48px;">✅</div>
              <h3 style="margin:10px 0 0 0;color:#333;">¡Pedido Creado!</h3>
            </div>
            ${paymentInfoHtml}
            <button id="closePaymentInfoModal" style="width:100%;margin-top:15px;padding:12px;background:#28a745;color:white;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">Entendido</button>
          `;
          modalOverlay.appendChild(modalBox);
          document.body.appendChild(modalOverlay);

          await new Promise(resolve => {
            modalBox.querySelector('#closePaymentInfoModal').addEventListener('click', () => {
              document.body.removeChild(modalOverlay);
              resolve();
            });
          });
        }

        window.location.href = `/oficina-virtual/index.html`;
      }
    } catch (err) {
      console.error("Error creando órdenes:", err);
      alert("Ocurrió un error al crear las órdenes. Intenta de nuevo.");
    }
  }).catch((err) => {
    if (err.message !== 'Cancelled by user') {
      console.error("Error en checkout:", err);
    }
  });
};

// Expose renderProductos globally for category filter buttons
window.renderProductos = renderProductos;

export { renderProductos };
