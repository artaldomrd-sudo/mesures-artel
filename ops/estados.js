// Nombres ÚNICOS de los estados en pantalla (auditoría 2026-11-12: el mismo estado se llamaba de hasta seis formas distintas
// según la página — «Listo para cargar», «Lista para cargar», «Listo para cargar/instalar», «Listo para recoger»…).
// Toda pantalla que muestre un estado de pedido o de trabajo lo toma de aquí. Los VALORES internos no cambian.

// orders.status
export const ESTADO_PEDIDO = {
    solicitada: 'Cotización solicitada',
    costeada: 'Costeada · por enviar al cliente',
    enviada_cliente: 'Enviada al cliente',
    pendiente_fabrica: 'Pendiente en fábrica',
    en_fabrica: 'En fábrica',
    parcialmente_listo: 'Parcialmente listo',
    listo_para_cargar: 'Listo para cargar',
    parcialmente_instalado: 'Parcialmente instalado',
    completado: 'Completado',
    pendiente_proveedor: 'Pendiente del proveedor',   // compras directas a ALUCUFEL
};

// instalaciones.estado (+ enPausa)
export const ESTADO_TRABAJO = {
    sin_fecha: 'Sin fecha',
    pendiente: 'Por empezar',
    en_proceso: 'En proceso',
    completado: 'Completado',
};

// Etiqueta de un pedido: siempre por aquí (nunca el código crudo en pantalla).
export function etiquetaPedido(o) {
    if (!o) return '';
    const s = typeof o === 'string' ? o : (o.status || '');
    return ESTADO_PEDIDO[s] || (s ? s.replace(/_/g, ' ') : '');
}

// Etiqueta de un trabajo de Instalación: «Pausada» manda sobre el estado mientras esté en pausa.
export function etiquetaTrabajo(j) {
    if (!j) return '';
    if (typeof j === 'string') return ESTADO_TRABAJO[j] || j.replace(/_/g, ' ');
    if (j.enPausa === true && j.estado !== 'completado') return 'Pausada';
    const s = j.estado || 'pendiente';
    return ESTADO_TRABAJO[s] || s.replace(/_/g, ' ');
}

// Los mismos nombres para el <script> clásico de quien no sea módulo.
if (typeof window !== 'undefined') { window.ESTADO_PEDIDO = ESTADO_PEDIDO; window.ESTADO_TRABAJO = ESTADO_TRABAJO; window.etiquetaPedido = etiquetaPedido; window.etiquetaTrabajo = etiquetaTrabajo; }
