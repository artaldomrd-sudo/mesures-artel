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
- **Cortinas/Enrollables** (`categoria: 'cortina'`): `cort_roller` (cortina enrollable) y
  `cort_shutter` (persiana de seguridad enrollable — rediseñado 2026-07-30 a partir de una foto
  real, ver detalle en la sección "Cortinas/Enrollables" más abajo) — arrancó solo con estos dos
  por pedido explícito del usuario ("sus características son bien similares"); los otros tipos
  que ya vende ARTAL en
  el sitio web (Ondas, Perma, Roman, Venecianas, Verticales, Zebra) quedan pendientes de agregar
  si hace falta. Producto de tela/PVC, sin vidrio ni perfil de aluminio — ver más abajo.
- **Especial**: dibujo libre / **CAD** ("Fachada Compuesta", `type:'draw'`): lienzo donde se
  insertan módulos que se pegan con imán (vidrio con vidrio). Cortinas/enrollables NO participan
  del CAD (mismo criterio que baranda/ducha/cerramiento, que tampoco se insertan ahí).

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
- **Proporción real del panel — Paño Fijo, Ventanas y Puerta Abisagrada, NO correderas/
  galandajes** (pedido explícito del usuario: "así estaba antes" — no había evidencia de eso en
  el historial de git, pero se implementó igual como pedido nuevo, acotado a estos tipos). El
  resto de la app sigue con el rectángulo esquemático de tamaño FIJO de siempre (dimLineH/V son
  las únicas que reflejan la medida real, como texto) — pero para `fachada_din`, `win_proy`,
  `win_souf`, `win_abat`, `win_ob` y `door_abat`, `getPanelRects(state)` (única fuente, también
  usada por `renderSVG`, `glassLayer`, `composePanos`) ahora llama a `fitPropRect(state)`: ajusta
  el rect del panel al `ancho`/`alto` real cargado, sin deformar, dentro de una caja máxima por
  tipo (`PROP_BOX[type] = {maxW, maxH, top}`). **La caja NO es el tamaño del rectángulo fijo de
  antes** (primer intento: copiar esos números — con medidas reales típicas, ej. puerta
  1800×2200, el panel quedaba chico dentro de esa caja, muy por debajo del espacio real
  disponible). Corregido a pedido explícito del usuario ("agrándalo, no se vea tan pequeño"):
  los números de `PROP_BOX` ahora usan casi todo el espacio real del viewBox (revisado a mano
  para no chocar con la línea de medida de ancho arriba ni con la vista de planta abajo en los
  tipos que la tienen) — `win_proy`/`win_souf` 80×45, `win_abat`/`win_ob`/`door_abat` 65×62 (los
  3 comparten caja, ya que la proporción real es la que ahora determina la forma final, no hace
  falta una caja angosta aparte para puerta), `fachada_din` 84×53. Un ítem angosto y alto se ve
  angosto y alto; uno ancho y bajo se ve ancho y bajo. Sin medida cargada (`ancho`/`alto` = 0),
  cae al tamaño de la caja completa. Piso de tamaño al 25% de la caja máxima para que una
  proporción extremadamente angosta o extremadamente ancha no colapse el dibujo a una línea
  ilegible. El panel **siempre queda centrado en x=50** (`bx = 50 - w/2`) sin
  importar el ancho real — necesario porque el espejo de `orientacion === 'D'`
  (`scale(-1,1) translate(-100,0)`) mira alrededor de x=50; si el panel no quedara centrado ahí,
  el volteo dejaría de coincidir con el dibujo. `renderSVG` deriva su propio `bx,by,bw,bh` local
  de `getPanelRects(state)[0]` en vez de un `if/else` de números fijos, y los `case` del switch
  grande (chevrones de apertura, línea divisora de 2 hojas, rect del Paño Fijo, líneas
  divisorias entre paños, posición de la "F") se reescribieron en términos de `bx/by/bw/bh` en
  vez de coordenadas hardcodeadas — mismas fórmulas geométricas de siempre (ej. el chevron de 1
  hoja sigue siendo "esquina superior → punto medio del borde libre → esquina inferior"), solo
  que ahora parametrizadas. `drawPlanView(type, stateInfo, startX, w)` (vista de planta de
  `win_abat`/`win_ob`/`door_abat`) recibe el mismo `bx`/`bw` del panel real en vez de sus propias
  constantes fijas por tipo, para que la vista de planta quede alineada bajo la elevación sea
  cual sea el ancho real — su posición vertical (`y0=85`, dentro del viewBox más alto
  `hasPlan`) no cambia, y como el panel real nunca puede superar la caja máxima de antes, nunca
  invade ese espacio. **Bug real encontrado al agrandar `PROP_BOX`** (ver más abajo): el radio
  del arco de giro (`r = w*0.875` en la rama de 1 hoja, `r = w/2` en la de 2 hojas) SÍ dependía
  linealmente de `w` sin límite — con las cajas nuevas más anchas (`maxW` hasta 65) un ítem ancho
  con 1 hoja podía generar un radio tan grande que el arco se salía por abajo del viewBox
  (dibujo "cortado", reportado por el usuario con una foto real: ventana 900×700 con el semicírculo
  de giro recortado). El viewBox reserva un espacio vertical FIJO para esta vista (de `y0=85` al
  borde inferior) que no crece con `w` — `maxR = 40` limita el radio a ese espacio disponible en
  las dos ramas (`Math.min(w*0.875, maxR)` / `Math.min(w/2, maxR)`): para anchos normales no
  cambia nada (el radio real ya es menor que el límite), solo comprime el giro cuando el ancho es
  grande. El Paño Fijo adosado (`panoArriba`/`panoAbajo`, ver más abajo) sigue funcionando sin
  tocar nada — ya leía `getPanelRects(state)[0]` dinámicamente, así que se ancla solo al nuevo
  borde real del panel (probado: un paño abajo de una ventana angosta queda correctamente igual
  de angosto).
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
  **Dos bugs reales corregidos en la rama "lateral" (`gal1/gal2_lat/gal3_3v/gal4_4v`), reportados
  con fotos reales de un `gal2_lat`:**
  1. La hoja más próxima al pocket y la más lejana usaban el mismo sentido de profundidad de
     riel que su posición en X (`d` crudo) — las dos hojas quedaban "del mismo lado" (ambas
     pegadas al muro exterior) en vez de una en cada extremo del hueco del riel. Corregido
     usando `(maxd - d)` en vez de `d` para la profundidad de cada hoja (la posición en X y el
     sentido de la flecha no cambian, solo a qué riel de profundidad va cada una).
  2. La regla de arriba ("el vidrio engancha del concreto sin mosquitera y del sheetrock con
     mosquitera") ya estaba **documentada e implementada en la rama "central"** (`glassGrabsTop`)
     pero **nunca se implementó en "lateral"**: la mosquitera solo se dibujaba con un offset fijo
     y chico (`mosqOff`) pegada a la MISMA agrupación que el vidrio, ambas siempre cerca del
     concreto — el usuario aclaró con un dibujo a mano que la mosquitera debe quedar pegada al
     concreto (engancha de esa pared) y el vidrio, un grupo aparte con un hueco de por medio,
     pegado al sheetrock. Arreglado: `mosqYL(d)` sigue pegada a `bandTop` (concreto); `glassY(d)`
     ahora arranca en un `glassBandTop` propio, separado por un hueco (`clusterSpan + mt + vg`)
     cuando hay mosquitera — sin mosquitera, `glassBandTop === bandTop` (el vidrio vuelve a
     enganchar del concreto directo, comportamiento de siempre, sin hueco, cero regresión). La
     etiqueta "mosquitera (lado ext)" también estaba mal ubicada (pegada a `planBottom`, el lado
     del sheetrock) — corregida al lado del concreto (cerca de `PT`), con el mismo criterio de
     espejo que ya usan `topLabel`/`botLabel` para "Instalación: por fuera".
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

## Calculador de medida de vidrio (Paño Fijo, primer paso)

Primer paso hacia una herramienta de producción más completa (pedido explícito del usuario: por
ahora solo Paño Fijo, más adelante — sección "Producción" del panel de operaciones, ops/ — un
"cuadro de cálculos de vidrio" editable que se irá ajustando según series/perfilerías nuevas,
hasta llegar a un desglose completo de todos los elementos de cada tipo de ítem — ventanas,
puertas, etc. — no solo el vidrio. Esa parte del panel **todavía no existe**, es trabajo futuro;
por ahora la fórmula vive embebida en el cuaderno).

- **`calcVidrioPanoFijo(state)`** (junto a `generateSummary`): calcula el tamaño real de vidrio a
  cortar según `state.fijacion`, deduciendo del `ancho`/`alto` del marco. Solo aplica a
  `type === 'fachada_din'` y solo si `ancho`/`alto` > 0. Fórmulas confirmadas explícitamente con
  el usuario (con un ejemplo que originalmente no cuadraba — "P40: 35mm de cada lado" pero el
  ejemplo daba un resultado que solo cuadraba con 135mm/lado — se le preguntó y confirmó 35mm):
  - `p40` (Perfiles Aluminio): 35mm por lado → vidrio = marco − 70mm (ancho y alto por igual).
  - `p40_puerta` (P40 de puerta): 55mm por lado → vidrio = marco − 110mm (ancho y alto).
  - `moldura` (Con Moldura Perimetral / "Moldura U"): 7mm **total** (no por lado, a diferencia de
    los P40 — confirmado explícitamente) → vidrio = marco − 7mm (ancho y alto).
  - `conectores` / `sin_marco` / sin fijación elegida: sin fórmula todavía → `null`, no se
    muestra nada. Pendiente para cuando el usuario confirme esos casos.
  - No distingue `panos > 1` (Fachada Multipañó): usa siempre el `ancho`/`alto` totales del
    ítem, no un desglose por paño individual — coincide con los ejemplos que dio el usuario
    (un solo marco). Si hace falta el cálculo por paño individual, pedirlo explícitamente.
- **Dónde se muestra**: solo en el resumen/PDF (rama genérica de `generateSummary`, junto a la
  línea "Fijación: ..."), como `Vidrio a cortar: {w} x {h} mm` — **no** se muestra mientras se
  edita la tarjeta (antes de fijarla), a pedido explícito del usuario ("por ahora" solo en
  resumen/PDF).

## Paño Fijo adosado (arriba/abajo) en ventanas/puertas/Paño Fijo

Alternativa ligera al CAD para el caso más común: pegarle un paño fijo de vidrio arriba y/o
abajo de una ventana/puerta (ej. oscilobatiente + paño de ventilación fijo encima), con la
**misma fidelidad visual que una tarjeta normal** (degradado de vidrio, marco extruido) — no el
estilo simplificado del CAD.

- Disponible para `categoria === 'ventana'` (`win_abat, win_ob, win_proy, win_souf, door_abat`)
  **y también `categoria === 'fachada'`** (`fachada_din`, Paño Fijo/Fachada Multipañó) — pedido
  explícito del usuario: casos reales de "paño fijo abajo + ventilación arriba" donde lo natural
  es empezar la tarjeta desde el Paño Fijo (el elemento grande/dominante), no desde la ventana.
  La pieza adosada sigue siendo siempre **fija** (el mismo "F", sin bisagra/apertura) en los dos
  casos — si se necesita que la parte de arriba/abajo abra de verdad, no es este mecanismo, es
  el CAD. Único cambio de código: el filtro de categoría en `renderPanoSection` (antes solo
  `'ventana'`); todo lo demás (`composePanos`, `togglePano`, `buildPanoConfigHtml`,
  `generateSummary`) ya era genérico por `state`, sin depender del tipo — funciona igual en
  Paño Fijo simple y en Fachada Multipañó (`panos > 1`, cada paño con su propia "F" y divisor,
  el paño adosado se agrega arriba/abajo del conjunto completo). Campos nuevos y planos en
  `cardsState[id]` (nada de posición libre que guardar, a diferencia del CAD): `panoArriba` /
  `panoAbajo`: `null` o `{ alto, vidrio, espesor, color_vidrio, fijacion, color_perfil,
  color_ral }`. Sin campo de ancho propio: el paño **siempre hereda el ancho del ítem base** vía
  `getPanelRects(state)[0]`.
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
  - Agrega una banda por cada paño activo, generada por `buildPanoFragment(uid, side, pano,
    panelRect, isFlipped, bandH)` — su propio `glassDefs`/gradiente con un uid distinto
    (`${uid}arriba`/`${uid}abajo`) y su propio `applyFinish(frag, pano.color_perfil,
    pano.color_ral)` **antes** de pegarse (nunca aplicar `applyFinish` una sola vez sobre el
    conjunto ya unido — mezclaría el acabado del paño con el del ítem base).
    **Alto de la banda PROPORCIONAL, no fijo** (`panoBandH(pano, panelRect, state)`, bug real
    reportado con fotos reales): desde que el panel base pasa a dibujarse a proporción real
    (`PROP_BOX`/`fitPropRect`, ver más arriba), un paño con alto SIEMPRE fijo (`PANO_BAND_H=34`
    de antes) quedaba desproporcionado frente al panel base — ej. un paño de 400mm se veía casi
    tan alto como un panel base de 1600mm (proporción real 4:1, mostrada como ~1.8:1). La banda
    ahora usa la MISMA escala (unidades de viewBox por mm) que ya usó `fitPropRect` para el
    panel base — derivada de `panelRect[2]` (el ancho ya ajustado) contra el `ancho` real, ya
    que el paño siempre comparte ese mismo ancho — multiplicada por el `alto` real del paño.
    `bandHArriba`/`bandHAbajo` se calculan una vez en `composePanos` (arriba y abajo pueden tener
    alturas de banda distintas, según su propio `alto`) y reemplazan la constante fija en TODOS
    los cálculos de posición (`topBoundary`, `botH`, el `translate` de cada paño, la medida
    total a la izquierda) — la etiqueta "F" también reduce su `font-size` proporcionalmente
    (`Math.min(9, bandH*0.35)`) para no desbordar una banda muy baja.
    **Segundo bug real, también reportado con fotos reales**: el primer intento le puso un piso
    de 12 unidades a la banda (para que un paño muy bajo no colapsara a una línea ilegible) —
    pero ese piso se activaba también en casos NORMALES: un ítem muy ancho (ej. 5100mm) da una
    escala chica, y un paño de 400mm caía por debajo del piso; el piso lo agrandaba de vuelta,
    rompiendo la proporción real otra vez, esta vez al revés (el paño se veía más grande de lo
    que le corresponde). El piso bajó a 4 — ya no interviene en proporciones reales normales,
    solo evita un alto literalmente degenerado.
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
  - **Medida de ancho reubicada AL FINAL del compuesto (no arriba, entre la ventana y el paño de
    arriba).** Iteración real con el usuario: un primer intento dejó la medida de ancho en su
    lugar de siempre (arriba) pero con más aire respecto al paño de arriba (`topGap=9`, ya que
    `dimLineH` dibuja el TEXTO por encima de su línea principal — `textY = y - textGap`, más
    cerca del paño que la línea en sí — y el `gap=4` normal dejaba el texto casi tocando el
    borde del paño). El usuario pidió ir más lejos: la medida de ancho **no** va arriba en
    absoluto cuando hay paños — va **al final**, entre el contenido de abajo (paño abajo, o la
    ventana si no hay) y la vista de planta reubicada (o el borde inferior si el tipo no tiene
    vista de planta). Implementación: `renderSVG` deja de dibujar la medida de ancho cuando
    `state.panoArriba || state.panoAbajo` (condición agregada al `if (state.ancho > 0)` de la
    cola de `renderSVG`) — `composePanos` la dibuja de cero, una sola vez, con `dimLineH` en la
    posición nueva (`anchoEdgeY = elevBottom + botH`, línea en `anchoEdgeY + ANCHO_GAP` con
    `ANCHO_GAP=9` igual criterio que antes). `ANCHO_RESERVED_H=22` reserva el espacio de
    línea+texto y empuja la vista de planta hacia abajo esa misma cantidad (sumado al `botH` que
    ya la corría por el paño de abajo) — antes solo se corría por `botH`.
    **Bug real encontrado al mover la medida abajo**: `dimLineH` dibuja el texto en su línea de
    base sin `dominant-baseline`, así que los glifos crecen HACIA ARRIBA desde `textY` — con el
    texto arriba de su línea (`dir=-1`, el único caso usado en el resto de la app) eso ayuda a
    separarlo; pero con el texto ABAJO (`dir=+1`, este caso nuevo) el mismo `textGap=2.6` de
    siempre no alcanza y el texto queda **cruzando la línea** (reportado por el usuario con una
    foto real). Se agregó un 7º parámetro opcional `textGap` a `dimLineH` (default `2.6`, no
    cambia ningún llamado existente) — esta llamada específica pasa `ANCHO_TEXT_GAP=8`. Como
    paño de **arriba** ya no necesita el `topGap` especial (no hay medida de ancho ahí con la que
    chocar): vuelve a anclarse con el `gap=4` normal, pero contra `panelRect[1]` (el `by` real
    del panel base) en vez del viejo punto de referencia `y=4` — más directo y ya no depende de
    dónde estaba la medida de ancho antes de moverse.
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
- **Mismas opciones de vidrio/fijación que un Paño Fijo normal** (pedido explícito del usuario,
  el select de vidrio del paño adosado tenía solo Templado/Laminado): `buildPanoConfigHtml`
  ahora ofrece las mismas 4 (Templado/Laminado/Láminas de Louver/Sin Vidrio — mismos valores que
  `vidriosBasicos` en `getMenuOpciones`) y el de fijación agrega `p40_puerta` (antes solo tenía
  conectores/moldura/p40/sin_marco). Con `vidrio==='louvers'` se ocultan grosor/color y se
  muestra "Color Louvers: {color del encabezado}", igual que en el ítem base — `updatePanoState`
  ahora dispara `refreshPanoUI(id)` también en `key === 'vidrio'` (antes solo en
  `color_perfil`/`espesor`) para que ese cambio de layout se refleje al vuelo. `generateSummary`
  (línea "Paño Fijo arriba/abajo: ...") formatea `vidrio==='louvers'`/`'sin'` igual que el resto
  de la app ("Láminas de Louver (color)" / "Sin Vidrio") en vez de imprimir el value crudo.
- **Resumen/PDF**: `generateSummary` agrega una línea por paño adosado (medidas + vidrio +
  fijación) y una línea de "Alto total (con paños)" — sin tocar `state.alto`, que sigue
  significando solo la altura de la hoja operable (no rompe ningún cálculo de área de
  vidrio/herrajes que dependa de él). Como la sección de paños vive dentro de `.hide-on-lock`,
  se oculta sola al fijar el ítem/exportar PDF, igual que el resto de los controles de edición.
- **Tercer bug real (con paños): el dibujo se veía chico, rodeado de espacio vacío**, reportado
  con fotos reales — "adapta el dibujo al tamaño del cuadro". Dos causas combinadas:
  1. `.drawing-area` tiene alto FIJO en CSS (`height: 260px`, igual para toda la app, pensado
     para el grid 2x2 del PDF) — con paños el viewBox crece mucho en altura (bandas + medida de
     ancho reubicada) pero el ancho se mantiene, así que "meet" dejaba franjas vacías arriba/
     abajo dentro de esa caja fija.
  2. El viewBox base de estos tipos reserva de fábrica bastante margen fijo a los **costados**
     (para las líneas de cota — "total alto" a la izquierda, "alto" a la derecha) sin importar
     cuánto ancho real ocupe el panel — probado ajustando SOLO el alto del contenedor (causa 1):
     no alcanzaba, el margen lateral seguía ahí y el dibujo se seguía viendo chico.
  `adaptDrawingToContent(id)` ataca las dos causas a la vez, pero **solo en tarjetas CON
  paño adosado** (nunca toca el viewBox/alto de las demás, cero riesgo para el resto de la
  app): recorta el `viewBox` del SVG ya renderizado al contenido real (`svg.getBBox()` + un
  margen chico de 6 unidades, porque `getBBox()` solo mide relleno — no cuenta el trazo ni la
  sombra del vidrio) y ajusta el alto del contenedor (`clientWidth * vbH/vbW`, con piso de
  260px como antes y techo de 900px) a esa proporción real ya recortada. Sin paños, restaura
  todo a como estaba (`viewBox` de siempre sin tocar, alto del contenedor a `''` = el CSS
  fijo). Se llama después de cada `schematic-${id}.innerHTML = renderSVG(id)` relevante:
  creación/restauración de la tarjeta (`addItem`), `togglePano`, `updatePanoState`, y los
  cambios de ancho/alto/paños/fijación/acabado del ítem base en `updateState` — como la
  función arranca comprobando `state.panoArriba || state.panoAbajo`, es seguro llamarla desde
  puntos genéricos de la app (ducha/baranda/corredera/etc.) que nunca tienen paños: no hace
  nada en esos casos.
- **Cuarto bug real: el dibujo quedaba sin centrar** (hueco vacío, no repartido parejo arriba y
  abajo), reportado con fotos reales comparando varias tarjetas con paño una al lado de la
  otra. Causa: el alto se calculaba **una sola vez** con el ancho de la tarjeta en ESE momento
  (`area.clientWidth`) — pero el ancho de una tarjeta cambia después por motivos ajenos a ella
  (se agrega/quita OTRA tarjeta y la grilla se reacomoda a 1 o 2 columnas, se cambia el tamaño
  de la ventana, etc.), y nada volvía a llamar `adaptDrawingToContent` para las tarjetas con
  paño que no se estaban editando en ese momento — quedaban con un alto ya desactualizado
  respecto a su ancho real, y "meet" dejaba franjas vacías (repartidas por el centrado propio
  de "meet", pero visualmente se notaban como asimétricas cuando el hueco era grande). Fix: un
  `ResizeObserver` compartido (`panoResizeObserver`) observa el `.drawing-area` de cada tarjeta
  con paño y vuelve a llamar `adaptDrawingToContent(id)` cada vez que su ancho real cambia —
  como el cálculo de alto es una función pura del ancho (mismo ancho → mismo alto), es seguro:
  si el ancho no cambió, el resultado es idéntico y el observer no vuelve a dispararse (sin
  loop infinito). Se registra (`.observe`) al final de `adaptDrawingToContent` cuando hay
  paños, y se desregistra (`.unobserve`) cuando se quitan. De paso, el techo de alto bajó de
  900 a 650 (pedido explícito del usuario: un ítem angosto y muy alto, ej. 1150×2600 + paño, se
  veía "muy grande" con el techo anterior).
- **`adaptDrawingToContent` generalizado a Vidrio de Ducha** (mismo nombre de función desde este
  cambio — antes se llamaba `updatePanoDrawingHeight`, renombrada porque ya no es solo para
  paños). Reportado con fotos reales: "vidrios de ducha, en el dibujo medidas aparecen muy
  pequeñas... el M2 ni siquiera se ve" (M1 650×1200mm 1 panel; M2 350×2200mm 1 panel, angosto y
  muy alto). Causa: exactamente la misma familia de bug que los paños (`.drawing-area` con alto
  FIJO de 260px), pero en `renderFacade` (Vidrio de Ducha) en vez de `composePanos` — ese
  render tiene su propia fórmula independiente (`DW=100` ancho fijo en unidades de viewBox,
  `scale = DW/ancho_total_mm`, `Hd = alto_mm * scale`), así que un panel angosto y alto como el
  M2 genera un viewBox extremadamente vertical (para M2: viewBox ancho≈124, alto≈725, relación
  ancho/alto≈0.17) que dentro de la caja fija de 260px de alto quedaba escalado a un tamaño
  mínimo — el texto de las cotas, con `font-size` fijo en unidades de viewBox, se volvía casi
  invisible en pantalla (mismo motivo por el que el problema de los paños afectaba el dibujo
  entero, no solo el texto). Arreglo: la condición de guarda de `adaptDrawingToContent` pasó de
  "solo si `panoArriba`/`panoAbajo`" a "si hay paño **o** `state.categoria === 'cerramiento'`"
  (Vidrio de Ducha), y `refreshFacade(id, rebuildUI)` — el único punto donde
  `renderFacade` reescribe el SVG de la tarjeta (usado por `facadeAddPanel`,
  `facadeRemovePanel`, `facadeUpdatePanel`, `facadeSetTipo`, `facadeInvert`,
  `facadeInvertPanel`, y el input "H Total (mm)") — ahora llama a `adaptDrawingToContent(id)`
  justo después de `schematic-${id}.innerHTML = renderSVG(id)`, mismo patrón que ya usan los
  paños. El `adaptDrawingToContent(id)` en la creación de la tarjeta (`addItem`, rama
  `cerramiento`) ya estaba presente de antes (agregado sin querer por un `replace_all` amplio
  cuando esta función todavía era solo para paños — quedaba sin efecto porque la condición de
  guarda no dejaba pasar tarjetas de ducha; con la condición ampliada, empieza a funcionar solo).
  Verificado en vivo: M1 (650×1200) queda con la caja ajustada casi exacto a la proporción real
  del contenido (relación ancho/alto del `viewBox` recortado ≈ la del contenedor, sin holgura);
  M2 (350×2200) usa el techo de 650px (no puede crecer más sin desbordar la tarjeta) pero el
  texto de las cotas pasa de una escala ≈0.36px-por-unidad (invisible) a ≈1px-por-unidad
  (≈2.5× más grande, legible) — las dos etiquetas ("350 mm", "2200 mm") quedan dentro de los
  límites visibles del SVG. Tarjetas normales (sin paño, sin ser Vidrio de Ducha) no se tocan:
  siguen con `area.style.height === ''` (el CSS fijo de 260px de siempre).

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
- **Puerta Deslizante: dos variantes de hardware, "Prensas" y "Conectores"** (pedido explícito
  del usuario, con una foto real de referencia). La deslizante original (`tipo: 'deslizante'`,
  `type: 'door_slide'`) se renombró a **"Puerta Deslizante Prensas"** (nombres internos sin
  tocar, solo el texto visible — proyectos guardados de antes siguen abriendo igual) para
  distinguirla de la nueva **"Puerta Deslizante Conectores"** (`tipo: 'deslizante_conn'`,
  `type: 'door_slide_conn'`, tipo nuevo — mismo patrón de tipos "sueltos que viven dentro de
  Vidrio de Ducha" que `mamp_fija`/`door_glass`/`door_slide`, insertable también en el CAD libre).
  Diferencia real: Prensas usa un **riel superior continuo con colgadores** (`case 'door_slide'`
  en `cadTechnical`); Conectores **no lleva riel** — se fija con **2 filas de hoyos de conector**
  cerca del borde superior, a **90mm y 150mm** desde ese borde (medidas reales del sistema,
  confirmadas por el usuario con un plano a mano), con 2 hoyos por fila (izquierda/derecha) y las
  etiquetas "90"/"150" dibujadas junto a los hoyos — `case 'door_slide_conn'`, agregado justo
  después del de Prensas, reusando el mismo tirador/cerradura/flecha de corrido/moldura (solo
  cambia el hardware de fijación de arriba). Como no tiene riel, **no participa** de la extensión
  de riel entre paneles vecinos que sí aplica a "Prensas" (`renderFacade`, el `forEach` que
  extiende el riel filtra por `L.p.tipo !== 'deslizante'` — un tipo distinto como
  `'deslizante_conn'` ya queda afuera solo, sin tocar ese código). `getPanelRects` para
  `door_slide_conn` reusa el mismo rect que `door_slide` (`[30, 9, 40, 47]` — la proporción del
  panel de vidrio no cambia, solo el hardware dibujado encima). El switch grande de `renderSVG`
  (usado solo para tarjetas sueltas heredadas, no para paneles de Vidrio de Ducha ni para el CAD)
  **no** necesitaba un caso nuevo — `door_slide_conn` es un tipo recién creado, no hay proyectos
  viejos con ese `type` que dependan de ese camino de renderizado.
- **Accesorios por panel: kit FIJO por tipo + color, no un selector manual.** Primer intento
  (revertido): un `<select>` conectado en vivo al inventario para elegir la referencia a mano —
  el usuario lo probó y pidió explícitamente lo contrario: "no vamos a hacerlo así porque va a
  complicar mucho... al seleccionar una puerta debe aparecer los accesorios que lleva sin permitir
  selección manual". Ejemplo real que dio: Puerta Deslizante Conectores en cromado lleva
  `ALC00344` + `TUB00380`; en negro, pendiente de confirmar. Diseño actual: `ACCESORIOS_KIT`
  (objeto `{ tipo: { color_herraje: [{ref, qty}, ...] } }`) es una tabla FIJA, sin UI para
  editarla — se va llenando a mano en el código a medida que el usuario confirma cada
  combinación real (mismo patrón incremental que `TELA_COLECCIONES` en Cortinas: arranca con lo
  confirmado, crece con el tiempo — una combinación todavía no confirmada simplemente no tiene
  entrada). `accesorioKitFor(p)` resuelve `ACCESORIOS_KIT[p.tipo][p.herraje_color || 'cromado']`;
  si no hay entrada, `renderPanelOptions` muestra "sin definir para este color todavía" (caja
  informativa, `grid-column: span 2`, ya no un `<select>`) y `generateSummary` simplemente no
  agrega la línea "Accesorios: ..." (en vez de mostrar algo inventado). Las referencias (`ref`)
  son códigos fijos en el código (`ALC00344`, `TUB00380`, ...) — `resolveAccesorioLabel(ref)` les
  busca el nombre legible contra `window.artalInventarioPorReferencia` (todo el inventario,
  indexado por el campo `referencia`, sin filtrar por subgrupo — un kit puede mezclar
  referencias de secciones distintas, ej. "ALC..." de Mamparas de vidrio junto con "TUB..." de
  Tubos/Perfiles) — si el código no está en el inventario todavía (o no hay sesión/señal), se
  muestra el código solo, sin nombre, en vez de romper. `startFsClientListeners()` mantiene el
  mismo patrón de siempre (`onSnapshot(collection(db,'inventario'))` → `window.
  artalInventarioPorReferencia` → `window.refreshAccesoriosInfo()` re-pinta los constructores de
  Vidrio de Ducha ya abiertos cuando llegan los datos). Nada de esto depende de cantidad en
  stock (los `qty` son fijos por kit, no relacionados a inventario disponible).
  - **"fijo" (mampara) tiene una dimensión extra: la forma de la prensa.** El usuario dio 4
    referencias reales (2 formas x 2 colores): cromado → recta `ALC00150` / L `ALC00151`;
    negro → recta `ALC00004` / L `ALC00445` (confirmó explícitamente que negro sigue el mismo
    orden #1=recta/#2=L que cromado). Por eso `ACCESORIOS_KIT.fijo` anida un nivel más que
    `deslizante_conn`: `{ color: { recta: [...], L: [...] } }`. Nuevo campo `p.prensaForma`
    ('recta' por defecto o 'L'), select propio **solo quando `fijacion === 'conectores'`**
    (moldura no usa prensas — `accesorioKitFor` corta ahí con `return null` antes de mirar
    `prensaForma`). Iba a dejar el conteo de selects de una columna en 5 (impar) en esa rama —
    mismo bug de hueco vacío que ya se había corregido en deslizante — así que el select de
    Forma de Prensa nace directo con `grid-column: span 2` (ninguna fila queda a medias).
  - **Accesorios adicionales, texto libre, SOLO para deslizante/deslizante_conn.** Pedido
    explícito del usuario: "agrega un campo para agregar accesorios en caso de que sea necesario
    (cerraduras o demás)" — a diferencia del kit fijo (sin edición posible), este es un `<input
    type="text">` opcional (`p.accesoriosExtra`, `grid-column: span 2`) para casos puntuales que
    el kit no cubre — el resumen/PDF le agrega su propia línea "Accesorios adicionales: ..." solo
    si el campo no está vacío, aparte de (no en reemplazo de) la línea "Accesorios: ..." del kit.
  - **Bug real de presentación corregido, reportado con foto**: en el panel deslizante/
    deslizante_conn, los 5 `<select>` de una sola columna antes de Cerradura/Accesorios (que ya
    ocupan la fila entera cada uno) dejaban un hueco vacío al lado de "Grosor" — 5 es impar, así
    que el grid de 2 columnas no lo podía emparejar y `Cerradura` (que necesita las 2 columnas)
    se corría a la fila siguiente sin llenar la que dejó "Grosor" a medias. Arreglo: "Grosor"
    pasa a `grid-column: span 2` en esa rama (única con esta combinación impar; Paño Fijo y
    Puerta Abisagrada ya daban un número par de selects sueltos, sin este problema).

## Cortinas/Enrollables (`categoria: 'cortina'`)

Categoría nueva, sin vidrio ni perfil de aluminio (producto de tela/PVC) — arranca con
`cort_roller` (cortina enrollable) y `cort_shutter` (persiana tipo shutter/lama), agregados
juntos a pedido del usuario por tener características similares.

- **`getCategoriaByType`**: el check `type.startsWith('cort_')` va **antes** del check de
  `'cor'` (corredera) — cualquier `type` que empiece con "cort" también empieza con "cor", así
  que el orden importa (si no, "cort_roller"/"cort_shutter" caerían como `categoria:'corredera'`
  por error).
- **`addItem`**: defaults propios (`instalacion_cortina:'dentro'` para ambos tipos; roller
  además `color_cortina:'chalk'`, `tela:'screen3'`, `mecanismo:'cadena'`, `cajon:'sin_cajon'`;
  shutter además `color_cortina:'blanco'`, `tipo_motor:'manual'`, `instalacion_tipo:'hueco'`,
  `guiaIzq/guiaDer/cajonExtra:false` — ver "Shutter" más abajo) — nunca toca
  `vidrio`/`espesor`/`color_perfil` (quedan seteados por el default general pero no se leen en
  ningún lado de esta categoría, dato muerto inofensivo).
- **`getMenuOpciones`**: rama propia `categoria === 'cortina'` — color (con opción
  "Personalizado" que revela un campo de texto libre, mismo patrón que RAL en `color_perfil`),
  instalación (dentro/sobre el marco en roller; "Por Dentro/Por Fuera" en shutter, mismos
  valores `dentro`/`fuera` con etiqueta distinta según `type`), y según `type`: tela+mecanismo+
  cajón (roller) o tipo de motor+montaje (shutter, ver más abajo). Ignora a propósito
  `vidriosBasicos`/`colorPerfilSel`/`tipoAluminioHtml` (se calculan igual arriba por cómo está
  armada la función, pero no se usan — mismo patrón que ya usan fachada/mampara/ducha/baranda
  para las opciones que no les aplican).
- **Catálogos reales de tela del roller — por colección (`TELA_COLECCIONES`)**, cargados a
  pedido del usuario a partir de fotos de muestrarios físicos, uno a la vez a lo largo de varias
  rondas — **diseñado a propósito para que agregar el próximo catálogo sea solo sumar una
  entrada al objeto, sin tocar ninguna otra función.** Dos menús dependientes en vez de uno:
  **"Tipo de tela"** elige la colección/catálogo y **"Referencia y color"** elige el color
  DENTRO de esa colección (options generadas desde `TELA_COLECCIONES[tela_tipo].colores`, solo
  para `type==='cort_roller'` — el shutter usa su propia paleta acotada, ver "Shutter" más
  abajo). `TELA_COLECCIONES` es la fuente única
  de verdad (`getMenuOpciones`, `generateSummary`, `renderCortina` y `cortinaAnchoMaxMm` la
  consultan, nunca hay una lista de colores/anchos duplicada a mano) — cada entrada tiene:
  - `label`: nombre mostrado en "Tipo de tela".
  - `aperturas`: qué opciones del selector de Apertura aplican (colecciones distintas pueden
    tener aperturas totalmente distintas — Screen variable, Blackout fijo, Día/Noche fijo).
  - `colores`: array de `{value, label, hex}` — el label ya incluye el código de referencia del
    proveedor cuando existe, para pedir sin ambigüedad. Los hex están aproximados a ojo desde
    las fotos del muestrario físico, no son un color picker exacto — si hace falta más fidelidad
    (ej. para el sitio web) pedir códigos Pantone/RAL reales al proveedor.
  - `anchoMaxMm` (opcional): número fijo, o `function(apertura)` cuando el máximo depende de la
    apertura elegida (caso Essential) — ver "Ancho máximo" más abajo.
  - `zebra` (opcional, `true`): dispara el dibujo con franjas alternadas en vez de un rectángulo
    sólido — ver "Dibujo con franjas" más abajo.

  Colecciones cargadas hasta ahora:
  - **`essential`** — Essential (Coulisse), tela Screen, `aperturas: ['screen1','screen3',
    'screen5','screen10']`. 8 colores serie SCR-3005: `chalk` (SCR-3005-01), `chalk_beige_cream`
    (SCR-3005-02), `chalk_soft_grey` (SCR-3005-03), `charcoal_iron_grey` (SCR-3005-05), `ebony`
    (SCR-3005-06), `soft_grey` (SCR-3005-08), `charcoal_dark_bronze` (SCR-3005-10),
    `beige_pearl_grey` (SCR-3005-11).
  - **`plain_xl_blackout`** — Plain XL (Coulisse), 100% Blackout, `aperturas: ['blackout']`
    (una sola, es opaca). 7 colores serie RF-PLAIN-XL: `snow_white` (-5120), `metal` (-5600),
    `dust` (-6310), `fossil` (-5420), `blue_night` (-6000), `taupe` (-5430), `black` (-6320).
  - **`zebra_cyprus`** (`zebra: true`) — "Zebra Cyprus" (así le dice ARTAL a este tipo: franjas
    alternadas sólido/transparente, día y noche — "Cyprus" es el nombre del patrón dentro de
    Coulisse, "Zebra" es el nombre de familia que usa ARTAL). `aperturas: ['dia_noche']` (una
    sola — "Light Filtering / Dim Out", no tiene sentido de % de apertura como Screen). **7
    colores** reales del muestrario físico (sin código de referencia — este catálogo no trae
    códigos, solo el nombre en la etiqueta): `grey`, `cream`, `light_brown`, `ivory`,
    `dark_brown`, `chocolate`, `white` — 280cm/110in de ancho de rollo, pero **"Max Blind
    Width" recomendado 265cm** (más angosto que el ancho crudo, por la costura/unión de las
    franjas — ver `anchoMaxMm` más abajo).
  - **`zakynthos`** (`zebra: true`) — mismo tipo de producto que Zebra Cyprus (el usuario aclaró
    explícitamente: "la diferencia entre zakynthos y cyprus es la textura y acabados de la
    tela", no el mecanismo — por eso comparte el mismo dibujo con franjas y el mismo
    `anchoMaxMm: 2650`, ficha técnica idéntica a Cyprus). `aperturas: ['dia_noche']`. **14
    colores** numerados del muestrario físico (`#1 Bright White` … `#29 Dust`, sin código de
    proveedor tipo SCR-xxx — solo el número de referencia + nombre de cada etiqueta):
    `bright_white`, `peach`, `croissant`, `mocha`, `metal`, `steel_grey`, `pirate_black`,
    `cinder`, `blue_night`, `sand`, `fossil`, `copper_brown`, `autumn`, `dust`.
  - **`hampton`** — Screen con textura "efecto lino" (linen look), **NO es zebra** (roller liso
    normal, mismo dibujo que Essential/Plain XL). `aperturas: ['screen15']` (un solo factor de
    apertura fijo, 15% — a diferencia de Essential que tiene 4 variantes). `anchoMaxMm: 3000`.
    **4 colores** de la variante Screen (serie HAMPTON-0xxx): `white` (-0150), `off_white`
    (-0500), `light_grey` (-0100), `sand` (-0200). ⚠️ **El catálogo dice explícitamente "the
    collection includes screen as well as black-out fabrics"** — el usuario solo mandó fotos de
    la variante Screen hasta ahora. Si más adelante manda la variante Black-out, agregarla como
    colección aparte (ej. `hampton_blackout`), **no mezclar colores de las dos bajo la misma
    entrada** — son tonos distintos aunque compartan el nombre "Hampton".
  - **`dakar_blackout`** — "Dakar Blackout" (línea Intimate), 100% Blackout con textura tejida
    tipo lino (parecida a la de Hampton, pero opaca) — **NO es zebra** (roller liso normal,
    mismo dibujo que Essential/Plain XL/Hampton). `aperturas: ['blackout']` (una sola, es
    opaca — mismo criterio que Plain XL). `anchoMaxMm: 3000` (ancho de rollo 300cm/116in, la
    ficha no trae un Max Blind Width separado, a diferencia de Cyprus/Zakynthos). **5 colores**
    del muestrario físico: `off_white` (G3001TS), `beige` (G3003TS), `grey` (G3007TS MH),
    `slate` (G3007TS Dark Grey — mismo código de referencia base que "Grey" pero matiz más
    oscuro, dos colores reales distintos igual), `travertine` (G3005TS). Última tela cargada
    "por el momento" según el usuario — catálogo completo, sin variantes pendientes.
  - **Cambiar `tela_tipo`** invalida `color_cortina`/`tela` si no existen en la colección
    nueva — se resetean al primero de la lista nueva (mismo patrón que "espesor" resetea
    "vidrio" para vidrio/aluminio), manejado en `updateState` (bloque dedicado
    `key === 'tela_tipo'`).
  - `cortinaColorHex(telaTipo, colorKey)` es el único lugar que resuelve el hex de un color de
    roller (shutter sigue usando `CORTINA_COLORS` directo, paleta plana). "Personalizado" cae
    a un gris genérico en ambos casos (no hay hex real que mostrar).
- **Dibujo con franjas (colecciones con `zebra: true`)**: a diferencia de las demás colecciones
  (un rectángulo sólido), `renderCortina` dibuja el roller con **franjas horizontales
  alternadas** cuando `(TELA_COLECCIONES[state.tela_tipo] || {}).zebra` es verdadero — pedido
  explícito del usuario tras mandar fotos de un roller Zebra real, para que se note a simple
  vista que es día/noche y no un roller liso. Gatillado por el flag de la colección, **no** por
  comparar `tela_tipo` contra un nombre fijo (así Zakynthos quedó cubierto gratis al agregarla,
  sin tocar `renderCortina`). Proporción de referencia (Cyprus: Height Solid Part 100mm / Height
  Sheer Part 55-60mm, ≈64%/36% — se reusa igual para todas las colecciones zebra; la diferencia
  entre ellas es la tela, no cuánto mide cada franja). Cada franja "sólida" usa el color elegido
  (`fill`), cada franja "sheer" usa `towardWhite(fill, 0.5)` — **no** `shade(fill, p)` con `p`
  positivo: un color de tela ya claro (ej. "Bright White" de Zakynthos) saturaría a blanco puro
  con `shade()` y la franja sheer quedaría indistinguible del fondo blanco del PDF (mismo bug ya
  encontrado y arreglado en la cara superior del cajón, ver más abajo).
- **Ancho máximo de rollo por catálogo (aviso, no bloquea)**: `cortinaAnchoMaxMm(telaTipo,
  aperturaValue)` lee `TELA_COLECCIONES[telaTipo].anchoMaxMm` (número, o lo ejecuta como función
  si es una función) — **ninguno de los catálogos que mandó el usuario trae un ALTO máximo** (el
  largo del rollo no aparece limitado en esas fichas), así que solo se avisa por ancho. Essential
  usa una función porque depende de la apertura elegida (`screen10` → 2500mm, el resto → 3000mm
  — confirmado explícitamente en la ficha: "Width 98in-118in/250-300cm" para 1/3/5%, pero
  "98in/250cm" nada más para 10%); las demás colecciones usan un número fijo. `refreshCortinaWarn(id)`
  compara `state.ancho` contra ese máximo y muestra/oculta un `<div id="cortina-warn-${id}">`
  (clase `.cortina-warn`, oculto por defecto) con un mensaje — se llama desde `updateState` cuando
  cambia `ancho`/`tela_tipo`/`tela`, y una vez al crear/restaurar la tarjeta en `addItem`. Es
  solo un aviso (no impide fijar el ítem): puede haber unión/costura del proveedor que lo
  resuelva, no es información que la app pueda decidir por sí sola.
- **Rollo con/sin cajón (roller)**: `state.cajon` (`'sin_cajon'` default o `'con_cajon'`) —
  pedido explícito del usuario. Con cajón: caja del **mismo color que la tela elegida** (usa el
  mismo `fill` que el panel, no un color fijo) — así se ve como una cajonera que tapa el
  mecanismo, no como un tubo expuesto pintado. Ver `renderCortina`.
  - **Un poco de 3D (pedido explícito del usuario: "a ver si se aprecia más el cajón o rollo
    según el caso")** — antes ambas variantes eran un rectángulo plano, ahora:
    - **Sin cajón**: el tubo tiene un degradado vertical (claro arriba → oscuro abajo, gris) en
      vez de un gris plano, más una elipse pequeña en cada extremo (tapa del cilindro) — se lee
      como un tubo redondo visto de frente, no una barra.
    - **Con cajón**: caja isométrica de verdad — cara frontal (el `fill` de la tela sin tocar),
      cara superior (`towardWhite(fill, 0.35)`) y cara lateral derecha (`shade(fill, -18)`),
      como un cubo con una esquina visible (mismo truco que un dado de línea dibujado a mano).
    - **`towardWhite(hex, frac)`** (nueva, junto a `shade`): mezcla una FRACCIÓN de lo que le
      falta a un color para llegar a blanco, en vez de sumarle un número fijo de "puntos de
      brillo" como hace `shade(hex, p)` con `p` positivo. Bug real encontrado al implementar
      esto: con un color casi blanco como **Chalk** (`#efece3`), `shade(fill, 12)` ya daba
      `#ffffff` puro (el canal rojo, 239, satura con solo sumarle ~6 puntos) — la cara "superior
      más clara" del cajón se veía blanca lisa, totalmente desconectada del color de la tela.
      `towardWhite` no satura nunca (asintótico hacia blanco): un color ya claro se ve apenas un
      poco más claro, uno oscuro se aclara bastante — el comportamiento correcto en los dos
      casos. Se usa `shade(fill, -18)` sin cambios para la cara oscura (oscurecer restando no
      tiene el mismo problema de saturación, el piso es 0 y ningún color de tela está tan cerca
      de negro puro).
- **Mecanismo y accesorios de exterior — condicionados por `tela_tipo`, no por un toggle
  interior/exterior nuevo (decisión explícita del usuario: "Essential" YA es la tela que ARTAL
  usa de exterior).** Cuando `tela_tipo === 'essential'` (`esExterior` en `getMenuOpciones`):
  - El `<select>` de Mecanismo cambia de Cadena Manual/Motorizado a **Manual (Manivela)** /
    **Motorizada** (`state.mecanismo`: `'manivela'` o `'motor'`, en vez de `'cadena'`/`'motor'`)
    — una manivela, no una cadena colgante, por el tamaño/viento de un roller de exterior.
    Default de un roller nuevo: `'manivela'` (ver `addItem`). Al cambiar `tela_tipo` en
    `updateState`, si el mecanismo actual no es válido en la colección nueva (`['manivela',
    'motor']` para Essential, `['cadena','motor']` para el resto) se resetea al default de esa
    colección — mismo patrón que ya resetea color/apertura ahí mismo.
  - Aparecen dos **checkboxes independientes** ("Accesorios exterior:", mismo patrón visual que
    la Cerradura de puerta de vidrio — `cerr_luna`/`cerr_digital`/`cerr_piso`): **Cables
    Laterales** (`state.cables_laterales`) y **Ganchos de Sujeción** (`state.ganchos`). Son dos
    accesorios independientes (pueden ir los dos juntos, uno solo, o ninguno) — **no son la
    misma cosa ni alternativas entre sí** (corrección explícita del usuario: un primer intento
    los puso como un único `<select>` "Cables o Ganchos" y estaba mal — cables laterales es un
    sistema de guía/riel para la tela, ganchos es un accesorio de sujeción abajo, cosas
    distintas). Solo se muestran/leen para Essential; en otras colecciones quedan `undefined`
    (no se limpian al cambiar de colección, dato muerto inofensivo).
  - `renderCortina` dibuja el mecanismo según `state.mecanismo`: `'manivela'` → varilla+mango al
    costado (lado de `orientacion`, igual que la cadena); `'cadena'` (o vacío) → cuenta colgante
    de siempre; `'motor'` → **no dibuja nada** (motorizado no tiene mecanismo manual visible).
  - `generateSummary` arma el texto del mecanismo con un mapa (`Motorizada` para exterior vs
    `Motorizado` para interior, `Manual (Manivela)` vs `Cadena Manual`) y agrega
    "Accesorios exterior: Cables Laterales + Ganchos de Sujeción" (solo los que estén marcados,
    solo si `esExterior` y al menos uno está activo).
- **Reutiliza `orientacion` ('I'/'D') como "lado"** (de la cadena/manivela en roller, del
  motor/manivela en shutter) en vez de inventar un campo nuevo: el toggle "A LA
  IZQUIERDA/DERECHA" que ya existe para ventanas/correderas se activa agregando `'cortina'` a la
  lista `showOrientation` en `addItem` — mismo mecanismo (`setOrientation(id, 'I'|'D')`), sin
  tocar nada más.
- **`renderCortina(state, id)`** (dibujo SVG, definida junto a `renderDucha`): mismas
  `dimLineH`/`dimLineV` que usa el resto de la app (mismo margen `y=4`/`x=borde+4` que la medida
  universal ancho/alto del switch grande, para que se vea igual de "técnico" que los demás
  ítems). Roller: tubo/cajón arriba (según `cajon`) + tela **como una sola pieza continua, sin
  líneas de pliegue** (una tela enrollable no tiene costuras visibles — se probaron esas líneas
  y el usuario pidió quitarlas) + cadena con "cuenta" del lado de `orientacion`. Shutter: ver
  subsección propia más abajo.
- **Dispatch en `renderSVG`**: `if (state.categoria === 'cortina') return renderCortina(...)`
  va en el mismo punto que baranda/ducha/cerramiento, **antes** del check `isCAD` — por eso
  cortinas/enrollables no participan del CAD (no hace falta excluirlas a mano de ningún lado,
  simplemente nunca llegan a `renderCADProportional`).
- **`generateSummary`**: rama propia (mismo patrón que ducha/baranda/cerramiento — `return`
  temprano antes del bloque genérico, que si no imprimiría "Acabado: ..." sin sentido para un
  producto sin perfil de aluminio). Para roller, agrega "Tipo de tela: {label de la colección}"
  además de color/apertura, leyendo todo de `TELA_COLECCIONES` (nunca una copia local del texto).
  `instTxt` (línea "Instalación: ...") se calcula distinto según `type`: "Dentro del
  marco"/"Sobre el marco" para roller, "Por Dentro"/"Por Fuera" para shutter — mismos valores
  `dentro`/`fuera` guardados en `instalacion_cortina`, solo cambia la etiqueta mostrada.
- **`updateState`**: los campos nuevos (`color_cortina`, `tela`, `tela_tipo`, `mecanismo`,
  `cajon`, `instalacion_cortina`, `tipo_motor`, `instalacion_tipo`) están en la lista blanca de
  re-render del dibujo; `color_cortina` además dispara la regeneración de las opciones (para
  mostrar/ocultar el campo de texto de "Personalizado"); `tela_tipo` tiene su propio bloque
  dedicado (resetea color/apertura si hace falta + regenera opciones + redibuja, todo junto,
  igual que hace "espesor" con "vidrio"). `guiaIzq`/`guiaDer`/`cajonExtra` (ver "Shutter") NO
  pasan por `updateState` — tienen su propio toggle dedicado, `toggleShutterExtra(id, key)`.

### Shutter (`type: 'cort_shutter'`) — persiana de seguridad enrollable

Rediseñado por completo (2026-07-30) a partir de una foto de referencia real que mandó el
usuario (persiana enrollable de aluminio negra, cajón superior, rieles laterales, lamas
corrugadas) — el diseño anterior (paneles abisagrados con lamas tipo "shutter" plegable) no
correspondía al producto real. Los tipos de guía/cajón todavía no tienen ficha técnica (el
usuario los definirá más adelante) — mientras tanto son solo notas en el dibujo, no
selects con opciones reales.

- **Colores**: paleta acotada a 3 (`getMenuOpciones`, rama `type === 'cort_shutter'`) — Blanco,
  Negro, Marrón (+ Personalizado, mismo patrón de campo de texto libre que el resto de la
  categoría). `CORTINA_COLORS` conserva `beige`/`gris`/`madera` solo por compatibilidad con
  proyectos guardados de antes del rediseño (dato muerto inofensivo, ya no aparecen en el
  selector); `negro` se oscureció a `#1a1a1a` (antes `#2b2f33`) para que se vea más parecido al
  aluminio mate negro de la foto — cambio seguro porque `CORTINA_COLORS` solo lo usa el shutter
  (el roller resuelve su color con `cortinaColorHex`/`TELA_COLECCIONES`, no toca esta paleta).
- **Motor**: `state.tipo_motor` (default `'manual'`), select de 5 opciones — `motorizado`,
  `manual` (Manivela), `motor_manivela` (Motorizado c/ Manivela de Emergencia),
  `motor_inteligente` (Motorizado + Sistema Conectado Inteligente), `motor_solar` (Motorizado
  Solar). El **lado** del motor/manivela reutiliza `orientacion` (mismo toggle "A LA
  IZQUIERDA/DERECHA" ya activo para la categoría, sin campo nuevo).
- **Montaje**: `state.instalacion_tipo` (default `'hueco'`) — Dentro del Hueco / En Aplique.
  Campo nuevo y **distinto** de `instalacion_cortina` (que para shutter pasó a significar "Por
  Dentro/Por Fuera" — dos conceptos de instalación separados, ambos pedidos explícitamente por
  el usuario).
- **Guías y cajón extra — booleanos simples, sin sub-configuración todavía**
  (`guiaIzq`/`guiaDer`/`guiaInf`/`cajonExtra` en el state, default `false` los 4): cuatro botones
  tipo `.toggle-btn.small` (`renderShutterExtras(id)`, div `id="shutter-extras-${id}"` insertado
  en la plantilla de la tarjeta justo debajo de `.measure-inputs`, generado una sola vez en
  `addItem` — **no** dentro de `.config-options`, mismo motivo que los botones de Paño Fijo:
  `updateState` regenera `#options-${id}` completo al cambiar otros campos y borraría estos
  botones) — "+ Guía Izq." y "+ Guía Der." bajo el campo Ancho; "+ Guía Inf." (guía horizontal
  inferior) y "+ Cajón" bajo el campo Alto (botones abreviados por espacio; el dibujo y el
  resumen sí usan la palabra completa, ver abajo). `toggleShutterExtra(id, key)` invierte el
  booleano, refresca el mini-bloque de botones y redibuja el SVG (mismo patrón que `togglePano`,
  pero sin objeto de sub-configuración porque todavía no hay tipos/dimensiones reales que pedir).
  Al activarse, cada uno agrega **en el dibujo** una nota de texto con la palabra completa
  ("+ Guía Izquierda" / "+ Guía Derecha" / "+ Guía Inferior" / "+ Cajón", debajo de la cortina,
  **solo si está activo** — nunca aparece de por sí, a pedido explícito del usuario) y una línea
  "Extras: ..." en el resumen/PDF (`generateSummary`). **Sin cálculo de medida**: el usuario
  aclaró explícitamente que agregar guías aumenta el ancho total real del shutter, pero ese
  cálculo lo hace el técnico según qué guías use — la app **no** le suma nada a `state.ancho`
  todavía (pendiente para una versión futura que desglose medidas de verdad; por ahora es solo
  una nota informativa).
- **Marca visual de cada guía activa (no solo texto)** — pedido explícito del usuario tras ver
  el primer resultado ("marca completo... para que quede bien claro en el dibujo"):
  - **Izquierda/Derecha**: el riel lateral correspondiente (ver "Dibujo" abajo, siempre
    dibujado) cambia su borde de sutil (`shade(fill,-12)`, 0.4 de grosor) a **negro y grueso**
    (`#000`, 1 de grosor) cuando `guiaIzq`/`guiaDer` está activo — mismo relleno (`fill`) en
    ambos casos, solo cambia el borde.
  - **Inferior**: a diferencia de los rieles laterales, **no hay barra inferior por defecto**
    (ver corrección de la "barra final" más abajo) — el rectángulo de la guía inferior
    (`bx,by+bh-2.5` a `bx+bw,by+bh`, mismo `fill` que la cortina + borde negro `#000` de 1 de
    grosor) **solo se dibuja si `guiaInf` está activo**, exactamente el mismo criterio que el
    usuario pidió para las notas de texto ("la guía inferior aparece solo si la selecciono").
- **Corrección: ya no hay una barra gris fija en la base del shutter.** El diseño anterior
  dibujaba siempre una "barra final" (`shade(fill,-25)`) en el borde inferior de la cortina —
  para colores claros (blanco) esa resta de 25% de brillo daba un gris claramente visible y
  desentonado que el usuario reportó como un rectángulo gris que "no debe estar presente". Se
  quitó por completo; el borde inferior de la cortina ahora solo se marca cuando el usuario
  activa `guiaInf` (ver punto anterior) — mismo elemento visual, pero condicionado al toggle en
  vez de fijo.
- **Dibujo (`renderCortina`, rama `type === 'cort_shutter'`)**: cajón superior con el mismo
  truco isométrico 3D (cara superior + lateral, `towardWhite`/`shade`) que ya usa el cajón del
  roller — mismas coordenadas (`cajY = by-4`, `cajH = 4`, `depth = 1.6`) para no chocar con la
  línea de medida de ancho, que ya usa `y=4`. **Rieles laterales al ras del cajón**: dos barras
  verticales finas, mismo ancho que el voladizo del cajón por lado (`railW = 1`, calculado como
  `cajX+cajW - (bx+bw)` para que quede siempre exacto aunque cambien las constantes del cajón) y
  **del mismo color que la cortina** (`fill`, no un gris fijo — corregido a pedido del usuario,
  que notó que se veían "por fuera" del cajón cuando el ancho/color no coincidían), con borde
  marcado en negro cuando su guía está activa (ver punto anterior). Cortina: rectángulo del
  color elegido + 16 franjas horizontales alternadas claro/oscuro (`towardWhite(fill,0.18)`/
  `shade(fill,-16)`) simulando la corrugación de las lamas de aluminio de la foto — **sin barra
  de cierre fija** (ver corrección arriba). **Motor/manivela**: si `tipo_motor==='manual'`, **sin
  dibujo** — el usuario vio la línea suelta de la manivela (varilla+mango, mismo patrón que la
  del roller) y pidió explícitamente quitarla del dibujo en vez de mejorarla (quedaba lo
  suficientemente ambigua como para leerse como un error, "una línea que sale de atrás del
  shutter"); el mecanismo manual queda solo en el select "Motor" y en el resumen/PDF. Cualquier
  variante motorizada dibuja el **motor completo dentro del cajón** (tubo con degradado metálico + tapa/
  cara oscura en el extremo, mismo gradiente que el tubo del roller sin cajón, `motorW=16`
  dentro de los límites del cajón, empujado hacia el borde inferior del cajón — `motorH=2.1` en
  vez de ocupar todo el alto — para dejar hueco arriba) del lado de `orientacion` — a pedido
  explícito del usuario, para que el lado del motor se note "de un vistazo" sin asomar afuera
  del cajón (el diseño anterior era una cajita de 3×2 en el borde, muy difícil de ver). **Con
  una etiqueta "MOTOR" arriba del tubo, dentro del cajón** — pedido explícito del usuario ("para
  que no quede duda"): un chip oscuro fijo (`fill="#111"`, no el color de la cortina) + texto
  blanco, porque el chip tiene que leerse igual de bien sobre cualquier acabado (blanco, negro,
  marrón). Solo se dibuja para variantes motorizadas, no para `manual` (la manivela ya es
  autoexplicativa). No hay espacio disponible **encima** del cajón completo (el borde superior
  del cajón, `cajY-depth`, queda a solo 0.4 unidades de la línea de medida de ancho que usa
  `y=4`) — por eso la etiqueta vive **dentro** del cajón, arriba del tubo, no por fuera.
- **`verify.mjs`**: `cort_roller`/`cort_shutter` agregados al array `types` (se prueban con el
  mismo fixture genérico que el resto — los campos que no usan quedan sin efecto, y los que sí
  usan tienen `|| valor` de respaldo en `getMenuOpciones`/`renderCortina`, así que renderizan
  bien igual sin necesitar un fixture dedicado).
- **Info complementaria de los catálogos, guardada para cuando el usuario arranque el rediseño
  del sitio web** — ver memoria `[[artal-sitio-web-presentacion]]` sección "Cortinas/Rollers":
  fichas técnicas completas (material, tejido, peso, grosor, certificaciones FR/Oeko-Tex,
  tabla de confort térmico/visual por color de Essential, especificaciones de corte/soldado),
  guía de apertura recomendada por orientación de fachada, y una tercera ficha ("Cyprus",
  tela day/night light-filtering con parte sólida + parte sheer) recibida SIN colores todavía
  — pendiente agregarla como colección nueva cuando lleguen las fotos de color.

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

## Cotización para cliente (PDF formal desde el cuaderno)

Salida NUEVA y aparte de la hoja interna de fabricación 2×2: un **PDF formal para el cliente**
estilo "Devis" (una fila por ítem con **el dibujo del cuaderno** + Cant + Descripción + Ancho +
Alto + Precio unit. + Precio total), con el encabezado azul de ARTAL + franja de contacto. Pedido
explícito del usuario a partir de una foto de un Devis de la competencia ("cada ítem debe salir del
cuaderno de relevo y solo agregamos precio; al final transporte, instalación y líneas a mano").

- **Módulo autocontenido en `index.html`** (no toca las plantillas de tarjeta ni `exportPDF`): botón
  lateral "💲 Cotización cliente" → `openCotizCliente()` abre un overlay (`#cotiz-cli-ov`) que lista
  cada ítem con su `renderSVG(id)` en miniatura, medidas (`state.ancho`/`alto`/`cantidad`) y un
  **input de precio** por ítem. Debajo: Transporte, Instalación, **toggle de ITBIS**
  (`incluido`/`agregar 18%`/`ninguno`) y **"+ línea manual"** para vender cosas que no están en el
  cuaderno (desc + cant + precio). Total en vivo.
- **Persistencia:** el precio por ítem vive en `cardsState[id].precioCliente` (viaja solo en
  `getAppJSON`, que guarda `cardsState[id]` completo); la config global en `cotizCli`
  (`{transporte, instalacion, itbisModo, itbisPct, lineas:[]}`), agregada a `getAppJSON`/
  `restoreData`. Ambos viajan a `orders` → **preparado para mapear a `/v5/cotizacion` de Citrus**
  cuando llegue el token (ver `[[artal-citrus-erp-integracion]]`).
- **PDF (`czGenerarPDF`)**: arma un contenedor fuera de pantalla con el layout formal (mismos colores
  de marca que la cotización de `ops/ventas-cotizacion.html`), **rasteriza cada SVG a PNG con la
  MISMA técnica que `exportPDF`** (quitar `filter="url(#shadow-...)"`, cargar como `<img>` data-URI,
  dibujar en canvas ×3, reemplazar el SVG — por los líos de Safari con SVG+filtros), luego
  `html2canvas` (scale 2) + `jsPDF` (una imagen JPEG partida en páginas A4 por offset). Los ítems
  CAD (`type==='draw'`) no tienen SVG (usan canvas) → se muestran como texto "Fachada compuesta".
- **Verificación:** `node verify.mjs` en verde (RENDER OK 73 / FAIL 0, guardrail exportPDF OK) + prueba
  visual en navegador (panel + PDF real extraído con PyMuPDF). **Trampa de test encontrada:** parchar
  `jsPDF.prototype.save` NO intercepta la descarga (jsPDF no lo tiene en el prototype) — al probar
  `czGenerarPDF` se descargó un PDF real a Downloads; se verificó su contenido y se borró. Para probar
  sin descargar, usar `pdf.output('arraybuffer')`/`'bloburl'` en una réplica, nunca dejar correr
  `.save()` real en la máquina del usuario (misma regla que `exportPDF`).

## Proyectos guardados

- `getProjects` normaliza estructuras corruptas y **fusiona clientes/obras duplicados** con
  `normNombreKey` (ignora mayúsculas, tildes Y separadores/conectores: Gabor = GABOR,
  "STEVE Y ALAIN" = "STEVE/ALAIN" = "Steve & Alain", "Marise y Ricky" = "Marise Ricky"). La
  misma clave se usa al **guardar** (`saveProject`/`mergeCloudProject`) para caer en el
  cliente/obra existente en vez de crear un duplicado, y en `ops/clients.js` (`norm`) para el
  lado Firestore (datalist de proyecto del cuaderno + pantallas de ops). Solo compara; el nombre
  mostrado es el original. Dedup de obras dentro de un cliente conserva la de `fechaModificacion`
  más reciente. `saveProject/loadProject/deleteProject/updateClientList/
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
- **Ofrecer hoja en blanco después de guardar.** Pedido explícito del usuario: la persona
  siguiente que abre la app se encuentra la última tarjeta guardada todavía en pantalla (por el
  autosave `artal_live_progression`) y no sabe si es un proyecto ajeno ya guardado o algo a
  medio hacer — "cada vez que entramos estamos con el miedo de borrar algo por inadvertencia".
  `saveProject()`, después del `alert()` de éxito, hace `confirm('¿Dejar la hoja en blanco para
  el próximo proyecto?')` — **es una pregunta, no automático**: guardar seguido mientras se
  sigue midiendo el mismo proyecto (el uso normal, ver el punto de "Aviso antes de reemplazar"
  más abajo) puede responder que no y seguir exactamente donde estaba, sin perder tarjetas. Si
  acepta, llama a `clearNotebookToBlank()` — la misma lógica que ya usaba `resetNotebook()`
  ("Hoja en blanco" del menú lateral), extraída a una función compartida para no duplicarla;
  `resetNotebook()` sigue pidiendo su propio `confirm()` antes de llamarla (dos confirmaciones
  con textos distintos, cada una en su contexto — no se fusionaron).
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

### Instalación (`ops/instalacion.html`) — pantalla única con pestañas

Antes eran DOS pantallas separadas que confundían (`ops/instalaciones.html` "Agenda de Instalación"
= planificar, calendario+GPS+agendar; `ops/instalador.html` "Trabajo en Obra" = ejecutar,
recordatorios+obras+firma), más un hub `ops/instalacion.html` que solo linkeaba a ambas. A pedido
del usuario ("se me hace difícil entender entre las dos... todo en una sola pantalla"), se fusionó
en **`ops/instalacion.html`**. **Simplificada a 2 pestañas (2026-08-22, antes eran 3)** por pedido
del usuario ("muy compleja"): **🗓️ Calendario día a día** (agenda de `instalaciones` con fecha+hora
—antes solo mostraba la hora— + **rejilla del mes COLAPSABLE**: botón `toggleCalendario`/`calAbierto`
muestra/oculta el `tab-cal` con la rejilla mensual, "por programar" y el modal completo de agendar/
editar) y **🏗️ Obras asignadas** (antes "Por instalar": obras `orders` listas → tarjeta unificada
con firma/biometría + avance parcial + "📅 Agendar" + "📦 Solo recoger" + "↩ No está listo").
`setTab` ahora solo maneja `dia`/`inst` (el `tab-cal` vive dentro de "día a día"). **Recordatorios
ya NO van sueltos** (sobrecargaban): se quitó la sección "🔔 Recordatorios" + "+ Recordatorio"; ahora
hay un botón **🔔 Recordatorio por cada trabajo y cada obra** (`abrirRecTrabajo`/`abrirRecObra` →
`recCtx` → la cita guarda `instalacionId`/`orderId`) y sus recordatorios se ven **en línea dentro de
la tarjeta** (`recInlineHTML`, filtrando `recsCache` por ese id). `recCardHTML`/`recEtapaRow` quedan
como código muerto inofensivo. Enlace **🗂️ Historial** en el encabezado (a `historial.html`, admin)
para ver/corregir trabajos ya entregados o verificar datos meses después. Badge de "día a día" =
trabajos de hoy. Combina: `jobCardHTML` (instalaciones), `orderCardHTML` (firma),
`cambiarEstado`+`movimientosInstalaciones` (auditoría), `marcarSinInstalacion`, etc. Un solo juego
de listeners (`instalaciones`, `orders` x2, `citas`, `usuarios`, `clientes`). `requireAuth(['instalador',
'ayudante'])`, admin gestiona todo. El tile del Panel ("Instalación") ya apunta aquí.
**`ops/instalaciones.html` e `ops/instalador.html` siguen existiendo como respaldo** (accesibles por
URL directa) hasta confirmar en producción; el hub que las enlazaba se reemplazó por esta pantalla.
Fotos/PDF adjuntos vía `fotos.js` (acepta imágenes y PDF, opt-in `pdf:true`).

### Transportes (`ops/chofer.html`) — pestañas En espera / En ruta / Entregado

- La pantalla se ve como **"Transportes"** (título, tile del Panel de Control), pero el rol
  Firestore sigue siendo `chofer` internamente (`requireAuth(['chofer'])`, campos
  `asignadoChoferEmail`/`asignadoChoferNombre`, nombre de archivo `chofer.html`) — cambiar eso
  implicaría migrar el campo `rol` de usuarios ya existentes en Firestore, no vale la pena solo
  por el texto visible.
- **Pestañas**: "En espera" (`!entregado && !enRuta`), "En ruta" (`!entregado && enRuta`),
  "Entregado" (`entregado === true`) — mismo patrón de tabs que `ops/alucufel/fabrica.html`. La
  pestaña "Entregado" es de solo lectura (sin formulario de recepción/firma ni botones de
  acción), muestra fecha y quién recibió. La query de Firestore incluye `status:'completado'`
  además de `listo_para_cargar`/`parcialmente_listo` para que un pedido ya completado no
  desaparezca de esta pantalla — sigue visible en "Entregado" (mismo criterio que usa
  `ops/alucufel/fabrica.html` con su tab "Enviados", que también guarda `completado`
  indefinidamente; `ops/historial.html` es el lugar para buscar histórico viejo).
- **Botón "En ruta"** (`marcarEnRuta`): el chofer lo marca apenas recoge el pedido — solo
  informativo (badge azul + borde de tarjeta azul), no bloquea ni exige nada para después
  marcar "Entregado".
- **Bug real corregido: una Compra Directa entregada quedaba mostrando "Listo para
  cargar/instalar" para siempre.** Causa: `confirmarEntrega()` solo ponía `status:'completado'`
  si `instalado === true` — pero `ops/instalador.html` **excluye explícitamente**
  `docType === 'COMPRA_DIRECTA'` de su cola (esos pedidos, ej. a un almacén propio, nunca pasan
  por instalador), así que `instalado` nunca se cumplía y el pedido se quedaba atascado en
  `status:'listo_para_cargar'` aunque `entregado` sí fuera `true` — cualquier pantalla que
  mostrara el estado leyendo `status` (badges de `ops/historial.html`/`ops/compras.html`) seguía
  diciendo "Listo para cargar/instalar" para siempre. **Arreglo**: `confirmarEntrega()` ahora
  también da por cumplida la condición si `docType === 'COMPRA_DIRECTA'` **o** si un admin ya
  marcó el pedido `sinInstalacion:true` desde `ops/instalaciones.html` (botón "📦 Solo recoger",
  `marcarSinInstalacion()`) — antes ese campo solo se usaba para ocultar el pedido de la lista
  de Instalaciones, no estaba conectado a la lógica de `chofer.html` que decide si el pedido
  queda `completado`. **Pedidos ya atascados de antes de este arreglo** no se corrigen solos —
  hay que cambiarles el estado a mano una vez desde el desplegable de `ops/historial.html`
  (`cambiarEstado`).

### Historial (`ops/historial.html`) — mosaicos agrupados por tipo de documento

- **Caso real reportado**: el mosaico "Completadas" (pestaña Pedidos) mezclaba Fabricaciones y
  Compras Directas completadas sin poder distinguirlas — porque ambos tipos pueden llegar al
  mismo `status:'completado'` (ver `STATUS_OPTIONS_BY_TYPE`), y el filtro de cada mosaico
  original solo miraba `status`, nunca `docType`. El mismo problema, sin reportar todavía,
  existía igual en "Lista para cargar/instalar" (`listo_para_cargar` también lo comparten
  Fabricación y Compra Directa).
- **Arreglo**: cada entrada de `CATEGORIES` ahora puede pedir, además de `statuses`, un `tipo`
  (función que confirma el `docType` — `esFabricacion`/`esCompraDirecta`/`esCotizacion`,
  definidas contra el mismo criterio que ya usa `orderCardHTML`/`STATUS_OPTIONS_BY_TYPE`).
  `matchesCategory(cat, o)` centraliza el chequeo (statuses + tipo), usado tanto por
  `renderTiles()` (conteo) como por `render()` (listado) — antes cada uno repetía la condición a
  mano. **Cada pedido cae en exactamente un mosaico específico** (verificado con casos de
  prueba: ningún tipo+status queda sin mosaico ni matchea dos a la vez).
- **Mosaicos reorganizados en 3 grupos con encabezado** (`CATEGORY_GROUPS`, div
  `.cat-group-label` antes de cada fila de `.cat-grid`) en vez de una sola grilla plana de 7:
  "Todos" queda aparte arriba; **Cotización** (Pendiente, Enviada al cliente); **Fabricación**
  (Pendiente, Parcialmente lista, Lista para cargar, Completada); **Compra Directa** (Lista para
  cargar, Entregada) — 9 mosaicos en total, cada uno de un solo tipo de documento.
  `#cat-grid` pasó de tener la clase `.cat-grid` fija en el HTML a ser un contenedor vacío que
  `renderTiles()` llena con varios `<div class="cat-grid">` (uno por grupo) + sus etiquetas.
- **`progresoExtra()`** (texto inline "Entregado ✓ · Instalado ✓" en cada tarjeta) ahora también
  muestra "🚚 En ruta" cuando `enRuta && !entregado` — coherencia con el badge/estado que ya usa
  `ops/chofer.html` ("Transportes"), sin agregar un mosaico nuevo para eso (evita duplicar la
  granularidad de Transportes acá, que es para auditoría/búsqueda, no para operar el día a día).

### Ficha técnica compartida (visor de solo lectura + checklists)

- `index.html?orderId=X` carga un pedido de Firestore en modo solo lectura
  (`body.readonly-view`) — usado por `ops/order-preview.js` (`openOrderPreview(orderId, role)`,
  modal con iframe). **No reenvía nada al cuaderno local**, solo pinta `orderData.appJSON`.
- `&checklist=fabrica|chofer|instalador` inyecta, por DOM, un recuadro en cada tarjeta ya
  renderizada (`injectChecklist` → `injectFabricaChecklist` / `injectChoferChecklist` /
  `injectInstaladorChecklist` en `index.html`) — **sin tocar ninguna plantilla de tarjeta**:
  - `fabrica`: **por ítem, checkboxes de PARTES** (marco/hojas/vidrios/accesorios, según el tipo)
    — ver "Partes de fábrica" abajo. Escribe `partesFabrica.{id}` (`{marco:true, hojas:false, …}`)
    y **deriva** `itemsListosFabrica.{id}` = true solo cuando TODAS las partes están marcadas.
  - `chofer`: botones Cargado/Problema → `itemStatus.{id}`, **con el resumen de partes de fábrica
    arriba** (qué recoge / qué falta).
  - `instalador`: checklist de etapas por tipo de elemento (`STAGE_SETS`/`getStageSetKey`) →
    `itemStatusInstalador.{id}`.
  - **sin rol** (abrir la ficha desde el Panel/Cotizaciones/Historial): si el pedido ya está en
    flujo de fábrica (`en_fabrica`/`parcialmente_listo`/`listo_para_cargar`/`completado` o hay
    datos de partes), `injectPartesResumen` agrega una caja de SOLO LECTURA con lo que marcó fábrica.
- Este visor se registra **después** de `loadProgress()` (dentro de su propio
  `DOMContentLoaded`) para que el autosave local nunca pise los datos del pedido de Firestore.

#### Partes de fábrica (`partesFabrica`, marco/hojas/vidrios/accesorios)

Pedido explícito del usuario: fábrica (ALUCUFEL) necesita marcar **qué partes** de cada ítem está
enviando (una corredera = marco + hojas + vidrios + accesorios), no solo "listo/no listo", y que la
oficina (Panel) y el chofer vean exactamente eso (qué recoger / qué falta). En `index.html`:
`PARTES_SETS` (por categoría de `getCategoriaByType`, con `PARTES_DEFAULT` de respaldo) define las
partes por tipo; `getPartesFabrica(itemState)` las resuelve. `injectFabricaChecklist` renderiza un
checkbox por parte + "Marcar TODAS"; al cambiar, escribe `partesFabrica.{id}` (objeto con claves
ASCII `marco/hojas/vidrios/accesorios/herrajes/perfiles/estructura/tela/mecanismo`) **y**
`itemsListosFabrica.{id}` (booleano derivado = todas marcadas). **`itemsListosFabrica` sigue siendo
la fuente** que leen el flujo `parcialmente_listo` (`ops/alucufel/fabrica.html`,
`ops/fabrica-interna.html`), los badges del Panel y el flag `listo` del chofer — no se tocó nada de
eso. `partesResumenHTML` (chips ✓/○ + "Enviando: … · Falta: …") se usa en la caja de solo lectura y
dentro del checklist del chofer. **Compat**: órdenes viejas con solo `itemsListosFabrica[id]=true`
(sin `partesFabrica`) se muestran con todas las partes marcadas; al tocar una casilla se migran a
`partesFabrica`. CAD (`type:'draw'`) y tipos sin mapear caen a `PARTES_DEFAULT`. `verify.mjs` sí
cubre esto (vive en el `<script>` clásico).

### Clientes/obras: autocompletar y normalización (`ops/clients.js`)

Para evitar que "Pablo" y "PABLO" terminen como clientes distintos (con cientos de trabajos al
año, esto importa): `buildClientMap()` agrupa los `cliente`/`obra` de todos los `orders` ya
existentes sin importar mayúsculas/espacios. Se usa en `ops/compras.html` (datalist +
normaliza al guardar), `ops/historial.html` (datalist en el buscador, que ya era
case-insensitive) e `index.html` (ver "Guardar → Campo NOMBRE DEL PROYECTO con autocompletar",
sección "Proyectos guardados" más arriba).

### Carpetas por obra: navegación Cliente → Obra → Documentos (`ops/historial.html`)

Pedido explícito del usuario: la pestaña mostraba TODOS los documentos de TODAS las obras a la
vez (una lista larga que había que desfilar). Un primer intento la colapsó en un acordeón
(carpetas cerradas por defecto, clic para expandir en el mismo lugar) pero el usuario pidió algo
más parecido al **Panel de Control** (`ops/index.html`): tarjetas (`.card-link`/`.grid`, mismas
clases de `shared.css`) organizadas en 3 niveles, cada uno una pantalla propia dentro de
`#carpetas-list`:

1. **Clientes** (`renderCarpetasClientes`) — un card 👤 por cliente, con cuántas obras y
   documentos tiene en total. Es el nivel de entrada (`carpetaNivel = 'clientes'` al inicio y
   cada vez que se hace clic en la pestaña "Carpetas por obra", ver `setVista`).
2. **Obras** (`renderCarpetasObras`) — al abrir un cliente, un card 📁 por **proyecto** suyo
   (ver "Agrupar por proyecto" más abajo — puede incluir varias obras fusionadas), con la
   cantidad total de documentos y la etiqueta del tipo del documento más reciente. Botón
   "← Clientes" para volver.
3. **Documentos** (`renderCarpetasDocs`) — al abrir un proyecto, la ficha completa de siempre:
   enlaces "Ver ficha"/PDFs/firmas por documento, dentro de un solo `.carpeta` expandido. Si el
   proyecto fusiona varias obras, cada documento muestra además su propio texto de obra original
   (`.carpeta-doc-obra`, ej. "Casa Aarón barandas") cuando difiere del título de la carpeta, para
   no perder esa distinción. Botón "← {Cliente}" para volver.

`renderCarpetas()` sigue agrupando TODOS los pedidos por `cliente+'|||'+obra` (normalizado, ver
abajo) en `carpetasArr` (módulo, sin filtrar) en cada render — sigue siendo la fuente que usan
los 3 niveles.

**Agrupación insensible a mayúsculas/acentos (`normTexto`).** Antes la clave de agrupación era
`.toLowerCase()` a secas, así que "Casa Aarón" y "casa aaron" (mismo nombre, un acento de
diferencia) quedaban en dos carpetas separadas — reportado por el usuario con un caso real
("Casa Aarón barandas" / "Casa arron completivo" / "Casa Aarón" bajo el mismo cliente). La clave
de `carpetasArr` ahora usa `normTexto(s)` (`trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,
'')`, el mismo truco estándar de "descomponer y quitar los diacríticos") en vez de
`.toLowerCase()` — aplicado también al filtro de búsqueda y a la comparación de cliente
seleccionado en `renderCarpetasObras`. Esto solo une carpetas cuyo nombre es **exactamente el
mismo** salvo mayúsculas/acentos — el paso siguiente (`agruparPorProyecto`) es el que junta
nombres genuinamente distintos que son la misma obra.

**Agrupar por proyecto (`agruparPorProyecto`, `mismoProyecto`).** Pedido explícito del usuario:
una obra medida/cotizada en partes (ej. "Casa Aarón ventanas" + "Casa Aarón barandas", o "Altea
Villa 11 ventanas" + "Altea Villa 11 barandas") es UN solo proyecto para el negocio, aunque cada
parte se haya guardado con un nombre de obra distinto — deben verse en la misma carpeta al nivel
de Obras. `renderCarpetasObras`/`renderCarpetasDocs` corren `agruparPorProyecto` sobre las obras
YA agrupadas por `normTexto` de un mismo cliente, uniendo (unión-búsqueda, para que la
transitividad funcione: A+B y B+C → A/B/C juntos aunque A y C solas no calcen) las que
`mismoProyecto(wa, wb)` considera el mismo proyecto, comparando palabra por palabra (nunca por
caracteres — "Casa Bel" nunca matchea "Casa Beltrán"), con dos patrones:
  1. **Extensión**: todas las palabras de la obra más corta calzan al principio de la más larga
     (ej. "Casa Aarón" + "Casa Aarón barandas").
  2. **Mismo largo, difieren solo en la última palabra** (ej. "Altea Villa 11 ventanas" +
     "Altea Villa 11 barandas" — ninguna es prefijo de la otra). Exige al menos 3 palabras: con
     solo 2 ("Villa Marisa" vs "Villa Castillo") la primera palabra sola no es suficiente
     evidencia de que sea el mismo sitio — probado con ese caso exacto para no fusionarlo.
La obra con menos palabras del grupo resultante es la "raíz": su texto es el nombre del
proyecto (el título del card en Obras y el encabezado en Documentos); `rootKey` (el texto de la
raíz, unión de sus palabras normalizadas) es la clave estable que usa `data-okey`/
`carpetaObraSel` para sobrevivir a que el array se reordene entre renders.

**Sin botón de combinar manual.** Hubo un `"🔗 Combinar con otra"` (con `confirm()`, reescribía
`cliente`/`obra` de todos los documentos de una carpeta para unirla con otra) — se quitó a
pedido explícito del usuario una vez que la navegación Cliente → Obra + el agrupado automático
por proyecto (de arriba) dejaron todo lo suficientemente organizado como para no necesitarlo. Si
alguna vez hace falta unir dos carpetas que `agruparPorProyecto` no detecta como el mismo
proyecto, hay que hacerlo a mano editando `cliente`/`obra` de los pedidos correspondientes en
Firestore (no hay una herramienta de autoservicio para eso). **Idea pendiente, pedida
explícitamente por el usuario pero marcada "eventualmente" (no urgente):** una opción para mover
un documento/proyecto a otra carpeta a mano, por si alguna vez queda mal clasificado — no
implementada todavía.

**Navegación por `data-*`, no por texto embebido en el `onclick`.** Los cards de Cliente/Obra
necesitan la clave real (`normTexto(cliente)` / `normTexto(cliente)+'|||'+normTexto(obra)`) para
sobrevivir a que `carpetasArr` se reordene entre renders (por búsqueda, o porque llegó un pedido
nuevo y cambió "el más reciente primero") — un índice fijo apuntaría a otro cliente distinto en
el siguiente render. En vez de interpolar ese texto libre dentro de las comillas del `onclick`
(que rompería el atributo si el nombre trae una comilla doble), el valor va en un atributo
`data-ckey`/`data-okey` (escapado con `esc()`, como cualquier otro texto en el HTML) y
`carpetaAbrirCliente(this)`/`carpetaAbrirObra(this)` lo leen de `this.dataset` — el navegador ya
lo decodifica de vuelta al texto original sin que el código tenga que escaparlo a mano.

`carpetaNivel`/`carpetaClienteSel`/`carpetaObraSel` (módulo) solo se resetean al nivel Clientes
en `setVista('carpetas')` (clic en la pestaña) — un refresco en vivo de Firestore
(`onSnapshot` → `renderCarpetas()`) nunca saca al usuario de la obra que está mirando.

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

- **Etapas y completado por persona (`etapas` / `completadoPor` en `citas/{id}`).** Un recordatorio
  puede tener **varias etapas**, cada una asignada a una persona distinta (ej. «Verificar pago» →
  Andrea, «Poner orden de fabricación» → Anny) — `etapas: [{titulo, nombre, email, hecha,
  fechaHecha}]`. Cada persona marca SU etapa (`completarEtapa(id, idx)`); el recordatorio solo
  queda `completada:true` cuando TODAS las etapas están hechas. Si NO hay etapas pero el
  recordatorio va a **varias personas** (`asignados.length > 1`), se completa **por persona** vía
  `completadoPor: [email…]` (`asistioCitaPersona(id, email)`) — así, si una marca hecho, **no
  desaparece para las demás** (sigue `completada:false` hasta que todas marquen). Un recordatorio
  de una sola persona sin etapas sigue con el botón "✓ Hecho" clásico (`asistioCita`, flag
  `completada`). `citaCompletadaCalc(c)` centraliza el "¿está todo hecho?" y `reabrirCita` resetea
  etapas + `completadoPor`. `fechaHecha` de cada etapa es un **ISO string, NO `serverTimestamp()`**
  (Firestore rechaza `serverTimestamp()` dentro de arrays). El modal tiene una sección "Etapas /
  tareas (opcional)" (`window.etapasDraft`, `agregarEtapa`/`quitarEtapa`/`etapaSetPersona`,
  `personasParaEtapas()` según gerencia vs instalación); las personas de las etapas se unen a
  `asignados` al guardar (para filtros/notificaciones). **Mismo modelo espejado en
  `ops/instalador.html`** (recordatorios `asignadoA:'instalador'`): `recCardHTML` renderiza el
  checklist, `completarEtapaRec`/`asistioRecPersona` + `recsCache`. La Cloud Function de push no
  cambió (notifica a todos los `asignados` al crear).
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
- **"¿Para quién es?" → "Gerencia"** (antes "Para mí (gerente)"): al elegir Gerencia aparecen
  checkboxes con **Andrea / Anny / Dylan** fijos (a propósito, no derivados de `usuarios` con
  rol admin — más simple y no depende de que esos 3 usuarios ya estén cargados/con el rol
  correcto en Firestore).
- **Varias personas por evento** (`asignados: [{email, nombre}]`, reemplaza a los viejos campos
  singulares `asignadoEmail`/`asignadoNombre`): tanto "¿Quién de gerencia?" como "¿Quién del
  equipo de instalación?" son ahora **checkboxes** (`.personas-group`, no `<select>`) — se puede
  marcar más de una persona para el mismo evento/recordatorio, cada una recibe su propio push.
  `guardarCita()` arma `asignados` a partir de las casillas marcadas; para gerencia busca el
  email de cada nombre en `adminsCache` (fallback a `auth.currentUser.email` si esa persona no
  tiene un `usuarios` doc con rol admin coincidente — mismo estilo silencioso que el resto de la
  sincronización con Firestore de esta app). **Compatibilidad con eventos viejos** (un solo
  campo, de antes de esto): `asignadosDe(c)` es la ÚNICA función que debe leer quién está
  asignado a un evento (la usan `citaCardHTML`, `esDePersona`, `modificarCita`) — si no hay
  `asignados`, arma un array de 1 a partir de `asignadoEmail`/`asignadoNombre`.
  - **Cloud Functions también actualizadas** (`functions/index.js`): `enviarNotificacionCita`
    (push inmediato al crear) y `procesarRecordatoriosMulti` (recordatorios programados) ahora
    mandan un push **por cada persona** en `asignados` (helper `emailsAsignados(cita)`, misma
    lógica de compatibilidad que `asignadosDe()` del lado del cliente) — antes solo le llegaba a
    una. `instalaciones` (colección aparte, `ops/instalaciones.html`) no se tocó, sigue con un
    solo `instaladorEmail`. **Recordar desplegar** (`firebase deploy --only functions`) — ver
    nota de deploy pendiente más abajo.
- **"Gerente" (genérico, sin persona) ya no es una opción válida — se normaliza a "Dylan".**
  Antes de tener el selector Andrea/Anny/Dylan, los eventos de gerencia se guardaban con
  `asignadoNombre:'Gerente'` sin distinguir quién. Pedido explícito del usuario: sacar esa
  opción de la vista y que lo que hoy dice "Gerente" se lea como Dylan. `asignadosDe(c)` hace
  esta normalización automáticamente para cualquier evento con `asignadoA==='gerente'`
  (`normalizaNombreGerencia`: nombre vacío o `'gerente'` case-insensitive → `'Dylan'`,
  conservando el email real que ya tuviera guardado) — como es la única función que lee quién
  está asignado, la normalización aplica sola en la tarjeta, el filtro por persona, y el
  formulario de "Modificar" (que ya no necesita inyectar una opción "Gerente" dinámica). Al
  guardar de nuevo un evento viejo así (aunque sea sin cambiar nada), `guardarCita()` escribe
  `asignados:[{nombre:'Dylan',...}]` de verdad — se corrige solo con el uso normal, sin
  necesidad de una migración manual de datos en Firestore.
- **Secciones Todos/Anny/Andrea/Dylan** (`#persona-tabs`, `filtroPersona`, `citasParaFiltro()`):
  filtra `allCitas` por `asignadoA==='gerente' && asignadosDe(c).some(p => p.nombre===persona)`
  — se aplica tanto a los puntos de la grilla (`renderGrid()`) como a la lista de eventos
  (`render()`), en las dos vistas (mes y día). Un evento asignado al equipo de instalación
  **no** entra en ninguna de las 3 secciones personales (solo se ve en "Todos") — no es "de"
  ninguna de las 3 personas de gerencia, es del equipo de instalación.

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
- **`state.mosquitera` no es un booleano — el valor real depende del tipo de ítem.** Bug real
  reportado con foto (oscilobatiente 590×1595mm con "Mosquitera Fija" elegida, el resumen
  mostraba "Mosquitera: Sin" al fijar la tarjeta). Causa: `getMenuOpciones` usa DOS selects
  distintos de mosquitera según el tipo (línea ~2827) — `mosqCon` (correderas/galandajes:
  únicos valores `''`/`'con'`) vs `mosqFijaAmov` (`win_abat`/`win_souf`/`win_ob`: únicos valores
  `''`/`'fija'`/`'amovible'`) — pero `generateSummary` formateaba el resumen con
  `state.mosquitera === 'con' ? 'Integrada' : 'Sin'` en los dos lugares donde se imprime
  (rama CAD y rama genérica), sin contemplar `'fija'`/`'amovible'`: cualquier valor que no fuera
  exactamente `'con'` caía al `else` y mostraba "Sin", aunque el usuario sí hubiera elegido
  mosquitera. **Arreglo**: `mosquiteraLabel(m)` (helper local de `generateSummary`, junto a
  `espesorLabel`/`ralLabel`) mapea los 3 valores reales (`con`→Integrada, `fija`→Fija,
  `amovible`→Amovible), usado en los dos `specs.push('Mosquitera: ...')`. Verificado en vivo con
  los 4 casos (`fija`, `amovible`, `con` en corredera, vacío → no se muestra la línea).
