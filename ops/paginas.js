// Catálogo de PANTALLAS de la plataforma y permisos por página (2026-09-13).
//
// Cada pantalla tiene los roles que la abren por defecto (`roles`, copiados del requireAuth([...]) de
// esa página; [] = solo admin/lector). Sobre ese estándar, un admin puede afinar POR PERSONA desde
// Usuarios y roles: `paginasExtra` (páginas que su rol no da pero sí puede ver) y
// `paginasBloqueadas` (páginas que su rol da pero NO debe ver). Ambos viven en usuarios/{email} y
// solo un admin puede escribirlos (firestore.rules). Se aplican en dos sitios:
//   · requireAuth() (auth-common.js): al ENTRAR a la página — una bloqueada rebota aunque el rol la
//     incluya; una extra abre aunque el rol no la incluya. Admin siempre entra a todo.
//   · aplicarPermisosEnlaces(): esconde en los hubs los mosaicos/enlaces a páginas que no puede ver.
//
// ⚠ Al crear una pantalla nueva en ops/, agregarla aquí (id = ruta relativa a ops/) con los mismos
// roles que su requireAuth. Generado inicialmente con un script a partir de los <title> y requireAuth.
export const GRUPOS = [
    { id: "panel", nombre: "Panel de Control" },
    { id: "operaciones", nombre: "Operaciones (obra, fábrica, transporte, instalación)" },
    { id: "cotizaciones", nombre: "Cotizaciones y clientes" },
    { id: "alucufel", nombre: "ALUCUFEL (contratista)" },
    { id: "erp", nombre: "ERP: módulos generales" },
    { id: "bancos", nombre: "Bancos y tesorería" },
    { id: "contabilidad", nombre: "Contabilidad" },
    { id: "rrhh", nombre: "Recursos Humanos" },
    { id: "ventas", nombre: "Ventas y CRM" },
    { id: "productos", nombre: "Productos y servicios" },
    { id: "activos", nombre: "Activos fijos" },
    { id: "equipo", nombre: "Equipo, mensajería y academia" },
    { id: "inbox", nombre: "Inbox omnicanal (WhatsApp, Instagram…)" }
];
export const PAGINAS = [
    { id: "index.html", titulo: "Panel de Control", grupo: "panel", roles: [], desc: "Inicio del panel: mosaicos a cada módulo, badges con lo pendiente y centro de notificaciones (comentarios, problemas, solicitudes, recordatorios)." },
    { id: "instalaciones.html", titulo: "Agenda de Instalación", grupo: "operaciones", roles: ["instalador", "ayudante"], desc: "Versión anterior de la agenda de instalación (calendario + GPS + agendar). Reemplazada por Instalación; sigue disponible como respaldo." },
    { id: "calendario.html", titulo: "Calendario", grupo: "operaciones", roles: [], desc: "Calendario de gerencia: citas y recordatorios por persona (Andrea, Anny, Dylan), con etapas, recurrencia y push." },
    { id: "compras.html", titulo: "Compra Directa", grupo: "operaciones", roles: [], desc: "Compra Directa: artículos que se compran hechos a un proveedor y van directo a transporte/instalación con su orden de compra en PDF." },
    { id: "etiquetas.html", titulo: "Etiquetas de fábrica", grupo: "operaciones", roles: ["fabrica"], desc: "Impresión de etiquetas de fábrica por pedido/ítem para marcar las piezas." },
    { id: "fabrica-interna.html", titulo: "Fábrica Interna", grupo: "operaciones", roles: [], desc: "Tablero de fabricación del taller propio de ARTAL (pedidos con destino interno): pendiente, en fábrica, listo, completado." },
    { id: "historial.html", titulo: "Historial", grupo: "operaciones", roles: [], desc: "Todos los pedidos por estado y carpetas Cliente → Obra → Documentos; cambiar estados, asignar chofer/instalador, ver fichas y PDFs." },
    { id: "instalacion.html", titulo: "Instalación", grupo: "operaciones", roles: ["instalador", "ayudante"], desc: "Pantalla del equipo de instalación: agenda día a día, obras asignadas, avance por ítem, fotos, conversación con gerencia y cierre con biometría." },
    { id: "parte-diario.html", titulo: "Parte diario de obra (tiempo por obra)", grupo: "operaciones", roles: ["instalador"], desc: "Parte diario de obra: cada encargado registra al final del día en qué obras estuvo cada persona de su equipo y cuántas horas. Admin: costo real por obra y por persona." },
    { id: "parte-diario-seguimiento.html", titulo: "Seguimiento del parte diario", grupo: "operaciones", roles: [], desc: "Gerencia: quién envió el parte hoy y quién falta, últimos 14 días, resumen del día por obra, encargados y bloqueo." },
    { id: "inventario.html", titulo: "Inventario", grupo: "operaciones", roles: ["chofer", "instalador", "ayudante"], desc: "Inventario de herramientas y materiales con stock, mínimos y categorías." },
    { id: "solicitudes.html", titulo: "Solicitudes web", grupo: "operaciones", roles: [], desc: "Solicitudes que llegan del sitio web (formulario y bot): datos del cliente, tipo de trabajo y seguimiento." },
    { id: "instalador.html", titulo: "Trabajo en Obra", grupo: "operaciones", roles: ["instalador", "ayudante"], desc: "Versión anterior de 'Trabajo en Obra' (recordatorios, obras, firma). Reemplazada por Instalación; sigue como respaldo." },
    { id: "chofer.html", titulo: "Transportes", grupo: "operaciones", roles: ["chofer"], desc: "Transportes: pedidos listos para cargar, marcar en ruta, entregar en obra con recepción y reportar faltantes." },
    { id: "calculador-obra.html", titulo: "Calculador de obra", grupo: "cotizaciones", roles: ["cotizaciones"], desc: "Calculador de costos de una obra: equipo, días, vehículo, ruta, peajes, hotel y comida, para cotizar con margen." },
    { id: "clientes.html", titulo: "Clientes", grupo: "cotizaciones", roles: ["cotizaciones"], desc: "Directorio de clientes con sus obras, contactos y documentos." },
    { id: "cotizaciones.html", titulo: "Cotizaciones", grupo: "cotizaciones", roles: ["cotizaciones"], desc: "Cotizaciones: recibir el costo del contratista, armar el precio final y enviar el PDF al cliente; aprobar y mandar a fábrica." },
    { id: "ventas-cotizacion.html", titulo: "Cotización", grupo: "cotizaciones", roles: [], desc: "Cotización formal al cliente (formato de venta) generada desde el ERP." },
    { id: "cotizaciones-especificaciones.html", titulo: "Especificaciones de Cotización", grupo: "cotizaciones", roles: ["cotizaciones"], desc: "Textos y especificaciones estándar que se incluyen en las cotizaciones." },
    { id: "alucufel/index.html", titulo: "ALUCUFEL", grupo: "alucufel", roles: ["contratista", "fabrica"], desc: "Portal del contratista ALUCUFEL: acceso a sus cotizaciones de costo y a su tablero de fábrica." },
    { id: "alucufel/cotizaciones.html", titulo: "ALUCUFEL: Cotizaciones", grupo: "alucufel", roles: ["contratista"], desc: "ALUCUFEL sube el PDF con su costo de fabricación para cada pedido de cotización." },
    { id: "alucufel/fabrica.html", titulo: "ALUCUFEL: Fábrica", grupo: "alucufel", roles: ["fabrica"], desc: "Tablero de fabricación de ALUCUFEL: marcar partes listas por ítem y enviar a transporte/instalación." },
    { id: "citrus.html", titulo: "Citrus (Integración)", grupo: "erp", roles: [], desc: "Pruebas de conexión con Citrus ERP (facturación fiscal): leer catálogos y crear registros por API." },
    { id: "erp.html", titulo: "ERP", grupo: "erp", roles: ["contable"], desc: "Hub del ERP: acceso a bancos, contabilidad, ventas, productos, activos, RRHH y demás módulos según el rol." },
    { id: "mantenimiento.html", titulo: "Mantenimiento", grupo: "erp", roles: [], desc: "Mantenimiento de vehículos y equipos: tareas programadas y realizadas." },
    { id: "produccion.html", titulo: "Producción (Costeo de obra)", grupo: "erp", roles: [], desc: "Producción: costeo de obra y cálculos de fabricación (vidrio a cortar, despiece)." },
    { id: "bancos.html", titulo: "Bancos y Tesorería", grupo: "bancos", roles: ["contable"], desc: "Hub de bancos y tesorería: cuentas, movimientos, caja chica, tarjetas, préstamos." },
    { id: "bancos-caja.html", titulo: "Caja Chica", grupo: "bancos", roles: ["contable"], desc: "Caja chica: gastos menores en efectivo, arqueos de mañana y tarde." },
    { id: "bancos-cierres.html", titulo: "Cierres de Caja", grupo: "bancos", roles: ["contable"], desc: "Cierres de caja por período con conciliación." },
    { id: "bancos-cuentas.html", titulo: "Cuentas Bancarias", grupo: "bancos", roles: ["contable"], desc: "Cuentas bancarias de la empresa con saldos." },
    { id: "bancos-caja-historial.html", titulo: "Historial de Caja Chica", grupo: "bancos", roles: ["contable"], desc: "Historial de arqueos y movimientos de caja chica." },
    { id: "bancos-lineas.html", titulo: "Líneas de Crédito", grupo: "bancos", roles: ["contable"], desc: "Líneas de crédito disponibles y su uso." },
    { id: "bancos-movimientos.html", titulo: "Movimientos Bancarios", grupo: "bancos", roles: ["contable"], desc: "Movimientos bancarios: depósitos, retiros, transferencias y conciliación." },
    { id: "bancos-prestamos.html", titulo: "Préstamos y Leasing", grupo: "bancos", roles: ["contable"], desc: "Préstamos y leasing: cuotas, intereses y calendario de pago." },
    { id: "bancos-tarjetas.html", titulo: "Tarjetas Corporativas", grupo: "bancos", roles: ["contable"], desc: "Tarjetas corporativas: consumos, límites y cortes." },
    { id: "bancos-transferencias.html", titulo: "Transferencias entre cuentas", grupo: "bancos", roles: ["contable"], desc: "Transferencias entre cuentas propias." },
    { id: "contabilidad-categorias.html", titulo: "Categorías / Cuentas", grupo: "contabilidad", roles: ["contable"], desc: "Categorías de ingresos y gastos usadas en toda la contabilidad operativa." },
    { id: "contabilidad-catalogo.html", titulo: "Catálogo de Cuentas", grupo: "contabilidad", roles: ["contable"], desc: "Catálogo de cuentas (plan contable) con sincronización a Citrus." },
    { id: "contabilidad-centros.html", titulo: "Centros de Costo", grupo: "contabilidad", roles: ["contable"], desc: "Centros de costo para repartir gastos por área u obra." },
    { id: "contabilidad.html", titulo: "Contabilidad", grupo: "contabilidad", roles: ["contable"], desc: "Hub de contabilidad: gastos, ingresos, cuentas por cobrar/pagar, presupuesto y reportes." },
    { id: "contabilidad-cxcp.html", titulo: "Cuentas por Cobrar / Pagar", grupo: "contabilidad", roles: ["contable"], desc: "Cuentas por cobrar a clientes y por pagar a proveedores, con vencimientos." },
    { id: "contabilidad-gastos.html", titulo: "Gastos", grupo: "contabilidad", roles: ["contable"], desc: "Registro de gastos con captura de factura por IA (RNC, NCF, ITBIS), listos para Citrus." },
    { id: "contabilidad-recurrentes.html", titulo: "Gastos Fijos", grupo: "contabilidad", roles: ["contable"], desc: "Gastos fijos mensuales (alquiler, servicios, seguros) que se generan solos." },
    { id: "contabilidad-ingresos.html", titulo: "Ingresos", grupo: "contabilidad", roles: ["contable"], desc: "Registro de ingresos y cobros." },
    { id: "contabilidad-movimientos.html", titulo: "Ingresos y Gastos", grupo: "contabilidad", roles: ["contable"], desc: "Vista unificada de ingresos y gastos con filtros." },
    { id: "contabilidad-presupuesto.html", titulo: "Presupuesto vs Real", grupo: "contabilidad", roles: ["contable"], desc: "Presupuesto por categoría comparado con lo real del período." },
    { id: "contabilidad-reportes.html", titulo: "Reportes de Contabilidad", grupo: "contabilidad", roles: ["contable"], desc: "Reportes de gestión: resultados, por categoría, por centro de costo." },
    { id: "contabilidad-obras.html", titulo: "Costo de obras", grupo: "contabilidad", roles: ["contable"], desc: "Costo real de cada obra: horas y mano de obra de los partes diarios, viajes del camión e informes de cierre por trabajo; por persona." },
    { id: "informe-obra.html", titulo: "Informe de costo de obra", grupo: "contabilidad", roles: ["contable"], desc: "Informe de costo real de una obra al completar la instalación: mano de obra por persona y día, viajes del camión, total; recalcular." },
    { id: "rrhh-asistencia.html", titulo: "Asistencia y Permisos", grupo: "rrhh", roles: [], desc: "Asistencia diaria (presente, tarde, ausente, permiso), solicitudes de permiso, turnos y feriados." },
    { id: "rrhh-catalogos.html", titulo: "Catálogos RRHH", grupo: "rrhh", roles: [], desc: "Departamentos, cargos y sucursales para las fichas de empleados." },
    { id: "rrhh-ciclo.html", titulo: "Ciclo del empleado", grupo: "rrhh", roles: [], desc: "Ciclo del empleado: promociones, amonestaciones, salidas y su historial." },
    { id: "rrhh-empleados.html", titulo: "Empleados", grupo: "rrhh", roles: ["contable"], desc: "Fichas de empleados: datos, sueldo, correo de login y costo laboral real por día." },
    { id: "rrhh-nomina.html", titulo: "Nómina", grupo: "rrhh", roles: ["contable"], desc: "Nómina quincenal RD: AFP, SFS, ISR, extras, préstamos, volantes de pago y envío por Mensajería." },
    { id: "rrhh-reclutamiento.html", titulo: "Reclutamiento", grupo: "rrhh", roles: [], desc: "Reclutamiento: vacantes, candidatos y entrevistas." },
    { id: "rrhh.html", titulo: "Recursos Humanos", grupo: "rrhh", roles: [], desc: "Hub de Recursos Humanos." },
    { id: "rrhh-reuniones.html", titulo: "Reuniones de seguimiento", grupo: "rrhh", roles: ["instalador", "ayudante", "chofer", "cotizaciones", "contable", "comunicaciones"], desc: "Reuniones de seguimiento 1 a 1 cada 90 días con acuerdos y objetivos; cada empleado ve los suyos." },
    { id: "rrhh-vacaciones.html", titulo: "Vacaciones", grupo: "rrhh", roles: [], desc: "Vacaciones por empleado y año con sus documentos." },
    { id: "ventas-actividades.html", titulo: "Actividades CRM", grupo: "ventas", roles: ["cotizaciones"], desc: "Actividades del CRM: llamadas, visitas y seguimientos a clientes." },
    { id: "ventas-precios.html", titulo: "Listas de Precios", grupo: "ventas", roles: ["cotizaciones"], desc: "Listas de precios por producto y cliente." },
    { id: "ventas-oportunidades.html", titulo: "Oportunidades", grupo: "ventas", roles: ["cotizaciones"], desc: "Oportunidades de venta en curso y su etapa." },
    { id: "ventas-reportes.html", titulo: "Reportes de Ventas", grupo: "ventas", roles: ["cotizaciones"], desc: "Reportes de ventas por período, vendedor y cliente." },
    { id: "ventas-comisiones.html", titulo: "Vendedores y Comisiones", grupo: "ventas", roles: ["cotizaciones"], desc: "Vendedores y cálculo de comisiones." },
    { id: "ventas.html", titulo: "Ventas", grupo: "ventas", roles: [], desc: "Hub de Ventas y CRM." },
    { id: "productos-categorias.html", titulo: "Categorías", grupo: "productos", roles: [], desc: "Categorías del catálogo de productos y servicios." },
    { id: "productos-lista.html", titulo: "Catálogo", grupo: "productos", roles: [], desc: "Catálogo de productos y servicios con precios y unidades." },
    { id: "productos-impuestos.html", titulo: "Impuestos", grupo: "productos", roles: [], desc: "Impuestos aplicables a productos (ITBIS y otros)." },
    { id: "productos.html", titulo: "Productos y Servicios", grupo: "productos", roles: [], desc: "Hub de productos y servicios." },
    { id: "productos-unidades.html", titulo: "Unidades de Medida", grupo: "productos", roles: [], desc: "Unidades de medida del catálogo." },
    { id: "activos-lista.html", titulo: "Activos", grupo: "activos", roles: ["contable"], desc: "Listado de activos fijos (vehículos, máquinas, equipos)." },
    { id: "activos.html", titulo: "Activos Fijos", grupo: "activos", roles: ["contable"], desc: "Hub de activos fijos." },
    { id: "activos-depreciacion.html", titulo: "Depreciación DR", grupo: "activos", roles: ["contable"], desc: "Depreciación de activos según normas de la DGII." },
    { id: "activos-prestamos.html", titulo: "Préstamo y Renta", grupo: "activos", roles: ["contable"], desc: "Préstamo y renta de activos (a quién se prestó, hasta cuándo)." },
    { id: "puntos.html", titulo: "Puntos del equipo", grupo: "equipo", roles: ["instalador", "ayudante", "chofer", "cotizaciones", "contable", "comunicaciones", "capacitador"], desc: "Puntos por usar bien la plataforma (parte diario a tiempo, trabajos el día agendado, comunicados leídos, opinión del cliente). Gerencia: reglas, equipo, encuestas de satisfacción, puntos manuales. El equipo solo ve los suyos y solo cuando gerencia lo activa." },
    { id: "academia.html", titulo: "Academia", grupo: "equipo", roles: ["capacitador", "instalador", "ayudante", "chofer", "cotizaciones", "contable", "comunicaciones"], desc: "Academia ARTAL: cursos, lecciones, exámenes y certificados; el capacitador crea el contenido." },
    { id: "mensajes.html", titulo: "Mensajería", grupo: "equipo", roles: ["cotizaciones", "chofer", "instalador", "ayudante", "contable", "comunicaciones"], desc: "Mensajería interna: comunicados, volantes de pago y mensajes con acuse de lectura." },
    { id: "notas.html", titulo: "Mis Notas", grupo: "equipo", roles: ["cotizaciones", "chofer", "instalador", "ayudante", "contable", "comunicaciones"], desc: "Notas personales con imágenes y documentos adjuntos; solo las ve su dueño." },
    { id: "inbox.html", titulo: "Inbox omnicanal", grupo: "inbox", roles: ["inbox_admin", "inbox_supervisor", "inbox_agente", "inbox_lector"], desc: "Bandeja compartida de WhatsApp (e Instagram): varios agentes sobre el mismo número, asignación, notas internas, presencia, plantillas, respuestas rápidas." },
    { id: "inbox-contactos.html", titulo: "Inbox: Contactos (CRM)", grupo: "inbox", roles: ["inbox_admin", "inbox_supervisor", "inbox_agente", "inbox_lector"], desc: "Contactos del inbox: una persona con varias identidades (WhatsApp, Instagram, email), tags, notas, historial y fusión de duplicados con deshacer." },
    { id: "inbox-dashboard.html", titulo: "Inbox: Dashboard", grupo: "inbox", roles: ["inbox_admin", "inbox_supervisor", "inbox_lector"], desc: "Métricas del inbox: abiertas, cerradas, mensajes, tiempos de primera respuesta y resolución, por agente, por canal, por día, SLA." },
    { id: "inbox-config.html", titulo: "Inbox: Configuración", grupo: "inbox", roles: ["inbox_admin"], desc: "Canales (WhatsApp Cloud API, Instagram), equipos, etiquetas, respuestas rápidas, plantillas, reglas de automatización, SLA, IA y roles." },
    { id: "inbox-auditoria.html", titulo: "Inbox: Auditoría", grupo: "inbox", roles: ["inbox_admin"], desc: "Registro inalterable de acciones del inbox: accesos, envíos, notas, asignaciones, estados, configuración, canales." },
    { id: "usuarios.html", titulo: "Usuarios y roles", grupo: "equipo", roles: [], desc: "Usuarios y roles: cuentas, roles, permisos por página, notificaciones y verificación en 2 pasos. Solo administradores." },
];
const POR_ID = new Map(PAGINAS.map(p => [p.id, p]));
export const paginaPorId = (id) => POR_ID.get(id) || null;

// Ruta (id de catálogo) de la página actual: lo que hay después de "/ops/" en la URL.
export function paginaActual() {
    const p = location.pathname, i = p.indexOf('/ops/');
    if (i === -1) return '';
    const r = p.slice(i + 5);
    return r === '' || r.endsWith('/') ? r + 'index.html' : r;
}
// Id de catálogo a partir de un href (relativo a la página actual). '' si no apunta a ops/.
export function idDeHref(href) {
    try {
        const u = new URL(href, location.href);
        if (u.origin !== location.origin) return '';
        const i = u.pathname.indexOf('/ops/');
        if (i === -1) return '';
        const r = u.pathname.slice(i + 5);
        return r === '' || r.endsWith('/') ? r + 'index.html' : r;
    } catch (_) { return ''; }
}
// ¿Puede esta persona ver la página `id`? (usuario = objeto que devuelve requireAuth, con roles,
// paginasExtra y paginasBloqueadas). Páginas fuera del catálogo no se bloquean.
export function puedeVer(usuario, id) {
    if (!usuario) return false;
    const roles = usuario.roles || [];
    if (roles.includes('admin')) return true;
    const pg = POR_ID.get(id);
    if (!pg) return true;
    if ((usuario.paginasBloqueadas || []).includes(id)) return false;
    if ((usuario.paginasExtra || []).includes(id)) return true;
    if (roles.includes('lector')) return true;
    return pg.roles.some(r => roles.includes(r));
}
// Lo que da el ROL solo (sin extras/bloqueos) — para pintar "por rol" en Usuarios y roles.
export function daElRol(roles, id) {
    roles = roles || [];
    if (roles.includes('admin') || roles.includes('lector')) return true;
    const pg = POR_ID.get(id); if (!pg) return false;
    return pg.roles.some(r => roles.includes(r));
}
// Esconde en la página los enlaces/mosaicos a pantallas que la persona no puede ver. Nunca muestra
// nada que estuviera oculto; solo oculta. Salta los botones "← Volver" (los maneja wireBackButton).
export function aplicarPermisosEnlaces(usuario) {
    if (!usuario || (usuario.roles || []).includes('admin')) return;
    document.querySelectorAll('a[href]').forEach(a => {
        if (a.classList.contains('btn-back')) return;
        const id = idDeHref(a.getAttribute('href'));
        if (!id || !POR_ID.has(id)) return;
        if (!puedeVer(usuario, id)) { const el = a.closest('.card-link') || a; el.style.display = 'none'; }
    });
}
