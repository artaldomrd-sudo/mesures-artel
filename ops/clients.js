// Deduce clientes/obras ya conocidos para ofrecerlos como sugerencia (datalist) al crear una
// Compra Directa o al buscar en el historial, y para normalizar mayúsculas/espacios al guardar
// y así evitar que "Pablo" y "PABLO" terminen siendo dos clientes distintos.
//
// Dos fuentes, porque ninguna sola alcanza:
// - Colección `clientes` (principal): el cuaderno (index.html) sincroniza aquí TODOS los
//   clientes/obras que guarda localmente, aunque nunca se haya enviado un pedido a fábrica.
// - Colección `orders` (respaldo): por si algo se registró ahí sin pasar por el cuaderno (ej.
//   una Compra Directa a un cliente nuevo) o quedó algo sin sincronizar todavía.
const norm = (s) => String(s || '').trim().toLowerCase();

// clienteDocs: array de documentos de la colección `clientes` (con .nombre y .obras).
// orderDataList: array de o.data() de la colección `orders`.
// Devuelve Map<clienteNormalizado, { nombre: 'Casing original', obras: Map<obraNormalizada, 'Casing original'> }>
export function buildClientMap(orderDataList, clienteDocs) {
    const map = new Map();
    (clienteDocs || []).forEach(c => {
        const nc = norm(c.nombre);
        if (!nc) return;
        const entry = map.get(nc) || { nombre: String(c.nombre).trim(), obras: new Map() };
        entry.nombre = String(c.nombre).trim();
        Object.values(c.obras || {}).forEach(o => {
            const no = norm(o);
            if (no && !entry.obras.has(no)) entry.obras.set(no, String(o).trim());
        });
        map.set(nc, entry);
    });
    (orderDataList || []).forEach(o => {
        const nc = norm(o.cliente);
        if (!nc) return;
        if (!map.has(nc)) map.set(nc, { nombre: String(o.cliente).trim(), obras: new Map() });
        const entry = map.get(nc);
        const no = norm(o.obra);
        if (no && !entry.obras.has(no)) entry.obras.set(no, String(o.obra).trim());
    });
    return map;
}

export function clientList(map) {
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// Si el valor escrito ya existe (sin importar mayúsculas/espacios), devuelve el nombre "canónico"
// (el primero que se registró con esa grafía) en vez del que se acaba de escribir.
export function normalizarCliente(valor, map) {
    const entry = map.get(norm(valor));
    return entry ? entry.nombre : String(valor || '').trim();
}

export function normalizarObra(clienteValor, obraValor, map) {
    const entry = map.get(norm(clienteValor));
    if (entry && entry.obras.has(norm(obraValor))) return entry.obras.get(norm(obraValor));
    return String(obraValor || '').trim();
}
