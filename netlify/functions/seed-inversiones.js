// netlify/functions/seed-inversiones.js
//
// One-time function to seed initial investment data into Firestore.
// Call via GET/POST to /.netlify/functions/seed-inversiones
// It checks if inversiones already exist before inserting.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

const INITIAL_INVERSIONES = [
  {
    nombre: 'KPC Capital',
    descripcion: 'Línea de inversión externa enfocada en capital digital y diversificación de ingresos.',
    estado: 'Activo',
    icono: '💰',
    imagen: '',
    linkInfo: '',
    activo: true,
    deleted: false,
    thumbnailColor: 'linear-gradient(135deg, #1a237e 0%, #0d47a1 100%)'
  },
  {
    nombre: 'Ganadería Futura',
    descripcion: 'Proyecto enfocado en crecimiento y proyección de ganado en ciclos productivos.',
    estado: 'Próximamente',
    icono: '🐄',
    imagen: '',
    linkInfo: '',
    activo: true,
    deleted: false,
    thumbnailColor: 'linear-gradient(135deg, #2e7d32 0%, #66bb6a 100%)'
  },
  {
    nombre: 'Siembra KPC',
    descripcion: 'Iniciativa agrícola orientada a producción y desarrollo del campo.',
    estado: 'Próximamente',
    icono: '🌱',
    imagen: '',
    linkInfo: '',
    activo: true,
    deleted: false,
    thumbnailColor: 'linear-gradient(135deg, #33691e 0%, #8bc34a 100%)'
  },
  {
    nombre: 'Agro Expansión',
    descripcion: 'Proyecto de expansión en el sector agro con enfoque en escalabilidad.',
    estado: 'En revisión',
    icono: '🌾',
    imagen: '',
    linkInfo: '',
    activo: true,
    deleted: false,
    thumbnailColor: 'linear-gradient(135deg, #e65100 0%, #ff9800 100%)'
  }
];

exports.handler = async (event) => {
  try {
    // Check if inversiones collection already has data
    const existingSnap = await db.collection('inversiones').limit(1).get();

    if (!existingSnap.empty) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Inversiones ya existen. No se insertaron duplicados.',
          count: 0
        })
      };
    }

    // Seed the initial inversiones
    const batch = db.batch();
    const now = new Date().toISOString();

    INITIAL_INVERSIONES.forEach(inv => {
      const ref = db.collection('inversiones').doc();
      batch.set(ref, {
        ...inv,
        createdAt: now,
        updatedAt: now
      });
    });

    await batch.commit();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Inversiones iniciales creadas exitosamente.',
        count: INITIAL_INVERSIONES.length
      })
    };
  } catch (err) {
    console.error('Error seeding inversiones:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
