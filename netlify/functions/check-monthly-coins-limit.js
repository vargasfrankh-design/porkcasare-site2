/**
 * PorkCasare - Verificación y Aplicación de Límite Mensual de Monedas
 *
 * Endpoint backend para:
 * 1. Consultar el estado del límite mensual de un usuario
 * 2. Validar y registrar monedas ganadas con enforcing del límite de 20,000/mes
 *
 * El premio visible en la UI crece de 1M a 25M, pero cada jugador
 * solo puede acumular un máximo de 20,000 monedas por mes.
 */

const admin = require('firebase-admin');

let appInitialized = false;

function initAdmin() {
  if (appInitialized) return;
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(saJson) });
  }
  appInitialized = true;
}

// Límite interno real por usuario por mes (no visible al usuario)
const INTERNAL_MONTHLY_LIMIT = 20000;

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Verificar token de Firebase del usuario
 */
async function verifyUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded;
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    initAdmin();

    // Verificar autenticación
    const user = await verifyUser(event.headers.authorization || event.headers.Authorization);
    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'No autorizado' })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { action } = body;
    const db = admin.firestore();
    const currentMonth = getCurrentMonth();

    // ===== ACCIÓN: Consultar estado del límite mensual =====
    if (action === 'status') {
      const userRef = db.collection('usuarios').doc(user.uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Usuario no encontrado' })
        };
      }

      const userData = userSnap.data();
      const tracker = userData.monthlyCoinsTracker;
      let earned = 0;

      if (tracker && tracker.month === currentMonth) {
        earned = tracker.totalCoinsEarned || 0;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          month: currentMonth,
          earned: earned,
          limit: INTERNAL_MONTHLY_LIMIT,
          remaining: Math.max(0, INTERNAL_MONTHLY_LIMIT - earned),
          blocked: earned >= INTERNAL_MONTHLY_LIMIT
        })
      };
    }

    // ===== ACCIÓN: Validar y registrar monedas ganadas =====
    if (action === 'earn') {
      const { coins, gameType, level } = body;

      if (!coins || typeof coins !== 'number' || coins <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Cantidad de monedas inválida' })
        };
      }

      const userRef = db.collection('usuarios').doc(user.uid);

      // Usar transacción para evitar condiciones de carrera
      const result = await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists) {
          throw new Error('Usuario no encontrado');
        }

        const userData = userSnap.data();
        const tracker = userData.monthlyCoinsTracker;
        let currentEarned = 0;

        if (tracker && tracker.month === currentMonth) {
          currentEarned = tracker.totalCoinsEarned || 0;
        }

        // Verificar si ya alcanzó el límite
        if (currentEarned >= INTERNAL_MONTHLY_LIMIT) {
          return {
            approved: false,
            coinsApproved: 0,
            reason: 'Límite mensual alcanzado',
            earned: currentEarned,
            limit: INTERNAL_MONTHLY_LIMIT
          };
        }

        // Calcular monedas aprobadas (no exceder el límite)
        const remaining = INTERNAL_MONTHLY_LIMIT - currentEarned;
        const coinsApproved = Math.min(coins, remaining);
        const newTotal = currentEarned + coinsApproved;

        // Actualizar el tracker mensual
        transaction.update(userRef, {
          'monthlyCoinsTracker.month': currentMonth,
          'monthlyCoinsTracker.totalCoinsEarned': newTotal,
          'monthlyCoinsTracker.limit': INTERNAL_MONTHLY_LIMIT,
          'monthlyCoinsTracker.lastUpdated': new Date().toISOString()
        });

        return {
          approved: true,
          coinsRequested: coins,
          coinsApproved: coinsApproved,
          totalEarned: newTotal,
          remaining: Math.max(0, INTERNAL_MONTHLY_LIMIT - newTotal),
          limit: INTERNAL_MONTHLY_LIMIT,
          blocked: newTotal >= INTERNAL_MONTHLY_LIMIT
        };
      });

      // Registrar en log de actividad si fue aprobado
      if (result.approved && result.coinsApproved > 0) {
        await db.collection('game_income_logs').add({
          userId: user.uid,
          action: 'coins_earned',
          gameType: gameType || 'unknown',
          level: level || 0,
          coinsRequested: coins,
          coinsApproved: result.coinsApproved,
          totalMonthly: result.totalEarned,
          month: currentMonth,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result)
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Acción no válida. Use "status" o "earn".' })
    };

  } catch (err) {
    console.error('Error en check-monthly-coins-limit:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Error interno del servidor' })
    };
  }
};
