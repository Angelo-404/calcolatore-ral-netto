/* Check how the page looks, not only what it computes.
 *
 *   node tools/check_layout.mjs
 *
 * The other checks cover the engine, the data and the stylesheet. None of
 * them opens the page, so a defect that only shows on screen passes them all:
 * on 2 October 2026 the parameter cards were reordered and their numbers kept
 * reading 1, 6, 5, 3, 4, 2. This script opens the page in a real browser, on
 * a computer screen and on a phone screen, and checks the rules below.
 *
 * It serves the folder itself on a free port, so no other server is needed.
 * The browser is the Chrome already installed (GitHub runners have it too);
 * the library that drives it is downloaded once into tools/.cache/, which is
 * not committed. Nothing is sent anywhere: the page makes no external
 * requests, and the script checks that too.
 *
 * Exit code 0 when every rule holds, 1 otherwise.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache', 'layout');
const PLAYWRIGHT = 'playwright-core@1.63.0';

/* Limits, in CSS pixels. Measured on 2 October 2026 with the default
 * simulation, plus some room so that a new note does not break the check:
 * the point is to notice when a change doubles the page, not to freeze it. */
const LIMITS = {
  phonePageHeight: 9000,      // measured 7.838
  phoneNetTop: 4000,          // the big "Netto mensile" card, measured 3.396
  phoneSalaryTop: 844,        // the gross salary field is on the first screen
  desktopNetBottom: 900,      // the net is visible without scrolling
};

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml',
};

function serve() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function loadPlaywright() {
  const entry = path.join(CACHE, 'node_modules', 'playwright-core', 'index.mjs');
  if (!fs.existsSync(entry)) {
    console.log(`Downloading ${PLAYWRIGHT} into tools/.cache/layout (only the first time)...`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(path.join(CACHE, 'package.json'), '{ "private": true }\n');
    // Run inside the folder: on Windows npm goes through a shell, and a path
    // with spaces passed as an argument would be split by it.
    execSync(`npm install --no-audit --no-fund ${PLAYWRIGHT}`,
             { cwd: CACHE, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return import(pathToFileURL(entry).href);
}

/* Everything measured inside the page, in one pass per tab and screen. */
function measure() {
  const top = (node) => Math.round(node.getBoundingClientRect().top + window.scrollY);
  const visiblePanel = document.querySelector('[role=tabpanel]:not(.hidden)');
  const badges = [...visiblePanel.querySelectorAll('h3 > span.font-extrabold')]
    .map((b) => b.textContent.trim());
  const brokenLinks = [...document.querySelectorAll('[data-scroll-to], [data-focus]')]
    .flatMap((a) => [a.dataset.scrollTo, a.dataset.focus])
    .filter((id) => id && !document.getElementById(id));
  const openFolds = [...document.querySelectorAll('details.fold[open]')]
    .map((d) => d.querySelector('h3')?.textContent.trim().replace(/\s+/g, ' '));
  const bar = document.getElementById('bar-net');
  const barStyle = getComputedStyle(bar);
  return {
    panel: visiblePanel.id,
    badges,
    brokenLinks,
    openFolds,
    pageHeight: document.documentElement.scrollHeight,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    salaryTop: visiblePanel.id === 'panel-employee' ? top(document.getElementById('emp-salary')) : null,
    netTop: top(visiblePanel.querySelector('[id$="net-month"]')),
    netBottom: Math.round(visiblePanel.querySelector('[id$="net-month"]').getBoundingClientRect().bottom),
    barVisible: barStyle.display !== 'none' && barStyle.visibility !== 'hidden',
    barNet: document.getElementById('bar-net-month').textContent.trim(),
  };
}

async function main() {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: 'chrome' });
  const failures = [];
  const fail = (where, message) => failures.push(`${where}: ${message}`);

  try {
    for (const [screen, viewport] of Object.entries(VIEWPORTS)) {
      for (const tab of ['dipendente', 'piva']) {
        const where = `${screen}, ${tab}`;
        const context = await browser.newContext({ viewport, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch });
        const page = await context.newPage();
        page.on('pageerror', (err) => fail(where, `page error: ${err.message}`));
        page.on('console', (msg) => { if (msg.type() === 'error') fail(where, `console error: ${msg.text()}`); });
        page.on('request', (req) => { if (!req.url().startsWith(base)) fail(where, `external request to ${req.url()}`); });

        await page.goto(`${base}#sezione=${tab}&anno=2026`);
        const netId = tab === 'dipendente' ? '#emp-out-net-month' : '#se-net-month';
        await page.waitForFunction((sel) => /\d/.test(document.querySelector(sel).textContent), netId, { timeout: 30000 });
        const m = await page.evaluate(measure);

        const expected = m.badges.map((_, i) => String(i + 1));
        if (m.badges.join() !== expected.join()) {
          fail(where, `card numbers read ${m.badges.join(', ')} instead of ${expected.join(', ')}`);
        }
        if (m.brokenLinks.length) fail(where, `in-page links to missing ids: ${m.brokenLinks.join(', ')}`);
        if (m.openFolds.length) fail(where, `cards that should start folded are open: ${m.openFolds.join('; ')}`);
        if (m.overflow > 0) fail(where, `the page scrolls sideways by ${m.overflow} px`);

        if (screen === 'desktop' && m.netBottom > LIMITS.desktopNetBottom) {
          fail(where, `the net ends at ${m.netBottom} px, below the first screen (${LIMITS.desktopNetBottom} px)`);
        }
        if (screen === 'phone') {
          if (m.pageHeight > LIMITS.phonePageHeight) {
            fail(where, `page ${m.pageHeight} px high, limit ${LIMITS.phonePageHeight} px`);
          }
          if (m.netTop > LIMITS.phoneNetTop) fail(where, `the net card starts at ${m.netTop} px, limit ${LIMITS.phoneNetTop} px`);
          if (m.salaryTop !== null && m.salaryTop > LIMITS.phoneSalaryTop) {
            fail(where, `the gross salary field starts at ${m.salaryTop} px, off the first screen`);
          }
          if (tab === 'dipendente' && (!m.barVisible || !/\d/.test(m.barNet))) {
            fail(where, 'the fixed net bar at the bottom is missing or empty');
          }
        }
        console.log(`  ${where}: page ${m.pageHeight} px, net at ${m.netTop} px, cards ${m.badges.join(' ') || '-'}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  for (const f of failures) console.error(`  ✗ ${f}`);
  console.log(failures.length ? `${failures.length} layout problems found` : 'Layout check passed');
  return failures.length ? 1 : 0;
}

process.exit(await main());
