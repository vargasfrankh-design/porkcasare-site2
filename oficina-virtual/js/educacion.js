/**
 * Educación Content Loader
 * Loads educational content from Firestore for the virtual office
 * Content is managed by administrators and displayed as links to distributors
 *
 * OPTIMIZATION: Implements localStorage cache with 1-hour TTL to reduce
 * Firestore reads. Content is cached per type (pec, video, documento, libro, link)
 * and only fetched from server when cache expires or is manually invalidated.
 */

import { db } from '/src/firebase-config.js';
import { collection, getDocs, query, where, orderBy, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// Track if content has been loaded to avoid duplicate loads
let contentLoaded = false;

// Cache configuration
const CACHE_KEY_PREFIX = 'educacion_cache_';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Cache utility functions for localStorage with TTL
 */
const cacheUtils = {
  /**
   * Get cached data if valid (not expired)
   * @param {string} key - Cache key
   * @returns {Array|null} Cached data or null if expired/missing
   */
  get(key) {
    try {
      const cached = localStorage.getItem(CACHE_KEY_PREFIX + key);
      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);
      const age = Date.now() - timestamp;

      // Check if cache is still valid
      if (age < CACHE_TTL_MS) {
        console.log(`[educacion.js] Cache hit for ${key} (age: ${Math.round(age / 1000)}s)`);
        return data;
      }

      console.log(`[educacion.js] Cache expired for ${key} (age: ${Math.round(age / 1000)}s)`);
      return null;
    } catch (error) {
      console.warn(`[educacion.js] Cache read error for ${key}:`, error);
      return null;
    }
  },

  /**
   * Store data in cache with current timestamp
   * @param {string} key - Cache key
   * @param {Array} data - Data to cache
   */
  set(key, data) {
    try {
      const cacheEntry = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify(cacheEntry));
      console.log(`[educacion.js] Cached ${data.length} items for ${key}`);
    } catch (error) {
      // Handle quota exceeded or other storage errors gracefully
      console.warn(`[educacion.js] Cache write error for ${key}:`, error);
    }
  },

  /**
   * Clear specific cache key
   * @param {string} key - Cache key to clear
   */
  clear(key) {
    try {
      localStorage.removeItem(CACHE_KEY_PREFIX + key);
    } catch (error) {
      console.warn(`[educacion.js] Cache clear error for ${key}:`, error);
    }
  },

  /**
   * Clear all education cache
   */
  clearAll() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(CACHE_KEY_PREFIX))
        .forEach(k => localStorage.removeItem(k));
      console.log('[educacion.js] All cache cleared');
    } catch (error) {
      console.warn('[educacion.js] Cache clear all error:', error);
    }
  }
};

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Detect link type from URL
 */
function detectLinkType(url) {
  if (!url) return 'link';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  if (lowerUrl.includes('tiktok.com')) return 'tiktok';
  if (lowerUrl.endsWith('.pdf')) return 'pdf';
  if (lowerUrl.includes('docs.google.com') || lowerUrl.includes('drive.google.com')) return 'document';
  return 'link';
}

/**
 * Get icon for link type
 */
function getLinkIcon(type, customIcon) {
  if (customIcon) return customIcon;
  const icons = {
    youtube: '🎥',
    tiktok: '📱',
    pdf: '📄',
    document: '📑',
    libro: '📚',
    pec: '📋',
    video: '▶️',
    link: '🔗'
  };
  return icons[type] || icons.link;
}

/**
 * Render a resource link item
 */
function renderResourceLink(item, type) {
  const link = document.createElement('a');
  const url = item.url || item.link || '#';
  const linkType = detectLinkType(url);

  link.className = 'resource-link-item';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('data-type', linkType);

  const icon = getLinkIcon(type || linkType, item.icono);
  const title = escapeHtml(item.titulo || item.title || 'Recurso');
  const description = escapeHtml(item.descripcion || '');

  link.innerHTML = `
    <div class="resource-link-icon">${icon}</div>
    <div class="resource-link-content">
      <div class="resource-link-title">${title}</div>
      ${description ? `<div class="resource-link-description">${description}</div>` : ''}
    </div>
    <span class="resource-link-arrow">→</span>
  `;

  return link;
}

/**
 * Product data cache to avoid repeated Firestore queries
 */
const productDataCache = new Map();

/**
 * Fetch product data (image, title, description) from the productos collection
 * @param {string} productoId - The product ID to fetch
 * @returns {Promise<{imagen: string|null, nombre: string|null, descripcion: string|null}>} Product data
 */
async function fetchProductData(productoId) {
  if (!productoId || !db) return { imagen: null, nombre: null, descripcion: null };

  // Check cache first
  if (productDataCache.has(productoId)) {
    return productDataCache.get(productoId);
  }

  try {
    const productRef = doc(db, 'productos', productoId);
    const productSnap = await getDoc(productRef);

    if (productSnap.exists()) {
      const productData = productSnap.data();
      const data = {
        imagen: productData.imagen || null,
        nombre: productData.nombre || null,
        descripcion: productData.descripcion || null
      };
      productDataCache.set(productoId, data);
      return data;
    }
  } catch (error) {
    console.warn('[educacion.js] Error fetching product data:', error);
  }

  const emptyData = { imagen: null, nombre: null, descripcion: null };
  productDataCache.set(productoId, emptyData);
  return emptyData;

}

/**
 * Legacy wrapper for backwards compatibility
 */
async function fetchProductImage(productoId) {
  const data = await fetchProductData(productoId);
  return data.imagen;
}

/**
 * Render a PEC card with image, title, and description
 * When clicked, redirects to the consumo section and highlights the associated product
 * If a productoId is specified, fetches and displays the product's image, title and description
 */
function renderPECCard(item) {
  const card = document.createElement('div');
  const itemTitle = escapeHtml(item.titulo || item.title || '');
  const itemDescription = escapeHtml(item.descripcion || '');
  // Handle imagen path - if it already starts with '/' or 'http', use as-is, otherwise prepend /images/pec/
  let pecImageSrc = null;
  if (item.imagen) {
    if (item.imagen.startsWith('/') || item.imagen.startsWith('http')) {
      pecImageSrc = item.imagen;
    } else {
      pecImageSrc = `/images/pec/${item.imagen}`;
    }
  }
  const productoId = item.productoId || '';

  card.className = 'pec-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('data-producto-id', productoId);

  // Only make it clickable if there's a product ID
  if (productoId) {
    card.style.cursor = 'pointer';
  }

  // Use item title/description if available, otherwise show placeholder
  const displayTitle = itemTitle || 'Material PEC';
  const displayDescription = itemDescription;

  // Determine if we should show loading placeholder for description
  // Only show loading if we have a productoId (so we can fetch the product data)
  // and the PEC item doesn't have its own description
  const showDescriptionLoading = !displayDescription && productoId;

  // Initial render with PEC image or placeholder
  card.innerHTML = `
    <div class="pec-card-image-container">
      ${pecImageSrc ?
        `<img class="pec-card-image" src="${pecImageSrc}" alt="${displayTitle}" onerror="this.style.display='none'; this.parentElement.classList.add('no-image');">` :
        `<div class="pec-card-placeholder-icon">📋</div>`
      }
    </div>
    <div class="pec-card-content">
      <h4 class="pec-card-title">${displayTitle}</h4>
      ${displayDescription ? `<p class="pec-card-description">${displayDescription}</p>` : (showDescriptionLoading ? '<p class="pec-card-description pec-loading">Cargando información...</p>' : '')}
    </div>
    <div class="pec-card-footer">
      ${productoId ? `<span class="pec-card-action">Ver producto →</span>` : ''}
    </div>
  `;

  // If there's a linked product, fetch its data and update the card
  if (productoId) {
    fetchProductData(productoId).then(productData => {
      // Update image ONLY if the PEC item doesn't have its own image
      // This preserves the PEC-specific cover image when configured
      if (!pecImageSrc && productData.imagen) {
        const imageContainer = card.querySelector('.pec-card-image-container');
        if (imageContainer) {
          imageContainer.innerHTML = `<img class="pec-card-image" src="${productData.imagen}" alt="${productData.nombre || displayTitle}" onerror="this.style.display='none'; this.parentElement.classList.add('no-image');">`;
        }
      }

      // Update title if PEC item doesn't have one
      if (!itemTitle && productData.nombre) {
        const titleEl = card.querySelector('.pec-card-title');
        if (titleEl) {
          titleEl.textContent = productData.nombre;
        }
      }

      // Update description: if PEC item doesn't have one, use product description
      const descEl = card.querySelector('.pec-card-description');
      if (!itemDescription && productData.descripcion) {
        // PEC has no description but product does - update or create description element
        if (descEl) {
          descEl.textContent = productData.descripcion;
          descEl.classList.remove('pec-loading');
        } else {
          // Create description element if it doesn't exist
          const contentEl = card.querySelector('.pec-card-content');
          if (contentEl) {
            const newDescEl = document.createElement('p');
            newDescEl.className = 'pec-card-description';
            newDescEl.textContent = productData.descripcion;
            contentEl.appendChild(newDescEl);
          }
        }
      } else if (descEl) {
        if (!itemDescription && !productData.descripcion) {
          // Remove the loading placeholder if no description available anywhere
          descEl.remove();
        } else {
          // PEC has its own description, just remove loading class
          descEl.classList.remove('pec-loading');
        }
      }
    });

    // Click handler to redirect to consumo section and show product
    const handleClick = () => {
      navigateToProduct(productoId);
    };

    card.addEventListener('click', handleClick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    });
  }

  return card;
}

/**
 * Navigate to the Consumo tab and scroll to/highlight the specified product
 * @param {string} productoId - The ID of the product to show
 */
function navigateToProduct(productoId) {
  // Silently return if no product ID - this shouldn't happen as the click handler
  // is only attached when productoId exists
  if (!productoId) {
    return;
  }

  // Switch to Consumo tab
  const consumoTab = document.querySelector('.section-tab[data-tab="consumo"]');
  if (consumoTab) {
    consumoTab.click();
  }

  // Wait for tab switch animation and product grid to render
  setTimeout(() => {
    // Find the product card
    const productCard = document.querySelector(`.product-card[data-id="${productoId}"]`);

    if (productCard) {
      // Scroll to the product
      productCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Add highlight animation
      productCard.classList.add('pec-highlight');
      setTimeout(() => {
        productCard.classList.remove('pec-highlight');
      }, 3000);
    } else {
      // Product not found in current view, try to find it by clearing filters
      console.log('[educacion.js] Product not visible, resetting category filter...');

      // Reset category filter to 'todas' to show all products
      const allCategoryBtn = document.querySelector('.category-filter-btn[data-category="todas"]');
      if (allCategoryBtn) {
        allCategoryBtn.click();
      }

      // Try again after filter reset
      setTimeout(() => {
        const productCardRetry = document.querySelector(`.product-card[data-id="${productoId}"]`);
        if (productCardRetry) {
          productCardRetry.scrollIntoView({ behavior: 'smooth', block: 'center' });
          productCardRetry.classList.add('pec-highlight');
          setTimeout(() => {
            productCardRetry.classList.remove('pec-highlight');
          }, 3000);
        } else {
          console.warn('[educacion.js] Product not found:', productoId);
          // Show a message to the user
          if (typeof Swal !== 'undefined') {
            Swal.fire({
              icon: 'info',
              title: 'Producto no disponible',
              text: 'El producto asociado a este recurso PEC no está disponible actualmente.',
              confirmButtonText: 'Entendido'
            });
          }
        }
      }, 500);
    }
  }, 300);
}

/**
 * Show placeholder when no content is available
 */
function showPlaceholder(container, icon, message) {
  container.innerHTML = `
    <div class="education-placeholder-compact">
      <span class="placeholder-icon">${icon}</span>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Load and render education content from Firestore
 */
async function loadEducationContent(forceReload = false) {
  // Skip if already loaded (unless forced)
  if (contentLoaded && !forceReload) {
    console.log('[educacion.js] Content already loaded, skipping');
    return;
  }

  if (!db) {
    console.warn('[educacion.js] Firestore database not available - cannot load education content');
    return;
  }

  console.log('[educacion.js] Loading education content from Firestore...');

  try {
    // Load all content types in parallel for better performance
    const results = await Promise.allSettled([
      loadPECContent(),
      loadVideosContent(),
      loadDocumentsContent(),
      loadLinksContent()
    ]);

    // Log any failures
    results.forEach((result, index) => {
      const types = ['PEC', 'Videos', 'Documents', 'Links'];
      if (result.status === 'rejected') {
        console.error(`[educacion.js] Failed to load ${types[index]}:`, result.reason);
      }
    });

    contentLoaded = true;
    console.log('[educacion.js] Education content loaded successfully');

  } catch (error) {
    console.error('[educacion.js] Error loading education content:', error);
  }
}

/**
 * Load PEC del Mes content
 * Uses localStorage cache with 1-hour TTL to reduce Firestore reads
 * Renders PEC content as visual cards with images, title, and description
 */
async function loadPECContent() {
  const container = document.getElementById('pecDelMes');
  if (!container) {
    console.log('[educacion.js] PEC container not found');
    return;
  }
  if (!db) return;

  try {
    // Check cache first
    const cachedData = cacheUtils.get('pec');
    let items;

    if (cachedData !== null) {
      // Use cached data
      items = cachedData;
      console.log(`[educacion.js] PEC loaded from cache: ${items.length} documents`);
    } else {
      // Fetch from Firestore
      const q = query(
        collection(db, 'educacion'),
        where('tipo', '==', 'pec'),
        where('activo', '==', true),
        orderBy('fecha', 'desc')
      );

      const snapshot = await getDocs(q);
      console.log(`[educacion.js] PEC query returned ${snapshot.size} documents`);

      items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Cache the results
      cacheUtils.set('pec', items);
    }

    if (items.length === 0) {
      showPlaceholder(container, '📋', 'El PEC del mes se cargará desde administración.');
      return;
    }

    // Use grid layout for PEC cards
    container.innerHTML = '';
    container.classList.add('pec-cards-grid');
    items.forEach(data => {
      container.appendChild(renderPECCard(data));
    });
  } catch (e) {
    console.error('[educacion.js] PEC load error:', e);
    showPlaceholder(container, '⚠️', 'Error al cargar el PEC.');
  }
}

/**
 * Load video content
 * Uses localStorage cache with 1-hour TTL to reduce Firestore reads
 */
async function loadVideosContent() {
  const container = document.getElementById('videosEducativos');
  if (!container) {
    console.log('[educacion.js] Videos container not found');
    return;
  }
  if (!db) return;

  try {
    // Check cache first
    const cachedData = cacheUtils.get('video');
    let items;

    if (cachedData !== null) {
      // Use cached data
      items = cachedData;
      console.log(`[educacion.js] Videos loaded from cache: ${items.length} documents`);
    } else {
      // Fetch from Firestore
      const q = query(
        collection(db, 'educacion'),
        where('tipo', '==', 'video'),
        where('activo', '==', true),
        orderBy('fecha', 'desc')
      );

      const snapshot = await getDocs(q);
      console.log(`[educacion.js] Videos query returned ${snapshot.size} documents`);

      items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Cache the results
      cacheUtils.set('video', items);
    }

    if (items.length === 0) {
      showPlaceholder(container, '▶️', 'Los videos se cargarán desde administración.');
      return;
    }

    container.innerHTML = '';
    items.forEach(data => {
      container.appendChild(renderResourceLink(data, 'video'));
    });
  } catch (e) {
    console.error('[educacion.js] Videos load error:', e);
    showPlaceholder(container, '⚠️', 'Error al cargar los videos.');
  }
}

/**
 * Load documents and books content
 * Uses separate queries to avoid requiring additional composite indexes for 'in' operator
 * Uses localStorage cache with 1-hour TTL to reduce Firestore reads
 */
async function loadDocumentsContent() {
  const container = document.getElementById('librosDocumentos');
  if (!container) {
    console.log('[educacion.js] Documents container not found');
    return;
  }
  if (!db) return;

  try {
    // Check cache first (combined cache for documents + books)
    const cachedData = cacheUtils.get('documents_books');
    let allDocs;

    if (cachedData !== null) {
      // Use cached data
      allDocs = cachedData;
      console.log(`[educacion.js] Documents loaded from cache: ${allDocs.length} documents`);
    } else {
      // Run separate queries for 'documento' and 'libro' types to avoid composite index issues with 'in' operator
      const [docsSnapshot, librosSnapshot] = await Promise.all([
        getDocs(query(
          collection(db, 'educacion'),
          where('tipo', '==', 'documento'),
          where('activo', '==', true),
          orderBy('fecha', 'desc')
        )),
        getDocs(query(
          collection(db, 'educacion'),
          where('tipo', '==', 'libro'),
          where('activo', '==', true),
          orderBy('fecha', 'desc')
        ))
      ]);

      // Combine results
      allDocs = [];
      docsSnapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));
      librosSnapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));

      // Sort by fecha descending (for combined results)
      allDocs.sort((a, b) => {
        const dateA = a.fecha?.toDate ? a.fecha.toDate() : new Date(0);
        const dateB = b.fecha?.toDate ? b.fecha.toDate() : new Date(0);
        return dateB - dateA;
      });

      console.log(`[educacion.js] Documents query returned ${allDocs.length} documents (${docsSnapshot.size} documentos + ${librosSnapshot.size} libros)`);

      // Cache the combined results
      cacheUtils.set('documents_books', allDocs);
    }

    if (allDocs.length === 0) {
      showPlaceholder(container, '📄', 'Los libros y documentos se cargarán desde administración.');
      return;
    }

    container.innerHTML = '';
    allDocs.forEach(item => {
      container.appendChild(renderResourceLink(item, item.tipo || 'document'));
    });
  } catch (e) {
    console.error('[educacion.js] Documents load error:', e);
    showPlaceholder(container, '⚠️', 'Error al cargar los documentos.');
  }
}

/**
 * Load useful links content
 * Uses localStorage cache with 1-hour TTL to reduce Firestore reads
 */
async function loadLinksContent() {
  const container = document.getElementById('enlacesUtiles');
  if (!container) {
    console.log('[educacion.js] Links container not found');
    return;
  }
  if (!db) return;

  try {
    // Check cache first
    const cachedData = cacheUtils.get('link');
    let items;

    if (cachedData !== null) {
      // Use cached data
      items = cachedData;
      console.log(`[educacion.js] Links loaded from cache: ${items.length} documents`);
    } else {
      // Fetch from Firestore
      const q = query(
        collection(db, 'educacion'),
        where('tipo', '==', 'link'),
        where('activo', '==', true),
        orderBy('fecha', 'desc')
      );

      const snapshot = await getDocs(q);
      console.log(`[educacion.js] Links query returned ${snapshot.size} documents`);

      items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Cache the results
      cacheUtils.set('link', items);
    }

    if (items.length === 0) {
      showPlaceholder(container, '🌐', 'Los enlaces se cargarán desde administración.');
      return;
    }

    container.innerHTML = '';
    items.forEach(data => {
      container.appendChild(renderResourceLink(data, 'link'));
    });
  } catch (e) {
    console.error('[educacion.js] Links load error:', e);
    showPlaceholder(container, '⚠️', 'Error al cargar los enlaces.');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadEducationContent);
} else {
  loadEducationContent();
}

// Also load when education tab is shown
// Note: forceReload=true only reloads from cache or server if cache is valid
// To force a server fetch, call invalidateCache() first
window.addEventListener('tab-educacion-shown', () => {
  console.log('[educacion.js] Education tab shown, loading content...');
  loadEducationContent(false); // Use cache if available for tab switches
});

/**
 * Invalidate all education cache (call this after admin updates content)
 */
function invalidateCache() {
  cacheUtils.clearAll();
  contentLoaded = false;
  console.log('[educacion.js] Cache invalidated, next load will fetch from server');
}

/**
 * Force reload from server (bypasses cache)
 */
async function forceReloadFromServer() {
  cacheUtils.clearAll();
  contentLoaded = false;
  await loadEducationContent(true);
}

// Export for external use
export { loadEducationContent, invalidateCache, forceReloadFromServer };
