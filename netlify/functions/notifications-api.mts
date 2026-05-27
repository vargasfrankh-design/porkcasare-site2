import { db } from "../../db/index.js";
import { notifications } from "../../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import admin from "firebase-admin";

function getFirebaseAdmin() {
  if (!admin.apps.length) {
    const saBase64 = Netlify.env.get("FIREBASE_ADMIN_SA") || "";
    if (!saBase64) throw new Error("FIREBASE_ADMIN_SA not configured");
    const saJson = JSON.parse(Buffer.from(saBase64, "base64").toString("utf8"));
    admin.initializeApp({ credential: admin.credential.cert(saJson) });
  }
  return admin;
}

function respond(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

async function verifyAuth(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  try {
    const fbAdmin = getFirebaseAdmin();
    return await fbAdmin.auth().verifyIdToken(token);
  } catch {
    return null;
  }
}

async function isAdmin(uid) {
  const fbAdmin = getFirebaseAdmin();
  const firestore = fbAdmin.firestore();
  const doc = await firestore.collection("usuarios").doc(uid).get();
  return doc.exists && doc.data().rol === "admin";
}

export default async (req) => {
  const url = new URL(req.url);
  const method = req.method;

  if (method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const decoded = await verifyAuth(req);
  if (!decoded) return respond(401, { error: "No autorizado" });

  const uid = decoded.uid;

  if (method === "GET") {
    const type = url.searchParams.get("type");
    const unreadOnly = url.searchParams.get("unread") === "true";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

    let conditions = [eq(notifications.userId, uid)];
    if (type) conditions.push(eq(notifications.type, type));
    if (unreadOnly) conditions.push(eq(notifications.read, false));

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    const unreadCount = (
      await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, uid), eq(notifications.read, false)))
    ).length;

    return respond(200, { notifications: rows, unreadCount });
  }

  if (method === "PATCH") {
    const body = await req.json();
    const { action, notificationId } = body;

    if (action === "markRead" && notificationId) {
      await db
        .update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, uid)));
      return respond(200, { success: true });
    }

    if (action === "markAllRead") {
      await db
        .update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.userId, uid), eq(notifications.read, false)));
      return respond(200, { success: true });
    }

    return respond(400, { error: "Accion invalida" });
  }

  if (method === "POST") {
    const adminCheck = await isAdmin(uid);
    if (!adminCheck) return respond(403, { error: "Solo administradores" });

    const body = await req.json();
    const { targetUserId, targetAll, type, title, message, metadata } = body;

    if (!title || !message) {
      return respond(400, { error: "Titulo y mensaje requeridos" });
    }

    if (targetAll) {
      const fbAdmin = getFirebaseAdmin();
      const firestore = fbAdmin.firestore();
      const usersSnap = await firestore.collection("usuarios").get();
      const rows = usersSnap.docs.map((doc) => ({
        userId: doc.id,
        type: type || "general",
        title,
        message,
        metadata: metadata || null,
      }));

      if (rows.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < rows.length; i += batchSize) {
          await db.insert(notifications).values(rows.slice(i, i + batchSize));
        }
      }

      return respond(201, { success: true, count: rows.length });
    }

    if (targetUserId) {
      const [row] = await db
        .insert(notifications)
        .values({
          userId: targetUserId,
          type: type || "general",
          title,
          message,
          metadata: metadata || null,
        })
        .returning();
      return respond(201, { success: true, notification: row });
    }

    return respond(400, { error: "Especifique targetUserId o targetAll" });
  }

  return respond(405, { error: "Metodo no permitido" });
};

export const config = {
  path: "/api/notifications",
};
