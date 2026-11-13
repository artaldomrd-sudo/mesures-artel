'use strict';
// Coordinador de Obras — RESPUESTA CONVERSACIONAL al informe matinal desde Mensajería (Dylan 2026-10-31: «poder hacer eso mismo desde
// la plataforma, respondiendo al informe como a un mensaje, sin abrir la app de Claude»).
//
// Flujo: ops/mensajes.html muestra bajo cada informe (`mensajes` tipo 'informe_coordinador') la caja «Responder al Coordinador»; la
// respuesta se guarda en `coordinadorRespuestas/{id}` {informeId, informeAsunto, texto, por, porEmail, fecha, estado:'pendiente',
// destinatariosInforme}. Este trigger la procesa con Claude (mismo guion, reglas y lecciones que el informe, functions/coordinador.js)
// y HERRAMIENTAS acotadas a lo que el agente puede hacer solo (sección 5 de .claude/agents/coordinador-obras.md):
//   consultar_panel / obtener_documento (lectura), reprogramar_trabajo, anotar_trabajo, cambiar_estado_pedido (solo estados de fábrica,
//   nunca completado), fijar_salida_pedido, instruccion_fabrica, crear_recordatorio, mensaje_interno (solo correos del equipo),
//   anotar_leccion (coordinadorConfig/lecciones) y redactar_para_cliente (NO envía: devuelve texto + enlace wa.me).
// Nada de dinero, borrados, cierres ni usuarios. Cada escritura queda en `coordinadorAcciones` (auditoría, solo crear por servidor).
// La contestación se publica en el mismo hilo (`mensajes` tipo 'respuesta_coordinador', enRespuestaA = informe) a los destinatarios
// del informe + quien respondió; `mensajePush` manda el push. `coordinadorRespuestas.estado` → procesada | error | rechazada.
//
// El agente local (app de Claude) lee lo que pasó aquí con:
//   node scripts/ops/leer.js mensajes tipo=respuesta_coordinador --orden fecha:desc --limite 5
//   node scripts/ops/leer.js coordinadorAcciones --orden fecha:desc --limite 20
//   node scripts/ops/lecciones.js ver

const coord = require('./coordinador');

const NOMBRE = 'Coordinador de Obras (IA)';
const REMITENTE = 'coordinador@artal';
const MAX_PASOS = 12;              // llamadas a herramientas por respuesta
const MAX_CHARS_RESULTADO = 14000; // lo que devuelve una consulta al modelo
const COLECCIONES_LECTURA = ['instalaciones', 'orders', 'citas', 'mensajes', 'partesDiarios', 'viajes', 'clientes', 'equipo',
    'movimientosInstalaciones', 'anticiposCitrus', 'coordinadorConfig', 'coordinadorRespuestas', 'coordinadorAcciones', 'rrhhVacaciones', 'rrhhFeriados'];
const ESTADOS_FABRICA = ['pendiente_fabrica', 'en_fabrica', 'parcialmente_listo', 'listo_para_cargar'];
const FECHA_ESTADO = { en_fabrica: 'fechaEnFabrica', parcialmente_listo: 'fechaParcialListo', listo_para_cargar: 'fechaListoParaCargar' };
const ROLES_OBRA = ['instalador', 'ayudante', 'chofer'];

const rec = (s, n) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, n));
const low = (e) => String(e || '').trim().toLowerCase();
const ddmm = () => { const d = new Date(Date.now() - 4 * 3600e3); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
// 'AAAA-MM-DD' (→ 8:00 am RD) o 'AAAA-MM-DDTHH:MM' en hora de Santo Domingo → Date, o null si no es válida.
function fechaRD(s) {
    const m = String(s || '').trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
    if (!m) return null;
    const d = new Date(`${m[1]}T${m[2] || '08'}:${m[3] || '00'}:00-04:00`);
    return isNaN(d.getTime()) ? null : d;
}
// Quita de un documento lo que pesa y no aporta al modelo (fichas completas, fotos, acuses…).
function compactar(col, d) {
    const x = { ...d };
    for (const k of ['appJSON', 'fotos', 'acuses', 'partesFabrica', 'itemStatus', 'itemStatusInstalador', 'itemsListosFabrica', 'leidoPor', 'fcmTokens', 'historial']) delete x[k];
    if (Array.isArray(x.items)) x.items = x.items.slice(0, 20).map((it) => ({ id: it.id, type: it.type, label: it.label, ancho: it.ancho, alto: it.alto, cantidad: it.cantidad }));
    if (Array.isArray(x.comentariosInstalador)) x.comentariosInstalador = x.comentariosInstalador.slice(-4).map((c) => ({ nombre: c.nombre, fecha: c.fecha, texto: rec(c.texto, 160) }));
    if (col === 'mensajes' && x.cuerpo) x.cuerpo = rec(x.cuerpo, 700);
    for (const k of Object.keys(x)) { const v = x[k]; if (v && typeof v === 'object' && typeof v.toDate === 'function') x[k] = coord.fechaTxt(v); }
    return x;
}
// Red de seguridad de redacción (Dylan 2026-11-11): si al modelo se le cuela un id de Firestore (20 caracteres con letras y números)
// en la respuesta que lee una persona, se quita junto con su «(id …)» / «id:»; los ids siguen intactos en coordinadorAcciones.
function sinIds(t) {
    const esId = (w) => /^[A-Za-z0-9]{20}$/.test(w) && (w.match(/[A-Z]/g) || []).length >= 2 && (w.match(/[a-z]/g) || []).length >= 2;   // una palabra normal nunca mezcla así mayúsculas y minúsculas
    return String(t || '')
        .replace(/\s*\(\s*(?:id|ID|Id)?\s*:?\s*([A-Za-z0-9]{20})\s*\)/g, (m, w) => (esId(w) ? '' : m))
        .replace(/\b(?:(?:el|un|su|con)\s+)?(?:id|ID|Id)\s*:?\s*([A-Za-z0-9]{20})\b/g, (m, w) => (esId(w) ? '' : m))
        .replace(/\b([A-Za-z0-9]{20})\b/g, (m, w) => (esId(w) ? '' : m))
        .replace(/[ \t]+([,.;:)])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}
const txt = (o) => { const s = JSON.stringify(o); return s.length > MAX_CHARS_RESULTADO ? s.slice(0, MAX_CHARS_RESULTADO) + '…(recortado)' : s; };

// ---------- herramientas (lo que el agente puede hacer solo) ----------
const HERRAMIENTAS = [
    { name: 'consultar_panel', description: 'Consulta una colección del panel (Firestore) con filtros de igualdad. Úsala para encontrar el id real de un trabajo (instalaciones) o pedido (orders) por cliente/obra antes de escribir, y para comprobar datos. Colecciones: ' + COLECCIONES_LECTURA.join(', ') + '.',
        input_schema: { type: 'object', properties: { coleccion: { type: 'string' }, filtros: { type: 'array', items: { type: 'object', properties: { campo: { type: 'string' }, op: { type: 'string', enum: ['==', 'in', '!='] }, valor: {} }, required: ['campo', 'op', 'valor'] } }, limite: { type: 'integer', minimum: 1, maximum: 120 }, campos: { type: 'array', items: { type: 'string' }, description: 'Si se indica, solo devuelve esos campos (ahorra tokens).' } }, required: ['coleccion'] } },
    { name: 'obtener_documento', description: 'Trae un documento por id (colecciones de consultar_panel).', input_schema: { type: 'object', properties: { coleccion: { type: 'string' }, id: { type: 'string' } }, required: ['coleccion', 'id'] } },
    { name: 'reprogramar_trabajo', description: 'Cambia la fecha de un trabajo de instalación (instalaciones.fecha; hora de Santo Domingo). Deja la fecha anterior en fechaOriginal y un registro en movimientosInstalaciones. No sirve para trabajos completados.',
        input_schema: { type: 'object', properties: { instalacionId: { type: 'string' }, fecha: { type: 'string', description: 'AAAA-MM-DD o AAAA-MM-DDTHH:MM (hora RD). Vacío = quitar la fecha (queda «sin fecha»).' }, motivo: { type: 'string' } }, required: ['instalacionId', 'motivo'] } },
    { name: 'anotar_trabajo', description: 'Agrega una nota al trabajo (instalaciones.notas, con fecha y firma del Coordinador) y un registro en movimientosInstalaciones. Para «☔ REQUIERE DÍA SECO» y avisos al equipo en la tarjeta.',
        input_schema: { type: 'object', properties: { instalacionId: { type: 'string' }, nota: { type: 'string' } }, required: ['instalacionId', 'nota'] } },
    { name: 'cambiar_estado_pedido', description: 'Cambia el status de un pedido de fabricación SOLO entre estados de fábrica: ' + ESTADOS_FABRICA.join(' | ') + '. Nunca a completado ni a estados de cotización (eso lo hace el equipo/oficina).',
        input_schema: { type: 'object', properties: { orderId: { type: 'string' }, status: { type: 'string', enum: ESTADOS_FABRICA }, motivo: { type: 'string' } }, required: ['orderId', 'status', 'motivo'] } },
    { name: 'fijar_salida_pedido', description: 'Fija o mueve la fecha estimada de salida de fábrica de un pedido (fechaSalidaEstimada, AAAA-MM-DD) con su motivo. Es una estimación, no una promesa al cliente.',
        input_schema: { type: 'object', properties: { orderId: { type: 'string' }, fecha: { type: 'string' }, motivo: { type: 'string' } }, required: ['orderId', 'fecha', 'motivo'] } },
    { name: 'instruccion_fabrica', description: 'Escribe una instrucción de la oficina a fábrica en el pedido (comentarioParaFabrica): ALUCUFEL o la fábrica interna la ve en rojo en su tablero y recibe push. Sustituye la instrucción anterior si la había.',
        input_schema: { type: 'object', properties: { orderId: { type: 'string' }, texto: { type: 'string' } }, required: ['orderId', 'texto'] } },
    { name: 'crear_recordatorio', description: 'Crea un recordatorio en el Calendario (citas) para personas del equipo (correos de EQUIPO). Con fecha avisa por push ese día; sin fecha queda en «Sin fecha».',
        input_schema: { type: 'object', properties: { titulo: { type: 'string' }, descripcion: { type: 'string' }, fecha: { type: 'string', description: 'AAAA-MM-DD o AAAA-MM-DDTHH:MM (hora RD); vacío = sin fecha' }, para: { type: 'array', items: { type: 'string' }, description: 'correos del equipo' }, cliente: { type: 'string' }, obra: { type: 'string' }, orderId: { type: 'string' } }, required: ['titulo', 'para'] } },
    { name: 'mensaje_interno', description: 'Manda un mensaje interno por Mensajería (con push) a personas del EQUIPO (Wilson, Miki, oficina…). Nunca a clientes ni a correos fuera de la lista EQUIPO. Español, corto, con el dato concreto.',
        input_schema: { type: 'object', properties: { para: { type: 'array', items: { type: 'string' } }, asunto: { type: 'string' }, cuerpo: { type: 'string' } }, required: ['para', 'asunto', 'cuerpo'] } },
    { name: 'anotar_leccion', description: 'Guarda una lección/regla nueva que el informe matinal y este chat respetarán desde ahora (coordinadorConfig/lecciones). Redáctala completa: obra o caso, regla, hasta cuándo si aplica, quién lo decidió.',
        input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
    { name: 'crear_trabajo', description: 'Crea un TRABAJO NUEVO en Instalación (instalaciones), como el botón «+ Trabajo» (Dylan 2026-11-02: «es más rápido y más preciso si le explico bien»). Tipos: instalacion (pedido de fábrica: busca el pedido abierto de esa obra y lo enlaza; si no hay, no lo crees y dilo), reparacion_artal, servicio_post, medicion, reemplazo_dano, preparacion_obra (también exige pedido abierto), reparacion_otra, preparacion_taller (preparación de pedido en el taller de Terrenas), levantamiento (visita técnica para ver la obra antes de cotizar o planificar), servicio_dominique. Si ya hay un trabajo ABIERTO de esa misma obra y tipo, no dupliques: dilo y usa reprogramar_trabajo o anotar_trabajo. Asignados = correos del EQUIPO con rol de obra. Fecha en hora RD; vacía = «sin fecha». Pon en notas todo lo que te dieron (medidas, qué llevar, hora de llegada, contacto).',
        input_schema: { type: 'object', properties: { cliente: { type: 'string' }, obra: { type: 'string', description: 'nombre de la obra (nunca un GPS ni un enlace)' }, tipoTrabajo: { type: 'string', enum: ['instalacion', 'reparacion_artal', 'servicio_post', 'medicion', 'reemplazo_dano', 'preparacion_obra', 'reparacion_otra', 'preparacion_taller', 'levantamiento', 'servicio_dominique'] }, fecha: { type: 'string', description: 'AAAA-MM-DD o AAAA-MM-DDTHH:MM (hora RD); vacío = sin fecha' }, asignados: { type: 'array', items: { type: 'string' }, description: 'correos del EQUIPO' }, notas: { type: 'string' }, direccion: { type: 'string' }, gps: { type: 'string', description: 'enlace de Maps o coordenadas, si los dieron' }, orderId: { type: 'string', description: 'id del pedido (orders) si ya lo sabes; si no, se busca por cliente/obra' } }, required: ['cliente', 'obra', 'tipoTrabajo'] } },
    { name: 'asignar_equipo', description: 'Asigna (o cambia) el equipo de un trabajo de Instalación (instalaciones.asignados): quién va a esa obra. Como el botón «Lo tomo yo» / la asignación de gerencia. Úsala cuando te pidan «pon a Wilson y Miki en X», «asigna el equipo de Niza», o cuando un trabajo listo para el día siguiente no tiene a nadie y tú propones el equipo (si Dylan o Wilson te lo confirman). Solo correos del EQUIPO con rol de obra. modo «reemplazar» (default: el equipo queda exactamente así) o «sumar» (se agregan a los que ya estaban). Avisa a los asignados con mensaje_interno si el trabajo es de mañana o de hoy.',
        input_schema: { type: 'object', properties: { instalacionId: { type: 'string' }, asignados: { type: 'array', items: { type: 'string' }, description: 'correos del EQUIPO con rol instalador/ayudante/chofer' }, modo: { type: 'string', enum: ['reemplazar', 'sumar'] }, motivo: { type: 'string' } }, required: ['instalacionId', 'asignados'] } },
    { name: 'marcar_entrega_externa', description: 'Marca un pedido (orders) como ENTREGADO en la obra o en el local cuando el material llegó SIN el camión de ARTAL (lo trajo un contratista como Delvis, un transportista o el propio cliente), para que Transportes no lo siga esperando. Solo pedidos listos para cargar (o parcialmente listos). No completa el pedido: la instalación sigue su curso. No es para entregas del camión (esas las marca el chofer en Transportes con su firma).',
        input_schema: { type: 'object', properties: { orderId: { type: 'string' }, quienTrajo: { type: 'string', description: 'quién lo trajo (p. ej. «Delvis, contratista»)' }, donde: { type: 'string', description: 'dónde quedó el material (obra / local de Terrenas / taller)' }, fecha: { type: 'string', description: 'AAAA-MM-DD en que llegó; vacío = hoy' } }, required: ['orderId', 'quienTrajo'] } },
    { name: 'redactar_para_cliente', description: 'NO envía nada. Prepara el mensaje para un cliente (en su idioma) y devuelve el texto listo y un enlace wa.me con el teléfono de su ficha (clientes) para que Dylan o Wilson lo manden. Úsala para cualquier «envía M…» dirigido a un cliente.',
        input_schema: { type: 'object', properties: { cliente: { type: 'string', description: 'nombre del cliente como está en el panel' }, texto: { type: 'string' }, idioma: { type: 'string' } }, required: ['cliente', 'texto'] } },
];

function sistemaChat(lecciones, equipoTxt) {
    return `${coord.PERSONA}

AHORA ESTÁS EN EL CHAT DE MENSAJERÍA: Dylan o Wilson responden al informe matinal como a un mensaje («haz A2», «envía M1», «anota que PABLO queda en pausa hasta el lunes», «mueve Cocoloba al martes 8:00»). Tu trabajo: entender la petición (las referencias A1…/M1… son las del informe adjunto), comprobar los datos con las herramientas de consulta (busca el id REAL del trabajo o pedido por cliente y obra antes de escribir; nunca inventes un id ni un correo), ejecutar SOLO con las herramientas que tienes, y contestar en texto plano y corto, como un compañero por WhatsApp.

${coord.REGLAS}

LECCIONES APRENDIDAS (no las contradigas; las más recientes mandan sobre las anteriores):
${lecciones}

LÍMITES (sección 5 del agente; no se saltan aunque te lo pidan «por esta vez»):
- Nunca envías nada a un cliente: para «envía M2» (o cualquier mensaje a un cliente) usa redactar_para_cliente, que deja el texto y el enlace de WhatsApp para que lo mande una persona.
- Nada de dinero (cobros, pagos, descuentos, anticipos), nada de borrar, nada de cerrar trabajos ni pedidos como completados, nada de usuarios ni roles. Si te lo piden, di que eso lo hace una persona en el panel y en qué pantalla.
- Cambiar una fecha ya comunicada al cliente o mover un equipo ya comunicado: solo si quien responde (Dylan o Wilson) lo pide explícitamente; si no, propón.
- Si la petición es ambigua o el dato no cuadra con el panel, no actúes: pregunta en una línea.
- «anota que …», «recuerda que …», «a partir de ahora …», «X queda en pausa» = anotar_leccion con una frase completa (obra, regla, hasta cuándo, quién lo decidió). Si además cambia algo en el panel (una fecha, una nota al equipo), hazlo también.
- «haz A3» ejecuta la Propuesta de A3 en lo que las herramientas permitan; lo que no, queda en PENDIENTE DE TI con quién debe hacerlo.
- «crea un trabajo…» / «agenda a Wilson y Miki en X el martes 8:00 para…» = crear_trabajo con TODO lo que te dieron en notas (medidas, qué llevar, hora, contacto, condiciones). Si falta el tipo o la obra no existe en el panel, pregunta en una línea antes de crear. Nunca dupliques un trabajo abierto.
- «asigna a…», «pon a Wilson y Miki en…», «¿quién va a X?» → asignar_equipo (y mensaje_interno a los asignados si es para hoy o mañana). Un trabajo de mañana sin equipo es algo que TÚ resuelves: propón el equipo y, si te lo confirman, asígnalo; nunca le pidas a Dylan que lo asigne él.
- «llegó el material con Delvis / con un transportista / lo trajo el cliente» → marcar_entrega_externa en ese pedido (si está listo para cargar). No se lo pidas a Dylan ni a la oficina.
- Máximo ${MAX_PASOS} llamadas a herramientas; agrupa las consultas. Si ya tienes el id en el informe o en el JSON del panel, no vuelvas a buscarlo.

EQUIPO (únicos correos válidos para mensaje_interno y crear_recordatorio):
${equipoTxt}

CÓMO ESCRIBIR LA RESPUESTA (Dylan 2026-11-11: «me pone códigos que no conozco; su forma de expresarse debe ser clara y fácil de leer»). Le escribes a un empresario por WhatsApp, no a un programador:
- NUNCA pongas identificadores de documentos (cadenas como hsHNxNwSaSKnGIoVmoEj), ni entre paréntesis ni «para referencia». Nombra cada cosa como la ve él en el panel: «el trabajo de Niza (instalación de shutters, miércoles 18 a las 8:30)», «el pedido de Niza en fábrica interna». Los ids son solo para tus herramientas.
- NUNCA escribas nombres de campos ni valores técnicos (entregado: true, status, listo_para_cargar, orderId, tipoTrabajo, en_proceso). Di lo mismo en palabras: «ya figura como entregado», «está listo para cargar», «el trabajo está en marcha».
- Frases cortas y completas, una idea por línea. Primero qué hiciste, después qué falta. Sin jerga, sin siglas, sin emojis de verificación al final de cada línea.
- Si algo lo tiene que hacer una persona, di QUIÉN, EN QUÉ PANTALLA y CON QUÉ BOTÓN («Wilson, en Transportes, botón Entregado»), no «marcar el pedido con tal campo».
- Nunca repitas el mensaje al que respondes: el panel ya lo muestra.

RESPUESTA FINAL (texto plano, español, sin tablas ni Markdown, máx. ~20 líneas), con estas secciones solo si tienen contenido:
HECHO — una línea por acción, con la obra, la fecha o la persona que corresponda.
NO HECHO — qué no pudiste y por qué, en palabras llanas.
PENDIENTE DE TI — solo lo que de verdad necesita a una persona (mensaje a un cliente con su enlace de WhatsApp, una decisión, una llamada), con quién y dónde.
Si no hiciste nada, dilo en una línea y pregunta lo que falte.`;
}

module.exports = function montar({ db, FieldValue, Timestamp, onDocumentCreated, anthropicKey, mismaObra }) {
    const lector = coord.lectorAdmin(db);
    const ahora = () => FieldValue.serverTimestamp();

    // Auditoría: una fila por escritura (o por mensaje redactado) hecha desde el chat.
    async function registrar(ctx, fila) {
        const f = { respuestaId: ctx.respuestaId, informeId: ctx.informeId, por: ctx.por, porEmail: ctx.porEmail, fecha: ahora(), ...fila };
        try { await db.collection('coordinadorAcciones').add(f); } catch (e) { console.error('coordinadorAcciones', e); }
        ctx.acciones.push({ herramienta: fila.herramienta, coleccion: fila.coleccion || '', docId: fila.docId || '', resumen: rec(fila.resumen, 160) });
    }
    const err = (m) => ({ error: m });
    const movimiento = (instalacionId, d, estado, nota, ctx) => db.collection('movimientosInstalaciones').add({ instalacionId, cliente: d.cliente || '', obra: d.obra || '', estado, nota, por: NOMBRE, porEmail: ctx.porEmail, fecha: ahora() });

    async function ejecutar(nombre, input, ctx) {
        const i = input || {};
        switch (nombre) {
            case 'consultar_panel': {
                if (!COLECCIONES_LECTURA.includes(i.coleccion)) return err('colección no permitida: ' + i.coleccion);
                const filtros = (Array.isArray(i.filtros) ? i.filtros : []).map((f) => [f.campo, f.op, f.valor]);
                const docs = await lector.consultar(i.coleccion, filtros, Math.min(+i.limite || 40, 120));
                const out = docs.map((d) => compactar(i.coleccion, d)).map((d) => Array.isArray(i.campos) && i.campos.length ? Object.fromEntries(['_id', ...i.campos].filter((k) => k in d).map((k) => [k, d[k]])) : d);
                return { total: out.length, documentos: out };
            }
            case 'obtener_documento': {
                if (!COLECCIONES_LECTURA.includes(i.coleccion)) return err('colección no permitida: ' + i.coleccion);
                const d = await lector.obtener(i.coleccion, String(i.id || ''));
                return d ? compactar(i.coleccion, d) : err('no existe ' + i.coleccion + '/' + i.id);
            }
            case 'reprogramar_trabajo': {
                const ref = db.doc('instalaciones/' + String(i.instalacionId || '')); const s = await ref.get();
                if (!s.exists) return err('no existe el trabajo ' + i.instalacionId);
                const d = s.data(); if (d.estado === 'completado') return err('el trabajo está completado; no se reprograma');
                const sinFecha = !String(i.fecha || '').trim(); const f = sinFecha ? null : fechaRD(i.fecha);
                if (!sinFecha && !f) return err('fecha inválida (usa AAAA-MM-DD o AAAA-MM-DDTHH:MM): ' + i.fecha);
                const cambios = { fecha: f ? Timestamp.fromDate(f) : null, modoFecha: sinFecha ? 'sin_fecha' : 'unica', fechaFin: null, recordatoriosEnviados: [], reprogramadoPor: NOMBRE, reprogramadoFecha: ahora() };
                if (d.fecha && !d.fechaOriginal) cambios.fechaOriginal = d.fecha;
                await ref.update(cambios);
                const nota = `Reprogramado por el Coordinador (pedido de ${ctx.por} en Mensajería): ${sinFecha ? 'queda sin fecha' : 'nueva fecha ' + coord.fechaTxt(f)}${d.fecha ? ' (antes ' + coord.fechaTxt(d.fecha) + ')' : ''}. Motivo: ${rec(i.motivo, 200)}`;
                await movimiento(s.id, d, d.estado || 'pendiente', nota, ctx);
                await registrar(ctx, { herramienta: nombre, coleccion: 'instalaciones', docId: s.id, entrada: i, antes: { fecha: coord.fechaTxt(d.fecha), modoFecha: d.modoFecha || '' }, resumen: `${d.cliente} — ${d.obra}: ${nota}` });
                return { ok: true, trabajo: `${d.cliente} — ${d.obra}`, fechaNueva: f ? coord.fechaTxt(f) : 'sin fecha', fechaAnterior: coord.fechaTxt(d.fecha) || 'sin fecha' };
            }
            case 'anotar_trabajo': {
                const ref = db.doc('instalaciones/' + String(i.instalacionId || '')); const s = await ref.get();
                if (!s.exists) return err('no existe el trabajo ' + i.instalacionId);
                const d = s.data(); const linea = `[Coordinador ${ddmm()}] ${rec(i.nota, 400)}`;
                await ref.update({ notas: [d.notas, linea].filter(Boolean).join('\n') });
                await movimiento(s.id, d, d.estado || 'pendiente', 'Nota del Coordinador (pedido de ' + ctx.por + '): ' + rec(i.nota, 300), ctx);
                await registrar(ctx, { herramienta: nombre, coleccion: 'instalaciones', docId: s.id, entrada: i, resumen: `${d.cliente} — ${d.obra}: ${linea}` });
                return { ok: true, trabajo: `${d.cliente} — ${d.obra}`, nota: linea };
            }
            case 'cambiar_estado_pedido': {
                if (!ESTADOS_FABRICA.includes(i.status)) return err('estado no permitido: ' + i.status);
                const ref = db.doc('orders/' + String(i.orderId || '')); const s = await ref.get();
                if (!s.exists) return err('no existe el pedido ' + i.orderId);
                const o = s.data();
                if (!ESTADOS_FABRICA.includes(o.status)) return err(`el pedido está en «${o.status}»; solo se mueve entre estados de fábrica (lo demás lo hace la oficina en Historial)`);
                if (o.docType === 'COMPRA_DIRECTA') return err('una compra directa no pasa por fábrica');
                if (o.status === i.status) return { ok: true, sinCambio: true, status: o.status };
                const cambios = { status: i.status, estadoManualPor: NOMBRE, estadoManualPorEmail: ctx.porEmail, estadoManualFecha: ahora(), estadoManualDesde: o.status || null, estadoManualMotivo: rec(i.motivo, 300) };
                if (FECHA_ESTADO[i.status] && !o[FECHA_ESTADO[i.status]]) cambios[FECHA_ESTADO[i.status]] = ahora();
                await ref.update(cambios);
                await registrar(ctx, { herramienta: nombre, coleccion: 'orders', docId: s.id, entrada: i, antes: { status: o.status }, resumen: `${o.cliente} — ${o.obra}: ${o.status} → ${i.status} (${rec(i.motivo, 120)})` });
                return { ok: true, pedido: `${o.cliente} — ${o.obra}`, de: o.status, a: i.status };
            }
            case 'fijar_salida_pedido': {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(i.fecha || ''))) return err('fecha inválida (AAAA-MM-DD): ' + i.fecha);
                const ref = db.doc('orders/' + String(i.orderId || '')); const s = await ref.get();
                if (!s.exists) return err('no existe el pedido ' + i.orderId);
                const o = s.data();
                if (!ESTADOS_FABRICA.includes(o.status)) return err(`el pedido está en «${o.status}», no en fábrica`);
                const cambios = { fechaSalidaEstimada: i.fecha, fechaSalidaPor: NOMBRE, fechaSalidaFecha: ahora() };
                if (!o.fechaSalidaEstimadaOriginal) cambios.fechaSalidaEstimadaOriginal = o.fechaSalidaEstimada || i.fecha;
                if (o.fechaSalidaEstimada && o.fechaSalidaEstimada !== i.fecha) cambios.fechaSalidaCambios = FieldValue.arrayUnion({ de: o.fechaSalidaEstimada, a: i.fecha, por: NOMBRE + ' (pedido de ' + ctx.por + ')', cuando: new Date().toISOString(), motivo: rec(i.motivo, 200) });
                await ref.update(cambios);
                await registrar(ctx, { herramienta: nombre, coleccion: 'orders', docId: s.id, entrada: i, antes: { fechaSalidaEstimada: o.fechaSalidaEstimada || '' }, resumen: `${o.cliente} — ${o.obra}: salida ${o.fechaSalidaEstimada || '—'} → ${i.fecha}` });
                return { ok: true, pedido: `${o.cliente} — ${o.obra}`, de: o.fechaSalidaEstimada || null, a: i.fecha };
            }
            case 'instruccion_fabrica': {
                const ref = db.doc('orders/' + String(i.orderId || '')); const s = await ref.get();
                if (!s.exists) return err('no existe el pedido ' + i.orderId);
                const o = s.data(); const texto = rec(i.texto, 600); if (!texto) return err('texto vacío');
                await ref.update({ comentarioParaFabrica: texto, comentarioParaFabricaPor: NOMBRE + ' (pedido de ' + ctx.por + ')', comentarioParaFabricaFecha: ahora(), comentarioParaFabricaAtendido: false });
                await registrar(ctx, { herramienta: nombre, coleccion: 'orders', docId: s.id, entrada: i, antes: { comentarioParaFabrica: rec(o.comentarioParaFabrica, 200) }, resumen: `${o.cliente} — ${o.obra} (${o.destino || 'alucufel'}): ${texto}` });
                return { ok: true, pedido: `${o.cliente} — ${o.obra}`, destino: o.destino || 'alucufel', instruccion: texto };
            }
            case 'crear_recordatorio': {
                const para = (Array.isArray(i.para) ? i.para : []).map(low).filter((e) => ctx.equipo.has(e));
                if (!para.length) return err('ningún correo válido del equipo en «para»');
                const f = String(i.fecha || '').trim() ? fechaRD(i.fecha) : null;
                if (String(i.fecha || '').trim() && !f) return err('fecha inválida: ' + i.fecha);
                const asignados = para.map((e) => ({ email: e, nombre: ctx.equipo.get(e).nombre || e }));
                const soloObra = para.every((e) => (ctx.equipo.get(e).rol || []).every((r) => ROLES_OBRA.includes(r)));
                const datos = { tipo: 'recordatorio', titulo: rec(i.titulo, 140), descripcion: rec(i.descripcion, 600), fecha: f ? Timestamp.fromDate(f) : null, sinFecha: !f, duracionMin: 0,
                    orderId: i.orderId || null, cliente: rec(i.cliente, 80), obra: rec(i.obra, 80), asignadoA: soloObra ? 'instalador' : 'gerente', asignados, etapas: [], completada: false, completadoPor: [],
                    creadoPorNombre: NOMBRE + ' (pedido de ' + ctx.por + ')', recordatorios: f ? [0] : [], recordatoriosEnviados: [], recordatoriosPendientes: !!f, repetir: 'no', repetirGenerado: false,
                    origen: 'coordinador_chat', respuestaId: ctx.respuestaId, fechaCreacion: ahora() };
                const ref = await db.collection('citas').add(datos);
                await registrar(ctx, { herramienta: nombre, coleccion: 'citas', docId: ref.id, entrada: i, resumen: `${datos.titulo} → ${asignados.map((a) => a.nombre).join(', ')}${f ? ' el ' + coord.fechaTxt(f) : ' (sin fecha)'}` });
                return { ok: true, id: ref.id, para: asignados.map((a) => a.nombre), fecha: f ? coord.fechaTxt(f) : 'sin fecha' };
            }
            case 'mensaje_interno': {
                const para = [...new Set((Array.isArray(i.para) ? i.para : []).map(low).filter((e) => ctx.equipo.has(e)))];
                if (!para.length) return err('ningún correo válido del equipo en «para»');
                const asunto = rec(i.asunto, 120) || 'Aviso del Coordinador de Obras'; const cuerpo = String(i.cuerpo || '').trim().slice(0, 2000);
                if (!cuerpo) return err('cuerpo vacío');
                const ref = await db.collection('mensajes').add({ estado: 'enviado', asunto, cuerpo: cuerpo + `\n\n— ${NOMBRE}, a pedido de ${ctx.por} (respuesta al informe matinal).`, remitenteEmail: REMITENTE, remitenteNombre: NOMBRE, fecha: ahora(), paraTodos: false, destinatarios: para, requiereFirma: false, adjuntos: [], acuses: {}, tipo: 'aviso_coordinador', respuestaId: ctx.respuestaId, informeId: ctx.informeId });
                await registrar(ctx, { herramienta: nombre, coleccion: 'mensajes', docId: ref.id, entrada: i, resumen: `«${asunto}» → ${para.map((e) => ctx.equipo.get(e).nombre || e).join(', ')}` });
                return { ok: true, id: ref.id, para: para.map((e) => ctx.equipo.get(e).nombre || e) };
            }
            case 'anotar_leccion': {
                const t = rec(i.texto, 700); if (t.length < 8) return err('lección demasiado corta');
                const ref = db.doc('coordinadorConfig/lecciones'); const s = await ref.get(); const d = s.exists ? s.data() : {};
                const linea = `- (${ddmm()}, ${ctx.por} vía Mensajería) ${t}`;
                const base = (d.texto && d.texto.trim()) ? d.texto.trimEnd() : coord.LECCIONES_BASE;
                await ref.set({ texto: base + '\n' + linea, actualizado: ahora(), actualizadoPor: ctx.por, historial: FieldValue.arrayUnion({ fecha: new Date().toISOString(), por: ctx.por, origen: 'chat', respuestaId: ctx.respuestaId, texto: linea }) }, { merge: true });
                await registrar(ctx, { herramienta: nombre, coleccion: 'coordinadorConfig', docId: 'lecciones', entrada: i, resumen: linea });
                return { ok: true, leccion: linea, nota: 'el informe matinal de mañana ya la tendrá en cuenta' };
            }
            case 'crear_trabajo': {
                const TIPOS = ['instalacion', 'reparacion_artal', 'servicio_post', 'medicion', 'reemplazo_dano', 'preparacion_obra', 'reparacion_otra', 'preparacion_taller', 'levantamiento', 'servicio_dominique'];
                const tipo = String(i.tipoTrabajo || '').trim(); if (!TIPOS.includes(tipo)) return err('tipoTrabajo inválido: ' + tipo);
                const cliente = rec(i.cliente, 80), obra = rec(i.obra, 120); if (!cliente || !obra) return err('faltan cliente u obra');
                if (/https?:\/\/|maps\.app|google\.[a-z]+\/maps|waze|^-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/i.test(obra)) return err('«obra» no puede ser un GPS ni un enlace; ponlos en «gps»');
                const sinFecha = !String(i.fecha || '').trim(); const f = sinFecha ? null : fechaRD(i.fecha);
                if (!sinFecha && !f) return err('fecha inválida (usa AAAA-MM-DD o AAAA-MM-DDTHH:MM): ' + i.fecha);
                // asignados: solo correos del equipo con rol de obra; sin ninguno válido, el trabajo nace sin asignar (Instalación lo muestra para que alguien lo tome)
                const asignados = (Array.isArray(i.asignados) ? i.asignados : []).map(low).filter((e) => ctx.equipo.has(e) && (ctx.equipo.get(e).rol || []).some((r) => ROLES_OBRA.includes(r))).map((e) => ({ email: e, nombre: ctx.equipo.get(e).nombre || e }));
                // no duplicar: ¿ya hay un trabajo abierto de la misma obra y tipo?
                const abiertos = (await lector.consultar('instalaciones', [['estado', '!=', 'completado']], 400)).filter((t) => (t.tipoTrabajo || (t.orderId ? 'instalacion' : '')) === tipo && mismaObra && mismaObra(t.cliente, t.obra, cliente, obra));
                if (abiertos.length) return err(`ya existe un trabajo abierto de ese tipo para ${cliente} — ${obra} (id ${abiertos[0]._id}, estado ${abiertos[0].estado}${abiertos[0].fecha ? ', ' + coord.fechaTxt(abiertos[0].fecha) : ''}): usa reprogramar_trabajo o anotar_trabajo`);
                // pedido: obligatorio para instalación y preparación de obra (el pedido sigue al trabajo); referencia para los demás
                let orderId = String(i.orderId || '').trim() || null;
                if (!orderId) {
                    const pedidos = (await lector.consultar('orders', [['status', 'in', ['pendiente_fabrica', 'en_fabrica', 'parcialmente_listo', 'listo_para_cargar']]], 300)).filter((o) => o.docType !== 'COMPRA_DIRECTA' && mismaObra && mismaObra(o.cliente, o.obra, cliente, obra));
                    if (pedidos.length === 1) orderId = pedidos[0]._id;
                    else if (pedidos.length > 1 && (tipo === 'instalacion' || tipo === 'preparacion_obra')) return err('hay varios pedidos abiertos de esa obra: ' + pedidos.map((o) => o._id + ' (' + (o.docType || '') + ', ' + o.status + ')').join('; ') + ' — indica orderId');
                }
                if ((tipo === 'instalacion' || tipo === 'preparacion_obra') && !orderId) return err('para ' + tipo + ' hace falta un pedido de fabricación abierto de esa obra y no encontré ninguno; crea el trabajo con otro tipo o pide a la oficina que mande el pedido a fábrica');
                const notas = [rec(i.notas, 1500), `Creado por el Coordinador de Obras a pedido de ${ctx.por} (${coord.fechaTxt(new Date())}).`].filter(Boolean).join('\n');
                const datos = { cliente, obra, direccion: rec(i.direccion, 200), gps: rec(i.gps, 200), modoFecha: sinFecha ? 'sin_fecha' : 'unica', fecha: f ? Timestamp.fromDate(f) : null, fechaFin: null,
                    asignados, instaladorEmail: asignados.length ? asignados[0].email : '', instaladorNombre: asignados.length ? asignados[0].nombre : '',
                    estado: 'pendiente', notas, recordatorios: [], recordatoriosEnviados: [], recordatoriosPendientes: false, tipoTrabajo: tipo,
                    orderId: tipo === 'instalacion' ? orderId : null, ...(tipo === 'instalacion' && orderId ? { orderIds: [orderId] } : {}), ...(tipo !== 'instalacion' && orderId ? { pedidoReferenciaId: orderId } : {}),
                    fotos: [], comentariosInstalador: [], origen: 'coordinador_chat', respuestaId: ctx.respuestaId, creadoPorNombre: NOMBRE + ' (pedido de ' + ctx.por + ')', fechaCreacion: ahora() };
                const ref = await db.collection('instalaciones').add(datos);
                await movimiento(ref.id, datos, 'pendiente', `Trabajo creado por el Coordinador (pedido de ${ctx.por} en Mensajería): ${tipo}${f ? ' el ' + coord.fechaTxt(f) : ' sin fecha'}${asignados.length ? ' · ' + asignados.map((a) => a.nombre).join(', ') : ''}`, ctx);
                await registrar(ctx, { herramienta: nombre, coleccion: 'instalaciones', docId: ref.id, entrada: i, resumen: `${cliente} — ${obra} · ${tipo}${f ? ' el ' + coord.fechaTxt(f) : ' (sin fecha)'}${asignados.length ? ' · ' + asignados.map((a) => a.nombre).join(', ') : ''}` });
                return { ok: true, id: ref.id, trabajo: `${cliente} — ${obra}`, tipo, fecha: f ? coord.fechaTxt(f) : 'sin fecha', asignados: asignados.map((a) => a.nombre), pedido: orderId || 'ninguno' };
            }
            case 'asignar_equipo': {
                const ref = db.doc('instalaciones/' + String(i.instalacionId || '')); const s = await ref.get();
                if (!s.exists) return err('no existe el trabajo ' + i.instalacionId);
                const d = s.data(); if (d.estado === 'completado') return err('el trabajo está completado; no se cambia el equipo');
                const pedidos = (Array.isArray(i.asignados) ? i.asignados : []).map(low);
                const noValidos = pedidos.filter((e) => !ctx.equipo.has(e) || !(ctx.equipo.get(e).rol || []).some((r) => ROLES_OBRA.includes(r)));
                if (noValidos.length) return err('no son del equipo de obra (usa los correos de la lista EQUIPO con rol instalador/ayudante/chofer): ' + noValidos.join(', '));
                const nuevos = pedidos.map((e) => ({ email: e, nombre: ctx.equipo.get(e).nombre || e }));
                const previos = Array.isArray(d.asignados) ? d.asignados.filter((a) => a && a.email) : (d.instaladorEmail ? [{ email: d.instaladorEmail, nombre: d.instaladorNombre || '' }] : []);
                const final = i.modo === 'sumar' ? previos.concat(nuevos.filter((n) => !previos.some((p) => low(p.email) === n.email))) : nuevos;
                if (!final.length) return err('la lista quedó vacía: indica al menos una persona');
                await ref.update({ asignados: final, instaladorEmail: final[0].email, instaladorNombre: final[0].nombre || '', asignadoPor: NOMBRE, asignadoPorEmail: ctx.porEmail, asignadoFecha: ahora() });
                const nom = (l) => l.map((a) => a.nombre || a.email).join(', ');
                const nota = `Equipo asignado por el Coordinador (pedido de ${ctx.por} en Mensajería): ${nom(final)}${previos.length ? ' (antes: ' + nom(previos) + ')' : ''}${i.motivo ? '. ' + rec(i.motivo, 160) : ''}`;
                await movimiento(s.id, d, d.estado || 'pendiente', nota, ctx);
                await registrar(ctx, { herramienta: nombre, coleccion: 'instalaciones', docId: s.id, entrada: i, antes: { asignados: previos }, resumen: `${d.cliente} — ${d.obra}: ${nota}` });
                return { ok: true, trabajo: `${d.cliente} — ${d.obra}`, fecha: coord.fechaTxt(d.fecha) || 'sin fecha', equipo: nom(final), antes: previos.length ? nom(previos) : 'nadie' };
            }
            case 'marcar_entrega_externa': {
                const ref = db.doc('orders/' + String(i.orderId || '')); const s = await ref.get();
                if (!s.exists) return err('no existe el pedido ' + i.orderId);
                const o = s.data();
                if (o.entregado === true) return err(`${o.cliente} — ${o.obra} ya está marcado como entregado`);
                if (!['listo_para_cargar', 'parcialmente_listo'].includes(o.status)) return err(`${o.cliente} — ${o.obra} no está listo para cargar (estado ${o.status}); fábrica tiene que marcarlo listo antes`);
                const f = String(i.fecha || '').trim() ? fechaRD(i.fecha) : null;
                if (String(i.fecha || '').trim() && !f) return err('fecha inválida (usa AAAA-MM-DD): ' + i.fecha);
                const quien = rec(i.quienTrajo, 120), donde = rec(i.donde, 120);
                const notaEntrega = `Material entregado sin el camión de ARTAL: lo trajo ${quien}${donde ? ' hasta ' + donde : ''}${f ? ' el ' + coord.fechaTxt(f) : ''}. Marcado por el Coordinador a pedido de ${ctx.por}.`;
                await ref.update({ entregado: true, fechaEntregado: f ? Timestamp.fromDate(f) : ahora(), transporteExterno: true, enRuta: false, restoEnRuta: false,
                    recepcionInstalador: { nombre: quien, firma: null, fecha: ahora() }, notaEntrega, entregadoPorCoordinador: { por: ctx.por, porEmail: ctx.porEmail, fecha: ahora() },
                    entregas: FieldValue.arrayUnion({ fechaISO: (f || new Date()).toISOString(), recibio: quien, chofer: 'transporte externo', resto: '' }) });
                await registrar(ctx, { herramienta: nombre, coleccion: 'orders', docId: s.id, entrada: i, antes: { entregado: o.entregado === true, enRuta: o.enRuta === true }, resumen: `${o.cliente} — ${o.obra}: ${notaEntrega}` });
                return { ok: true, pedido: `${o.cliente} — ${o.obra}`, entregado: true, quienTrajo: quien, donde: donde || 'no indicado', nota: 'la instalación sigue su curso; no se completó el pedido' };
            }
            case 'redactar_para_cliente': {
                const nombre = rec(i.cliente, 80); const texto = String(i.texto || '').trim().slice(0, 1500);
                if (!texto) return err('texto vacío');
                let tel = '', ficha = null;
                try {
                    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
                    const todos = await lector.consultar('clientes', [], 400);
                    ficha = todos.find((c) => norm(c.nombre) === norm(nombre) || norm(c.nombreFacturacion) === norm(nombre) || (Array.isArray(c.alias) && c.alias.some((a) => norm(a) === norm(nombre))))
                        || todos.find((c) => norm(c.nombre) && (norm(nombre).includes(norm(c.nombre)) || norm(c.nombre).includes(norm(nombre))));
                    tel = ficha ? String(ficha.telefono || '').replace(/\D/g, '') : '';
                    if (tel.length === 10) tel = '1' + tel;
                } catch (_) { }
                const enlace = tel.length >= 11 ? `https://wa.me/${tel}?text=${encodeURIComponent(texto)}` : '';
                await registrar(ctx, { herramienta: 'redactar_para_cliente', coleccion: '', docId: ficha ? ficha._id : '', entrada: i, resumen: `Mensaje redactado (NO enviado) para ${nombre}: ${rec(texto, 120)}` });
                return { ok: true, enviado: false, cliente: nombre, idioma: ficha && ficha.idioma ? ficha.idioma : (i.idioma || 'no registrado'), telefono: tel || 'sin teléfono en la ficha', enlace: enlace || 'sin enlace (la ficha no tiene teléfono: mándalo a mano)', texto, aviso: 'Incluye el texto y el enlace en PENDIENTE DE TI; lo manda una persona.' };
            }
            default: return err('herramienta desconocida: ' + nombre);
        }
    }

    async function llamarClaude(apiKey, system, messages) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: coord.MODELO, max_tokens: 3000, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], tools: HERRAMIENTAS, messages }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + JSON.stringify(j).slice(0, 300));
        return j;
    }

    // Núcleo: procesa una respuesta ya leída. Devuelve { texto, acciones, uso }.
    async function procesar(respuestaId, r, apiKey) {
        const informe = await lector.obtener('mensajes', String(r.informeId || ''));
        if (!informe || informe.tipo !== 'informe_coordinador') throw Object.assign(new Error('el mensaje al que respondes no es un informe del Coordinador'), { rechazo: true });
        const porEmail = low(r.porEmail);
        const u = await lector.obtener('usuarios', porEmail);
        const roles = u ? (Array.isArray(u.rol) ? u.rol : [u.rol]) : [];
        const esAdmin = roles.includes('admin') && u.activo !== false && u.cuentaPrueba !== true;
        const esDest = (informe.destinatarios || []).map(low).includes(porEmail);
        if (!esAdmin && !esDest) throw Object.assign(new Error('solo los destinatarios del informe o un admin pueden responderle'), { rechazo: true });

        const hoy = coord.ymdRD();
        const [lecc, datos, equipoDocs, hilo] = await Promise.all([
            coord.cargarLecciones(lector), coord.recogerDatos(lector, hoy), lector.consultar('equipo', [], 60),
            lector.consultar('coordinadorRespuestas', [['informeId', '==', r.informeId]], 40),
        ]);
        const equipo = new Map(equipoDocs.filter((e) => e.activo !== false && e.nombre).map((e) => [low(e._id), { nombre: e.nombre, rol: Array.isArray(e.rol) ? e.rol : [e.rol].filter(Boolean) }]));
        const equipoTxt = [...equipo.entries()].map(([e, v]) => `- ${v.nombre} <${e}> (${v.rol.join(', ') || 'sin rol'})`).join('\n');
        const previas = hilo.filter((h) => h._id !== respuestaId && h.estado !== 'pendiente').sort((a, b) => (String(a.fecha) < String(b.fecha) ? -1 : 1))
            .map((h) => `- [${coord.fechaTxt(h.fecha)}] ${h.por}: «${rec(h.texto, 300)}»${h.resultado ? '\n  → Coordinador: ' + rec(h.resultado, 500) : ''}`).join('\n');
        const { informeAnterior, _todosLosCompletados, ...resto } = datos;

        const contexto = `FECHA Y HORA: ${hoy} ${coord.horaRD()} (hora de Santo Domingo).\n\n` +
            `INFORME AL QUE RESPONDE (${informe.asunto}, publicado ${coord.fechaTxt(informe.fecha)}):\n${informe.cuerpo || ''}\n\n` +
            (previas ? `HILO ANTERIOR DE ESTE INFORME:\n${previas}\n\n` : '') +
            `ESTADO ACTUAL DEL PANEL (JSON, igual que el que recibe el informe; los ids son los reales):\n${JSON.stringify(resto)}\n\n` +
            `TRABAJOS COMPLETADOS RECIENTES (para no actuar sobre cosas ya hechas): ${JSON.stringify((_todosLosCompletados || []).slice(-60))}`;
        const pedido = `RESPUESTA DE ${r.por || porEmail} <${porEmail}> AL INFORME:\n«${String(r.texto || '').trim()}»\n\nActúa según tus límites y contesta.`;
        const system = sistemaChat(lecc.texto, equipoTxt);
        const messages = [{ role: 'user', content: [{ type: 'text', text: contexto, cache_control: { type: 'ephemeral' } }, { type: 'text', text: pedido }] }];
        const ctx = { respuestaId, informeId: r.informeId, por: r.por || porEmail, porEmail, equipo, acciones: [] };
        const uso = { input: 0, output: 0, cacheRead: 0, cacheCreacion: 0, llamadas: 0 };   // input = tokens sin caché; el contexto grande va a cacheCreacion en la 1ª llamada y a cacheRead en las siguientes
        let texto = '', pasos = 0, cortado = false;
        for (let ronda = 0; ronda < MAX_PASOS + 2; ronda++) {
            const j = await llamarClaude(apiKey, system, messages);
            uso.llamadas++; if (j.usage) { uso.input += j.usage.input_tokens || 0; uso.output += j.usage.output_tokens || 0; uso.cacheRead += j.usage.cache_read_input_tokens || 0; uso.cacheCreacion += j.usage.cache_creation_input_tokens || 0; }
            const bloques = j.content || [];
            messages.push({ role: 'assistant', content: bloques });
            const usos = bloques.filter((b) => b.type === 'tool_use');
            if (j.stop_reason !== 'tool_use' || !usos.length) {
                texto = bloques.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
                cortado = j.stop_reason === 'max_tokens';
                break;
            }
            const resultados = [];
            for (const u2 of usos) {
                let res;
                if (pasos >= MAX_PASOS) res = err('límite de ' + MAX_PASOS + ' herramientas alcanzado: resume y contesta');
                else { pasos++; try { res = await ejecutar(u2.name, u2.input, ctx); } catch (e) { console.error('herramienta', u2.name, e); res = err(String(e.message || e)); } }
                resultados.push({ type: 'tool_result', tool_use_id: u2.id, content: txt(res), is_error: !!(res && res.error) });
            }
            messages.push({ role: 'user', content: resultados });
        }
        texto = sinIds(texto);
        if (!texto) texto = 'No llegué a una respuesta clara' + (ctx.acciones.length ? ', pero hice esto: ' + ctx.acciones.map((a) => a.resumen).join(' · ') : '') + '. Vuelve a pedirlo con más detalle.';
        if (cortado) texto += '\n\n(respuesta cortada por longitud)';
        return { texto, acciones: ctx.acciones, uso, informe, lecciones: lecc.origen, pasos };
    }

    return {
        coordinadorRespuestaProcesar: onDocumentCreated({ document: 'coordinadorRespuestas/{id}', secrets: [anthropicKey], timeoutSeconds: 540, memory: '1GiB' }, async (event) => {
            const snap = event.data; if (!snap) return;
            const r = snap.data(); const id = event.params.id;
            if (r.estado && r.estado !== 'pendiente') return;
            await snap.ref.update({ estado: 'procesando', inicio: ahora() });
            const porEmail = low(r.porEmail);
            try {
                const res = await procesar(id, r, anthropicKey.value());
                // Solo gerencia + Wilson + quien preguntó: los LECTORES del informe (Miki, Roosevelt, Emerson) no reciben el hilo del chat.
                const dest = [...new Set([...coord.DESTINATARIOS.map(low), porEmail].filter(Boolean))];
                const cuerpo = `${res.texto}\n\n— Respuesta a ${r.por || porEmail}: «${rec(r.texto, 120)}»`;
                const msg = await db.collection('mensajes').add({ estado: 'enviado', asunto: '↩️ ' + (res.informe.asunto || 'Informe matinal'), cuerpo, remitenteEmail: REMITENTE, remitenteNombre: NOMBRE, fecha: ahora(), paraTodos: false, destinatarios: dest, requiereFirma: false, adjuntos: [], acuses: {}, tipo: 'respuesta_coordinador', enRespuestaA: r.informeId, respuestaId: id, respuestaPor: r.por || porEmail, acciones: res.acciones.length, generadoPor: 'cloud-function', modelo: coord.MODELO, tokens: res.uso });
                await snap.ref.update({ estado: 'procesada', fin: ahora(), resultado: res.texto, mensajeId: msg.id, acciones: res.acciones, tokens: res.uso, leccionesOrigen: res.lecciones, pasos: res.pasos });
                console.log('coordinadorRespuestaProcesar', id, 'ok', res.acciones.length, 'acciones', JSON.stringify(res.uso));
            } catch (e) {
                console.error('coordinadorRespuestaProcesar', id, e);
                const rechazo = e && e.rechazo === true; const motivo = String((e && e.message) || e);
                try {
                    await snap.ref.update({ estado: rechazo ? 'rechazada' : 'error', fin: ahora(), resultado: motivo });
                    await db.collection('mensajes').add({ estado: 'enviado', asunto: '↩️ ' + (r.informeAsunto || 'Informe matinal'), cuerpo: (rechazo ? '⛔ No puedo atender esa respuesta: ' : '⚠️ No pude procesar tu respuesta («' + rec(r.texto, 120) + '»): ') + motivo + (rechazo ? '' : '\n\nVuelve a intentarlo en unos minutos o pídeselo al Coordinador en la app de Claude.'), remitenteEmail: REMITENTE, remitenteNombre: NOMBRE, fecha: ahora(), paraTodos: false, destinatarios: [porEmail].filter(Boolean), requiereFirma: false, adjuntos: [], acuses: {}, tipo: 'respuesta_coordinador', enRespuestaA: r.informeId || null, respuestaId: id, respuestaPor: r.por || porEmail, error: true });
                } catch (e2) { console.error('coordinadorRespuestaProcesar aviso de error', id, e2); }
            }
        }),
    };
};
module.exports.HERRAMIENTAS = HERRAMIENTAS;
module.exports.sistemaChat = sistemaChat;
module.exports.fechaRD = fechaRD;
