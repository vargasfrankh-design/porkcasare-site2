import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore, collection, getDocs, query, orderBy, limit, startAfter, getCountFromServer } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Pagination configuration
const USERS_PAGE_SIZE = 50;
let lastUserDoc = null;
let currentPage = 1;
let totalUsersCount = null;
let allUsersLoaded = false;

/**
 * Get total users count efficiently using getCountFromServer
 * This only counts documents without reading them
 * @returns {Promise<number>}
 */
async function getTotalUsersCount() {
  if (totalUsersCount !== null) return totalUsersCount;

  try {
    const coll = collection(db, 'usuarios');
    const snapshot = await getCountFromServer(coll);
    totalUsersCount = snapshot.data().count;
    return totalUsersCount;
  } catch (error) {
    console.warn('Could not get count, falling back to -1:', error);
    return -1;
  }
}

/**
 * Load users with pagination using limit + startAfter
 * This prevents reading the entire collection at once
 * @param {boolean} loadMore - Whether to load next page
 * @returns {Promise<Array>} Array of user data
 */
async function loadUsersPaginated(loadMore = false) {
  if (loadMore && allUsersLoaded) return [];

  try {
    let usersQuery;

    if (loadMore && lastUserDoc) {
      // Next page query
      usersQuery = query(
        collection(db, 'usuarios'),
        orderBy('createdAt', 'desc'),
        startAfter(lastUserDoc),
        limit(USERS_PAGE_SIZE)
      );
    } else {
      // First page query
      usersQuery = query(
        collection(db, 'usuarios'),
        orderBy('createdAt', 'desc'),
        limit(USERS_PAGE_SIZE)
      );
      // Reset state for fresh load
      lastUserDoc = null;
      currentPage = 1;
      allUsersLoaded = false;
    }

    const snapshot = await getDocs(usersQuery);

    // Track pagination state
    if (snapshot.docs.length > 0) {
      lastUserDoc = snapshot.docs[snapshot.docs.length - 1];
      if (loadMore) currentPage++;
    }

    if (snapshot.docs.length < USERS_PAGE_SIZE) {
      allUsersLoaded = true;
    }

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error loading users with createdAt order:', error);
    // Fallback without orderBy if createdAt field doesn't exist on all docs
    try {
      const fallbackQuery = query(
        collection(db, 'usuarios'),
        limit(USERS_PAGE_SIZE)
      );
      const fallbackSnapshot = await getDocs(fallbackQuery);
      return fallbackSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (fallbackError) {
      console.error('Fallback query also failed:', fallbackError);
      return [];
    }
  }
}

/**
 * Render users list to DOM
 * @param {Array} users - Users to render
 * @param {boolean} append - Append to existing list or replace
 */
function renderUsersList(users, append = false) {
  const ul = document.getElementById('usersList');
  if (!ul) return;

  if (!append) {
    ul.innerHTML = '';
  }

  users.forEach(u => {
    const li = document.createElement('li');
    li.innerText = (u.nombre || '') + ' - ' + (u.email || '') + ' - Puntos: ' + (u.puntos || 0);
    ul.appendChild(li);
  });
}

/**
 * Update pagination controls UI
 */
async function updatePaginationControls() {
  const paginationEl = document.getElementById('usersPagination');
  if (!paginationEl) return;

  const totalCount = await getTotalUsersCount();
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / USERS_PAGE_SIZE) : '?';

  paginationEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-top:12px;justify-content:center;">
      <span style="font-size:14px;color:#666;">
        Página ${currentPage} de ${totalPages} (${totalCount > 0 ? totalCount : '?'} usuarios)
      </span>
      ${!allUsersLoaded ? `<button id="loadMoreUsers" class="btn" style="padding:8px 16px;">Cargar más</button>` : ''}
    </div>
  `;

  // Attach event listener to load more button
  const loadMoreBtn = document.getElementById('loadMoreUsers');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', async () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Cargando...';
      const moreUsers = await loadUsersPaginated(true);
      renderUsersList(moreUsers, true);
      await updatePaginationControls();
    });
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) return window.location = 'login.html';

  // Load first page of users with pagination
  const users = await loadUsersPaginated(false);
  renderUsersList(users, false);
  await updatePaginationControls();
});