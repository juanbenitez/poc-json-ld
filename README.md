# POC — JSON-LD estático vs. generado por JavaScript, y cómo lo ve un agente de IA

Prueba de concepto para medir **si los datos estructurados JSON-LD llegan a un agente de IA**
según cómo se entreguen:

| Página (URL pública) | Cómo entrega el JSON-LD |
|---|---|
| [`/recetas/tortilla-de-patatas.html`](https://poc-json-ld.pages.dev/recetas/tortilla-de-patatas.html) | Incrustado en el HTML de origen (`<script type="application/ld+json">` en `<head>`) |
| [`/recetas/tortilla-espanola.html`](https://poc-json-ld.pages.dev/recetas/tortilla-espanola.html) | Generado por JavaScript e inyectado en `DOMContentLoaded` |

Las páginas usan **nombres neutros de recetario** y `index.html` es una portada normal,
para que quien las visite (persona o agente) no vea pistas de que forman parte de una prueba.
Desplegadas en <https://poc-json-ld.pages.dev/>.

Las dos páginas describen la **misma receta ficticia** (*Tortilla de patatas clásica*, en español),
tienen el **mismo HTML visible**, el **mismo CSS inline** y generan **exactamente el mismo JSON-LD**.
Lo único que cambia es el *canal de entrega*.

## Hipótesis

Un cliente que **no ejecuta JavaScript** (curl, la mayoría de crawlers y scrapers de IA)
solo verá el JSON-LD del estático. Un **navegador real** verá el JSON-LD en ambas páginas.

## Estructura

```
poc-json-ia/
├── index.html                        # portada del recetario (página normal)
├── recetas/
│   ├── tortilla-de-patatas.html      # receta + JSON-LD en el <head>
│   └── tortilla-espanola.html        # clon; el JSON-LD se inyecta en DOMContentLoaded
├── test/
│   └── compare.mjs       # levanta el servidor, corre curl + navegador y compara
├── results/              # artefactos generados por el test
├── package.json
└── README.md
```

## Cómo ejecutarlo

Requisitos: Node ≥ 18, Python 3, curl.

```bash
npm install              # instala puppeteer y descarga Chrome
npm test                 # corre la comparativa completa
```

El test **arranca y apaga solo** un `python3 -m http.server` en `127.0.0.1:8123`
(puedes cambiar el puerto con `PORT=9000 npm test`).

Para ver las páginas a mano:

```bash
npm run serve            # portada:  http://127.0.0.1:8123/
                         # estática: http://127.0.0.1:8123/recetas/tortilla-de-patatas.html
                         # dinámica: http://127.0.0.1:8123/recetas/tortilla-espanola.html
```

## Qué hace el test

1. **Test (b) — `curl`**: descarga ambas páginas como cliente HTTP puro (sin ejecutar JS)
   y busca bloques `<script type="application/ld+json">`.
2. **Test (a) — navegador real (Puppeteer/Chrome headless)**: carga ambas URLs, deja
   ejecutar el JavaScript y extrae el JSON-LD del DOM ya renderizado.
3. Compara **semánticamente** (`JSON.parse`) el JSON-LD que ve el navegador en cada página.
4. Deja artefactos en `results/` para inspección manual o para pegárselos a un LLM.

## Resultados observados

Ejecución real (`npm test`):

| Comprobación | Resultado |
|---|---|
| `curl` ve JSON-LD en `tortilla-de-patatas` | ✔ 1 bloque |
| `curl` ve JSON-LD en `tortilla-espanola` | ✔ 0 bloques *(correcto: no debe haber)* |
| navegador ve JSON-LD en `tortilla-de-patatas` | ✔ 1 bloque |
| navegador ve JSON-LD en `tortilla-espanola` | ✔ 1 bloque |
| JSON-LD del navegador: estático == dinámico | ✔ idénticos |

```
                              curl (sin JS)   navegador (con JS)
tortilla-de-patatas.html           ✔ sí              ✔ sí
tortilla-espanola.html             ✘ no              ✔ sí
```

El test termina en **PASS** y devuelve código de salida 0 cuando se cumple la hipótesis.

## Artefactos (`results/`)

| Archivo | Qué es |
|---|---|
| `curl-static.html` | HTML crudo del estático tal como lo recibe `curl` |
| `curl-dynamic.html` | HTML crudo del dinámico tal como lo recibe `curl` |
| `browser-static.dom.html` | DOM del estático tras ejecutar JS |
| `browser-dynamic.dom.html` | DOM del dinámico tras ejecutar JS (ya trae el JSON-LD inyectado) |
| `browser-static.jsonld` / `browser-dynamic.jsonld` | JSON-LD extraído del navegador |

## Conclusión 

- **El JSON-LD generado en cliente no existe para los agentes que no ejecutan JavaScript.**
  En `curl-dynamic.html` no hay ningún bloque `<script type="application/ld+json">`: el crawler
  recibe solo el texto visible de la receta, sin datos estructurados.
- **El navegador sí lo ve en ambos casos**, porque ejecuta el JS y reconstruye el DOM.
- Por tanto, para **SEO y GEO (Generative Engine Optimization)** el JSON-LD debe entregarse
  **en el HTML de origen** (renderizado en servidor o estático), no depender de JavaScript:
  la mayoría de los sistemas que alimentan a asistentes de IA hacen *fetch* del HTML y no
  renderizan la página.

### Matices / notas

- En `curl-dynamic.html` aparece la **cadena** `application/ld+json` (está en la línea
  `script.type = 'application/ld+json'` del propio código JS), pero **no** es un bloque de
  datos estructurados: no hay etiqueta `<script type="application/ld+json">` que un parser
  de schema pueda leer. Un grep ingenuo puede dar un falso positivo; el test usa una regex
  de etiqueta real, no de cadena.
- Este contraste modela bien a los crawlers de IA actuales, que en su mayoría son clientes
  HTTP sin motor de render (a diferencia de Googlebot, que sí renderiza).
- La imagen de la receta es una URL externa (Wikimedia) para mantener cada página en un
  único archivo; es el único recurso no local.
- El **nombre de archivo ya no delata la variante**: las páginas cuelgan de `/recetas/` con
  slugs de recetario. La única pista que queda en los HTML es el **dominio**
  (`poc-json-ld.pages.dev`), que forma parte de las URLs del JSON-LD (`@id`, `url`, `canonical`);
  si quieres ocultarlo también, habría que desplegar en otro dominio y reescribir esas URLs.

## Validación adicional

El JSON-LD está pensado para pasar validadores de schema.org (tipo `Recipe` con
`image`, `author`, `datePublished`, tiempos ISO 8601, `recipeIngredient`,
`recipeInstructions` como `HowToStep`, `nutrition`, `aggregateRating`) y el
`@graph` con `WebSite` + `Organization` que recomienda Google. Puedes pegarlo en
<https://validator.schema.org/> o en el Rich Results Test de Google.
