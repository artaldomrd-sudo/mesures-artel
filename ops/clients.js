// Deduce clientes/obras ya conocidos para ofrecerlos como sugerencia (datalist) al crear una
// Compra Directa o al buscar en el historial, y para normalizar mayúsculas/espacios al guardar
// y así evitar que "Pablo" y "PABLO" terminen siendo dos clientes distintos.
//
// Dos fuentes, porque ninguna sola alcanza:
// - Colección `clientes` (principal): el cuaderno (index.html) sincroniza aquí TODOS los
//   clientes/obras que guarda localmente, aunque nunca se haya enviado un pedido a fábrica.
// - Colección `orders` (respaldo): por si algo se registró ahí sin pasar por el cuaderno (ej.
//   una Compra Directa a un cliente nuevo) o quedó algo sin sincronizar todavía.
// Clave de comparación a prueba de duplicados: ignora mayúsculas, tildes Y separadores/conectores
// (para que "STEVE Y ALAIN", "STEVE/ALAIN" y "Steve & Alain" cuenten como el mismo cliente). Solo
// se usa para AGRUPAR — el nombre mostrado sigue siendo el original (entry.nombre).
const norm = (s) => String(s || '')
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\/\\&+,._-]/g, ' ')
    .replace(/\b(y|e|and)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();

// clienteDocs: array de documentos de la colección `clientes` (con .nombre y .obras).
// orderDataList: array de o.data() de la colección `orders`.
// Devuelve Map<clienteNormalizado, { nombre: 'Casing original', obras: Map<obraNormalizada, 'Casing original'> }>
// ¿El texto es una coordenada GPS o un enlace (Maps, http…) en vez de un nombre de obra? (Dylan 2026-10-20: «en nombre
// de obra no se puedan poner coordenadas GPS»). Se bloquea al escribir una obra nueva y se filtra de las listas de obras.
export function esGpsTexto(s) {
    const t = String(s || '').trim();
    if (!t) return false;
    return /^(https?:\/\/|www\.)/i.test(t) || /maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps|share\.google|waze\.com/i.test(t)
        || /^-?\d{1,2}(\.\d+)?\s*[,;]\s*-?\d{1,3}(\.\d+)?$/.test(t) || /^\d{1,2}°\s*\d/.test(t);
}
export function buildClientMap(orderDataList, clienteDocs) {
    const map = new Map();
    (clienteDocs || []).forEach(c => {
        const nc = norm(c.nombre);
        if (!nc) return;
        const entry = map.get(nc) || { nombre: String(c.nombre).trim(), obras: new Map() };
        entry.nombre = String(c.nombre).trim();
        Object.values(c.obras || {}).forEach(o => {
            const no = norm(o);
            if (no && !esGpsTexto(o) && !entry.obras.has(no)) entry.obras.set(no, String(o).trim());
        });
        map.set(nc, entry);
    });
    (orderDataList || []).forEach(o => {
        const nc = norm(o.cliente);
        if (!nc) return;
        if (!map.has(nc)) map.set(nc, { nombre: String(o.cliente).trim(), obras: new Map() });
        const entry = map.get(nc);
        const no = norm(o.obra);
        if (no && !esGpsTexto(o.obra) && !entry.obras.has(no)) entry.obras.set(no, String(o.obra).trim());
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
