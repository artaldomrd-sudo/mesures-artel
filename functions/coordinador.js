'use strict';
// Coordinador de Obras — informe matinal como Cloud Function (Dylan 2026-10-30: «vamos a pasar el informe a una cloud function»
// para que no dependa de tener la app de escritorio abierta a las 7:50). Antes lo generaba una rutina local de la app de Claude
// (`.claude/scheduled-tasks/coordinador-obras-matinal`, que queda solo para lanzarlo a mano) con el agente
// `.claude/agents/coordinador-obras.md` + `coordinador-obras.datos.md`. Esta función hace lo mismo en el servidor:
//   1. junta los datos del panel (trabajos, pedidos, cotizaciones, partes, viajes, recordatorios, anticipos sin obra, vacaciones),
//   2. pide el pronóstico a Open-Meteo (Las Terrenas + GPS de cada trabajo próximo),
//   3. le pide a Claude el informe con el mismo guion y las mismas lecciones aprendidas,
//   4. lo publica en Mensajería a Wilson y Dylan (`mensajes`, tipo `informe_coordinador`; el push lo manda `mensajePush`).
// Solo lectura del panel salvo ese mensaje. Un informe por día (si ya existe el asunto de hoy, no repite). No corre domingos ni
// feriados que no estén en `rrhhFeriadosTrabajados`.
//
// `generarInforme({ lector, ... })` recibe un lector abstracto ({consultar, obtener}) para poder probarlo en local con el REST de
// `scripts/ops/fs-rest.js` (el Admin SDK no acepta la credencial de firebase-tools); en la función se usa el Admin SDK.

const DESTINATARIOS = ['wilsonhernandezrodriguez81@gmail.com', 'dylan.r.rd@gmail.com'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_SEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const LAS_TERRENAS = { lat: 19.31, lng: -69.54 };
const TZ = 'America/Santo_Domingo';
const MODELO = 'claude-sonnet-4-6';

// ---------- fechas (RD = UTC−4 todo el año) ----------
const msRD = (d) => (d instanceof Date ? d.getTime() : Date.parse(d)) - 4 * 3600e3;
const ymdRD = (d = new Date()) => new Date(msRD(d)).toISOString().slice(0, 10);
const horaRD = (d = new Date()) => new Date(msRD(d)).toISOString().slice(11, 16);
const sumarDias = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const diaSemana = (ymd) => new Date(ymd + 'T12:00:00Z').getUTCDay();
const asuntoDe = (ymd) => `🗓️ Informe matinal — ${DIAS[diaSemana(ymd)]} ${+ymd.slice(8, 10)} de ${MESES[+ymd.slice(5, 7) - 1]}`;
const etiqueta = (ymd) => `${DIAS_SEM[diaSemana(ymd)]} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
// Cualquier representación de fecha (Timestamp, ISO, {seconds}) → ISO corto en hora RD, o ''.
function fechaTxt(v) {
    if (!v) return '';
    let ms = null;
    if (v.toDate) ms = v.toDate().getTime();
    else if (typeof v === 'object' && v.seconds != null) ms = v.seconds * 1000;
    else if (typeof v === 'object' && v._seconds != null) ms = v._seconds * 1000;
    else if (typeof v === 'string') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; ms = Date.parse(v); }
    else if (typeof v === 'number') ms = v;
    if (ms == null || isNaN(ms)) return typeof v === 'string' ? v.slice(0, 16) : '';
    const d = new Date(ms - 4 * 3600e3).toISOString();
    return d.slice(11, 16) === '00:00' ? d.slice(0, 10) : d.slice(0, 16).replace('T', ' ');
}
const rec = (s, n) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, n));
const nombres = (arr) => (Array.isArray(arr) ? arr.map((a) => (a && (a.nombre || a.email)) || a).filter(Boolean).join(', ') : '');

// ---------- datos del panel ----------
async function recogerDatos(lector, hoy) {
    const ayer = sumarDias(hoy, diaSemana(hoy) === 1 ? -2 : -1);           // lunes mira el sábado
    const antes = sumarDias(ayer, diaSemana(ayer) === 1 ? -2 : -1);
    const [abiertos, completados, pedidos, cotiz, partes, viajes, citas, antic, vacas, feriados, feriadosTrab, informePrevio] = await Promise.all([
        lector.consultar('instalaciones', [['estado', '!=', 'completado']], 400),
        lector.consultar('instalaciones', [['estado', '==', 'completado']], 400),
        lector.consultar('orders', [['status', 'in', ['pendiente_fabrica', 'en_fabrica', 'parcialmente_listo', 'listo_para_cargar']]], 300),
        lector.consultar('orders', [['status', 'in', ['solicitada', 'costeada', 'enviada_cliente']]], 300),
        lector.consultar('partesDiarios', [['fecha', 'in', [ayer, antes, hoy]]], 60),
        lector.consultar('viajes', [], 400),
        lector.consultar('citas', [['completada', '==', false]], 400),
        lector.consultar('anticiposCitrus', [['estado', '==', 'pendiente']], 50),
        lector.consultar('rrhhVacaciones', [], 200),
        lector.consultar('rrhhFeriados', [], 100),
        lector.consultar('rrhhFeriadosTrabajados', [], 100),
        lector.consultar('mensajes', [['tipo', '==', 'informe_coordinador']], 60),
    ]);
    const hace3 = sumarDias(hoy, -3), mas3 = sumarDias(hoy, 3);
    const trabajo = (t) => ({
        id: t._id, cliente: t.cliente, obra: t.obra, estado: t.estado, tipo: t.tipoTrabajo || (t.orderId || (t.orderIds || []).length ? 'instalacion' : ''),
        fecha: fechaTxt(t.fecha), fechaFin: fechaTxt(t.fechaFin), inicioReal: fechaTxt(t.inicioReal), fechaOriginal: fechaTxt(t.fechaOriginal),
        asignados: nombres(t.asignados), pedidos: [t.orderId, ...(t.orderIds || [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i),
        notas: rec(t.notas, 220), direccion: rec(t.direccion, 80), gps: rec(t.gps, 40), origen: t.origen || '',
        retoma: Array.isArray(t.retomas) && t.retomas.length ? fechaTxt(t.retomas[t.retomas.length - 1]) : '',
        medicion: t.medicionEstado || '', validadoPor: t.validadoPor || '', validadoFecha: fechaTxt(t.validadoFecha), creado: fechaTxt(t.fechaCreacion),
        ultimoComentario: t.ultimoComentario ? rec((t.ultimoComentario.nombre ? t.ultimoComentario.nombre + ': ' : '') + (t.ultimoComentario.texto || ''), 160) : '',
    });
    const pedido = (o) => ({
        id: o._id, cliente: o.cliente, obra: o.obra, tipo: o.docType, status: o.status, destino: o.destino || '', items: o.totalItems || (o.items || []).length,
        fichaParcial: o.fichaParcial ? `${o.fichaParcial.enviados} de ${o.fichaParcial.total} ítems` : '',
        fechaSolicitud: fechaTxt(o.fechaCotizado || o.fechaSolicitada || o.fechaCreacion || o.fecha), enFabricaDesde: fechaTxt(o.fechaEnFabrica),
        salidaEstimada: o.fechaSalidaEstimada || '', listoDesde: fechaTxt(o.fechaListoParaCargar),
        enRuta: o.enRuta === true, entregado: o.entregado === true, instalado: o.instalado === true, transporteExterno: o.transporteExterno === true,
        pago: o.anticipo && o.anticipo.recibido ? (o.anticipo.tipo === 'completo' ? 'pagado completo' + (o.anticipo.facturaCitrus ? ' (fact. ' + o.anticipo.facturaCitrus + ')' : '') : 'anticipo ' + (o.anticipo.monto ? Math.round(o.anticipo.monto).toLocaleString('en-US') : '')) : 'sin anticipo registrado',
        instaladores: nombres(o.asignadosInstalador) || o.asignadoInstaladorNombre || '', chofer: o.asignadoChoferNombre || '',
        instruccionOficina: o.comentarioParaFabrica && !o.comentarioParaFabricaAtendido ? rec(o.comentarioParaFabrica, 160) : '',
        comentarioFabrica: o.comentarioFabrica && !o.comentarioFabricaAtendido ? rec(o.comentarioFabrica, 160) + (o.comentarioFabricaFecha ? ' (' + fechaTxt(o.comentarioFabricaFecha) + ')' : '') : '',
        proveedor: o.proveedor || '', pedidoVinculado: o.pedidoVinculadoObra || '', enviadoASuplidor: Array.isArray(o.enviadoASuplidor) && o.enviadoASuplidor.length ? o.enviadoASuplidor[o.enviadoASuplidor.length - 1].nombre + ' ' + fechaTxt(o.enviadoASuplidor[o.enviadoASuplidor.length - 1].fecha) : '',
        fechaEnviadaCliente: fechaTxt(o.fechaEnviadaCliente), fechaCosteada: fechaTxt(o.fechaCosteada),
    });
    const parte = (p) => ({
        fecha: p.fecha, encargado: p.encargadoNombre || p.encargado || '', borrador: p.borrador === true, enviado: fechaTxt(p.creado),
        incluidos: Array.isArray(p.incluidosEmails) ? p.incluidosEmails.length : (Array.isArray(p.personas) ? p.personas.length : ''),
        lineas: (Array.isArray(p.lineas) ? p.lineas : []).slice(0, 30).map((l) => rec([l.nombre || l.empleadoNombre || l.persona, l.obraLabel || l.obra || l.tipo, l.horas != null ? l.horas + ' h' : ''].filter(Boolean).join(' · '), 90)),
        nota: rec(p.nota, 160),
    });
    const abiertosC = abiertos.map(trabajo);
    const recientes = completados.map(trabajo).filter((t) => (t.validadoFecha || t.fechaFin || t.fecha).slice(0, 10) >= hace3);
    const viajesC = viajes.filter((v) => (v.fecha || '').slice(0, 10) >= hace3).map((v) => ({ fecha: fechaTxt(v.fecha), chofer: v.choferNombre || '', vehiculo: v.vehiculoNombre || v.vehiculoId || '', ruta: v.rutaNombre || '', obras: (v.obras || []).map((o) => o.obra || o.nombre || o).join(' | ') }));
    const citasC = citas.map((c) => ({ titulo: rec(c.titulo, 90), fecha: fechaTxt(c.fecha), para: nombres(c.asignados) || c.asignadoNombre || '', obra: [c.cliente, c.obra].filter(Boolean).join(' — '), tipo: c.tipo || '' }))
        .filter((c) => !c.fecha || c.fecha.slice(0, 10) <= mas3).slice(0, 60);
    const vacasC = vacas.filter((v) => (v.fechaInicio || '') <= mas3 && (v.fechaFin || '') >= hoy).map((v) => `${v.empleadoNombre || ''} ${v.fechaInicio} → ${v.fechaFin}`);
    const previos = informePrevio.map((m) => ({ asunto: m.asunto, fecha: fechaTxt(m.fecha), cuerpo: m.cuerpo || '' })).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    const previo = previos.find((m) => m.asunto !== asuntoDe(hoy));
    return {
        hoy, ayer, horaGeneracion: horaRD(),
        feriados: feriados.map((f) => f.fecha).filter(Boolean), feriadosTrabajados: feriadosTrab.map((f) => f.fecha || f._id).filter(Boolean),
        trabajosAbiertos: abiertosC, completadosRecientes: recientes, pedidosFabrica: pedidos.filter((o) => o.docType !== 'COMPRA_DIRECTA').map(pedido),
        comprasDirectas: pedidos.filter((o) => o.docType === 'COMPRA_DIRECTA').map(pedido), cotizaciones: cotiz.map(pedido),
        partes: partes.map(parte), viajesRecientes: viajesC, recordatoriosAbiertos: citasC,
        anticiposSinObra: antic.map((a) => ({ cliente: a.clienteNombre || a.cliente || '', monto: a.monto, fecha: a.fecha, descripcion: rec(a.descripcion, 120), candidatos: (a.candidatos || []).map((c) => c.obra || c.nombre || c).slice(0, 5) })),
        vacacionesVigentes: vacasC, informeAnterior: previo ? { asunto: previo.asunto, cuerpo: previo.cuerpo.slice(0, 7000) } : null,
        _todosLosCompletados: completados.map((t) => ({ cliente: t.cliente, obra: t.obra, fecha: fechaTxt(t.validadoFecha || t.fecha) })),
    };
}

// ---------- clima (port de scripts/ops/clima.js) ----------
const COD = (c) => c >= 95 ? 'tormenta' : c >= 80 ? 'chubascos' : c >= 61 ? 'lluvia' : c >= 51 ? 'llovizna' : c >= 45 ? 'niebla' : c >= 3 ? 'nublado' : c >= 1 ? 'parcial' : 'despejado';
async function pronostico(p, dias) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lng}&daily=weather_code,precipitation_sum,precipitation_probability_max,precipitation_hours&hourly=precipitation_probability,precipitation&timezone=${encodeURIComponent(TZ)}&forecast_days=${dias}`;
    const r = await fetch(url); if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status); return r.json();
}
async function textoClima(datos) {
    try {
        const base = await pronostico(LAS_TERRENAS, 7); const d = base.daily; const out = ['CLIMA — Las Terrenas (Open-Meteo)'];
        for (let i = 0; i < d.time.length; i++) out.push(`- ${etiqueta(d.time[i])}: ${COD(d.weather_code[i])}, ${d.precipitation_probability_max[i]} % prob. máx., ${d.precipitation_sum[i]} mm en ${d.precipitation_hours[i]} h`);
        const hasta = sumarDias(datos.hoy, 3);
        const prox = datos.trabajosAbiertos.filter((t) => t.fecha && t.fecha.slice(0, 10) >= datos.hoy && t.fecha.slice(0, 10) <= hasta).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
        out.push('', 'TRABAJOS AGENDADOS (próximos 3 días) Y LLUVIA EN SU FRANJA');
        if (!prox.length) out.push('- Ninguno con fecha.');
        const cache = new Map([[LAS_TERRENAS.lat + ',' + LAS_TERRENAS.lng, base]]);
        for (const t of prox) {
            const m = String(t.gps || '').match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
            const p = m ? { lat: +(+m[1]).toFixed(2), lng: +(+m[2]).toFixed(2) } : LAS_TERRENAS; const k = p.lat + ',' + p.lng;
            if (!cache.has(k)) { try { cache.set(k, await pronostico(p, 7)); } catch (_) { cache.set(k, base); } }
            const h = cache.get(k).hourly, dia = t.fecha.slice(0, 10), h0 = t.fecha.length > 10 ? +t.fecha.slice(11, 13) : 8;
            const franja = h.time.map((x, i) => [x, h.precipitation_probability[i], h.precipitation[i]]).filter(([x]) => x.startsWith(dia) && +x.slice(11, 13) >= h0 && +x.slice(11, 13) < h0 + 4);
            const max = franja.reduce((mx, f) => Math.max(mx, f[1] || 0), 0), mm = franja.reduce((s, f) => s + (f[2] || 0), 0);
            const seco = /☔|d[ií]a seco/i.test(t.notas || ''), riesgo = max >= 40;
            const marca = seco && riesgo ? '☔ RIESGO' : seco ? '☀️ ok (pide día seco)' : riesgo ? '🌧️' : '·';
            out.push(`- ${marca} ${etiqueta(dia)} ${String(h0).padStart(2, '0')}:00 — ${t.cliente} — ${t.obra}: hasta ${max} % de lluvia y ${mm.toFixed(1)} mm entre ${h0}h y ${h0 + 4}h${m ? '' : ' (punto: Las Terrenas)'}`);
        }
        return out.join('\n');
    } catch (e) { return 'CLIMA: no disponible (' + e.message + ')'; }
}

// ---------- el guion del Coordinador (resumen operativo de .claude/agents/coordinador-obras.md) ----------
const SISTEMA = `Eres el Coordinador de Obras de ARTAL Dominicana, SRL (aluminio, vidrio, shutters y cortinas; sede en Las Terrenas, Samaná). Trabajas como un empleado más de operaciones: planificas, haces seguimiento, detectas riesgos y propones. Tu interlocutor es Wilson (gerente de operaciones y chofer; puente con clientes, equipo y fábrica). Dylan (gerente general) define reglas y valida decisiones de dirección. Miki es supervisor y jefe de equipo. Instaladores: Wilson, Miki, Roosevelt, Emerson; la composición de equipos se decide cada día según las obras (4 juntos, 2+2 u otra). Fabricación: ALUCUFEL (contratista en Santo Domingo, destino 'alucufel') y la fábrica interna de ARTAL (destino 'interno'). Transporte: camión de la empresa, trayecto habitual Santo Domingo ↔ Las Terrenas; un viaje directo no ocupa el día (saliendo temprano se instala esa misma mañana).

HOY ESCRIBES EL INFORME MATINAL a partir de los DATOS que recibes (JSON del panel + texto del clima + el informe anterior). Regla de oro: no inventes nada; si un dato no está, dilo como «no verificado». Nunca propongas cerrar trabajos ni pedidos: los cierra el equipo.

REGLAS DE PLANIFICACIÓN: la fecha comprometida con el cliente manda; agrupa obras por zona; obras pequeñas rellenan huecos; buffer 15–20 % en obras nuevas; agrupa entregas por viaje; preparación de obra se verifica 2–5 días antes; fábrica fija fechaSalidaEstimada al tomar el pedido (si un pedido lleva más de 48 h en fábrica sin fecha, alerta; si la fecha venció y no está listo, alerta). Nunca propongas a alguien de vacaciones.

LECCIONES APRENDIDAS (no las contradigas):
- Un trabajo origen 'auto_fabrica' sin asignados es normal: propón equipo, no alertes.
- Los recordatorios de caja de la oficina (arqueos, pagos) no son tuyos: ignóralos.
- Un pedido que lleva semanas en fábrica NO es anomalía por sí mismo (está validado y cobrado; puede esperar material o una instalación lejana). A lo sumo pregunta si hay fecha prevista.
- Trabajos sin factura (cortinas, interna) no tienen anticipo y es normal; «sin anticipo registrado» no es alerta salvo en fabricación de ALUCUFEL sin pago y sin explicación; un pago en efectivo es factura al contado, no anticipo.
- Un trabajo en proceso esperando terminaciones es normal; no propongas fecha de regreso.
- Una cotización 'enviada_cliente' con anticipo no significa trabajo sin hacer: muchas se fabrican e instalan sin pasar por «Aprobar»; busca trabajos y partes con palabras de la obra antes de alertar («cotización sin cerrar», no «sin hacer»).
- Si Wilson y Miki trabajan juntos hay un solo parte con todos: que falte el del otro no es alerta (mira incluidos).
- Compras directas en Santo Domingo (vidrio de Industrias Domínguez, puertas) «listas» esperan un viaje del camión: agrúpalas.
- Un pedido puede llegar a la obra sin «Entregado» en Transportes (transportista externo); no alertes como perdido, pregunta.
- El status del pedido manda sobre sus fechas (un «listo» devuelto a fábrica es «en fábrica»).
- Un pedido con fichaParcial es una parte de la hoja; el resto va aparte.

FORMATO (texto plano, guiones y líneas en blanco, sin tablas ni Markdown pesado, en español, conciso; cada línea con dato real):
INFORME MATINAL — <día> <dd/mm/aaaa> (generado a las <hora>)

HOY EN OBRA (propuesta; Wilson confirma o cambia)
- <equipo> → <obra>: <tarea>. …
- Ayer, según los partes: <resumen por persona/obra>.

CLIMA (Las Terrenas, Open-Meteo)
- la semana en una línea por día y los trabajos de los próximos 3 días con su riesgo; un trabajo ☔ RIESGO es una alerta A… con propuesta concreta.

TRANSPORTES
- viajes de hoy / últimos; lo que espera en Santo Domingo.

FÁBRICA
- pedidos por destino con fecha de salida (vencida / sin fecha / próxima), pago, instrucciones sin atender.

RESUELTO DESDE AYER
- lo que estaba en el informe anterior y ya no (compara con el informe anterior).

🔴 ALERTAS (acción hoy)
A1. … Propuesta: …
🟡 ATENCIÓN (esta semana)
A2. …
🟢 EN CURSO SIN INCIDENCIAS: <n>
- <cliente — obra (motivo breve)>

PENDIENTE DE VALIDACIÓN
- <qué, de quién>

NO VERIFICADO
- …

MENSAJES LISTOS PARA ENVIAR: <n>
M1. Para: <destinatario> (<canal>). Idioma: <idioma>. «<texto>» [PENDIENTE VALIDACIÓN] si va a cliente.

Para decidir: en la app de Claude, pídele al Coordinador de Obras «haz A2» o «envía M1»; él lee este informe de hoy.

Numera A1, A2… y M1, M2… para que Dylan o Wilson decidan respondiendo. Mensajes a clientes siempre [PENDIENTE VALIDACIÓN] y en el idioma del cliente si lo conoces. Máximo unas 90 líneas.`;

async function pedirInforme(apiKey, datos, clima) {
    const { informeAnterior, _todosLosCompletados, ...resto } = datos;
    const user = `FECHA DE HOY: ${datos.hoy} (${DIAS[diaSemana(datos.hoy)]}), hora ${datos.horaGeneracion} RD.\n\n` +
        `DATOS DEL PANEL (JSON):\n${JSON.stringify(resto)}\n\n` +
        `TRABAJOS COMPLETADOS (histórico, solo para no alertar de cosas ya hechas): ${JSON.stringify(_todosLosCompletados.slice(-120))}\n\n` +
        `${clima}\n\n` +
        (informeAnterior ? `INFORME ANTERIOR (${informeAnterior.asunto}):\n${informeAnterior.cuerpo}\n\n` : 'No hay informe anterior.\n\n') +
        'Escribe el informe matinal de hoy.';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        // 8000 tokens de salida: el informe del 31/10/2026 salió cortado a mitad de M3 con el tope anterior (4500 justos).
        body: JSON.stringify({ model: MODELO, max_tokens: 8000, system: SISTEMA, messages: [{ role: 'user', content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + JSON.stringify(j).slice(0, 300));
    let texto = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (texto.length < 200) throw new Error('informe demasiado corto');
    // Si aun así se corta, que el pie del informe lo diga en vez de terminar a mitad de una frase.
    if (j.stop_reason === 'max_tokens') texto += '\n\n⚠️ INFORME CORTADO: la respuesta llegó al tope de longitud. Lo que falta no se perdió del panel; pídelo con «coordinadorInformeAhora» o espera el de mañana.';
    return { texto, uso: j.usage || null, cortado: j.stop_reason === 'max_tokens' };
}

// ---------- orquestación ----------
async function generarInforme({ lector, apiKey, hoy = ymdRD(), forzar = false, publicar = true, escribirMensaje, log = console.log }) {
    const datos = await recogerDatos(lector, hoy);
    const dia = diaSemana(hoy);
    const esFeriado = datos.feriados.includes(hoy) && !datos.feriadosTrabajados.includes(hoy);
    if (!forzar && (dia === 0 || esFeriado)) return { ok: true, publicado: false, motivo: dia === 0 ? 'domingo' : 'feriado' };
    const asunto = asuntoDe(hoy);
    const previos = await lector.consultar('mensajes', [['tipo', '==', 'informe_coordinador']], 60);
    const ya = previos.find((m) => m.asunto === asunto);
    if (ya && !forzar) return { ok: true, publicado: false, motivo: 'ya existe el informe de hoy', id: ya._id };
    const clima = await textoClima(datos);
    const { texto, uso } = await pedirInforme(apiKey, datos, clima);
    log('informe generado', texto.length, 'caracteres', uso ? `(${uso.input_tokens} in / ${uso.output_tokens} out)` : '');
    if (!publicar) return { ok: true, publicado: false, motivo: 'solo prueba', asunto, texto, resumen: resumenDatos(datos) };
    const id = await escribirMensaje({
        estado: 'enviado', asunto, cuerpo: texto, remitenteEmail: 'coordinador@artal', remitenteNombre: 'Coordinador de Obras (IA)',
        paraTodos: false, destinatarios: DESTINATARIOS, requiereFirma: false, adjuntos: [], acuses: {}, tipo: 'informe_coordinador',
        generadoPor: 'cloud-function', modelo: MODELO, tokens: uso || null,
    });
    return { ok: true, publicado: true, id, asunto, texto };
}
const resumenDatos = (d) => ({ trabajosAbiertos: d.trabajosAbiertos.length, pedidosFabrica: d.pedidosFabrica.length, comprasDirectas: d.comprasDirectas.length, cotizaciones: d.cotizaciones.length, partes: d.partes.length, viajes: d.viajesRecientes.length, recordatorios: d.recordatoriosAbiertos.length, anticiposSinObra: d.anticiposSinObra.length, vacaciones: d.vacacionesVigentes.length });

// Lector sobre el Admin SDK: '==' e 'in' van a Firestore; '!=' se resuelve en memoria (evita índices y el límite de un solo '!=').
function lectorAdmin(db) {
    return {
        async consultar(col, filtros = [], limite = 500) {
            let q = db.collection(col); const enMemoria = [];
            for (const [campo, op, valor] of filtros) { if (op === '==' || op === 'in') q = q.where(campo, op, valor); else enMemoria.push([campo, op, valor]); }
            const snap = await q.limit(limite).get();
            return snap.docs.map((d) => ({ _id: d.id, ...d.data() })).filter((x) => enMemoria.every(([c, op, v]) => op === '!=' ? x[c] !== v : true));
        },
        async obtener(col, id) { const s = await db.doc(col + '/' + id).get(); return s.exists ? { _id: s.id, ...s.data() } : null; },
    };
}

module.exports = function montar({ db, FieldValue, onSchedule, onRequest, anthropicKey, callerAdmin }) {
    const lector = lectorAdmin(db);
    const escribirMensaje = async (datos) => { const ref = await db.collection('mensajes').add({ ...datos, fecha: FieldValue.serverTimestamp() }); return ref.id; };
    const correr = (opts) => generarInforme({ lector, apiKey: anthropicKey.value(), escribirMensaje, ...opts });
    return {
        // 7:50 am RD, lunes a sábado (la rutina local de la app queda solo para lanzarla a mano)
        coordinadorInformeDiario: onSchedule({ schedule: '50 7 * * 1-6', timeZone: TZ, secrets: [anthropicKey], timeoutSeconds: 300, memory: '512MiB' }, async () => {
            const r = await correr({}); console.log('coordinadorInformeDiario', JSON.stringify({ ...r, texto: r.texto ? r.texto.length + ' chars' : undefined }));
        }),
        // Admin: { fecha?, soloPrueba?: true (devuelve el texto sin publicar), forzar?: true (publica aunque ya exista uno hoy) }
        coordinadorInformeAhora: onRequest({ secrets: [anthropicKey], cors: true, timeoutSeconds: 300, memory: '512MiB' }, async (req, res) => {
            if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
            const email = await callerAdmin(req); if (!email) { res.status(403).json({ error: 'no-autorizado' }); return; }
            const b = req.body || {};
            try { res.json(await correr({ hoy: /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '') ? b.fecha : ymdRD(), forzar: b.forzar === true, publicar: b.soloPrueba !== true })); }
            catch (e) { console.error('coordinadorInformeAhora', e); res.status(500).json({ error: String(e.message || e) }); }
        }),
    };
};
module.exports.generarInforme = generarInforme;
module.exports.recogerDatos = recogerDatos;
module.exports.textoClima = textoClima;
