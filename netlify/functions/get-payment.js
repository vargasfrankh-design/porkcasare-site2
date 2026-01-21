/**
 * MercadoPago - Get Payment Status Function
 *
 * Fetches and verifies payment status from MercadoPago.
 * Used for client-side verification after payment redirect.
 *
 * Environment variables:
 * - MP_ACCESS_TOKEN: MercadoPago access token (required)
 * - FIREBASE_ADMIN_SA: Base64-encoded Firebase service account (required)
 */

// Using native fetch available in Node.js 18+
const admin = require('firebase-admin');

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
 * Validate collection_id to prevent injection
 */
function isValidPaymentId(id) {
  if (!id || typeof id !== 'string') return false;
  // MercadoPago payment IDs are numeric
  return /^\d{1,20}$/.test(id.trim());
}

/**
 * Calculate points based on payment amount
 * Uses the same logic as the rest of the system
 */
function calculatePoints(amount) {
  const POINT_VALUE = 2800; // COP per point
  // Base calculation: every 60,000 COP = 10 points
  // Simplified: amount / 6000 gives approximate points
  return Math.floor(amount / 6000);
}

exports.handler = async function(event) {
  // Support both GET (query params) and POST (body)
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get collection_id from body (POST) or query params (GET)
    let collection_id;
    let preferenceId;

    if (event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      collection_id = body.collection_id || body.payment_id;
      preferenceId = body.preference_id;
    } else {
      const params = event.queryStringParameters || {};
      collection_id = params.collection_id || params.payment_id;
      preferenceId = params.preference_id;
    }

    // Validate input
    if (!collection_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'collection_id or payment_id is required' })
      };
    }

    if (!isValidPaymentId(collection_id)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid payment ID format' })
      };
    }

    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      console.error('MP_ACCESS_TOKEN not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Payment service not configured' })
      };
    }

    // Fetch payment from MercadoPago
    console.log(`Fetching payment: ${collection_id}`);
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${collection_id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const errorData = await res.json();
      console.error('MercadoPago API error:', errorData);
      return {
        statusCode: res.status === 404 ? 404 : 500,
        body: JSON.stringify({
          error: res.status === 404 ? 'Payment not found' : 'Error fetching payment',
          details: errorData.message || errorData.error
        })
      };
    }

    const payment = await res.json();

    // Parse external_reference: uid|type|timestamp
    const external = payment.external_reference || '';
    const parts = external.split('|');
    const uid = parts[0] || null;
    const type = parts[1] || 'payment';

    if (!uid) {
      console.warn('Payment has no uid in external_reference');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid payment reference' })
      };
    }

    // Initialize Firebase
    initAdmin();
    const db = admin.firestore();

    const paymentId = String(payment.id);
    const paymentRef = db.collection('payments').doc(paymentId);

    // Check if payment already exists
    const existingPayment = await paymentRef.get();
    const alreadyProcessed = existingPayment.exists && existingPayment.data().pointsCredited;

    if (!existingPayment.exists) {
      // Store new payment record
      await paymentRef.set({
        uid,
        type,
        paymentId,
        amount: payment.transaction_amount || 0,
        netAmount: payment.transaction_details?.net_received_amount || payment.transaction_amount || 0,
        currency: payment.currency_id || 'COP',
        status: payment.status || 'unknown',
        statusDetail: payment.status_detail || null,
        paymentMethod: payment.payment_method_id || null,
        paymentType: payment.payment_type_id || null,
        payer: {
          email: payment.payer?.email || null,
          id: payment.payer?.id || null
        },
        externalReference: external,
        dateApproved: payment.date_approved || null,
        dateCreated: payment.date_created || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: 'get-payment',
        raw: payment
      });
    } else {
      // Update existing payment status
      await paymentRef.update({
        status: payment.status,
        statusDetail: payment.status_detail || null,
        updatedAt: new Date().toISOString()
      });
    }

    // If approved and not already credited, update user points
    if (payment.status === 'approved' && !alreadyProcessed) {
      const userRef = db.collection('usuarios').doc(uid);
      const pointsToAdd = calculatePoints(payment.transaction_amount || 0);
      const now = Date.now();

      try {
        await db.runTransaction(async (t) => {
          const userDoc = await t.get(userRef);

          if (!userDoc.exists) {
            console.warn(`User ${uid} not found`);
            return;
          }

          // Update user points
          t.update(userRef, {
            puntos: admin.firestore.FieldValue.increment(pointsToAdd),
            personalPoints: admin.firestore.FieldValue.increment(pointsToAdd),
            history: admin.firestore.FieldValue.arrayUnion({
              action: `Pago aprobado - ${type}`,
              amount: payment.transaction_amount,
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
      } catch (txError) {
        console.error('Transaction error:', txError);
        // Don't fail the whole request - payment is already recorded
      }
    }

    // Return sanitized response (don't expose raw data)
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        payment: {
          id: payment.id,
          status: payment.status,
          statusDetail: payment.status_detail,
          amount: payment.transaction_amount,
          currency: payment.currency_id,
          paymentMethod: payment.payment_method_id,
          dateApproved: payment.date_approved,
          alreadyProcessed
        }
      })
    };

  } catch (err) {
    console.error('Error in get-payment:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
