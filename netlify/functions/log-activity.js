// netlify/functions/log-activity.js
//
// SISTEMA DE REGISTRO DE ACTIVIDAD - PorKCasare
//
// Función auxiliar para registrar actividades detalladas en el sistema
// Crea registros en la colección 'activity_logs' para auditoría y seguimiento
//
// TIPOS DE ACTIVIDAD SOPORTADOS:
// - sale: Venta de productos
// - order_approved: Aprobación de órdenes
// - order_rejected: Rechazo de órdenes
// - code_validation: Validación de códigos promocionales
// - code_redemption: Redención de códigos
// - user_registration: Registro de nuevos usuarios
// - monthly_activation: Activación mensual de distribuidores
// - monthly_reactivation: Reactivación mensual
// - payout_request: Solicitud de cobro
// - payout_approved: Cobro aprobado
// - payout_rejected: Cobro rechazado

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

// POINT_VALUE constant to match the system
const POINT_VALUE = 2800;

/**
 * Create a detailed activity log entry
 * @param {Object} activity - Activity details
 * @returns {Promise<string>} - Activity log document ID
 */
async function createActivityLog(activity) {
  const {
    type,
    title,
    description,
    userId,
    userName,
    userType,
    productName,
    productId,
    orderId,
    totalPoints,
    totalValue,
    beneficiaries,
    metadata,
    adminId
  } = activity;

  const logEntry = {
    type,
    title,
    description,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: new Date().toISOString(),

    // User who performed or is affected by the action
    user: {
      id: userId || null,
      name: userName || null,
      type: userType || null
    },

    // Product info (for sales)
    product: productName ? {
      name: productName,
      id: productId || null
    } : null,

    // Order reference
    orderId: orderId || null,

    // Financial summary
    financial: {
      totalPoints: totalPoints || 0,
      totalValue: totalValue || 0,
      pointValue: POINT_VALUE
    },

    // Beneficiaries (upline who received commissions)
    beneficiaries: beneficiaries || [],
    beneficiariesCount: beneficiaries ? beneficiaries.length : 0,

    // Additional metadata
    metadata: metadata || {},

    // Admin who processed (if applicable)
    processedBy: adminId || null
  };

  const docRef = await db.collection('activity_logs').add(logEntry);
  return docRef.id;
}

/**
 * Create a sale activity log with full beneficiary details
 */
async function logSaleActivity({
  orderId,
  buyerId,
  buyerName,
  buyerType,
  productName,
  productId,
  quantity,
  totalPrice,
  totalPoints,
  beneficiaries,
  commissionType,
  adminId
}) {
  const description = `Venta realizada: ${productName}${quantity > 1 ? ` (x${quantity})` : ''}
Comprador: ${buyerName}
Fecha: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
Valor de la venta: $${totalPrice.toLocaleString('es-CO')}
Puntos generados: ${totalPoints}`;

  return createActivityLog({
    type: 'sale',
    title: `Venta: ${productName}`,
    description,
    userId: buyerId,
    userName: buyerName,
    userType: buyerType,
    productName,
    productId,
    orderId,
    totalPoints,
    totalValue: totalPrice,
    beneficiaries: beneficiaries.map((b, index) => ({
      level: index + 1,
      userId: b.userId,
      userName: b.userName,
      points: b.points,
      amount: b.amount,
      commissionType: b.commissionType || commissionType
    })),
    metadata: {
      quantity,
      commissionType
    },
    adminId
  });
}

/**
 * Create a user registration activity log
 */
async function logUserRegistration({
  userId,
  userName,
  userType,
  sponsorId,
  sponsorName
}) {
  const typeLabels = {
    'distribuidor': 'Distribuidor',
    'cliente': 'Cliente',
    'restaurante': 'Restaurante',
    'admin': 'Administrador'
  };

  const description = `Nuevo registro de ${typeLabels[userType] || userType}: ${userName}${sponsorName ? `\nPatrocinador: ${sponsorName}` : ''}`;

  return createActivityLog({
    type: 'user_registration',
    title: `Nuevo ${typeLabels[userType] || 'usuario'}: ${userName}`,
    description,
    userId,
    userName,
    userType,
    metadata: {
      sponsorId,
      sponsorName
    }
  });
}

/**
 * Create an order status change activity log
 */
async function logOrderStatusChange({
  orderId,
  newStatus,
  buyerId,
  buyerName,
  productName,
  totalPrice,
  reason,
  adminId
}) {
  const statusLabels = {
    'confirmed': 'aprobada',
    'rejected': 'rechazada',
    'pending': 'pendiente'
  };

  const type = newStatus === 'confirmed' ? 'order_approved' :
               newStatus === 'rejected' ? 'order_rejected' : 'order_status_change';

  const description = `Orden ${statusLabels[newStatus] || newStatus}: ${productName}
Usuario: ${buyerName}
Valor: $${totalPrice.toLocaleString('es-CO')}${reason ? `\nMotivo: ${reason}` : ''}`;

  return createActivityLog({
    type,
    title: `Orden ${statusLabels[newStatus]}: ${productName}`,
    description,
    userId: buyerId,
    userName: buyerName,
    productName,
    orderId,
    totalValue: totalPrice,
    metadata: {
      status: newStatus,
      reason
    },
    adminId
  });
}

// HTTP Handler
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method not allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    switch (action) {
      case 'log_sale':
        const saleLogId = await logSaleActivity(body);
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true, logId: saleLogId })
        };

      case 'log_registration':
        const regLogId = await logUserRegistration(body);
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true, logId: regLogId })
        };

      case 'log_order_status':
        const orderLogId = await logOrderStatusChange(body);
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true, logId: orderLogId })
        };

      case 'create_custom':
        const customLogId = await createActivityLog(body.activity);
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true, logId: customLogId })
        };

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Action no soportada' })
        };
    }
  } catch (err) {
    console.error('Error in log-activity:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

// Export functions for direct use from other Netlify functions
module.exports.createActivityLog = createActivityLog;
module.exports.logSaleActivity = logSaleActivity;
module.exports.logUserRegistration = logUserRegistration;
module.exports.logOrderStatusChange = logOrderStatusChange;
