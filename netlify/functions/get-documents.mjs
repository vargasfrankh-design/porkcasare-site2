// netlify/functions/get-documents.mjs
// Retrieves document index and file data for a user
// Used by both the user portal and admin panel

import { getStore } from '@netlify/blobs';

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

    const store = getStore({ name: 'user-documents', consistency: 'strong' });

    // If docType is provided, return the actual file
    if (docType) {
      const indexKey = `${userId}/_index`;
      const index = await store.get(indexKey, { type: 'json' });
      if (!index || !index[docType]) {
        return respond(404, { error: 'Documento no encontrado' });
      }

      const docInfo = index[docType];
      const fileBuffer = await store.get(docInfo.blobKey, { type: 'arrayBuffer' });
      if (!fileBuffer) {
        return respond(404, { error: 'Archivo no encontrado' });
      }

      const base64 = Buffer.from(fileBuffer).toString('base64');
      return respond(200, {
        success: true,
        file: {
          data: `data:${docInfo.fileType};base64,${base64}`,
          fileName: docInfo.fileName,
          fileType: docInfo.fileType,
          uploadedAt: docInfo.uploadedAt,
          fileSize: docInfo.fileSize,
          status: docInfo.status || 'uploaded',
        },
      });
    }

    // Return document index only
    const indexKey = `${userId}/_index`;
    const index = await store.get(indexKey, { type: 'json' });

    return respond(200, {
      success: true,
      documents: index || {},
    });
  } catch (err) {
    console.error('get-documents error:', err);
    return respond(500, { error: 'Error interno del servidor' });
  }
};
