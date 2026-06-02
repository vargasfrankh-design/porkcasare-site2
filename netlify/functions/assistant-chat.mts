import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db/index.js";
import { assistantFaqs } from "../../db/schema.js";
import { desc } from "drizzle-orm";
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
  } catch (err) {
    console.error("Auth verification failed:", err?.message);
    return null;
  }
}

const SYSTEM_PROMPT = `Eres el asistente virtual de PorKCasare (KPC). Tu nombre es "Asistente PorKCasare". Respondes en espanol de forma clara, amable y breve (maximo 4-5 oraciones por respuesta). Eres experto en toda la plataforma.

=== SOBRE LA PLATAFORMA ===
PorKCasare es una plataforma colombiana de comercio y red de distribuidores (modelo unilevel). Ofrece productos carnicos y de consumo masivo, un sistema de puntos, comisiones multinivel, inversiones, juegos con recompensas y educacion.

=== TIPOS DE USUARIO ===
- Distribuidor: compra a precio base, gana comisiones de su red, puede hacer retiros.
- Cliente: compra con 25% de recargo sobre el precio distribuidor.
- Restaurante: compra por kilo a precio especial, genera 5% de comision a sus 5 niveles superiores.
- Master: distribuidor sin patrocinador (cabeza de red).

=== PRODUCTOS Y PRECIOS ===
Categorias: carnes (chuletas, costillitas, paticas, panceta, pulpa, goulast en paquetes de 3kg), bebidas, alimentos, aseo, higiene, abarrotes, PEC.
- Paquete Inicial: 15kg por $300.000 COP (distribuidor) o $375.000 COP (cliente) = 50 puntos.
- Paquete individual 3kg: $60.000 COP (distribuidor) / $75.000 COP (cliente) = 10 puntos.
- Restaurante: $20.000 COP por kilo, 3.33 puntos por kg.
- Conversion universal: 1 punto = $2.800 COP.

=== SISTEMA DE PUNTOS ===
- Puntos personales: se ganan al comprar productos. Necesitas minimo 10 puntos personales al mes para estar "activo" y recibir comisiones.
- Puntos grupales: se ganan de las compras de tu red (downline). Se acumulan como comisiones.
- Para activar tu codigo y empezar a ganar bonos y comisiones, necesitas una compra minima de 50 puntos.

=== COMISIONES ===
1. Compra de Distribuidor: cada uno de tus 5 niveles superiores recibe el 10% del valor de tu pedido. Ejemplo: pedido de 50 puntos = $140.000 COP → cada nivel recibe $14.000 COP (5 puntos grupales).
2. Bono Quick Start (primera compra >= 50 puntos): el patrocinador directo recibe 21 puntos por cada paquete de 50 puntos; los 4 niveles superiores reciben 1 punto cada uno. Solo aplica en la primera compra.
3. Compra de Cliente: la diferencia de precio (precio cliente - precio distribuidor) va al patrocinador directo. Ejemplo: $75.000 - $60.000 = $15.000 COP.
4. Compra de Restaurante: cada uno de los 5 niveles superiores recibe el 5% de los puntos totales.
- Retiros: minimo $20.000 COP. Solo Masters o distribuidores con 50+ puntos personales pueden retirar. Pagos programados el 15 o 30 de cada mes.
- Si no tienes 10+ puntos personales en un mes, pierdes las comisiones de ese mes.

=== RANGOS ===
- Plata: $1.400.000 COP acumulados, 500 puntos personales.
- Oro: $4.200.000 COP acumulados, 1.500 puntos personales.
- Estrellas: $8.400.000 COP acumulados, 3.000 puntos personales.
- Diamante: $14.000.000 COP acumulados, 5.000 puntos personales.
- Corona: $28.000.000 COP acumulados, 10.000 puntos personales.
Los rangos se alcanzan progresivamente. Desde Plata puedes subir tu foto de perfil personalizada.

=== RED DE REFERIDOS (DUPLICACION) ===
Sistema unilevel: puedes referir a personas ilimitadas (frontline). Las comisiones suben hasta 5 niveles.
- Tu link de referido se encuentra en la seccion "Duplicacion" de tu oficina virtual. Puedes copiarlo y compartirlo.
- En la seccion Duplicacion puedes ver tu arbol de red, frontlines activos (verde) e inactivos (gris), y estadisticas.

=== DOCUMENTACION ===
Debes subir 4 documentos en la seccion "Documentos" de tu oficina virtual:
1. Cedula frontal (frente de tu documento de identidad).
2. Cedula posterior (reverso de tu documento de identidad).
3. RUT (Registro Unico Tributario).
4. Certificacion bancaria.
Formatos aceptados: PDF, JPG, PNG. Maximo 5MB por archivo.
Una vez subidos los 4, tu estado cambia a "pendiente de validacion". Un administrador los revisa y aprueba.

=== ENVIO Y COSTOS ===
- Yopal: 1-5 UE = $5.000 | 6-10 UE = $8.000 | 11+ UE = $12.000.
- Otras ciudades: 1-3 UE = $16.000 | 4-6 UE = $22.000 | 7-10 UE = $30.000 | 11-15 UE = $40.000 | 16+ UE = $50.000.
- Recogida en punto: gratis.
- Se pueden aplicar codigos promocionales que el administrador configura.

=== METODOS DE PAGO ===
Nequi y Daviplata. Despues del pago, debes enviar el comprobante por WhatsApp al equipo de soporte. Tambien se acepta MercadoPago para pago en linea.

=== INVERSIONES ===
Disponibles en la pestana "Consumo" > seccion "Inversiones":
- KPC Capital (activa): linea de inversion en capital digital.
- Ganaderia Futura (proximamente): ciclos ganaderos.
- Siembra KPC (proximamente): produccion agricola.
- Agro Expansion (en revision): expansion agricola escalable.

=== JUEGOS Y RETOS ===
En la pestana "Consumo" > seccion "Retos":
- Juego de Memoria: encuentra parejas de cartas. Recompensa: $60.000 / 10 puntos.
- Trivia PorKCasare: preguntas sobre productos y nutricion.
- Rompecabezas: arma imagenes de productos en diferentes niveles de dificultad.
- Rueda de la Fortuna: gira para multiplicar puntos.
Todos los juegos tienen limites mensuales y sistema de vidas.

=== EDUCACION ===
En la pestana "Educacion":
- Videos educativos sobre la plataforma y productos.
- Libros y documentos de formacion.
- PEC del Mes (Paquete de Educacion Continua).
- Enlaces utiles para distribuidores.

=== NAVEGACION DE LA OFICINA VIRTUAL ===
Tres pestanas principales:
1. Educacion: videos, libros, PEC del mes, enlaces.
2. Consumo (por defecto): productos, juegos/retos, inversiones.
3. Duplicacion: red de referidos, link de referido, arbol de red.
Arriba: campanita de notificaciones (filtrar por tipo: pedidos, documentos, comisiones, general).

=== NOTIFICACIONES ===
La campanita en la barra superior muestra alertas sobre pedidos, documentos, comisiones y novedades. Puedes filtrarlas por tipo y marcarlas como leidas. Se actualizan automaticamente.

=== REGISTRO ===
Para registrarte necesitas: usuario, contrasena, nombre, apellido, documento, email, celular y direccion. Si alguien te refirio, su nombre aparece automaticamente en el campo de patrocinador. Despues de registrarte, necesitas hacer una compra minima de 50 puntos para activar tu codigo.

=== SOPORTE ===
Si no puedo resolver tu consulta, contacta al equipo de soporte por WhatsApp al +573125929316.

REGLAS:
- No inventes informacion. Si no sabes algo con certeza, dilo honestamente y sugiere contactar soporte.
- Responde siempre en espanol.
- Se conciso pero completo.
- Si el usuario pregunta algo fuera del ambito de la plataforma, indicale amablemente que solo puedes ayudar con temas de PorKCasare.`;

// Base de conocimiento local. Se usa como respaldo cuando el servicio de IA
// no esta disponible, para que el asistente siempre responda algo util en
// lugar de un mensaje de error generico.
const KNOWLEDGE_BASE = [
  {
    keys: ["comprar", "compra", "producto", "pedido", "pedir", "carrito", "ordenar"],
    answer:
      "Para comprar, entra a la pestana \"Consumo\" de tu oficina virtual, agrega los productos al carrito y completa el pago con Nequi, Daviplata o MercadoPago. Recuerda que tu primera compra debe ser de minimo 50 puntos para activar tu codigo. Despues del pago, envia el comprobante por WhatsApp.",
  },
  {
    keys: ["documento", "documentos", "cedula", "rut", "bancaria", "subir", "validacion"],
    answer:
      "En la seccion \"Documentos\" debes subir 4 archivos: cedula frontal, cedula posterior, RUT y certificacion bancaria. Acepta PDF, JPG o PNG (maximo 5MB c/u). Al subir los 4, tu estado pasa a \"pendiente de validacion\" y un administrador los revisa.",
  },
  {
    keys: ["comision", "comisiones", "nivel", "niveles", "bono", "quick start", "gano", "ganar"],
    answer:
      "Las comisiones suben hasta 5 niveles: cada nivel superior recibe 10% del valor de los pedidos de tu red. En la primera compra (>=50 puntos) tu patrocinador directo recibe el Bono Quick Start de 21 puntos. Necesitas minimo 10 puntos personales al mes para estar activo y cobrar comisiones.",
  },
  {
    keys: ["red", "referido", "referidos", "link", "enlace", "duplicacion", "arbol", "compartir", "frontline"],
    answer:
      "Tu link de referido esta en la pestana \"Duplicacion\" de tu oficina virtual. Ahi puedes copiarlo, compartirlo y ver tu arbol de red con los frontlines activos (verde) e inactivos (gris). Puedes referir personas ilimitadas y ganar hasta 5 niveles.",
  },
  {
    keys: ["rango", "rangos", "plata", "oro", "diamante", "corona", "estrella", "avanzar", "subir"],
    answer:
      "Los rangos se logran acumulando compras y puntos personales: Plata ($1.400.000 / 500 pts), Oro ($4.200.000 / 1.500 pts), Estrellas ($8.400.000 / 3.000 pts), Diamante ($14.000.000 / 5.000 pts) y Corona ($28.000.000 / 10.000 pts). Desde Plata puedes personalizar tu foto de perfil.",
  },
  {
    keys: ["envio", "envios", "domicilio", "flete", "yopal", "costo de envio", "recogida"],
    answer:
      "En Yopal el envio va de $5.000 a $12.000 segun la cantidad. En otras ciudades va de $16.000 a $50.000 segun el numero de unidades. La recogida en punto es gratis y puedes aplicar codigos promocionales si el administrador los habilita.",
  },
  {
    keys: ["pago", "pagar", "nequi", "daviplata", "mercadopago", "comprobante", "metodo"],
    answer:
      "Aceptamos Nequi, Daviplata y MercadoPago. Despues de pagar con Nequi o Daviplata, envia el comprobante por WhatsApp al equipo de soporte para confirmar tu pedido.",
  },
  {
    keys: ["retiro", "retirar", "retiros", "sacar", "dinero", "pago de comision"],
    answer:
      "El retiro minimo es de $20.000. Solo los Masters o distribuidores con 50+ puntos personales pueden retirar. Los pagos se programan el 15 o el 30 de cada mes. Si en un mes no tienes 10+ puntos personales, pierdes las comisiones de ese mes.",
  },
  {
    keys: ["punto", "puntos", "activo", "activar", "personales", "grupales"],
    answer:
      "Los puntos personales se ganan con tus compras (1 punto = $2.800). Necesitas minimo 10 puntos personales al mes para estar activo y recibir comisiones. Para activar tu codigo por primera vez se requiere una compra de minimo 50 puntos.",
  },
  {
    keys: ["inversion", "inversiones", "kpc capital", "ganaderia", "siembra", "agro"],
    answer:
      "Las inversiones estan en la pestana \"Consumo\" > seccion \"Inversiones\": KPC Capital (activa), Ganaderia Futura y Siembra KPC (proximamente) y Agro Expansion (en revision).",
  },
  {
    keys: ["juego", "juegos", "reto", "retos", "memoria", "trivia", "rompecabezas", "ruleta", "rueda"],
    answer:
      "En \"Consumo\" > \"Retos\" tienes el Juego de Memoria, la Trivia PorKCasare, el Rompecabezas y la Rueda de la Fortuna. Dan recompensas en puntos y dinero, con limites mensuales y sistema de vidas.",
  },
  {
    keys: ["educacion", "video", "videos", "libro", "pec", "formacion", "curso"],
    answer:
      "En la pestana \"Educacion\" encuentras videos educativos, libros y documentos de formacion, el PEC del Mes y enlaces utiles para distribuidores.",
  },
  {
    keys: ["registro", "registrar", "registrarme", "cuenta", "patrocinador", "inscribir"],
    answer:
      "Para registrarte necesitas usuario, contrasena, nombre, apellido, documento, email, celular y direccion. Si alguien te refirio, su nombre aparece automaticamente como patrocinador. Luego haz una compra de minimo 50 puntos para activar tu codigo.",
  },
  {
    keys: ["notificacion", "notificaciones", "campana", "campanita", "alerta", "alertas"],
    answer:
      "La campanita en la barra superior muestra alertas de pedidos, documentos, comisiones y novedades. Puedes filtrarlas por tipo y marcarlas como leidas; se actualizan automaticamente.",
  },
];

const SUPPORT_NOTE =
  " Si necesitas mas ayuda, escribe a soporte por WhatsApp al +573125929316.";

const TOPICS_MENU =
  "Puedo ayudarte con estos temas:\n" +
  "- Comprar productos y realizar pedidos\n" +
  "- Subir tus documentos\n" +
  "- Comisiones y niveles\n" +
  "- Tu red de referidos y link de duplicacion\n" +
  "- Rangos y como avanzar\n" +
  "- Envios y costos\n" +
  "- Metodos de pago y retiros\n" +
  "- Inversiones, juegos y educacion\n" +
  "Escribe tu pregunta sobre cualquiera de estos temas." +
  SUPPORT_NOTE;

function normalizeText(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Genera una respuesta a partir de la base de conocimiento local y las FAQs
// de la base de datos. Se usa solo como respaldo si la IA no responde.
function findLocalAnswer(message, faqs) {
  const text = normalizeText(message);

  let best = null;
  let bestScore = 0;
  for (const entry of KNOWLEDGE_BASE) {
    let score = 0;
    for (const key of entry.keys) {
      if (text.includes(normalizeText(key))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (Array.isArray(faqs)) {
    for (const faq of faqs) {
      const q = normalizeText(faq.question || "");
      const words = q.split(/\s+/).filter((w) => w.length > 4);
      let score = 0;
      for (const w of words) {
        if (text.includes(w)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { answer: faq.answer };
      }
    }
  }

  if (best && bestScore > 0) {
    return best.answer + SUPPORT_NOTE;
  }
  return TOPICS_MENU;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return respond(405, { error: "Metodo no permitido" });
  }

  const decoded = await verifyAuth(req);
  if (!decoded) return respond(401, { error: "No autorizado" });

  let body;
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: "JSON invalido" });
  }

  const { message, conversationHistory } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return respond(400, { error: "Mensaje requerido" });
  }

  const userMessage = message.trim().slice(0, 1000);

  let faqContext = "";
  let faqList = [];
  try {
    faqList = await db
      .select()
      .from(assistantFaqs)
      .orderBy(desc(assistantFaqs.usageCount))
      .limit(10);

    if (faqList.length > 0) {
      faqContext =
        "\n\nPreguntas frecuentes conocidas:\n" +
        faqList
          .map((f) => `P: ${f.question}\nR: ${f.answer}`)
          .join("\n\n");
    }
  } catch (dbErr) {
    console.error("FAQ query failed, continuing without FAQ context:", dbErr);
  }

  try {
    // Construye el historial garantizando que empiece por "user" y que los
    // roles alternen, tal como exige la API de mensajes. Un historial mal
    // formado provocaba errores que dejaban al asistente sin responder.
    const messages = [];
    if (Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory.slice(-6)) {
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        const content =
          typeof msg.content === "string" ? msg.content.slice(0, 1000).trim() : "";
        if (!content) continue;
        // Salta hasta encontrar el primer mensaje de usuario.
        if (messages.length === 0 && msg.role !== "user") continue;
        const prev = messages[messages.length - 1];
        if (prev && prev.role === msg.role) {
          // Fusiona mensajes consecutivos del mismo rol para mantener la alternancia.
          prev.content += "\n" + content;
        } else {
          messages.push({ role: msg.role, content });
        }
      }
    }

    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "user") {
      // El ultimo turno ya es del usuario: agrega el mensaje actual a ese turno.
      if (lastMsg.content !== userMessage) lastMsg.content += "\n" + userMessage;
    } else {
      messages.push({ role: "user", content: userMessage });
    }

    if (messages.length === 0 || messages[0].role !== "user") {
      messages.unshift({ role: "user", content: userMessage });
    }

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT + faqContext,
      messages,
    });

    const assistantReply =
      response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

    // Si la IA no devolvio texto, responde con la base de conocimiento local.
    return respond(200, {
      reply: assistantReply || findLocalAnswer(userMessage, faqList),
    });
  } catch (err) {
    console.error("Assistant error:", err?.status, err?.message, err);
    // El servicio de IA fallo: en lugar de un error, responde con la base de
    // conocimiento local para que el usuario siempre reciba ayuda util.
    return respond(200, {
      reply: findLocalAnswer(userMessage, faqList),
    });
  }
};

export const config = {
  path: "/api/assistant",
};
