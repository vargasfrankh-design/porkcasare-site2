// cart.js - Shopping Cart Management
// Manages multiple products in a single order

import { auth, db } from "/src/firebase-config.js";
import { collection, addDoc, doc, getDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const POINT_VALUE = 2800;

class ShoppingCart {
  constructor() {
    this.items = this.loadCart();
    this.listeners = [];
  }

  loadCart() {
    try {
      const saved = localStorage.getItem('porkcasare_cart');
      return saved ? JSON.parse(saved) : [];
    } catch (err) {
      console.error('Error loading cart:', err);
      return [];
    }
  }

  saveCart() {
    try {
      localStorage.setItem('porkcasare_cart', JSON.stringify(this.items));
      this.notifyListeners();
    } catch (err) {
      console.error('Error saving cart:', err);
    }
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  notifyListeners() {
    this.listeners.forEach(cb => cb(this.items));
  }

  addItem(product, quantity = 1) {
    const existingIndex = this.items.findIndex(item => item.productId === product.id);

    if (existingIndex >= 0) {
      // Update existing item
      this.items[existingIndex].quantity += quantity;
    } else {
      // Add new item
      this.items.push({
        productId: product.id,
        productName: product.nombre,
        productImage: product.imagen,
        unitPrice: 0, // Will be calculated based on user type
        unitPoints: 0, // Will be calculated based on user type
        quantity: quantity,
        product: product // Store full product data for price calculation
      });
    }

    this.saveCart();
  }

  updateQuantity(productId, quantity) {
    const item = this.items.find(item => item.productId === productId);
    if (item) {
      item.quantity = Math.max(1, Math.min(99, quantity));
      this.saveCart();
    }
  }

  removeItem(productId) {
    this.items = this.items.filter(item => item.productId !== productId);
    this.saveCart();
  }

  clear() {
    this.items = [];
    this.saveCart();
  }

  getItems() {
    return this.items;
  }

  getItemCount() {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  getTotals(priceCalculator, pointsCalculator) {
    let totalPrice = 0;
    let totalPoints = 0;

    this.items.forEach(item => {
      const unitPrice = priceCalculator(item.product);
      const unitPoints = pointsCalculator(item.product);
      totalPrice += unitPrice * item.quantity;
      totalPoints += unitPoints * item.quantity;
    });

    return { totalPrice, totalPoints };
  }
}

// Singleton instance
const cart = new ShoppingCart();

// Cart UI Management
export function initializeCartUI(getDisplayPrice, getDisplayPoints) {
  // Create cart button in header
  createCartButton();

  // Update cart count
  updateCartBadge();

  // Listen for cart changes
  cart.addListener(() => {
    updateCartBadge();
  });

  // Make cart functions available globally
  window.cart = cart;
  window.openCartModal = () => openCartModal(getDisplayPrice, getDisplayPoints);
  window.addToCart = (productId, productos) => {
    const product = productos.find(p => p.id === productId);
    if (!product) return;

    const card = document.querySelector(`.product-card[data-id="${productId}"]`);
    const quantityInput = card?.querySelector('.qty-input');
    const quantity = parseInt(quantityInput?.value) || 1;

    cart.addItem(product, quantity);

    // Reset quantity to 1
    if (quantityInput) quantityInput.value = 1;

    // Show notification
    showCartNotification(`${product.nombre} agregado al carrito`);
  };
}

function createCartButton() {
  // Find a good place in the UI to add cart button
  // This will be added to the products section header
  const productGrid = document.getElementById('productGrid');
  if (!productGrid) return;

  const container = productGrid.parentElement;
  if (!container) return;

  // Check if cart button already exists
  if (document.getElementById('cartButton')) return;

  const cartButton = document.createElement('button');
  cartButton.id = 'cartButton';
  cartButton.className = 'btn';
  cartButton.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    box-shadow: 0 4px 12px rgba(118, 75, 162, 0.4);
    cursor: pointer;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    transition: all 0.3s ease;
  `;
  cartButton.innerHTML = '🛒<span id="cartBadge" style="position:absolute;top:-5px;right:-5px;background:#dc3545;color:white;border-radius:50%;width:24px;height:24px;display:none;align-items:center;justify-content:center;font-size:12px;font-weight:bold;"></span>';

  cartButton.addEventListener('click', () => window.openCartModal());
  cartButton.addEventListener('mouseenter', () => {
    cartButton.style.transform = 'scale(1.1)';
  });
  cartButton.addEventListener('mouseleave', () => {
    cartButton.style.transform = 'scale(1)';
  });

  document.body.appendChild(cartButton);
}

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (!badge) return;

  const count = cart.getItemCount();
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function showCartNotification(message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #28a745;
    color: white;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

// Helper function to format prices correctly (COP currency, no decimals)
function formatPrice(num) {
  return Math.round(num).toLocaleString('es-CO');
}

// Helper function to format points (rounded to 2 decimal places max)
function formatPoints(num) {
  const rounded = Math.round(num * 100) / 100;
  // If it's a whole number, show without decimals
  return Number.isInteger(rounded) ? rounded : rounded.toFixed(2).replace(/\.?0+$/, '');
}

function openCartModal(getDisplayPrice, getDisplayPoints) {
  const items = cart.getItems();

  if (items.length === 0) {
    alert('El carrito está vacío');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'cartModal';
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(3px);
  `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: white;
    border-radius: 12px;
    max-width: 800px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  `;

  // Calculate totals
  const { totalPrice, totalPoints } = cart.getTotals(getDisplayPrice, getDisplayPoints);

  let itemsHTML = items.map(item => {
    const unitPrice = Math.round(getDisplayPrice(item.product));
    const unitPoints = getDisplayPoints(item.product);
    const itemTotal = Math.round(unitPrice * item.quantity);
    const itemPoints = Math.round(unitPoints * item.quantity * 100) / 100;

    return `
      <div style="display:flex;gap:16px;padding:16px;border-bottom:1px solid #eee;align-items:center;">
        <img src="${item.productImage}" alt="${item.productName}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;">
        <div style="flex:1;">
          <h4 style="margin:0 0 8px 0;font-size:16px;">${item.productName}</h4>
          <p style="margin:0;font-size:14px;color:#666;">$${formatPrice(unitPrice)} × ${item.quantity}</p>
          <p style="margin:4px 0 0 0;font-size:13px;color:#28a745;">${formatPoints(itemPoints)} pts</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button onclick="window.updateCartItemQuantity('${item.productId}', ${item.quantity - 1})" class="qty-btn" style="width:30px;height:30px;border:1px solid #ddd;background:white;border-radius:4px;cursor:pointer;">−</button>
          <span style="min-width:30px;text-align:center;font-weight:600;">${item.quantity}</span>
          <button onclick="window.updateCartItemQuantity('${item.productId}', ${item.quantity + 1})" class="qty-btn" style="width:30px;height:30px;border:1px solid #ddd;background:white;border-radius:4px;cursor:pointer;">+</button>
        </div>
        <div style="text-align:right;min-width:120px;">
          <p style="margin:0;font-size:18px;font-weight:700;">$${formatPrice(itemTotal)}</p>
          <p style="margin:4px 0 0 0;font-size:14px;color:#28a745;">${formatPoints(itemPoints)} pts</p>
        </div>
        <button onclick="window.removeFromCart('${item.productId}')" style="background:#dc3545;color:white;border:none;padding:8px 12px;border-radius:4px;cursor:pointer;font-size:12px;">✕</button>
      </div>
    `;
  }).join('');

  // Round totals for display
  const displayTotalPrice = Math.round(totalPrice);
  const displayTotalPoints = Math.round(totalPoints * 100) / 100;

  modalContent.innerHTML = `
    <div style="padding:24px;border-bottom:2px solid #eee;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="margin:0;">Carrito de Compras</h2>
        <button onclick="document.getElementById('cartModal').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666;">✕</button>
      </div>
    </div>
    <div style="max-height:400px;overflow-y:auto;">
      ${itemsHTML}
    </div>
    <div style="padding:24px;background:#f8f9fa;">
      <div style="display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #dee2e6;">
        <div>
          <p style="margin:0 0 8px 0;font-size:14px;color:#666;">${items.length} producto${items.length !== 1 ? 's' : ''} (${cart.getItemCount()} unidades)</p>
          <p style="margin:0;font-size:24px;font-weight:700;">Total: $${formatPrice(displayTotalPrice)}</p>
        </div>
        <div style="text-align:right;">
          <p style="margin:0 0 8px 0;font-size:14px;color:#666;">Puntos totales</p>
          <p style="margin:0;font-size:24px;font-weight:700;color:#28a745;">${formatPoints(displayTotalPoints)} pts</p>
        </div>
      </div>
      <div style="display:flex;gap:12px;">
        <button onclick="window.clearCart()" class="btn-secondary" style="flex:1;padding:12px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Vaciar Carrito</button>
        <button onclick="window.proceedToCheckout()" class="btn-primary" style="flex:2;padding:12px;background:#667eea;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Proceder al Pago</button>
      </div>
    </div>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // Make cart functions available
  window.updateCartItemQuantity = (productId, newQuantity) => {
    if (newQuantity < 1) {
      cart.removeItem(productId);
    } else {
      cart.updateQuantity(productId, newQuantity);
    }
    modal.remove();
    openCartModal(getDisplayPrice, getDisplayPoints);
  };

  window.removeFromCart = (productId) => {
    cart.removeItem(productId);
    modal.remove();
    if (cart.getItems().length > 0) {
      openCartModal(getDisplayPrice, getDisplayPoints);
    }
  };

  window.clearCart = () => {
    if (confirm('¿Estás seguro de que deseas vaciar el carrito?')) {
      cart.clear();
      modal.remove();
    }
  };
}

export { cart };
