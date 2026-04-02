// netlify/functions/get-documents.mjs
// Retrieves document index and file data for a user
// Reads metadata from Firestore, files from Firebase Storage
// Used by both the user portal and admin panel

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
const bucket = admin.storage().bucket();

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: respond(204, '').headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Method not allowed' });
  }

  try {
    const userId = event.queryStringParameters?.userId;
    const docType = event.queryStringParameters?.docType;

    if (!userId) {
      return respond(400, { error: 'userId es requerido' });
    }

    // If docType is provided, return the actual file from Firebase Storage
    if (docType) {
      // Get metadata from Firestore
      const docSnap = await db
        .collection('usuarios')
        .doc(userId)
        .collection('documentos')
        .doc(docType)
        .get();

      if (!docSnap.exists) {
        return respond(404, { error: 'Documento no encontrado' });
      }

      const docInfo = docSnap.data();

      // Download file from Firebase Storage
      const file = bucket.file(docInfo.storagePath);
      const [fileBuffer] = await file.download();

      const base64 = fileBuffer.toString('base64');
      return respond(200, {
        success: true,
        file: {
          data: `data:${docInfo.fileType};base64,${base64}`,
          fileName: docInfo.fileName,
          fileType: docInfo.fileType,
          uploadedAt: docInfo.uploadedAt,
          fileSize: docInfo.fileSize,
          status: docInfo.status || 'uploaded',
          downloadUrl: docInfo.downloadUrl,
        },
      });
    }

    // Return all document metadata from Firestore
    const docsSnap = await db
      .collection('usuarios')
      .doc(userId)
      .collection('documentos')
      .get();

    const documents = {};
    docsSnap.forEach((doc) => {
      documents[doc.id] = doc.data();
    });

    // Also return the user-level documentation status
    const userDoc = await db.collection('usuarios').doc(userId).get();
    const documentacionEstado = userDoc.exists
      ? userDoc.data().documentacionEstado || null
      : null;

    return respond(200, {
      success: true,
      documents,
      documentacionEstado,
    });
  } catch (err) {
    console.error('get-documents error:', err);
    return respond(500, { error: 'Error interno del servidor' });
  }
};
