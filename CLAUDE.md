# ARTAL — App de Toma de Medidas / Cotización

App interna de **ARTAL Dominicana** (aluminio y vidrio) para levantar medidas, configurar
elementos (ventanas, puertas, correderas, galandajes, mamparas, barandas, duchas) y generar
un **PDF de Cotización o Fabricación** para el cliente.

## Qué es (arquitectura)

- **Un solo archivo: `index.html`** (~3465 líneas). Sin build, sin dependencias externas salvo
  la fuente Google *Arimo* por CDN. Todo el CSS va en un `<style>` inline y todo el JS en
  bloques `<script>` inline.
- Se abre directamente en el navegador (doble clic) o se sube a **GitHub Pages** para usarla en
  iPad. Repo del usuario: `artaldomrd-sudo/mesures-artel` (Pages sirve `index.html` en la raíz).
- **Los dibujos son SVG generados por JavaScript** (strings). No hay imágenes de los elementos.
- Persistencia con **localStorage**:
  - `artal_projects` → proyectos guardados, estructura `{ cliente: { proyecto: jsonData } }`.
  - `artal_live_progression` → autosave del estado actual.
- El logo es `logo.png` (misma carpeta).

## Cómo trabajar / editar

- Editar `index.html` directamente.
- **SIEMPRE verificar antes de dar por bueno un cambio de dibujo** con `node verify.mjs`
  (ver más abajo). Comprueba sintaxis y renderiza todos los tipos sin error.
- Para revisar un dibujo concreto, se puede rasterizar un SVG con ImageMagick/rsvg y mirarlo.
- **HEIC no se puede decodificar** en este entorno de herramientas: pedir capturas en PNG/JPG.

### Verificación (`verify.mjs`)
`node verify.mjs` extrae el `<script>` de `index.html`, hace un `check` de sintaxis y ejecuta
`renderSVG` para todos los `type` en modo normal y CAD. Debe imprimir `RENDER OK: N FAIL: 0`.

## Estado / datos

- `cardsState`: objeto `{ id: state }` con cada tarjeta del lienzo. Campos típicos:
  `type, categoria, label, orientacion ('I'|'D'), ancho, alto, cantidad, vidrio, espesor,
  color_vidrio, color_perfil, color_ral, herraje_color, vista, cierre, mosquitera, apertura,
  tipo_aluminio, locked`.
- Categorías (`getCategoriaByType`): `corredera, galandaje, ventana, puerta_vidrio, mampara,
  fachada, ducha, baranda, cerramiento`.
- **Vidrio de Ducha** (`categoria: 'cerramiento'`, `type: 'ducha_facade'`): `state.paneles` es
  un array; cada panel `{ tipo:'fijo'|'puerta'|'deslizante', ancho, color_vidrio, vidrio,
  espesor, herraje_color, orientacion, tirador, bisagras, cerr_luna, cerr_digital, cerr_piso,
  fijacion:'conectores'|'moldura', moldura_color, moldura }`.

## Elementos disponibles (menú lateral)

- **Ventanas**: `win_abat` (abisagrada), `win_ob` (oscilobatiente), `win_proy` (proyectada),
  `win_souf` (soufflet), `door_abat` (puerta abisagrada de aluminio).
- **Correderas**: `cor2, cor3, cor4_cent, cor4_lat, cor6_cent, cor6_lat`.
- **Galandajes** (plegables): `gal1, gal2_lat, gal2_cent, gal3_3v, gal4_2v, gal4_4v, gal6_3v`.
- **Vidrios y Mamparas**: `ducha_facade` ("Vidrio de Ducha", constructor) y `fachada_din`
  ("Paños Fijos"). *(Los items sueltos `mamp_fija`, `door_glass`, `door_slide` ya NO están en el
  menú: viven dentro de "Vidrio de Ducha", pero sus `type` siguen existiendo para proyectos
  guardados y para el dibujo libre CAD.)*
- **Barandas**: `baranda_bal` (baranda con constructor de tramos). *(`ducha_cab` "Cabina de
  Ducha" ya NO está en el menú; el `type` sigue existiendo para proyectos guardados que ya
  la tengan.)*
- **Especial**: dibujo libre / **CAD** ("Fachada Compuesta", `type:'draw'`): lienzo donde se
  insertan módulos que se pegan con imán (vidrio con vidrio).

## Sistema de dibujo (SVG)

- `renderSVG(id)` es el punto de entrada. Deriva a:
  - `renderBaranda` (baranda), `renderDucha` (cabina), `renderFacade` (Vidrio de Ducha),
    `renderCADProportional` (cuando `id==='temp'`, es decir, módulos del CAD),
    y el `switch` grande para el resto.
- **Proyecciones**: `isoPt` (isométrica), `oblPt` (oblicua), proyecciones de planta a medida.
- **Vidrio**: `glassDefs(uid,color)` define gradiente `glass-${uid}` + sombra; `glassFillStops`
  da el tinte según `color_vidrio` (natural/negro/azul/esmerilado/reflectivo). Paneles:
  `extrudedPanel` (con borde de espesor, perfil de aluminio opaco) y `glassOnlyPanel` (vidrio
  sin marco: mampara/puerta de vidrio, canto de vidrio traslúcido en vez de borde opaco).
  **Paño Fijo** (`fachada_din`) usa `glassOnlyPanel` cuando `state.fijacion === 'sin_marco'`
  (opción "Sin Marco" del menú), igual que mampara/puerta de vidrio.
- **Acabado del perfil**: `applyFinish(svg, color_perfil, color_ral)` reemplaza los azules base
  `#0A3D62 / #1c5a85 / #0d3f5f` por el color del acabado (`FINISHES`, `finishColors`).
- **Medidas: línea de un extremo al otro (estilo plano técnico)**, no solo texto flotante.
  `dimLineH(x1, x2, y, edgeY, label, fontSize)` (ancho) y `dimLineV(y1, y2, x, edgeX, label,
  fontSize)` (alto) dibujan línea testigo (perpendicular, desde el borde real del elemento hasta
  la línea de medida) + línea principal entre los dos extremos + marcas en 45° + el valor
  centrado — en vez de reusar los chevrones negros de apertura (`arrowL`/`arrowR`), para no
  confundir "cómo abre" con "cuánto mide". `edgeY`/`edgeX` (el borde real de donde parten los
  testigos) se derivan siempre de `getPanelRects(state)[0]`, nunca de una posición fija — un tipo
  ancho (ej. `gal4_4v` sin voltear, borde derecho en x=100) puede acercarse al límite del
  viewBox, así que la línea se ancla `edge + margen` (no una coordenada fija) para no
  superponerse ni salirse. Usadas en: la medida universal ancho/alto de `renderSVG` (después del
  switch grande), los paneles de `renderFacade` (Vidrio de Ducha), y las medidas del Paño Fijo
  adosado (individual de cada paño + el total a la izquierda, ver más abajo).
- **Flechas de apertura: SIEMPRE negras** (`#111`), no cambian con el acabado.
- **Herrajes** (rieles, colgadores, bisagras, tirador, conectores, cerraduras):
  `herrajeCol = herraje_color==='negro' ? '#111111' : '#8d99a4'` (cromado = gris metálico claro,
  NO negro). Definido en `renderSVG`, `renderCADProportional`, `renderFacade` y la capa de riel.
- **Cerraduras**: `cerraduraMarks(edgeX, dir, midY, botY, r, col, luna, dig, piso)` dibuja
  media-luna (semicírculo), digital (teclado con puntos) y piso (rectángulo en la esquina
  inferior del borde de cierre). `dir=+1` si el vidrio está a la derecha del borde, `-1` si a la
  izquierda. Se usa igual en tarjeta normal y en CAD/fachada.
- **Vista superior (planta) de galandajes**: `galandajePlan(state, uid)`. Reglas validadas:
  el vidrio engancha del **concreto** sin mosquitera y del **sheetrock** con mosquitera (la
  mosquitera ocupa el riel exterior). Instalación "por fuera" = espejo vertical. "Sin sheetrock"
  = solo concreto. Menús del galandaje: Instalación (dentro/fuera), Sheetrock (Sí/No),
  Mosquitera. Centrales cascadean desde el centro hacia los lados; laterales cascadean al pocket.
- **Vista superior (planta) de correderas**: `correderaPlan(state, uid)`, config en
  `CORREDERA_CFG` (y `correderaVias(type)` para la cantidad de "vías"). A diferencia del
  galandaje (bolsillo en la pared), la corredera va en un **marco perimetral** con varios
  rieles paralelos ("vías"), cada hoja superpuesta `OVERLAP` unidades con su vecina (no a
  tope). La mosquitera (si aplica) **nunca es una pieza continua**: son hojas propias que
  replican la posición de las hojas que están en el riel exterior, agregadas en un riel nuevo
  siempre el más exterior de todos. **Reglas confirmadas por el usuario (las 6 validadas)**:
  - `cor2` (modo `pair`, 2 vías) — una hoja por riel; qué lado (I/D) va al riel interior se
    elige con el campo `cor_interior` (select "Hoja interior: Izquierda/Derecha").
  - `cor4_cent` (modo `cent`, 2 vías) / `cor6_cent` (modo `cent`, 3 vías) — las hojas se
    agrupan en pares por distancia al centro; el par más próximo al centro va al riel más
    interior, y así sucesivamente hacia afuera (n/2 rieles en total). Sin toggle de
    orientación ni `cor_interior` (la asignación no depende del lado, es simétrica).
  - `cor3`, `cor4_lat`, `cor6_lat` (modo `stair`, 3/4/6 vías) — una hoja por riel ("N vías"),
    en escalera. **Sin toggle de orientación** (oculto para los 3): el mismo campo
    `cor_interior` decide a la vez qué lado queda más interior Y hacia qué lado cascadea todo
    el conjunto (izquierda = interior = cascada hacia la izquierda). La vista de elevación usa
    `putArrowCorStair` (en vez de `putArrow`/`orientacion`) para que las flechas de arriba
    coincidan siempre con la planta.
  - El `railGap` entre rieles es dinámico (`Math.min(7, 34/(rieles-1))`): con hasta 7 filas
    (6 vías + mosquitera) el espaciado por defecto no entra en el viewBox y se achica solo.
  - `cor6_lat` (6 vías) **no admite mosquitera** (ya usa las 6 vías disponibles): sin selector
    en el menú y con salvaguarda en `correderaPlan()` por si un proyecto guardado la tenía.
  - No usa Instalación/Sheetrock (no hay pared, es marco propio) — solo Mosquitera
    (`state.mosquitera === 'con'`).
  - La cantidad de vías se muestra en la tarjeta, debajo del nombre del tipo, en azul y
    tamaño grande (14px, mismo color que el nombre del tipo) para que se note — igual para
    galandajes: `galandajeVias(type)` / `GALANDAJE_VIAS` (el número ya viene en el propio id
    del tipo: `gal3_3v`→3, `gal4_2v`→2, `gal4_4v`→4, `gal6_3v`→3; `gal1`/`gal2_lat`/`gal2_cent`
    no tienen sufijo, se hardcodean).
  - `correderaVias(type, mosq)` suma 1 vía si hay mosquitera (ocupa un riel extra), salvo en
    `cor6_lat` que no la admite. La galandaje NO suma (la mosquitera ocupa el riel exterior
    existente, no agrega uno nuevo). El div de vías tiene `id="vias-${id}"` y `updateState()`
    lo refresca a mano cuando cambia `mosquitera` (ese texto se genera una sola vez al crear
    la tarjeta en `addItem`, no se regenera solo con el resto del dibujo).

## CAD (dibujo libre) — importante

- El módulo del lienzo tiene proporción real: `item.w = ancho*0.06`, `item.h = alto*0.06`.
- `renderCADProportional` dibuja el elemento **llenando** esa proporción (`viewBox 0 0 100 H`,
  `preserveAspectRatio="none"`), sin deformar (porque la caja ya tiene la proporción real) y con
  el imán intacto (el vidrio llega a los bordes del módulo). `cadTechnical` dibuja las líneas
  técnicas/herrajes por tipo, proporcional a `W`/`H`.
- **`item.img` (caché de la imagen rasterizada de cada módulo, seteada por
  `updateCADItemImage`) es un `HTMLImageElement` en vivo — no serializable.** Bug real: un
  proyecto con "Fachada Compuesta" fallaba al mandarlo a fábrica/cotización con
  `FirebaseError: Function addDoc() called with invalid data. Unsupported field value: a custom
  HTMLImageElement object` — Firestore, a diferencia de `JSON.stringify` (que un `Image` lo
  convierte en `{}` sin romper nada), rechaza el documento entero de una. `getAppJSON()` ahora
  arma `inputsData[id].cadItems` con `.map(({img, ...rest}) => rest)` — descarta `.img` al
  exportar (para `localStorage`, `orders` y `proyectosGuardados`, los tres consumidores de
  `getAppJSON()`), sin tocar el array en vivo `window['cadItems'+id]` que sigue dibujando en
  pantalla. Seguro de omitir: al restaurar (`addItem`), ya se vuelve a llamar
  `updateCADItemImage()` por cada item para regenerar `.img` desde cero — nunca se leía de
  vuelta desde el guardado.

## Paño Fijo adosado (arriba/abajo) en ventanas/puertas

Alternativa ligera al CAD para el caso más común: pegarle un paño fijo de vidrio arriba y/o
abajo de una ventana/puerta (ej. oscilobatiente + paño de ventilación fijo encima), con la
**misma fidelidad visual que una tarjeta normal** (degradado de vidrio, marco extruido) — no el
estilo simplificado del CAD.

- Solo disponible para `categoria === 'ventana'` (`win_abat, win_ob, win_proy, win_souf,
  door_abat`). Campos nuevos y planos en `cardsState[id]` (nada de posición libre que guardar,
  a diferencia del CAD): `panoArriba` / `panoAbajo`: `null` o `{ alto, vidrio, espesor,
  color_vidrio, fijacion, color_perfil, color_ral }`. Sin campo de ancho propio: el paño
  **siempre hereda el ancho del ítem base** vía `getPanelRects(state)[0]`.
- **Persistencia gratis**: como `getAppJSON`/`restoreData`/`addItem` ya guardan/restauran
  `cardsState[id]` como objeto completo, estos campos viajan solos. Igual con la whitelist de
  re-render de `updateState` (no hace falta tocarla): los paños tienen su propia función
  separada, `updatePanoState(id, side, key, value)`, que llama a `renderSVG(id)` directo.
- **Composición al final de `renderSVG`, sin tocar el switch grande**: `renderSVG` sigue
  devolviendo exactamente lo mismo que antes cuando no hay paños. Si `state.panoArriba` o
  `state.panoAbajo` existen, el string ya terminado (después de su propio `applyFinish`) se
  envuelve con `composePanos(id, state, finished, viewBox)`, que:
  - Extrae `viewBox`/contenido del `<svg>` base con una regex simple (todos los tipos target
    comparten el mismo rango horizontal de coordenadas, así que no hace falta reescalar nada).
  - Agrega una banda de alto fijo (`PANO_BAND_H = 34`) por cada paño activo, generada por
    `buildPanoFragment(uid, side, pano, panelRect)` — su propio `glassDefs`/gradiente con un uid
    distinto (`${uid}arriba`/`${uid}abajo`) y su propio `applyFinish(frag, pano.color_perfil,
    pano.color_ral)` **antes** de pegarse (nunca aplicar `applyFinish` una sola vez sobre el
    conjunto ya unido — mezclaría el acabado del paño con el del ítem base).
  - Traslada el contenido con `<g transform="translate(0, Y)">` (nunca
    `preserveAspectRatio="none"` con un viewBox reescalado): así no se distorsiona el dibujo
    base, ni siquiera en los tipos que ya combinan elevación + vista de planta en el mismo
    viewBox (`win_abat`/`win_ob`/`door_abat`).
  - Usa `extrudedPanel` o `glassOnlyPanel` según `pano.fijacion === 'sin_marco'`, con una "F"
    centrada y la medida con `dimLineV` (línea de un extremo al otro del paño, no solo texto) —
    misma fórmula `bx+bw+margen` que la medida "alto" del ítem base (comparten el mismo
    `panelRect`), así ambas líneas quedan alineadas en la misma columna sin importar el tipo —
    sin réplica de moldura/conectores en detalle (eso vive en `moldFrame`, un closure local de
    `cadTechnical`, no reutilizable aquí).
  - **Anclaje al panel real, no al viewBox original**: el viewBox de `win_abat`/`win_ob`/
    `door_abat` reserva de fábrica un margen (arriba, para la medida "ancho"; abajo, para la
    vista de planta) pensado para el dibujo SIN paños. Si el paño se ancla a ese margen (`vbY`
    o el borde del viewBox) queda separado de la ventana con un hueco visible. En vez de eso:
    el paño de **arriba** se ancla al mismo `y=4` fijo que usa la medida "ancho" (para todos los
    tipos), y el de **abajo** al borde real del panel de vidrio (`getPanelRects(state)[1]+[3]`)
    — en ambos casos con el mismo margen `gap=4` que separa el resto de los elementos del
    dibujo, para que el paño quede pegado a la ventana/puerta.
  - **Vista de planta reubicada al final**: en `win_abat`/`win_ob`/`door_abat` la vista de
    planta (`drawPlanView`, marcada con `<g class="plan-view-layer">` en sus 3 sitios de
    llamado) se dibuja de fábrica pegada al borde inferior del viewBox — si el paño de abajo se
    ancla al panel real (punto anterior), la vista de planta queda "flotando" entre la ventana y
    el paño. `composePanos` la extrae con una regex y la reinserta siempre al final del
    compuesto (después de los paños), desplazada hacia abajo solo lo que ocupa el paño de abajo
    (si existe) para no superponerse.
  - **Volteo (`orientacion === 'D'`)**: el ítem base ya se espeja con `scale(-1, 1)
    translate(-100, 0)` cuando `orientacion === 'D'` en estos 4 tipos (`win_abat/win_ob/
    win_souf/door_abat` — mismo criterio que usa `renderSVG`, línea ~3644). Si el paño no
    recibe el mismo espejo se ve "desde otra perspectiva" que la ventana (el borde de espesor
    del vidrio queda del lado contrario). `buildPanoFragment` envuelve **solo el panel de
    vidrio** (`extrudedPanel`/`glassOnlyPanel`) en ese mismo transform cuando corresponde — el
    texto ("F" y la medida) nunca se voltea, para seguir siendo legible.
  - **Medida total a la izquierda**: además de la medida individual de cada pieza (a la
    derecha), se agrega `state.alto + panoArriba.alto + panoAbajo.alto` con su propia
    `dimLineV` del lado izquierdo (`panelRect[0] - 10`, `text-anchor="end"` automático por
    `dir<0`) — la línea va del tope real del conjunto (el paño de arriba, o la ventana si no
    hay) al fondo real (el paño de abajo, o la ventana si no hay), **sin incluir** el espacio
    reservado para la vista de planta reubicada (esa vista no es parte de la medida instalada).
    Todo sin tocar `state.alto`, que sigue siendo solo la altura de la hoja operable.
- **UI**: botones "+ Paño Fijo arriba/abajo" (`togglePano(id, side)`, reutiliza `.toggle-btn`)
  como hermanos de `.config-options` — nunca dentro, porque `updateState` regenera
  `#options-${id}` completo al cambiar vidrio/acabado/fijación del ítem base y borraría la UI
  del paño. Mini-configuración propia con clase `.pano-config-options` (grid 2 columnas propio,
  no interfiere con la reconciliación de selects de `.config-options`), generada por
  `renderPanoSection(id)` / `buildPanoConfigHtml(id, side, pano)` y refrescada con
  `refreshPanoUI(id)`.
- **Resumen/PDF**: `generateSummary` agrega una línea por paño adosado (medidas + vidrio +
  fijación) y una línea de "Alto total (con paños)" — sin tocar `state.alto`, que sigue
  significando solo la altura de la hoja operable (no rompe ningún cálculo de área de
  vidrio/herrajes que dependa de él). Como la sección de paños vive dentro de `.hide-on-lock`,
  se oculta sola al fijar el ítem/exportar PDF, igual que el resto de los controles de edición.

## Vidrio de Ducha (constructor de paneles)

- `renderFacadeBuilder(id)`: UI del constructor. Botón desplegable **"+ Agregar"** (Mampara/
  Puerta Abisagrada/Puerta Deslizante), botón **⇄ Invertir** global, y por panel: tipo, ancho,
  **⇄ invertir panel**, **×** borrar, y `renderPanelOptions`.
- Funciones: `facadeAddPanel(id,tipo)`, `facadeRemovePanel`, `facadeUpdatePanel`,
  `facadeSetTipo`, `facadeInvert` (voltea orden + orientaciones), `facadeInvertPanel`,
  `refreshFacade`.
- `renderFacade(state,id)`: dibuja los paneles en fila (cada uno con su propio gradiente/uid),
  reutilizando `cadTechnical` por tipo. El **riel de la deslizante es UNA sola pieza continua**
  que llega hasta el extremo del lado por donde desliza (cubre la mampara vecina).
- La **mampara** respeta `orientacion` (lado de fijación de los conectores) salvo con
  **Moldura U** (marco perimetral negro/blanco, sin lado de fijación → se oculta el ⇄).

## PDF / Impresión

- `exportPDF()` → `buildPrintSheets()` reorganiza el DOM en **hojas de 4 ítems (2×2)** dentro de
  `#print-area`: encabezado solo en la hoja 1, firmas al fondo de la última. La fachada
  panorámica del CAD ocupa fila completa (cuenta como 2 slots).
- **El PDF se genera por código (jsPDF + html2canvas, CDN), NO con `window.print()`.** Motivo:
  Safari (Mac e iPad) agrega siempre su propio pie de página (URL, fecha, número de página) al
  imprimir una web, y **no hay forma de desactivarlo** desde CSS ni JS — es una limitación de
  Safari, no un bug del código. `exportPDF()` arma las hojas con `buildPrintSheets()`, captura
  cada `.print-sheet` con `html2canvas` (`scale:2`), arma un PDF con `jsPDF` (una imagen JPEG
  por página, `calidad 0.9` — **JPEG, no PNG**: con PNG una sola página con degradados de
  vidrio pesaba ~15-50MB) y dispara la descarga con `pdf.save()`. Trade-off aceptado: el texto
  del PDF ya no es seleccionable/buscable (es una imagen), a cambio de que se ve idéntico en
  cualquier navegador y sin pie de página.
- Las reglas CSS que dan forma al PDF (tamaño de tarjetas, grid 2×2, etc.) están bajo el
  selector **`body.printing-sheets`** (sin `@media print`): tienen que aplicar en pantalla
  normal para que `html2canvas` las capture bien, no solo durante una impresión real. Solo
  `@page { margin: 0 }` sigue dentro de `@media print` (por si alguna vez se usa
  `window.print()` de respaldo).
- **Teardown** restaura el DOM original (mismo orden) después de generar el PDF (bloque
  `try/finally` en `exportPDF()`). Antes de generar se regeneran todos los resúmenes y se
  fuerza la vista de resumen (`.show-on-lock`) para que el PDF nunca muestre los menús.
- El logo va **incrustado en `index.html` como `data:image/png;base64,...`**, no como
  `<img src="logo.png">`: si se carga como archivo aparte (sobre todo abriendo la app por
  doble clic, protocolo `file://`), el canvas de `html2canvas` queda "contaminado" y el
  navegador bloquea `canvas.toDataURL()` con `SecurityError: Tainted canvases may not be
  exported`. `logo.png` se mantiene en la carpeta solo como archivo fuente por si hay que
  regenerar el base64 (con `base64 -i logo.png`), pero el HTML ya no lo referencia.
- **html2canvas + `<input>` con `placeholder`: bug conocido.** Si un input tiene atributo
  `placeholder` Y valor a la vez, html2canvas dibuja ambos textos superpuestos (se ve como
  texto cortado/recortado arriba del campo) — sin importar el margen/line-height que se le
  ponga, porque el problema es de renderizado de html2canvas, no de CSS. `exportPDF()` quita
  el atributo `placeholder` de **todos** los inputs dentro de `#print-area` antes de capturar
  (tengan o no valor) y lo restaura en el `finally`. Si se agrega un input nuevo con
  `placeholder` a una tarjeta, no hace falta tocar nada — ya lo cubre el `querySelectorAll`.
- **html2canvas + fuente web (Arimo) todavía cargando: otro bug de texto recortado/desplazado.**
  Si `html2canvas` captura antes de que Arimo (Google Fonts) termine de cargar, dibuja con la
  fuente de reemplazo del navegador — que tiene métricas (alto de línea, ascendente/descendente)
  distintas — dentro de cajas ya calculadas para Arimo, y el texto sale cortado o corrido
  (reproducido en el encabezado del proyecto). `exportPDF()` hace `await document.fonts.ready`
  antes de capturar cada hoja (no agrega demora si las fuentes ya cargaron).
- **Nunca usar `requestAnimationFrame` dentro de `exportPDF()`** (se probó y se revirtió): en una
  pestaña sin foco/en segundo plano el navegador puede no dispararlo nunca, colgando la
  generación del PDF para siempre (botón atascado en "Generando PDF…"). El único espera-a-que-
  se-asiente-el-layout seguro acá es un `setTimeout` plano (150ms). Por el mismo motivo, esperar
  a que cargue una imagen con `img.decode()` tampoco es seguro: para un SVG con `width="100%"`
  (sin tamaño intrínseco absoluto, como los de esta app) `decode()` puede quedarse colgado para
  siempre en vez de resolver o rechazar — usar `onload`/`onerror` con un `Promise.race` contra un
  timeout si hace falta esperar una imagen.
- **html2canvas no usa el renderizado nativo del navegador para `<input>`/`<textarea>`** — los
  vuelve a dibujar él mismo con su propio motor de texto, y ese motor falla de dos formas: en
  `<textarea>` no hace salto de línea (una nota larga sale como una sola línea cortada a la
  mitad de la oración); en `<input>` el texto sale desplazado/recortado verticalmente (se vio en
  el encabezado del proyecto: "CLIENTE"/"COLOR·ACABADO" etc. con la parte de arriba de las
  letras del VALOR cortada, mientras las etiquetas — que no son inputs — se veían bien). Ninguna
  de las dos se arregla con CSS (ni `height:auto`, ni `overflow:visible`, ni forzar alto por JS
  vía `scrollHeight`) porque el problema es del renderizado de html2canvas, no del layout real.
  `exportPDF()` reemplaza **todo campo con texto** dentro de `#print-area` (`input[type="text"]`
  y `textarea`), solo durante la captura, por un `<span>`/`<div>` con el mismo valor (que sí se
  dibuja con el texto normal del navegador, sin el motor propio de html2canvas) — oculta el
  campo real (`display:none`, nunca lo destruye) y lo restaura en el `finally`, **antes** de
  `teardownPrintSheets()` (si no, el reemplazo viajaría de vuelta a la tarjeta real y quedaría un
  texto duplicado visible en la edición normal).
- **`exportPDF()` catch: mostrar `e.message` a secas puede imprimir literalmente "undefined".**
  Errores de `html2canvas` (ej. una imagen que falla por CORS) no siempre son un `Error` de JS
  normal y pueden no tener `.message` — el catch ahora hace `console.error(e)` (para poder
  diagnosticar el error real) y arma el mensaje del `alert` con fallbacks (`e.message || e.name
  || e` como string || "error desconocido").
- **Encabezado del proyecto** (`.project-header`): grid de 2 filas por `grid-template-areas`
  (fila 1 = datos cortos: cliente/material/color/fecha; fila 2 = datos largos: nombre del
  proyecto/ubicación, que necesitan más ancho). El logo abarca ambas filas
  (`grid-area: logo`). Mismo esquema en pantalla y en `body.printing-sheets` (solo cambian
  gaps/alineación). El campo `header-ubicacion` se guarda/restaura igual que los demás en
  `getAppJSON`/`restoreData`/`resetNotebook`.
- **Hoja con un solo ítem**: `buildPrintSheets()` le agrega la clase `single-item` al
  `.sheet-grid` cuando el grupo tiene 1 sola tarjeta (no panorámica), para que se agrande y
  centre en la página en vez de quedar chica y pegada a la esquina.
- **Dibujos deformados en el PDF al capturar con `html2canvas`** (capas — vidrio, marco
  extruido, líneas de apertura — visiblemente desalineadas entre sí, no solo en correderas/
  galandajes: se vio igual en ventanas, puertas, y paño fijo adosado). Reportado por el usuario,
  confirmado extrayendo el JPEG embebido de PDFs reales (la vista previa de baja resolución no
  alcanza para verlo) — **nunca se pudo reproducir en Chrome/Puppeteer**, parece específico de
  Safari (el dispositivo real del usuario). Se descartaron con evidencia dos causas que NO son
  responsables: las líneas de medida técnica (`dimLineH`/`dimLineV`, A/B test visual idéntico) y
  el paño fijo (ese commit no toca nada de correderas).
  **Arreglo actual** (en `exportPDF()`): reemplazar cada `<svg>` de `.drawing-area` por una
  imagen antes de capturar — pero el SVG como `<img src="data:image/svg+xml,...">` directo NO
  alcanza (`html2canvas` lo captura en blanco); hace falta rasterizarlo A UN PNG real primero
  (vía un `<canvas>` intermedio, `ctx.drawImage(imgConSvg,...)` + `canvas.toDataURL('image/png')`)
  y usar ESE PNG. Probado en correderas, galandajes, ventanas (con y sin paño fijo), puertas,
  baranda y vidrio de ducha — todos correctos en las pruebas locales.
  **Nota importante sobre una falsa alarma en el camino**: en una ronda de prueba, el usuario
  reportó "aparecen ítems que no tienen nada que ver con mi proyecto" — parecía un bug nuevo y
  grave, pero **resultó ser contaminación de archivos**: al llamar a `exportPDF()` real (no la
  réplica manual de bytes) durante las pruebas en este mismo Mac del usuario, se dispararon
  descargas reales a su Desktop/Downloads, mezclándose con sus PDFs reales. Se identificaron y
  borraron 2 archivos así (`...presupuesto.pdf`, `...presupuesto 20.09.10.pdf` — el sufijo
  "presupuesto" los delataba: el proyecto real del usuario siempre está en modo Fabricación). Por
  esto, **NUNCA llamar a `exportPDF()` real durante pruebas en la máquina del usuario** — usar
  solo la réplica manual (`pdf.output('arraybuffer')` sin `.save()`) para extraer bytes sin
  disparar una descarga real.
  Errores de implementación encontrados en el camino (evitar si se retoma esto):
  `requestAnimationFrame` en cualquier punto de `exportPDF()` puede no dispararse nunca en una
  pestaña sin foco, colgando la generación para siempre; `img.decode()` puede colgarse para
  siempre con un SVG de `width="100%"` (usar `onload`/`onerror` + `Promise.race` con timeout);
  un Blob URL (`URL.createObjectURL`) para la imagen intermedia también sale en blanco con
  `html2canvas` (usar `data:image/svg+xml;charset=utf-8,` + `encodeURIComponent` en su lugar).
  También se probó (y se descartó) subir el alto del `.drawing-area` de corredera/galandaje
  (clase `plan-view-card`, 44mm en vez de 34mm) — no era la causa real, no hizo falta.
  **Confirmado por el usuario en su dispositivo real (Safari)**: "PROBE Y FUNCIONA" — la
  deformación de capas ya no ocurre.
  **Segundo problema encontrado tras el arreglo anterior: el dibujo salía estirado** (proporción
  incorrecta, no ya "descompuesto" sino deformado como imagen). Causa: el `<img>` de reemplazo
  usaba `width:100%; height:100%; object-fit:contain` para encajar en `.drawing-area` —
  `html2canvas` **no respeta `object-fit` de forma confiable** (otra limitación del mismo tipo
  que las de arriba) y estira la imagen para llenar la caja entera. **Arreglo**: calcular a mano,
  en JS, el tamaño en píxeles que mantiene la proporción real dentro del contenedor
  (`container.getBoundingClientRect()` para la caja + `naturalWidth`/`naturalHeight` de la
  imagen cargada → `fitScale = Math.min(boxW/w, boxH/h)`) y fijarlo como `width`/`height`
  explícitos en px (no porcentaje, no `object-fit`) — así no queda nada por interpretar del lado
  de `html2canvas`. Verificado visualmente (réplica manual de bytes, nunca `exportPDF()` real)
  comparando el PDF extraído contra el dibujo en vivo para `cor2` y `win_ob` + paño fijo abajo:
  proporciones coinciden.
  **Tercer problema: el vidrio salía sin color** (solo el degradado del panel, líneas/texto/
  flechas se veían bien). Causa: el `<rect>` del vidrio es el único elemento del dibujo que
  lleva `filter="url(#shadow-${uid})"` (la sombra, `feDropShadow`) además de su
  `fill="url(#glass-${uid})"` — Safari, al pintar el SVG como `<img>` (fuera del DOM en vivo,
  contexto distinto al de renderizado normal), no siempre resuelve ese `filter` y, por spec,
  dejar de pintar el elemento **completo** que lo referencia, no solo el efecto de sombra.
  **Arreglo**: quitar `filter="url(#shadow-...)"` del string del SVG (regex) solo para esta
  rasterización, antes de convertirlo a data URI — la sombra es decorativa y se pierde sin
  problema en el PDF, el `fill` con gradiente no se toca. **Confirmado por el usuario en su
  dispositivo real**: "probado, funciona" — los 3 problemas (capas desalineadas, estirado, y
  vidrio sin color) quedan resueltos.
- Grosores en el resumen se muestran con `espesorLabel`: `3/8" (10mm)`, `1/2" (12mm)`, `3+3`…

## Proyectos guardados

- `getProjects` normaliza estructuras corruptas y **fusiona clientes duplicados sin importar
  mayúsculas** (Gabor = GABOR). `saveProject/loadProject/deleteProject/updateClientList/
  updateObraList/backupAllProjects`. Menú lateral: "Clientes" → "Proyecto".
- **`backupAllProjects()` en iPad: "copia creada" pero no aparece en ningún lado.** Caso real
  reportado por el usuario. Causa: un `<a download>` con un `data:` URI (todo el JSON de todos
  los proyectos codificado como texto en la URL) es poco confiable en iOS/iPadOS Safari para
  archivos grandes (16 proyectos ya puede ser varios MB una vez url-encoded) — puede fallar en
  silencio o guardarse en una carpeta "Descargas" escondida dentro de la app Archivos, sin que
  el usuario sepa que existe. **Arreglo**: el JSON se arma como `Blob` (no `data:` URI) y, si el
  navegador soporta compartir archivos (`navigator.canShare({files:[...]})` — Safari en
  iOS/iPadOS sí, es la respuesta directa a "agrégame opción para elegir dónde guardar"),
  dispara el selector nativo (`navigator.share`) para que el usuario elija a mano el destino
  (Archivos, iCloud Drive, etc.); si no hay soporte (navegadores de escritorio), cae a la
  descarga de siempre pero con `URL.createObjectURL(blob)` en vez de `data:` URI — más
  confiable para archivos grandes en cualquier navegador. `AbortError` (el usuario cerró el
  selector sin elegir) no se trata como error.
- **Aviso antes de reemplazar un proyecto guardado.** Caso real reportado por el usuario: en la
  obra tomó medidas en una hoja, la mandó a fábrica (guardada), y luego en **otra hoja** (otra
  pestaña/sesión, para la parte de barandas) puso el **mismo** Cliente + Nombre de Proyecto y le
  dio Guardar — `saveProject()` sobrescribió en silencio la entrada anterior en
  `artal_projects`, perdiendo más de una hora de trabajo ya enviado a fábrica. `saveProject()`
  ahora compara contra `openedProjectKey` (variable en memoria: el cliente+proyecto de la hoja
  que está realmente abierta en esta sesión, seteada por `loadProject()` al abrir un proyecto
  existente, o por el propio `saveProject()` tras guardar). Si el nombre de destino **ya existe**
  en `artal_projects` y **no** es el proyecto que esta hoja tiene abierto, `confirm()` antes de
  pisarlo ("Ya existe un proyecto... ¿Seguro que quieres reemplazarlo?") — cancelar aborta el
  guardado sin tocar nada. Guardar repetidamente el mismo proyecto ya abierto (el caso normal de
  uso, guardar seguido mientras se mide) **no pregunta** — solo el caso de colisión de nombre
  entre hojas distintas. `resetNotebook()` ("Hoja en blanco") limpia `openedProjectKey` a `null`
  para no arrastrar por error el "proyecto abierto" de la hoja anterior. (Nota: el separador
  `cliente + '|' + obra` usado para armar `openedProjectKey`/`targetKey` tiene que ser
  **idéntico** en `saveProject()` y `loadProject()` — si difiere, la comparación nunca coincide y
  el aviso saldría siempre, incluso guardando tu propio proyecto abierto.)
- **Campo CLIENTE con autocompletar (`<input list="cliente-datalist">`)**: sugiere los clientes
  ya guardados (vía `<datalist>`, poblado por `updateClientList()` junto con el `<select>` de
  "Abrir proyecto") para evitar que el mismo cliente quede duplicado por una variación de
  mayúsculas/tildes/espacios al escribirlo a mano — pero sigue siendo un campo de texto libre
  (a diferencia de un `<select>`), así que registrar un cliente nuevo simplemente escribiéndolo
  sigue funcionando igual que antes.
- **Campo NOMBRE DEL PROYECTO con autocompletar + auto-normalización, fuente Firestore.**
  Motivo: la "obra" de un pedido enviado a fábrica/cotización (`enviarOrden()`) es lo que agrupa
  "Carpetas por obra" en `ops/historial.html` (ver más abajo) — si dos envíos de la misma obra
  real usan un nombre levemente distinto, terminan en dos carpetas separadas. `<input
  list="obra-datalist">` sugiere las obras ya conocidas PARA el cliente escrito en ese momento
  (`refreshObraDatalist()`, recalculado con el evento `input` del campo CLIENTE), usando
  `buildClientMap` de `ops/clients.js` (mismas dos fuentes que ya usa `ops/compras.html`:
  colección `clientes` + `orders`, con `onSnapshot` — solo se activa con sesión iniciada, ver
  `startFsClientListeners()`, las reglas de Firestore exigen auth para leer). Además,
  `enviarOrden()` pasa `cliente`/`obra` por `normalizarCliente`/`normalizarObra` (mismas
  funciones) **antes** de escribir el pedido: si el texto coincide con uno ya conocido salvo
  mayúsculas/espacios, se guarda con la grafía "canónica" en vez de la recién escrita — sin
  tocar nombres realmente distintos. Esto es la fuente `orders`/`clientes` de Firestore
  (multi-dispositivo), **distinta** del datalist de CLIENTE de arriba (que usa `artal_projects`
  local, un solo dispositivo) — se mantienen separados a propósito.
- **Sincronización de proyectos guardados entre dispositivos (iPad, computadora, etc.).**
  Pedido explícito del usuario: que un proyecto guardado en un dispositivo aparezca solo en los
  demás, ya que toda la plataforma vive en Firebase. **Diseño clave: `localStorage
  ['artal_projects']` sigue siendo la única fuente que lee/escribe todo el código existente
  (`getProjects`, `saveProject`, `loadProject`, `deleteProject`, `updateClientList`,
  `importJSON`, etc.) — nada de eso cambió.** Firestore (colección nueva `proyectosGuardados`,
  un doc por proyecto, ID `sanitizeDocIdPart(cliente)+'__'+sanitizeDocIdPart(obra)` — sanea `/` y
  otros caracteres inválidos en un ID de Firestore, a diferencia de `normClienteKey` que solo
  recorta/minúsculas) funciona **solo como transporte en segundo plano**:
  - `saveProject()` sigue escribiendo local igual que siempre, y además llama (best-effort,
    silencioso sin sesión/señal) a `window.syncProjectToCloud(cliKey, obraKey, jsonData)`.
    `deleteProject()` igual con `window.deleteProjectFromCloud(cliente, obra)`.
  - `getAppJSON()` agrega `header._syncUpdatedAt = Date.now()` (reloj real, a diferencia de
    `fechaModificacion` que es solo texto de fecha sin hora) — viaja solo con el resto del blob,
    es la base para decidir qué versión es más nueva.
  - `startFsProjectsListener()` (script módulo, arranca solo con sesión iniciada, igual que
    `startFsClientListeners()`): `onSnapshot(collection(db,'proyectosGuardados'))`, ignora
    `hasPendingWrites` (eco de la propia escritura) y `removed` (el borrado **no** se propaga
    solo a otros dispositivos — a propósito, para que un dispositivo que estuvo offline mucho
    tiempo no "pierda" un proyecto sin aviso al reconectar; gap conocido, no un bug), y llama a
    `window.mergeCloudProject(cliente, obra, jsonData)` (script clásico, para poder usar
    `getProjects()`/`updateClientList()` directo) — que solo sobreescribe el local si
    `_syncUpdatedAt` entrante es más nuevo, **y si el proyecto no es el que esta hoja tiene
    abierto ahora mismo** (`openedProjectKey`): si lo es, no lo pisa (perdería ediciones sin
    guardar en pantalla) y en cambio `alert()` una vez avisando que se actualizó en otro
    dispositivo, invitando a reabrirlo desde "Abrir proyecto".
  - `bulkSyncProjectsUnaVez()` (mismo patrón/flag que `bulkSyncClientesUnaVez`): sube una sola
    vez, por dispositivo, todos los proyectos que ya existían localmente antes de este cambio.
  - Proyecto que supere ~900KB (límite real de Firestore: 1 MiB por documento) no se sincroniza
    a la nube (solo un `console.warn`, el guardado local nunca se ve afectado).
  - **Riesgo aceptado, no resuelto**: si dos dispositivos editan el MISMO proyecto sin conexión
    al mismo tiempo, gana el que tenga `_syncUpdatedAt` más reciente (reloj del cliente, no del
    servidor) al reconectar — el otro se pierde de la nube (aunque sigue intacto en el
    `localStorage` de ese dispositivo hasta que reciba el snapshot ganador). Sin merge tipo
    CRDT; poco probable en el uso real (una persona por obra) pero posible.
  - `ops/firebase-config.js` ahora usa `initializeFirestore(app, {localCache:
    persistentLocalCache({tabManager: persistentMultipleTabManager()})})` en vez de
    `getFirestore(app)` — habilita persistencia offline (necesaria para que esta sincronización
    funcione de verdad al recuperar señal) con soporte multi-pestaña (varias pantallas de
    `ops/*.html` ya se abren a la vez; el manager de una sola pestaña rompería con
    `failed-precondition` en la segunda). Cambio compartido por TODAS las páginas de `ops/`, no
    solo por el cuaderno.
  - **`node verify.mjs` no prueba nada de esto**: su regex de extracción es `<script>` exacto,
    nunca toca el `<script type="module">` donde vive toda esta lógica de Firestore — cualquier
    cambio futuro acá necesita probarse a mano (dos sesiones/perfiles con la misma cuenta
    Google), no alcanza con correr `verify.mjs` en verde.
  - `firestore.rules` necesita `match /proyectosGuardados/{id} { allow write: if
    puedeEscribir(); }` (la lectura ya la cubre la regla general) — **recordar pegarlo a mano en
    Firebase Console → Firestore Database → Reglas**, igual que cualquier cambio a este archivo
    (no se despliega solo con el push a GitHub Pages).
  - **Confirmado por el usuario en producción**: guardó un proyecto en un dispositivo y apareció
    solo en otro sin recargar manualmente. Funciona.
  - **Trampa real encontrada: la app agregada al Dock/pantalla de inicio del iPad usa
    almacenamiento AISLADO de Safari en el mismo dispositivo** (limitación conocida de iOS para
    apps "Agregadas a Inicio") — un proyecto creado solo ahí adentro no aparece en Safari ni se
    sincroniza a la nube hasta que:
    (a) se **cierra del todo** esa app (deslizarla hacia arriba en el selector de apps, no solo
    salir) y se vuelve a abrir — fuerza al service worker (`sw.js`, estrategia red-primero) a
    traer el código actualizado; o
    (b) si el proyecto quedó atrapado ahí con código viejo: abrirlo en esa misma app y usar
    **"Exportar archivo"** (exporta SOLO el proyecto abierto, a diferencia de "Copia de
    seguridad" que exporta todos) → **"Importar archivo"** desde Safari para traerlo al
    contexto que sí sincroniza. Caso real: obra "Papito" creada solo en el Dock, rescatada así.
    **Recomendación al usuario**: preferir Safari normal para el cuaderno en vez del ícono del
    Dock, salvo que se confirme que éste se actualiza solo de forma confiable.

## Plataforma de Operaciones (`ops/`)

App aparte, sobre **Firebase** (proyecto `artal-operaciones`: Firestore + Auth con Google
Sign-In + Storage + Cloud Messaging + Cloud Functions), para el flujo cotización → fábrica →
chofer/instalador. Vive en la carpeta `ops/` y se enlaza con el cuaderno de medidas (`index.html`)
a través de la colección `orders` de Firestore — **no toca el cuaderno en sí** salvo por
adiciones puntuales y explícitas (ver más abajo).

### Flujo real del negocio

- **Cotización**: el cuaderno manda la ficha a `orders` (`docType` que empieza con `COT`,
  `status:'solicitada'`) → **ALUCUFEL** (contratista externo) sube su PDF de costo
  (`status:'costeada'`) → la encargada de cotizaciones arma el precio final en Citrus (externo,
  no integrado) y sube el PDF final al cliente (`status:'enviada_cliente'`, pantalla
  `ops/cotizaciones.html`).
- **Fabricación**: el cuaderno manda la ficha directo (`docType` que empieza con `FAB`,
  `status:'pendiente_fabrica'`) cuando el cliente ya aprobó — no pasa por cotización.
  `ops/alucufel/fabrica.html` → `en_fabrica` → `listo_para_cargar` (o `parcialmente_listo`, ver
  abajo) → chofer e instalador trabajan **en paralelo**, no en secuencia.
- **Compra Directa** (`ops/compras.html`): para artículos ya hechos que se compran a un
  proveedor externo (tubos, puertas, vidrios) y no pasan por fábrica. Se sube la orden de compra
  en PDF y el pedido entra directo a `status:'listo_para_cargar'` con `docType:'COMPRA_DIRECTA'`
  (sin `appJSON`/`items` del cuaderno — chofer/instalador/historial lo detectan por `docType` y
  muestran el link al PDF en vez de la ficha técnica).
- **Estado `parcialmente_listo`**: fábrica puede marcar solo una parte de los ítems como listos
  (checklist `checklist=fabrica` en el visor de la ficha, escribe
  `itemsListosFabrica.{itemId}`) y mandar el pedido a chofer/instalador antes de terminar el
  resto — quedan visibles en verde/naranja en la ficha técnica que ve el chofer.
- **ALUCUFEL vs. taller/oficina propia (`destino`).** No todo lo que se manda a fábrica o
  cotización lo maneja ALUCUFEL — parte lo hace ARTAL internamente, y eso NO debe aparecer en
  las páginas de ALUCUFEL. Campo `destino: 'alucufel' | 'interno'` en cada pedido de `orders`,
  para Cotización y para Fabricación por igual.
  - **`index.html`**: `enviarOrden(destino, btnEl)` guarda `destino` en ambos modos. El botón
    único de antes se reemplaza por un par fijo (`.destino-row`, siempre visible — ya no
    depende de `body.doc-fab`) cuyo **texto** cambia según el modo (`setDocType()` actualiza
    `#btn-destino-alucufel-text` / `#btn-destino-interno-text`): "ALUCUFEL" / "Oficina ARTAL" en
    Cotización, "Fábrica ALUCUFEL" / "Fábrica Interna" en Fabricación — mismos dos botones,
    mismas dos funciones, solo cambia la etiqueta visible.
  - **Fabricación interna**: `ops/alucufel/fabrica.html` excluye `destino === 'interno'` de su
    tablero (mismo patrón ya usado para excluir `directoInstalacion`).
    `ops/fabrica-interna.html` (nuevo, top-level en `ops/`, NO dentro de `ops/alucufel/` — para
    no repetir el bug de rutas relativas de esa subcarpeta) es una copia del mismo tablero de
    `ops/alucufel/fabrica.html` (Pendiente → En fábrica → Parcialmente listo/Listo para cargar →
    Completado) pero filtrado a `destino === 'interno'`, con `requireAuth([])` (solo
    gerencia/admin — decisión explícita del usuario, sin rol dedicado todavía). Tile nuevo en
    `ops/index.html` ("Fábrica Interna") con su propio badge, mismo criterio que el de ALUCUFEL
    (comentario sin atender o pedido recién llegado a `pendiente_fabrica`) pero separado por
    `destino`.
  - **Cotización interna**: `ops/alucufel/cotizaciones.html` (el contratista sube su costo)
    excluye `destino === 'interno'` de su query de `status:'solicitada'` — a ALUCUFEL nunca le
    llegan. Esas quedan **sin costo de contratista** para siempre (no hay "fábrica interna" para
    cotizaciones, todavía) — `ops/cotizaciones.html` (pantalla interna de precio final) las
    incorpora directo a su lista "Por costear/enviar" junto con las ya `costeada`
    (`render()` filtra `status==='costeada' || (status==='solicitada' && destino==='interno')`)
    — `porEnviarCardHTML` ya mostraba "(sin PDF del contratista)" cuando falta, así que no hizo
    falta tocar la plantilla, solo el filtro. La encargada sube el precio final directo, sin
    pasar por ALUCUFEL. Esto es a propósito una solución simple: cuando se conecte el ERP nuevo
    al Panel de Control, cotización interna se manejará ahí en vez de acá.
  - **`aprobarYEnviarFabrica(id, destino)`** en `ops/cotizaciones.html` (cliente aprobó la
    cotización → crea el pedido de fábrica aparte) también pide destino — dos botones ("A
    ALUCUFEL" / "Oficina interna") en vez de uno solo. Este es un **segundo punto de creación**
    de pedidos de fábrica además de `enviarOrden()` en el cuaderno — si se agrega un tercero en
    el futuro, recordar setear `destino` ahí también (buscar `addDoc(collection(db, 'orders')`
    para encontrar todos los puntos de creación).

### `ops/alucufel/` — ALUCUFEL unificado

ALUCUFEL (contratista + fábrica) tiene **una sola carpeta con un solo link** en vez de dos
pantallas sueltas: `ops/alucufel/index.html` (hub con dos tarjetas) → `cotizaciones.html`
(antes `ops/contratista.html`) y `fabrica.html` (antes `ops/fabrica.html`, movido aquí). Antes
de mandar cualquier link nuevo a Alucufel, es este: `.../ops/alucufel/index.html`.

### Rutas relativas: `ops/paths.js` → `rootPath(archivo)`

**Lección aprendida (bug real, ya corregido):** al mover `fabrica.html`/`cotizaciones.html` a
`ops/alucufel/` (un nivel más profundo que el resto de `ops/*.html`), las rutas fijas
`'../index.html'`, `'../sw.js'`, `'../logo.png'` en los módulos **compartidos**
(`order-preview.js`, `notifications.js`, `auth-common.js`) dejaron de apuntar a la raíz del
sitio — "Ver hoja" abría el Panel de Control en vez de la ficha técnica, y "Activar
notificaciones" fallaba en silencio. Los tres módulos ahora usan `rootPath('index.html')` /
`rootPath('sw.js')` / `rootPath('logo.png')` de `ops/paths.js`, que calcula la ruta según la
profundidad real de `location.pathname` bajo `ops/` (1 nivel → `../`, 2 niveles → `../../`,
etc.). **Cualquier módulo compartido de `ops/` que necesite referenciar algo de la raíz del
sitio debe usar `rootPath()`, nunca una ruta `'../...'` fija** — si se agrega otra subcarpeta
dentro de `ops/` en el futuro, esto evita que se repita el mismo bug.

### Roles y usuarios

- `usuarios/{email}` (Firestore): `nombre`, `rol` (string o array — `requireAuth` normaliza
  ambos a array), `fcmToken` (se llena solo al aceptar notificaciones). `admin` siempre pasa
  cualquier chequeo de rol. Roles: `admin, contratista, fabrica, cotizaciones, chofer,
  instalador`.
- Login con Google (`ops/auth-common.js`, `requireAuth(rolesPermitidos)`) — cada persona entra
  con su propia cuenta (ya no hay logins compartidos: Andrea/Rolanny tienen las suyas). El
  nombre autenticado (`usuario.nombre`) se usa para dejar registro de quién hizo cada acción
  (ej. `creadoPorNombre` en citas y compras), sin selectores manuales.
- La asignación de chofer/instalador a un pedido (`ops/historial.html`) es **informativa**, no
  restringe acceso — cualquier chofer/instalador ve todos los pedidos por si hay que cubrirse.

### Ficha técnica compartida (visor de solo lectura + checklists)

- `index.html?orderId=X` carga un pedido de Firestore en modo solo lectura
  (`body.readonly-view`) — usado por `ops/order-preview.js` (`openOrderPreview(orderId, role)`,
  modal con iframe). **No reenvía nada al cuaderno local**, solo pinta `orderData.appJSON`.
- `&checklist=fabrica|chofer|instalador` inyecta, por DOM, un recuadro en cada tarjeta ya
  renderizada (`injectChecklist` → `injectFabricaChecklist` / `injectChoferChecklist` /
  `injectInstaladorChecklist` en `index.html`) — **sin tocar ninguna plantilla de tarjeta**:
  - `fabrica`: checkbox "Listo para cargar" por ítem → `itemsListosFabrica.{id}`.
  - `chofer`: botones Cargado/Problema → `itemStatus.{id}` (además, si el pedido está
    `parcialmente_listo`, muestra la marca de fábrica en verde/naranja).
  - `instalador`: checklist de etapas por tipo de elemento (`STAGE_SETS`/`getStageSetKey`) →
    `itemStatusInstalador.{id}`.
- Este visor se registra **después** de `loadProgress()` (dentro de su propio
  `DOMContentLoaded`) para que el autosave local nunca pise los datos del pedido de Firestore.

### Clientes/obras: autocompletar y normalización (`ops/clients.js`)

Para evitar que "Pablo" y "PABLO" terminen como clientes distintos (con cientos de trabajos al
año, esto importa): `buildClientMap()` agrupa los `cliente`/`obra` de todos los `orders` ya
existentes sin importar mayúsculas/espacios. Se usa en `ops/compras.html` (datalist +
normaliza al guardar), `ops/historial.html` (datalist en el buscador, que ya era
case-insensitive) e `index.html` (ver "Guardar → Campo NOMBRE DEL PROYECTO con autocompletar",
sección "Proyectos guardados" más arriba).

### Carpetas por obra: combinar duplicadas (`ops/historial.html`)

`renderCarpetas()` agrupa TODOS los pedidos por `(cliente+'|||'+obra).toLowerCase()` exacto — si
la obra se escribió distinto en dos envíos (antes del autocompletar/normalización de arriba, o
si el nombre no coincidía con nada conocido en ese momento), quedan como dos carpetas separadas
de la misma obra real. Cada carpeta tiene un botón **"🔗 Combinar con otra"** (oculto si solo hay
una carpeta) que despliega un `<select>` con las demás carpetas + botón "Unir aquí": con
`confirm()` de por medio (muestra cuántos documentos se van a mover y a qué carpeta), reescribe
`cliente`/`obra` de **todos** los pedidos de la carpeta de origen para que coincidan
exactamente con los de la carpeta destino (`updateDoc` por cada uno) — así `renderCarpetas()` los
agrupa juntos en el próximo `onSnapshot`. Las carpetas de la vista actual se guardan en
`carpetasArr` (módulo) y se referencian por **índice** en los `onclick` (no por el texto de
cliente/obra, que podría traer comillas y complicar el escapado dentro del atributo).

### Notificaciones y badges

- Push real vía Cloud Messaging + Cloud Function `enviarNotificacionCita` (dispara con cada
  documento nuevo en `citas/`) — requiere "Agregar a inicio" en iPhone (limitación de Apple, no
  hay forma de evitarlo). Un solo `sw.js` en la raíz maneja tanto el cascarón offline del
  cuaderno como el listener `push`.
- `ops/index.html` (Panel de Control) muestra círculos rojos (`tile-badge`/`setBadge`) con la
  cantidad de pedidos que necesitan atención *ahora* en cada sección (no un historial de todo lo
  pasado) — ALUCUFEL y Cotizaciones cuentan `status==='costeada'`, comentarios de fábrica sin
  atender, etc.

### Calendario (`ops/calendario.html`) — secciones por persona de gerencia

- El botón/modal para crear un evento dice **"Nuevo evento"** (antes "Nueva cita") porque
  siempre pudo crear una Cita O un Recordatorio (toggle `tipoEvento`) — "cita" era impreciso.
  Nombres internos (`window.abrirNuevaCita`, `guardarCita`, ids `cita-*`, colección Firestore
  `citas`) NO se tocaron, solo el texto visible.
- **Recordatorio "A la hora"** (`value="0"` en `#cita-recordar`, primero de la lista): exige un
  ajuste en la Cloud Function `enviarRecordatorios` (`functions/index.js`,
  `procesarRecordatoriosMulti`) — corre cada 5 minutos, y el filtro `ahora <= fecha` original
  solo mandaba el push si el tick caía **antes o exactamente en** la hora del evento; con offset
  0 esa ventana es prácticamente un instante, así que la mayoría de las veces el tick de 5 min
  cae un poco DESPUÉS y el recordatorio se marcaba "enviado" sin mandarse. Se agregó
  `GRACE_MS = 15 * 60000` y el filtro pasó a `ahora <= fecha + GRACE_MS` (en el envío y en el
  cálculo de `recordatoriosPendientes`) — dentro de esa ventana igual se manda, más allá se
  sigue descartando como recordatorio viejo. Aplica a **todos** los offsets, no solo 0 (mismo
  tipo de gap que ya podía pasarle a cualquiera si el tick caía justo tarde), sin tocar
  `procesarRecordatorios` (la función singular vieja, solo de compatibilidad — ningún flujo
  actual escribe `recordarAntesMin`, todo pasa por el array `recordatorios`).
- **"¿Para quién es?" → "Gerencia"** (antes "Para mí (gerente)"): al elegir Gerencia aparece un
  `<select id="cita-gerencia">` con **Andrea / Anny / Dylan** fijos (a propósito, no derivados
  de `usuarios` con rol admin — más simple y no depende de que esos 3 usuarios ya estén
  cargados/con el rol correcto en Firestore). `guardarCita()` busca el email de la persona
  elegida en `adminsCache` (la misma lista que ya se traía para el select de "quién agenda") y
  lo usa como `asignadoEmail` — **antes** siempre era `auth.currentUser.email` (quien creaba el
  evento), lo cual estaba bien cuando "gerente" no distinguía persona, pero ahora el push tiene
  que llegarle a la persona elegida, no a quien lo agenda. Si esa persona no tiene un `usuarios`
  doc con rol admin coincidente, cae a `auth.currentUser.email` (fallback silencioso, mismo
  estilo que el resto de la sincronización con Firestore de esta app).
- **Secciones Todos/Anny/Andrea/Dylan** (`#persona-tabs`, `filtroPersona`, `citasParaFiltro()`):
  filtra `allCitas` por `asignadoA==='gerente' && asignadoNombre===persona` — se aplica tanto a
  los puntos de la grilla (`renderGrid()`) como a la lista de eventos (`render()`), en las dos
  vistas (mes y día). Un evento asignado al equipo de instalación **no** entra en ninguna de las
  3 secciones personales (solo se ve en "Todos") — no es "de" ninguna de las 3 personas de
  gerencia, es del equipo de instalación. Eventos viejos con `asignadoNombre:'Gerente'`
  (genérico, de antes de este cambio) tampoco caen en ninguna sección personal por el mismo
  motivo — se siguen viendo en "Todos", y al abrir "✏ Modificar" se puede elegir la persona real
  (`modificarCita()` inserta esa opción extra en el `<select>` si no coincide con ninguna de las
  3, mismo patrón defensivo que ya usaba el select de "quién agenda").

## Convenciones aprendidas (para no repetir errores)

- Verificar SIEMPRE con `verify.mjs` antes de dar por bueno un dibujo.
- Flechas negras siempre; cromado = `#8d99a4`, negro = `#111111`.
- En vidrio oscuro, herrajes negros pierden contraste (por eso se cuida el tamaño de las marcas).
- Al añadir un campo nuevo al `state`, incluirlo en la lista blanca de re-render de `updateState`
  (si no, el dibujo no se actualiza al cambiar el menú).
- El grosor auto-selecciona el tipo de vidrio: `3+3/4+4/5+5/6+6` → laminado; `10mm/12mm` → templado.
- El tipo de aluminio del encabezado se aplica por defecto a ítems nuevos (correderas/
  galandajes) vía `headerAluminio` — no es "memoria" en vivo, no se actualiza si el ítem ya
  existe.
- **El color/acabado del encabezado SÍ es "memoria" en vivo** (a diferencia del tipo de
  aluminio): `triggerGlobalUpdate()` (disparado por el `oninput` de `#header-color`) aplica
  `headerAcabado()` a **todos** los ítems existentes (no solo a los nuevos), pisando incluso un
  color elegido a mano en un ítem individual — un cambio manual por ítem se mantiene hasta el
  próximo cambio del encabezado, que vuelve a pisar todo (comportamiento pedido explícitamente:
  "si arriba pongo blanco que todo me salga blanco"). Se salta los ítems `type==='draw'` (CAD),
  que guardan su color por módulo en `window['cadItems'+id]`, no en `cardsState[id]`.
  `headerAcabado()` reconoce, en este orden: negro/blanco/grafito(antracita)/madera por palabra;
  código RAL por hex, por la palabra "RAL", o por un número de 4 dígitos suelto (para que
  "Gris 7039" tome el RAL, no un gris genérico) — `ralHex()`/`RAL_HEX` tiene una tabla chica de
  códigos RAL comunes en aluminio (7039, 7016, 9010, 9016, etc.); un código no listado cae a un
  gris genérico `#8a8f94`, no es la carta RAL completa. En el resumen/PDF, `ralLabel(r)` (helper
  local de `generateSummary`) antepone "RAL " solo si el texto guardado no empieza ya con esa
  palabra — evita "RAL RAL 7039" cuando el usuario escribe el "RAL" a mano en el encabezado.
- **Vidrio Laminado 4+4 por defecto en ítems nuevos** (`addItem`, para no tener que elegirlo a
  mano cada vez) — ducha/cerramiento/baranda pisan este default más abajo en la misma función
  con su propio vidrio típico (templado 10mm), y no se toca retroactivamente ítems ya creados.
- **El toggle "Medida: Fabricación/Cotización" (`.medida-toggle`) solo tiene sentido en el
  cuaderno de Cotización** (para marcar qué ítems ya tienen medida de fabricación) — en el
  cuaderno de Fabricación es redundante, todo lo que hay ahí ya es medida de fabricación por
  definición. Se oculta con CSS puro (`body.doc-fab .medida-toggle { display:none }`), no
  quitando el elemento del DOM ni tocando `insertarMarcaMedida` — `setDocType(type)` agrega/quita
  la clase `doc-fab` en `<body>` según `type` empiece con "FAB", así que cubre los 3 casos por
  igual: click en el botón COTIZACIÓN/FABRICACIÓN de arriba, `restoreData` al abrir un proyecto
  guardado, y tarjetas agregadas después (la regla CSS no depende de cuándo se creó la tarjeta).
