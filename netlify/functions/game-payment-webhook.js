/**
 * PorkCasare Memory Game - Payment Webhook
 *
 * Webhook para procesar pagos confirmados de MercadoPago.
 * Aplica los productos comprados y distribuye comisiones según la regla 70/30.
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
 * Fetch payment details from MercadoPago API using native fetch
 */
async function fetchPayment(paymentId, token) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`MercadoPago API error: ${error.message || res.statusText}`);
  }

  return res.json();
}

// Configuración de distribución
const PLATFORM_SHARE = 0.70;
const NETWORK_SHARE = 0.30;
const MAX_LEVELS = 5;

// Buscar usuario por username
async function findUserByUsername(db, username) {
  if (!username) return null;
  const snap = await db.collection('usuarios').where('usuario', '==', username).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() };
}

// Distribuir comisiones a la red
async function distributeToNetwork(db, userId, amount, incomeType, productName) {
  const userRef = db.collection('usuarios').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { distributed: false, beneficiaries: [] };

  const userData = userSnap.data();
  const userName = userData.usuario || userData.nombre || 'Usuario';
  const sponsor = userData.patrocinador;

  if (!sponsor) {
    console.log(`ℹ️ Usuario ${userName} sin patrocinador - no hay distribución`);
    return { distributed: false, beneficiaries: [] };
  }

  const networkAmount = Math.round(amount * NETWORK_SHARE);
  const amountPerLevel = Math.round(networkAmount / MAX_LEVELS);
  const pointsPerLevel = amountPerLevel / 2800; // POINT_VALUE
  const beneficiaries = [];

  let currentSponsorCode = sponsor;

  for (let level = 0; level < MAX_LEVELS; level++) {
    if (!currentSponsorCode) break;

    const sponsorDoc = await findUserByUsername(db, currentSponsorCode);
    if (!sponsorDoc) break;

    const sponsorRef = db.collection('usuarios').doc(sponsorDoc.id);
    const now = Date.now();

    await sponsorRef.update({
      balance: admin.firestore.FieldValue.increment(amountPerLevel),
      groupPoints: admin.firestore.FieldValue.increment(pointsPerLevel),
      history: admin.firestore.FieldValue.arrayUnion({
        action: `Comisión juego Memory: ${productName} de ${userName}`,
        amount: amountPerLevel,
        points: pointsPerLevel,
        date: new Date().toISOString(),
        timestamp: now,
        type: 'game_purchase_commission',
        incomeType,
        fromUser: userName,
        level: level + 1
      })
    });

    beneficiaries.push({
      level: level + 1,
      userId: sponsorDoc.id,
      userName: sponsorDoc.data.usuario,
      amount: amountPerLevel
    });

    console.log(`✅ Nivel ${level + 1}: ${sponsorDoc.data.usuario} recibe ${amountPerLevel} COP`);
    currentSponsorCode = sponsorDoc.data.patrocinador;
  }

  return { distributed: true, beneficiaries };
}

// Aplicar producto al usuario
async function applyProduct(db, userId, metadata) {
  const { productType, amount, duration, productId } = metadata;
  const userRef = db.collection('usuarios').doc(userId);

  const updates = {};

  switch (productType) {
    case 'coins':
      // Agregar monedas al progreso del juego
      const userSnap = await userRef.get();
      const userData = userSnap.data();
      const currentProgress = userData.gameProgress || {};
      updates.gameProgress = {
        ...currentProgress,
        coins: (currentProgress.coins || 0) + amount
      };
      console.log(`🪙 Agregando ${amount} monedas al usuario`);
      break;

    case 'lives':
      const userSnap2 = await userRef.get();
      const userData2 = userSnap2.data();
      const currentProgress2 = userData2.gameProgress || {};
      updates.gameProgress = {
        ...currentProgress2,
        lives: (currentProgress2.lives || 5) + amount
      };
      console.log(`❤️ Agregando ${amount} vidas al usuario`);
      break;

    case 'season_pass':
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + duration);
      const userSnap3 = await userRef.get();
      const userData3 = userSnap3.data();
      const currentProgress3 = userData3.gameProgress || {};
      updates.gameProgress = {
        ...currentProgress3,
        seasonPass: true,
        seasonPassExpiry: expiryDate.toISOString()
      };
      console.log(`🎫 Activando pase de temporada hasta ${expiryDate.toISOString()}`);
      break;

    case 'membership':
      let membershipExpiry = null;
      if (duration === 'lifetime') {
        membershipExpiry = null; // null significa vitalicio
      } else {
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + duration);
        membershipExpiry = expiry.toISOString();
      }

      const userSnap4 = await userRef.get();
      const userData4 = userSnap4.data();
      const currentProgress4 = userData4.gameProgress || {};
      updates.gameProgress = {
        ...currentProgress4,
        membership: {
          type: duration === 'lifetime' ? 'lifetime' : 'monthly',
          purchaseDate: new Date().toISOString(),
          expiresAt: membershipExpiry
        }
      };
      console.log(`👑 Activando membresía ${duration === 'lifetime' ? 'vitalicia' : 'mensual'}`);
      break;

    default:
      console.warn(`⚠️ Tipo de producto desconocido: ${productType}`);
      return false;
  }

  await userRef.update(updates);
  return true;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 200, body: 'OK' };
    }

    const body = JSON.parse(event.body || '{}');

    // MercadoPago IPN
    if (body.type === 'payment' && body.data && body.data.id) {
      const paymentId = body.data.id;
      console.log(`📥 Webhook recibido - Payment ID: ${paymentId}`);

      // Obtener token de MercadoPago
      const token = process.env.MP_ACCESS_TOKEN;
      if (!token) {
        console.error('MP_ACCESS_TOKEN not configured');
        return { statusCode: 200, body: 'Error: MP token missing' };
      }

      // Obtener detalles del pago usando fetch nativo
      const payment = await fetchPayment(paymentId, token);

      console.log(`💳 Estado del pago: ${payment.status}`);

      if (payment.status !== 'approved') {
        console.log(`ℹ️ Pago no aprobado, ignorando`);
        return { statusCode: 200, body: 'OK' };
      }

      // Parsear external_reference: GAME|userId|productId|timestamp
      const externalRef = payment.external_reference || '';
      if (!externalRef.startsWith('GAME|')) {
        console.log(`ℹ️ No es un pago del juego, ignorando`);
        return { statusCode: 200, body: 'OK' };
      }

      const [, userId, productId, timestamp] = externalRef.split('|');
      const metadata = payment.metadata || {};

      console.log(`🎮 Procesando pago del juego:`);
      console.log(`   Usuario: ${userId}`);
      console.log(`   Producto: ${productId}`);
      console.log(`   Monto: ${payment.transaction_amount} COP`);

      // Initialize Firebase
      initAdmin();
      const db = admin.firestore();

      // Verificar si ya se procesó
      const existingSnap = await db.collection('game_payments')
        .where('paymentId', '==', String(paymentId))
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        console.log(`ℹ️ Pago ya procesado anteriormente`);
        return { statusCode: 200, body: 'OK' };
      }

      // Aplicar producto al usuario
      const applied = await applyProduct(db, userId, {
        ...metadata,
        productId
      });

      // Distribuir comisiones a la red (70/30)
      const distribution = await distributeToNetwork(
        db,
        userId,
        payment.transaction_amount,
        metadata.incomeType || 'game_purchase',
        metadata.productId || productId
      );

      // Registrar pago procesado
      await db.collection('game_payments').add({
        paymentId: String(paymentId),
        userId,
        productId,
        amount: payment.transaction_amount,
        status: 'completed',
        productApplied: applied,
        distribution,
        metadata,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Actualizar orden si existe
      const orderSnap = await db.collection('game_orders')
        .where('userId', '==', userId)
        .where('productId', '==', productId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (!orderSnap.empty) {
        await orderSnap.docs[0].ref.update({
          status: 'completed',
          paymentId: String(paymentId),
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      console.log(`✅ Pago procesado exitosamente`);
      return { statusCode: 200, body: 'OK' };
    }

    return { statusCode: 200, body: 'OK' };

  } catch (err) {
    console.error('🔥 Error en game-payment-webhook:', err);
    // Retornar 200 para evitar reintentos de MercadoPago
    return { statusCode: 200, body: 'Error logged' };
  }
};
