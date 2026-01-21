/**
 * MercadoPago Client-Side Utilities
 *
 * This module provides helper functions for integrating MercadoPago
 * payment flow on the frontend.
 *
 * Usage:
 *   import { createPayment, verifyPayment, handlePaymentReturn } from '/src/mercadopago-client.js';
 *
 *   // Create a new payment
 *   const result = await createPayment({
 *     uid: user.uid,
 *     amount: 60000,
 *     type: 'recompra'
 *   });
 *
 *   // Or with multiple items
 *   const result = await createPayment({
 *     uid: user.uid,
 *     items: [
 *       { title: 'Producto 1', quantity: 2, unit_price: 30000 },
 *       { title: 'Producto 2', quantity: 1, unit_price: 45000 }
 *     ],
 *     type: 'compra'
 *   });
 *
 *   // Handle payment return (call on page load)
 *   handlePaymentReturn({
 *     onSuccess: (payment) => console.log('Pago aprobado', payment),
 *     onPending: (payment) => console.log('Pago pendiente', payment),
 *     onFailure: (error) => console.log('Pago fallido', error)
 *   });
 */

// API endpoints
const ENDPOINTS = {
  createPreference: '/.netlify/functions/create-preference',
  getPayment: '/.netlify/functions/get-payment'
};

/**
 * Create a MercadoPago payment preference
 *
 * @param {Object} options - Payment options
 * @param {string} options.uid - User ID (required)
 * @param {number} [options.amount] - Payment amount in COP (required if no items)
 * @param {string} [options.type='recompra'] - Payment type
 * @param {string} [options.description] - Payment description
 * @param {Array} [options.items] - Array of items (optional, overrides amount)
 * @param {Object} [options.payer] - Payer information (optional)
 * @returns {Promise<Object>} - { init_point, preference_id, production }
 */
export async function createPayment(options) {
  if (!options || !options.uid) {
    throw new Error('uid is required');
  }

  if (!options.amount && (!options.items || options.items.length === 0)) {
    throw new Error('Either amount or items is required');
  }

  try {
    const response = await fetch(ENDPOINTS.createPreference, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        uid: options.uid,
        amount: options.amount,
        type: options.type || 'recompra',
        description: options.description,
        items: options.items,
        payer: options.payer
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.details || 'Error creating payment');
    }

    return data;
  } catch (error) {
    console.error('Error creating payment preference:', error);
    throw error;
  }
}

/**
 * Create payment and redirect to MercadoPago checkout
 *
 * @param {Object} options - Same as createPayment
 * @returns {Promise<void>}
 */
export async function redirectToPayment(options) {
  const data = await createPayment(options);

  if (data && data.init_point) {
    window.location.href = data.init_point;
  } else {
    throw new Error('No init_point received from server');
  }
}

/**
 * Verify a payment status by collection_id
 *
 * @param {string} collectionId - MercadoPago collection_id
 * @returns {Promise<Object>} - Payment details
 */
export async function verifyPayment(collectionId) {
  if (!collectionId) {
    throw new Error('collection_id is required');
  }

  try {
    const response = await fetch(ENDPOINTS.getPayment, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ collection_id: collectionId })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Error verifying payment');
    }

    return data;
  } catch (error) {
    console.error('Error verifying payment:', error);
    throw error;
  }
}

/**
 * Get payment status from URL query parameters
 * MercadoPago redirects with these params after payment
 *
 * @returns {Object|null} - Payment params or null if not a payment return
 */
export function getPaymentParams() {
  const params = new URLSearchParams(window.location.search);

  // Check for MercadoPago return parameters
  const collectionId = params.get('collection_id');
  const collectionStatus = params.get('collection_status');
  const paymentId = params.get('payment_id');
  const status = params.get('status');
  const paymentStatus = params.get('payment_status');
  const externalReference = params.get('external_reference');
  const preferenceId = params.get('preference_id');

  // If no relevant params, return null
  if (!collectionId && !paymentId && !paymentStatus) {
    return null;
  }

  return {
    collectionId: collectionId || paymentId,
    status: collectionStatus || status || paymentStatus,
    externalReference,
    preferenceId,
    raw: Object.fromEntries(params.entries())
  };
}

/**
 * Handle payment return from MercadoPago
 * Call this function on page load to handle payment callbacks
 *
 * @param {Object} callbacks - Callback functions
 * @param {Function} [callbacks.onSuccess] - Called on approved payment
 * @param {Function} [callbacks.onPending] - Called on pending payment
 * @param {Function} [callbacks.onFailure] - Called on failed/rejected payment
 * @param {boolean} [callbacks.clearParams=true] - Clear URL params after handling
 * @returns {Promise<Object|null>} - Payment result or null if not a payment return
 */
export async function handlePaymentReturn(callbacks = {}) {
  const params = getPaymentParams();

  if (!params) {
    return null;
  }

  const { onSuccess, onPending, onFailure, clearParams = true } = callbacks;

  try {
    // If we have a collection_id, verify the payment
    if (params.collectionId) {
      const result = await verifyPayment(params.collectionId);

      // Clear URL params if requested
      if (clearParams) {
        const url = new URL(window.location.href);
        url.search = '';
        window.history.replaceState({}, document.title, url.toString());
      }

      const payment = result.payment || result;
      const paymentStatus = payment.status || params.status;

      // Call appropriate callback based on status
      switch (paymentStatus) {
        case 'approved':
        case 'success':
          if (onSuccess) onSuccess(payment);
          break;
        case 'pending':
        case 'in_process':
        case 'in_mediation':
          if (onPending) onPending(payment);
          break;
        case 'rejected':
        case 'cancelled':
        case 'refunded':
        case 'charged_back':
        case 'failure':
          if (onFailure) onFailure(payment);
          break;
        default:
          console.warn('Unknown payment status:', paymentStatus);
          if (onPending) onPending(payment);
      }

      return { params, payment, verified: true };
    }

    // If we only have status from query params
    if (clearParams) {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, document.title, url.toString());
    }

    const status = params.status;
    if (status === 'success' || status === 'approved') {
      if (onSuccess) onSuccess({ status });
    } else if (status === 'pending') {
      if (onPending) onPending({ status });
    } else if (status === 'failure' || status === 'rejected') {
      if (onFailure) onFailure({ status });
    }

    return { params, verified: false };

  } catch (error) {
    console.error('Error handling payment return:', error);
    if (onFailure) onFailure({ error: error.message, params });
    return { params, error, verified: false };
  }
}

/**
 * Format currency for display
 *
 * @param {number} amount - Amount in COP
 * @param {string} [currency='COP'] - Currency code
 * @returns {string} - Formatted currency string
 */
export function formatCurrency(amount, currency = 'COP') {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

/**
 * Payment status messages in Spanish
 */
export const PAYMENT_STATUS_MESSAGES = {
  approved: 'Pago aprobado',
  pending: 'Pago pendiente',
  authorized: 'Pago autorizado',
  in_process: 'Pago en proceso',
  in_mediation: 'Pago en mediación',
  rejected: 'Pago rechazado',
  cancelled: 'Pago cancelado',
  refunded: 'Pago devuelto',
  charged_back: 'Contracargo aplicado'
};

/**
 * Get human-readable status message
 *
 * @param {string} status - Payment status code
 * @returns {string} - Human-readable message
 */
export function getStatusMessage(status) {
  return PAYMENT_STATUS_MESSAGES[status] || `Estado: ${status}`;
}

// Default export with all functions
export default {
  createPayment,
  redirectToPayment,
  verifyPayment,
  getPaymentParams,
  handlePaymentReturn,
  formatCurrency,
  getStatusMessage,
  PAYMENT_STATUS_MESSAGES
};
