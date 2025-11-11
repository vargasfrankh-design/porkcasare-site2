// Diagnostic function to check environment and dependencies
exports.handler = async (event) => {
  const diagnostics = {
    nodeVersion: process.version,
    envVarsPresent: {
      FIREBASE_ADMIN_SA: !!process.env.FIREBASE_ADMIN_SA,
      FIREBASE_ADMIN_SA_LENGTH: process.env.FIREBASE_ADMIN_SA ? process.env.FIREBASE_ADMIN_SA.length : 0
    },
    dependencies: {},
    errors: []
  };

  // Check firebase-admin
  try {
    const admin = require('firebase-admin');
    diagnostics.dependencies['firebase-admin'] = 'loaded successfully';
    
    // Check if we can parse the service account
    if (process.env.FIREBASE_ADMIN_SA) {
      try {
        const saJson = JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_SA, 'base64').toString('utf8'));
        diagnostics.serviceAccount = {
          parsed: true,
          projectId: saJson.project_id || 'not found',
          hasPrivateKey: !!saJson.private_key
        };
      } catch (e) {
        diagnostics.errors.push(`Service account parse error: ${e.message}`);
      }
    }
  } catch (e) {
    diagnostics.dependencies['firebase-admin'] = `error: ${e.message}`;
    diagnostics.errors.push(`firebase-admin load error: ${e.message}`);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diagnostics, null, 2)
  };
};
