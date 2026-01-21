/**
 * MercadoPago - Webhook Handler Function
 *
 * Receives and processes IPN (Instant Payment Notifications) from MercadoPago.
 * This function handles payment status updates asynchronously.
 *
 * Environment variables:
 * - MP_ACCESS_TOKEN: MercadoPago access token (required)
 * - FIREBASE_ADMIN_SA: Base64-encoded Firebase service account (required)
 * - MP_WEBHOOK_SECRET: Webhook signature secret (optional, for signature verification)
 */

// Using native fetch available in Node.js 18+
const crypto = require('crypto');
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

/**
 * Verify MercadoPago webhook signature
 * @param {string} xSignature - X-Signature header from MercadoPago
 * @param {string} xRequestId - X-Request-Id header
 * @param {string} dataId - data.id from query params
 * @returns {boolean} - Whether signature is valid
 */
function verifySignature(xSignature, xRequestId, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;

  // If no secret configured, skip verification (not recommended for production)
  if (!secret) {
    console.warn('MP_WEBHOOK_SECRET not configured - skipping signature verification');
    return true;
  }

  if (!xSignature) {
    console.error('Missing X-Signature header');
    return false;
  }

  // Parse the x-signature header
  const parts = {};
  xSignature.split(',').forEach(part => {
    const [key, value] = part.split('=');
    if (key && value) {
      parts[key.trim()] = value.trim();
    }
  });

  const ts = parts['ts'];
  const v1 = parts['v1'];

  if (!ts || !v1) {
    console.error('Invalid X-Signature format');
    return false;
  }

  // Build the manifest for HMAC
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  // Calculate HMAC
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');

  // Secure comparison
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
}

/**
 * Fetch payment details from MercadoPago API
 */
async function fetchPayment(paymentId, token) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`MercadoPago API error: ${error.message || res.statusText}`);
  }

  return res.json();
}

/**
 * Process payment and update Firestore
 */
async function processPayment(payment, db) {
  // Parse external_reference: uid|type|timestamp
  const external = payment.external_reference || '';
  const parts = external.split('|');
  const uid = parts[0] || null;
  const type = parts[1] || 'payment';
  const timestamp = parts[2] || null;

  if (!uid) {
    console.warn('Payment has no uid in external_reference:', payment.id);
    return { processed: false, reason: 'no_uid' };
  }

  const paymentId = String(payment.id);
  const paymentRef = db.collection('payments').doc(paymentId);

  // Check if payment already processed
  const existingPayment = await paymentRef.get();
  if (existingPayment.exists) {
    const existingData = existingPayment.data();
    if (existingData.status === payment.status) {
      console.log(`Payment ${paymentId} already processed with status ${payment.status}`);
      return { processed: false, reason: 'already_processed' };
    }
    // Status changed - update it
    console.log(`Payment ${paymentId} status changed: ${existingData.status} -> ${payment.status}`);
  }

  // Store/update payment record
  const paymentData = {
    uid,
    type,
    paymentId,
    preferenceId: payment.collector_id || null,
    amount: payment.transaction_amount || 0,
    netAmount: payment.transaction_details?.net_received_amount || payment.transaction_amount || 0,
    currency: payment.currency_id || 'COP',
    status: payment.status || 'unknown',
    statusDetail: payment.status_detail || null,
    paymentMethod: payment.payment_method_id || null,
    paymentType: payment.payment_type_id || null,
    installments: payment.installments || 1,
    payer: {
      id: payment.payer?.id || null,
      email: payment.payer?.email || null,
      firstName: payment.payer?.first_name || null,
      lastName: payment.payer?.last_name || null
    },
    metadata: payment.metadata || {},
    externalReference: external,
    dateApproved: payment.date_approved || null,
    dateCreated: payment.date_created || null,
    updatedAt: new Date().toISOString(),
    raw: payment
  };

  // Use set with merge to handle both new and updated payments
  await paymentRef.set(paymentData, { merge: true });

  // If not already existing, set createdAt
  if (!existingPayment.exists) {
    await paymentRef.update({
      createdAt: new Date().toISOString()
    });
  }

  // Process based on payment status
  if (payment.status === 'approved') {
    await handleApprovedPayment(uid, payment, db, paymentRef);
  } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
    await handleFailedPayment(uid, payment, db, paymentRef);
  } else if (payment.status === 'pending' || payment.status === 'in_process') {
    console.log(`Payment ${paymentId} is pending: ${payment.status_detail}`);
  }

  return { processed: true, status: payment.status };
}

/**
 * Handle approved payment - update user points/balance
 */
async function handleApprovedPayment(uid, payment, db, paymentRef) {
  const paymentId = String(payment.id);
  const amount = payment.transaction_amount || 0;

  // Check if points already credited
  const paymentDoc = await paymentRef.get();
  if (paymentDoc.exists && paymentDoc.data().pointsCredited) {
    console.log(`Points already credited for payment ${paymentId}`);
    return;
  }

  // Calculate points based on payment amount
  // Formula: 10 points per 60,000 COP (based on existing logic)
  const POINT_VALUE = 2800; // COP per point
  const pointsToAdd = Math.floor(amount / 6000); // Simplified: ~1 point per 6000 COP

  const userRef = db.collection('usuarios').doc(uid);
  const now = Date.now();

  try {
    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);

      if (!userDoc.exists) {
        console.warn(`User ${uid} not found when crediting payment ${paymentId}`);
        return;
      }

      const userData = userDoc.data();
      const currentPoints = Number(userData.puntos || userData.personalPoints || 0);

      // Update user points and balance
      t.update(userRef, {
        puntos: admin.firestore.FieldValue.increment(pointsToAdd),
        personalPoints: admin.firestore.FieldValue.increment(pointsToAdd),
        history: admin.firestore.FieldValue.arrayUnion({
          action: `Pago aprobado via MercadoPago - ${payment.payment_type_id || 'card'}`,
          amount: amount,
          points: pointsToAdd,
          paymentId: paymentId,
          date: new Date().toISOString(),
          timestamp: now,
          type: 'payment_approved'
        })
      });

      // Mark payment as credited
      t.update(paymentRef, {
        pointsCredited: true,
        pointsCreditedAt: new Date().toISOString(),
        pointsAmount: pointsToAdd
      });
    });

    console.log(`Credited ${pointsToAdd} points to user ${uid} for payment ${paymentId}`);
  } catch (error) {
    console.error(`Error crediting points for payment ${paymentId}:`, error);
    throw error;
  }
}

/**
 * Handle failed/cancelled payment
 */
async function handleFailedPayment(uid, payment, db, paymentRef) {
  const paymentId = String(payment.id);
  const userRef = db.collection('usuarios').doc(uid);
  const now = Date.now();

  try {
    const userDoc = await userRef.get();
    if (userDoc.exists) {
      await userRef.update({
        history: admin.firestore.FieldValue.arrayUnion({
          action: `Pago ${payment.status}: ${payment.status_detail || 'sin detalle'}`,
          paymentId: paymentId,
          date: new Date().toISOString(),
          timestamp: now,
          type: 'payment_failed'
        })
      });
    }
    console.log(`Recorded failed payment ${paymentId} for user ${uid}`);
  } catch (error) {
    console.error(`Error recording failed payment ${paymentId}:`, error);
  }
}

exports.handler = async function(event) {
  // MercadoPago webhooks use POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get headers for signature verification
    const xSignature = event.headers['x-signature'];
    const xRequestId = event.headers['x-request-id'];

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const dataId = queryParams['data.id'] || queryParams.id;
    const topic = queryParams.type || queryParams.topic;

    // Parse body
    const body = event.body ? JSON.parse(event.body) : {};

    console.log('Webhook received:', {
      topic: topic || body.type,
      dataId: dataId || body.data?.id,
      action: body.action
    });

    // We only process payment notifications
    const notificationType = topic || body.type;
    if (notificationType !== 'payment' && notificationType !== 'merchant_order') {
      console.log(`Ignoring notification type: ${notificationType}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, processed: false, reason: 'not_payment' })
      };
    }

    // Verify signature (if secret is configured)
    const paymentIdFromNotification = dataId || body.data?.id;
    if (!verifySignature(xSignature, xRequestId, paymentIdFromNotification)) {
      console.error('Invalid webhook signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    // Get access token
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      console.error('MP_ACCESS_TOKEN not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Payment service not configured' })
      };
    }

    // Initialize Firebase
    initAdmin();
    const db = admin.firestore();

    // Get payment ID
    let paymentId;
    if (notificationType === 'payment') {
      paymentId = paymentIdFromNotification;
    } else if (notificationType === 'merchant_order' && paymentIdFromNotification) {
      // For merchant_order, we need to fetch the order to get payment IDs
      const orderRes = await fetch(`https://api.mercadopago.com/merchant_orders/${paymentIdFromNotification}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!orderRes.ok) {
        console.error('Error fetching merchant order');
        return { statusCode: 200, body: JSON.stringify({ received: true, processed: false }) };
      }

      const order = await orderRes.json();
      if (order.payments && order.payments.length > 0) {
        // Get the most recent payment
        paymentId = order.payments[order.payments.length - 1].id;
      }
    }

    if (!paymentId) {
      console.error('No payment ID found in notification');
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, processed: false, reason: 'no_payment_id' })
      };
    }

    // Fetch full payment details from MercadoPago
    const payment = await fetchPayment(paymentId, token);
    console.log(`Processing payment ${paymentId}: status=${payment.status}, amount=${payment.transaction_amount}`);

    // Process the payment
    const result = await processPayment(payment, db);

    return {
      statusCode: 200,
      body: JSON.stringify({
        received: true,
        processed: result.processed,
        paymentId,
        status: result.status || result.reason
      })
    };

  } catch (err) {
    console.error('Webhook error:', err);

    // Always return 200 to prevent MercadoPago from retrying indefinitely
    // Log the error for debugging
    return {
      statusCode: 200,
      body: JSON.stringify({
        received: true,
        processed: false,
        error: err.message
      })
    };
  }
};
