
// netlify/functions/confirm-all-quick-start.js
//
// Confirma TODAS las órdenes pendientes de un usuario en una sola acción
// y ejecuta el Bono de Inicio Rápido si el total de puntos >= 50.
//
// Aplica tanto para Distribuidores como para Restaurantes.
// Ambos roles son elegibles para el Quick Start Bonus en su primera compra >= 50 pts.
//
// Operaciones atómicas:
// 1. Confirmar todas las órdenes pendientes del usuario
// 2. Acumular puntos personales del comprador
// 3. Calcular y distribuir Quick Start Bonus (21 pts nivel 1, 1 pt niveles 2-5 por paquete de 50)
// 4. Marcar usuario como máster
// 5. Registrar quickStartPaid, quickStartOrderId, quickStartPaidAt
//
// Validaciones backend (doble validación con frontend):
// - Usuario no es máster (isMaster !== true)
// - quickStartPaid no existe o es false
// - quickStartOrderId no existe
// - Total de puntos >= 50
// - Aplica para roles: distribuidor y restaurante

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

// Same config as confirm-order.js
const POINT_VALUE = 2800;
const MAX_LEVELS_QUICK_START = 4;
const QUICK_START_DIRECT_POINTS = 21;
const QUICK_START_UPPER_LEVELS_POINTS = 1;
const QUICK_START_THRESHOLD = 50;

const sponsorCache = new Map();

async function findUserByUsername(username) {
  if (!username) return null;
  if (sponsorCache.has(username)) return sponsorCache.get(username);
  const snap = await db.collection('usuarios').where('usuario', '==', username).limit(1).get();
  if (snap.empty) {
    sponsorCache.set(username, null);
    return null;
  }
  const doc = snap.docs[0];
  const result = { id: doc.id, data: doc.data() };
  sponsorCache.set(username, result);
  return result;
}

async function logActivityToFirestore(activityData) {
  try {
    const logEntry = {
      ...activityData,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString()
    };
    await db.collection('activity_logs').add(logEntry);
  } catch (e) {
    console.warn('Failed to log activity:', e.message);
  }
}

const getAuthHeader = (event) => {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!auth) return null;
  const parts = auth.split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
};

exports.handler = async (event) => {
  sponsorCache.clear();

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // 1. Auth check
    const token = getAuthHeader(event);
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token' }) };
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (authError) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token inválido', details: authError.message }) };
    }

    const adminUid = decoded.uid;
    const adminDoc = await db.collection('usuarios').doc(adminUid).get();
    if (!adminDoc.exists || adminDoc.data().rol !== 'admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    // 2. Parse request
    const body = JSON.parse(event.body || '{}');
    const { buyerUid } = body;

    if (!buyerUid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'buyerUid es requerido' }) };
    }

    console.log(`[confirm-all-quick-start] Processing for buyer: ${buyerUid}`);

    // 3. Fetch all pending orders for this buyer
    const pendingStatuses = ['pending', 'pending_delivery', 'pending_mp', 'pending_cash'];
    const ordersSnap = await db.collection('orders')
      .where('buyerUid', '==', buyerUid)
      .get();

    const pendingOrders = ordersSnap.docs
      .filter(d => pendingStatuses.includes(d.data().status))
      .map(d => ({ id: d.id, ref: db.collection('orders').doc(d.id), data: d.data() }));

    if (pendingOrders.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No hay órdenes pendientes para este usuario' }) };
    }

    // 4. Calculate total points
    const totalPoints = pendingOrders.reduce((sum, o) => {
      return sum + Number(o.data.totalPoints || o.data.points || o.data.puntos || 0);
    }, 0);

    console.log(`[confirm-all-quick-start] ${pendingOrders.length} orders, ${totalPoints} total points`);

    if (totalPoints < QUICK_START_THRESHOLD) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Puntos insuficientes',
          details: `Total de puntos: ${totalPoints}. Se requieren al menos ${QUICK_START_THRESHOLD} puntos.`
        })
      };
    }

    // 5. Fetch buyer data and validate eligibility
    const buyerRef = db.collection('usuarios').doc(buyerUid);
    const buyerDoc = await buyerRef.get();

    if (!buyerDoc.exists) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Usuario no encontrado' }) };
    }

    const buyerData = buyerDoc.data();

    // Backend validation: check master status
    const isMaster = buyerData.isMaster === true;
    if (isMaster) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Usuario ya calificado como máster', code: 'ALREADY_MASTER' })
      };
    }

    // Backend validation: check quickStartPaid
    if (buyerData.quickStartPaid === true) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Inicio Rápido ya pagado', code: 'ALREADY_PAID' })
      };
    }

    // Backend validation: check quickStartOrderId
    if (buyerData.quickStartOrderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Ya existe un registro de Inicio Rápido para este usuario', code: 'ALREADY_REGISTERED' })
      };
    }

    const directSponsorCode = buyerData.patrocinador || buyerData.sponsor || null;
    const buyerUsername = buyerData.usuario || buyerData.username || buyerData.nombre || 'Usuario';
    const buyerRole = (buyerData.tipoRegistro || buyerData.role || 'distribuidor').toLowerCase();

    // Look up sponsor before transaction
    let sponsorDocId = null;
    let sponsorDataPre = null;
    if (directSponsorCode) {
      const sponsor = await findUserByUsername(directSponsorCode);
      if (sponsor) {
        sponsorDocId = sponsor.id;
        sponsorDataPre = sponsor;
      }
    }

    // 6. Atomic transaction: confirm all orders + update buyer
    const primaryOrderId = pendingOrders[0].id;
    const allOrderIds = pendingOrders.map(o => o.id);

    let txResult;
    try {
      txResult = await db.runTransaction(async (tx) => {
        // --- ALL READS FIRST ---
        const orderSnaps = [];
        for (const order of pendingOrders) {
          const snap = await tx.get(order.ref);
          orderSnaps.push({ id: order.id, snap, ref: order.ref });
        }

        const buyerSnap = await tx.get(buyerRef);
        if (!buyerSnap.exists) throw new Error('Comprador no encontrado en transacción');

        let sponsorSnapData = null;
        if (sponsorDocId) {
          const sponsorRefInTx = db.collection('usuarios').doc(sponsorDocId);
          const sponsorSnap = await tx.get(sponsorRefInTx);
          if (sponsorSnap.exists) {
            sponsorSnapData = { id: sponsorDocId, data: sponsorSnap.data() };
          }
        }

        // --- VALIDATE within transaction ---
        const txBuyerData = buyerSnap.data();

        // Re-validate eligibility inside transaction (atomic safety)
        if (txBuyerData.isMaster === true) {
          throw new Error('ALREADY_MASTER: Usuario ya calificado como máster');
        }
        if (txBuyerData.quickStartPaid === true) {
          throw new Error('ALREADY_PAID: Inicio Rápido ya fue pagado');
        }
        if (txBuyerData.quickStartOrderId) {
          throw new Error('ALREADY_REGISTERED: Ya existe registro de Inicio Rápido');
        }

        // Verify all orders are still pending
        let txTotalPoints = 0;
        const confirmedOrders = [];
        for (const os of orderSnaps) {
          if (!os.snap.exists) throw new Error(`Orden ${os.id} desapareció`);
          const orderData = os.snap.data();
          if (orderData.status === 'confirmed') {
            throw new Error(`Orden ${os.id} ya fue confirmada`);
          }
          if (!pendingStatuses.includes(orderData.status)) {
            throw new Error(`Orden ${os.id} tiene estado inesperado: ${orderData.status}`);
          }
          const orderPoints = Number(orderData.totalPoints || orderData.points || orderData.puntos || 0);
          txTotalPoints += orderPoints;
          confirmedOrders.push({ id: os.id, ref: os.ref, data: orderData, points: orderPoints });
        }

        if (txTotalPoints < QUICK_START_THRESHOLD) {
          throw new Error(`Puntos insuficientes en transacción: ${txTotalPoints} < ${QUICK_START_THRESHOLD}`);
        }

        // --- WRITES ---

        // Confirm all orders
        for (const co of confirmedOrders) {
          tx.update(co.ref, {
            status: 'confirmed',
            admin: adminUid,
            confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
            quickStartBulkConfirm: true
          });
        }

        // Build history entries for buyer (one per order)
        const historyEntries = confirmedOrders.map(co => {
          const productName = co.data.productName || co.data.product || co.data.nombre || co.data.productoNombre || 'Producto';
          const qty = Number(co.data.quantity || co.data.cantidad || 1);
          const orderAmount = co.data.totalPrice || co.data.price || co.data.amount || co.data.total || co.data.precio || null;
          return {
            type: 'purchase',
            action: `Compra confirmada (Inicio Rápido): ${productName}${qty > 1 ? ` (x${qty})` : ''}`,
            amount: orderAmount,
            points: co.points,
            quantity: qty,
            orderId: co.id,
            date: new Date().toISOString(),
            by: 'admin',
            quickStartBulk: true
          };
        });

        // Update buyer: add points, mark as master, register Quick Start
        const buyerUpdates = {
          personalPoints: admin.firestore.FieldValue.increment(txTotalPoints),
          puntos: admin.firestore.FieldValue.increment(txTotalPoints),
          isMaster: true,
          quickStartPaid: true,
          quickStartOrderId: primaryOrderId,
          quickStartOrderIds: allOrderIds,
          quickStartPaidAt: admin.firestore.FieldValue.serverTimestamp(),
          quickStartTotalPoints: txTotalPoints
        };

        tx.update(buyerRef, buyerUpdates);

        // Add history entries one by one (arrayUnion)
        for (const entry of historyEntries) {
          tx.update(buyerRef, {
            history: admin.firestore.FieldValue.arrayUnion(entry)
          });
        }

        // Set initialPackBought if needed
        const currentPersonalPoints = Number(txBuyerData.personalPoints || txBuyerData.puntos || 0);
        if ((currentPersonalPoints + txTotalPoints) >= 50 && !txBuyerData.initialPackBought) {
          tx.update(buyerRef, { initialPackBought: true });
        }

        // Mark all orders as having group points distributed
        for (const co of confirmedOrders) {
          tx.update(co.ref, {
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        return {
          totalPoints: txTotalPoints,
          ordersConfirmed: confirmedOrders.length,
          sponsorData: sponsorSnapData,
          buyerUsername,
          directSponsorCode
        };
      });
    } catch (txError) {
      console.error('[confirm-all-quick-start] Transaction failed:', txError.message);

      // Return user-friendly errors for known conditions
      if (txError.message.startsWith('ALREADY_MASTER')) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Usuario ya calificado como máster', code: 'ALREADY_MASTER' }) };
      }
      if (txError.message.startsWith('ALREADY_PAID')) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Inicio Rápido ya pagado', code: 'ALREADY_PAID' }) };
      }
      if (txError.message.startsWith('ALREADY_REGISTERED')) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ya existe registro de Inicio Rápido', code: 'ALREADY_REGISTERED' }) };
      }

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Error en transacción', details: txError.message })
      };
    }

    // 7. Post-transaction: Distribute Quick Start Bonus
    const { totalPoints: confirmedTotalPoints, ordersConfirmed, sponsorData, directSponsorCode: sponsorCode } = txResult;
    const numberOfPackages = Math.floor(confirmedTotalPoints / QUICK_START_THRESHOLD);
    const quickStartBeneficiaries = [];

    console.log(`[confirm-all-quick-start] Transaction OK: ${ordersConfirmed} orders, ${confirmedTotalPoints} pts, ${numberOfPackages} packages`);

    if (numberOfPackages > 0 && sponsorData && sponsorData.data) {
      try {
        // Pay direct sponsor: 21 points per package
        const bonusPoints = numberOfPackages * QUICK_START_DIRECT_POINTS;
        const bonusAmount = bonusPoints * POINT_VALUE;

        const sponsorRef = db.collection('usuarios').doc(sponsorData.id);
        const now = Date.now();

        await sponsorRef.update({
          balance: admin.firestore.FieldValue.increment(bonusAmount),
          groupPoints: admin.firestore.FieldValue.increment(bonusPoints),
          history: admin.firestore.FieldValue.arrayUnion({
            action: `Bono Inicio Rápido (21 pts/paquete) por compra grupal de ${confirmedTotalPoints} puntos de ${buyerUsername}`,
            amount: bonusAmount,
            points: bonusPoints,
            orderId: primaryOrderId,
            orderIds: allOrderIds,
            date: new Date().toISOString(),
            timestamp: now,
            originMs: now,
            type: 'quick_start_bonus',
            fromUser: buyerUsername,
            quickStartBulk: true
          })
        });

        quickStartBeneficiaries.push({
          level: 1,
          userId: sponsorData.id,
          userName: sponsorData.data.usuario || sponsorData.data.nombre || 'N/A',
          points: bonusPoints,
          amount: bonusAmount,
          commissionType: 'quick_start_bonus'
        });

        console.log(`[confirm-all-quick-start] Sponsor ${sponsorCode} paid: ${bonusPoints} pts = ${bonusAmount} COP`);

        // Distribute 1 point per package to 4 upper levels
        let currentSponsorCode = sponsorData.data.patrocinador || null;

        for (let level = 0; level < MAX_LEVELS_QUICK_START; level++) {
          if (!currentSponsorCode) break;

          const upperSponsor = await findUserByUsername(currentSponsorCode);
          if (!upperSponsor) break;

          const upperSponsorRef = db.collection('usuarios').doc(upperSponsor.id);
          const upperLevelPoints = numberOfPackages * QUICK_START_UPPER_LEVELS_POINTS;
          const upperLevelAmount = upperLevelPoints * POINT_VALUE;
          const nowUpper = Date.now();

          await upperSponsorRef.update({
            groupPoints: admin.firestore.FieldValue.increment(upperLevelPoints),
            balance: admin.firestore.FieldValue.increment(upperLevelAmount),
            history: admin.firestore.FieldValue.arrayUnion({
              action: `Comisión Inicio Rápido (+${upperLevelPoints} pts) por compra grupal de ${buyerUsername} - Nivel ${level + 2}`,
              amount: upperLevelAmount,
              points: upperLevelPoints,
              orderId: primaryOrderId,
              date: new Date().toISOString(),
              timestamp: nowUpper,
              originMs: nowUpper,
              type: 'quick_start_upper_level',
              fromUser: buyerUsername,
              quickStartBulk: true
            })
          });

          quickStartBeneficiaries.push({
            level: level + 2,
            userId: upperSponsor.id,
            userName: upperSponsor.data.usuario || upperSponsor.data.nombre || 'N/A',
            points: upperLevelPoints,
            amount: upperLevelAmount,
            commissionType: 'quick_start_upper_level'
          });

          currentSponsorCode = upperSponsor.data.patrocinador || null;
        }

        console.log(`[confirm-all-quick-start] Quick Start distribution complete: ${quickStartBeneficiaries.length} beneficiaries`);

      } catch (bonusError) {
        console.error('[confirm-all-quick-start] Error distributing Quick Start Bonus:', bonusError.message);
        // Orders are already confirmed - log error but don't fail
      }
    } else {
      if (numberOfPackages === 0) {
        console.warn('[confirm-all-quick-start] No packages to distribute (should not happen if totalPoints >= 50)');
      }
      if (!sponsorData || !sponsorData.data) {
        console.warn('[confirm-all-quick-start] No sponsor data found - Quick Start Bonus not distributed');
      }
    }

    // 8. Log activity
    await logActivityToFirestore({
      type: 'quick_start_bulk_confirm',
      title: `Inicio Rápido: ${buyerUsername}`,
      description: `Confirmación masiva de ${ordersConfirmed} órdenes con Bono de Inicio Rápido`,
      user: {
        id: buyerUid,
        name: buyerUsername,
        type: buyerRole
      },
      orderIds: allOrderIds,
      primaryOrderId,
      financial: {
        totalPoints: confirmedTotalPoints,
        packages: numberOfPackages,
        pointValue: POINT_VALUE
      },
      beneficiaries: quickStartBeneficiaries,
      beneficiariesCount: quickStartBeneficiaries.length,
      metadata: {
        ordersConfirmed,
        totalPoints: confirmedTotalPoints,
        packages: numberOfPackages,
        userMarkedAsMaster: true,
        quickStartPaid: true
      },
      processedBy: adminUid
    });

    // 9. Create confirmation audit docs
    try {
      for (const orderId of allOrderIds) {
        await db.collection('confirmations').add({
          orderId,
          userId: buyerUid,
          points: totalPoints,
          confirmedBy: adminUid,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          meta: {
            quickStartBulkConfirm: true,
            totalOrdersInBatch: ordersConfirmed
          }
        });
      }
    } catch (e) {
      console.warn('[confirm-all-quick-start] Warning: could not create confirmation docs', e.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Todas las órdenes confirmadas y Bono de Inicio Rápido procesado',
        ordersConfirmed,
        totalPoints: confirmedTotalPoints,
        packages: numberOfPackages,
        beneficiaries: quickStartBeneficiaries.length,
        userMarkedAsMaster: true
      })
    };

  } catch (err) {
    console.error('[confirm-all-quick-start] Fatal error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
