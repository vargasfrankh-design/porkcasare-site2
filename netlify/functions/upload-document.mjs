// netlify/functions/upload-document.mjs
// Handles document uploads for user documentation (cédula, RUT, certificación bancaria)
// Stores files in Netlify Blobs with user-scoped keys

import { getStore } from '@netlify/blobs';

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

    // Decode base64 file data
    const base64Data = fileData.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_SIZE) {
      return respond(400, { error: 'El archivo excede el tamaño máximo de 5MB' });
    }

    const store = getStore({ name: 'user-documents', consistency: 'strong' });

    // Store the file
    const blobKey = `${userId}/${docType}/${fileName}`;
    await store.set(blobKey, buffer, {
      metadata: {
        userId,
        docType,
        fileName,
        fileType,
        uploadedAt: new Date().toISOString(),
        fileSize: String(buffer.length),
      },
    });

    // Update the user's document index
    const indexKey = `${userId}/_index`;
    let index = {};
    try {
      const existing = await store.get(indexKey, { type: 'json' });
      if (existing) index = existing;
    } catch (_) { /* no index yet */ }

    index[docType] = {
      fileName,
      fileType,
      blobKey,
      uploadedAt: new Date().toISOString(),
      fileSize: buffer.length,
      status: 'uploaded', // uploaded | approved | rejected
    };

    await store.setJSON(indexKey, index);

    return respond(200, {
      success: true,
      message: 'Documento cargado exitosamente',
      doc: index[docType],
    });
  } catch (err) {
    console.error('upload-document error:', err);
    return respond(500, { error: 'Error interno del servidor' });
  }
};
