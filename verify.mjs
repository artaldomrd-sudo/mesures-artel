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

// Paño Fijo adosado (arriba/abajo): un tipo con vista de planta y uno sin ella.
const panoFixture = { alto: 400, vidrio: 'templado', espesor: '10mm', color_vidrio: 'esmerilado', fijacion: 'sin_marco', color_perfil: 'negro' };
for (const t of ['win_abat', 'win_proy']) {
  try {
    const st = { type: t, categoria: ctx.getCategoriaByType(t), ancho: 900, alto: 1200, orientacion: 'I', color_vidrio: 'natural', vidrio: 'templado', espesor: '10mm', color_perfil: 'natural', panoArriba: panoFixture, panoAbajo: panoFixture };
    ctx.__render('card1', st); ok++;
  } catch (e) { fail++; console.error(`  ${t} (con panos):`, e.message); }
}

console.log(`RENDER OK: ${ok} FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
