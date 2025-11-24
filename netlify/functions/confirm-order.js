
// netlify/functions/confirm-order.js
//
// SISTEMA DE BONOS Y COMISIONES - PorKCasare
//
// CONFIGURACIÓN BASE:
// - POINT_VALUE = 2,800 COP por punto
// - Cada producto tiene su propio precio y puntos configurados manualmente por el administrador
// - No existe un precio base universal
//
// SISTEMA DE COMISIONES:
//
// 1. CLIENTES:
//    * Pagan el precio de cliente configurado por el administrador
//    * Generan comisión por diferencia de precio SOLO al patrocinador directo
//    * Comisión = (Precio Cliente - Precio Distribuidor)
//    * Esta diferencia se convierte a puntos: diferencia / 2,800
//    * El patrocinador recibe la comisión en COP y en groupPoints
//    * Si el cliente no tiene patrocinador o el patrocinador no es distribuidor, no hay comisión
//    * Registro: "Comisión por diferencia de precio"
//
// 2. DISTRIBUIDORES:
//    * Pagan el precio de distribuidor configurado
//    * DISTRIBUIDORES NORMALES (compras subsecuentes):
//      - Cada uno de los 5 uplines recibe el 10% del valor total
//      - Valor total = puntos × 2,800 COP
//      - Comisión por upline = valor_total × 0.10
//      - Se convierte a puntos: comisión / 2,800
//    * QUICK START BONUS (primera compra >= 50 puntos):
//      - Sistema de 25 puntos por cada paquete de 50
//      - Patrocinador directo: 21 puntos por paquete
//      - 4 niveles superiores: 1 punto cada uno por paquete
//      - Solo se paga UNA VEZ en la primera compra grande
//
// 3. RESTAURANTES:
//    * Compran por kilos con precio y puntos por kilo configurados
//    * Puntos totales = kilos × puntos_por_kilo del producto
//    * El 5% de los puntos totales se distribuye a cada upline (máximo 5)
//    * Cada upline recibe el 5% COMPLETO (no se divide entre ellos)
//    * Ejemplo: 18 kg × 3.333 pts/kg = 60 pts totales
//      - 5% de 60 = 3 puntos por upline
//      - En COP: 3 × 2,800 = 8,400 COP por upline
//      - Total: 5 uplines × 8,400 = 42,000 COP
//    * Registro: "Comisión por compra de restaurante"
//
// CONTROL DE DUPLICADOS:
// - Campo groupPointsDistributed marca si ya se procesó la orden
// - Todas las operaciones se realizan al confirmar la orden
// - Transacciones garantizan consistencia
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
const COMMISSION_RATE = 0.10; // 10% commission for distributors
const RESTAURANT_COMMISSION_RATE = 0.05; // 5% of total points to each upline for restaurants
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
          
          const sponsorRef = db.collection('usuarios').doc(sponsorData.id);
          const now = Date.now();
          
          await sponsorRef.update({
            balance: admin.firestore.FieldValue.increment(bonusAmount),
            groupPoints: admin.firestore.FieldValue.increment(bonusPoints),
            history: admin.firestore.FieldValue.arrayUnion({
              action: `Bono Inicio Rápido (21 pts/paquete) por compra de ${points} puntos de ${buyerUsername}`,
              amount: bonusAmount,
              points: bonusPoints,
              orderId,
              date: new Date().toISOString(),
              timestamp: now,
              originMs: now,
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
            
            const upperLevelPoints = numberOfPackages * QUICK_START_UPPER_LEVELS_POINTS;
            const upperLevelAmount = upperLevelPoints * POINT_VALUE;
            
            console.log(`📊 Nivel superior ${level + 1} (${upperSponsor.data.usuario}): Agregando ${upperLevelPoints} puntos grupales (${numberOfPackages} paquetes × 1 punto)`);
            
            const now = Date.now();
            
            await upperSponsorRef.update({
              groupPoints: admin.firestore.FieldValue.increment(upperLevelPoints),
              balance: admin.firestore.FieldValue.increment(upperLevelAmount),
              history: admin.firestore.FieldValue.arrayUnion({
                action: `Comisión Inicio Rápido (+${upperLevelPoints} pts) por compra de ${buyerUsername} - Nivel superior ${level + 1}`,
                amount: upperLevelAmount,
                points: upperLevelPoints,
                orderId,
                date: new Date().toISOString(),
                timestamp: now,
                originMs: now,
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
      const buyerType = (buyerDataForType.tipoRegistro || buyerDataForType.role || 'distribuidor').toLowerCase();

      console.log(`🔍 Tipo de comprador: ${buyerType}`);

      // NEW LOGIC FOR CLIENTE: Pay price difference to direct sponsor only
      if (buyerType === 'cliente') {
        console.log(`💰 Procesando comisión por diferencia de precio para CLIENTE`);

        // Get product data to calculate price difference
        const productId = order.productId || order.product?.id || null;
        if (!productId) {
          console.warn(`⚠️ No se encontró productId en la orden para calcular diferencia de precio`);
          await orderRef.update({
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
            distributionNote: 'Cliente sin productId para calcular diferencia'
          });
          return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (cliente sin productId)' }) };
        }

        // Get product from Firestore
        const productsSnap = await db.collection('productos').where('id', '==', productId).limit(1).get();
        if (productsSnap.empty) {
          console.warn(`⚠️ Producto ${productId} no encontrado en Firestore`);
          await orderRef.update({
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
            distributionNote: 'Cliente - producto no encontrado'
          });
          return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (producto no encontrado)' }) };
        }

        const productData = productsSnap.docs[0].data();
        const precioCliente = productData.precioCliente || 0;
        const precioDistribuidor = productData.precioDistribuidor || 0;

        if (precioCliente === 0 || precioDistribuidor === 0) {
          console.warn(`⚠️ Precios no configurados: cliente=${precioCliente}, distribuidor=${precioDistribuidor}`);
          await orderRef.update({
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
            distributionNote: 'Cliente - precios no configurados'
          });
          return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (precios no configurados)' }) };
        }

        const quantity = Number(order.quantity || order.cantidad || 1);
        const priceDifference = (precioCliente - precioDistribuidor) * quantity;

        if (priceDifference <= 0) {
          console.log(`ℹ️ No hay diferencia de precio positiva: ${priceDifference} COP`);
          await orderRef.update({
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
            distributionNote: 'Cliente - sin diferencia de precio'
          });
          return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (sin diferencia de precio)' }) };
        }

        // Convert to points
        const commissionPoints = priceDifference / POINT_VALUE;

        console.log(`💰 Diferencia de precio: ${priceDifference} COP = ${commissionPoints.toFixed(2)} puntos`);
        console.log(`   Precio cliente: ${precioCliente} COP × ${quantity} = ${precioCliente * quantity} COP`);
        console.log(`   Precio distribuidor: ${precioDistribuidor} COP × ${quantity} = ${precioDistribuidor * quantity} COP`);

        // Pay to direct sponsor only if exists and is a distributor
        if (!directSponsorCode) {
          console.log(`ℹ️ Cliente sin patrocinador - no hay comisión`);
          await orderRef.update({
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
            distributionNote: 'Cliente sin patrocinador'
          });
          return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (cliente sin patrocinador)' }) };
        }

        const sponsor = await findUserByUsername(directSponsorCode);
        if (!sponsor) {
          console.warn(`⚠️ Patrocinador ${directSponsorCode} no encontrado`);
          await orderRef.update({
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
            distributionNote: 'Patrocinador no encontrado'
          });
          return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (patrocinador no encontrado)' }) };
        }

        const sponsorRole = (sponsor.data.tipoRegistro || sponsor.data.role || '').toLowerCase();
        if (sponsorRole !== 'distribuidor') {
          console.log(`ℹ️ Patrocinador ${directSponsorCode} no es distribuidor (rol: ${sponsorRole}) - no hay comisión`);
          await orderRef.update({
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
            distributionNote: 'Patrocinador no es distribuidor'
          });
          return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (patrocinador no es distribuidor)' }) };
        }

        // Pay commission to direct sponsor
        const sponsorRef = db.collection('usuarios').doc(sponsor.id);
        const now = Date.now();

        await sponsorRef.update({
          groupPoints: admin.firestore.FieldValue.increment(commissionPoints),
          balance: admin.firestore.FieldValue.increment(priceDifference),
          history: admin.firestore.FieldValue.arrayUnion({
            action: `Comisión por diferencia de precio - compra de ${buyerUsername} (${quantity}× ${productData.nombre || 'producto'})`,
            amount: priceDifference,
            points: commissionPoints,
            orderId,
            date: new Date().toISOString(),
            timestamp: now,
            originMs: now,
            type: 'client_price_difference',
            fromUser: buyerUsername
          })
        });

        console.log(`✅ Comisión pagada a patrocinador directo ${directSponsorCode}: ${priceDifference} COP (${commissionPoints.toFixed(2)} puntos)`);

        await orderRef.update({
          groupPointsDistributed: true,
          groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
          distributionNote: `Cliente - comisión pagada: ${priceDifference} COP`
        });

        return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y comisión de cliente procesada' }) };
      }

      // NEW LOGIC FOR RESTAURANTE: Distribute 5% of total points to each upline
      if (buyerType === 'restaurante') {
        console.log(`🍽️ Procesando comisión de RESTAURANTE - 5% de puntos totales a cada upline`);

        const totalPoints = points;
        const commissionPerUpline = totalPoints * RESTAURANT_COMMISSION_RATE;
        const commissionAmountPerUpline = Math.round(commissionPerUpline * POINT_VALUE);

        console.log(`📊 Restaurante - Puntos totales: ${totalPoints}`);
        console.log(`   Comisión por upline (5%): ${commissionPerUpline.toFixed(2)} puntos = ${commissionAmountPerUpline} COP`);
        console.log(`   Total a distribuir: ${commissionAmountPerUpline * MAX_LEVELS_NORMAL} COP (a ${MAX_LEVELS_NORMAL} uplines)`);

        if (!directSponsorCode) {
          console.warn(`⚠️ Restaurante sin patrocinador - no se puede distribuir comisión`);
          await orderRef.update({
            groupPointsDistributed: true,
            groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
            distributionNote: 'Restaurante sin patrocinador'
          });
          return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada (restaurante sin patrocinador)' }) };
        }

        let currentSponsorCode = directSponsorCode;
        let distributedCount = 0;

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
          const now = Date.now();

          await sponsorRef.update({
            groupPoints: admin.firestore.FieldValue.increment(commissionPerUpline),
            balance: admin.firestore.FieldValue.increment(commissionAmountPerUpline),
            history: admin.firestore.FieldValue.arrayUnion({
              action: `Comisión por compra de restaurante (5% = ${commissionPerUpline.toFixed(2)} pts) - ${buyerUsername} - Nivel ${level + 1}`,
              amount: commissionAmountPerUpline,
              points: commissionPerUpline,
              orderId,
              date: new Date().toISOString(),
              timestamp: now,
              originMs: now,
              type: 'restaurant_commission',
              fromUser: buyerUsername
            })
          });

          console.log(`✅ Nivel ${level + 1} (${sponsor.data.usuario}): ${commissionAmountPerUpline} COP (${commissionPerUpline.toFixed(2)} puntos)`);

          distributedCount++;
          currentSponsorCode = sponsor.data.patrocinador || null;
        }

        console.log(`✅ Comisión de restaurante distribuida a ${distributedCount} uplines`);

        await orderRef.update({
          groupPointsDistributed: true,
          groupPointsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
          distributionNote: `Restaurante - ${distributedCount} uplines, ${commissionPerUpline.toFixed(2)} pts c/u`
        });

        return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y comisión de restaurante procesada' }) };
      }

      // DISTRIBUTOR LOGIC (unchanged - continues below)
      // NEW LOGIC: Calculate commission as 10% of (points × 2800)
      // Each upline receives 10% of the total value, regardless of buyer type
      const totalPointValue = points * POINT_VALUE; // e.g., 2.5 × 2800 = 7000
      const commissionPerUpline = totalPointValue * COMMISSION_RATE; // e.g., 7000 × 0.10 = 700
      const pointsPerUpline = commissionPerUpline / POINT_VALUE; // Convert back to points for tracking
      
      console.log(`🌐 Iniciando distribución de comisiones:`);
      console.log(`   - Puntos del producto: ${points}`);
      console.log(`   - Valor total: ${totalPointValue.toLocaleString('es-CO')} COP`);
      console.log(`   - Comisión por upline (10%): ${commissionPerUpline.toLocaleString('es-CO')} COP = ${pointsPerUpline.toFixed(4)} puntos`);
      console.log(`   - Distribuyendo a 5 niveles hacia arriba (sin incluir al comprador)`);
      try {
        // Nueva lógica de distribución:
        // - El comprador recibe los puntos completos en personalPoints y groupPoints (ya se hizo en la transacción)
        // - Cada uno de los 5 uplines recibe el 10% del valor total (puntos × 2800)
        
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

        // Recorrer 5 niveles hacia arriba y dar comisión del 10% a cada sponsor
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

          // Todos los uplines reciben la misma comisión: 10% del valor total
          const groupPointsToAdd = Math.round(pointsPerUpline * 100) / 100;
          const groupPointsAmount = Math.round(commissionPerUpline);
          
          console.log(`📊 Nivel ${level + 1} (${sponsor.data.usuario}): Agregando ${groupPointsToAdd.toFixed(4)} puntos grupales = ${groupPointsAmount.toFixed(0)} COP (10% de ${totalPointValue.toFixed(0)} COP)`);

          const now = Date.now();

          await sponsorRef.update({
            groupPoints: admin.firestore.FieldValue.increment(groupPointsToAdd),
            balance: admin.firestore.FieldValue.increment(groupPointsAmount),
            history: admin.firestore.FieldValue.arrayUnion({
              action: `Comisión 10% (+${groupPointsToAdd.toFixed(2)} pts = ${groupPointsAmount.toLocaleString('es-CO')} COP) por compra de ${buyerUsername} - Nivel ${level + 1}`,
              amount: groupPointsAmount,
              points: groupPointsToAdd,
              orderId,
              date: new Date().toISOString(),
              timestamp: now,
              originMs: now,
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
        
        console.log(`✅ Distribución de comisiones completada`);
      } catch (e) {
        console.error('❌ Error durante la distribución de comisiones:', e);
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
