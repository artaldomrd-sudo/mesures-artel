// Regla ÚNICA de "misma obra" en toda la ruta parte diario → viajes → informe de cierre → Historial →
// Costo de obras. Espejo exacto de `mismaObra()` en functions/index.js (si cambia uno, cambiar el otro).
// Caso real (2026-09-22): el trabajo se llamaba "Villa 11 barandas" y los partes "ALTEA VILLA 11 barandas"
// / "ALTEA VILLA 11 ventanas" → cada etapa cruzaba por nombre exacto y el informe salía en 0.
// Misma obra = mismo cliente y, además: mismo nombre, o uno es prefijo del otro, o comparten ≥ 2 palabras
// significativas y, si los dos traen un número (Villa 11 / Villa 12), el mismo número.

export const normTxt = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
export const obraKeyDe = (cliente, obra) => normTxt(cliente) + '|' + normTxt(obra);
const STOP = new Set(['y', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'a', 'al', 'con', '—', '-', '–', 'obra', 'proyecto']);
export const palabrasObra = (o) => normTxt(o).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

export function mismaObra(cliA, obraA, cliB, obraB) {
    if (normTxt(cliA) !== normTxt(cliB)) return false;
    const a = palabrasObra(obraA), b = palabrasObra(obraB);
    if (!a.length || !b.length) return a.join(' ') === b.join(' ');
    if (a.join(' ') === b.join(' ')) return true;
    const [c, l] = a.length <= b.length ? [a, b] : [b, a];
    if (c.every((w, i) => l[i] === w)) return true;                       // prefijo
    const na = a.filter((w) => /^\d+$/.test(w)), nb = b.filter((w) => /^\d+$/.test(w));
    if (na.length && nb.length && !na.some((n) => nb.includes(n))) return false;   // Villa 11 ≠ Villa 12
    const comunes = a.filter((w) => b.includes(w));
    return new Set(comunes).size >= 2;
}

// Agrupa una lista de {cliente, obra, ...} en proyectos (unión transitiva). Devuelve [{cliente, obra (la más
// corta = raíz), nombres:[...], items:[...]}].
export function agruparObras(items) {
    const n = items.length, padre = items.map((_, i) => i);
    const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (mismaObra(items[i].cliente, items[i].obra, items[j].cliente, items[j].obra)) padre[raiz(i)] = raiz(j);
    const g = new Map();
    items.forEach((it, i) => { const r = raiz(i); if (!g.has(r)) g.set(r, []); g.get(r).push(it); });
    return [...g.values()].map((arr) => {
        const nombres = [...new Set(arr.map((x) => String(x.obra || '').trim()))].filter(Boolean);
        const corto = nombres.slice().sort((x, y) => palabrasObra(x).length - palabrasObra(y).length || x.length - y.length)[0] || '';
        return { cliente: arr[0].cliente, obra: corto, nombres, items: arr };
    });
}
