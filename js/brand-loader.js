/**
 * Brand Loader Script
 *
 * This script dynamically loads and applies brand settings (colors, texts, logo)
 * from the Netlify Blobs storage. It should be included in all pages that need
 * dynamic branding.
 *
 * Usage: Include this script in any HTML page:
 * <script src="/js/brand-loader.js"></script>
 */

(function() {
  'use strict';

  // Cache key and expiration
  const CACHE_KEY = 'brand-settings-cache';
  const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

  // Default settings (fallback)
  const defaultSettings = {
    branding: {
      platformName: 'PorKCasare',
      tagline: 'Carne empacada al vacío',
      logoUrl: '/images/logo.webp'
    },
    colors: {
      primary: '#667eea',
      secondary: '#764ba2',
      accent: '#0052cc',
      success: '#00875a',
      danger: '#de350b',
      warning: '#ff8b00',
      textPrimary: '#172b4d',
      textSecondary: '#5e6c84',
      background: '#f4f5f7',
      cardBackground: '#ffffff',
      navBackground: '#667eea',
      gradientStart: '#667eea',
      gradientEnd: '#764ba2'
    },
    fonts: {
      headings: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    }
  };

  // Check if we have a valid cached version
  function getCachedSettings() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const { settings, timestamp } = JSON.parse(cached);
      const now = Date.now();

      // Check if cache is still valid
      if (now - timestamp < CACHE_EXPIRY_MS) {
        return settings;
      }

      // Cache expired
      return null;
    } catch (e) {
      console.warn('Error reading brand settings cache:', e);
      return null;
    }
  }

  // Save settings to cache
  function cacheSettings(settings) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        settings: settings,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn('Error caching brand settings:', e);
    }
  }

  // Apply CSS variables from colors
  function applyColors(colors) {
    if (!colors) return;

    const root = document.documentElement;

    // Map of setting keys to CSS variable names
    const colorMap = {
      primary: '--brand-primary',
      secondary: '--brand-secondary',
      accent: '--brand-accent',
      success: '--brand-success',
      danger: '--brand-danger',
      warning: '--brand-warning',
      textPrimary: '--brand-text-primary',
      textSecondary: '--brand-text-secondary',
      background: '--brand-background',
      cardBackground: '--brand-card-background',
      navBackground: '--brand-nav-background',
      gradientStart: '--brand-gradient-start',
      gradientEnd: '--brand-gradient-end'
    };

    Object.entries(colors).forEach(([key, value]) => {
      if (colorMap[key] && value) {
        root.style.setProperty(colorMap[key], value);
      }
    });

    // Create gradient variable
    if (colors.gradientStart && colors.gradientEnd) {
      root.style.setProperty(
        '--brand-gradient',
        `linear-gradient(135deg, ${colors.gradientStart} 0%, ${colors.gradientEnd} 100%)`
      );
    }
  }

  // Apply fonts
  function applyFonts(fonts) {
    if (!fonts) return;

    const root = document.documentElement;

    if (fonts.headings) {
      root.style.setProperty('--brand-font-headings', fonts.headings);
    }
    if (fonts.body) {
      root.style.setProperty('--brand-font-body', fonts.body);
    }
  }

  // Apply texts to elements with data-brand-text attribute
  function applyTexts(settings) {
    // Apply branding texts
    if (settings.branding) {
      // Platform name
      document.querySelectorAll('[data-brand-text="platformName"]').forEach(el => {
        el.textContent = settings.branding.platformName || defaultSettings.branding.platformName;
      });

      // Tagline
      document.querySelectorAll('[data-brand-text="tagline"]').forEach(el => {
        el.textContent = settings.branding.tagline || '';
      });
    }

    // Apply logo
    if (settings.branding?.logoUrl) {
      document.querySelectorAll('[data-brand-logo]').forEach(img => {
        img.src = settings.branding.logoUrl;
      });
    }

    // Apply section-specific texts
    const textSections = ['homeTexts', 'accessSelectionTexts', 'loginTexts', 'virtualOfficeTexts'];

    textSections.forEach(section => {
      if (settings[section]) {
        Object.entries(settings[section]).forEach(([key, value]) => {
          if (value) {
            document.querySelectorAll(`[data-brand-text="${section}.${key}"]`).forEach(el => {
              el.textContent = value;
            });
          }
        });
      }
    });
  }

  // Apply page title
  function applyPageTitle(settings) {
    if (settings.branding?.platformName) {
      // Update title with platform name while keeping page-specific suffix
      const currentTitle = document.title;
      const separator = ' - ';
      const parts = currentTitle.split(separator);

      if (parts.length > 1) {
        // Keep the page-specific part, update the brand name
        document.title = `${parts[0]}${separator}${settings.branding.platformName}`;
      } else {
        // If no separator, check if it's just the brand name
        document.title = settings.branding.platformName;
      }
    }
  }

  // Main function to apply all brand settings
  function applyBrandSettings(settings) {
    if (!settings) return;

    applyColors(settings.colors);
    applyFonts(settings.fonts);
    applyTexts(settings);
    applyPageTitle(settings);

    // Dispatch custom event for components that need to react to brand loading
    window.dispatchEvent(new CustomEvent('brandSettingsLoaded', { detail: settings }));
  }

  // Fetch and apply brand settings
  async function loadBrandSettings() {
    // First, try to apply cached settings immediately to prevent flash
    const cachedSettings = getCachedSettings();
    if (cachedSettings) {
      applyBrandSettings(cachedSettings);
    }

    // Then fetch fresh settings in the background
    try {
      const response = await fetch('/.netlify/functions/get-brand-settings');

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const settings = await response.json();

      // Cache the fresh settings
      cacheSettings(settings);

      // Apply settings (will update if different from cached)
      applyBrandSettings(settings);

      // Store settings globally for other scripts to access
      window.brandSettings = settings;

    } catch (error) {
      console.warn('Error loading brand settings, using defaults:', error);

      // If no cached settings and fetch failed, apply defaults
      if (!cachedSettings) {
        applyBrandSettings(defaultSettings);
      }

      window.brandSettings = cachedSettings || defaultSettings;
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadBrandSettings);
  } else {
    loadBrandSettings();
  }

  // Expose reload function for admin panel
  window.reloadBrandSettings = loadBrandSettings;

  // Expose clear cache function
  window.clearBrandSettingsCache = function() {
    localStorage.removeItem(CACHE_KEY);
    loadBrandSettings();
  };

})();
