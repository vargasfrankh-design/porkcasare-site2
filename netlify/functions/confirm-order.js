
// netlify/functions/confirm-order.js
// Reglas implementadas:
// - POINT_VALUE = 2800 pesos
// - Sistema base: 3 kg = 10 puntos = 60,000 COP | 1 kg = 10/3 ≈ 3.333 puntos
// 
// CLIENTES:
//   * Pagan 25% más que precio distribuidor: 60,000 × 1.25 = 75,000 por 3kg
//   * No generan puntos ni comisiones
// 
// DISTRIBUIDORES:
//   * Compran paquete de 3 kg = 10 puntos = 60,000 COP
//   * Comisiones: Cada uno de los 5 uplines recibe 1 punto
//   * Pago por upline = 1 × 2,800 = 2,800 COP
//   * Pago total sistema = 5 × 2,800 = 14,000 COP
// 
// RESTAURANTES:
//   * Compran kilos arbitrarios (ejemplo: 2 kg)
//   * Conversión: 2 kg × 10/3 = 6.6667 puntos
//   * Cada upline recibe 0.05 puntos por cada punto generado
//   * Ejemplo 2kg: 6.6667 × 0.05 = 0.3333 puntos por upline
//   * Pago por upline = 0.3333 × 2,800 ≈ 933 COP
//   * Pago total sistema = 5 × 933 ≈ 4,665 COP
// 
// FÓRMULAS UNIVERSALES:
//   * Puntos totales = kilos × 10/3
//   * Puntos por upline (restaurantes) = puntos_totales × 0.05
//   * Puntos por upline (distribuidores) = 1 punto fijo
//   * Pago por upline = puntos_por_upline × 2,800
//   * Pago total sistema = pago_por_upline × 5
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
const POINTS_PER_UPLINE_DISTRIBUTOR = 1;
const POINTS_PER_UPLINE_RESTAURANT_RATE = 0.05;
const MAX_LEVELS_NORMAL = 5;
const MAX_LEVELS_QUICK_START = 4;
const QUICK_START_DIRECT_POINTS = 21;
const QUICK_START_UPPER_LEVELS_POINTS = 1;
const QUICK_START_THRESHOLD = 50;

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
    console.log('confirm-order function called:', { method: event.httpMethod });
    
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const token = getAuthHeader(event);
    if (!token) {
      console.log('No auth token provided');
      return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (authError) {
      console.error('Token verification failed:', authError.message);
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token', details: authError.message }) };
    }
    
    const adminUid = decoded.uid;
    console.log('Request from user:', adminUid);

    const adminDoc = await db.collection('usuarios').doc(adminUid).get();
    if (!adminDoc.exists || adminDoc.data().rol !== 'admin') {
      console.log('User is not admin:', adminUid, 'rol:', adminDoc.exists ? adminDoc.data().rol : 'not found');
      return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { orderId, action } = body;
    console.log('Processing order:', { orderId, action });
    
    if (!orderId || !action) return { statusCode: 400, body: JSON.stringify({ error: 'orderId y action requeridos' }) };

    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      console.log('Order not found:', orderId);
      return { statusCode: 404, body: JSON.stringify({ error: 'Orden no encontrada' }) };
    }
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
      // Validate and normalize order data
      const buyerUid = order.buyerUid || order.userId || order.uid;
      if (!buyerUid) {
        console.error('❌ Error: Orden sin buyerUid', { orderId, orderKeys: Object.keys(order) });
        return { statusCode: 400, body: JSON.stringify({ error: 'Orden sin buyerUid', details: 'La orden no tiene un campo buyerUid válido' }) };
      }

      // Handle multiple possible field names for points (backward compatibility)
      const points = Number(order.totalPoints || order.points || order.puntos || 0);
      const quantity = Number(order.quantity || order.cantidad || 1);
      
      // Validate points
      if (points <= 0) {
        console.error('❌ Error: Orden sin puntos válidos', { orderId, points, orderData: order });
        return { statusCode: 400, body: JSON.stringify({ error: 'Orden sin puntos válidos', details: `La orden tiene ${points} puntos` }) };
      }
      
      console.log(`📊 Orden ${orderId}: points = ${points}, quantity = ${quantity}, buyerUid = ${buyerUid}`);

      // 1) Get buyer data first to determine sponsor
      const buyerRef = db.collection('usuarios').doc(buyerUid);
      const buyerDocSnapshot = await buyerRef.get();
      if (!buyerDocSnapshot.exists) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Comprador no encontrado' }) };
      }
      
      const buyerDataPreTx = buyerDocSnapshot.data() || {};
      const directSponsorCodePreTx = buyerDataPreTx.patrocinador || buyerDataPreTx.sponsor || order.sponsor || order.patrocinador || null;
      const prevPersonalPointsPreTx = Number(buyerDataPreTx.personalPoints || buyerDataPreTx.puntos || buyerDataPreTx.points || 0);
      const isFirstPurchasePreTx = prevPersonalPointsPreTx === 0;
      const shouldPayQuickStartBonusPreTx = isFirstPurchasePreTx && points >= QUICK_START_THRESHOLD;
      
      console.log(`📊 Buyer data check: sponsor=${directSponsorCodePreTx}, prevPoints=${prevPersonalPointsPreTx}, isFirst=${isFirstPurchasePreTx}, shouldPayQuickStart=${shouldPayQuickStartBonusPreTx}`);
      
      // Look up sponsor before transaction if needed
      let sponsorDocId = null;
      if (shouldPayQuickStartBonusPreTx && directSponsorCodePreTx) {
        console.log(`🔍 Buscando patrocinador: ${directSponsorCodePreTx}`);
        const sponsor = await findUserByUsername(directSponsorCodePreTx);
        if (sponsor) {
          sponsorDocId = sponsor.id;
          console.log(`✅ Patrocinador encontrado: ${sponsor.data.usuario} (ID: ${sponsorDocId})`);
        } else {
          console.warn(`⚠️ Patrocinador no encontrado en BD: ${directSponsorCodePreTx}`);
        }
      } else if (shouldPayQuickStartBonusPreTx && !directSponsorCodePreTx) {
        console.warn(`⚠️ Se requiere Quick Start Bonus pero el comprador no tiene patrocinador registrado`);
      }

      // 2) Run transaction: mark order confirmed and update buyer points
      let txResult;
      try {
        txResult = await db.runTransaction(async (tx) => {
          // ALL READS MUST HAPPEN FIRST - before any writes
          const ordSnap = await tx.get(orderRef);
          if (!ordSnap.exists) throw new Error('Orden desapareció durante la transacción');
          
          const currentOrder = ordSnap.data();
          if (currentOrder.status === 'confirmed') {
            throw new Error('Orden ya confirmada anteriormente');
          }

          const buyerSnap = await tx.get(buyerRef);
          if (!buyerSnap.exists) throw new Error('Comprador no encontrado en la transacción');
          
          // Read sponsor data within transaction if we have the ID (BEFORE any writes)
          let sponsorData = null;
          if (sponsorDocId) {
            const sponsorRefInTx = db.collection('usuarios').doc(sponsorDocId);
            const sponsorDocSnap = await tx.get(sponsorRefInTx);
            if (sponsorDocSnap.exists) {
              sponsorData = { id: sponsorDocId, data: sponsorDocSnap.data() };
            }
          }
          
          // NOW we can process the data and do writes
          const buyerData = buyerSnap.data() || {};
          const currentPoints = Number(buyerData.personalPoints || buyerData.puntos || buyerData.points || 0);
          const newPersonalPoints = currentPoints + points;
          
          console.log(`📊 Transaction: currentPoints=${currentPoints}, adding=${points}, new=${newPersonalPoints}`);

          tx.update(orderRef, {
            status: 'confirmed',
            admin: adminUid,
            confirmedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Get product name from multiple possible fields
          const productName = order.productName || order.product || order.nombre || order.productoNombre || 'Producto';
          const orderAmount = order.totalPrice || order.price || order.amount || order.total || order.precio || null;
          
          const buyerUpdates = {
            personalPoints: admin.firestore.FieldValue.increment(points),
            puntos: admin.firestore.FieldValue.increment(points),
            history: admin.firestore.FieldValue.arrayUnion({
              type: 'purchase',
              action: `Compra confirmada: ${productName}${quantity > 1 ? ` (x${quantity})` : ''}`,
              amount: orderAmount,
              points: points,
              quantity: quantity,
              orderId,
              date: new Date().toISOString(),
              by: 'admin'
            })
          };
          
          console.log(`📊 Buyer updates: adding ${points} points, product=${productName}, amount=${orderAmount}`);

          tx.update(buyerRef, buyerUpdates);

          // compatibility flag
          if (newPersonalPoints >= 50 && !buyerData.initialPackBought) {
            tx.update(buyerRef, { initialPackBought: true });
          }

          return { 
            prevPersonalPoints: prevPersonalPointsPreTx, 
            newPersonalPoints, 
            directSponsorCode: directSponsorCodePreTx,
            shouldPayQuickStartBonus: shouldPayQuickStartBonusPreTx,
            isFirstPurchase: isFirstPurchasePreTx,
            buyerUsername: buyerData.usuario || buyerData.username || buyerData.nombre || buyerData.name || 'Usuario',
            sponsorData
          };
        });
      } catch (txError) {
        console.error('🔥 Transaction failed:', txError);
        console.error('  Error name:', txError.name);
        console.error('  Error message:', txError.message);
        console.error('  Error stack:', txError.stack);
        return { 
          statusCode: 500, 
          body: JSON.stringify({ 
            error: 'Error en transacción', 
            details: txError.message,
            errorName: txError.name 
          }) 
        };
      }

      const { 
        prevPersonalPoints, 
        newPersonalPoints, 
        directSponsorCode,
        shouldPayQuickStartBonus,
        isFirstPurchase,
        buyerUsername,
        sponsorData
      } = txResult || { 
        prevPersonalPoints: 0, 
        newPersonalPoints: 0, 
        directSponsorCode: null,
        shouldPayQuickStartBonus: false,
        isFirstPurchase: false,
        buyerUsername: '',
        sponsorData: null
      };
      console.log(`📊 Transacción completada: prevPersonalPoints = ${prevPersonalPoints}, newPersonalPoints = ${newPersonalPoints}, points de esta compra = ${points}`);

      // 2) Create confirmation audit doc (best effort)
      try {
        const productName = order.productName || order.product || order.nombre || order.productoNombre || null;
        const orderAmount = order.totalPrice || order.price || order.amount || order.total || order.precio || null;
        
        await db.collection('confirmations').add({
          orderId,
          userId: buyerUid,
          points,
          amount: orderAmount,
          confirmedBy: adminUid,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          meta: {
            productName: productName,
            itemsCount: Array.isArray(order.items) ? order.items.length : (quantity || 1),
            quantity: quantity
          }
        });
      } catch (e) {
        console.warn('⚠️ Warning: no se pudo crear confirmation doc', e.message);
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

      let quickStartBonusPaid = false;  // Flag to track if bonus was actually paid

      if (shouldPayQuickStartBonus && sponsorData && sponsorData.data) {
        console.log(`💰 Pagando Quick Start Bonus (sistema de 25 puntos) a patrocinador directo: ${directSponsorCode}`);
        try {
          console.log(`✓ Patrocinador directo: ${sponsorData.data.usuario || 'N/A'} (ID: ${sponsorData.id})`);
          
          // Calcular paquetes de 50 puntos
          const numberOfPackages = Math.floor(points / 50);
          
          // Patrocinador directo recibe 21 puntos por cada paquete de 50
          const bonusPoints = numberOfPackages * QUICK_START_DIRECT_POINTS;
          const bonusAmount = bonusPoints * POINT_VALUE;
          
          console.log(`💰 Bono calculado: ${bonusPoints} puntos = ${bonusAmount} COP (${numberOfPackages} paquetes × 21 puntos)`);
          
          // Recreate sponsor ref outside transaction
          const sponsorRef = db.collection('usuarios').doc(sponsorData.id);
          
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
          
          let currentSponsorCode = (sponsorData.data && sponsorData.data.patrocinador) || null;
          
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
          quickStartBonusPaid = true;  // Mark that bonus was successfully paid
          
        } catch (e) {
          console.error('❌ Error pagando bono de inicio rápido:', e);
          console.error('  Error name:', e.name);
          console.error('  Error message:', e.message);
          console.error('  Error stack:', e.stack);
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
        } else if (!sponsorData.data) {
          console.error(`❌ ERROR: sponsorData existe pero sponsorData.data es undefined para patrocinador ${directSponsorCode}`);
        }
      }

      // 4) Multilevel commission distribution (puntos grupales - solo para compras normales)
      // SOLO se ejecuta si NO se pagó el Quick Start Bonus
      // Si se pagó Quick Start Bonus, ya se distribuyeron los puntos arriba
      
      if (quickStartBonusPaid) {
        console.log(`ℹ️ Quick Start Bonus pagado exitosamente - omitiendo distribución normal de puntos grupales`);
        
        // Mark order as having group points distributed
        await orderRef.update({
          groupPointsDistributed: true,
          groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y pagos procesados (Quick Start Bonus)' }) };
      }
      
      // If we reach here, it means either:
      // 1. It's not a first purchase, OR
      // 2. First purchase but < 50 points, OR
      // 3. First purchase >= 50 points but Quick Start Bonus could not be paid (no sponsor found)
      // In all cases, we should distribute normal commissions
      
      console.log(`ℹ️ Procediendo con distribución normal de comisiones${shouldPayQuickStartBonus ? ' (Quick Start Bonus no pudo ser pagado - distribuyendo comisión normal)' : ''}`);
      
      // Check if group points have already been distributed for this order
      const orderDoc = await orderRef.get();
      const orderData = orderDoc.data();
      if (orderData.groupPointsDistributed) {
        console.log(`ℹ️ Puntos grupales ya fueron distribuidos para esta orden. Omitiendo distribución.`);
        return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (ya procesada previamente)' }) };
      }
      
      // Check buyer type to determine commission rate
      const buyerDoc = await db.collection('usuarios').doc(buyerUid).get();
      const buyerDataForType = buyerDoc.exists ? buyerDoc.data() : {};
      const buyerType = buyerDataForType?.tipoRegistro || buyerDataForType?.tipo || 'distribuidor';
      const isRestaurante = buyerType === 'restaurante';
      
      console.log(`🌐 Iniciando distribución normal de puntos grupales: ${points} puntos de compra, tipo de comprador: ${buyerType}`);
      console.log(`   Distribución:`);
      console.log(`   - Distribuidores/Clientes: 1 punto fijo por upline, a 5 niveles`);
      console.log(`   - Restaurantes: ${points} pts × 0.05 = ${(points * 0.05).toFixed(4)} puntos por upline, a 5 niveles`);
      try {
        // Para compras normales o subsecuentes:
        // - El comprador recibe los puntos en personalPoints (ya se hizo en la transacción arriba)
        // - DISTRIBUIDORES/CLIENTES: Cada upline recibe 1 punto fijo (no importa cuántos puntos compró)
        // - RESTAURANTES: Cada upline recibe 0.05 puntos por cada punto generado en la compra
        
        let currentSponsorCode = directSponsorCode;
        
        // Validate sponsor code exists before starting distribution
        if (!currentSponsorCode) {
          console.warn(`⚠️ No se puede distribuir puntos grupales: patrocinador directo no encontrado`);
          console.log(`   Order data: buyerUid=${buyerUid}, orderId=${orderId}`);
          // Mark as distributed to avoid re-processing
          await orderRef.update({
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
            distributionNote: 'Sin patrocinador directo'
          });
          return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (sin patrocinador para distribución)' }) };
        }
        
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

          // Calcular puntos grupales según el tipo de comprador:
          // - Distribuidor/Cliente: 1 punto fijo por upline
          // - Restaurante: 0.05 puntos por cada punto generado en la compra
          let groupPointsToAdd;
          if (isRestaurante) {
            groupPointsToAdd = Math.round((points * POINTS_PER_UPLINE_RESTAURANT_RATE) * 100) / 100;
          } else {
            groupPointsToAdd = POINTS_PER_UPLINE_DISTRIBUTOR;
          }
          const groupPointsAmount = Math.round(groupPointsToAdd * POINT_VALUE);
          console.log(`📊 Nivel ${level + 1} (${sponsor.data.usuario}): Agregando ${groupPointsToAdd.toFixed(4)} puntos grupales = ${groupPointsAmount.toFixed(0)} COP (points=${points}, tipo=${buyerType})`);

          await sponsorRef.update({
            groupPoints: admin.firestore.FieldValue.increment(groupPointsToAdd),
            balance: admin.firestore.FieldValue.increment(groupPointsAmount),
            history: admin.firestore.FieldValue.arrayUnion({
              action: `Comisión normal (+${groupPointsToAdd.toFixed(2)} pts = ${groupPointsAmount.toLocaleString('es-CO')} COP) por compra de ${buyerUsername} (${buyerType}) - Nivel ${level + 1}`,
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
        console.error('  Error name:', e.name);
        console.error('  Error message:', e.message);
        console.error('  Error stack:', e.stack);
        // Don't throw - we still want to return success for the confirmation
      }

      return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y pagos procesados' }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Action no soportada' }) };
  } catch (err) {
    console.error('🔥 Error confirm-order:', err);
    console.error('  Error name:', err.name);
    console.error('  Error message:', err.message);
    console.error('  Error stack:', err.stack);
    console.error('  Error code:', err.code);
    return { statusCode: 500, body: JSON.stringify({ error: err.message, errorName: err.name, errorCode: err.code }) };
  }
};
