const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}
const db = admin.firestore();

const getAuthHeader = (event) => {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!auth) return null;
  const parts = auth.split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
};

exports.handler = async (event) => {
  try {
    const token = getAuthHeader(event);
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    const userDoc = await db.collection('usuarios').doc(uid).get();
    if (!userDoc.exists || userDoc.data().rol !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    const snap = await db.collection('orders')
      .where('status', 'in', ['pending_mp', 'pending_cash', 'pending_delivery'])
      .get();

    // Optimización: obtener todos los buyerUids únicos primero
    const uniqueBuyerUids = [...new Set(snap.docs.map(d => d.data().buyerUid).filter(Boolean))];

    // Batch de lecturas: obtener todos los usuarios en una sola operación
    const buyersMap = new Map();
    if (uniqueBuyerUids.length > 0) {
      const buyerRefs = uniqueBuyerUids.map(uid => db.collection('usuarios').doc(uid));
      const buyerDocs = await db.getAll(...buyerRefs);
      buyerDocs.forEach((buyerDoc, index) => {
        if (buyerDoc.exists) {
          buyersMap.set(uniqueBuyerUids[index], buyerDoc.data());
        }
      });
    }

    // Mapear las órdenes usando el cache de usuarios
    const orders = snap.docs.map(d => {
      const data = d.data();
      const buyerData = buyersMap.get(data.buyerUid) || {};
      return {
        id: d.id,
        ...data,
        buyerUsername: buyerData.usuario || data.buyerUid,
        buyerNombre: buyerData.nombre || ''
      };
    });

    // Filter out test users (names starting with "prueba")
    const filteredOrders = orders.filter(order => {
      const isTestUser = (order.buyerUsername && order.buyerUsername.toLowerCase().startsWith('prueba')) ||
                        (order.buyerNombre && order.buyerNombre.toLowerCase().startsWith('prueba'));
      return !isTestUser;
    });

    return { statusCode: 200, body: JSON.stringify({ orders: filteredOrders }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
