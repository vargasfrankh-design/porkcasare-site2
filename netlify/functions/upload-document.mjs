// netlify/functions/upload-document.mjs
// Handles document uploads for user documentation (cédula, RUT, certificación bancaria)
// Stores files in Firebase Storage, metadata in Firestore under usuarios/{userId}/documentos

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

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
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
    const { userId, docType, fileName, fileData, fileType } = body;

    if (!userId || !docType || !fileName || !fileData || !fileType) {
      return respond(400, { error: 'Faltan campos requeridos' });
    }
    if (!VALID_DOC_TYPES.includes(docType)) {
      return respond(400, { error: 'Tipo de documento no válido' });
    }
    if (!ALLOWED_TYPES.includes(fileType)) {
      return respond(400, { error: 'Tipo de archivo no permitido. Use PDF, JPG o PNG.' });
    }

    // Check if documentation is already approved — block uploads in that case
    const userDoc = await db.collection('usuarios').doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData.documentacionEstado === 'aprobado') {
        return respond(403, {
          error: 'La documentación ya fue aprobada. No se pueden modificar los documentos.',
        });
      }
    }

    // Decode base64 file data
    const base64Data = fileData.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_SIZE) {
      return respond(400, { error: 'El archivo excede el tamaño máximo de 5MB' });
    }

    // Upload file to Firebase Storage
    const storagePath = `documentos/${userId}/${docType}/${fileName}`;
    const file = bucket.file(storagePath);

    await file.save(buffer, {
      metadata: {
        contentType: fileType,
        metadata: {
          userId,
          docType,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // Generate a signed download URL (valid for 5 years)
    const [downloadUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 5 * 365 * 24 * 60 * 60 * 1000,
    });

    // Save document metadata in Firestore under usuarios/{userId}/documentos/{docType}
    const docData = {
      fileName,
      fileType,
      storagePath,
      downloadUrl,
      uploadedAt: new Date().toISOString(),
      fileSize: buffer.length,
      status: 'uploaded', // uploaded | approved | rejected
    };

    await db
      .collection('usuarios')
      .doc(userId)
      .collection('documentos')
      .doc(docType)
      .set(docData);

    // Check if all 4 documents are now uploaded → set status to pendiente_validacion
    const allDocsSnap = await db
      .collection('usuarios')
      .doc(userId)
      .collection('documentos')
      .get();
    const uploadedTypes = [];
    allDocsSnap.forEach((d) => uploadedTypes.push(d.id));
    const allUploaded = VALID_DOC_TYPES.every((dt) => uploadedTypes.includes(dt));

    if (allUploaded) {
      await db.collection('usuarios').doc(userId).update({
        documentacionEstado: 'pendiente_validacion',
      });
    }

    return respond(200, {
      success: true,
      message: 'Documento cargado exitosamente',
      doc: docData,
      allDocumentsUploaded: allUploaded,
    });
  } catch (err) {
    console.error('upload-document error:', err);
    return respond(500, { error: 'Error interno del servidor' });
  }
};
