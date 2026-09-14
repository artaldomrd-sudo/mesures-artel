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
    { id: "equipo", nombre: "Equipo, mensajería y academia" }
];
export const PAGINAS = [
    { id: "index.html", titulo: "Panel de Control", grupo: "panel", roles: [] },
    { id: "instalaciones.html", titulo: "Agenda de Instalación", grupo: "operaciones", roles: ["instalador", "ayudante"] },
    { id: "calendario.html", titulo: "Calendario", grupo: "operaciones", roles: [] },
    { id: "compras.html", titulo: "Compra Directa", grupo: "operaciones", roles: [] },
    { id: "etiquetas.html", titulo: "Etiquetas de fábrica", grupo: "operaciones", roles: ["fabrica"] },
    { id: "fabrica-interna.html", titulo: "Fábrica Interna", grupo: "operaciones", roles: [] },
    { id: "historial.html", titulo: "Historial", grupo: "operaciones", roles: [] },
    { id: "instalacion.html", titulo: "Instalación", grupo: "operaciones", roles: ["instalador", "ayudante"] },
    { id: "inventario.html", titulo: "Inventario", grupo: "operaciones", roles: ["chofer", "instalador", "ayudante"] },
    { id: "solicitudes.html", titulo: "Solicitudes web", grupo: "operaciones", roles: [] },
    { id: "instalador.html", titulo: "Trabajo en Obra", grupo: "operaciones", roles: ["instalador", "ayudante"] },
    { id: "chofer.html", titulo: "Transportes", grupo: "operaciones", roles: ["chofer"] },
    { id: "calculador-obra.html", titulo: "Calculador de obra", grupo: "cotizaciones", roles: ["cotizaciones"] },
    { id: "clientes.html", titulo: "Clientes", grupo: "cotizaciones", roles: ["cotizaciones"] },
    { id: "cotizaciones.html", titulo: "Cotizaciones", grupo: "cotizaciones", roles: ["cotizaciones"] },
    { id: "ventas-cotizacion.html", titulo: "Cotización", grupo: "cotizaciones", roles: [] },
    { id: "cotizaciones-especificaciones.html", titulo: "Especificaciones de Cotización", grupo: "cotizaciones", roles: ["cotizaciones"] },
    { id: "alucufel/index.html", titulo: "ALUCUFEL", grupo: "alucufel", roles: ["contratista", "fabrica"] },
    { id: "alucufel/cotizaciones.html", titulo: "ALUCUFEL: Cotizaciones", grupo: "alucufel", roles: ["contratista"] },
    { id: "alucufel/fabrica.html", titulo: "ALUCUFEL: Fábrica", grupo: "alucufel", roles: ["fabrica"] },
    { id: "citrus.html", titulo: "Citrus (Integración)", grupo: "erp", roles: [] },
    { id: "erp.html", titulo: "ERP", grupo: "erp", roles: ["contable"] },
    { id: "mantenimiento.html", titulo: "Mantenimiento", grupo: "erp", roles: [] },
    { id: "produccion.html", titulo: "Producción (Costeo de obra)", grupo: "erp", roles: [] },
    { id: "bancos.html", titulo: "Bancos y Tesorería", grupo: "bancos", roles: ["contable"] },
    { id: "bancos-caja.html", titulo: "Caja Chica", grupo: "bancos", roles: ["contable"] },
    { id: "bancos-cierres.html", titulo: "Cierres de Caja", grupo: "bancos", roles: ["contable"] },
    { id: "bancos-cuentas.html", titulo: "Cuentas Bancarias", grupo: "bancos", roles: ["contable"] },
    { id: "bancos-caja-historial.html", titulo: "Historial de Caja Chica", grupo: "bancos", roles: ["contable"] },
    { id: "bancos-lineas.html", titulo: "Líneas de Crédito", grupo: "bancos", roles: ["contable"] },
    { id: "bancos-movimientos.html", titulo: "Movimientos Bancarios", grupo: "bancos", roles: ["contable"] },
    { id: "bancos-prestamos.html", titulo: "Préstamos y Leasing", grupo: "bancos", roles: ["contable"] },
    { id: "bancos-tarjetas.html", titulo: "Tarjetas Corporativas", grupo: "bancos", roles: ["contable"] },
    { id: "bancos-transferencias.html", titulo: "Transferencias entre cuentas", grupo: "bancos", roles: ["contable"] },
    { id: "contabilidad-categorias.html", titulo: "Categorías / Cuentas", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad-catalogo.html", titulo: "Catálogo de Cuentas", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad-centros.html", titulo: "Centros de Costo", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad.html", titulo: "Contabilidad", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad-cxcp.html", titulo: "Cuentas por Cobrar / Pagar", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad-gastos.html", titulo: "Gastos", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad-recurrentes.html", titulo: "Gastos Fijos", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad-ingresos.html", titulo: "Ingresos", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad-movimientos.html", titulo: "Ingresos y Gastos", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad-presupuesto.html", titulo: "Presupuesto vs Real", grupo: "contabilidad", roles: ["contable"] },
    { id: "contabilidad-reportes.html", titulo: "Reportes de Contabilidad", grupo: "contabilidad", roles: ["contable"] },
    { id: "rrhh-asistencia.html", titulo: "Asistencia y Permisos", grupo: "rrhh", roles: [] },
    { id: "rrhh-catalogos.html", titulo: "Catálogos RRHH", grupo: "rrhh", roles: [] },
    { id: "rrhh-ciclo.html", titulo: "Ciclo del empleado", grupo: "rrhh", roles: [] },
    { id: "rrhh-empleados.html", titulo: "Empleados", grupo: "rrhh", roles: ["contable"] },
    { id: "rrhh-nomina.html", titulo: "Nómina", grupo: "rrhh", roles: ["contable"] },
    { id: "rrhh-reclutamiento.html", titulo: "Reclutamiento", grupo: "rrhh", roles: [] },
    { id: "rrhh.html", titulo: "Recursos Humanos", grupo: "rrhh", roles: [] },
    { id: "rrhh-reuniones.html", titulo: "Reuniones de seguimiento", grupo: "rrhh", roles: ["instalador", "ayudante", "chofer", "cotizaciones", "contable", "comunicaciones"] },
    { id: "rrhh-vacaciones.html", titulo: "Vacaciones", grupo: "rrhh", roles: [] },
    { id: "ventas-actividades.html", titulo: "Actividades CRM", grupo: "ventas", roles: ["cotizaciones"] },
    { id: "ventas-precios.html", titulo: "Listas de Precios", grupo: "ventas", roles: ["cotizaciones"] },
    { id: "ventas-oportunidades.html", titulo: "Oportunidades", grupo: "ventas", roles: ["cotizaciones"] },
    { id: "ventas-reportes.html", titulo: "Reportes de Ventas", grupo: "ventas", roles: ["cotizaciones"] },
    { id: "ventas-comisiones.html", titulo: "Vendedores y Comisiones", grupo: "ventas", roles: ["cotizaciones"] },
    { id: "ventas.html", titulo: "Ventas", grupo: "ventas", roles: [] },
    { id: "productos-categorias.html", titulo: "Categorías", grupo: "productos", roles: [] },
    { id: "productos-lista.html", titulo: "Catálogo", grupo: "productos", roles: [] },
    { id: "productos-impuestos.html", titulo: "Impuestos", grupo: "productos", roles: [] },
    { id: "productos.html", titulo: "Productos y Servicios", grupo: "productos", roles: [] },
    { id: "productos-unidades.html", titulo: "Unidades de Medida", grupo: "productos", roles: [] },
    { id: "activos-lista.html", titulo: "Activos", grupo: "activos", roles: ["contable"] },
    { id: "activos.html", titulo: "Activos Fijos", grupo: "activos", roles: ["contable"] },
    { id: "activos-depreciacion.html", titulo: "Depreciación DR", grupo: "activos", roles: ["contable"] },
    { id: "activos-prestamos.html", titulo: "Préstamo y Renta", grupo: "activos", roles: ["contable"] },
    { id: "academia.html", titulo: "Academia", grupo: "equipo", roles: ["capacitador"] },
    { id: "mensajes.html", titulo: "Mensajería", grupo: "equipo", roles: ["cotizaciones", "chofer", "instalador", "ayudante", "contable", "comunicaciones"] },
    { id: "notas.html", titulo: "Mis Notas", grupo: "equipo", roles: ["cotizaciones", "chofer", "instalador", "ayudante", "contable", "comunicaciones"] },
    { id: "usuarios.html", titulo: "Usuarios y roles", grupo: "equipo", roles: [] },
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
