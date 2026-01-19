// Firebase Admin - initialized once per cold start (same pattern as confirm-order.js)
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

exports.handler = async function(event, context) {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { settings, adminToken } = body;

    if (!settings) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Settings data required' })
      };
    }

    // Verify admin authentication
    let adminUser = null;

    if (adminToken) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(adminToken);

        // Check if user is admin in Firestore
        const userDoc = await db.collection('users').doc(decodedToken.uid).get();
        if (!userDoc.exists) {
          const usuarioDoc = await db.collection('usuarios').doc(decodedToken.uid).get();
          if (usuarioDoc.exists) {
            const userData = usuarioDoc.data();
            if (userData.role !== 'admin' && userData.rol !== 'admin') {
              return {
                statusCode: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Admin privileges required' })
              };
            }
            adminUser = userData;
          }
        } else {
          const userData = userDoc.data();
          if (userData.role !== 'admin' && userData.rol !== 'admin') {
            return {
              statusCode: 403,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ error: 'Admin privileges required' })
            };
          }
          adminUser = userData;
        }
      } catch (authError) {
        console.error('Auth verification error:', authError.message);
        // In production, require valid auth
        if (process.env.CONTEXT === 'production') {
          return {
            statusCode: 401,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid authentication token' })
          };
        }
      }
    }

    // Validate and sanitize settings
    const validatedSettings = validateSettings(settings);

    // Add metadata
    validatedSettings.metadata = {
      lastUpdated: new Date().toISOString(),
      updatedBy: adminUser?.email || adminUser?.name || 'admin'
    };

    // Save to Firestore 'config' collection with document 'brand-settings'
    try {
      await db.collection('config').doc('brand-settings').set(validatedSettings);
      console.log('Settings saved successfully to Firestore');
    } catch (firestoreError) {
      console.error('Firestore write error:', firestoreError.message, firestoreError.code);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Failed to save to database',
          details: firestoreError.code === 'permission-denied'
            ? 'Permission denied - check Firebase rules or service account permissions'
            : firestoreError.message
        })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Brand settings saved successfully',
        lastUpdated: validatedSettings.metadata.lastUpdated
      })
    };
  } catch (error) {
    console.error('Error saving brand settings:', error.message, error.stack);

    // Provide more specific error messages
    let errorMessage = 'Failed to save brand settings';
    if (error.message.includes('parse') || error.message.includes('JSON')) {
      errorMessage = 'Invalid settings format';
    } else if (error.message.includes('PERMISSION_DENIED')) {
      errorMessage = 'Permission denied - check Firebase rules';
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: errorMessage,
        details: process.env.CONTEXT !== 'production' ? error.message : undefined
      })
    };
  }
};

function validateSettings(settings) {
  const validated = {};

  // Validate branding
  if (settings.branding) {
    validated.branding = {
      platformName: sanitizeText(settings.branding.platformName, 100) || 'PorKCasare',
      tagline: sanitizeText(settings.branding.tagline, 200) || '',
      logoUrl: sanitizeUrl(settings.branding.logoUrl) || '/images/logo.webp'
    };
  }

  // Validate colors
  if (settings.colors) {
    validated.colors = {};
    const colorKeys = [
      'primary', 'secondary', 'accent', 'success', 'danger', 'warning',
      'textPrimary', 'textSecondary', 'background', 'cardBackground',
      'navBackground', 'gradientStart', 'gradientEnd'
    ];

    colorKeys.forEach(key => {
      if (settings.colors[key] && isValidColor(settings.colors[key])) {
        validated.colors[key] = settings.colors[key];
      }
    });
  }

  // Validate fonts
  if (settings.fonts) {
    validated.fonts = {
      headings: sanitizeText(settings.fonts.headings, 300) || "'Inter', sans-serif",
      body: sanitizeText(settings.fonts.body, 300) || "'Inter', sans-serif"
    };
  }

  // Validate texts sections
  const textSections = ['homeTexts', 'accessSelectionTexts', 'loginTexts', 'virtualOfficeTexts'];

  textSections.forEach(section => {
    if (settings[section]) {
      validated[section] = {};
      Object.keys(settings[section]).forEach(key => {
        validated[section][key] = sanitizeText(settings[section][key], 1000);
      });
    }
  });

  return validated;
}

function sanitizeText(text, maxLength = 500) {
  if (typeof text !== 'string') return '';
  // Remove potentially dangerous characters but allow common text
  return text
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .substring(0, maxLength)
    .trim();
}

function sanitizeUrl(url) {
  if (typeof url !== 'string') return null;
  // Only allow relative URLs or specific domains
  if (url.startsWith('/') || url.startsWith('./')) {
    return url;
  }
  // Allow common image hosting
  const allowedDomains = ['firebasestorage.googleapis.com', 'storage.googleapis.com'];
  try {
    const parsed = new URL(url);
    if (allowedDomains.some(domain => parsed.hostname.includes(domain))) {
      return url;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function isValidColor(color) {
  if (typeof color !== 'string') return false;
  // Allow hex colors and named colors
  const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  const rgbPattern = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/;
  const rgbaPattern = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/;

  return hexPattern.test(color) || rgbPattern.test(color) || rgbaPattern.test(color);
}
