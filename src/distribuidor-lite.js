import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, getDocs, query, where, orderBy, limit, startAfter } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { redirectToPayment, handlePaymentReturn, getStatusMessage, formatCurrency } from './mercadopago-client.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const REBUY_AMOUNT = 60000;

// Pagination config for payments history
const PAYMENTS_PAGE_SIZE = 20;
let lastPaymentDoc = null;
let allPaymentsLoaded = false;

/**
 * Load payments for a specific user using server-side filtering (query + where)
 * instead of loading entire collection and filtering client-side.
 * Includes pagination support for large payment histories.
 * @param {string} uid - User ID to filter payments
 * @param {boolean} loadMore - Whether to load more payments (pagination)
 * @returns {Promise<Array>} Array of payment items
 */
async function loadUserPayments(uid, loadMore = false) {
  if (!uid) return [];

  // If loading more and all payments are already loaded, return empty
  if (loadMore && allPaymentsLoaded) return [];

  try {
    // Build query with server-side filtering by uid
    // Uses index on payments.uid for optimal performance
    let paymentsQuery;

    if (loadMore && lastPaymentDoc) {
      // Paginated query: get next page after last document
      paymentsQuery = query(
        collection(db, 'payments'),
        where('uid', '==', uid),
        orderBy('createdAt', 'desc'),
        startAfter(lastPaymentDoc),
        limit(PAYMENTS_PAGE_SIZE)
      );
    } else {
      // Initial query: first page
      paymentsQuery = query(
        collection(db, 'payments'),
        where('uid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(PAYMENTS_PAGE_SIZE)
      );
    }

    const snapshot = await getDocs(paymentsQuery);

    // Track last document for pagination
    if (snapshot.docs.length > 0) {
      lastPaymentDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    // Check if all payments have been loaded
    if (snapshot.docs.length < PAYMENTS_PAGE_SIZE) {
      allPaymentsLoaded = true;
    }

    return snapshot.docs.map(d => d.data());
  } catch (error) {
    console.error('Error loading payments:', error);
    // Fallback without orderBy if index not yet created
    // This maintains functionality while index is being created
    try {
      const fallbackQuery = query(
        collection(db, 'payments'),
        where('uid', '==', uid),
        limit(PAYMENTS_PAGE_SIZE)
      );
      const fallbackSnapshot = await getDocs(fallbackQuery);
      return fallbackSnapshot.docs.map(d => d.data());
    } catch (fallbackError) {
      console.error('Fallback query also failed:', fallbackError);
      return [];
    }
  }
}

/**
 * Render payments to the history element
 * @param {Array} items - Payment items to render
 * @param {boolean} append - Whether to append to existing content
 */
function renderPayments(items, append = false) {
  const historyEl = document.getElementById('history');
  if (!historyEl) return;

  const html = items.map(i =>
    `<div class="small">${i.type || 'pago'} - $${i.amount || 0} - ${i.status || 'pendiente'}</div>`
  ).join('');

  if (append) {
    historyEl.innerHTML += html;
  } else {
    historyEl.innerHTML = html;
  }

  // Show/hide load more button based on whether there are more payments
  const loadMoreBtn = document.getElementById('loadMorePayments');
  if (loadMoreBtn) {
    loadMoreBtn.style.display = allPaymentsLoaded ? 'none' : 'block';
  }
}

onAuthStateChanged(auth, async user=>{
  if(!user) return window.location='login.html';
  const uid = user.uid;
  const snap = await getDoc(doc(db,'usuarios',uid));
  if(!snap.exists()) return alert('Perfil no encontrado');
  const data = snap.data();
  document.getElementById('name').innerText = data.nombre || '';
  document.getElementById('email').innerText = data.email || '';
  document.getElementById('code').innerText = data.codigoReferido || '';
  document.getElementById('points').innerText = data.puntos || 0;

  // Reset pagination state for new user session
  lastPaymentDoc = null;
  allPaymentsLoaded = false;

  // Load payments history using optimized server-side query with pagination
  // This query uses index payments.uid + payments.createdAt for efficiency
  const items = await loadUserPayments(uid);
  renderPayments(items, false);

  // Setup load more button if it exists
  const loadMoreBtn = document.getElementById('loadMorePayments');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', async () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Cargando...';
      const moreItems = await loadUserPayments(uid, true);
      renderPayments(moreItems, true);
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Cargar más';
    });
  }
});

document.getElementById('btnRecompra').addEventListener('click', async ()=>{
  const user = getAuth().currentUser;
  if(!user) return alert('Inicia sesión');

  try {
    await redirectToPayment({
      uid: user.uid,
      amount: REBUY_AMOUNT,
      type: 'recompra',
      description: 'Recompra de puntos PorKCasare'
    });
  } catch (error) {
    alert('Error creando preferencia de pago');
    console.error(error);
  }
});

// Handle MercadoPago payment return
(async function handleReturn(){
  await handlePaymentReturn({
    onSuccess: (payment) => {
      console.log('Pago aprobado:', payment);
      const amount = payment.amount ? formatCurrency(payment.amount) : '';
      alert(`Pago aprobado${amount ? ` por ${amount}` : ''}. Tus puntos han sido acreditados.`);
      // Reload to show updated points
      window.location.href = 'distribuidor.html';
    },
    onPending: (payment) => {
      console.log('Pago pendiente:', payment);
      alert('Tu pago está siendo procesado. Te notificaremos cuando sea aprobado.');
      window.location.href = 'distribuidor.html';
    },
    onFailure: (payment) => {
      console.log('Pago fallido:', payment);
      const message = payment.statusDetail || getStatusMessage(payment.status) || 'Pago no completado';
      alert(`${message}. Por favor intenta de nuevo.`);
    },
    clearParams: true
  });
})();
