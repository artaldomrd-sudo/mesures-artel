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
- **Encabezado del proyecto** (`.project-header`): grid de 2 filas por `grid-template-areas`
  (fila 1 = datos cortos: cliente/material/color/fecha; fila 2 = datos largos: nombre del
  proyecto/ubicación, que necesitan más ancho). El logo abarca ambas filas
  (`grid-area: logo`). Mismo esquema en pantalla y en `body.printing-sheets` (solo cambian
  gaps/alineación). El campo `header-ubicacion` se guarda/restaura igual que los demás en
  `getAppJSON`/`restoreData`/`resetNotebook`.
- **Hoja con un solo ítem**: `buildPrintSheets()` le agrega la clase `single-item` al
  `.sheet-grid` cuando el grupo tiene 1 sola tarjeta (no panorámica), para que se agrande y
  centre en la página en vez de quedar chica y pegada a la esquina.
- Grosores en el resumen se muestran con `espesorLabel`: `3/8" (10mm)`, `1/2" (12mm)`, `3+3`…

## Proyectos guardados

- `getProjects` normaliza estructuras corruptas y **fusiona clientes duplicados sin importar
  mayúsculas** (Gabor = GABOR). `saveProject/loadProject/deleteProject/updateClientList/
  updateObraList/backupAllProjects`. Menú lateral: "Clientes" → "Proyecto".

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
normaliza al guardar) y `ops/historial.html` (datalist en el buscador, que ya era
case-insensitive).

### Notificaciones y badges

- Push real vía Cloud Messaging + Cloud Function `enviarNotificacionCita` (dispara con cada
  documento nuevo en `citas/`) — requiere "Agregar a inicio" en iPhone (limitación de Apple, no
  hay forma de evitarlo). Un solo `sw.js` en la raíz maneja tanto el cascarón offline del
  cuaderno como el listener `push`.
- `ops/index.html` (Panel de Control) muestra círculos rojos (`tile-badge`/`setBadge`) con la
  cantidad de pedidos que necesitan atención *ahora* en cada sección (no un historial de todo lo
  pasado) — ALUCUFEL y Cotizaciones cuentan `status==='costeada'`, comentarios de fábrica sin
  atender, etc.

## Convenciones aprendidas (para no repetir errores)

- Verificar SIEMPRE con `verify.mjs` antes de dar por bueno un dibujo.
- Flechas negras siempre; cromado = `#8d99a4`, negro = `#111111`.
- En vidrio oscuro, herrajes negros pierden contraste (por eso se cuida el tamaño de las marcas).
- Al añadir un campo nuevo al `state`, incluirlo en la lista blanca de re-render de `updateState`
  (si no, el dibujo no se actualiza al cambiar el menú).
- El grosor auto-selecciona el tipo de vidrio: `3+3/4+4/5+5/6+6` → laminado; `10mm/12mm` → templado.
- El color/acabado y el tipo de aluminio del encabezado se aplican por defecto a ítems nuevos
  (`headerAcabado`, `headerAluminio`).
