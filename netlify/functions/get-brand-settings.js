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
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Read from Firestore 'config' collection
    try {
      const doc = await db.collection('config').doc('brand-settings').get();

      if (doc.exists) {
        console.log('Brand settings retrieved from Firestore');
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60'
          },
          body: JSON.stringify(doc.data())
        };
      }
      console.log('Brand settings document does not exist, returning defaults');
    } catch (firestoreError) {
      console.error('Firestore read error:', firestoreError.message, firestoreError.code);
      // Fall through to return defaults
    }

    // Return default settings if no custom settings exist
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      },
      body: JSON.stringify(getDefaultSettings())
    };
  } catch (error) {
    console.error('Error getting brand settings:', error);

    // Return default settings on error
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(getDefaultSettings())
    };
  }
};

function getDefaultSettings() {
  return {
    // Identidad de la empresa
    branding: {
      platformName: 'PorKCasare',
      tagline: 'Carne empacada al vacío',
      logoUrl: '/images/logo.webp'
    },

    // Colores principales
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

    // Tipografías
    fonts: {
      headings: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    },

    // Textos del Home
    homeTexts: {
      heroTitle: 'Carne empacada al vacío — PorKCasare',
      heroSubtitle: 'Seleccionamos, empacamos y distribuimos cortes de cerdo con trazabilidad y la mejor calidad.',
      heroDescription: '¿Cómo funciona el plan de referidos?',
      ctaButtonText: 'Regístrate',
      missionTitle: 'Misión',
      missionText: 'En PorkCasare trabajamos día a día en la crianza y ceba de porcinos con los más altos estándares de nutrición, bioseguridad y bienestar animal, utilizando procesos responsables que impulsan el crecimiento económico local y fortalecen el sector agropecuario.',
      visionTitle: 'Visión',
      visionText: 'Convertirnos en una granja porcícola líder en la región, reconocida por la innovación, calidad genética y sostenibilidad ambiental, aportando al desarrollo del campo colombiano y garantizando un producto de confianza para nuestros clientes.',
      productsTitle: 'Nuestros Productos',
      productsDescription: 'Productos frescos de alta calidad, empacados al vacío. ¡Compra sin necesidad de registrarte!',
      galleryTitle: 'Galería',
      footerText: '© PorKCasare by F&F Asociados'
    },

    // Textos de la pantalla de selección de acceso (login.html)
    accessSelectionTexts: {
      title: 'Bienvenido a PorkCasare',
      clientRegisterButton: 'Registro de Cliente',
      distributorRegisterButton: 'Registro nuevo Distribuidor',
      distributorAccessButton: 'Acceso del Distribuidor',
      downloadAppButton: 'Descargar App'
    },

    // Textos de las pantallas de login
    loginTexts: {
      proveedorTitle: 'Portal de Proveedores',
      proveedorSubtitle: 'Ingresa tus credenciales para acceder',
      distribuidorTitle: 'Acceso Distribuidor',
      usernamePlaceholder: 'Usuario o Email',
      passwordPlaceholder: 'Contraseña',
      loginButton: 'Iniciar Sesión',
      forgotPassword: 'Recuperar contraseña',
      backToHome: 'Volver al inicio'
    },

    // Textos de la oficina virtual
    virtualOfficeTexts: {
      navTitle: 'PorkCasare',
      logoutButton: 'Cerrar sesión',
      shippingTicker: 'Envíos a nivel nacional | No aplica contra entrega | No aplica para productos en frío | Aplica términos y condiciones',
      activationAlert: 'Debes realizar una compra mínima de 50 puntos para activar tu código y comenzar a recibir bonos y pagos.',
      progressTitle: '¡Tu camino a Corona!',
      progressSubtitle: 'Continúa acumulando puntos para alcanzar mayores beneficios',
      loadingTitle: 'Cargando Oficina Virtual…',
      loadingSubtitle: 'Estamos preparando tu espacio. Esto no debería tardar mucho.'
    },

    // Metadatos
    metadata: {
      lastUpdated: null,
      updatedBy: null
    }
  };
}
