// POC: ¿el JSON-LD llega al agente?
//
// Compara dos canales de entrega de datos estructurados:
//   (b) curl        -> cliente HTTP puro, NO ejecuta JavaScript
//   (a) navegador   -> Chrome/Chromium real vía Puppeteer, SÍ ejecuta JavaScript
//
// Sobre dos páginas idénticas en contenido:
//   recetas/tortilla-de-patatas.html  -> JSON-LD incrustado en el HTML de origen
//   recetas/tortilla-espanola.html    -> JSON-LD inyectado en DOMContentLoaded
//
// Uso:  npm test        (o)  node test/compare.mjs

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RESULTS = join(ROOT, 'results');
const PORT = Number(process.env.PORT || 8123);
const BASE = `http://127.0.0.1:${PORT}`;

const PAGES = [
  { key: 'static', label: 'recetas/tortilla-de-patatas.html', path: '/recetas/tortilla-de-patatas.html' },
  { key: 'dynamic', label: 'recetas/tortilla-espanola.html', path: '/recetas/tortilla-espanola.html' },
];

mkdirSync(RESULTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. Servidor HTTP local (python3 -m http.server)
// ---------------------------------------------------------------------------
const server = spawn(
  'python3',
  ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' }
);
let serverExited = false;
server.on('exit', () => { serverExited = true; });

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error('El servidor python salió inesperadamente.');
    try {
      const res = await fetch(`${BASE}${PAGES[0].path}`);
      if (res.ok) return;
    } catch { /* aún no escucha */ }
    await sleep(200);
  }
  throw new Error('Timeout esperando al servidor http.server.');
}

function stopServer() {
  if (!serverExited) server.kill('SIGTERM');
}
process.on('exit', stopServer);
process.on('SIGINT', () => { stopServer(); process.exit(130); });

// ---------------------------------------------------------------------------
// 2. Test (b): curl, sin JavaScript
// ---------------------------------------------------------------------------
function fetchWithCurl(url) {
  return execFileSync('curl', ['-s', '-L', url], { encoding: 'utf8' });
}

const JSONLD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function extractJsonLdFromHtml(html) {
  const out = [];
  let m;
  JSONLD_RE.lastIndex = 0;
  while ((m = JSONLD_RE.exec(html)) !== null) out.push(m[1].trim());
  return out;
}

// ---------------------------------------------------------------------------
// 3. Test (a): navegador real, con JavaScript
// ---------------------------------------------------------------------------
async function fetchWithBrowser(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });

  // El JSON-LD dinámico se inyecta en DOMContentLoaded. Esperamos a que
  // aparezca antes de leer, por si el `load` se adelanta.
  await page
    .waitForSelector('script[type="application/ld+json"]', { timeout: 5000 })
    .catch(() => {});

  const jsonLd = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent)
  );
  const dom = await page.content();
  await page.close();
  return { jsonLd, dom };
}

// ---------------------------------------------------------------------------
// 4. Ejecución
// ---------------------------------------------------------------------------
function canon(text) {
  try { return JSON.stringify(JSON.parse(text)); }
  catch { return null; }
}

async function main() {
  const results = {
    curl: {},
    browser: {},
  };

  await waitForServer();
  console.log(`\nServidor local en ${BASE} (python3 -m http.server)\n`);

  // --- (b) curl -------------------------------------------------------------
  for (const p of PAGES) {
    const html = fetchWithCurl(`${BASE}${p.path}`);
    writeFileSync(join(RESULTS, `curl-${p.key}.html`), html);
    results.curl[p.key] = extractJsonLdFromHtml(html);
  }

  // --- (a) navegador --------------------------------------------------------
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    for (const p of PAGES) {
      const { jsonLd, dom } = await fetchWithBrowser(browser, `${BASE}${p.path}`);
      writeFileSync(join(RESULTS, `browser-${p.key}.dom.html`), dom);
      writeFileSync(
        join(RESULTS, `browser-${p.key}.jsonld`),
        jsonLd.join('\n---\n')
      );
      results.browser[p.key] = jsonLd;
    }
  } finally {
    await browser.close();
  }

  // --- Veredicto ------------------------------------------------------------
  const has = (arr) => arr.length > 0;
  const checks = [
    {
      name: 'curl ve JSON-LD en tortilla-de-patatas (HTML estático)',
      pass: has(results.curl.static),
      detail: `${results.curl.static.length} bloque(s)`,
    },
    {
      name: 'curl ve JSON-LD en tortilla-espanola (generado por JS)',
      expected: false,
      pass: !has(results.curl.dynamic),
      detail: `${results.curl.dynamic.length} bloque(s)`,
    },
    {
      name: 'navegador ve JSON-LD en tortilla-de-patatas',
      pass: has(results.browser.static),
      detail: `${results.browser.static.length} bloque(s)`,
    },
    {
      name: 'navegador ve JSON-LD en tortilla-espanola',
      pass: has(results.browser.dynamic),
      detail: `${results.browser.dynamic.length} bloque(s)`,
    },
    {
      name: 'JSON-LD del navegador: estático == dinámico',
      pass:
        canon(results.browser.static[0] || '') !== null &&
        canon(results.browser.static[0] || '') === canon(results.browser.dynamic[0] || ''),
      detail: 'comparación semántica (JSON.parse)',
    },
  ];

  const mark = (ok) => (ok ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m');

  console.log('Resultado del test');
  console.log('──────────────────');
  for (const c of checks) {
    console.log(`${mark(c.pass)}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }

  const allPass = checks.every((c) => c.pass);
  console.log('');
  console.log(allPass ? '\x1b[32mPASS\x1b[0m: hipótesis confirmada.' : '\x1b[31mFAIL\x1b[0m: revisa results/.');
  console.log(`\nArtefactos en: ${RESULTS}`);
  console.log('  curl-static.html / curl-dynamic.html   → lo que ve un cliente sin JS');
  console.log('  browser-static.dom.html / browser-dynamic.dom.html → DOM tras JS');
  console.log('  browser-static.jsonld / browser-dynamic.jsonld     → JSON-LD extraído');

  stopServer();
  process.exitCode = allPass ? 0 : 1;
}

main().catch((err) => {
  console.error('\nError en el test:', err.message);
  stopServer();
  process.exit(1);
});
