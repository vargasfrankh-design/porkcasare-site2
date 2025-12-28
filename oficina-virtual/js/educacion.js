/**
 * Educación Content Loader
 * Loads educational content from Firestore for the virtual office
 * Content is managed by administrators and displayed as links to distributors
 */

import { db } from '/src/firebase-config.js';
import { collection, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// Track if content has been loaded to avoid duplicate loads
let contentLoaded = false;

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
 */
async function loadPECContent() {
  const container = document.getElementById('pecDelMes');
  if (!container) {
    console.log('[educacion.js] PEC container not found');
    return;
  }
  if (!db) return;

  try {
    const q = query(
      collection(db, 'educacion'),
      where('tipo', '==', 'pec'),
      where('activo', '==', true),
      orderBy('fecha', 'desc')
    );

    const snapshot = await getDocs(q);
    console.log(`[educacion.js] PEC query returned ${snapshot.size} documents`);

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
    console.error('[educacion.js] PEC load error:', e);
    showPlaceholder(container, '⚠️', 'Error al cargar el PEC.');
  }
}

/**
 * Load video content
 */
async function loadVideosContent() {
  const container = document.getElementById('videosEducativos');
  if (!container) {
    console.log('[educacion.js] Videos container not found');
    return;
  }
  if (!db) return;

  try {
    const q = query(
      collection(db, 'educacion'),
      where('tipo', '==', 'video'),
      where('activo', '==', true),
      orderBy('fecha', 'desc')
    );

    const snapshot = await getDocs(q);
    console.log(`[educacion.js] Videos query returned ${snapshot.size} documents`);

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
    console.error('[educacion.js] Videos load error:', e);
    showPlaceholder(container, '⚠️', 'Error al cargar los videos.');
  }
}

/**
 * Load documents and books content
 * Uses separate queries to avoid requiring additional composite indexes for 'in' operator
 */
async function loadDocumentsContent() {
  const container = document.getElementById('librosDocumentos');
  if (!container) {
    console.log('[educacion.js] Documents container not found');
    return;
  }
  if (!db) return;

  try {
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

    // Combine results and sort by date
    const allDocs = [];
    docsSnapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));
    librosSnapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));

    // Sort by fecha descending
    allDocs.sort((a, b) => {
      const dateA = a.fecha?.toDate ? a.fecha.toDate() : new Date(0);
      const dateB = b.fecha?.toDate ? b.fecha.toDate() : new Date(0);
      return dateB - dateA;
    });

    console.log(`[educacion.js] Documents query returned ${allDocs.length} documents (${docsSnapshot.size} documentos + ${librosSnapshot.size} libros)`);

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
 */
async function loadLinksContent() {
  const container = document.getElementById('enlacesUtiles');
  if (!container) {
    console.log('[educacion.js] Links container not found');
    return;
  }
  if (!db) return;

  try {
    const q = query(
      collection(db, 'educacion'),
      where('tipo', '==', 'link'),
      where('activo', '==', true),
      orderBy('fecha', 'desc')
    );

    const snapshot = await getDocs(q);
    console.log(`[educacion.js] Links query returned ${snapshot.size} documents`);

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

// Also load when education tab is shown (force reload to ensure fresh content)
window.addEventListener('tab-educacion-shown', () => {
  console.log('[educacion.js] Education tab shown, loading content...');
  loadEducationContent(true); // Force reload when tab is shown
});

// Export for external use
export { loadEducationContent };
