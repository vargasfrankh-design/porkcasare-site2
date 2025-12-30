// netlify/functions/purge-inactive-commissions.js
//
// PURGA MANUAL DE COMISIONES DE USUARIOS INACTIVOS
//
// Esta función se ejecuta manualmente desde el panel de administración.
// El administrador selecciona el mes y año específico que desea consultar
// mediante los selectores en la pestaña de Ganancias.
//
// IMPORTANTE: El reporte se genera EXCLUSIVAMENTE para el mes/año seleccionado
// por el administrador. No se genera automáticamente para otros periodos.
//
// REGLA DE ACTIVACIÓN:
// Un usuario está ACTIVO en el mes únicamente cuando acumula 10 o más
// puntos personales dentro del mismo mes calendario. Si tiene menos de
// 10 puntos, permanece INACTIVO y pierde sus comisiones del mes.
//
// PROCESO:
// 1. Recibe mes/año seleccionado por el administrador
// 2. Obtiene todos los distribuidores
// 3. Para cada distribuidor, calcula los puntos personales acumulados en el mes seleccionado
// 4. Si acumuló menos de 10 puntos, elimina sus comisiones (ganancias) del mes seleccionado:
//    - Reduce el balance
//    - Reduce los groupPoints correspondientes
//    - Registra las comisiones eliminadas en la colección 'commissionsPurged'
// 5. Genera un reporte detallado para el panel de administración
//
// NOTA: Esta función debe ser ejecutada MANUALMENTE por el administrador
// desde la sección de Ganancias en Administración, seleccionando primero
// el mes y año que desea consultar/purgar.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();
const POINT_VALUE = 2800;
const MONTHLY_ACTIVATION_POINTS_THRESHOLD = 10; // Umbral de puntos para activación mensual
const BATCH_SIZE = 100; // Tamaño del lote para paginación

// Helper function to get date ranges for a specific month (passed from admin)
// If month/year not provided, defaults to previous month for backward compatibility
function getMonthRange(requestedMonth, requestedYear) {
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  let targetMonth, targetYear;

  // If month and year are explicitly provided, use them
  if (typeof requestedMonth === 'number' && typeof requestedYear === 'number') {
    targetMonth = requestedMonth; // 0-11
    targetYear = requestedYear;
  } else {
    // Fallback to previous month for backward compatibility
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // Current month (0-11)

    targetMonth = month - 1;
    targetYear = year;
    if (targetMonth < 0) {
      targetMonth = 11;
      targetYear = year - 1;
    }
  }

  // Start and end of the target month
  const startOfMonth = new Date(targetYear, targetMonth, 1, 0, 0, 0, 0);
  const endOfMonth = new Date(targetYear, targetMonth + 1, 1, 0, 0, 0, 0); // First day of next month = end of target

  return {
    startMs: startOfMonth.getTime(),
    endMs: endOfMonth.getTime(),
    monthName: monthNames[targetMonth],
    monthNumber: targetMonth + 1,
    year: targetYear
  };
}

// Check if user accumulated enough personal points in the specified date range
// A user is considered ACTIVE if they accumulated 10+ personal points in the month
function checkActiveInRange(historyArray, startMs, endMs) {
  if (!Array.isArray(historyArray)) return { isActive: false, totalPoints: 0 };

  let totalPoints = 0;

  for (const entry of historyArray) {
    const entryType = entry.type || '';
    const action = (entry.action || '').toLowerCase();
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
      // Sum points from this purchase
      const points = Number(entry.points || entry.puntos || 0);
      totalPoints += points;
    }
  }

  // User is active only if accumulated 10+ points in the month
  return {
    isActive: totalPoints >= MONTHLY_ACTIVATION_POINTS_THRESHOLD,
    totalPoints: totalPoints
  };
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
  // Parse request body to check for mode
  let body = {};
  try {
    if (req.body) {
      body = JSON.parse(req.body);
    }
  } catch (e) {
    // Body might be empty or not JSON
  }

  const isPreviewMode = body.mode === 'preview';
  const adminUserId = body.adminUserId || null;
  const adminEmail = body.adminEmail || null;
  // Get month and year from request body (admin-selected values)
  const requestedMonth = typeof body.month === 'number' ? body.month : null;
  const requestedYear = typeof body.year === 'number' ? body.year : null;

  console.log(`🧹 ${isPreviewMode ? 'VISTA PREVIA' : 'EJECUTANDO'} purga de comisiones de usuarios inactivos...`);
  if (requestedMonth !== null && requestedYear !== null) {
    console.log(`📆 Mes/Año seleccionado por admin: ${requestedMonth + 1}/${requestedYear}`);
  }

  try {
    // Use the month/year selected by admin, or fallback to previous month
    const { startMs, endMs, monthName, monthNumber, year } = getMonthRange(requestedMonth, requestedYear);
    console.log(`📅 Verificando actividad del mes: ${monthName} ${year}`);
    console.log(`   Rango: ${new Date(startMs).toISOString()} - ${new Date(endMs).toISOString()}`);

    // Get all distributors using pagination to reduce memory usage and avoid timeouts
    // Paginación: procesar en lotes de BATCH_SIZE documentos
    let lastDoc = null;
    let totalDistributors = 0;
    const allUserDocs = [];

    console.log(`📥 Cargando distribuidores en lotes de ${BATCH_SIZE}...`);

    do {
      let distributorsQuery = db.collection('usuarios')
        .where('tipoRegistro', '==', 'distribuidor')
        .orderBy('__name__')
        .limit(BATCH_SIZE);

      if (lastDoc) {
        distributorsQuery = distributorsQuery.startAfter(lastDoc);
      }

      const batchSnap = await distributorsQuery.get();

      if (batchSnap.empty) {
        break;
      }

      batchSnap.docs.forEach(doc => allUserDocs.push(doc));
      lastDoc = batchSnap.docs[batchSnap.docs.length - 1];
      totalDistributors += batchSnap.size;

      console.log(`   📦 Lote cargado: ${batchSnap.size} distribuidores (Total: ${totalDistributors})`);

    } while (lastDoc);

    console.log(`👥 Total distribuidores encontrados: ${totalDistributors}`);

    const purgeReport = {
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      month: monthNumber,
      monthName: monthName,
      year: year,
      totalDistributors: totalDistributors,
      activeDistributors: 0,
      inactiveDistributors: 0,
      totalPurgedAmount: 0,
      totalPurgedPoints: 0,
      purgedUsers: [],
      // Audit fields
      adminUserId: adminUserId,
      adminEmail: adminEmail,
      executedAtIso: new Date().toISOString()
    };

    // For preview mode, we also track active users for the report
    const activeUsers = [];

    for (const userDoc of allUserDocs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      const username = userData.usuario || userData.username || 'Sin nombre';
      const historyArray = userData.history || [];
      const currentBalance = Number(userData.balance || 0);
      const currentGroupPoints = Number(userData.groupPoints || userData.puntosGrupales || 0);

      // Check if user accumulated 10+ personal points in the previous month
      const { isActive: wasActive, totalPoints: monthlyPoints } = checkActiveInRange(historyArray, startMs, endMs);

      if (wasActive) {
        purgeReport.activeDistributors++;
        console.log(`✅ ${username}: ACTIVO (${monthlyPoints} puntos personales en ${monthName})`);

        // In preview mode, track active users too
        if (isPreviewMode) {
          activeUsers.push({
            userId: userId,
            username: username,
            email: userData.email || '',
            phone: userData.telefono || userData.phone || '',
            status: 'activo',
            monthlyPoints: monthlyPoints,
            currentBalance: currentBalance,
            currentGroupPoints: currentGroupPoints
          });
        }
        continue;
      }

      // User was inactive (less than 10 points) - calculate commissions to purge
      const { commissions, totalAmount, totalPoints } = calculateCommissionsInRange(historyArray, startMs, endMs);

      if (commissions.length === 0) {
        purgeReport.inactiveDistributors++;
        console.log(`⚠️ ${username}: INACTIVO (${monthlyPoints}/${MONTHLY_ACTIVATION_POINTS_THRESHOLD} pts) pero sin comisiones en ${monthName}`);

        // In preview mode, track inactive users without commissions too
        if (isPreviewMode) {
          activeUsers.push({
            userId: userId,
            username: username,
            email: userData.email || '',
            phone: userData.telefono || userData.phone || '',
            status: 'inactivo_sin_comisiones',
            monthlyPoints: monthlyPoints,
            currentBalance: currentBalance,
            currentGroupPoints: currentGroupPoints
          });
        }
        continue;
      }

      purgeReport.inactiveDistributors++;
      console.log(`🗑️ ${username}: INACTIVO (${monthlyPoints}/${MONTHLY_ACTIVATION_POINTS_THRESHOLD} pts) - ${isPreviewMode ? 'Afectará' : 'Purgando'} ${totalAmount.toLocaleString()} COP (${totalPoints.toFixed(2)} puntos)`);

      const newBalance = Math.max(0, currentBalance - totalAmount);
      const newGroupPoints = Math.max(0, currentGroupPoints - totalPoints);

      // Only update Firestore if NOT in preview mode
      if (!isPreviewMode) {
        // Update user document to remove commissions
        const userRef = db.collection('usuarios').doc(userId);

        // Create purge entry for history
        const purgeEntry = {
          type: 'commission_purge',
          action: `Comisiones de ${monthName} ${year} eliminadas por inactividad (${monthlyPoints}/${MONTHLY_ACTIVATION_POINTS_THRESHOLD} puntos)`,
          amount: -totalAmount,
          points: -totalPoints,
          timestamp: Date.now(),
          originMs: Date.now(),
          date: new Date().toISOString(),
          purgedCommissionsCount: commissions.length,
          month: monthNumber,
          year: year,
          monthlyPersonalPoints: monthlyPoints,
          requiredPoints: MONTHLY_ACTIVATION_POINTS_THRESHOLD,
          by: 'admin_manual',
          adminUserId: adminUserId,
          adminEmail: adminEmail
        };

        await userRef.update({
          balance: newBalance,
          groupPoints: newGroupPoints,
          history: admin.firestore.FieldValue.arrayUnion(purgeEntry)
        });

        console.log(`   ✅ Balance actualizado: ${currentBalance.toLocaleString()} → ${newBalance.toLocaleString()} COP`);
        console.log(`   ✅ Puntos grupales actualizados: ${currentGroupPoints.toFixed(2)} → ${newGroupPoints.toFixed(2)}`);
      }

      // Record purged user for report (for both preview and execute modes)
      const purgedUserRecord = {
        userId: userId,
        username: username,
        email: userData.email || '',
        phone: userData.telefono || userData.phone || '',
        status: 'inactivo',
        monthlyPoints: monthlyPoints,
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
    }

    // Only save the purge report and audit log if NOT in preview mode
    if (!isPreviewMode) {
      // Save the purge report to Firestore
      await db.collection('commissionsPurged').add(purgeReport);

      // Save audit log entry
      await db.collection('purgeAuditLog').add({
        action: 'purge_executed',
        executedAt: admin.firestore.FieldValue.serverTimestamp(),
        executedAtIso: new Date().toISOString(),
        adminUserId: adminUserId,
        adminEmail: adminEmail,
        period: {
          month: monthNumber,
          monthName: monthName,
          year: year,
          startDate: new Date(startMs).toISOString(),
          endDate: new Date(endMs).toISOString()
        },
        summary: {
          totalDistributors: purgeReport.totalDistributors,
          activeDistributors: purgeReport.activeDistributors,
          inactiveDistributors: purgeReport.inactiveDistributors,
          usersAffected: purgeReport.purgedUsers.length,
          totalAmountPurged: purgeReport.totalPurgedAmount,
          totalPointsPurged: purgeReport.totalPurgedPoints
        },
        affectedUserIds: purgeReport.purgedUsers.map(u => u.userId)
      });
    }

    console.log('');
    console.log(`📊 ============ ${isPreviewMode ? 'VISTA PREVIA' : 'RESUMEN DE PURGA'} ============`);
    console.log(`   Mes procesado: ${monthName} ${year}`);
    console.log(`   Total distribuidores: ${purgeReport.totalDistributors}`);
    console.log(`   Distribuidores activos: ${purgeReport.activeDistributors}`);
    console.log(`   Distribuidores inactivos: ${purgeReport.inactiveDistributors}`);
    console.log(`   Usuarios ${isPreviewMode ? 'a purgar' : 'purgados'}: ${purgeReport.purgedUsers.length}`);
    console.log(`   Total ${isPreviewMode ? 'a purgar' : 'purgado'}: ${purgeReport.totalPurgedAmount.toLocaleString()} COP`);
    console.log(`   Puntos ${isPreviewMode ? 'a purgar' : 'purgados'}: ${purgeReport.totalPurgedPoints.toFixed(2)}`);
    console.log('==============================================');

    // Build the response based on mode
    const response = {
      success: true,
      mode: isPreviewMode ? 'preview' : 'execute',
      message: isPreviewMode
        ? `Vista previa de purga para ${monthName} ${year}`
        : `Purga completada para ${monthName} ${year}`,
      period: {
        month: monthNumber,
        monthName: monthName,
        year: year,
        startDate: new Date(startMs).toISOString(),
        endDate: new Date(endMs).toISOString()
      },
      summary: {
        totalDistributors: purgeReport.totalDistributors,
        activeDistributors: purgeReport.activeDistributors,
        inactiveDistributors: purgeReport.inactiveDistributors,
        purgedUsers: purgeReport.purgedUsers.length,
        totalPurgedAmount: purgeReport.totalPurgedAmount,
        totalPurgedPoints: purgeReport.totalPurgedPoints
      }
    };

    // Include detailed users list in preview mode
    if (isPreviewMode) {
      response.preview = {
        usersToAffect: purgeReport.purgedUsers,
        activeUsers: activeUsers,
        commissionsBreakdown: purgeReport.purgedUsers.map(u => ({
          userId: u.userId,
          username: u.username,
          commissionsCount: u.commissionsCount,
          commissions: u.purgedCommissions
        }))
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(response)
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
