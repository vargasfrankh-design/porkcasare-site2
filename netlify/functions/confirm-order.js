
// netlify/functions/confirm-order.js
// Reglas implementadas:
// - POINT_VALUE = 2800 pesos
// - Productos: $60,000 = 10 puntos | Paquete grande: $300,000 = 50 puntos
// 
// SISTEMA DE 25 PUNTOS PARA PRIMERA COMPRA GRANDE:
//   * Se activa SOLO en la PRIMERA compra del usuario
//   * Y SOLO si esa primera compra es >= 50 puntos
//   * Distribución de 25 puntos por cada paquete de 50 puntos:
//     - 21 puntos al patrocinador directo (bono inicio rápido + punto grupal)
//     - 4 puntos a los 4 niveles arriba del patrocinador (1 punto por nivel)
//   * Ejemplo: Primera compra de 50 puntos = $70,000 total distribuidos
//     - Patrocinador directo: 21 × $2,800 = $58,800
//     - 4 niveles superiores: 1 × $2,800 = $2,800 cada uno ($11,200 total)
//   * Ejemplo: Primera compra de 100 puntos = $140,000 total distribuidos
//     - Patrocinador directo: 42 × $2,800 = $117,600
//     - 4 niveles superiores: 2 × $2,800 = $5,600 cada uno ($22,400 total)
// 
// COMISIÓN NORMAL (COMPRAS SUBSECUENTES O MENORES A 50 PUNTOS):
//   * Se distribuye 1 punto por cada 10 puntos de compra
//   * Se reparte a 5 niveles hacia arriba del comprador (incluye patrocinador directo)
//   * Ejemplo: compra de 50 puntos = 5 niveles reciben 1 punto cada uno ($2,800 c/u = $14,000 total)
//   * Restaurantes: 0.5 puntos por cada 10 puntos (50% de comisión)
// 
// - Función para Netlify / Firestore (firebase-admin).

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

// CONFIG
const POINT_VALUE = 2800;
const REBUY_POINT_PER_LEVEL = 1; // 1 punto por cada unidad (bloque de 10)
const MAX_LEVELS_NORMAL = 5; // Para compras normales/subsecuentes
const MAX_LEVELS_QUICK_START = 4; // Para niveles superiores en bono de inicio rápido
const QUICK_START_DIRECT_POINTS = 21; // Puntos que recibe el patrocinador directo por cada paquete de 50
const QUICK_START_UPPER_LEVELS_POINTS = 1; // Puntos por nivel superior (4 niveles)
const QUICK_START_THRESHOLD = 50; // La compra debe ser de al menos 50 puntos para activar el bono

// HELPERS
async function findUserByUsername(username) {
  if (!username) return null;
  const snap = await db.collection('usuarios').where('usuario', '==', username).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() };
}

const getAuthHeader = (event) => {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!auth) return null;
  const parts = auth.split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
};

// FUNCTION
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const token = getAuthHeader(event);
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };

    const decoded = await admin.auth().verifyIdToken(token);
    const adminUid = decoded.uid;

    const adminDoc = await db.collection('usuarios').doc(adminUid).get();
    if (!adminDoc.exists || adminDoc.data().rol !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { orderId, action } = body;
    if (!orderId || !action) return { statusCode: 400, body: JSON.stringify({ error: 'orderId y action requeridos' }) };

    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return { statusCode: 404, body: JSON.stringify({ error: 'Orden no encontrada' }) };
    const order = orderSnap.data();

    if (action === 'reject') {
      await orderRef.update({
        status: 'rejected',
        admin: adminUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { statusCode: 200, body: JSON.stringify({ message: 'Orden rechazada' }) };
    }

    if (action === 'confirm') {
      const buyerUid = order.buyerUid;
      if (!buyerUid) return { statusCode: 400, body: JSON.stringify({ error: 'Orden sin buyerUid' }) };

      const points = Number(order.totalPoints || order.points || 0);
      const quantity = Number(order.quantity || 1);
      console.log(`📊 Orden ${orderId}: points = ${points}, quantity = ${quantity}`);

      // 1) Run transaction: mark order confirmed and update buyer points
      const txResult = await db.runTransaction(async (tx) => {
        const ordSnap = await tx.get(orderRef);
        if (!ordSnap.exists) throw new Error('Orden desapareció durante la transacción');
        
        const currentOrder = ordSnap.data();
        if (currentOrder.status === 'confirmed') {
          throw new Error('Orden ya confirmada anteriormente');
        }

        const buyerRef = db.collection('usuarios').doc(buyerUid);
        const buyerSnap = await tx.get(buyerRef);
        if (!buyerSnap.exists) throw new Error('Comprador no encontrado en la transacción');
        
        const buyerData = buyerSnap.data();

        const prevPersonalPoints = Number(buyerData.personalPoints || buyerData.puntos || 0);
        const newPersonalPoints = prevPersonalPoints + points;
        const directSponsorCode = buyerData.patrocinador || order.sponsor || null;
        
        // Quick Start Bonus se paga SOLO si:
        // 1. Es la PRIMERA compra del usuario (prevPersonalPoints === 0)
        // 2. Y esa compra es >= 50 puntos
        const isFirstPurchase = prevPersonalPoints === 0;
        const shouldPayQuickStartBonus = isFirstPurchase && points >= QUICK_START_THRESHOLD;

        tx.update(orderRef, {
          status: 'confirmed',
          admin: adminUid,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const buyerUpdates = {
          personalPoints: admin.firestore.FieldValue.increment(points),
          puntos: admin.firestore.FieldValue.increment(points),
          history: admin.firestore.FieldValue.arrayUnion({
            action: `Compra confirmada: ${order.productName || order.product || ''}${quantity > 1 ? ` (x${quantity})` : ''}`,
            amount: order.totalPrice || order.price || order.amount || null,
            points: points,
            quantity: quantity,
            orderId,
            date: new Date().toISOString(),
            by: 'admin'
          })
        };

        tx.update(buyerRef, buyerUpdates);

        // compatibility flag
        if (newPersonalPoints >= 50 && !buyerData.initialPackBought) {
          tx.update(buyerRef, { initialPackBought: true });
        }

        // If we should pay the quick start bonus, get the sponsor ref in the transaction
        let sponsorRef = null;
        let sponsorData = null;
        if (shouldPayQuickStartBonus && directSponsorCode) {
          const sponsorSnap = await db.collection('usuarios').where('usuario', '==', directSponsorCode).limit(1).get();
          if (!sponsorSnap.empty) {
            const sponsorDoc = sponsorSnap.docs[0];
            sponsorRef = db.collection('usuarios').doc(sponsorDoc.id);
            const sponsorDocSnap = await tx.get(sponsorRef);
            if (sponsorDocSnap.exists()) {
              sponsorData = { id: sponsorDoc.id, data: sponsorDocSnap.data() };
            }
          }
        }

        return { 
          prevPersonalPoints, 
          newPersonalPoints, 
          directSponsorCode,
          shouldPayQuickStartBonus,
          isFirstPurchase,
          buyerUsername: buyerData.usuario || '',
          sponsorRef,
          sponsorData
        };
      });

      const { 
        prevPersonalPoints, 
        newPersonalPoints, 
        directSponsorCode,
        shouldPayQuickStartBonus,
        isFirstPurchase,
        buyerUsername,
        sponsorRef,
        sponsorData
      } = txResult || { 
        prevPersonalPoints: 0, 
        newPersonalPoints: 0, 
        directSponsorCode: null,
        shouldPayQuickStartBonus: false,
        isFirstPurchase: false,
        buyerUsername: '',
        sponsorRef: null,
        sponsorData: null
      };
      console.log(`📊 Transacción completada: prevPersonalPoints = ${prevPersonalPoints}, newPersonalPoints = ${newPersonalPoints}, points de esta compra = ${points}`);

      // 2) Create confirmation audit doc (best effort)
      try {
        await db.collection('confirmations').add({
          orderId,
          userId: buyerUid,
          points,
          amount: order.price || order.amount || null,
          confirmedBy: adminUid,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          meta: {
            productName: order.productName || order.product || null,
            itemsCount: Array.isArray(order.items) ? order.items.length : null
          }
        });
      } catch (e) {
        console.warn('Warning: no se pudo crear confirmation doc', e);
      }

      // 3) Quick Start Bonus Logic
      // El bono de inicio rápido se paga SOLO cuando:
      // 1. Es la PRIMERA compra del usuario (prevPersonalPoints === 0)
      // 2. Y esa primera compra es >= 50 puntos
      // 3. NO es acumulativo - si el usuario compra 10 + 30 + 15, NO hay bono
      // 
      // Sistema de 25 puntos por cada paquete de 50:
      // - Patrocinador directo recibe 21 puntos (bono inicio rápido + punto grupal)
      // - 4 niveles superiores reciben 1 punto cada uno
      // Total: 25 puntos × $2,800 = $70,000 por cada paquete de 50 puntos
      
      console.log(`📊 Quick Start Bonus Check:`);
      console.log(`   - Es primera compra: ${isFirstPurchase}`);
      console.log(`   - Puntos previos: ${prevPersonalPoints}`);
      console.log(`   - Puntos de esta compra: ${points}`);
      console.log(`   - Umbral requerido: ${QUICK_START_THRESHOLD}`);
      console.log(`   - shouldPayQuickStartBonus: ${shouldPayQuickStartBonus}`);

      if (shouldPayQuickStartBonus && sponsorData) {
        console.log(`💰 Pagando Quick Start Bonus (sistema de 25 puntos) a patrocinador directo: ${directSponsorCode}`);
        try {
          console.log(`✓ Patrocinador directo: ${sponsorData.data.usuario} (ID: ${sponsorData.id})`);
          
          // Calcular paquetes de 50 puntos
          const numberOfPackages = Math.floor(points / 50);
          
          // Patrocinador directo recibe 21 puntos por cada paquete de 50
          const bonusPoints = numberOfPackages * QUICK_START_DIRECT_POINTS;
          const bonusAmount = bonusPoints * POINT_VALUE;
          
          console.log(`💰 Bono calculado: ${bonusPoints} puntos = ${bonusAmount} COP (${numberOfPackages} paquetes × 21 puntos)`);
          
          await sponsorRef.update({
            balance: admin.firestore.FieldValue.increment(bonusAmount),
            groupPoints: admin.firestore.FieldValue.increment(bonusPoints),
            history: admin.firestore.FieldValue.arrayUnion({
              action: `Bono Inicio Rápido (21 pts/paquete) por compra de ${points} puntos de ${buyerUsername}`,
              amount: bonusAmount,
              points: bonusPoints,
              orderId,
              date: new Date().toISOString(),
              type: 'quick_start_bonus',
              fromUser: buyerUsername
            })
          });

          console.log(`✅ Bono Inicio Rápido pagado: ${directSponsorCode} recibió ${bonusAmount} COP (${bonusPoints} puntos) por primera compra de ${buyerUsername} (${points} puntos)`);
          
          // Ahora distribuir 1 punto a cada uno de los 4 niveles superiores al patrocinador
          console.log(`🔼 Distribuyendo a 4 niveles superiores del patrocinador: 1 punto por nivel por cada paquete`);
          
          let currentSponsorCode = sponsorData.data.patrocinador || null;
          
          for (let level = 0; level < MAX_LEVELS_QUICK_START; level++) {
            if (!currentSponsorCode) {
              console.log(`⏹️ Detenido en nivel superior ${level + 1}: no hay más patrocinadores`);
              break;
            }
            
            const upperSponsor = await findUserByUsername(currentSponsorCode);
            if (!upperSponsor) {
              console.warn(`⚠️ Nivel superior ${level + 1}: No se encontró usuario ${currentSponsorCode}`);
              break;
            }
            
            const upperSponsorRef = db.collection('usuarios').doc(upperSponsor.id);
            
            // 1 punto por cada paquete de 50
            const upperLevelPoints = numberOfPackages * QUICK_START_UPPER_LEVELS_POINTS;
            const upperLevelAmount = upperLevelPoints * POINT_VALUE;
            
            console.log(`📊 Nivel superior ${level + 1} (${upperSponsor.data.usuario}): Agregando ${upperLevelPoints} puntos grupales (${numberOfPackages} paquetes × 1 punto)`);
            
            await upperSponsorRef.update({
              groupPoints: admin.firestore.FieldValue.increment(upperLevelPoints),
              balance: admin.firestore.FieldValue.increment(upperLevelAmount),
              history: admin.firestore.FieldValue.arrayUnion({
                action: `Comisión Inicio Rápido (+${upperLevelPoints} pts) por compra de ${buyerUsername} - Nivel superior ${level + 1}`,
                amount: upperLevelAmount,
                points: upperLevelPoints,
                orderId,
                date: new Date().toISOString(),
                type: 'quick_start_upper_level',
                fromUser: buyerUsername
              })
            });
            
            currentSponsorCode = upperSponsor.data.patrocinador || null;
            console.log(`  ↑ Subiendo al siguiente nivel: ${currentSponsorCode || '(fin de línea)'}`);
          }
          
          console.log(`✅ Distribución de Quick Start Bonus completada: 25 puntos × ${numberOfPackages} paquetes = ${25 * numberOfPackages} puntos totales distribuidos`);
          
        } catch (e) {
          console.error('❌ Error pagando bono de inicio rápido:', e);
        }
      } else {
        if (!isFirstPurchase) {
          console.log(`ℹ️ No se paga Quick Start Bonus (no es la primera compra, puntos previos: ${prevPersonalPoints})`);
        } else if (points < QUICK_START_THRESHOLD) {
          console.log(`ℹ️ No se paga Quick Start Bonus (primera compra de ${points} puntos < ${QUICK_START_THRESHOLD} puntos requeridos)`);
        } else if (!directSponsorCode) {
          console.warn(`⚠️ No se puede pagar Quick Start Bonus: patrocinador directo no encontrado en buyer data`);
        } else if (!sponsorData) {
          console.warn(`⚠️ No se pudo obtener datos del patrocinador: ${directSponsorCode}`);
        }
      }

      // 4) Multilevel commission distribution (puntos grupales - solo para compras normales)
      // SOLO se ejecuta si NO se pagó el Quick Start Bonus
      // Si se pagó Quick Start Bonus, ya se distribuyeron los puntos arriba
      
      if (shouldPayQuickStartBonus) {
        console.log(`ℹ️ Quick Start Bonus aplicado - omitiendo distribución normal de puntos grupales`);
        
        // Mark order as having group points distributed
        await orderRef.update({
          groupPointsDistributed: true,
          groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y pagos procesados (Quick Start Bonus)' }) };
      }
      
      // Check if group points have already been distributed for this order
      const orderDoc = await orderRef.get();
      const orderData = orderDoc.data();
      if (orderData.groupPointsDistributed) {
        console.log(`ℹ️ Puntos grupales ya fueron distribuidos para esta orden. Omitiendo distribución.`);
        return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (ya procesada previamente)' }) };
      }
      
      // Check buyer type to determine commission rate
      const buyerDoc = await db.collection('usuarios').doc(buyerUid).get();
      const buyerType = buyerDoc.exists ? (buyerDoc.data().tipoRegistro || 'distribuidor') : 'distribuidor';
      const isRestaurante = buyerType === 'restaurante';
      
      console.log(`🌐 Iniciando distribución normal de puntos grupales: ${points} puntos de compra, tipo de comprador: ${buyerType}`);
      console.log(`   Distribución: 1 punto por cada 10 puntos de compra, a 5 niveles (incluye patrocinador directo)`);
      try {
        // Para compras normales o subsecuentes:
        // - El comprador recibe los puntos en personalPoints (ya se hizo en la transacción arriba)
        // - Cada patrocinador en la línea ascendente (5 niveles) recibe 1 punto por cada 10 puntos de compra
        // - Si el comprador es un Restaurante: 0.5 puntos por cada 10 puntos (en vez de 1)
        
        let currentSponsorCode = directSponsorCode;
        console.log(`🔼 Comenzando desde patrocinador directo: ${directSponsorCode}`);

        // Recorrer 5 niveles hacia arriba y dar puntos grupales a cada sponsor
        for (let level = 0; level < MAX_LEVELS_NORMAL; level++) {
          if (!currentSponsorCode) {
            console.log(`⏹️ Detenido en nivel ${level + 1}: no hay más patrocinadores`);
            break;
          }
          const sponsor = await findUserByUsername(currentSponsorCode);
          if (!sponsor) {
            console.warn(`⚠️ Nivel ${level + 1}: No se encontró usuario ${currentSponsorCode}`);
            break;
          }

          const sponsorRef = db.collection('usuarios').doc(sponsor.id);

          // Dar puntos grupales según el tipo de comprador:
          // - Cliente/Distribuidor: 1 punto grupal por cada 10 puntos de compra
          // - Restaurante: 0.5 puntos grupales por cada 10 puntos de compra
          const baseGroupPoints = Math.floor(points / 10) * REBUY_POINT_PER_LEVEL;
          const groupPointsToAdd = isRestaurante ? baseGroupPoints * 0.5 : baseGroupPoints;
          const groupPointsAmount = groupPointsToAdd * POINT_VALUE;
          console.log(`📊 Nivel ${level + 1} (${sponsor.data.usuario}): Agregando ${groupPointsToAdd} puntos grupales = ${groupPointsAmount} COP (points=${points}, tipo=${buyerType})`);

          await sponsorRef.update({
            groupPoints: admin.firestore.FieldValue.increment(groupPointsToAdd),
            balance: admin.firestore.FieldValue.increment(groupPointsAmount),
            history: admin.firestore.FieldValue.arrayUnion({
              action: `Comisión normal (+${groupPointsToAdd} pts = ${groupPointsAmount} COP) por compra de ${buyerUsername} (${buyerType}) - Nivel ${level + 1}`,
              amount: groupPointsAmount,
              points: groupPointsToAdd,
              orderId,
              date: new Date().toISOString(),
              type: 'group_points'
            })
          });

          // climb to next upline
          const nextSponsor = sponsor.data.patrocinador || null;
          console.log(`  ↑ Subiendo al siguiente nivel: ${nextSponsor || '(fin de línea)'}`);
          currentSponsorCode = nextSponsor;
        }
        
        // Mark order as having group points distributed
        await orderRef.update({
          groupPointsDistributed: true,
          groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ Distribución normal de puntos grupales completada`);
      } catch (e) {
        console.error('❌ Error durante la distribución normal de puntos grupales:', e);
        // Don't throw - we still want to return success for the confirmation
      }

      return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y pagos procesados' }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Action no soportada' }) };
  } catch (err) {
    console.error('🔥 Error confirm-order:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
