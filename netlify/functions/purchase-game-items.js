/**
 * PorkCasare Memory Game - Purchase Game Items
 *
 * Función para procesar compras dentro del juego usando MercadoPago.
 * Los ingresos de compras (no publicidad) SÍ se distribuyen según la regla 70/30.
 *
 * PRODUCTOS DISPONIBLES:
 * - Paquetes de monedas
 * - Paquetes de vidas
 * - Pases de temporada
 * - Membresías del juego
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin once
let appInitialized = false;

function initAdmin() {
  if (appInitialized) return;
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
  appInitialized = true;
}

/**
 * Create payment preference using MercadoPago API with native fetch
 */
async function createPreference(token, prefData) {
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `game-${prefData.external_reference}`
    },
    body: JSON.stringify(prefData)
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`MercadoPago API error: ${data.message || data.error || res.statusText}`);
  }

  return data;
}

// Productos disponibles en el juego
const GAME_PRODUCTS = {
  // Paquetes de monedas
  coins_small: {
    id: 'coins_small',
    name: '500 Monedas',
    description: 'Paquete básico de monedas',
    price: 5000, // COP
    type: 'coins',
    amount: 500,
    incomeType: 'coin_purchase'
  },
  coins_medium: {
    id: 'coins_medium',
    name: '1200 Monedas',
    description: 'Paquete medio de monedas (+20% bonus)',
    price: 10000,
    type: 'coins',
    amount: 1200,
    incomeType: 'coin_purchase'
  },
  coins_large: {
    id: 'coins_large',
    name: '3000 Monedas',
    description: 'Paquete grande de monedas (+50% bonus)',
    price: 20000,
    type: 'coins',
    amount: 3000,
    incomeType: 'coin_purchase'
  },

  // Paquetes de vidas
  lives_pack: {
    id: 'lives_pack',
    name: '10 Vidas',
    description: 'Paquete de 10 vidas extras',
    price: 8000,
    type: 'lives',
    amount: 10,
    incomeType: 'lives_purchase'
  },

  // Pase de temporada
  season_pass: {
    id: 'season_pass',
    name: 'Pase de Temporada',
    description: 'Acceso a niveles exclusivos y recompensas dobles por 30 días',
    price: 25000,
    type: 'season_pass',
    duration: 30, // días
    incomeType: 'season_pass'
  },

  // Membresía PRO del juego
  membership_monthly: {
    id: 'membership_monthly',
    name: 'Membresía PRO Mensual',
    description: 'Vidas infinitas, pistas gratis diarias, niveles exclusivos',
    price: 28000, // ~$10 USD
    type: 'membership',
    duration: 30,
    incomeType: 'membership_monthly'
  },
  membership_lifetime: {
    id: 'membership_lifetime',
    name: 'Membresía PRO Vitalicia',
    description: 'Acceso permanente a todas las funciones PRO',
    price: 560000, // ~$200 USD
    type: 'membership',
    duration: 'lifetime',
    incomeType: 'membership_lifetime'
  }
};

// Helper para auth
const getAuthHeader = (event) => {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!auth) return null;
  const parts = auth.split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method not allowed' };
    }

    // Initialize Firebase
    initAdmin();
    const db = admin.firestore();

    // Verificar autenticación
    const authToken = getAuthHeader(event);
    if (!authToken) {
      return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(authToken);
    } catch (authError) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
    }

    const userId = decoded.uid;
    const body = JSON.parse(event.body || '{}');
    const { productId, action } = body;

    // Acción: listar productos
    if (action === 'list') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          products: Object.values(GAME_PRODUCTS)
        })
      };
    }

    // Acción: crear preferencia de pago
    if (action === 'purchase') {
      if (!productId || !GAME_PRODUCTS[productId]) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Producto no encontrado' })
        };
      }

      // Obtener token de MercadoPago
      const mpToken = process.env.MP_ACCESS_TOKEN;
      if (!mpToken) {
        console.error('MP_ACCESS_TOKEN not configured');
        return { statusCode: 500, body: JSON.stringify({ error: 'Payment service not configured' }) };
      }

      const product = GAME_PRODUCTS[productId];

      // Obtener datos del usuario
      const userRef = db.collection('usuarios').doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Usuario no encontrado' }) };
      }

      const userData = userSnap.data();
      const siteUrl = process.env.SITE_URL || 'https://porkcasare.netlify.app';
      const timestamp = Date.now();

      // Crear preferencia de MercadoPago usando fetch nativo
      const prefData = {
        items: [{
          title: `[PorkCasare Memory] ${product.name}`,
          quantity: 1,
          unit_price: product.price,
          currency_id: 'COP'
        }],
        external_reference: `GAME|${userId}|${productId}|${timestamp}`,
        back_urls: {
          success: `${siteUrl}/juego-memory/?payment=success&product=${productId}`,
          failure: `${siteUrl}/juego-memory/?payment=failure`,
          pending: `${siteUrl}/juego-memory/?payment=pending`
        },
        auto_return: 'approved',
        notification_url: `${siteUrl}/.netlify/functions/game-payment-webhook`,
        statement_descriptor: 'PORKCASARE MEMORY',
        metadata: {
          userId,
          productId,
          productType: product.type,
          amount: product.amount || null,
          duration: product.duration || null,
          incomeType: product.incomeType,
          created_at: new Date().toISOString()
        },
        payer: {
          name: userData.nombre || '',
          surname: userData.apellido || '',
          email: userData.email || decoded.email || ''
        }
      };

      const response = await createPreference(mpToken, prefData);

      // Guardar orden pendiente
      await db.collection('game_orders').add({
        userId,
        productId,
        product: product.name,
        price: product.price,
        type: product.type,
        preferenceId: response.id,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          preferenceId: response.id,
          initPoint: response.init_point,
          product: {
            id: product.id,
            name: product.name,
            price: product.price
          }
        })
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Acción no soportada' })
    };

  } catch (err) {
    console.error('🔥 Error en purchase-game-items:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
