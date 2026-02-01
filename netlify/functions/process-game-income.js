/**
 * PorkCasare Memory Game - Process Game Income
 *
 * SISTEMA DE DISTRIBUCIÓN DE INGRESOS DEL JUEGO:
 *
 * IMPORTANTE - REGLA DE NEGOCIO:
 * La publicidad (banners y videos) NO se reparte a la red de mercadeo.
 * Solo se distribuyen los ingresos de:
 * - Membresías
 * - Insignias
 * - Niveles/Pases de temporada
 * - Contenido Plus
 * - Torneos
 * - Patrocinadores
 *
 * DISTRIBUCIÓN (para ingresos que SÍ se reparten):
 * - 70% para la plataforma
 * - 30% repartido en partes iguales a 5 generaciones hacia arriba
 * - 6% por generación (30% / 5)
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

// Configuración
const POINT_VALUE = 2800; // COP por punto
const PLATFORM_SHARE = 0.70; // 70% para la plataforma
const NETWORK_SHARE = 0.30; // 30% para la red
const MAX_LEVELS = 5;
const SHARE_PER_LEVEL = NETWORK_SHARE / MAX_LEVELS; // 6% por nivel

// Tipos de ingreso que NO se distribuyen a la red
const EXCLUDED_FROM_DISTRIBUTION = [
  'ad_impression',      // Impresión de banner
  'ad_click',           // Click en banner
  'rewarded_video',     // Video recompensado
  'ad_interstitial',    // Anuncio intersticial
  'ad_revenue'          // Ingresos generales de publicidad
];

// Tipos de ingreso que SÍ se distribuyen
const DISTRIBUTABLE_INCOME_TYPES = [
  'membership_monthly',   // Membresía mensual $10
  'membership_lifetime',  // Membresía única $200
  'badge_purchase',       // Compra de insignia
  'level_unlock',         // Desbloqueo de nivel
  'season_pass',          // Pase de temporada
  'content_plus',         // Contenido premium
  'tournament_entry',     // Inscripción a torneo
  'sponsor_revenue'       // Ingresos de patrocinadores
];

// Helper para obtener token de autenticación
const getAuthHeader = (event) => {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!auth) return null;
  const parts = auth.split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
};

// Buscar usuario por username (con cache)
const sponsorCache = new Map();

async function findUserByUsername(username) {
  if (!username) return null;
  if (sponsorCache.has(username)) {
    return sponsorCache.get(username);
  }

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

// Registrar log de actividad
async function logActivity(activityData) {
  try {
    const logEntry = {
      ...activityData,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString()
    };
    const docRef = await db.collection('game_income_logs').add(logEntry);
    return docRef.id;
  } catch (e) {
    console.warn('⚠️ Error registrando actividad:', e.message);
    return null;
  }
}

exports.handler = async (event) => {
  // Limpiar cache al inicio de cada request
  sponsorCache.clear();

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method not allowed' };
    }

    // Verificar autenticación
    const token = getAuthHeader(event);
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (authError) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
    }

    const userId = decoded.uid;
    const body = JSON.parse(event.body || '{}');
    const { incomeType, amount, metadata } = body;

    // Validar datos requeridos
    if (!incomeType || !amount || amount <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'incomeType y amount (> 0) son requeridos' })
      };
    }

    // Obtener datos del usuario
    const userRef = db.collection('usuarios').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Usuario no encontrado' }) };
    }

    const userData = userSnap.data();
    const userName = userData.usuario || userData.nombre || 'Usuario';
    const sponsor = userData.patrocinador || null;

    console.log(`💰 Procesando ingreso del juego:`);
    console.log(`   Usuario: ${userName} (${userId})`);
    console.log(`   Tipo: ${incomeType}`);
    console.log(`   Monto: ${amount} COP`);

    // Verificar si este tipo de ingreso se excluye de la distribución
    const isExcluded = EXCLUDED_FROM_DISTRIBUTION.includes(incomeType);

    if (isExcluded) {
      // PUBLICIDAD - NO SE DISTRIBUYE A LA RED
      console.log(`📺 Ingreso de publicidad - NO se distribuye a la red`);

      // Registrar el ingreso solo para la plataforma
      await logActivity({
        type: 'game_income',
        category: 'advertising',
        incomeType,
        userId,
        userName,
        amount,
        distributed: false,
        reason: 'Publicidad excluida de distribución MLM',
        metadata
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Ingreso de publicidad registrado (no distribuido)',
          incomeType,
          amount,
          distributed: false
        })
      };
    }

    // INGRESO DISTRIBUIBLE - Aplicar regla 70/30
    console.log(`🌐 Ingreso distribuible - Aplicando regla 70/30`);

    const platformAmount = Math.round(amount * PLATFORM_SHARE);
    const networkAmount = Math.round(amount * NETWORK_SHARE);
    const amountPerLevel = Math.round(networkAmount / MAX_LEVELS);

    console.log(`   Plataforma (70%): ${platformAmount} COP`);
    console.log(`   Red (30%): ${networkAmount} COP`);
    console.log(`   Por nivel (6%): ${amountPerLevel} COP`);

    const beneficiaries = [];

    // Distribuir a 5 niveles si hay patrocinador
    if (sponsor) {
      let currentSponsorCode = sponsor;
      let distributedLevels = 0;

      for (let level = 0; level < MAX_LEVELS; level++) {
        if (!currentSponsorCode) {
          console.log(`⏹️ Detenido en nivel ${level + 1}: no hay más patrocinadores`);
          break;
        }

        const sponsorDoc = await findUserByUsername(currentSponsorCode);
        if (!sponsorDoc) {
          console.warn(`⚠️ Nivel ${level + 1}: No se encontró usuario ${currentSponsorCode}`);
          break;
        }

        const sponsorRef = db.collection('usuarios').doc(sponsorDoc.id);
        const pointsToAdd = amountPerLevel / POINT_VALUE;
        const now = Date.now();

        await sponsorRef.update({
          balance: admin.firestore.FieldValue.increment(amountPerLevel),
          groupPoints: admin.firestore.FieldValue.increment(pointsToAdd),
          history: admin.firestore.FieldValue.arrayUnion({
            action: `Comisión juego Memory (${incomeType}) - 6% de ${amount} COP de ${userName}`,
            amount: amountPerLevel,
            points: pointsToAdd,
            date: new Date().toISOString(),
            timestamp: now,
            type: 'game_income',
            incomeType,
            fromUser: userName,
            level: level + 1
          })
        });

        beneficiaries.push({
          level: level + 1,
          userId: sponsorDoc.id,
          userName: sponsorDoc.data.usuario || sponsorDoc.data.nombre || 'N/A',
          amount: amountPerLevel,
          points: pointsToAdd
        });

        console.log(`✅ Nivel ${level + 1} (${sponsorDoc.data.usuario}): ${amountPerLevel} COP`);

        distributedLevels++;
        currentSponsorCode = sponsorDoc.data.patrocinador || null;
      }

      // Si no se distribuyeron los 5 niveles, el resto va a la plataforma
      if (distributedLevels < MAX_LEVELS) {
        const undistributed = amountPerLevel * (MAX_LEVELS - distributedLevels);
        console.log(`ℹ️ ${MAX_LEVELS - distributedLevels} niveles sin upline - ${undistributed} COP regresan a plataforma`);
      }
    } else {
      console.log(`ℹ️ Usuario sin patrocinador - 100% va a la plataforma`);
    }

    // Registrar el ingreso completo
    await logActivity({
      type: 'game_income',
      category: 'distributable',
      incomeType,
      userId,
      userName,
      amount,
      platformAmount,
      networkAmount,
      distributed: true,
      beneficiaries,
      beneficiariesCount: beneficiaries.length,
      metadata
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Ingreso procesado y distribuido',
        incomeType,
        amount,
        distributed: true,
        platformAmount,
        networkAmount,
        beneficiaries: beneficiaries.map(b => ({
          level: b.level,
          userName: b.userName,
          amount: b.amount
        }))
      })
    };

  } catch (err) {
    console.error('🔥 Error en process-game-income:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
