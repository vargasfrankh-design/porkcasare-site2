/**
 * Educación Content Loader
 * Loads educational content from Firestore for the virtual office
 * Content is managed by administrators and displayed as links to distributors
 */

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase configuration (uses existing config from the app)
let db = null;

/**
 * Initialize Firestore connection
 */
function initFirestore() {
  try {
    const apps = getApps();
    if (apps.length > 0) {
      db = getFirestore(apps[0]);
    } else {
      // Fallback: try to get existing firebase instance
      if (window.firebase && window.firebase.firestore) {
        db = window.firebase.firestore();
      }
    }
  } catch (e) {
    console.debug('[educacion.js] Firestore init:', e.message);
  }
}

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
async function loadEducationContent() {
  if (!db) {
    initFirestore();
  }

  if (!db) {
    console.debug('[educacion.js] Firestore not available, showing placeholders');
    return;
  }

  try {
    // Load PEC del Mes
    await loadPECContent();

    // Load Videos
    await loadVideosContent();

    // Load Documents/Books
    await loadDocumentsContent();

    // Load Links
    await loadLinksContent();

  } catch (error) {
    console.debug('[educacion.js] Error loading content:', error.message);
  }
}

/**
 * Load PEC del Mes content
 */
async function loadPECContent() {
  const container = document.getElementById('pecDelMes');
  if (!container || !db) return;

  try {
    const q = query(
      collection(db, 'educacion'),
      where('tipo', '==', 'pec'),
      where('activo', '==', true),
      orderBy('fecha', 'desc')
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      showPlaceholder(container, '📋', 'El PEC del mes se cargará desde administración.');
      return;
    }

    container.innerHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      container.appendChild(renderResourceLink(data, 'pec'));
    });
  } catch (e) {
    console.debug('[educacion.js] PEC load error:', e.message);
  }
}

/**
 * Load video content
 */
async function loadVideosContent() {
  const container = document.getElementById('videosEducativos');
  if (!container || !db) return;

  try {
    const q = query(
      collection(db, 'educacion'),
      where('tipo', '==', 'video'),
      where('activo', '==', true),
      orderBy('fecha', 'desc')
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      showPlaceholder(container, '▶️', 'Los videos se cargarán desde administración.');
      return;
    }

    container.innerHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      container.appendChild(renderResourceLink(data, 'video'));
    });
  } catch (e) {
    console.debug('[educacion.js] Videos load error:', e.message);
  }
}

/**
 * Load documents and books content
 */
async function loadDocumentsContent() {
  const container = document.getElementById('librosDocumentos');
  if (!container || !db) return;

  try {
    const q = query(
      collection(db, 'educacion'),
      where('tipo', 'in', ['documento', 'libro']),
      where('activo', '==', true),
      orderBy('fecha', 'desc')
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      showPlaceholder(container, '📄', 'Los libros y documentos se cargarán desde administración.');
      return;
    }

    container.innerHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      container.appendChild(renderResourceLink(data, data.tipo || 'document'));
    });
  } catch (e) {
    console.debug('[educacion.js] Documents load error:', e.message);
  }
}

/**
 * Load useful links content
 */
async function loadLinksContent() {
  const container = document.getElementById('enlacesUtiles');
  if (!container || !db) return;

  try {
    const q = query(
      collection(db, 'educacion'),
      where('tipo', '==', 'link'),
      where('activo', '==', true),
      orderBy('fecha', 'desc')
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      showPlaceholder(container, '🌐', 'Los enlaces se cargarán desde administración.');
      return;
    }

    container.innerHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      container.appendChild(renderResourceLink(data, 'link'));
    });
  } catch (e) {
    console.debug('[educacion.js] Links load error:', e.message);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadEducationContent);
} else {
  loadEducationContent();
}

// Also load when education tab is shown
window.addEventListener('tab-educacion-shown', loadEducationContent);

// Export for external use
export { loadEducationContent };
