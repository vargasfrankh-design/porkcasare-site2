// netlify/functions/recalculate-distributor.js
// Recalcula los puntos grupales y balance de un distribuidor basándose en su historial
// Solo accesible por administradores

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();
const POINT_VALUE = 2800;

const getAuthHeader = (event) => {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!auth) return null;
  const parts = auth.split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
};

async function recalculateDistributor(distributorId) {
  const userRef = db.collection('usuarios').doc(distributorId);
  const userSnap = await userRef.get();
  
  if (!userSnap.exists) {
    throw new Error('Usuario no encontrado');
  }
  
  const userData = userSnap.data();
  const history = userData.history || [];
  
  // Calcular puntos grupales basados en el historial
  // Solo se cuentan entradas de comisiones, NO compras personales
  let calculatedGroupPoints = 0;
  let calculatedBalance = 0;
  
  // Tipos de entradas que aportan a puntos grupales
  const commissionTypes = ['group_points', 'quick_start_bonus', 'quick_start_upper_level', 'earning'];
  
  for (const entry of history) {
    if (!entry) continue;
    
    const entryType = entry.type || '';
    const action = (entry.action || '').toLowerCase();
    const points = Number(entry.points || 0);
    const amount = Number(entry.amount || 0);
    
    // Identificar si es una compra personal (NO debe sumar a groupPoints)
    const isPurchase = entryType === 'purchase' || 
                      (!entryType && entry.orderId && action.includes('compra confirmada'));
    
    // Identificar si es una comisión (SÍ debe sumar a groupPoints)
    const isCommission = commissionTypes.includes(entryType);
    
    // Identificar si es un cobro (retiro de puntos)
    const isWithdraw = entryType === 'withdraw';
    
    if (isPurchase) {
      // Las compras personales NO afectan groupPoints
      continue;
    } else if (isWithdraw) {
      // Los retiros restan puntos y balance
      // Para withdrawals, usar pointsUsed en lugar de points
      const withdrawPoints = Number(entry.pointsUsed || entry.points || 0);
      calculatedGroupPoints -= withdrawPoints;
      calculatedBalance -= amount;
    } else if (isCommission) {
      // Las comisiones suman puntos
      calculatedGroupPoints += points;
      calculatedBalance += amount;
    }
  }
  
  // Asegurar que no sean negativos
  calculatedGroupPoints = Math.max(0, calculatedGroupPoints);
  calculatedBalance = Math.max(0, calculatedBalance);
  
  // Verificar que la relación balance = groupPoints × 2800 sea consistente
  const expectedBalance = Math.round(calculatedGroupPoints * POINT_VALUE);
  
  // Si hay discrepancia, ajustar el balance al valor esperado
  if (Math.abs(calculatedBalance - expectedBalance) > 100) {
    console.log(`Ajustando balance de ${calculatedBalance} a ${expectedBalance} (groupPoints: ${calculatedGroupPoints})`);
    calculatedBalance = expectedBalance;
  }
  
  // Obtener valores actuales para comparación
  const currentGroupPoints = Number(userData.groupPoints || 0);
  const currentBalance = Number(userData.balance || 0);
  
  // Actualizar en Firestore
  await userRef.update({
    groupPoints: calculatedGroupPoints,
    balance: calculatedBalance,
    lastRecalculation: admin.firestore.FieldValue.serverTimestamp(),
    recalculatedBy: 'admin'
  });
  
  return {
    success: true,
    distributorId,
    before: {
      groupPoints: currentGroupPoints,
      balance: currentBalance
    },
    after: {
      groupPoints: calculatedGroupPoints,
      balance: calculatedBalance
    },
    changes: {
      groupPoints: calculatedGroupPoints - currentGroupPoints,
      balance: calculatedBalance - currentBalance
    }
  };
}

exports.handler = async (event) => {
  try {
    console.log('recalculate-distributor function called:', { method: event.httpMethod });
    
    if (event.httpMethod !== 'POST') {
      return { 
        statusCode: 405, 
        body: JSON.stringify({ error: 'Method not allowed' }) 
      };
    }

    // Verificar autenticación
    const token = getAuthHeader(event);
    if (!token) {
      console.log('No auth token provided');
      return { 
        statusCode: 401, 
        body: JSON.stringify({ error: 'No token provided' }) 
      };
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (authError) {
      console.error('Token verification failed:', authError.message);
      return { 
        statusCode: 401, 
        body: JSON.stringify({ error: 'Token inválido' }) 
      };
    }

    // Verificar que el usuario sea admin
    const adminUserRef = db.collection('usuarios').doc(decoded.uid);
    const adminUserSnap = await adminUserRef.get();
    
    if (!adminUserSnap.exists) {
      return { 
        statusCode: 403, 
        body: JSON.stringify({ error: 'Usuario no encontrado' }) 
      };
    }
    
    const adminUserData = adminUserSnap.data();
    const userRole = adminUserData.role || adminUserData.rol;
    
    if (userRole !== 'admin') {
      console.log('User is not admin:', decoded.uid, userRole);
      return { 
        statusCode: 403, 
        body: JSON.stringify({ error: 'Acceso denegado. Solo administradores pueden recalcular.' }) 
      };
    }

    // Parsear el cuerpo de la solicitud
    const body = JSON.parse(event.body || '{}');
    const { distributorId } = body;

    if (!distributorId) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: 'distributorId es requerido' }) 
      };
    }

    console.log('Recalculating distributor:', distributorId);

    // Ejecutar recalculación
    const result = await recalculateDistributor(distributorId);

    console.log('Recalculation completed:', result);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Error in recalculate-distributor:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Error recalculando distribuidor', 
        details: error.message 
      })
    };
  }
};
