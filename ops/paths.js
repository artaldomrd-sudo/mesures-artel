// Calcula la ruta relativa a la raíz del sitio (donde viven index.html y logo.png) según la
// profundidad real de la página actual bajo ops/ — ops/*.html está a un nivel ('../'),
// ops/alucufel/*.html a dos ('../../'), etc. Evita rutas rotas si se agregan más subcarpetas
// dentro de ops/ (como pasó al mover fabrica.html/cotizaciones.html a ops/alucufel/).
export function rootPath(file) {
    const carpeta = location.pathname.replace(/[^/]*$/, '');
    const opsIdx = carpeta.indexOf('/ops/');
    if (opsIdx === -1) return file;
    const profundidad = carpeta.slice(opsIdx + '/ops/'.length).split('/').filter(Boolean).length;
    return '../'.repeat(profundidad + 1) + file;
}
