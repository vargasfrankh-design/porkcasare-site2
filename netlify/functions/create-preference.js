/**
 * MercadoPago - Create Preference Function (PRODUCTION MODE)
 *
 * Creates a payment preference in MercadoPago for checkout.
 * This function uses PRODUCTION credentials by default.
 *
 * Uses environment variables:
 * - MP_ACCESS_TOKEN: MercadoPago PRODUCTION access token (required)
 * - SITE_URL: Base URL for callbacks (optional, defaults to origin)
 *
 * Note: Sandbox mode has been removed. This function only uses production credentials.
 */

// Using native fetch available in Node.js 18+
const admin = require('firebase-admin');

// Initialize Firebase Admin once
let appInitialized = false;

function initAdmin() {
  if (appInitialized) return;
  const sa_b64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!sa_b64) throw new Error('FIREBASE_ADMIN_SA not configured');
  const sa_json = JSON.parse(Buffer.from(sa_b64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa_json) });
  appInitialized = true;
}

// Validate request body
function validateBody(body) {
  const errors = [];

  if (!body.uid || typeof body.uid !== 'string' || body.uid.trim() === '') {
    errors.push('uid is required and must be a non-empty string');
  }

  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (isNaN(amount) || amount <= 0) {
      errors.push('amount must be a positive number');
    }
    if (amount > 50000000) { // 50M COP max
      errors.push('amount exceeds maximum allowed');
    }
  }

  if (body.type && typeof body.type !== 'string') {
    errors.push('type must be a string');
  }

  // Validate items if provided
  if (body.items) {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      errors.push('items must be a non-empty array');
    } else {
      body.items.forEach((item, index) => {
        if (!item.title) errors.push(`items[${index}].title is required`);
        if (!item.quantity || item.quantity <= 0) errors.push(`items[${index}].quantity must be positive`);
        if (!item.unit_price || item.unit_price <= 0) errors.push(`items[${index}].unit_price must be positive`);
      });
    }
  }

  return errors;
}

exports.handler = async function(event) {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // Validate request body
    const validationErrors = validateBody(body);
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Validation failed', details: validationErrors })
      };
    }

    const uid = body.uid.trim();
    const amount = Number(body.amount) || 60000;
    const type = body.type || 'recompra';
    const description = body.description || `PorKCasare - ${type}`;

    // Get environment variables
    const token = process.env.MP_ACCESS_TOKEN;
    const siteUrl = process.env.SITE_URL || event.headers.origin || event.headers.referer?.replace(/\/[^/]*$/, '') || '';

    if (!token) {
      console.error('MP_ACCESS_TOKEN not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Payment service not configured' })
      };
    }

    // Verify user exists in Firebase (optional but recommended)
    try {
      initAdmin();
      const db = admin.firestore();
      const userDoc = await db.collection('usuarios').doc(uid).get();
      if (!userDoc.exists) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'User not found' })
        };
      }
    } catch (fbError) {
      console.warn('Could not verify user in Firebase:', fbError.message);
      // Continue anyway - user verification is optional
    }

    // Build items array
    let items;
    if (body.items && Array.isArray(body.items) && body.items.length > 0) {
      // Use provided items
      items = body.items.map(item => ({
        id: item.id || `item_${Date.now()}`,
        title: item.title,
        description: item.description || '',
        quantity: Number(item.quantity),
        currency_id: 'COP',
        unit_price: Number(item.unit_price)
      }));
    } else {
      // Default single item
      items = [{
        id: `${type}_${Date.now()}`,
        title: description,
        quantity: 1,
        currency_id: 'COP',
        unit_price: amount
      }];
    }

    // Calculate total for metadata
    const totalAmount = items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);

    // Build preference object
    const preference = {
      items,
      external_reference: `${uid}|${type}|${Date.now()}`,
      back_urls: {
        success: `${siteUrl}/oficina-virtual/index.html?payment_status=success`,
        failure: `${siteUrl}/oficina-virtual/index.html?payment_status=failure`,
        pending: `${siteUrl}/oficina-virtual/index.html?payment_status=pending`
      },
      auto_return: 'approved',
      notification_url: `${siteUrl}/.netlify/functions/mercadopago-webhook`,
      statement_descriptor: 'PORKCASARE',
      metadata: {
        uid,
        type,
        created_at: new Date().toISOString(),
        source: 'netlify_function'
      }
    };

    // Add payer info if provided
    if (body.payer) {
      preference.payer = {
        name: body.payer.name || '',
        surname: body.payer.surname || '',
        email: body.payer.email || '',
        phone: body.payer.phone ? {
          area_code: body.payer.phone.area_code || '',
          number: body.payer.phone.number || ''
        } : undefined,
        // IMPORTANT: Identification is required for Colombia payments
        identification: body.payer.identification ? {
          type: body.payer.identification.type || 'CC', // CC = Cédula de Ciudadanía (Colombia)
          number: body.payer.identification.number || ''
        } : undefined
      };
    }

    console.log(`Creating PRODUCTION preference for uid=${uid}, type=${type}, amount=${totalAmount}`);

    // Create preference in MercadoPago
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `${uid}-${type}-${Date.now()}`
      },
      body: JSON.stringify(preference)
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('MercadoPago API error:', data);
      return {
        statusCode: res.status,
        body: JSON.stringify({
          error: 'Error creating payment preference',
          details: data.message || data.error || 'Unknown error'
        })
      };
    }

    // Return the production init_point (not sandbox)
    const initPoint = data.init_point;

    return {
      statusCode: 200,
      body: JSON.stringify({
        init_point: initPoint,
        preference_id: data.id,
        production: true
      })
    };

  } catch (err) {
    console.error('Error in create-preference:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
