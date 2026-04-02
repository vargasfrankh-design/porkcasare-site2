// netlify/functions/manage-doc-status.mjs
// Admin-only function to confirm or reopen a user's documentation status.
// Persists documentacionEstado on the usuarios/{userId} document in Firestore.
// Valid transitions:
//   approve   → sets documentacionEstado = 'aprobado', marks each doc as 'approved'
//   reopen    → sets documentacionEstado = 'pendiente', marks each doc as 'uploaded'

import admin from 'firebase-admin';

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(saJson),
    storageBucket: 'porkcasare-915ff.firebasestorage.app',
  });
}
const db = admin.firestore();

const VALID_DOC_TYPES = ['cedula_frontal', 'cedula_posterior', 'rut', 'certificacion_bancaria'];

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: respond(204, '').headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body);
    const { userId, action, adminId } = body;

    if (!userId || !action || !adminId) {
      return respond(400, { error: 'userId, action y adminId son requeridos' });
    }

    if (!['approve', 'reopen'].includes(action)) {
      return respond(400, { error: 'action debe ser "approve" o "reopen"' });
    }

    // Verify adminId corresponds to an admin user
    const adminDoc = await db.collection('usuarios').doc(adminId).get();
    if (!adminDoc.exists) {
      return respond(403, { error: 'Administrador no encontrado' });
    }
    const adminData = adminDoc.data();
    if (adminData.rol !== 'admin' && adminData.role !== 'admin') {
      return respond(403, { error: 'No autorizado. Solo administradores pueden realizar esta acción.' });
    }

    // Verify the target user exists
    const userRef = db.collection('usuarios').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return respond(404, { error: 'Usuario no encontrado' });
    }

    if (action === 'approve') {
      // Check that all 4 documents have been uploaded
      const docsSnap = await userRef.collection('documentos').get();
      const uploadedTypes = [];
      docsSnap.forEach((d) => uploadedTypes.push(d.id));

      const missing = VALID_DOC_TYPES.filter((dt) => !uploadedTypes.includes(dt));
      if (missing.length > 0) {
        return respond(400, {
          error: 'No se puede aprobar. Faltan documentos: ' + missing.join(', '),
        });
      }

      // Update each doc status to 'approved'
      const batch = db.batch();
      for (const dt of VALID_DOC_TYPES) {
        batch.update(userRef.collection('documentos').doc(dt), { status: 'approved' });
      }
      // Update the user-level documentation status
      batch.update(userRef, {
        documentacionEstado: 'aprobado',
        documentacionAprobadoPor: adminId,
        documentacionAprobadoEn: new Date().toISOString(),
      });
      await batch.commit();

      return respond(200, {
        success: true,
        message: 'Documentación aprobada exitosamente',
        estado: 'aprobado',
      });
    }

    if (action === 'reopen') {
      // Reset each doc status to 'uploaded' and user-level to 'pendiente'
      const docsSnap = await userRef.collection('documentos').get();
      const batch = db.batch();
      docsSnap.forEach((d) => {
        batch.update(d.ref, { status: 'uploaded' });
      });
      batch.update(userRef, {
        documentacionEstado: 'pendiente',
        documentacionReabiertoPor: adminId,
        documentacionReabiertoEn: new Date().toISOString(),
      });
      await batch.commit();

      return respond(200, {
        success: true,
        message: 'Documentación reabierta. El usuario puede subir nuevos documentos.',
        estado: 'pendiente',
      });
    }
  } catch (err) {
    console.error('manage-doc-status error:', err);
    return respond(500, { error: 'Error interno del servidor' });
  }
};
