// Verificación del app ARTAL (index.html).
// Uso:  node verify.mjs
// - Extrae el <script> de index.html
// - Comprueba sintaxis
// - Renderiza renderSVG para todos los tipos (normal y CAD) y reporta errores.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = scripts.join('\n');

// 1) Sintaxis
try { new vm.Script(code, { filename: 'index.inline.js' }); }
catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
console.log('SYNTAX OK');

// 1b) Guardrail de exportPDF(): estos 3 bugs de PDF (capas desalineadas, dibujo estirado,
// vidrio sin color) costaron varias rondas de prueba en el dispositivo real del usuario
// (Safari/iPad) para diagnosticar — ver CLAUDE.md, sección "PDF / Impresión". Si algún cambio
// futuro en exportPDF() borra sin querer alguno de estos arreglos (o reintroduce un patrón ya
// descartado por colgarse/fallar), esto debe fallar ruidosamente en vez de dejar que el bug
// vuelva en silencio.
{
  const start = code.indexOf('async function exportPDF()');
  if (start === -1) { console.error('GUARDRAIL: no se encontró exportPDF()'); process.exit(1); }
  const braceStart = code.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const body = code.slice(start, i);
  // Los comentarios explican a propósito los patrones prohibidos (para que no se repita el
  // error) — si no se excluyen, esas mismas explicaciones harían "pasar" un check de ausencia
  // (ej. el comentario que dice "nunca usar requestAnimationFrame" contiene la palabra prohibida).
  const codeOnly = body.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
  const checks = [
    ['rasteriza el SVG a PNG vía <canvas> (drawImage)', /ctx2d\.drawImage\(/.test(codeOnly)],
    ['quita el filter de sombra antes de rasterizar (si no, Safari no pinta el vidrio)', /replace\(\/\\s\*filter="url\\\(#shadow-/.test(codeOnly)],
    ['calcula width\\/height explícitos en vez de depender de object-fit', /fitScale\s*=\s*Math\.min/.test(codeOnly)],
    ['espera la carga de la imagen con onload\\/onerror + timeout (no img.decode())', /loader\.onload/.test(codeOnly) && !/\.decode\(/.test(codeOnly)],
    ['usa data URI para el SVG intermedio (no Blob URL, que Safari captura en blanco)', /data:image\/svg\+xml/.test(codeOnly) && !/createObjectURL/.test(codeOnly)],
    ['no usa requestAnimationFrame (puede no dispararse nunca en pestaña sin foco)', !/requestAnimationFrame/.test(codeOnly)],
    ['no depende de object-fit (html2canvas no lo respeta de forma confiable)', !/object-fit/.test(codeOnly)],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error('GUARDRAIL exportPDF() FALLÓ — se perdió un arreglo conocido:');
    failed.forEach(([label]) => console.error('  - ' + label));
    process.exit(1);
  }
  console.log('GUARDRAIL exportPDF() OK (' + checks.length + ' checks)');
}

// 2) Stubs mínimos de DOM y ejecución
const el = () => ({ value: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, getContext() { return {}; }, querySelector() { return el(); }, querySelectorAll() { return []; } });
const document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], createElement: () => el(), addEventListener() {}, body: el() };
const ctx = { document, console, setTimeout, clearTimeout, Date, Math, JSON, parseInt, parseFloat, isNaN, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
ctx.addEventListener = () => {}; ctx.matchMedia = () => ({ matches: false, addListener() {} });
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(code + '\n;globalThis.__render=function(id,st){cardsState[id]=st;return renderSVG(id);};', ctx);

const types = ['cor2', 'cor3', 'cor4_cent', 'cor4_lat', 'cor6_cent', 'cor6_lat',
  'gal1', 'gal2_cent', 'gal2_lat', 'gal3_3v', 'gal4_2v', 'gal4_4v', 'gal6_3v',
  'win_abat', 'win_ob', 'win_proy', 'win_souf', 'door_abat', 'mamp_fija', 'door_glass',
  'door_slide', 'fachada_din'];

let ok = 0, fail = 0;
for (const t of types) for (const id of ['card1', 'temp']) {
  try {
    const st = { type: t, categoria: ctx.getCategoriaByType(t), ancho: 1200, alto: 2100, orientacion: 'I', panos: 2, color_vidrio: 'natural', vidrio: 'templado', tirador: 'redondo', herraje_color: 'cromado', cerr_luna: true, cerr_piso: true };
    ctx.__render(id, st); ok++;
  } catch (e) { fail++; console.error(`  ${t} (${id}):`, e.message); }
}
// Vidrio de Ducha (constructor) con varios paneles
try {
  ctx.__render('facade', { type: 'ducha_facade', categoria: 'cerramiento', alto: 2000, paneles: [
    { tipo: 'fijo', ancho: 700, color_vidrio: 'natural', herraje_color: 'cromado', fijacion: 'moldura', moldura_color: 'negro' },
    { tipo: 'deslizante', ancho: 900, orientacion: 'I', color_vidrio: 'natural', herraje_color: 'cromado', tirador: 'redondo', cerr_luna: true, cerr_piso: true },
    { tipo: 'puerta', ancho: 700, orientacion: 'D', bisagras: 'bisagra', color_vidrio: 'natural', herraje_color: 'negro', tirador: '8', cerr_piso: true, moldura: 'blanco' },
  ] }); ok++;
} catch (e) { fail++; console.error('  ducha_facade:', e.message); }

// Paño Fijo adosado (arriba/abajo): tipos con vista de planta (win_abat/win_ob/door_abat,
// donde la vista de planta se reubica al final) y uno sin ella (win_proy), en las 3
// combinaciones (solo arriba, solo abajo, ambos) para no repetir la regresión donde el paño
// de abajo quedaba pegado después de la vista de planta en vez de después de la ventana.
const panoFixture = { alto: 400, vidrio: 'templado', espesor: '10mm', color_vidrio: 'esmerilado', fijacion: 'sin_marco', color_perfil: 'negro' };
for (const t of ['win_abat', 'win_ob', 'door_abat', 'win_proy']) {
  for (const combo of [{ panoArriba: panoFixture }, { panoAbajo: panoFixture }, { panoArriba: panoFixture, panoAbajo: panoFixture }]) {
    for (const orientacion of ['I', 'D']) {
      try {
        const st = { type: t, categoria: ctx.getCategoriaByType(t), ancho: 900, alto: 1200, orientacion, color_vidrio: 'natural', vidrio: 'templado', espesor: '10mm', color_perfil: 'natural', ...combo };
        ctx.__render('card1', st); ok++;
      } catch (e) { fail++; console.error(`  ${t} (${Object.keys(combo).join('+')}, ${orientacion}):`, e.message); }
    }
  }
}

console.log(`RENDER OK: ${ok} FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
