// netlify/functions/release-launch-products.js
//
// Scheduled function that runs every minute to automatically release
// launch products when their countdown reaches zero.
//
// This function:
// 1. Queries products where isLaunchProduct is true and launchDate has passed
// 2. Updates those products to disable the launch state
// 3. Keeps the product visible according to its availableFor settings
//

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

exports.handler = async (event, context) => {
  console.log('[release-launch-products] Starting scheduled check...');

  try {
    const now = new Date().toISOString();

    // Query products that are marked as launch products
    const productsSnap = await db.collection('productos')
      .where('isLaunchProduct', '==', true)
      .get();

    if (productsSnap.empty) {
      console.log('[release-launch-products] No launch products found.');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No launch products to process', released: 0 })
      };
    }

    let releasedCount = 0;
    const batch = db.batch();

    productsSnap.forEach(doc => {
      const product = doc.data();

      // Check if launch date has passed
      if (product.launchDate) {
        const launchTime = new Date(product.launchDate).getTime();
        const currentTime = Date.now();

        if (currentTime >= launchTime) {
          console.log(`[release-launch-products] Releasing product: ${product.nombre} (${doc.id})`);

          // Update the product to disable launch state
          batch.update(doc.ref, {
            isLaunchProduct: false,
            launchReleasedAt: now
          });

          releasedCount++;
        } else {
          console.log(`[release-launch-products] Product ${product.nombre} still in countdown, launches at: ${product.launchDate}`);
        }
      }
    });

    if (releasedCount > 0) {
      await batch.commit();
      console.log(`[release-launch-products] Successfully released ${releasedCount} product(s).`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Processed ${productsSnap.size} launch products, released ${releasedCount}`,
        released: releasedCount,
        timestamp: now
      })
    };

  } catch (error) {
    console.error('[release-launch-products] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Schedule configuration - runs every minute
// Note: Schedule only runs on published deploys, not on preview/branch deploys
exports.config = {
  schedule: "* * * * *"
};
