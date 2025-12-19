// netlify/functions/purge-inactive-commissions.js
//
// PURGA MANUAL DE COMISIONES DE USUARIOS INACTIVOS
//
// Esta función se ejecuta manualmente desde el panel de administración
// el primer día de cada mes para eliminar las comisiones del mes anterior
// de usuarios que no se activaron (no realizaron compras personales).
//
// PROCESO:
// 1. Obtiene todos los distribuidores
// 2. Para cada distribuidor, verifica si realizó compras en el mes anterior
// 3. Si no realizó compras, elimina sus comisiones (ganancias) del mes anterior:
//    - Reduce el balance
//    - Reduce los groupPoints correspondientes
//    - Registra las comisiones eliminadas en la colección 'commissionsPurged'
// 4. Genera un reporte detallado para el panel de administración
//
// NOTA: Esta función debe ser ejecutada MANUALMENTE por el administrador
// todos los primeros de cada mes desde la sección de Ganancias en Administración.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();
const POINT_VALUE = 2800;

// Helper function to get date ranges for the previous month
function getPreviousMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // Current month (0-11)

  // Previous month
  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth < 0) {
    prevMonth = 11;
    prevYear = year - 1;
  }

  // Start and end of previous month
  const startOfPrevMonth = new Date(prevYear, prevMonth, 1, 0, 0, 0, 0);
  const endOfPrevMonth = new Date(year, month, 1, 0, 0, 0, 0); // First day of current month = end of previous

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  return {
    startMs: startOfPrevMonth.getTime(),
    endMs: endOfPrevMonth.getTime(),
    monthName: monthNames[prevMonth],
    monthNumber: prevMonth + 1,
    year: prevYear
  };
}

// Check if user made a purchase in the specified date range
function checkPurchaseInRange(historyArray, startMs, endMs) {
  if (!Array.isArray(historyArray)) return false;

  for (const entry of historyArray) {
    const entryType = entry.type || '';
    const isPurchase = entryType === 'purchase' ||
                       (entry.orderId && entry.action && entry.action.includes('Compra')) ||
                       (entry.meta && entry.meta.action && entry.meta.action.includes('compra'));

    if (!isPurchase) continue;

    // Get entry timestamp
    let entryTs = null;
    if (entry.timestamp) {
      if (typeof entry.timestamp === 'number') {
        entryTs = entry.timestamp;
      } else if (entry.timestamp && typeof entry.timestamp.toDate === 'function') {
        entryTs = entry.timestamp.toDate().getTime();
      } else if (entry.timestamp && typeof entry.timestamp.seconds === 'number') {
        entryTs = entry.timestamp.seconds * 1000;
      } else if (typeof entry.timestamp === 'string') {
        entryTs = new Date(entry.timestamp).getTime();
      }
    } else if (entry.date) {
      entryTs = new Date(entry.date).getTime();
    } else if (entry.originMs) {
      entryTs = Number(entry.originMs);
    }

    if (!entryTs || isNaN(entryTs)) continue;

    // Check if purchase is within range
    if (entryTs >= startMs && entryTs < endMs) {
      return true;
    }
  }

  return false;
}

// Calculate commissions earned in the specified date range
function calculateCommissionsInRange(historyArray, startMs, endMs) {
  const commissions = [];
  let totalAmount = 0;
  let totalPoints = 0;

  if (!Array.isArray(historyArray)) return { commissions, totalAmount, totalPoints };

  for (const entry of historyArray) {
    const entryType = entry.type || '';
    const isEarning = entryType === 'earning' ||
                      entryType === 'group_points' ||
                      entryType === 'quick_start_bonus' ||
                      entryType === 'quick_start_upper_level' ||
                      entryType === 'restaurant_commission' ||
                      entryType === 'client_price_difference';

    if (!isEarning) continue;

    // Get entry timestamp
    let entryTs = null;
    if (entry.timestamp) {
      if (typeof entry.timestamp === 'number') {
        entryTs = entry.timestamp;
      } else if (entry.timestamp && typeof entry.timestamp.toDate === 'function') {
        entryTs = entry.timestamp.toDate().getTime();
      } else if (entry.timestamp && typeof entry.timestamp.seconds === 'number') {
        entryTs = entry.timestamp.seconds * 1000;
      } else if (typeof entry.timestamp === 'string') {
        entryTs = new Date(entry.timestamp).getTime();
      }
    } else if (entry.date) {
      entryTs = new Date(entry.date).getTime();
    } else if (entry.originMs) {
      entryTs = Number(entry.originMs);
    }

    if (!entryTs || isNaN(entryTs)) continue;

    // Check if earning is within range
    if (entryTs >= startMs && entryTs < endMs) {
      const amount = Number(entry.amount || 0);
      const points = Number(entry.points || 0);

      commissions.push({
        ...entry,
        timestamp: entryTs
      });

      totalAmount += amount;
      totalPoints += points;
    }
  }

  return { commissions, totalAmount, totalPoints };
}

exports.handler = async (req) => {
  console.log('🧹 Iniciando purga de comisiones de usuarios inactivos...');

  try {
    const { startMs, endMs, monthName, monthNumber, year } = getPreviousMonthRange();
    console.log(`📅 Verificando actividad del mes: ${monthName} ${year}`);
    console.log(`   Rango: ${new Date(startMs).toISOString()} - ${new Date(endMs).toISOString()}`);

    // Get all distributors
    const usersSnap = await db.collection('usuarios')
      .where('tipoRegistro', '==', 'distribuidor')
      .get();

    console.log(`👥 Total distribuidores encontrados: ${usersSnap.size}`);

    const purgeReport = {
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      month: monthNumber,
      monthName: monthName,
      year: year,
      totalDistributors: usersSnap.size,
      activeDistributors: 0,
      inactiveDistributors: 0,
      totalPurgedAmount: 0,
      totalPurgedPoints: 0,
      purgedUsers: []
    };

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      const username = userData.usuario || userData.username || 'Sin nombre';
      const historyArray = userData.history || [];

      // Check if user made a purchase in the previous month
      const wasActive = checkPurchaseInRange(historyArray, startMs, endMs);

      if (wasActive) {
        purgeReport.activeDistributors++;
        console.log(`✅ ${username}: ACTIVO (hizo compras en ${monthName})`);
        continue;
      }

      // User was inactive - calculate commissions to purge
      const { commissions, totalAmount, totalPoints } = calculateCommissionsInRange(historyArray, startMs, endMs);

      if (commissions.length === 0) {
        purgeReport.inactiveDistributors++;
        console.log(`⚠️ ${username}: INACTIVO pero sin comisiones en ${monthName}`);
        continue;
      }

      purgeReport.inactiveDistributors++;
      console.log(`🗑️ ${username}: INACTIVO - Purgando ${totalAmount.toLocaleString()} COP (${totalPoints.toFixed(2)} puntos)`);

      // Update user document to remove commissions
      const userRef = db.collection('usuarios').doc(userId);
      const currentBalance = Number(userData.balance || 0);
      const currentGroupPoints = Number(userData.groupPoints || userData.puntosGrupales || 0);

      const newBalance = Math.max(0, currentBalance - totalAmount);
      const newGroupPoints = Math.max(0, currentGroupPoints - totalPoints);

      // Create purge entry for history
      const purgeEntry = {
        type: 'commission_purge',
        action: `Comisiones de ${monthName} ${year} eliminadas por inactividad`,
        amount: -totalAmount,
        points: -totalPoints,
        timestamp: Date.now(),
        originMs: Date.now(),
        date: new Date().toISOString(),
        purgedCommissionsCount: commissions.length,
        month: monthNumber,
        year: year,
        by: 'admin_manual'
      };

      await userRef.update({
        balance: newBalance,
        groupPoints: newGroupPoints,
        history: admin.firestore.FieldValue.arrayUnion(purgeEntry)
      });

      // Record purged user for report
      const purgedUserRecord = {
        userId: userId,
        username: username,
        email: userData.email || '',
        phone: userData.telefono || userData.phone || '',
        purgedAmount: totalAmount,
        purgedPoints: totalPoints,
        commissionsCount: commissions.length,
        previousBalance: currentBalance,
        newBalance: newBalance,
        previousGroupPoints: currentGroupPoints,
        newGroupPoints: newGroupPoints,
        purgedCommissions: commissions.map(c => ({
          type: c.type,
          action: c.action,
          amount: c.amount,
          points: c.points,
          date: new Date(c.timestamp).toISOString(),
          orderId: c.orderId || null,
          fromUser: c.fromUser || null
        }))
      };

      purgeReport.purgedUsers.push(purgedUserRecord);
      purgeReport.totalPurgedAmount += totalAmount;
      purgeReport.totalPurgedPoints += totalPoints;

      console.log(`   ✅ Balance actualizado: ${currentBalance.toLocaleString()} → ${newBalance.toLocaleString()} COP`);
      console.log(`   ✅ Puntos grupales actualizados: ${currentGroupPoints.toFixed(2)} → ${newGroupPoints.toFixed(2)}`);
    }

    // Save the purge report to Firestore
    await db.collection('commissionsPurged').add(purgeReport);

    console.log('');
    console.log('📊 ============ RESUMEN DE PURGA ============');
    console.log(`   Mes procesado: ${monthName} ${year}`);
    console.log(`   Total distribuidores: ${purgeReport.totalDistributors}`);
    console.log(`   Distribuidores activos: ${purgeReport.activeDistributors}`);
    console.log(`   Distribuidores inactivos: ${purgeReport.inactiveDistributors}`);
    console.log(`   Usuarios purgados: ${purgeReport.purgedUsers.length}`);
    console.log(`   Total purgado: ${purgeReport.totalPurgedAmount.toLocaleString()} COP`);
    console.log(`   Puntos purgados: ${purgeReport.totalPurgedPoints.toFixed(2)}`);
    console.log('==============================================');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Purga completada para ${monthName} ${year}`,
        summary: {
          totalDistributors: purgeReport.totalDistributors,
          activeDistributors: purgeReport.activeDistributors,
          inactiveDistributors: purgeReport.inactiveDistributors,
          purgedUsers: purgeReport.purgedUsers.length,
          totalPurgedAmount: purgeReport.totalPurgedAmount,
          totalPurgedPoints: purgeReport.totalPurgedPoints
        }
      })
    };

  } catch (error) {
    console.error('❌ Error en purga de comisiones:', error);
    console.error('  Error name:', error.name);
    console.error('  Error message:', error.message);
    console.error('  Error stack:', error.stack);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
